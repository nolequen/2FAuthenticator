import * as CryptoJS from "crypto-js";

export class Encryption implements EncryptionInterface {
  private password: string;
  private keyId: string;

  constructor(hash: string, keyId: string) {
    this.password = hash;
    this.keyId = keyId;
  }

  getEncryptedString(data: string): string {
    if (!this.password) {
      return data;
    } else {
      return CryptoJS.AES.encrypt(data, this.password).toString();
    }
  }

  decryptEncSecret(entry: OTPEntryInterface) {
    try {
      if (!entry.encData) {
        return null;
      }

      const decryptedData = CryptoJS.AES.decrypt(
        entry.encData,
        this.password,
      ).toString(CryptoJS.enc.Utf8);

      if (!decryptedData) {
        return null;
      }

      return JSON.parse(decryptedData);
    } catch (error) {
      return null;
    }
  }

  getEncryptionStatus(): boolean {
    return this.password ? true : false;
  }

  getEncryptionKeyId(): string {
    return this.keyId;
  }
}
