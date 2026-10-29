import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createKey } from "../models/password";
import { driveAvailable } from "../drive/auth";
import type {
  DriveDownloadResponse,
  DriveListResponse,
  DriveMessage,
} from "../drive/background";
import { BACKUP_DELAY_MINUTES, DRIVE_ALARM } from "../drive/config";
import {
  type DriveRecord,
  readDriveRecord,
  updateDriveRecord,
} from "../drive/state";
import type { BackupResult } from "../drive/upload";

export type DriveTabMode = "signin" | "consent";

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
    return chrome.tabs.create({
      url: chrome.runtime.getURL(`view/drive.html${mode ? `?${mode}` : ""}`),
    });
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
    setBackupPassword,
    openTab,
  };
});
