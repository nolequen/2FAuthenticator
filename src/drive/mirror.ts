import { decryptBackup, unknownKeyIds } from "../models/backup";
import { Encryption } from "../models/encryption";
import { EntryStorage } from "../models/storage";
import type { DriveFile } from "./api";
import { driveAvailable } from "./auth";
import {
  DRIVE_MIRROR_ALARM,
  DRIVE_MIRROR_LOCK,
  MIRROR_CHECK_INTERVAL,
  MIRROR_PERIOD_MINUTES,
  MIRROR_TIMEOUT,
} from "./config";
import {
  type DriveAttention,
  type DriveBrowser,
  type DriveErrorKind,
  type DriveRecord,
  isMirror,
  readDriveRecord,
  updateDriveRecord,
} from "./state";
import { driveApi, errorKind, findFolder } from "./upload";

export type Backup = { [hash: string]: OTPStorage | Key };

export interface DriveCopyInfo {
  id: string;
  name: string;
  modifiedTime: string;
  browser: string;
  day: string;
  accounts: number;
}

export type MirrorResult =
  | { status: "applied" }
  | { status: "unchanged" }
  | { status: "none" }
  | { status: "disconnected" }
  | { status: "unavailable" }
  | { status: "attention"; attention: DriveAttention }
  | { status: "error"; error: DriveErrorKind };

let current: Promise<MirrorResult> | null = null;
let queued: Promise<MirrorResult> | null = null;

export function copyInfo(file: DriveFile): DriveCopyInfo {
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    browser: file.properties?.browser ?? "",
    day: file.properties?.day ?? "",
    accounts: Number(file.properties?.accounts) || 0,
  };
}

export function latestCopy(files: DriveCopyInfo[], browser: string) {
  let latest: DriveCopyInfo | undefined;
  for (const file of files) {
    if (
      file.browser === browser &&
      (!latest || file.modifiedTime > latest.modifiedTime)
    ) {
      latest = file;
    }
  }
  return latest;
}

export function copySources(files: DriveCopyInfo[]) {
  const sources: DriveCopyInfo[] = [];
  for (const browser of new Set(files.map((file) => file.browser))) {
    const latest = browser ? latestCopy(files, browser) : undefined;
    if (latest) {
      sources.push(latest);
    }
  }
  return sources.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}

export function knownKeys(keys: { [keyId: string]: string }) {
  const known = new Map<string, EncryptionInterface>();
  for (const [keyId, passphrase] of Object.entries(keys)) {
    known.set(keyId, new Encryption(passphrase, keyId));
  }
  return known;
}

export function copyKeyIds(copy: Backup) {
  const keyIds = new Set<string>();
  for (const item of Object.values(copy)) {
    if (
      item &&
      typeof item === "object" &&
      item.dataType === "EncOTPStorage" &&
      typeof item.keyId === "string"
    ) {
      keyIds.add(item.keyId);
    }
  }
  return keyIds;
}

export function parseCopy(text: string) {
  try {
    const copy = JSON.parse(text);
    return copy && typeof copy === "object" && !Array.isArray(copy)
      ? (copy as Backup)
      : null;
  } catch {
    return null;
  }
}

function pick(keys: { [keyId: string]: string }, keyIds: Set<string>) {
  const picked: { [keyId: string]: string } = {};
  for (const keyId of keyIds) {
    if (keys[keyId] !== undefined) {
      picked[keyId] = keys[keyId];
    }
  }
  return picked;
}

function mirrorAttention(record: DriveRecord) {
  const kind = record.attention?.kind;
  return kind === "mirrorPassword" || kind === "mirrorShrink";
}

async function requireAttention(
  connectionId: string,
  attention: DriveAttention,
): Promise<MirrorResult> {
  await updateDriveRecord((changed) => {
    changed.attention = attention;
    delete changed.error;
    return changed;
  }, connectionId);
  return { status: "attention", attention };
}

async function fail(
  connectionId: string,
  kind: DriveErrorKind,
): Promise<MirrorResult> {
  await updateDriveRecord((changed) => {
    changed.error = { kind, at: Date.now() };
    return changed;
  }, connectionId);
  return { status: "error", error: kind };
}

async function settle(connectionId: string, result: MirrorResult) {
  await updateDriveRecord((changed) => {
    delete changed.error;
    if (changed.attention?.kind === "signin") {
      delete changed.attention;
    }
    return changed;
  }, connectionId);
  return result;
}

function sameMirror(connectionId: string, source: DriveBrowser) {
  return async () => {
    const record = await readDriveRecord();
    return (
      isMirror(record) &&
      record.connectionId === connectionId &&
      record.mirror.source === source
    );
  };
}

export async function scheduleMirror() {
  if (!(await chrome.alarms.get(DRIVE_MIRROR_ALARM))) {
    await chrome.alarms.create(DRIVE_MIRROR_ALARM, {
      periodInMinutes: MIRROR_PERIOD_MINUTES,
    });
  }
}

async function mirror(force: boolean): Promise<MirrorResult> {
  const record = await readDriveRecord();
  if (!record) {
    return { status: "disconnected" };
  }
  if (!isMirror(record) || !driveAvailable(record.client)) {
    return { status: "unavailable" };
  }
  const { connectionId } = record;
  const { source, checkedAt } = record.mirror;
  if (!source) {
    return { status: "none" };
  }
  if (!force && checkedAt && Date.now() - checkedAt < MIRROR_CHECK_INTERVAL) {
    return { status: "unchanged" };
  }
  await updateDriveRecord((changed) => {
    if (changed.mirror) {
      changed.mirror.checkedAt = Date.now();
    }
    return changed;
  }, connectionId);

  try {
    const api = driveApi(record, MIRROR_TIMEOUT);
    const folderId = await findFolder(api, record);
    const files = folderId
      ? (await api.listCopies(folderId)).map(copyInfo)
      : [];
    const latest = latestCopy(files, source);
    if (!latest) {
      return await settle(connectionId, { status: "none" });
    }
    const { applied, kept } = record.mirror;
    if (
      [applied, kept].some(
        (seen) =>
          seen &&
          (latest.modifiedTime < seen.modifiedTime ||
            (latest.modifiedTime === seen.modifiedTime &&
              !mirrorAttention(record))),
      )
    ) {
      return await settle(connectionId, { status: "unchanged" });
    }
    if (!latest.accounts) {
      return await settle(connectionId, { status: "unchanged" });
    }

    const copy = parseCopy(await api.download(latest.id));
    if (!copy) {
      return await fail(connectionId, "network");
    }
    const known = knownKeys(record.mirror.keys);
    const skipped = record.mirror.skippedKeys ?? [];
    if (unknownKeyIds(copy, known).some((keyId) => !skipped.includes(keyId))) {
      return await requireAttention(connectionId, {
        kind: "mirrorPassword",
        fileId: latest.id,
      });
    }

    const decrypted = await decryptBackup(copy, null, known);
    const to = Object.keys(decrypted.data).length;
    const from = await EntryStorage.count();
    if (
      from > 0 &&
      to < from / 2 &&
      record.mirror.shrinkApproved !== latest.id
    ) {
      return await requireAttention(connectionId, {
        kind: "mirrorShrink",
        fileId: latest.id,
        modifiedTime: latest.modifiedTime,
        from,
        to,
      });
    }

    const keep = Object.keys(copy).filter(
      (hash) =>
        !(hash in decrypted.data) &&
        (copy[hash] as { dataType?: string } | null)?.dataType !== "Key",
    );
    const replaced = await EntryStorage.replaceAll(
      decrypted.data,
      keep,
      sameMirror(connectionId, source),
    );
    if (!replaced) {
      return { status: "unchanged" };
    }

    const keyIds = copyKeyIds(copy);
    await updateDriveRecord((changed) => {
      if (!changed.mirror) {
        return changed;
      }
      changed.mirror.applied = {
        fileId: latest.id,
        modifiedTime: latest.modifiedTime,
        accounts: latest.accounts,
        at: Date.now(),
      };
      changed.mirror.undecrypted = decrypted.failed;
      changed.mirror.keys = pick(changed.mirror.keys, keyIds);
      changed.mirror.skippedKeys = (changed.mirror.skippedKeys ?? []).filter(
        (keyId) => keyIds.has(keyId),
      );
      delete changed.mirror.kept;
      delete changed.mirror.shrinkApproved;
      delete changed.attention;
      delete changed.error;
      return changed;
    }, connectionId);
    await scheduleMirror();
    return { status: "applied" };
  } catch (error) {
    const kind = errorKind(error);
    return kind === "signin"
      ? await requireAttention(connectionId, { kind: "signin" })
      : await fail(connectionId, kind);
  }
}

async function mirrorUnderLock(force: boolean): Promise<MirrorResult> {
  return await navigator.locks.request(DRIVE_MIRROR_LOCK, () => mirror(force));
}

function start(force: boolean) {
  const result = mirrorUnderLock(force);
  current = result;
  result
    .finally(() => {
      if (current === result) {
        current = null;
      }
    })
    .catch(() => undefined);
  return result;
}

export function runMirror(force = false): Promise<MirrorResult> {
  if (!current) {
    return start(force);
  }
  if (!force) {
    return current;
  }
  if (!queued) {
    const again = () => {
      queued = null;
      return start(true);
    };
    queued = current.then(again, again);
  }
  return queued;
}

export async function decideMirrorShrink(
  apply: boolean,
): Promise<MirrorResult> {
  const record = await navigator.locks.request(DRIVE_MIRROR_LOCK, () =>
    updateDriveRecord((changed) => {
      const attention = changed.attention;
      if (changed.mirror && attention?.kind === "mirrorShrink") {
        if (apply) {
          changed.mirror.shrinkApproved = attention.fileId;
        } else {
          changed.mirror.kept = {
            fileId: attention.fileId,
            modifiedTime: attention.modifiedTime,
          };
        }
        delete changed.attention;
      }
      return changed;
    }),
  );
  if (!record) {
    return { status: "disconnected" };
  }
  if (!isMirror(record)) {
    return { status: "unavailable" };
  }
  return apply ? await runMirror(true) : { status: "unchanged" };
}
