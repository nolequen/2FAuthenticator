import * as CryptoJS from "crypto-js";

function byteArray2Base32(bytes: number[]) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const len = bytes.length;
  let result = "";
  let high: number,
    low = 0,
    sh = 0,
    hasDataInLow = false;
  for (let i = 0; i < len; i += 5) {
    hasDataInLow = true;
    high = 0xf8 & bytes[i];
    result += chars.charAt(high >> 3);
    low = 0x07 & bytes[i];
    sh = 2;

    if (i + 1 < len) {
      high = 0xc0 & bytes[i + 1];
      result += chars.charAt((low << 2) + (high >> 6));
      result += chars.charAt((0x3e & bytes[i + 1]) >> 1);
      low = bytes[i + 1] & 0x01;
      sh = 4;
    }

    if (i + 2 < len) {
      high = 0xf0 & bytes[i + 2];
      result += chars.charAt((low << 4) + (high >> 4));
      low = 0x0f & bytes[i + 2];
      sh = 1;
    }

    if (i + 3 < len) {
      high = 0x80 & bytes[i + 3];
      result += chars.charAt((low << 1) + (high >> 7));
      result += chars.charAt((0x7c & bytes[i + 3]) >> 2);
      low = 0x03 & bytes[i + 3];
      sh = 3;
    }

    if (i + 4 < len) {
      hasDataInLow = false;
      high = 0xe0 & bytes[i + 4];
      result += chars.charAt((low << 3) + (high >> 5));
      result += chars.charAt(0x1f & bytes[i + 4]);
      low = 0;
      sh = 0;
    }
  }

  if (hasDataInLow) {
    result += chars.charAt(low << sh);
  }

  const padlen = 8 - (result.length % 8);
  return result + (padlen < 8 ? Array(padlen + 1).join("=") : "");
}

function wordArrayToByteArray(wordArray: CryptoJS.lib.WordArray) {
  const byteArray: number[] = [];
  for (let i = 0; i < wordArray.words.length; ++i) {
    const word = wordArray.words[i];
    for (let j = 3; j >= 0; --j) {
      byteArray.push((word >> (8 * j)) & 0xff);
    }
  }
  byteArray.length = wordArray.sigBytes;
  return byteArray;
}

class ProtobufReader {
  private offset = 0;

  constructor(private readonly bytes: number[]) {}

  hasMore() {
    return this.offset < this.bytes.length;
  }

  readKey() {
    const key = this.readVarint();
    return { field: Math.floor(key / 8), wireType: key % 8 };
  }

  readVarint() {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      if (!this.hasMore()) {
        throw new Error("Truncated varint");
      }
      const byte = this.bytes[this.offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) {
        return value;
      }
    }
    throw new Error("Malformed varint");
  }

  readBytes() {
    const length = this.readVarint();
    const start = this.offset;
    this.advance(length);
    return this.bytes.slice(start, this.offset);
  }

  skip(wireType: number) {
    switch (wireType) {
      case 0:
        this.readVarint();
        break;
      case 1:
        this.advance(8);
        break;
      case 2:
        this.readBytes();
        break;
      case 5:
        this.advance(4);
        break;
      default:
        throw new Error(`Unsupported wire type ${wireType}`);
    }
  }

  private advance(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Truncated field");
    }
    this.offset += length;
  }
}

function utf8(bytes: number[]) {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function getOTPAuthLine(parameters: number[]) {
  const reader = new ProtobufReader(parameters);
  let secret: number[] = [];
  let name = "";
  let issuer = "";
  let algorithm = 0;
  let digits = 0;
  let type = 0;
  let counter: number | undefined;
  while (reader.hasMore()) {
    const { field, wireType } = reader.readKey();
    if (field === 1 && wireType === 2) {
      secret = reader.readBytes();
    } else if (field === 2 && wireType === 2) {
      name = utf8(reader.readBytes());
    } else if (field === 3 && wireType === 2) {
      issuer = utf8(reader.readBytes());
    } else if (field === 4 && wireType === 0) {
      algorithm = reader.readVarint();
    } else if (field === 5 && wireType === 0) {
      digits = reader.readVarint();
    } else if (field === 6 && wireType === 0) {
      type = reader.readVarint();
    } else if (field === 7 && wireType === 0) {
      counter = reader.readVarint();
    } else {
      reader.skip(wireType);
    }
  }

  const otpType = ["totp", "hotp", "totp"][type] ?? "totp";
  const label =
    issuer &&
    name.indexOf(":") !== -1 &&
    !name.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)
      ? `${encodeURIComponent(issuer)}:${encodeURIComponent(name)}`
      : encodeURIComponent(name);
  let line = `otpauth://${otpType}/${label}?secret=${byteArray2Base32(secret)}`;
  if (issuer) {
    line += `&issuer=${encodeURIComponent(issuer)}`;
  }
  line += `&algorithm=${
    ["SHA1", "SHA1", "SHA256", "SHA512", "MD5"][algorithm] ?? "SHA1"
  }&digits=${[6, 6, 8][digits] ?? 6}`;
  if (otpType === "hotp") {
    line += `&counter=${counter ?? 1}`;
  }
  return line;
}

export function getOTPAuthPerLineFromOPTAuthMigration(migrationUri: string) {
  if (!migrationUri.startsWith("otpauth-migration:")) {
    return [];
  }

  const data = migrationUri.match(/[?&]data=([^&]*)/);
  if (!data) {
    return [];
  }

  let base64Data: string;
  try {
    base64Data = decodeURIComponent(data[1]);
  } catch {
    return [];
  }

  const wordArrayData = CryptoJS.enc.Base64.parse(base64Data);
  const reader = new ProtobufReader(wordArrayToByteArray(wordArrayData));
  const lines: string[] = [];
  try {
    while (reader.hasMore()) {
      const { field, wireType } = reader.readKey();
      if (field === 1 && wireType === 2) {
        lines.push(getOTPAuthLine(reader.readBytes()));
      } else {
        reader.skip(wireType);
      }
    }
  } catch (error) {
    console.warn("Malformed migration data.", error);
  }
  return lines;
}
