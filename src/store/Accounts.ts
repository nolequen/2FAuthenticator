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
import * as groups from "../groups";
import type { SectionRef } from "../groups";
import { useCurrentViewStore } from "./CurrentView";
import { useMenuStore } from "./Menu";
import { useNotificationStore } from "./Notification";

export const useAccountsStore = defineStore("accounts", () => {
  const currentView = useCurrentViewStore();
  const menu = useMenuStore();
  const notification = useNotificationStore();

  const entries = ref<OTPEntryInterface[]>([]);
  const encryption: Map<string, EncryptionInterface> = markRaw(new Map());
  const defaultEncryption = ref("");
  const shouldShowPassphrase = ref(false);
  const sectorStart = ref(false); // Should display timer circles?
  const sectorOffset = ref(0); // Offset in seconds for animations
  const second = ref(0); // Offset in seconds for math
  const filter = ref(true);
  const siteName = ref<(string | null)[]>([]);
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
      menu.smartFilter &&
      !!matchedEntries.value &&
      matchedEntries.value.length > 0,
  );

  const filterHost = computed(() => siteName.value[2] ?? "");

  const currentlyEncrypted = computed(() => {
    for (const entry of entries.value) {
      if (entry.secret === null) {
        return true;
      }
    }
    return false;
  });

  const sections = computed(() => groups.buildSections(entries.value));

  const groupNames = computed(() => [
    ...groups.groupLabels(entries.value).values(),
  ]);

  function stopFilter() {
    filter.value = false;
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

  async function arrange(
    change: (list: OTPEntryInterface[]) => OTPEntryInterface[] | null,
    options: {
      follow?: OTPEntryInterface;
      collapsed?: (refs: SectionRef[]) => SectionRef[];
      labels?: Map<string, string>;
    } = {},
  ) {
    const previous = [...menu.collapsed];
    let collapsed = groups.collapsedSections(sections.value, menu.collapsed);
    const labels = new Map([
      ...groups.groupLabels(entries.value),
      ...(options.labels ?? []),
    ]);
    const before =
      options.follow && groups.sectionOf(sections.value, options.follow);
    const list = change(entries.value);
    if (!list) {
      return false;
    }
    const ordered = groups.arrangeEntries(list, labels);
    ordered.forEach((entry, index) => {
      if (entry.index !== index) {
        entry.index = index;
      }
    });
    entries.value = ordered;

    if (options.collapsed) {
      collapsed = options.collapsed(collapsed);
    }
    const after =
      options.follow && groups.sectionOf(sections.value, options.follow);
    if (after && !(before && groups.sameSection(before, after))) {
      collapsed = collapsed.filter((ref) => !groups.sameSection(ref, after));
    }
    menu.setCollapsed(groups.collapsedHashes(sections.value, collapsed));

    try {
      await withStorageLock(() => EntryStorage.set(ordered));
    } catch (error) {
      try {
        await showWriteFailure(error);
      } finally {
        menu.setCollapsed(previous);
      }
      return false;
    }
    return true;
  }

  function moveEntry(hash: string, to: SectionRef, newIndex: number) {
    return arrange((list) => {
      const entry = list.find((item) => item.hash === hash);
      return entry ? groups.moveEntry(list, entry, to, newIndex) : null;
    });
  }

  function moveGroup(key: string, newIndex: number) {
    return arrange((list) => groups.moveGroup(list, key, newIndex));
  }

  function addEntry(entry: OTPEntryInterface) {
    return arrange((list) => groups.insertEntry(list, entry), {
      follow: entry,
    });
  }

  function setEntryGroup(entry: OTPEntryInterface, name: string) {
    return arrange((list) => groups.setEntryGroup(list, entry, name), {
      follow: entry,
    });
  }

  function togglePin(entry: OTPEntryInterface) {
    return arrange((list) => groups.togglePin(list, entry), { follow: entry });
  }

  function renameGroup(key: string, name: string) {
    const merged = !!groups.mergeTarget(entries.value, key, name);
    const newKey = groups.groupKey(name);
    const joined =
      merged &&
      sections.value.some(
        (section) => section.kind === "group" && section.key === newKey,
      );
    return arrange((list) => groups.renameGroup(list, key, name), {
      labels: new Map<string, string>(
        merged ? [] : [[newKey, groups.normalizeGroup(name)]],
      ),
      collapsed: (refs) =>
        refs.flatMap((ref) =>
          ref.kind !== "group" || ref.key !== key
            ? [ref]
            : joined
              ? []
              : [{ kind: ref.kind, key: newKey }],
        ),
    });
  }

  function ungroup(key: string) {
    return arrange((list) => groups.ungroup(list, key));
  }

  function markWrongPassword() {
    wrongPassword.value = true;
  }

  function completeInit() {
    initComplete.value = true;
  }

  function deleteCode(hash: string) {
    const collapsed = groups.collapsedSections(sections.value, menu.collapsed);
    const index = entries.value.findIndex((entry) => entry.hash === hash);
    if (index > -1) {
      entries.value.splice(index, 1);
    }
    menu.setCollapsed(groups.collapsedHashes(sections.value, collapsed));
  }

  async function applyPassphrase(password: string) {
    if (!password) {
      return;
    }

    await currentView.withBusy(async () => {
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

        wrongPassword.value = false;
        notification.checkBackupReminder({
          entries: entries.value,
          currentlyEncrypted: currentlyEncrypted.value,
        });
        currentView.unlock();
      } catch (error) {
        console.error(error);
        notification.alert(chrome.i18n.getMessage("updateFailure"));
      }
    });
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
    return;
  }

  async function showWriteFailure(error: unknown) {
    console.error(error);
    notification.alert(chrome.i18n.getMessage("updateFailure"));
    await updateEntries();
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
    wrongPassword,
    initComplete,
    matchedEntries,
    shouldFilter,
    filterHost,
    currentlyEncrypted,
    sections,
    groupNames,
    init,
    stopFilter,
    updateCodes,
    loadCodes,
    moveEntry,
    moveGroup,
    addEntry,
    setEntryGroup,
    togglePin,
    renameGroup,
    ungroup,
    markWrongPassword,
    completeInit,
    deleteCode,
    applyPassphrase,
    changePassphrase,
    updateEntries,
    showWriteFailure,
    migrateStorage,
  };
});
