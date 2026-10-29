import {
  DRIVE_ALARM,
  DRIVE_CHECK_ALARM,
  DRIVE_RECORD,
  DRIVE_SESSION,
} from "../drive/config";
import type { DriveRecord } from "../drive/state";

export const CONNECTION_ID = "connection";

export function driveRecord(fields: Partial<DriveRecord> = {}): DriveRecord {
  return {
    connectionId: CONNECTION_ID,
    client: "web",
    browser: "chrome",
    ...fields,
  };
}

export async function storeDriveRecord(record = driveRecord()) {
  await chrome.storage.local.set({ [DRIVE_RECORD]: record });
  return record;
}

export async function storedDriveRecord() {
  return (
    await chrome.storage.local.get<{ [DRIVE_RECORD]?: DriveRecord }>(
      DRIVE_RECORD,
    )
  )[DRIVE_RECORD];
}

export async function resetDrive() {
  await chrome.storage.local.remove(DRIVE_RECORD);
  await chrome.storage.session.remove(DRIVE_SESSION);
  await chrome.alarms.clear(DRIVE_ALARM);
  await chrome.alarms.clear(DRIVE_CHECK_ALARM);
}
