<template>
  <div>
    <a-button @click="beginCapture()">{{ i18n.add_qr }}</a-button>
    <a-button @click="showInfo('AddAccountPage')">
      {{ i18n.add_secret }}
    </a-button>
    <a-button-link href="import.html?QrImport">{{
      i18n.import_qr_images
    }}</a-button-link>
    <a-button-link href="import.html?TextImport">{{
      i18n.import_otp_urls
    }}</a-button-link>
  </div>
</template>
<script setup lang="ts">
import { getCurrentTab, okToInjectContentScript } from "../../utils";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const styleStore = useStyleStore();

function showInfo(page: string) {
  if (accounts.currentlyEncrypted) {
    notification.alert(i18n.phrase_incorrect);
    return;
  }
  styleStore.showInfo();
  currentView.changeView(page);
}

async function beginCapture() {
  if (accounts.currentlyEncrypted) {
    notification.alert(i18n.phrase_incorrect);
    return;
  }

  // Insert content script
  const tab = await getCurrentTab();
  if (okToInjectContentScript(tab)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/dist/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["/css/content.css"],
    });

    chrome.runtime.sendMessage({ action: "updateContentTab", data: tab });
    chrome.tabs.sendMessage(tab.id, { action: "capture" }, (result) => {
      if (result !== "beginCapture") {
        notification.alert(i18n.capture_failed);
      } else {
        window.close();
      }
    });
  }
}
</script>
