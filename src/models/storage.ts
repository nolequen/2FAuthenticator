import { Encryption } from "./encryption";
import {
  OTPEntry,
  OTPType,
  OTPAlgorithm,
  CodeState,
  parseOTPAlgorithm,
  parseOTPCounter,
  parseOTPType,
} from "./otp";
import { StorageLocation, UserSettings } from "./settings";
import { DataType } from "./otp";
export class BrowserStorage {
  private static async getStorageLocation(): Promise<StorageLocation> {
    await UserSettings.updateItems();
    if (
      UserSettings.items.storageLocation !== StorageLocation.Sync &&
      UserSettings.items.storageLocation !== StorageLocation.Local
    ) {
      return new Promise((resolve, reject) => {
        let amountSync: number;
        let amountLocal: number;
        chrome.storage.local.get((local) => {
          amountLocal = Object.keys(local).length;
          try {
            chrome.storage.sync.get((sync) => {
              amountSync = Object.keys(sync).length;
              // If storage location can't be found try to auto-detect storage
              // location
              if (amountLocal > amountSync && amountSync === 0) {
                UserSettings.items.storageLocation = StorageLocation.Local;
              } else if (amountLocal < amountSync && amountLocal === 0) {
                UserSettings.items.storageLocation = StorageLocation.Sync;
              } else {
                // Use default
                UserSettings.items.storageLocation = StorageLocation.Sync;
              }
              UserSettings.commitItems();
              resolve(UserSettings.items.storageLocation);
              return;
            });
          } catch (error) {
            reject(error);
            return;
          }
        });
      });
    } else {
      return new Promise((resolve) => {
        resolve(UserSettings.items.storageLocation || StorageLocation.Sync);
        return;
      });
    }
  }

  // TODO: promise this
  static async get() {
    const storageLocation = await this.getStorageLocation();
    const removeOtherData = function (items: Record<string, unknown>): void {
      for (const itemId in items) {
        const item = items[itemId];

        if (
          item !== null &&
          typeof item === "object" &&
          "dataType" in item &&
          item.dataType === "Key"
        ) {
          delete items[itemId];
        }
      }
    };

    let items = {} as { [key: string]: OTPStorage };

    if (storageLocation === "local") {
      items = await chrome.storage.local.get();
    } else if (storageLocation === "sync") {
      items = await chrome.storage.sync.get();
    }

    removeOtherData(items);

    return items;
  }

  static async getKeys(): Promise<Key[]> {
    const storageLocation = await this.getStorageLocation();

    const data = (await chrome.storage[storageLocation].get()) as Record<
      string,
      unknown
    >;

    const keys: Key[] = [];
    if (data && typeof data === "object") {
      for (const record in data) {
        const key = data[record];
        if (isKey(key)) {
          keys.push(key);
        }
      }
    }

    return keys;
  }

  static async set(data: object) {
    const storageLocation = await this.getStorageLocation();
    if (storageLocation === StorageLocation.Local) {
      await chrome.storage.local.set(data);
    } else if (storageLocation === StorageLocation.Sync) {
      await chrome.storage.sync.set(data);
    }
    return;
  }

  static async remove(data: string | string[]) {
    const storageLocation = await this.getStorageLocation();
    if (storageLocation === "local") {
      await chrome.storage.local.remove(data);
    } else if (storageLocation === "sync") {
      await chrome.storage.sync.remove(data);
    }
    return;
  }

  // Use for Chrome only.
  // https://github.com/Authenticator-Extension/Authenticator/issues/412
  static async clearLogs() {
    const storageLocation = await this.getStorageLocation();
    if (storageLocation === "local") {
      const data = await chrome.storage.local.get();
      await chrome.storage.local.clear();
      await chrome.storage.local.set(data);
    } else if (storageLocation === "sync") {
      const data = await chrome.storage.sync.get();
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(data);
    }
  }
}

function isKey(key: unknown): key is Key {
  return Boolean(
    key &&
    typeof key === "object" &&
    "dataType" in key &&
    "id" in key &&
    "salt" in key &&
    key.dataType === "Key" &&
    key.id &&
    key.salt &&
    typeof key.id === "string" &&
    typeof key.salt === "string",
  );
}

export class EntryStorage {
  private static getOTPStorageFromEntry(
    entry: OTPEntry,
    unencrypted?: boolean,
  ): OTPStorage {
    let secret: string;
    if (!entry.secret && entry.encData && entry.keyId) {
      return {
        dataType: DataType.EncOTPStorage,
        keyId: entry.keyId,
        data: entry.encData,
        index: entry.index,
      };
    } else if (entry.secret) {
      secret = entry.secret;
    } else {
      secret = "";
      console.warn("Invalid entry", entry);
    }

    let encrypted = entry.encryption?.getEncryptionStatus() || false;

    if (unencrypted && entry.secret) {
      secret = entry.secret;
      encrypted = false;
    }

    const storageItem: RawOTPStorage = {
      encrypted,
      hash: entry.hash,
      index: entry.index,
      type: OTPType[entry.type],
      secret,
    };

    if (entry.pinned) {
      storageItem.pinned = true;
    }

    if (entry.type === OTPType.hotp || entry.type === OTPType.hhex) {
      storageItem.counter = entry.counter;
    }

    if (entry.period && entry.period !== 30) {
      storageItem.period = entry.period;
    }

    if (entry.issuer) {
      storageItem.issuer = entry.issuer;
    }

    if (entry.account) {
      storageItem.account = entry.account;
    }

    if (entry.digits && entry.digits !== 6) {
      storageItem.digits = entry.digits;
    }

    if (entry.algorithm && entry.algorithm !== OTPAlgorithm.SHA1) {
      storageItem.algorithm = OTPAlgorithm[entry.algorithm];
    }

    if (entry.encryption?.getEncryptionKeyId()) {
      storageItem.keyId = entry.encryption.getEncryptionKeyId();
    }

    storageItem.dataType = DataType.OTPStorage;

    if (
      !unencrypted &&
      encrypted &&
      entry.encryption?.getEncryptionStatus() &&
      entry.encryption.getEncryptionKeyId()
    ) {
      const encData = entry.encryption.getEncryptedString(
        JSON.stringify(storageItem),
      );
      return {
        dataType: DataType.EncOTPStorage,
        data: encData,
        keyId: entry.encryption.getEncryptionKeyId(),
        index: entry.index,
      };
    } else if (encrypted) {
      console.error("Could not encrypt malformed entry: ", entry);
    }

    return storageItem;
  }

  private static ensureUniqueIndex(data: { [hash: string]: OTPStorage }) {
    const tempEntryArray: [hash: string, storage: OTPStorage][] = [];

    for (const hash of Object.keys(data)) {
      if (
        hash === "UserSettings" ||
        (data[hash] as { dataType: string }).dataType === "Key" ||
        !this.isValidEntry(data, hash)
      ) {
        continue;
      }
      tempEntryArray.push([hash, data[hash]]);
    }

    tempEntryArray.sort((a, b) => {
      return a[1].index - b[1].index;
    });

    let i = 0;
    const newData: { [hash: string]: OTPStorage } = tempEntryArray.reduce(
      (previous: { [hash: string]: OTPStorage }, entry) => {
        const mergedData = {
          ...previous,
          [entry[0]]: { ...entry[1], index: i },
        };

        i += 1;

        return mergedData;
      },
      {},
    );

    return newData;
  }

  private static isOTPStorage(entry: unknown) {
    if (typeof entry !== "object") {
      return false;
    }

    if (!entry || !("secret" in entry || "data" in entry)) {
      return false;
    }

    return true;
  }

  private static isValidEntry(
    _data: { [hash: string]: OTPStorage },
    hash: string,
  ) {
    if (typeof _data[hash] !== "object") {
      console.log('Key "' + hash + '" is not an object');
      return false;
    } else {
      if (!this.isOTPStorage(_data[hash])) {
        console.log('Key "' + hash + '" is not OTPStorage');
        return false;
      }
      return true;
    }
  }

  static async hasEncryptionKey(): Promise<boolean> {
    const keys = await BrowserStorage.getKeys();
    return keys.length !== 0;
  }

  static getExport(data: OTPEntryInterface[], encrypted?: boolean) {
    try {
      const exportData: { [hash: string]: OTPStorage } = {};
      for (const entry of data) {
        // Skip unable-decrypted data
        if (entry.code === CodeState.Encrypted || !entry.secret) {
          continue;
        }

        exportData[entry.hash] = this.getOTPStorageFromEntry(entry, !encrypted);
      }
      return exportData;
    } catch (error) {
      return error;
    }
  }

  static async import(
    encryption: Encryption,
    data: { [hash: string]: RawOTPStorage },
  ) {
    let _data = await BrowserStorage.get();
    for (const hash of Object.keys(data)) {
      // never trust data import from user
      // data must be decrypted before calling this method
      if (!data[hash].secret || data[hash].encrypted) {
        // TODO: we need give a failed warning
        continue;
      }

      const { type, digits } = parseOTPType(data[hash].type, data[hash].digits);
      const entryData: {
        account: string;
        encrypted: false;
        index: number;
        issuer: string;
        secret: string;
        type: OTPType;
        counter: number;
        period: number;
        hash: string;
        digits: number;
        algorithm: OTPAlgorithm;
        pinned: boolean;
      } = {
        type,
        index: data[hash].index || 0,
        issuer: data[hash].issuer || "",
        account: data[hash].account || "",
        encrypted: false,
        secret: data[hash].secret,
        counter: parseOTPCounter(data[hash].counter),
        period: data[hash].period || 30,
        digits: digits || 6,
        algorithm: parseOTPAlgorithm(data[hash].algorithm) ?? OTPAlgorithm.SHA1,
        pinned: data[hash].pinned || false,
        hash: data[hash].hash || hash,
      };

      if (isNaN(entryData.period) || entryData.period <= 0) {
        entryData.period = 30;
      }

      // If invalid digits, then use default.
      if (entryData.digits > 10 || entryData.digits < 1) {
        entryData.digits = 6;
      }

      if (/^(blz-|bliz-)/.test(entryData.secret)) {
        const secretMatches = entryData.secret.match(/^(blz-|bliz-)(.*)/);
        if (secretMatches && secretMatches.length >= 3) {
          entryData.secret = secretMatches[2];
          entryData.type = OTPType.totp;
          entryData.digits = 8;
        }
      }

      if (
        !/^[a-z2-7]+=*$/i.test(entryData.secret) &&
        /^[0-9a-f]+$/i.test(entryData.secret) &&
        entryData.type === OTPType.totp
      ) {
        entryData.type = OTPType.hex;
      }

      if (
        !/^[a-z2-7]+=*$/i.test(entryData.secret) &&
        /^[0-9a-f]+$/i.test(entryData.secret) &&
        entryData.type === OTPType.hotp
      ) {
        entryData.type = OTPType.hhex;
      }

      // not a valid / old hash
      if (
        !/^[a-f0-9]{8}-?[a-f0-9]{4}-?4[a-f0-9]{3}-?[89ab][a-f0-9]{3}-?[a-f0-9]{12}$/.test(
          hash,
        )
      ) {
        entryData.hash = crypto.randomUUID();
        delete data[hash];
      }

      const entry = new OTPEntry(entryData, encryption);
      _data[entryData.hash] = this.getOTPStorageFromEntry(entry);
    }
    _data = this.ensureUniqueIndex(_data);
    await BrowserStorage.set(_data);
  }

  static async add(entry: OTPEntry) {
    await BrowserStorage.set({
      [entry.hash]: this.getOTPStorageFromEntry(entry),
    });
  }

  static async update(entry: OTPEntry) {
    let _data = await BrowserStorage.get();
    if (!Object.prototype.hasOwnProperty.call(_data, entry.hash)) {
      throw new Error("Entry to change does not exist.");
    }
    const storageItem = this.getOTPStorageFromEntry(entry);
    _data[entry.hash] = storageItem;
    _data = this.ensureUniqueIndex(_data);
    await BrowserStorage.set(_data);
  }

  static async set(entries: OTPEntry[]) {
    let _data = await BrowserStorage.get();
    entries.forEach((entry) => {
      const storageItem = this.getOTPStorageFromEntry(entry);
      _data[entry.hash] = storageItem;
    });
    _data = this.ensureUniqueIndex(_data);
    await BrowserStorage.set(_data);
  }

  static async get() {
    const _data = await BrowserStorage.get();
    const data: OTPEntry[] = [];

    for (const hash of Object.keys(_data)) {
      if (
        hash === "UserSettings" ||
        (_data[hash] as { dataType: string }).dataType === "Key" ||
        !this.isValidEntry(_data, hash)
      ) {
        continue;
      }

      const entryData = _data[hash];

      if (entryData.dataType === "EncOTPStorage") {
        data.push(
          new OTPEntry({
            encrypted: true,
            encData: entryData.data,
            keyId: entryData.keyId,
            hash,
            index: entryData.index,
          }),
        );
        continue;
      }

      if (!entryData.hash) {
        entryData.hash = hash;
      }

      const { type, digits } = parseOTPType(
        entryData.type,
        entryData.digits ? Number(entryData.digits) : undefined,
      );

      let period: number | undefined;
      if (
        (type === OTPType.totp || type === OTPType.hex) &&
        entryData.period &&
        entryData.period > 0
      ) {
        period = entryData.period;
      }

      const entry = new OTPEntry({
        account: entryData.account,
        encrypted: entryData.encrypted,
        hash: entryData.hash,
        index: entryData.index,
        issuer: entryData.issuer,
        secret: entryData.secret,
        type,
        counter: entryData.counter,
        period,
        digits,
        algorithm: parseOTPAlgorithm(entryData.algorithm),
        pinned: entryData.pinned,
      });

      data.push(entry);
    }

    data.sort((a, b) => {
      return a.index - b.index;
    });

    return data;
  }

  static async remove(hash: string) {
    await BrowserStorage.remove(hash);
  }

  static async delete(entry: OTPEntry) {
    let _data = await BrowserStorage.get();
    if (Object.prototype.hasOwnProperty.call(_data, entry.hash)) {
      delete _data[entry.hash];
    }
    _data = this.ensureUniqueIndex(_data);
    await BrowserStorage.remove(entry.hash);
    await BrowserStorage.set(_data);
  }
}
