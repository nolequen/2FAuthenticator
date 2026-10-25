import { Encryption } from "./encryption";
import { BrowserStorage, EntryStorage, withStorageLock } from "./storage";

export async function getSessionEncryption() {
  const { cachedPassphrase, cachedKeyId } =
    await chrome.storage.session.get<SessionData>([
      "cachedPassphrase",
      "cachedKeyId",
    ]);
  const keys = await BrowserStorage.getKeys();

  if (!cachedPassphrase) {
    return keys.length ? null : new Encryption("", "");
  }
  if (!cachedKeyId || !keys.some((key) => key.id === cachedKeyId)) {
    return null;
  }
  return new Encryption(cachedPassphrase, cachedKeyId);
}

export function importUnderSession(data: { [hash: string]: RawOTPStorage }) {
  return withStorageLock(async () => {
    const encryption = await getSessionEncryption();
    if (!encryption) {
      return false;
    }

    await EntryStorage.import(encryption, data);
    return true;
  });
}
