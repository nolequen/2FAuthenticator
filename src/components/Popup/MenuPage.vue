<template>
  <div>
    <a-page-header :title="i18n.menu" @back="currentView.back()" />
    <nav class="page-body">
      <div class="panel">
        <button
          type="button"
          class="row"
          :title="i18n.backup"
          @click="openPage('Backup')"
        >
          <span class="row-icon"><IconDownload /></span>
          <span class="row-text">{{ i18n.backup }}</span>
          <IconChevronRight class="row-trail" />
        </button>
        <button
          type="button"
          class="row"
          :title="i18n.security"
          @click="openPage('SetPassword')"
        >
          <span class="row-icon"><IconShield /></span>
          <span class="row-text">{{ i18n.security }}</span>
          <IconChevronRight class="row-trail" />
        </button>
        <button
          type="button"
          class="row"
          :title="i18n.settings"
          @click="openPage('Preferences')"
        >
          <span class="row-icon"><IconSliders /></span>
          <span class="row-text">{{ i18n.settings }}</span>
          <IconChevronRight class="row-trail" />
        </button>
      </div>
      <div class="panel">
        <button
          type="button"
          class="row"
          :title="i18n.sync_clock"
          @click="syncClock()"
        >
          <span class="row-icon"><IconClock /></span>
          <span class="row-text">
            <span class="row-title">{{ i18n.sync_clock }}</span>
            <span class="row-subtitle">{{ i18n.sync_clock_info }}</span>
          </span>
        </button>
      </div>
      <div class="panel">
        <a class="row" href="licenses.html" target="_blank" :title="i18n.about">
          <span class="row-text">{{ i18n.about }}</span>
          <IconExternalLink class="row-trail" />
        </a>
        <button
          type="button"
          class="row"
          :title="i18n.feedback"
          @click="openHelp()"
        >
          <span class="row-text">{{ i18n.feedback }}</span>
          <IconExternalLink class="row-trail" />
        </button>
        <button
          type="button"
          class="row"
          :title="i18n.source"
          @click="openLink('https://github.com/nolequen/Authenticator')"
        >
          <span class="row-text">{{ i18n.source }}</span>
          <IconExternalLink class="row-trail" />
        </button>
      </div>
      <div id="version">{{ t("version", version) }}</div>
    </nav>
  </div>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { syncTimeWithGoogle } from "../../syncTime";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { type Page, useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";

import IconDownload from "lucide-static/icons/download.svg";
import IconShield from "lucide-static/icons/shield.svg";
import IconSliders from "lucide-static/icons/sliders-vertical.svg";
import IconClock from "lucide-static/icons/clock.svg";
import IconChevronRight from "lucide-static/icons/chevron-right.svg";
import IconExternalLink from "lucide-static/icons/external-link.svg";
import { UserSettings } from "../../models/settings";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const { version } = storeToRefs(useMenuStore());

function openHelp() {
  chrome.tabs.create({
    url: "https://github.com/nolequen/Authenticator/issues",
  });
}

function openLink(url: string) {
  window.open(url, "_blank");
  return;
}

function openPage(page: Page) {
  if (accounts.currentlyEncrypted) {
    if (page === "SetPassword") {
      notification.alert(i18n.phrase_incorrect);
      return;
    }
  }
  currentView.open(page);
  return;
}

function syncClock() {
  chrome.permissions.request(
    { origins: ["https://www.google.com/"] },
    async (granted) => {
      if (granted) {
        await UserSettings.updateItems();
        const message = await syncTimeWithGoogle();
        notification.alert(i18n[message]);
      }
      return;
    },
  );
  return;
}
</script>
