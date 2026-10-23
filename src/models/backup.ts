import { unlockKey } from "./password";

export async function decryptBackupData(
  backupData: { [hash: string]: OTPStorage | Key },
  passphrase: string | null,
) {
  const decryptedBackupData: { [hash: string]: RawOTPStorage } = {};
  const keys: Map<string, EncryptionInterface | null> = new Map();
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
      if (!passphrase) {
        continue;
      }

      const keyId = unknownStorageItem.keyId;
      if (!keys.has(keyId)) {
        const key = backupData[keyId];
        const unlocked =
          key?.dataType === "Key" && key.id === keyId
            ? await unlockKey(key, passphrase)
            : null;
        keys.set(keyId, unlocked ? unlocked.encryption : null);
      }
      const encryption = keys.get(keyId);
      if (!encryption) {
        // wrong password for key
        continue;
      }

      const decrypted = await encryption.decrypt(unknownStorageItem.data);
      if (!decrypted) {
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
      continue;
    }
    decryptedBackupData[hash] = storageItem;
  }
  return decryptedBackupData;
}
