// Vue
import { createApp } from "vue";
import { createPinia } from "pinia";

// Components
import Popup from "./components/Popup.vue";
import CommonComponents from "./components/common/index";

// Other
import { i18n, loadI18nMessages } from "./store/i18n";
import { useAccountsStore } from "./store/Accounts";
import { useCurrentViewStore } from "./store/CurrentView";
import { useMenuStore } from "./store/Menu";
import { useNotificationStore } from "./store/Notification";
import { useDriveStore } from "./store/Drive";
import { syncTimeWithGoogle } from "./syncTime";
import { UserSettings } from "./models/settings";
import { applyTheme, normalizeTheme, trackInputModality } from "./theme";

const TEXT_FIELDS = "input, textarea, select, [contenteditable]";

async function init() {
  await UserSettings.updateItems();
  applyTheme(normalizeTheme(UserSettings.items.theme));
  trackInputModality();

  // Add globals
  await loadI18nMessages();

  const app = createApp(Popup);

  // Load modules
  const pinia = createPinia();
  app.use(pinia);

  // Load common components globally
  for (const component of CommonComponents) {
    app.component(component.name, component.component);
  }

  app.config.globalProperties.i18n = i18n;

  // State
  const accounts = useAccountsStore(pinia);
  const currentView = useCurrentViewStore(pinia);
  const menu = useMenuStore(pinia);
  const notification = useNotificationStore(pinia);
  const drive = useDriveStore(pinia);
  await accounts.init();
  await menu.init();
  await drive.init();
  notification.checkBackupReminder(accounts);

  // Render
  app.mount("#authenticator");

  // Update time based entries' codes
  accounts.updateCodes();
  setInterval(() => {
    accounts.updateCodes();
  }, 1000);

  // Prompt for password if needed
  if (accounts.shouldShowPassphrase) {
    // If we have cached password, use that
    if (accounts.defaultEncryption) {
      await currentView.withBusy(async () => {
        await accounts.updateEntries();
        notification.checkBackupReminder(accounts);
      });
    } else {
      currentView.lock();
    }
  } else {
    // Set init complete if no encryption is present, otherwise this will be set in updateEntries.
    accounts.completeInit();
  }

  // Auto focus on first entry
  document.querySelector<HTMLAnchorElement>("a.entry[tabindex='0']")?.focus();

  // Set document title
  try {
    document.title = i18n.extName;
  } catch (e) {
    console.error(e);
  }

  // Open search if '/' is pressed
  document.addEventListener(
    "keyup",
    (e) => {
      if (
        e.key !== "/" ||
        currentView.current !== null ||
        currentView.locked ||
        document.querySelector<HTMLElement>(".base")?.inert ||
        (e.target instanceof Element && e.target.closest(TEXT_FIELDS))
      ) {
        return;
      }
      accounts.stopFilter();
      document.getElementById("searchInput")?.focus();
    },
    false,
  );

  // TODO: give an option for this
  chrome.permissions.contains(
    { origins: ["https://www.google.com/"] },
    (hasPermission) => {
      if (hasPermission) {
        syncTimeWithGoogle();
      }
    },
  );
}

init();
