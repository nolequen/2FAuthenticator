import { EntryStorage, BrowserStorage } from "../models/storage";
import { Encryption } from "../models/encryption";
import { OTPType, OTPAlgorithm } from "../models/otp";
import { ActionContext } from "vuex";
import { getSiteName, getMatchedEntriesHash } from "../utils";
import { isChromium } from "../browser";
import { StorageLocation, UserSettings } from "../models/settings";
import {
  adoptEntries,
  removePassword,
  setPassword,
  unlock,
  upgradeLegacyEntries,
} from "../models/keyring";

export class Accounts implements Module {
  async getModule() {
    const cachedKeyInfo = await this.getCachedKeyInfo();
    const encryption: Map<string, EncryptionInterface> = new Map();
    if (cachedKeyInfo.cachedKeyId) {
      encryption.set(
        cachedKeyInfo.cachedKeyId,
        new Encryption(
          cachedKeyInfo.cachedPassphrase,
          cachedKeyInfo.cachedKeyId,
        ),
      );
    }
    const shouldShowPassphrase = await EntryStorage.hasEncryptionKey();
    const entries = shouldShowPassphrase ? [] : await this.getEntries();

    await UserSettings.updateItems();

    return {
      state: {
        entries,
        encryption,
        defaultEncryption: cachedKeyInfo.cachedKeyId,
        OTPType,
        OTPAlgorithm,
        shouldShowPassphrase,
        sectorStart: false, // Should display timer circles?
        sectorOffset: 0, // Offset in seconds for animations
        second: 0, // Offset in seconds for math
        filter: true,
        siteName: await getSiteName(),
        showSearch: false,
        exportData: await EntryStorage.getExport(entries),
        exportEncData: await EntryStorage.getExport(entries, true),
        keys: await BrowserStorage.getKeys(),
        wrongPassword: false,
        initComplete: false,
      },
      getters: {
        shouldFilter(
          state: AccountsState,
          getters: { matchedEntries: string[] },
        ) {
          return (
            UserSettings.items.smartFilter === true &&
            getters.matchedEntries.length
          );
        },
        matchedEntries: (state: AccountsState) => {
          return getMatchedEntriesHash(state.siteName, state.entries);
        },
        currentlyEncrypted(state: AccountsState) {
          for (const entry of state.entries) {
            if (entry.secret === null) {
              return true;
            }
          }
          return false;
        },
        entries(state: AccountsState) {
          const pinnedEntries = state.entries.filter((entry) => entry.pinned);
          const unpinnedEntries = state.entries.filter(
            (entry) => !entry.pinned,
          );
          return [...pinnedEntries, ...unpinnedEntries];
        },
      },
      mutations: {
        stopFilter(state: AccountsState) {
          state.filter = false;
        },
        showSearch(state: AccountsState) {
          state.showSearch = true;
        },
        updateCodes(state: AccountsState) {
          let second = new Date().getSeconds();
          if (UserSettings.items.offset) {
            second += Number(UserSettings.items.offset);
          }

          // prevent second from negative
          second = ((second % 60) + 60) % 60;
          state.second = second;

          let currentlyEncrypted = false;

          for (const entry of state.entries) {
            if (entry.secret === null) {
              currentlyEncrypted = true;
            }
          }

          if (
            !state.sectorStart &&
            state.entries.length > 0 &&
            !currentlyEncrypted
          ) {
            state.sectorStart = true;
            state.sectorOffset = -second;
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
          const entries = state.entries as OTPEntryInterface[];
          for (let i = 0; i < entries.length; i++) {
            if (
              entries[i].type !== OTPType.hotp &&
              entries[i].type !== OTPType.hhex
            ) {
              entries[i].generate();
            }
          }
        },
        loadCodes(state: AccountsState, newCodes: OTPEntryInterface[]) {
          state.entries = newCodes;
        },
        moveCode(state: AccountsState, opts: { from: number; to: number }) {
          state.entries.splice(
            opts.to,
            0,
            state.entries.splice(opts.from, 1)[0],
          );

          for (let i = 0; i < state.entries.length; i++) {
            if (state.entries[i].index !== i) {
              state.entries[i].index = i;
            }
          }
        },
        pinEntry(state: AccountsState, entry: OTPEntryInterface) {
          state.entries[entry.index].pinned = !entry.pinned;
        },
        updateExport(
          state: AccountsState,
          exportData: { [k: string]: OTPEntryInterface },
        ) {
          state.exportData = exportData;
        },
        updateEncExport(
          state: AccountsState,
          data: {
            entries: { [k: string]: OTPEntryInterface };
            keys: Key[];
          },
        ) {
          const keys = data.keys.reduce((prev: { [id: string]: Key }, key) => {
            prev[key.id] = key;
            return prev;
          }, {});
          state.exportEncData = { ...data.entries, ...keys };
        },
        wrongPassword(state: AccountsState) {
          state.wrongPassword = true;
        },
        initComplete(state: AccountsState) {
          state.initComplete = true;
        },
      },
      actions: {
        deleteCode: async (
          state: ActionContext<AccountsState, object>,
          hash: string,
        ) => {
          const index = state.state.entries.findIndex(
            (entry) => entry.hash === hash,
          );
          if (index > -1) {
            state.state.entries.splice(index, 1);
          }
          state.commit(
            "updateExport",
            await EntryStorage.getExport(state.state.entries),
          );
          state.commit("updateEncExport", {
            entries: await EntryStorage.getExport(state.state.entries, true),
            keys: await BrowserStorage.getKeys(),
          });
        },
        addCode: async (
          state: ActionContext<AccountsState, object>,
          entry: OTPEntryInterface,
        ) => {
          state.state.entries.unshift(entry);
          state.commit(
            "updateExport",
            await EntryStorage.getExport(state.state.entries),
          );
          state.commit("updateEncExport", {
            entries: await EntryStorage.getExport(state.state.entries, true),
            keys: await BrowserStorage.getKeys(),
          });
        },
        applyPassphrase: async (
          state: ActionContext<AccountsState, object>,
          password: string,
        ) => {
          if (!password) {
            return;
          }

          state.commit("currentView/changeView", "LoadingPage", { root: true });

          try {
            // Decrypt entries
            const unlocked = await unlock(password);
            if (unlocked) {
              for (const [keyId, encryption] of unlocked.encryptions) {
                state.state.encryption.set(keyId, encryption);
              }
              state.state.defaultEncryption = unlocked.defaultKeyId;
            }

            await state.dispatch("updateEntries");

            if (!unlocked) {
              state.commit("wrongPassword");
              state.commit("currentView/changeView", "EnterPasswordPage", {
                root: true,
              });
              return;
            }

            const defaultEncryption = unlocked.encryptions.get(
              unlocked.defaultKeyId,
            );
            if (!defaultEncryption) {
              throw new Error(
                "defaultEncryption is empty, this should never happen!",
              );
            }
            if (await adoptEntries(state.state.entries, defaultEncryption)) {
              await state.dispatch("updateEntries");
            }

            if (!state.getters.currentlyEncrypted) {
              chrome.runtime.sendMessage({
                action: "cachePassphrase",
                value: unlocked.passphrase,
                keyId: unlocked.defaultKeyId,
              });
            }

            state.commit("style/hideInfo", true, { root: true });
          } catch (error) {
            console.error(error);
            state.commit(
              "notification/alert",
              chrome.i18n.getMessage("updateFailure"),
              { root: true },
            );
            state.commit("currentView/changeView", "EnterPasswordPage", {
              root: true,
            });
          }
          return;
        },
        changePassphrase: async (
          state: ActionContext<AccountsState, object>,
          password: string,
        ) => {
          const restoreEntries = async (error: unknown) => {
            await state.dispatch("updateEntries");
            throw error;
          };

          if (password) {
            const { encryption, passphrase } = await setPassword(
              password,
              state.state.entries,
            ).catch(restoreEntries);
            const keyId = encryption.getEncryptionKeyId();

            state.state.encryption.set(keyId, encryption);
            state.state.defaultEncryption = keyId;

            chrome.runtime.sendMessage({
              action: "cachePassphrase",
              value: passphrase,
              keyId,
            });

            await state.dispatch("updateEntries");

            // https://github.com/Authenticator-Extension/Authenticator/issues/412
            if (isChromium) {
              await BrowserStorage.clearLogs();
            }
          } else {
            await removePassword(
              state.state.entries,
              state.state.encryption
                .get(state.state.defaultEncryption)
                ?.getEncryptionKeyId(),
            ).catch(restoreEntries);
            state.state.defaultEncryption = "";

            chrome.runtime.sendMessage({
              action: "lock",
            });

            await state.dispatch("updateEntries");
          }
        },
        updateEntries: async (state: ActionContext<AccountsState, object>) => {
          const entries = await this.getEntries();

          for (const entry of entries) {
            if (entry.keyId) {
              const entryEncryption = state.state.encryption.get(entry.keyId);
              if (entryEncryption) {
                await entry.applyEncryption(entryEncryption);
              }
            }
          }

          await upgradeLegacyEntries(entries);

          state.commit("loadCodes", entries);
          state.commit("updateCodes");
          state.commit(
            "updateExport",
            await EntryStorage.getExport(state.state.entries),
          );
          state.commit("updateEncExport", {
            entries: await EntryStorage.getExport(state.state.entries, true),
            keys: await BrowserStorage.getKeys(),
          });
          state.commit("initComplete");
          await state.dispatch("showSearchIfNeeded");
          return;
        },
        showSearchIfNeeded: (state: ActionContext<AccountsState, object>) => {
          if (
            state.state.entries.length >= 10 &&
            !(state.getters.shouldFilter && state.state.filter)
          ) {
            state.commit("showSearch");
          }
        },
        clearFilter: (state: ActionContext<AccountsState, object>) => {
          state.commit("stopFilter");
          if (state.state.entries.length >= 10) {
            state.commit("showSearch");
          }
        },
        migrateStorage: async (
          state: ActionContext<AccountsState, object>,
          newStorageLocation: string,
        ) => {
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
        },
      },
      namespaced: true,
    };
  }

  private async getCachedKeyInfo() {
    const { cachedPassphrase, cachedKeyId } =
      await chrome.storage.session.get();

    return { cachedPassphrase, cachedKeyId };
  }

  private async getEntries() {
    const otpEntries = await EntryStorage.get();
    return otpEntries;
  }
}
