import { defineStore } from "pinia";
import { ref } from "vue";
import { UserSettings } from "../models/settings";
import { applyTheme, normalizeTheme, type Theme } from "../theme";

export const useMenuStore = defineStore("menu", () => {
  const version = ref(chrome.runtime.getManifest()?.version || "0.0.0");
  const useAutofill = ref(false);
  const smartFilter = ref(false);
  const siteIcons = ref(true);
  const siteIconsOff = ref<string[]>([]);
  const collapsed = ref<string[]>([]);
  const theme = ref<Theme>("auto");
  const autolock = ref(30);

  async function init() {
    await UserSettings.updateItems();

    useAutofill.value = UserSettings.items.autofill === true;
    smartFilter.value = UserSettings.items.smartFilter === true;
    siteIcons.value = UserSettings.items.siteIcons !== false;
    siteIconsOff.value = UserSettings.items.siteIconsOff ?? [];
    collapsed.value = UserSettings.items.collapsed ?? [];
    theme.value = normalizeTheme(UserSettings.items.theme);
    autolock.value = Number(UserSettings.items.autolock) || 30;

    applyTheme(theme.value);
  }

  function setAutofill(value: boolean) {
    useAutofill.value = value;
    UserSettings.items.autofill = value;
    UserSettings.commitItems();
  }

  function setSmartFilter(value: boolean) {
    smartFilter.value = value;
    UserSettings.items.smartFilter = value;
    UserSettings.commitItems();
  }

  function setSiteIcons(value: boolean) {
    siteIcons.value = value;
    UserSettings.items.siteIcons = value;
    UserSettings.commitItems();
  }

  function setSiteIcon(hash: string, value: boolean) {
    const others = siteIconsOff.value.filter((item) => item !== hash);
    siteIconsOff.value = value ? others : [...others, hash];
    UserSettings.items.siteIconsOff = [...siteIconsOff.value];
    UserSettings.commitItems();
  }

  function setCollapsed(hashes: string[]) {
    if (
      hashes.length === collapsed.value.length &&
      hashes.every((hash) => collapsed.value.includes(hash))
    ) {
      return;
    }
    collapsed.value = hashes;
    UserSettings.items.collapsed = [...hashes];
    UserSettings.commitItems();
  }

  function setTheme(value: Theme) {
    theme.value = value;
    UserSettings.items.theme = value;
    UserSettings.commitItems();
    applyTheme(value);
  }

  function setAutolock(value: number) {
    autolock.value = value;
    UserSettings.items.autolock = value;
    UserSettings.commitItems();
  }

  return {
    version,
    useAutofill,
    smartFilter,
    siteIcons,
    siteIconsOff,
    collapsed,
    theme,
    autolock,
    init,
    setAutofill,
    setSmartFilter,
    setSiteIcons,
    setSiteIcon,
    setCollapsed,
    setTheme,
    setAutolock,
  };
});
