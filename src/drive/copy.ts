import { Encryption } from "../models/encryption";
import { StorageLocation } from "../models/settings";
import { withStorageLock } from "../models/storage";
import { DRIVE_RECORD } from "./config";
import type { BackupKey } from "./state";

export type CopyMode = "password" | "backup";

export type DriveCopy =
  | { kind: "empty"; skipped: number }
  | { kind: "attention"; attention: "unlock" | "backupPassword" }
  | {
      kind: "ready";
      content: string;
      sourceHash: string;
      accounts: number;
      skipped: number;
      mode: CopyMode;
    };

export interface CopySnapshot {
  items: { [key: string]: unknown };
  session: SessionData;
}

export async function readStorageLocation() {
  const { UserSettings: settings } = await chrome.storage.local.get<{
    UserSettings?: { storageLocation?: string };
  }>("UserSettings");
  const location = settings?.storageLocation;
  return location === StorageLocation.Sync || location === StorageLocation.Local
    ? location
    : null;
}

export function takeSnapshot(): Promise<CopySnapshot | null> {
  return withStorageLock(async () => {
    const location = await readStorageLocation();
    if (!location) {
      return null;
    }
    const items = await chrome.storage[location].get();
    const session = await chrome.storage.session.get<SessionData>([
      "cachedPassphrase",
      "cachedKeyId",
    ]);
    return { items, session };
  });
}

function isKey(item: object): item is Key {
  const key = item as Partial<Key>;
  return key.dataType === "Key" && typeof key.id === "string" && !!key.id;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === "object") {
    const sorted: { [key: string]: unknown } = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as { [key: string]: unknown })[key]);
    }
    return sorted;
  }
  return value;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function buildCopy(
  snapshot: CopySnapshot,
  backupKey?: BackupKey,
): Promise<DriveCopy> {
  const keys = new Map<string, Key>();
  const entries: [string, OTPStorage][] = [];
  for (const hash of Object.keys(snapshot.items)) {
    const item = snapshot.items[hash];
    if (
      hash === "UserSettings" ||
      hash === DRIVE_RECORD ||
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }
    if (isKey(item)) {
      keys.set(item.id, item);
    } else if ("secret" in item || "data" in item) {
      entries.push([hash, item as OTPStorage]);
    }
  }
  if (!entries.length) {
    return { kind: "empty", skipped: 0 };
  }

  const mode: CopyMode = keys.size ? "password" : "backup";
  const file: { [hash: string]: OTPStorage | Key } = {};
  const source: { [hash: string]: OTPStorage } = {};
  const open: [string, RawOTPStorage][] = [];
  let skipped = 0;
  for (const [hash, item] of entries) {
    if (item.dataType === "EncOTPStorage") {
      const key = keys.get(item.keyId);
      if (!key) {
        skipped++;
        continue;
      }
      file[hash] = item;
      file[key.id] = key;
      source[hash] = item;
    } else if (typeof item.secret === "string" && !item.encrypted) {
      open.push([hash, item]);
      source[hash] = item;
    } else {
      skipped++;
    }
  }

  let keyId: string | null = null;
  if (open.length) {
    let key: Key;
    let encryption: Encryption;
    if (mode === "password") {
      const { cachedPassphrase, cachedKeyId } = snapshot.session;
      const sessionKey = cachedKeyId ? keys.get(cachedKeyId) : undefined;
      if (!cachedPassphrase || !sessionKey) {
        return { kind: "attention", attention: "unlock" };
      }
      key = sessionKey;
      encryption = new Encryption(cachedPassphrase, sessionKey.id);
    } else {
      if (!backupKey) {
        return { kind: "attention", attention: "backupPassword" };
      }
      key = backupKey.key;
      encryption = new Encryption(backupKey.passphrase, backupKey.key.id);
    }
    for (const [hash, item] of open) {
      file[hash] = {
        dataType: "EncOTPStorage",
        data: await encryption.encrypt(
          JSON.stringify({ ...item, dataType: "OTPStorage" }),
        ),
        keyId: key.id,
        index: item.index ?? 0,
      };
    }
    file[key.id] = key;
    keyId = key.id;
  }

  const accounts = Object.keys(source).length;
  if (!accounts) {
    return { kind: "empty", skipped };
  }

  const fileKeys = Object.keys(file)
    .filter((id) => file[id].dataType === "Key")
    .sort();
  const sourceHash = await sha256(
    JSON.stringify(
      canonical({
        mode,
        keyId,
        source,
        keys: fileKeys.map((id) => file[id]),
      }),
    ),
  );
  return {
    kind: "ready",
    content: JSON.stringify(file, null, 2).replace(/\n/g, "\r\n"),
    sourceHash,
    accounts,
    skipped,
    mode,
  };
}
