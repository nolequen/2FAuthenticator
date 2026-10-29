import { i18n, t } from "../store/i18n";
import { formatMoment } from "./display";
import type { DriveAttention, DriveErrorKind, DriveRecord } from "./state";
import type { BackupResult } from "./upload";

export function attentionText(attention: DriveAttention) {
  switch (attention.kind) {
    case "signin":
      return i18n.drive_status_signin;
    case "consent":
      return i18n.drive_status_consent;
    case "backupPassword":
      return i18n.drive_status_backup_password;
    case "unlock":
      return i18n.drive_status_unlock;
    case "shrink":
      return i18n.drive_status_shrink;
  }
}

export function errorText(
  error: DriveErrorKind | "signin" | "disconnected" | "unavailable",
) {
  switch (error) {
    case "quota":
      return i18n.drive_error_quota;
    case "signin":
      return i18n.drive_error_signin;
    case "disconnected":
      return i18n.updateFailure;
    case "unavailable":
      return i18n.drive_unavailable;
    default:
      return i18n.drive_error_network;
  }
}

export function statusText(record: DriveRecord, pending: boolean) {
  if (record.attention) {
    return attentionText(record.attention);
  }
  if (record.error) {
    return record.error.kind === "quota"
      ? i18n.drive_status_quota
      : i18n.drive_status_network;
  }
  if (pending) {
    return i18n.drive_status_pending;
  }
  if (record.lastUpload) {
    return t("drive_status_last", formatMoment(record.lastUpload.at));
  }
  return i18n.drive_status_none;
}

export function resultText(result: BackupResult | undefined) {
  switch (result?.status) {
    case "uploaded":
      return i18n.drive_saved;
    case "unchanged":
      return i18n.drive_up_to_date;
    case "empty":
      return i18n.drive_nothing_to_save;
    case "busy":
      return i18n.drive_status_pending;
    case "unavailable":
      return i18n.drive_unavailable;
    case "attention":
      return attentionText(result.attention);
    case "error":
      return errorText(result.error);
    default:
      return i18n.updateFailure;
  }
}
