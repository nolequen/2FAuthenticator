<template>
  <h2 class="section-title">{{ i18n.drive_header }}</h2>
  <div v-if="!available" class="notice info">
    <IconInfo />
    <span>{{ i18n.drive_unavailable }}</span>
  </div>
  <button
    v-if="!record && available"
    type="button"
    class="option primary"
    @click="drive.openTab()"
  >
    <span class="option-icon"><IconCloud /></span>
    <span class="row-text">
      <span class="option-title">{{ i18n.drive_connect }}</span>
      <span class="row-subtitle">{{ i18n.mirror_connect_title }}</span>
    </span>
    <IconExternalLink class="option-trail" />
  </button>
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
          <span v-if="copyLine" class="row-subtitle">{{ copyLine }}</span>
        </span>
      </div>
      <div class="form-actions drive-actions">
        <a-button variant="primary" small @click="refresh()">
          {{ i18n.mirror_refresh }}
        </a-button>
        <a-button small @click="currentView.open('MirrorBrowser')">
          {{ i18n.mirror_change_browser }}
        </a-button>
      </div>
      <div class="drive-links">
        <a-button variant="danger-soft" small @click="disconnect()">
          {{ i18n.drive_disconnect }}
        </a-button>
        <a-button variant="danger-soft" small @click="signOutEverywhere()">
          {{ signOutLabel }}
        </a-button>
      </div>
    </section>
    <div v-if="record.mirror?.undecrypted" class="notice warning">
      <IconTriangle />
      <span>{{
        t("mirror_undecrypted", String(record.mirror.undecrypted))
      }}</span>
    </div>
    <p class="drive-note">{{ i18n.mirror_footer }}</p>
  </template>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { accountsCount, browserName, formatMoment } from "../../drive/display";
import { mirrorResultText, mirrorStatusText } from "../../drive/status";
import { i18n, t } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";
import { useDriveActions } from "./driveActions";

import IconCloud from "lucide-static/icons/cloud.svg";
import IconCloudCheck from "lucide-static/icons/cloud-check.svg";
import IconCloudAlert from "lucide-static/icons/cloud-alert.svg";
import IconExternalLink from "lucide-static/icons/external-link.svg";
import IconInfo from "lucide-static/icons/info.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

const drive = useDriveStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const { record, available } = storeToRefs(drive);
const { signOutLabel, disconnect, signOutEverywhere } = useDriveActions();

const state = computed(() => {
  if (!record.value) {
    return "neutral";
  }
  if (record.value.attention || record.value.error) {
    return "warn";
  }
  return record.value.mirror?.applied ? "ok" : "neutral";
});

const status = computed(() =>
  record.value ? mirrorStatusText(record.value) : "",
);

const copyLine = computed(() => {
  const mirror = record.value?.mirror;
  if (!mirror?.source) {
    return "";
  }
  const applied = mirror.applied;
  return [
    browserName(mirror.source),
    applied
      ? t("mirror_copy_time", formatMoment(Date.parse(applied.modifiedTime)))
      : "",
    applied ? accountsCount(applied.accounts) : "",
  ]
    .filter(Boolean)
    .join(" · ");
});

async function refresh() {
  const result = await currentView.withBusy(() => drive.mirrorCheck(true));
  const text = mirrorResultText(result);
  if (
    result?.status === "applied" ||
    result?.status === "unchanged" ||
    result?.status === "none" ||
    result?.status === "attention"
  ) {
    notification.ephermalMessage(text);
  } else {
    notification.alert(text);
  }
}
</script>
