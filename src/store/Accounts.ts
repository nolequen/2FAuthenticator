import { defineStore } from "pinia";
import { computed, markRaw, ref } from "vue";
import {
  EntryStorage,
  BrowserStorage,
  withStorageLock,
} from "../models/storage";
import { Encryption } from "../models/encryption";
import { OTPType } from "../models/otp";
import { getSiteName, getMatchedEntriesHash } from "../utils";
import { isChromium } from "../browser";
import { StorageLocation, UserSettings } from "../models/settings";
import {
  adoptEntries,
  loadEntries,
  removePassword,
  setPassword,
  unlock,
  upgradeLegacyEntries,
} from "../models/keyring";
import { useCurrentViewStore } from "./CurrentView";
import { useNotificationStore } from "./Notification";
import { useStyleStore } from "./Style";

export const useAccountsStore = defineStore("accounts", () => {
  const currentView = useCurrentViewStore();
  const notification = useNotificationStore();
  const style = useStyleStore();

  const entries = ref<OTPEntryInterface[]>([]);
  const encryption: Map<string, EncryptionInterface> = markRaw(new Map());
  const defaultEncryption = ref("");
  const shouldShowPassphrase = ref(false);
  const sectorStart = ref(false); // Should display timer circles?
  const sectorOffset = ref(0); // Offset in seconds for animations
  const second = ref(0); // Offset in seconds for math
  const filter = ref(true);
  const siteName = ref<(string | null)[]>([]);
  const showSearch = ref(false);
  const wrongPassword = ref(false);
  const initComplete = ref(false);

  async function init() {
    const { cachedPassphrase, cachedKeyId } =
      await chrome.storage.session.get<SessionData>();
    if (cachedKeyId) {
      encryption.set(
        cachedKeyId,
        markRaw(new Encryption(cachedPassphrase ?? "", cachedKeyId)),
      );
    }
    defaultEncryption.value = cachedKeyId ?? "";
    shouldShowPassphrase.value = await EntryStorage.hasEncryptionKey();
    entries.value = shouldShowPassphrase.value ? [] : await EntryStorage.get();

    await UserSettings.updateItems();

    siteName.value = await getSiteName();
  }

  const matchedEntries = computed(() =>
    getMatchedEntriesHash(siteName.value, entries.value),
  );

  const shouldFilter = computed(
    () =>
      UserSettings.items.smartFilter === true &&
      !!matchedEntries.value &&
      matchedEntries.value.length > 0,
  );

  const currentlyEncrypted = computed(() => {
    for (const entry of entries.value) {
      if (entry.secret === null) {
        return true;
      }
    }
    return false;
  });

  const orderedEntries = computed(() => {
    const pinnedEntries = entries.value.filter((entry) => entry.pinned);
    const unpinnedEntries = entries.value.filter((entry) => !entry.pinned);
    return [...pinnedEntries, ...unpinnedEntries];
  });

  function stopFilter() {
    filter.value = false;
  }

  function openSearch() {
    showSearch.value = true;
  }

  function updateCodes() {
    let currentSecond = new Date().getSeconds();
    if (UserSettings.items.offset) {
      currentSecond += Number(UserSettings.items.offset);
    }

    // prevent second from negative
    currentSecond = ((currentSecond % 60) + 60) % 60;
    second.value = currentSecond;

    if (
      !sectorStart.value &&
      entries.value.length > 0 &&
      !currentlyEncrypted.value
    ) {
      sectorStart.value = true;
      sectorOffset.value = -currentSecond;
    }

    // if (second > 25) {
    //   app.class.timeout = true;
    // } else {
    //   app.class.timeout = false;
    // }
    // if (second < 1) {
    //   const entries = app.entries as OTP[];
    //   for (let i = 0; i < entries.length; i++) {
    //     if (entries[i].type !== OTPType.hotp &&
    //         entries[i].type !== OTPType.hhex) {
    //       entries[i].generate();
    //     }
    //   }
    // }
    for (const entry of entries.value) {
      if (entry.type !== OTPType.hotp && entry.type !== OTPType.hhex) {
        entry.generate();
      }
    }
  }

  function loadCodes(newCodes: OTPEntryInterface[]) {
    entries.value = newCodes;
  }

  async function reorderEntries(list: OTPEntryInterface[]) {
    entries.value = list;

    for (let i = 0; i < list.length; i++) {
      if (list[i].index !== i) {
        list[i].index = i;
      }
    }

    try {
      await withStorageLock(() => EntryStorage.set(entries.value));
    } catch (error) {
      await showWriteFailure(error);
    }
  }

  function pinEntry(entry: OTPEntryInterface) {
    const target = entries.value.find((item) => item.hash === entry.hash);
    if (target) {
      target.pinned = !target.pinned;
    }
  }

  function markWrongPassword() {
    wrongPassword.value = true;
  }

  function completeInit() {
    initComplete.value = true;
  }

  function deleteCode(hash: string) {
    const index = entries.value.findIndex((entry) => entry.hash === hash);
    if (index > -1) {
      entries.value.splice(index, 1);
    }
  }

  function addCode(entry: OTPEntryInterface) {
    entries.value.unshift(entry);
  }

  async function applyPassphrase(password: string) {
    if (!password) {
      return;
    }

    currentView.changeView("LoadingPage");

    try {
      // Decrypt entries
      const unlocked = await unlock(password);
      if (unlocked) {
        for (const [keyId, keyEncryption] of unlocked.encryptions) {
          encryption.set(keyId, markRaw(keyEncryption));
        }
        defaultEncryption.value = unlocked.defaultKeyId;
      }

      await updateEntries();

      if (!unlocked) {
        markWrongPassword();
        currentView.changeView("EnterPasswordPage");
        return;
      }

      const unlockedEncryption = unlocked.encryptions.get(
        unlocked.defaultKeyId,
      );
      if (!unlockedEncryption) {
        throw new Error(
          "defaultEncryption is empty, this should never happen!",
        );
      }
      if (await adoptEntries(entries.value, unlockedEncryption)) {
        await updateEntries();
      }

      if (!currentlyEncrypted.value) {
        chrome.runtime.sendMessage({
          action: "cachePassphrase",
          value: unlocked.passphrase,
          keyId: unlocked.defaultKeyId,
        });
      }

      style.hideInfo(true);
    } catch (error) {
      console.error(error);
      notification.alert(chrome.i18n.getMessage("updateFailure"));
      currentView.changeView("EnterPasswordPage");
    }
    return;
  }

  async function changePassphrase(password: string) {
    const restoreEntries = async (error: unknown) => {
      await updateEntries();
      throw error;
    };
    const currentKeyId = encryption
      .get(defaultEncryption.value)
      ?.getEncryptionKeyId();

    if (password) {
      const { encryption: newEncryption, passphrase } = await setPassword(
        password,
        encryption,
        currentKeyId,
      ).catch(restoreEntries);
      const keyId = newEncryption.getEncryptionKeyId();

      encryption.clear();
      encryption.set(keyId, markRaw(newEncryption));
      defaultEncryption.value = keyId;

      chrome.runtime.sendMessage({
        action: "cachePassphrase",
        value: passphrase,
        keyId,
      });

      await updateEntries();

      // https://github.com/Authenticator-Extension/Authenticator/issues/412
      if (isChromium) {
        await BrowserStorage.clearLogs();
      }
    } else {
      await removePassword(encryption, currentKeyId).catch(restoreEntries);
      encryption.clear();
      defaultEncryption.value = "";

      chrome.runtime.sendMessage({
        action: "lock",
      });

      await updateEntries();
    }
  }

  async function updateEntries() {
    const loadedEntries = await loadEntries(encryption);

    await upgradeLegacyEntries(loadedEntries);

    loadCodes(loadedEntries);
    updateCodes();
    completeInit();
    showSearchIfNeeded();
    return;
  }

  async function showWriteFailure(error: unknown) {
    console.error(error);
    notification.alert(chrome.i18n.getMessage("updateFailure"));
    await updateEntries();
  }

  function showSearchIfNeeded() {
    if (entries.value.length >= 10 && !(shouldFilter.value && filter.value)) {
      openSearch();
    }
  }

  function clearFilter() {
    stopFilter();
    if (entries.value.length >= 10) {
      openSearch();
    }
  }

  function migrateStorage(newStorageLocation: string) {
    return withStorageLock(async () => {
      await UserSettings.updateItems();

      // sync => local
      if (
        UserSettings.items.storageLocation === StorageLocation.Sync &&
        newStorageLocation === StorageLocation.Local
      ) {
        const syncData = await chrome.storage.sync.get();
        await chrome.storage.local.set(syncData); // userSettings will be handled later
        const localData = await chrome.storage.local.get();

        // Double check if data was set
        if (
          Object.keys(syncData).every(
            (value) => Object.keys(localData).indexOf(value) >= 0,
          )
        ) {
          UserSettings.items.storageLocation = StorageLocation.Local;
          await chrome.storage.sync.clear();
          await chrome.storage.local.set({
            UserSettings: UserSettings.items,
          });
          return "updateSuccess";
        } else {
          throw " All data not transferred successfully.";
        }
        // local => sync
      } else if (
        UserSettings.items.storageLocation === StorageLocation.Local &&
        newStorageLocation === StorageLocation.Sync
      ) {
        const localData = await chrome.storage.local.get();
        if (localData?.UserSettings) {
          delete localData.UserSettings;
          await chrome.storage.sync.set(localData);
        }
        const syncData = await chrome.storage.sync.get();

        // Double check if data was set
        if (
          Object.keys(localData).every(
            (value) => Object.keys(syncData).indexOf(value) >= 0,
          )
        ) {
          UserSettings.items.storageLocation = StorageLocation.Sync;
          await chrome.storage.local.clear();
          await UserSettings.commitItems();
          return "updateSuccess";
        } else {
          throw " All data not transferred successfully.";
        }
      }

      // No change
      return "updateSuccess";
    });
  }

  return {
    entries,
    encryption,
    defaultEncryption,
    shouldShowPassphrase,
    sectorStart,
    sectorOffset,
    second,
    filter,
    siteName,
    showSearch,
    wrongPassword,
    initComplete,
    matchedEntries,
    shouldFilter,
    currentlyEncrypted,
    orderedEntries,
    init,
    stopFilter,
    openSearch,
    updateCodes,
    loadCodes,
    reorderEntries,
    pinEntry,
    markWrongPassword,
    completeInit,
    deleteCode,
    addCode,
    applyPassphrase,
    changePassphrase,
    updateEntries,
    showWriteFailure,
    showSearchIfNeeded,
    clearFilter,
    migrateStorage,
  };
});
