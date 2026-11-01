import { isEdge, isFirefox } from "../browser";
import { driveClient } from "./auth";
import type { DriveBrowser, DriveRecord } from "./state";

export function driveBrowser(): DriveBrowser {
  return isFirefox ? "firefox" : isEdge ? "edge" : "chrome";
}

export function sameAccount(
  previous: DriveRecord | null,
  address: string | undefined,
) {
  return (
    !!previous && (!address || !previous.email || previous.email === address)
  );
}

export function connectedRecord(
  previous: DriveRecord | null,
  address: string | undefined,
  refreshToken: string | undefined,
  mirror = false,
): DriveRecord {
  const same = sameAccount(previous, address);
  const record: DriveRecord = {
    ...(previous ?? {}),
    connectionId: crypto.randomUUID(),
    client: driveClient(),
    browser: driveBrowser(),
  };
  delete record.attention;
  delete record.error;
  if (!same) {
    delete record.folderId;
    delete record.lastUpload;
    delete record.skipped;
    delete record.shrinkApproved;
    delete record.shrinkSkipped;
  }
  if (mirror) {
    record.mirror = same && previous?.mirror ? previous.mirror : { keys: {} };
  }
  const accountEmail = address ?? (same ? previous?.email : undefined);
  if (accountEmail) {
    record.email = accountEmail;
  } else {
    delete record.email;
  }
  if (refreshToken) {
    record.refreshToken = refreshToken;
  } else {
    delete record.refreshToken;
  }
  return record;
}
