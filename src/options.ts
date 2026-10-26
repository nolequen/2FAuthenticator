import { createApp } from "vue";
import OptionsView from "./components/Options.vue";
import { i18n, loadI18nMessages } from "./store/i18n";
import { UserSettings } from "./models/settings";
import { applyTheme, normalizeTheme, trackInputModality } from "./theme";

async function init() {
  await UserSettings.updateItems();
  applyTheme(normalizeTheme(UserSettings.items.theme));
  trackInputModality();

  // i18n
  await loadI18nMessages();

  const app = createApp(OptionsView);
  app.config.globalProperties.i18n = i18n;
  app.mount("#options");
}

init();
