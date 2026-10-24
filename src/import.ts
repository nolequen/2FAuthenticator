import { createApp } from "vue";
import ImportView from "./components/Import.vue";
import CommonComponents from "./components/common/index";
import { i18n, loadI18nMessages } from "./store/i18n";

import { getSessionEncryption } from "./models/session";
import { EntryStorage } from "./models/storage";

async function init() {
  // i18n
  await loadI18nMessages();

  // Load entries to global
  const encryption = await getSessionEncryption();
  if (!encryption) {
    alert(i18n.phrase_incorrect);
    window.close();
    return;
  }
  const entries = await EntryStorage.get();

  if (encryption.getEncryptionStatus()) {
    for (const entry of entries) {
      await entry.applyEncryption(encryption);
    }
  }

  const app = createApp(ImportView, { entries });

  // Load common components globally
  for (const component of CommonComponents) {
    app.component(component.name, component.component);
  }

  app.config.globalProperties.i18n = i18n;

  app.mount("#import-root");

  // Set title
  try {
    document.title = i18n.extName;
  } catch (e) {
    console.error(e);
  }
}

init();
