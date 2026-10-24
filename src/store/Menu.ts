import { defineStore } from "pinia";
import { ref } from "vue";
import { UserSettings } from "../models/settings";

export const useMenuStore = defineStore("menu", () => {
  const version = ref(chrome.runtime.getManifest()?.version || "0.0.0");
  const zoom = ref<number | string>(100);
  const useAutofill = ref(false);
  const smartFilter = ref(false);
  const theme = ref("normal");
  const autolock = ref(30);

  async function init() {
    await UserSettings.updateItems();

    zoom.value = Number(UserSettings.items.zoom) || 100;
    useAutofill.value = UserSettings.items.autofill === true;
    smartFilter.value = UserSettings.items.smartFilter === true;
    theme.value = UserSettings.items.theme || "normal";
    autolock.value = Number(UserSettings.items.autolock) || 30;

    resize(zoom.value);
  }

  function setZoom(value: number | string) {
    zoom.value = value;
    UserSettings.items.zoom = Number(value);
    UserSettings.commitItems();
    resize(value);
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

  function setTheme(value: string) {
    theme.value = value;
    UserSettings.items.theme = value;
    UserSettings.commitItems();
  }

  function setAutolock(value: number) {
    autolock.value = value;
    UserSettings.items.autolock = value;
    UserSettings.commitItems();
  }

  function resize(value: number | string) {
    if (value !== 100) {
      const scale = Number(value) / 100;
      document.body.style.marginBottom = 480 * (scale - 1) + "px";
      document.body.style.marginRight = 320 * (scale - 1) + "px";
      document.body.style.transform = "scale(" + scale + ")";
    }
  }

  return {
    version,
    zoom,
    useAutofill,
    smartFilter,
    theme,
    autolock,
    init,
    setZoom,
    setAutofill,
    setSmartFilter,
    setTheme,
    setAutolock,
  };
});
