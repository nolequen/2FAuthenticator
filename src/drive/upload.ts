import { today } from "../models/settings";
import { DriveApi, DriveApiError, type DriveFile } from "./api";
import {
  DriveAuthError,
  driveAvailable,
  getAccessToken,
  hasDataCollection,
} from "./auth";
import {
  APP_PROPERTY,
  BACKUP_DELAY_MINUTES,
  DRIVE_ALARM,
  DRIVE_BACKUP_LOCK,
  DRIVE_CHECK_ALARM,
  FILE_PREFIX,
  KEPT_COPIES,
  RETRY_DELAY_MINUTES,
} from "./config";
import { buildCopy, takeSnapshot } from "./copy";
import {
  type DriveAttention,
  type DriveBrowser,
  type DriveErrorKind,
  type DriveRecord,
  readDriveRecord,
  updateDriveRecord,
} from "./state";

export type BackupResult =
  | { status: "uploaded" }
  | { status: "unchanged" }
  | { status: "empty" }
  | { status: "busy" }
  | { status: "disconnected" }
  | { status: "unavailable" }
  | { status: "attention"; attention: DriveAttention }
  | { status: "error"; error: DriveErrorKind };

let running: { result: Promise<BackupResult>; force: boolean } | null = null;

export function localDay(time = Date.now()) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function copyName(browser: DriveBrowser, day: string) {
  return `${FILE_PREFIX}-${browser}-${day}.json`;
}

export function sortCopies(files: DriveFile[]) {
  return [...files].sort(
    (a, b) =>
      (b.properties?.day ?? "").localeCompare(a.properties?.day ?? "") ||
      b.modifiedTime.localeCompare(a.modifiedTime),
  );
}

export function filesToTrash(files: DriveFile[], browser: DriveBrowser) {
  return sortCopies(
    files.filter(
      (file) =>
        file.properties?.app === APP_PROPERTY &&
        file.properties?.browser === browser,
    ),
  ).slice(KEPT_COPIES);
}

export function scheduleBackup() {
  return chrome.alarms.create(DRIVE_ALARM, {
    delayInMinutes: BACKUP_DELAY_MINUTES,
  });
}

export function driveApi(record: DriveRecord) {
  return new DriveApi((rejected) => getAccessToken(record, rejected));
}

export async function findFolder(api: DriveApi, record: DriveRecord) {
  if (record.folderId && (await api.folderExists(record.folderId))) {
    return record.folderId;
  }
  const folderId = await api.findFolder();
  if (folderId) {
    await updateDriveRecord(
      (changed) => ({ ...changed, folderId }),
      record.connectionId,
    );
  }
  return folderId;
}

async function ensureFolder(api: DriveApi, record: DriveRecord) {
  const found = await findFolder(api, record);
  if (found) {
    return found;
  }
  const folderId = await api.createFolder();
  await updateDriveRecord(
    (changed) => ({ ...changed, folderId }),
    record.connectionId,
  );
  return folderId;
}

export function errorKind(error: unknown): DriveErrorKind | "signin" {
  if (error instanceof DriveAuthError) {
    return error.reason === "network" ? "network" : "signin";
  }
  if (error instanceof DriveApiError) {
    if (error.quota) {
      return "quota";
    }
    if (error.status === 401 || error.reason === "insufficientPermissions") {
      return "signin";
    }
    return "network";
  }
  console.error(error);
  return "network";
}

async function requireAttention(
  connectionId: string,
  attention: DriveAttention,
): Promise<BackupResult> {
  await updateDriveRecord(
    (changed) => ({ ...changed, attention }),
    connectionId,
  );
  return { status: "attention", attention };
}

async function fail(
  connectionId: string,
  kind: DriveErrorKind,
): Promise<BackupResult> {
  await updateDriveRecord((changed) => {
    changed.error = { kind, at: Date.now() };
    if (changed.attention?.kind !== "shrink") {
      delete changed.attention;
    }
    return changed;
  }, connectionId);
  await chrome.alarms.create(DRIVE_CHECK_ALARM, {
    delayInMinutes: RETRY_DELAY_MINUTES,
  });
  return { status: "error", error: kind };
}

async function backup(force: boolean): Promise<BackupResult> {
  const record = await readDriveRecord();
  if (!record) {
    return { status: "disconnected" };
  }
  const { connectionId, browser } = record;
  if (!driveAvailable(record.client)) {
    return { status: "unavailable" };
  }

  try {
    if (!(await hasDataCollection(record.client))) {
      return await requireAttention(connectionId, { kind: "consent" });
    }

    const snapshot = await takeSnapshot();
    const copy = snapshot ? await buildCopy(snapshot, record.backupKey) : null;
    if (!copy || copy.kind === "empty") {
      await updateDriveRecord((changed) => {
        delete changed.error;
        changed.skipped = copy?.skipped ?? 0;
        return changed;
      }, connectionId);
      return { status: "empty" };
    }
    if (copy.kind === "attention") {
      return await requireAttention(connectionId, { kind: copy.attention });
    }
    if (copy.mode === "password" && record.backupKey) {
      await updateDriveRecord((changed) => {
        delete changed.backupKey;
        changed.backupKeyRetiredDay = today();
        return changed;
      }, connectionId);
    }
    if (
      !force &&
      (copy.sourceHash === record.lastUpload?.sourceHash ||
        copy.sourceHash === record.shrinkSkipped)
    ) {
      await updateDriveRecord((changed) => {
        delete changed.error;
        if (changed.attention?.kind !== "signin") {
          delete changed.attention;
        }
        changed.skipped = copy.skipped;
        return changed;
      }, connectionId);
      return { status: "unchanged" };
    }

    const api = driveApi(record);
    const folderId = await ensureFolder(api, record);
    const files = await api.listCopies(folderId);
    const day = localDay();
    const name = copyName(browser, day);
    const todays = files.find(
      (file) => file.name === name && file.properties?.browser === browser,
    );
    const previous = Math.max(
      record.lastUpload?.accounts ?? 0,
      Number(todays?.properties?.accounts) || 0,
    );
    if (
      copy.accounts * 2 < previous &&
      record.shrinkApproved !== copy.sourceHash
    ) {
      return await requireAttention(connectionId, {
        kind: "shrink",
        from: previous,
        to: copy.accounts,
        sourceHash: copy.sourceHash,
      });
    }

    const properties = { browser, day, accounts: copy.accounts };
    const fileId = await api.upload(
      folderId,
      name,
      copy.content,
      properties,
      todays?.id,
    );
    await updateDriveRecord((changed) => {
      changed.lastUpload = {
        day: today(),
        at: Date.now(),
        fileId,
        sourceHash: copy.sourceHash,
        accounts: copy.accounts,
      };
      changed.skipped = copy.skipped;
      delete changed.error;
      delete changed.attention;
      delete changed.shrinkApproved;
      delete changed.shrinkSkipped;
      return changed;
    }, connectionId);

    const uploaded: DriveFile = {
      id: fileId,
      name,
      modifiedTime: new Date().toISOString(),
      properties: {
        app: APP_PROPERTY,
        browser,
        day,
        accounts: String(copy.accounts),
      },
    };
    for (const file of filesToTrash(
      [...files.filter((file) => file.id !== fileId), uploaded],
      browser,
    )) {
      await api
        .trash(file.id)
        .catch((error) =>
          console.warn("Could not move an old copy to the trash.", error),
        );
    }
    return { status: "uploaded" };
  } catch (error) {
    const kind = errorKind(error);
    return kind === "signin"
      ? await requireAttention(connectionId, { kind: "signin" })
      : await fail(connectionId, kind);
  }
}

async function postpone(): Promise<BackupResult> {
  await scheduleBackup();
  return { status: "busy" };
}

async function backupUnderLock(force: boolean): Promise<BackupResult> {
  try {
    return await navigator.locks.request(
      DRIVE_BACKUP_LOCK,
      { ifAvailable: true },
      (lock) => (lock ? backup(force) : postpone()),
    );
  } finally {
    running = null;
  }
}

export function runBackup(force = false): Promise<BackupResult> {
  if (running) {
    if (!force) {
      return postpone();
    }
    if (running.force) {
      return running.result;
    }
    const again = () => runBackup(true);
    return running.result.then(again, again);
  }
  const result = backupUnderLock(force);
  running = { result, force };
  return result;
}
