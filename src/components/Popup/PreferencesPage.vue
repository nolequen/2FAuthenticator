<template>
  <div>
    <a-page-header :title="i18n.settings" @back="currentView.back()" />
    <div class="page-body">
      <h2 class="section-title">{{ i18n.appearance }}</h2>
      <div class="panel padded">
        <a-segmented-input
          v-model="theme"
          class="theme-field"
          :label="i18n.theme"
          :options="[
            { value: 'auto', label: i18n.theme_auto },
            { value: 'light', label: i18n.theme_light },
            { value: 'dark', label: i18n.theme_dark },
          ]"
        />
      </div>
      <h2 class="section-title">{{ i18n.codes_section }}</h2>
      <div class="panel">
        <a-toggle-input
          v-model="useAutofill"
          :label="i18n.use_autofill"
          :description="i18n.use_autofill_info"
        />
        <a-toggle-input
          v-model="smartFilter"
          :label="i18n.smart_filter"
          :description="i18n.smart_filter_info"
        />
        <a-toggle-input
          v-model="siteIcons"
          :label="i18n.site_icons"
          :description="i18n.site_icons_info"
        />
        <a-toggle-input
          v-model="browserSync"
          :label="i18n.browser_sync"
          :description="i18n.browser_sync_info"
          @change="migrateStorage()"
        />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { UserSettings } from "../../models/settings";
import type { Theme } from "../../theme";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const menu = useMenuStore();
const notification = useNotificationStore();

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
    accounts.filter = smartFilter;
  },
});

const siteIcons = computed({
  get: () => menu.siteIcons,
  set: (siteIcons: boolean) => {
    menu.setSiteIcons(siteIcons);
  },
});

const theme = computed({
  get: () => menu.theme,
  set: (theme: Theme) => {
    menu.setTheme(theme);
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

async function migrateStorage() {
  const message = await currentView.withBusy(() =>
    accounts.migrateStorage(newStorageLocation.value).then(
      (m) => i18n[m],
      (r: string) => i18n.updateFailure + r,
    ),
  );
  notification.alert(message);
}
</script>
