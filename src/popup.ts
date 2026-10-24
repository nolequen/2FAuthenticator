// Vue
import { createApp } from "vue";
import { createPinia } from "pinia";

// Components
import Popup from "./components/Popup.vue";
import CommonComponents from "./components/common/index";

// Other
import { i18n, loadI18nMessages } from "./store/i18n";
import { useStyleStore } from "./store/Style";
import { useAccountsStore } from "./store/Accounts";
import { useCurrentViewStore } from "./store/CurrentView";
import { useMenuStore } from "./store/Menu";
import { useNotificationStore } from "./store/Notification";
import { syncTimeWithGoogle } from "./syncTime";
import { UserSettings } from "./models/settings";

async function init() {
  await UserSettings.updateItems();

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
  const style = useStyleStore(pinia);
  await accounts.init();
  await menu.init();

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
      currentView.changeView("LoadingPage");
      await accounts.updateEntries();
    } else {
      style.showInfo(true);
      currentView.changeView("EnterPasswordPage");
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

  // Backup reminder / run backup
  const backupReminder = setInterval(() => {
    if (accounts.entries.length === 0) {
      return;
    }

    if (accounts.currentlyEncrypted) {
      return;
    }

    clearInterval(backupReminder);

    const clientTime = Math.floor(new Date().getTime() / 1000 / 3600 / 24);
    if (!UserSettings.items.lastRemindingBackupTime) {
      UserSettings.items.lastRemindingBackupTime = clientTime;
      UserSettings.commitItems();
    } else if (
      clientTime - Number(UserSettings.items.lastRemindingBackupTime) >= 30 ||
      clientTime - Number(UserSettings.items.lastRemindingBackupTime) < 0
    ) {
      notification.alert(i18n.remind_backup);
      UserSettings.items.lastRemindingBackupTime = clientTime;
      UserSettings.commitItems();
    }
    return;
  }, 5000);

  // Open search if '/' is pressed
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "/") {
        if (style.isMenuShown) {
          return;
        }
        accounts.stopFilter();
        // It won't focus the texfield if vue unhides the div
        accounts.openSearch();
        const searchDiv = document.getElementById("search");
        const searchInput = document.getElementById("searchInput");
        if (!searchInput || !searchDiv) {
          return;
        }
        searchDiv.style.display = "block";
        searchInput.focus();
      }
    },
    false,
  );

  // Show search box if more than 10 entries
  accounts.showSearchIfNeeded();

  const query = new URLSearchParams(document.location.search.substring(1));
  // Resize window to proper size if popup
  if (query.get("popup")) {
    const zoom = Number(UserSettings.items.zoom) / 100 || 1;
    const correctHeight = 480 * zoom;
    const correctWidth = 320 * zoom;
    if (
      window.innerHeight !== correctHeight ||
      window.innerWidth !== correctWidth
    ) {
      // window update to correct size
      const adjustedHeight =
        correctHeight + (window.outerHeight - window.innerHeight);
      const adjustedWidth =
        correctWidth + (window.outerWidth - window.innerWidth);
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, {
        height: adjustedHeight,
        width: adjustedWidth,
      });
    }
  }

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
