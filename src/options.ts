import { createApp } from "vue";
import OptionsView from "./components/Options.vue";
import { i18n, loadI18nMessages } from "./store/i18n";

async function init() {
  // i18n
  await loadI18nMessages();

  const app = createApp(OptionsView);
  app.config.globalProperties.i18n = i18n;
  app.mount("#options");
}

init();
