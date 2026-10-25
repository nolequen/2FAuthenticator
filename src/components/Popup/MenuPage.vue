<template>
  <div>
    <div class="header">
      <span id="menuName">{{ i18n.settings }}</span>
      <div id="i-close" class="icon" @click="hideMenu()">
        <IconArrowLeft />
      </div>
    </div>
    <div id="menuBody">
      <div class="menuList">
        <p :title="i18n.backup" @click="showInfo('BackupPage')">
          <span><IconExchange /></span>{{ i18n.backup }}
        </p>
        <p :title="i18n.security" @click="showInfo('SetPasswordPage')">
          <span><IconLock /></span>{{ i18n.security }}
        </p>
        <p :title="i18n.sync_clock" @click="syncClock()">
          <span><IconSync /></span>{{ i18n.sync_clock }}
        </p>
        <p :title="i18n.resize_popup_page" @click="showInfo('PreferencesPage')">
          <span><IconWrench /></span>{{ i18n.resize_popup_page }}
        </p>
      </div>
      <div class="menuList">
        <p :title="i18n.feedback" @click="openHelp()">
          <span><IconComments /></span>{{ i18n.feedback }}
        </p>
        <p
          :title="i18n.source"
          @click="openLink('https://github.com/nolequen/Authenticator')"
        >
          <span><IconCode /></span>{{ i18n.source }}
        </p>
        <a href="licenses.html" target="_blank" style="text-decoration: none">
          <p :title="i18n.about">
            <span><IconInfo /></span>{{ i18n.about }}
          </p>
        </a>
      </div>
      <div id="version">Version {{ version }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { syncTimeWithGoogle } from "../../syncTime";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";

import IconArrowLeft from "../../../svg/arrow-left.svg";
import IconInfo from "../../../svg/info.svg";
import IconExchange from "../../../svg/exchange.svg";
import IconLock from "../../../svg/lock.svg";
import IconSync from "../../../svg/sync.svg";
import IconWrench from "../../../svg/wrench.svg";
import IconComments from "../../../svg/comments.svg";
import IconCode from "../../../svg/code.svg";
import { UserSettings } from "../../models/settings";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const styleStore = useStyleStore();
const { version } = storeToRefs(useMenuStore());

function hideMenu() {
  styleStore.hideMenu();
}

function openHelp() {
  chrome.tabs.create({
    url: "https://github.com/nolequen/Authenticator/issues",
  });
}

function openLink(url: string) {
  window.open(url, "_blank");
  return;
}

function showInfo(tab: string) {
  if (accounts.currentlyEncrypted) {
    if (tab === "SetPasswordPage") {
      notification.alert(i18n.phrase_incorrect);
      return;
    }
  }
  styleStore.showInfo();
  currentView.changeView(tab);
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
