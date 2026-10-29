<template>
  <h2 class="section-title">{{ i18n.drive_header }}</h2>
  <div v-if="!available" class="notice info">
    <IconInfo />
    <span>{{ i18n.drive_unavailable }}</span>
  </div>
  <template v-if="!record && available">
    <button type="button" class="option primary" @click="drive.openTab()">
      <span class="option-icon"><IconCloud /></span>
      <span class="row-text">
        <span class="option-title">{{ i18n.drive_connect }}</span>
        <span class="row-subtitle">{{ i18n.drive_connect_info }}</span>
      </span>
      <IconExternalLink class="option-trail" />
    </button>
    <p class="drive-note">{{ i18n.drive_about }}</p>
  </template>
  <template v-else-if="record">
    <section class="panel padded drive-panel" :aria-label="i18n.drive_header">
      <div class="drive-account">
        <span :class="['option-icon', 'drive-state', state]">
          <IconCloudCheck v-if="state === 'ok'" />
          <IconCloudAlert v-else-if="state === 'warn'" />
          <IconCloud v-else />
        </span>
        <span class="row-text">
          <span class="option-title drive-email">{{
            record.email || i18n.drive_header
          }}</span>
          <span :class="['row-subtitle', 'drive-status', state]">{{
            status
          }}</span>
        </span>
      </div>
      <div class="form-actions drive-actions">
        <a-button variant="primary" small @click="saveNow()">
          {{ i18n.drive_save_now }}
        </a-button>
        <a-button small @click="currentView.open('DriveCopies')">
          {{ i18n.drive_restore }}
        </a-button>
      </div>
      <div class="drive-links">
        <button
          v-if="!defaultEncryption"
          type="button"
          class="drive-link"
          @click="currentView.open('BackupPassword')"
        >
          <IconKeyRound />
          {{
            record.backupKey
              ? i18n.drive_change_backup_password
              : i18n.drive_set_backup_password
          }}
        </button>
        <a-button variant="danger-soft" small @click="disconnect()">
          {{ i18n.drive_disconnect }}
        </a-button>
      </div>
    </section>
    <div v-if="retiredDate" class="notice info">
      <IconInfo />
      <span>{{ t("drive_retired", retiredDate) }}</span>
    </div>
    <div v-if="record.skipped" class="notice warning">
      <IconTriangle />
      <span>{{ t("drive_skipped", String(record.skipped)) }}</span>
    </div>
    <p class="drive-note">
      {{
        defaultEncryption
          ? i18n.drive_footer_password
          : i18n.drive_footer_backup
      }}
    </p>
  </template>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { RETIRED_KEY_NOTICE_DAYS } from "../../drive/config";
import { epochDayDate } from "../../drive/display";
import { resultText, statusText } from "../../drive/status";
import { today } from "../../models/settings";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";

import IconCloud from "lucide-static/icons/cloud.svg";
import IconCloudCheck from "lucide-static/icons/cloud-check.svg";
import IconCloudAlert from "lucide-static/icons/cloud-alert.svg";
import IconExternalLink from "lucide-static/icons/external-link.svg";
import IconInfo from "lucide-static/icons/info.svg";
import IconKeyRound from "lucide-static/icons/key-round.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

const drive = useDriveStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const { record, pending, available } = storeToRefs(drive);
const { defaultEncryption } = storeToRefs(useAccountsStore());

const state = computed(() => {
  if (!record.value) {
    return "neutral";
  }
  if (record.value.attention || record.value.error) {
    return "warn";
  }
  return record.value.lastUpload && !pending.value ? "ok" : "neutral";
});

const status = computed(() =>
  record.value ? statusText(record.value, pending.value) : "",
);

const retiredDate = computed(() => {
  const day = record.value?.backupKeyRetiredDay;
  return day !== undefined && today() - day < RETIRED_KEY_NOTICE_DAYS
    ? epochDayDate(day)
    : "";
});

async function saveNow() {
  const result = await currentView.withBusy(() => drive.backupNow());
  if (
    result?.status === "uploaded" ||
    result?.status === "unchanged" ||
    result?.status === "empty"
  ) {
    notification.ephermalMessage(resultText(result));
  } else {
    notification.alert(resultText(result));
  }
}

async function disconnect() {
  if (
    await notification.confirm({
      title: i18n.drive_disconnect_title,
      message: i18n.drive_disconnect_text,
      confirm: i18n.drive_disconnect,
      danger: true,
    })
  ) {
    await currentView.withBusy(() => drive.disconnect());
  }
}
</script>
