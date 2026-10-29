import { driveAvailable, revokeAccess } from "./auth";
import {
  BACKUP_DELAY_MINUTES,
  DRIVE_ALARM,
  DRIVE_CHECK_ALARM,
  DRIVE_RECORD,
} from "./config";
import { readStorageLocation } from "./copy";
import {
  type DriveErrorKind,
  readDriveRecord,
  removeDriveRecord,
  updateDriveRecord,
  writeDriveSession,
} from "./state";
import {
  type BackupResult,
  driveApi,
  errorKind,
  findFolder,
  runBackup,
  scheduleBackup,
  sortCopies,
} from "./upload";

export type DriveMessage =
  | { action: "drive.backupNow" }
  | { action: "drive.shrink"; decision: "save" | "skip" }
  | { action: "drive.list" }
  | { action: "drive.download"; id: string }
  | { action: "drive.disconnect" };

export type DriveFailure =
  DriveErrorKind | "signin" | "disconnected" | "unavailable";

export interface DriveCopyInfo {
  id: string;
  name: string;
  modifiedTime: string;
  browser: string;
  day: string;
  accounts: number;
}

export type DriveListResponse =
  { files: DriveCopyInfo[] } | { error: DriveFailure };

export type DriveDownloadResponse = { text: string } | { error: DriveFailure };

export function isDriveMessage(message: unknown): message is DriveMessage {
  return (
    !!message &&
    typeof message === "object" &&
    typeof (message as { action?: unknown }).action === "string" &&
    (message as { action: string }).action.startsWith("drive.")
  );
}

async function failed(error: unknown, connectionId: string) {
  const kind = errorKind(error);
  if (kind === "signin") {
    await updateDriveRecord(
      (changed) => ({ ...changed, attention: { kind: "signin" } }),
      connectionId,
    );
  }
  return { error: kind };
}

async function listCopies(): Promise<DriveListResponse> {
  const record = await readDriveRecord();
  if (!record) {
    return { error: "disconnected" };
  }
  if (!driveAvailable(record.client)) {
    return { error: "unavailable" };
  }
  try {
    const api = driveApi(record);
    const folderId = await findFolder(api, record);
    if (!folderId) {
      return { files: [] };
    }
    return {
      files: sortCopies(await api.listCopies(folderId)).map((file) => ({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime,
        browser: file.properties?.browser ?? "",
        day: file.properties?.day ?? "",
        accounts: Number(file.properties?.accounts) || 0,
      })),
    };
  } catch (error) {
    return await failed(error, record.connectionId);
  }
}

async function downloadCopy(id: string): Promise<DriveDownloadResponse> {
  const record = await readDriveRecord();
  if (!record) {
    return { error: "disconnected" };
  }
  if (!driveAvailable(record.client)) {
    return { error: "unavailable" };
  }
  try {
    return { text: await driveApi(record).download(id) };
  } catch (error) {
    return await failed(error, record.connectionId);
  }
}

async function decideShrink(save: boolean): Promise<BackupResult> {
  const record = await updateDriveRecord((changed) => {
    if (changed.attention?.kind === "shrink") {
      if (save) {
        changed.shrinkApproved = changed.attention.sourceHash;
      } else {
        changed.shrinkSkipped = changed.attention.sourceHash;
        delete changed.error;
      }
      delete changed.attention;
    }
    return changed;
  });
  if (!record) {
    return { status: "disconnected" };
  }
  return save ? await runBackup(true) : { status: "unchanged" };
}

export async function disconnect() {
  await chrome.alarms.clear(DRIVE_ALARM);
  await chrome.alarms.clear(DRIVE_CHECK_ALARM);
  const record = await readDriveRecord();
  if (record) {
    await revokeAccess(record);
  }
  await removeDriveRecord();
  await writeDriveSession(null);
}

export async function handleDriveMessage(message: DriveMessage) {
  switch (message.action) {
    case "drive.backupNow":
      return await runBackup(true);
    case "drive.shrink":
      return await decideShrink(message.decision === "save");
    case "drive.list":
      return await listCopies();
    case "drive.download":
      return await downloadCopy(message.id);
    case "drive.disconnect":
      await disconnect();
      return {};
  }
}

export async function handleStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string,
) {
  if (
    !Object.keys(changes).some(
      (key) => key !== "UserSettings" && key !== DRIVE_RECORD,
    ) ||
    areaName !== (await readStorageLocation()) ||
    !(await readDriveRecord())
  ) {
    return;
  }
  await scheduleBackup();
}

export async function scheduleIfConnected() {
  if (await readDriveRecord()) {
    await chrome.alarms.create(DRIVE_CHECK_ALARM, {
      delayInMinutes: BACKUP_DELAY_MINUTES,
    });
  }
}

export async function backupAfterUnlock() {
  const record = await readDriveRecord();
  if (record?.attention?.kind === "unlock") {
    await runBackup();
  }
}
