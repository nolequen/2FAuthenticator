<template>
  <div>
    <a-select-input
      v-model="theme"
      :label="i18n.theme"
      style="margin-left: 10px"
    >
      <option value="normal">{{ i18n.theme_light }}</option>
      <option value="dark">{{ i18n.theme_dark }}</option>
      <option value="simple">{{ i18n.theme_simple }}</option>
      <option value="compact">{{ i18n.theme_compact }}</option>
      <option value="accessibility">{{ i18n.theme_high_contrast }}</option>
      <option value="flat">{{ i18n.theme_flat }}</option>
    </a-select-input>
    <a-select-input
      v-model="zoom"
      :label="i18n.scale"
      style="margin-left: 10px"
    >
      <option value="125">125%</option>
      <option value="100">100%</option>
      <option value="90">90%</option>
      <option value="80">80%</option>
      <option value="67">67%</option>
      <option value="57">57%</option>
      <option value="50">50%</option>
      <option value="40">40%</option>
      <option value="33">33%</option>
      <option value="25">25%</option>
      <option value="20">20%</option>
    </a-select-input>
    <a-toggle-input v-model="useAutofill" :label="i18n.use_autofill" />
    <a-toggle-input
      v-model="browserSync"
      :label="i18n.browser_sync"
      @change="migrateStorage()"
    />
    <a-toggle-input v-model="smartFilter" :label="i18n.smart_filter" />
    <div v-show="!!defaultEncryption" class="control-group">
      <label class="combo-label">{{ i18n.autolock }}</label>
      <input
        v-model="autolock"
        class="input"
        type="number"
        min="0"
        style="width: 70px; text-align: center"
      />
      <span class="combo-label" style="margin-left: 0; margin-right: 20px">{{
        i18n.minutes
      }}</span>
    </div>
    <a-button @click="popOut()">{{ i18n.popout }}</a-button>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { isFirefox } from "../../browser";
import { UserSettings } from "../../models/settings";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const menu = useMenuStore();
const notification = useNotificationStore();
const { defaultEncryption } = storeToRefs(accounts);

const zoom = computed({
  get: () => menu.zoom,
  set: (zoom: number | string) => {
    menu.setZoom(zoom);
  },
});

const useAutofill = computed({
  get: () => menu.useAutofill,
  set: (useAutofill: boolean) => {
    menu.setAutofill(useAutofill);
  },
});

const smartFilter = computed({
  get: () => menu.smartFilter,
  set: (smartFilter: boolean) => {
    menu.setSmartFilter(smartFilter);
    notification.alert(i18n.activate_auto_filter);
  },
});

const theme = computed({
  get: () => menu.theme,
  set: (theme: string) => {
    menu.setTheme(theme);
  },
});

const autolock = computed({
  get: () => menu.autolock,
  set: (autolock: number) => {
    menu.setAutolock(autolock);
    chrome.runtime.sendMessage({ action: "resetAutolock" });
  },
});

const newStorageLocation = ref("");

const browserSync = computed({
  get: () => newStorageLocation.value === "sync",
  set: (value: boolean) => {
    newStorageLocation.value = value ? "sync" : "local";
  },
});

UserSettings.updateItems().then(() => {
  newStorageLocation.value = UserSettings.items.storageLocation || "";
});

function popOut() {
  let windowType;
  if (isFirefox) {
    windowType = "detached_panel";
  } else {
    windowType = "panel";
  }
  chrome.windows.create({
    url: chrome.runtime.getURL("view/popup.html?popup=true"),
    type: windowType as chrome.windows.CreateType,
    height: window.innerHeight,
    width: window.innerWidth,
  });
}

function migrateStorage() {
  currentView.changeView("LoadingPage");
  accounts.migrateStorage(newStorageLocation.value).then(
    (m) => {
      notification.alert(i18n[m]);
      currentView.changeView("PreferencesPage");
    },
    (r: string) => {
      notification.alert(i18n.updateFailure + r);
      currentView.changeView("PreferencesPage");
    },
  );
}
</script>
