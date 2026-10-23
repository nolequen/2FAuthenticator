import { Encryption } from "../models/encryption";
import { StorageLocation, UserSettings } from "../models/settings";
import { STORAGE_LOCK, withStorageLock } from "../models/storage";

export async function resetStorage(settings: typeof UserSettings.items = {}) {
  await chrome.storage.local.clear();
  if (Object.keys(await chrome.storage.sync.get()).length > 0) {
    await chrome.storage.sync.clear();
  }
  await chrome.storage.local.set({
    UserSettings: { ...settings, storageLocation: StorageLocation.Local },
  });
  await UserSettings.updateItems();
}

export function randomPassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
}

export async function clearSession() {
  await chrome.storage.session.remove([
    "cachedPassphrase",
    "cachedKeyId",
    "contentTabId",
  ]);
}

export async function storeKey(
  id: string,
  storage: chrome.storage.StorageArea = chrome.storage.local,
) {
  const key: Key = {
    dataType: "Key",
    id,
    salt: "salt",
    hash: "hash",
    version: 3,
  };
  await storage.set({ [id]: key });
}

export async function cacheSessionKey(keyId: string) {
  const passphrase = randomPassphrase();
  await chrome.storage.session.set({
    cachedPassphrase: passphrase,
    cachedKeyId: keyId,
  });
  return new Encryption(passphrase, keyId);
}

export async function holdStorageLock() {
  let release: () => void = () => undefined;
  let held: Promise<void> = Promise.resolve();
  await new Promise<void>((granted) => {
    held = withStorageLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          granted();
        }),
    );
  });
  return async () => {
    release();
    await held;
  };
}

export async function waitForStorageLockRequests(count = 1) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const { pending = [] } = await navigator.locks.query();
    if (pending.filter((lock) => lock.name === STORAGE_LOCK).length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Fewer than ${count} requests wait for the storage lock.`);
}
