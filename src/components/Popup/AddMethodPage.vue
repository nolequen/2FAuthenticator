<template>
  <div>
    <a-page-header :title="i18n.add_code" @back="currentView.back()" />
    <div class="page-body">
      <button type="button" class="option primary" @click="startCapture()">
        <span class="option-icon"><IconScan /></span>
        <span class="row-text">
          <span class="option-title">{{ i18n.add_qr }}</span>
          <span class="row-subtitle">{{ i18n.add_qr_info }}</span>
        </span>
      </button>
      <button type="button" class="option" @click="addManually()">
        <span class="option-icon"><IconKeyboard /></span>
        <span class="row-text">
          <span class="option-title">{{ i18n.add_secret }}</span>
          <span class="row-subtitle">{{ i18n.add_secret_info }}</span>
        </span>
        <IconChevronRight class="row-trail" />
      </button>
      <h2 class="section-title">{{ i18n.import_header }}</h2>
      <div class="panel">
        <a
          v-for="item in imports"
          :key="item.type"
          class="row"
          :href="`import.html?${item.type}`"
          target="_blank"
        >
          <span class="row-text">
            <span class="row-title">{{ item.title }}</span>
            <span class="row-subtitle">{{ item.info }}</span>
          </span>
          <IconExternalLink class="row-trail" />
        </a>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { startCapture } from "./startCapture";

import IconScan from "lucide-static/icons/scan-line.svg";
import IconKeyboard from "lucide-static/icons/keyboard.svg";
import IconChevronRight from "lucide-static/icons/chevron-right.svg";
import IconExternalLink from "lucide-static/icons/external-link.svg";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();

const imports = [
  {
    type: "FileImport",
    title: i18n.import_backup_file,
    info: i18n.import_backup_file_info,
  },
  {
    type: "QrImport",
    title: i18n.import_qr_images,
    info: i18n.import_qr_images_info,
  },
  {
    type: "TextImport",
    title: i18n.import_otp_urls,
    info: i18n.import_otp_urls_info,
  },
];

function addManually() {
  if (accounts.currentlyEncrypted) {
    notification.alert(i18n.phrase_incorrect);
    return;
  }
  currentView.open("AddAccount");
}
</script>
