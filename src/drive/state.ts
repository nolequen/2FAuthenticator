import { withStorageLock } from "../models/storage";
import { DRIVE_RECORD, DRIVE_SESSION } from "./config";

export type DriveBrowser = "chrome" | "edge" | "firefox";
export type DriveClient = "web" | "desktop";
export type DriveErrorKind = "network" | "quota";

export type DriveAttention =
  | { kind: "signin" }
  | { kind: "consent" }
  | { kind: "backupPassword" }
  | { kind: "unlock" }
  | { kind: "shrink"; from: number; to: number; sourceHash: string };

export interface DriveUpload {
  day: number;
  at: number;
  fileId: string;
  sourceHash: string;
  accounts: number;
}

export interface BackupKey {
  key: Key;
  passphrase: string;
}

export interface DriveRecord {
  connectionId: string;
  client: DriveClient;
  browser: DriveBrowser;
  email?: string;
  refreshToken?: string;
  folderId?: string;
  backupKey?: BackupKey;
  backupKeyRetiredDay?: number;
  lastUpload?: DriveUpload;
  skipped?: number;
  attention?: DriveAttention;
  shrinkApproved?: string;
  shrinkSkipped?: string;
  error?: { kind: DriveErrorKind; at: number };
}

export interface DriveToken {
  accessToken: string;
  expiresAt: number;
}

export interface DriveSession extends DriveToken {
  connectionId: string;
}

export async function readDriveRecord(): Promise<DriveRecord | null> {
  const stored = await chrome.storage.local.get<{
    [DRIVE_RECORD]?: DriveRecord;
  }>(DRIVE_RECORD);
  return stored[DRIVE_RECORD] ?? null;
}

export function writeDriveRecord(
  build: (current: DriveRecord | null) => DriveRecord | null,
) {
  return withStorageLock(async () => {
    const record = build(await readDriveRecord());
    if (record) {
      await chrome.storage.local.set({ [DRIVE_RECORD]: record });
    }
    return record;
  });
}

export function removeDriveRecord() {
  return withStorageLock(() => chrome.storage.local.remove(DRIVE_RECORD));
}

export function updateDriveRecord(
  change: (record: DriveRecord) => DriveRecord,
  connectionId?: string,
) {
  return withStorageLock(async () => {
    const record = await readDriveRecord();
    if (
      !record ||
      (connectionId !== undefined && record.connectionId !== connectionId)
    ) {
      return null;
    }
    const changed = change({ ...record });
    await chrome.storage.local.set({ [DRIVE_RECORD]: changed });
    return changed;
  });
}

export async function readDriveSession(): Promise<DriveSession | null> {
  const stored = await chrome.storage.session.get<{
    [DRIVE_SESSION]?: DriveSession;
  }>(DRIVE_SESSION);
  return stored[DRIVE_SESSION] ?? null;
}

export async function writeDriveSession(session: DriveSession | null) {
  if (session) {
    await chrome.storage.session.set({ [DRIVE_SESSION]: session });
  } else {
    await chrome.storage.session.remove(DRIVE_SESSION);
  }
}
