<template>
  <div>
    <a-page-header :title="i18n.drive_copies" @back="currentView.back()" />
    <div class="page-body">
      <p class="drive-note">
        {{ folderInfo }}
      </p>
      <div v-if="loading" class="drive-loading" role="status">
        <div class="spinner" :aria-label="i18n.loading"></div>
      </div>
      <div v-else-if="error" class="notice warning">
        <IconTriangle />
        <span>{{ error }}</span>
      </div>
      <p v-else-if="!copies.length" class="drive-note">
        {{ i18n.drive_copies_empty }}
      </p>
      <button
        v-for="(copy, index) in copies"
        :key="copy.id"
        type="button"
        class="option drive-copy"
        @click="choose(copy)"
      >
        <span :class="['drive-copy-icon', { latest: index === 0 }]">
          <IconFile />
        </span>
        <span class="row-text">
          <span class="option-title">{{ title(copy) }}</span>
          <span class="row-subtitle">{{ meta(copy) }}</span>
        </span>
        <IconChevronRight class="row-trail" />
      </button>
      <p v-if="copies.length" class="drive-note">
        {{ i18n.drive_copies_kept }}
      </p>
    </div>
    <div
      v-if="selected"
      class="dialog-backdrop"
      @keydown.esc="cancel()"
      @click.self="cancel()"
    >
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
        @submit.prevent="submit()"
      >
        <h2 id="restore-title" class="dialog-title">
          {{ t("drive_restore_title", selectedDate) }}
        </h2>
        <p class="dialog-text">{{ i18n.drive_restore_info }}</p>
        <a-text-input
          v-model="password"
          type="password"
          :label="i18n.drive_copy_password"
          :error="passwordError"
          autofocus
        />
        <div class="buttons">
          <button type="button" class="button secondary" @click="cancel()">
            {{ i18n.cancel }}
          </button>
          <button
            type="submit"
            class="button primary"
            :disabled="!password || restoring"
          >
            {{ i18n.drive_restore }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { DriveCopyInfo } from "../../drive/background";
import {
  accountsCount,
  browserName,
  copyTitle,
  dayTime,
  formatDate,
  formatTime,
} from "../../drive/display";
import { errorText } from "../../drive/status";
import { localDay } from "../../drive/upload";
import { decryptBackup, unknownKeyIds } from "../../models/backup";
import { Encryption } from "../../models/encryption";
import { importUnderSession } from "../../models/session";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";

import IconChevronRight from "lucide-static/icons/chevron-right.svg";
import IconFile from "lucide-static/icons/file.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

type Backup = { [hash: string]: OTPStorage | Key };

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const drive = useDriveStore();

const loading = ref(true);
const error = ref("");
const copies = ref<DriveCopyInfo[]>([]);
const selected = ref<{ copy: DriveCopyInfo; backup: Backup } | null>(null);
const password = ref("");
const passwordError = ref<string>();
const restoring = ref(false);

const folderInfo = computed(() =>
  [
    [i18n.drive_copies_folder, drive.record?.email]
      .filter(Boolean)
      .join(" · ") + ".",
    i18n.drive_copies_merge,
  ].join(" "),
);

const selectedDate = computed(() =>
  selected.value ? formatDate(dayTime(day(selected.value.copy))) : "",
);

onMounted(async () => {
  const response = await drive.listCopies();
  loading.value = false;
  if (!response || "error" in response) {
    error.value = errorText(response?.error ?? "network");
    return;
  }
  copies.value = response.files;
});

function day(copy: DriveCopyInfo) {
  return copy.day || localDay(Date.parse(copy.modifiedTime));
}

function title(copy: DriveCopyInfo) {
  return copyTitle(day(copy));
}

function meta(copy: DriveCopyInfo) {
  return [
    browserName(copy.browser),
    formatTime(Date.parse(copy.modifiedTime)),
    accountsCount(copy.accounts),
  ]
    .filter(Boolean)
    .join(" · ");
}

function knownKeys() {
  const known = new Map<string, EncryptionInterface>();
  for (const [keyId, encryption] of accounts.encryption) {
    if (encryption.getEncryptionStatus()) {
      known.set(keyId, encryption);
    }
  }
  const backupKey = drive.record?.backupKey;
  if (backupKey) {
    known.set(
      backupKey.key.id,
      new Encryption(backupKey.passphrase, backupKey.key.id),
    );
  }
  return known;
}

async function choose(copy: DriveCopyInfo) {
  const backup = await currentView.withBusy(async () => {
    const response = await drive.download(copy.id);
    if (!response || "error" in response) {
      notification.alert(errorText(response?.error ?? "network"));
      return null;
    }
    try {
      const parsed = JSON.parse(response.text);
      return parsed && typeof parsed === "object" ? (parsed as Backup) : null;
    } catch {
      notification.alert(i18n.migration_fail);
      return null;
    }
  });
  if (!backup) {
    return;
  }
  if (unknownKeyIds(backup, knownKeys()).length) {
    password.value = "";
    passwordError.value = undefined;
    selected.value = { copy, backup };
  } else {
    await restore(backup, null);
  }
}

function cancel() {
  selected.value = null;
}

async function submit() {
  if (selected.value && password.value) {
    await restore(selected.value.backup, password.value);
  }
}

async function restore(backup: Backup, passphrase: string | null) {
  restoring.value = true;
  try {
    const result = await currentView.withBusy(() =>
      decryptBackup(backup, passphrase, knownKeys()),
    );
    const restored = Object.keys(result.data).length;
    if (!restored && result.wrongPassword) {
      passwordError.value = i18n.drive_wrong_password;
      return;
    }
    if (!restored) {
      selected.value = null;
      notification.alert(
        result.missingKey ? i18n.drive_missing_key : i18n.migration_fail,
      );
      return;
    }
    const imported = await currentView.withBusy(() =>
      importUnderSession(result.data),
    );
    if (!imported) {
      notification.alert(i18n.drive_unlock_first);
      return;
    }
    selected.value = null;
    await accounts.updateEntries();
    currentView.close();
    notification.alert(
      result.failed
        ? t("drive_restore_partial", String(result.failed))
        : i18n.updateSuccess,
    );
  } catch (error) {
    console.error(error);
    notification.alert(i18n.updateFailure);
  } finally {
    restoring.value = false;
  }
}
</script>
