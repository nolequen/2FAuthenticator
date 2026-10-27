import { KeyUtilities } from "./key-utilities";
import { UserSettings } from "./settings";
import { EntryStorage, withStorageLock } from "./storage";

export enum OTPType {
  totp = 1,
  hotp,
  hex = 5,
  hhex = 6,
}

export enum CodeState {
  Invalid = "-1",
  Encrypted = "-2",
}

export const MASK_DIGIT = "•";

export function isCodeReady(code: string) {
  return (
    code !== CodeState.Encrypted &&
    code !== CodeState.Invalid &&
    !code.startsWith(MASK_DIGIT)
  );
}

export enum OTPAlgorithm {
  SHA1 = 1,
  SHA256,
  SHA512,
  GOST3411_2012_256,
  GOST3411_2012_512,
}

function parseEnumValue(
  values: Record<string, string | number>,
  value: unknown,
): number | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return parseEnumValue(values, Number(value));
  }

  if (typeof value === "number") {
    return typeof values[value] === "string" ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const lowerCaseValue = value.toLowerCase();
  const name = Object.keys(values).find(
    (key) =>
      typeof values[key] === "number" && key.toLowerCase() === lowerCaseValue,
  );
  return name === undefined ? undefined : Number(values[name]);
}

export function parseOTPType(
  value: unknown,
  digits?: number,
): { type: OTPType; digits?: number } {
  if (
    (typeof value === "string" || typeof value === "number") &&
    /^(battle|3)$/i.test(String(value))
  ) {
    return { type: OTPType.totp, digits: 8 };
  }
  return { type: parseEnumValue(OTPType, value) ?? OTPType.totp, digits };
}

export function parseOTPAlgorithm(value: unknown): OTPAlgorithm | undefined {
  return parseEnumValue(OTPAlgorithm, value);
}

export function parseOTPCounter(value: unknown): number {
  const counter =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof counter === "number" &&
    Number.isSafeInteger(counter) &&
    counter >= 0
    ? counter
    : 0;
}

export enum DataType {
  OTPStorage = "OTPStorage",
  EncOTPStorage = "EncOTPStorage",
  Key = "Key",
}

export interface OTPAlgorithmSpec {
  length: number;
}

export class OTPUtil {
  static getOTPAlgorithmSpec(otpAlgorithm: OTPAlgorithm): OTPAlgorithmSpec {
    switch (otpAlgorithm) {
      case OTPAlgorithm.GOST3411_2012_256:
        return { length: 256 };
      case OTPAlgorithm.GOST3411_2012_512:
        return { length: 512 };
      default:
        return { length: 0 };
    }
  }
}

export class OTPEntry implements OTPEntryInterface {
  type: OTPType;
  index: number;
  issuer: string;
  secret: string | null;
  account: string;
  hash: string;
  counter: number;
  period: number;
  digits: number;
  algorithm: OTPAlgorithm;
  pinned: boolean;
  group: string;
  encryption?: EncryptionInterface;
  encData?: string;
  legacyData?: string;
  keyId?: string;
  code = MASK_DIGIT.repeat(6);

  constructor(
    entry:
      | {
          account?: string;
          encrypted: boolean;
          index: number;
          issuer?: string;
          secret: string;
          type: OTPType;
          counter?: number;
          period?: number;
          hash?: string;
          digits?: number;
          algorithm?: OTPAlgorithm;
          pinned?: boolean;
          group?: string;
        }
      | {
          encrypted: true;
          keyId: string;
          encData: string;
          hash: string;
          index: number;
        },
    encryption?: EncryptionInterface,
  ) {
    this.encryption = encryption;
    this.index = entry.index;

    if ("keyId" in entry) {
      this.encData = entry.encData;
      this.secret = null;
      this.hash = entry.hash;
      this.keyId = entry.keyId;

      // defaults
      this.type = OTPType.totp;
      this.issuer = "";
      this.account = "";
      this.counter = 0;
      this.period = 30;
      this.digits = 6;
      this.algorithm = OTPAlgorithm.SHA1;
      this.pinned = false;
      this.group = "";
      return;
    }

    this.secret = entry.secret;
    this.type = entry.type;
    if (entry.issuer) {
      this.issuer = entry.issuer;
    } else {
      this.issuer = "";
    }
    if (entry.account) {
      this.account = entry.account;
    } else {
      this.account = "";
    }
    if (entry.hash) {
      this.hash = entry.hash;
    } else {
      this.hash = crypto.randomUUID();
    }
    if (entry.counter) {
      this.counter = entry.counter;
    } else {
      this.counter = 0;
    }
    if (entry.digits) {
      this.digits = entry.digits;
    } else {
      this.digits = 6;
    }
    if (entry.algorithm) {
      this.algorithm = entry.algorithm;
    } else {
      this.algorithm = OTPAlgorithm.SHA1;
    }
    if (entry.pinned) {
      this.pinned = entry.pinned;
    } else {
      this.pinned = false;
    }
    this.group = typeof entry.group === "string" ? entry.group : "";
    if (
      (this.type === OTPType.totp || this.type === OTPType.hex) &&
      entry.period
    ) {
      this.period = entry.period;
    } else {
      this.period = 30;
    }
    if (this.type !== OTPType.hotp && this.type !== OTPType.hhex) {
      this.generate();
    }
  }

  async create() {
    await withStorageLock(() => EntryStorage.add(this));
    return;
  }

  async update() {
    await withStorageLock(() => EntryStorage.update(this));
    return;
  }

  changeEncryption(encryption: EncryptionInterface) {
    if (!this.secret) {
      return;
    }

    this.encryption = encryption;
    return;
  }

  async applyEncryption(encryption: EncryptionInterface) {
    if (
      !encryption ||
      !encryption.getEncryptionStatus() ||
      !this.keyId ||
      this.keyId !== encryption.getEncryptionKeyId() ||
      !this.encData
    ) {
      return;
    }

    const encData = this.encData;
    // check if its a rawotpstorage
    const decrypted = await encryption.decrypt(encData);
    if (decrypted === null) {
      return;
    }
    const decryptedData = decrypted.data;

    if (decryptedData?.dataType !== "OTPStorage") {
      console.warn("Decrypt successful, but malformed encData!", this.hash);
    }

    if (decryptedData.hash !== this.hash) {
      console.warn(
        "Decrypt successful, but hash mismatch!",
        this.hash,
        decryptedData.hash,
      );
    }

    const { type, digits } = parseOTPType(
      decryptedData.type,
      decryptedData.digits,
    );
    this.account = decryptedData.account || "";
    this.algorithm =
      parseOTPAlgorithm(decryptedData.algorithm) ?? OTPAlgorithm.SHA1;
    this.counter = decryptedData.counter || 0;
    this.digits = digits || 6;
    this.issuer = decryptedData.issuer || "";
    this.period = decryptedData.period || 30;
    this.pinned = decryptedData.pinned || false;
    this.group =
      typeof decryptedData.group === "string" ? decryptedData.group : "";
    this.secret = decryptedData.secret;
    this.type = type;

    if (this.type !== OTPType.hotp && this.type !== OTPType.hhex) {
      this.generate();
    }

    this.encryption = encryption;
    this.legacyData = decrypted.legacy ? encData : undefined;
    this.encData = "";
  }

  async delete() {
    await withStorageLock(() => EntryStorage.delete(this));
    return;
  }

  async next() {
    if (this.type !== OTPType.hotp && this.type !== OTPType.hhex) {
      return;
    }
    this.generate();
    if (this.secret !== null) {
      this.counter++;
      await this.update();
    }
    return;
  }

  genUUID() {
    this.hash = crypto.randomUUID();
  }

  generate() {
    const offset = UserSettings.items ? UserSettings.items.offset : 0;
    if (!UserSettings.items) {
      // browser storage is async, so we need to wait for it to load
      // and re-generate the code
      // don't change the code to async, it will break the mutation
      // for Accounts store to export data
      UserSettings.updateItems().then(() => {
        this.generate();
      });
    }

    if (!this.secret && !this.encData) {
      this.code = CodeState.Invalid;
    } else if (!this.secret) {
      this.code = CodeState.Encrypted;
    } else {
      try {
        this.code = KeyUtilities.generate(
          this.type,
          this.secret,
          this.counter,
          this.period,
          this.digits,
          this.algorithm,
          offset,
        );
      } catch (error) {
        this.code = CodeState.Invalid;
        console.warn("Invalid secret.", error);
      }
    }
  }
}
