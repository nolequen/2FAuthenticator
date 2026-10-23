import * as CryptoJS from "crypto-js";

const V4_PREFIX = "v4:";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class Encryption implements EncryptionInterface {
  private password: string;
  private keyId: string;
  private cryptoKey?: Promise<CryptoKey>;

  constructor(hash: string, keyId: string) {
    this.password = hash;
    this.keyId = keyId;
  }

  async encrypt(text: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.getCryptoKey(),
      new TextEncoder().encode(text),
    );
    const data = new Uint8Array(IV_LENGTH + encrypted.byteLength);
    data.set(iv);
    data.set(new Uint8Array(encrypted), IV_LENGTH);
    return V4_PREFIX + toBase64(data);
  }

  async decrypt(
    data: string,
  ): Promise<{ data: RawOTPStorage; legacy: boolean } | null> {
    try {
      if (!data) {
        return null;
      }

      const legacy = !data.startsWith(V4_PREFIX);
      let decryptedData: string;
      if (legacy) {
        decryptedData = CryptoJS.AES.decrypt(data, this.password).toString(
          CryptoJS.enc.Utf8,
        );
      } else {
        const bytes = fromBase64(data.slice(V4_PREFIX.length));
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.subarray(0, IV_LENGTH) },
          await this.getCryptoKey(),
          bytes.subarray(IV_LENGTH),
        );
        decryptedData = new TextDecoder().decode(decrypted);
      }

      if (!decryptedData) {
        return null;
      }

      const parsed = JSON.parse(decryptedData);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return { data: parsed, legacy };
    } catch {
      return null;
    }
  }

  getEncryptionStatus(): boolean {
    return this.password ? true : false;
  }

  getEncryptionKeyId(): string {
    return this.keyId;
  }

  private getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) {
      this.cryptoKey = this.importCryptoKey();
    }
    return this.cryptoKey;
  }

  private async importCryptoKey(): Promise<CryptoKey> {
    const key = fromBase64(this.password || "");
    if (key.length !== KEY_LENGTH) {
      throw new Error("Encryption key must be 32 bytes long.");
    }
    return crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
}
