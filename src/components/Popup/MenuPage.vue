<template>
  <div>
    <div class="header">
      <span id="menuName">{{ i18n.settings }}</span>
      <div class="icon" id="i-close" v-on:click="hideMenu()">
        <IconArrowLeft />
      </div>
    </div>
    <div id="menuBody">
      <div class="menuList">
        <p v-bind:title="i18n.backup" v-on:click="showInfo('BackupPage')">
          <span><IconExchange /></span>{{ i18n.backup }}
        </p>
        <p
          v-bind:title="i18n.security"
          v-on:click="showInfo('SetPasswordPage')"
        >
          <span><IconLock /></span>{{ i18n.security }}
        </p>
        <p v-bind:title="i18n.sync_clock" v-on:click="syncClock()">
          <span><IconSync /></span>{{ i18n.sync_clock }}
        </p>
        <p
          v-bind:title="i18n.resize_popup_page"
          v-on:click="showInfo('PreferencesPage')"
        >
          <span><IconWrench /></span>{{ i18n.resize_popup_page }}
        </p>
      </div>
      <div class="menuList">
        <p v-bind:title="i18n.feedback" v-on:click="openHelp()">
          <span><IconComments /></span>{{ i18n.feedback }}
        </p>
        <p
          v-bind:title="i18n.source"
          v-on:click="openLink('https://github.com/nolequen/Authenticator')"
        >
          <span><IconCode /></span>{{ i18n.source }}
        </p>
        <a href="licenses.html" target="_blank" style="text-decoration: none">
          <p v-bind:title="i18n.about">
            <span><IconInfo /></span>{{ i18n.about }}
          </p>
        </a>
      </div>
      <div id="version">Version {{ version }}</div>
    </div>
  </div>
</template>
<script lang="ts">
import Vue from "vue";
import { syncTimeWithGoogle } from "../../syncTime";

import IconArrowLeft from "../../../svg/arrow-left.svg";
import IconInfo from "../../../svg/info.svg";
import IconExchange from "../../../svg/exchange.svg";
import IconLock from "../../../svg/lock.svg";
import IconSync from "../../../svg/sync.svg";
import IconWrench from "../../../svg/wrench.svg";
import IconComments from "../../../svg/comments.svg";
import IconCode from "../../../svg/code.svg";
import { UserSettings } from "../../models/settings";

export default Vue.extend({
  components: {
    IconArrowLeft,
    IconInfo,
    IconExchange,
    IconLock,
    IconSync,
    IconWrench,
    IconComments,
    IconCode,
  },
  computed: {
    version: function () {
      return this.$store.state.menu.version;
    },
  },
  methods: {
    hideMenu() {
      this.$store.commit("style/hideMenu");
    },
    openHelp() {
      chrome.tabs.create({
        url: "https://github.com/nolequen/Authenticator/issues",
      });
    },
    openLink(url: string) {
      window.open(url, "_blank");
      return;
    },
    showInfo(tab: string) {
      if (this.$store.getters["accounts/currentlyEncrypted"]) {
        if (tab === "SetPasswordPage") {
          this.$store.commit("notification/alert", this.i18n.phrase_incorrect);
          return;
        }
      }
      this.$store.commit("style/showInfo");
      this.$store.commit("currentView/changeView", tab);
      return;
    },
    syncClock() {
      chrome.permissions.request(
        { origins: ["https://www.google.com/"] },
        async (granted) => {
          if (granted) {
            await UserSettings.updateItems();
            const message = await syncTimeWithGoogle();
            this.$store.commit("notification/alert", this.i18n[message]);
          }
          return;
        },
      );
      return;
    },
  },
});
</script>
