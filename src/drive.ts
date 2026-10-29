import { createApp } from "vue";
import { createPinia } from "pinia";
import DriveView from "./components/Drive.vue";
import CommonComponents from "./components/common/index";
import { i18n, loadI18nMessages } from "./store/i18n";

import { UserSettings } from "./models/settings";
import { applyTheme, normalizeTheme, trackInputModality } from "./theme";

async function init() {
  await UserSettings.updateItems();
  applyTheme(normalizeTheme(UserSettings.items.theme));
  trackInputModality();

  await loadI18nMessages();

  const app = createApp(DriveView);
  app.use(createPinia());

  for (const component of CommonComponents) {
    app.component(component.name, component.component);
  }

  app.config.globalProperties.i18n = i18n;

  app.mount("#drive-root");

  try {
    document.title = i18n.extName;
  } catch (e) {
    console.error(e);
  }
}

init();
