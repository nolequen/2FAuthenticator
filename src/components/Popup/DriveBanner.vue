<template>
  <div class="reminder" role="status">
    <div class="reminder-body">
      <IconCloudOff v-if="attention.kind === 'signin'" />
      <IconCloudAlert v-else />
      <div>
        <div class="reminder-title">{{ content.title }}</div>
        <div class="reminder-text">{{ content.text }}</div>
      </div>
    </div>
    <div v-if="content.action" class="reminder-actions">
      <button type="button" class="reminder-primary" @click="act()">
        {{ content.action }}
      </button>
      <button
        v-if="attention.kind === 'shrink'"
        type="button"
        class="reminder-secondary"
        @click="skip()"
      >
        {{ i18n.drive_dont_save }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { DriveAttention } from "../../drive/state";
import { resultText } from "../../drive/status";
import { i18n, t } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";

import IconCloudAlert from "lucide-static/icons/cloud-alert.svg";
import IconCloudOff from "lucide-static/icons/cloud-off.svg";

const props = defineProps<{ attention: DriveAttention }>();

const currentView = useCurrentViewStore();
const drive = useDriveStore();
const notification = useNotificationStore();

const content = computed(() => bannerContent(props.attention));

function bannerContent(attention: DriveAttention) {
  switch (attention.kind) {
    case "signin":
      return {
        title: i18n.drive_banner_signin_title,
        text: i18n.drive_banner_signin_text,
        action: i18n.drive_signin,
      };
    case "consent":
      return {
        title: i18n.drive_banner_consent_title,
        text: i18n.drive_banner_consent_text,
        action: i18n.drive_allow,
      };
    case "backupPassword":
      return {
        title: i18n.drive_banner_password_title,
        text: i18n.drive_banner_password_text,
        action: i18n.drive_set,
      };
    case "unlock":
      return {
        title: i18n.drive_banner_unlock_title,
        text: i18n.drive_banner_unlock_text,
        action: "",
      };
    case "shrink":
      return {
        title: i18n.drive_banner_shrink_title,
        text: t(
          "drive_banner_shrink_text",
          String(attention.from),
          String(attention.to),
        ),
        action: i18n.save,
      };
  }
}

async function act() {
  switch (props.attention.kind) {
    case "signin":
      await drive.openTab("signin");
      break;
    case "consent":
      await drive.openTab("consent");
      break;
    case "backupPassword":
      currentView.open("BackupPassword");
      break;
    case "shrink": {
      const result = await currentView.withBusy(() => drive.decideShrink(true));
      if (result?.status === "uploaded") {
        notification.ephermalMessage(resultText(result));
      } else if (result?.status !== "unchanged") {
        notification.alert(resultText(result));
      }
      break;
    }
  }
}

async function skip() {
  await drive.decideShrink(false);
}
</script>
