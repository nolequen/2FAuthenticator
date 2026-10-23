import Vue from "vue";
import ImportView from "./components/Import.vue";
import CommonComponents from "./components/common/index";
import { loadI18nMessages } from "./store/i18n";

import { getSessionEncryption } from "./models/session";
import { EntryStorage } from "./models/storage";

async function init() {
  // i18n
  Vue.prototype.i18n = await loadI18nMessages();

  // Load common components globally
  for (const component of CommonComponents) {
    Vue.component(component.name, component.component);
  }

  // Load entries to global
  const encryption = await getSessionEncryption();
  if (!encryption) {
    alert(Vue.prototype.i18n.phrase_incorrect);
    window.close();
    return;
  }
  const entries = await EntryStorage.get();

  if (encryption.getEncryptionStatus()) {
    for (const entry of entries) {
      await entry.applyEncryption(encryption);
    }
  }

  Vue.prototype.$entries = entries;

  const instance = new Vue({
    render: (h) => h(ImportView),
  }).$mount("#import");

  // Set title
  try {
    document.title = instance.i18n.extName;
  } catch (e) {
    console.error(e);
  }
}

init();
