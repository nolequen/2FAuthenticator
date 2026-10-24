import { createPinia, setActivePinia, type Pinia } from "pinia";
import type { App, Component, Plugin } from "vue";
import CommonComponents from "../components/common/index";
import { i18n } from "../store/i18n";

export function createTestPinia() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return pinia;
}

const i18nPlugin = {
  install(app: App) {
    app.config.globalProperties.i18n = i18n;
  },
};

export function mountOptions(pinia?: Pinia) {
  const plugins: Plugin[] = [i18nPlugin];
  if (pinia) {
    plugins.push(pinia);
  }
  const components: { [name: string]: Component } = {};
  for (const component of CommonComponents) {
    components[component.name] = component.component;
  }
  return { global: { plugins, components } };
}
