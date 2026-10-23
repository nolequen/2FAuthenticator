import { Encryption } from "./encryption";
import { createKey, unlockKey } from "./password";
import { BrowserStorage, EntryStorage } from "./storage";

export function isUUIDv4(hash: string) {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i.test(
    hash,
  );
}

export async function unlock(password: string): Promise<{
  encryptions: Map<string, Encryption>;
  defaultKeyId: string;
  passphrase: string;
} | null> {
  const encryptions = new Map<string, Encryption>();
  let defaultKeyId = "";
  let passphrase = "";

  // TODO: let user reconcile multiple keys from sync conflicts
  for (const key of await BrowserStorage.getKeys()) {
    const unlocked = await unlockKey(key, password);
    if (!unlocked) {
      continue;
    }

    encryptions.set(key.id, unlocked.encryption);
    if (!defaultKeyId || key.id < defaultKeyId) {
      defaultKeyId = key.id;
      passphrase = unlocked.passphrase;
    }
  }

  if (!defaultKeyId) {
    return null;
  }

  return { encryptions, defaultKeyId, passphrase };
}

// Encrypt any unencrypted entries.
// Browser sync can cause unencrypted entries to show up.
export async function adoptEntries(
  entries: OTPEntryInterface[],
  defaultEncryption: EncryptionInterface,
) {
  let needUpdateStorage = false;
  for (const entry of entries) {
    if (
      entry.encryption?.getEncryptionKeyId() !==
      defaultEncryption.getEncryptionKeyId()
    ) {
      entry.changeEncryption(defaultEncryption);
      needUpdateStorage = true;
    }
  }

  if (needUpdateStorage) {
    await EntryStorage.set(entries);
  }
  return needUpdateStorage;
}

export async function upgradeLegacyEntries(entries: OTPEntryInterface[]) {
  const candidates = entries.filter(
    (entry) =>
      entry.legacyData &&
      entry.secret &&
      entry.keyId &&
      entry.encryption?.getEncryptionStatus(),
  );
  if (!candidates.length) {
    return;
  }

  try {
    const upgraded: { [hash: string]: EncOTPStorage } = {};
    for (const entry of candidates) {
      const item = await EntryStorage.getOTPStorageFromEntry(entry);
      const decrypted =
        item.dataType === "EncOTPStorage"
          ? await entry.encryption?.decrypt(item.data)
          : null;
      if (
        item.dataType !== "EncOTPStorage" ||
        item.keyId !== entry.keyId ||
        !decrypted ||
        decrypted.legacy ||
        decrypted.data.secret !== entry.secret ||
        decrypted.data.hash !== entry.hash
      ) {
        throw new Error(`Upgraded account ${entry.hash} does not match.`);
      }
      upgraded[entry.hash] = item;
    }

    const stored = await BrowserStorage.get();
    const changes: { [hash: string]: EncOTPStorage } = {};
    const changed: OTPEntryInterface[] = [];
    for (const entry of candidates) {
      const storedItem = stored[entry.hash];
      if (
        storedItem?.dataType === "EncOTPStorage" &&
        storedItem.keyId === entry.keyId &&
        storedItem.data === entry.legacyData
      ) {
        changes[entry.hash] = {
          ...upgraded[entry.hash],
          index: storedItem.index,
        };
        changed.push(entry);
      }
    }

    if (!changed.length) {
      return;
    }

    await BrowserStorage.set(changes);
    for (const entry of changed) {
      entry.legacyData = undefined;
    }
  } catch (error) {
    console.warn("Could not upgrade the encryption of accounts.", error);
  }
}

async function linkedKeyIds(ignoredHashes: string[] = []) {
  const stored = await BrowserStorage.get();
  const linkedKeys = new Set<string>();
  for (const hash of Object.keys(stored)) {
    const item = stored[hash];
    if (
      !ignoredHashes.includes(hash) &&
      item?.dataType === "EncOTPStorage" &&
      item.keyId
    ) {
      linkedKeys.add(item.keyId);
    }
  }
  return linkedKeys;
}

export async function setPassword(
  password: string,
  entries: OTPEntryInterface[],
) {
  const { key, encryption, passphrase } = await createKey(password);

  // change entry encryption and regen hash
  const removeKeys: string[] = [];
  const keys = await BrowserStorage.getKeys();
  for (const entry of entries) {
    if (!entry.secret) {
      continue;
    }

    entry.changeEncryption(encryption);
    // if not uuidv4 regen
    if (!isUUIDv4(entry.hash)) {
      removeKeys.push(entry.hash);
      entry.genUUID();
    }
  }

  // store key
  await BrowserStorage.set({
    [key.id]: key,
  });
  try {
    await EntryStorage.set(entries);
  } catch (error) {
    await BrowserStorage.remove(key.id).catch((removeError) =>
      console.warn("Could not remove the unused key.", removeError),
    );
    throw error;
  }

  try {
    // remove unlinked keys when there is at least one entry
    if (entries.length !== 0) {
      const linkedKeys = await linkedKeyIds(removeKeys);
      for (const storedKey of keys) {
        if (!linkedKeys.has(storedKey.id)) {
          removeKeys.push(storedKey.id);
        }
      }
    }
    if (removeKeys.length) {
      await BrowserStorage.remove(removeKeys);
    }
  } catch (error) {
    console.warn(
      "Could not clean up the storage after a password change.",
      error,
    );
  }

  return { encryption, passphrase };
}

export async function removePassword(
  entries: OTPEntryInterface[],
  keyId: string | undefined,
) {
  for (const entry of entries) {
    entry.changeEncryption(new Encryption("", ""));
  }
  await EntryStorage.set(entries);

  if (keyId && !(await linkedKeyIds()).has(keyId)) {
    await BrowserStorage.remove(keyId);
  }
}

export async function verifyPassword(keyId: string, password: string) {
  const key = (await BrowserStorage.getKeys()).find((key) => key.id === keyId);
  if (!key) {
    throw new Error(`Key ${keyId} not in BrowserStorage`);
  }

  return (await unlockKey(key, password)) !== null;
}
