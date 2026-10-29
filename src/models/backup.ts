import { unlockKey } from "./password";

export interface BackupDecryption {
  data: { [hash: string]: RawOTPStorage };
  failed: number;
  wrongPassword: boolean;
  missingKey: boolean;
}

export function unknownKeyIds(
  backupData: { [hash: string]: OTPStorage | Key },
  known: Map<string, EncryptionInterface>,
) {
  const keyIds = new Set<string>();
  for (const item of Object.values(backupData)) {
    if (
      item &&
      typeof item === "object" &&
      item.dataType === "EncOTPStorage" &&
      !known.has(item.keyId)
    ) {
      keyIds.add(item.keyId);
    }
  }
  return [...keyIds];
}

export async function decryptBackup(
  backupData: { [hash: string]: OTPStorage | Key },
  passphrase: string | null,
  known: Map<string, EncryptionInterface> = new Map(),
): Promise<BackupDecryption> {
  const result: BackupDecryption = {
    data: {},
    failed: 0,
    wrongPassword: false,
    missingKey: false,
  };
  const keys: Map<string, EncryptionInterface | null> = new Map(known);
  let triedKeys = 0;
  let unlockedKeys = 0;
  for (const hash in backupData) {
    const unknownStorageItem = backupData[hash];
    if (
      !unknownStorageItem ||
      typeof unknownStorageItem !== "object" ||
      unknownStorageItem.dataType === "Key"
    ) {
      continue;
    }
    let storageItem: RawOTPStorage;
    if (unknownStorageItem.dataType === "EncOTPStorage") {
      const keyId = unknownStorageItem.keyId;
      if (!keys.has(keyId)) {
        const key = backupData[keyId];
        if (key?.dataType !== "Key" || key.id !== keyId) {
          result.missingKey = true;
          keys.set(keyId, null);
        } else if (passphrase) {
          triedKeys++;
          const unlocked = await unlockKey(key, passphrase);
          if (unlocked) {
            unlockedKeys++;
          }
          keys.set(keyId, unlocked ? unlocked.encryption : null);
        }
      }
      const encryption = keys.get(keyId);
      if (!encryption) {
        result.failed++;
        continue;
      }

      const decrypted = await encryption.decrypt(unknownStorageItem.data);
      if (!decrypted) {
        result.failed++;
        continue;
      }

      storageItem = {
        ...unknownStorageItem,
        ...decrypted.data,
        encrypted: false,
      } as RawOTPStorage;
    } else {
      storageItem = unknownStorageItem;
    }
    if (!storageItem.secret || storageItem.encrypted) {
      result.failed++;
      continue;
    }
    result.data[hash] = storageItem;
  }
  result.wrongPassword = triedKeys > 0 && unlockedKeys === 0;
  return result;
}

export async function decryptBackupData(
  backupData: { [hash: string]: OTPStorage | Key },
  passphrase: string | null,
) {
  return (await decryptBackup(backupData, passphrase)).data;
}
