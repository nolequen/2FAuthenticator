import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { openTab as openExtensionTab } from "../android";
import { createKey } from "../models/password";
import { driveAvailable } from "../drive/auth";
import type {
  DriveDownloadResponse,
  DriveFailure,
  DriveListResponse,
  DriveMessage,
  SignOutResponse,
} from "../drive/background";
import {
  BACKUP_DELAY_MINUTES,
  DRIVE_ALARM,
  DRIVE_MIRROR_LOCK,
} from "../drive/config";
import {
  type Backup,
  type DriveCopyInfo,
  type MirrorResult,
  copySources,
  knownKeys,
  parseCopy,
} from "../drive/mirror";
import {
  type DriveBrowser,
  type DriveRecord,
  isMirror,
  readDriveRecord,
  updateDriveRecord,
} from "../drive/state";
import type { BackupResult } from "../drive/upload";
import { decryptBackup, unknownKeyIds } from "../models/backup";
import { EntryStorage } from "../models/storage";

export type DriveTabMode = "signin" | "consent";

export type MirrorSourcesResponse =
  { sources: DriveCopyInfo[] } | { error: DriveFailure };

export type MirrorCopyResponse =
  { copy: Backup; unknown: string[] } | { error: DriveFailure | "invalid" };

export type MirrorUnlockResult =
  | { status: "done"; undecrypted: number }
  | { status: "wrongPassword" }
  | { status: "disconnected" };

export const useDriveStore = defineStore("drive", () => {
  const record = ref<DriveRecord | null>(null);
  const pending = ref(false);
  const loaded = ref(false);
  const available = ref(driveAvailable());
  let listening = false;

  const connected = computed(() => record.value !== null);
  const attention = computed(() => record.value?.attention ?? null);

  async function refresh() {
    record.value = await readDriveRecord();
    const alarm = await chrome.alarms.get(DRIVE_ALARM);
    pending.value =
      !!alarm &&
      (record.value?.lastUpload?.at ?? 0) <
        alarm.scheduledTime - BACKUP_DELAY_MINUTES * 60 * 1000;
    loaded.value = true;
  }

  async function init() {
    await refresh();
    if (!listening) {
      listening = true;
      chrome.storage.onChanged.addListener(() => {
        refresh().catch((error) => console.warn(error));
      });
    }
  }

  function send<T>(message: DriveMessage) {
    return chrome.runtime.sendMessage(message) as Promise<T | undefined>;
  }

  function backupNow() {
    return send<BackupResult>({ action: "drive.backupNow" });
  }

  function decideShrink(save: boolean) {
    return send<BackupResult>({
      action: "drive.shrink",
      decision: save ? "save" : "skip",
    });
  }

  function listCopies() {
    return send<DriveListResponse>({ action: "drive.list" });
  }

  function download(id: string) {
    return send<DriveDownloadResponse>({ action: "drive.download", id });
  }

  async function disconnect() {
    await send<object>({ action: "drive.disconnect" });
    await refresh();
  }

  async function signOutEverywhere() {
    const result = await send<SignOutResponse>({
      action: "drive.signOutEverywhere",
    }).catch(() => undefined);
    await refresh();
    return result?.status === "done";
  }

  function mirrorCheck(force: boolean) {
    return send<MirrorResult>({ action: "drive.mirrorCheck", force });
  }

  function mirrorShrink(apply: boolean) {
    return send<MirrorResult>({
      action: "drive.mirrorShrink",
      decision: apply ? "apply" : "keep",
    });
  }

  async function mirrorSources(): Promise<MirrorSourcesResponse> {
    const listed = await listCopies().catch(() => undefined);
    if (!listed || "error" in listed) {
      return { error: listed?.error ?? "network" };
    }
    return { sources: copySources(listed.files) };
  }

  async function mirrorKeys() {
    const current = await readDriveRecord();
    return knownKeys(isMirror(current) ? current.mirror.keys : {});
  }

  async function mirrorCopy(fileId: string): Promise<MirrorCopyResponse> {
    const downloaded = await download(fileId).catch(() => undefined);
    if (!downloaded || "error" in downloaded) {
      return { error: downloaded?.error ?? "network" };
    }
    const copy = parseCopy(downloaded.text);
    if (!copy) {
      return { error: "invalid" };
    }
    return { copy, unknown: unknownKeyIds(copy, await mirrorKeys()) };
  }

  async function unlockMirror(
    copy: Backup,
    password: string | null,
    options: { source?: DriveBrowser; replace?: boolean } = {},
  ): Promise<MirrorUnlockResult> {
    const known = await mirrorKeys();
    const unknown = unknownKeyIds(copy, known);
    const decrypted = await decryptBackup(
      copy,
      unknown.length ? password : null,
      known,
    );
    const unlocked = decrypted.unlocked;
    if (unknown.length && !Object.keys(unlocked).length) {
      return { status: "wrongPassword" };
    }
    const skippedKeys = unknown.filter((keyId) => !(keyId in unlocked));

    const changed = await navigator.locks.request(
      DRIVE_MIRROR_LOCK,
      async () => {
        const current = await readDriveRecord();
        if (!isMirror(current)) {
          return null;
        }
        if (options.replace) {
          await EntryStorage.clearAll();
        }
        return await updateDriveRecord((next) => {
          if (!next.mirror) {
            return next;
          }
          next.mirror.keys = { ...next.mirror.keys, ...unlocked };
          next.mirror.skippedKeys = skippedKeys;
          if (options.source) {
            next.mirror.source = options.source;
            delete next.mirror.applied;
            delete next.mirror.kept;
            delete next.mirror.shrinkApproved;
          }
          if (
            next.attention?.kind === "mirrorPassword" ||
            next.attention?.kind === "mirrorShrink"
          ) {
            delete next.attention;
          }
          return next;
        }, current.connectionId);
      },
    );
    if (!changed) {
      return { status: "disconnected" };
    }
    record.value = changed;
    return { status: "done", undecrypted: decrypted.failed };
  }

  async function setBackupPassword(password: string) {
    const { key, passphrase } = await createKey(password);
    const changed = await updateDriveRecord((current) => ({
      ...current,
      backupKey: { key, passphrase },
    }));
    if (changed) {
      record.value = changed;
    }
    return changed !== null;
  }

  function openTab(mode?: DriveTabMode) {
    return openExtensionTab(
      chrome.runtime.getURL(`view/drive.html${mode ? `?${mode}` : ""}`),
    );
  }

  return {
    record,
    pending,
    loaded,
    available,
    connected,
    attention,
    refresh,
    init,
    backupNow,
    decideShrink,
    listCopies,
    download,
    disconnect,
    signOutEverywhere,
    mirrorCheck,
    mirrorShrink,
    mirrorSources,
    mirrorCopy,
    unlockMirror,
    setBackupPassword,
    openTab,
  };
});
