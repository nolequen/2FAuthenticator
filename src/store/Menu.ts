import { UserSettings } from "../models/settings";

export class Menu implements Module {
  async getModule() {
    await UserSettings.updateItems();

    const menuState = {
      state: {
        version: chrome.runtime.getManifest()?.version || "0.0.0",
        zoom: Number(UserSettings.items.zoom) || 100,
        useAutofill: UserSettings.items.autofill === true,
        smartFilter: UserSettings.items.smartFilter === true,
        theme: UserSettings.items.theme || "normal",
        autolock: Number(UserSettings.items.autolock) || 30,
      },
      mutations: {
        setZoom: (state: MenuState, zoom: number) => {
          state.zoom = zoom;
          UserSettings.items.zoom = zoom;
          UserSettings.commitItems();
          this.resize(zoom);
        },
        setAutofill(state: MenuState, useAutofill: boolean) {
          state.useAutofill = useAutofill;
          UserSettings.items.autofill = useAutofill;
          UserSettings.commitItems();
        },
        setSmartFilter(state: MenuState, smartFilter: boolean) {
          state.smartFilter = smartFilter;
          UserSettings.items.smartFilter = smartFilter;
          UserSettings.commitItems();
        },
        setTheme(state: MenuState, theme: string) {
          state.theme = theme;
          UserSettings.items.theme = theme;
          UserSettings.commitItems();
        },
        setAutolock(state: MenuState, autolock: number) {
          state.autolock = autolock;
          UserSettings.items.autolock = autolock;
          UserSettings.commitItems();
        },
      },
      namespaced: true,
    };

    this.resize(menuState.state.zoom);

    return menuState;
  }

  private resize(zoom: number) {
    if (zoom !== 100) {
      document.body.style.marginBottom = 480 * (zoom / 100 - 1) + "px";
      document.body.style.marginRight = 320 * (zoom / 100 - 1) + "px";
      document.body.style.transform = "scale(" + zoom / 100 + ")";
    }
  }
}
