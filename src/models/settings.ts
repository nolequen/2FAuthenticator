export enum StorageLocation {
  Sync = "sync",
  Local = "local",
}

interface UserSettingsData {
  // local settings
  lastRemindingBackupTime?: number;
  offset?: number;
  storageLocation?: StorageLocation;

  // syncable settings
  autofill?: boolean;
  autolock?: number;
  siteIcons?: boolean;
  siteIconsOff?: string[];
  smartFilter?: boolean;
  theme?: string;
}

// Maybe we can have a better way to define this
const LocalUserSettingsDataKeys = [
  "lastRemindingBackupTime",
  "offset",
  "storageLocation",
];

const LegacyUserSettingsDataKeys = [
  "advisorIgnoreList",
  "driveEncrypted",
  "driveFolder",
  "driveRefreshToken",
  "driveRevoked",
  "driveToken",
  "dropboxEncrypted",
  "dropboxRevoked",
  "dropboxToken",
  "enableContextMenu",
  "encodedPhrase",
  "oneDriveBusiness",
  "oneDriveEncrypted",
  "oneDriveRevoked",
  "oneDriveRefreshToken",
  "oneDriveToken",
  "zoom",
];

export class UserSettings {
  static items: UserSettingsData = {};

  static async updateItems() {
    UserSettings.items = await UserSettings.getAllItems();
  }

  static async commitItems() {
    for (const key of LegacyUserSettingsDataKeys) {
      delete UserSettings.items[key as keyof UserSettingsData];
    }

    const storageLocation =
      UserSettings.items.storageLocation || StorageLocation.Local;

    if (storageLocation === StorageLocation.Local) {
      await chrome.storage[storageLocation].set({
        // JSON.parse(JSON.stringify()) strips functions (e.g. getItem, setItem, ...) which may have been added to the object.
        // Without this, a crash may occur as chrome.storage throws an error when trying to serialize a function.
        UserSettings: JSON.parse(JSON.stringify(UserSettings.items)),
      });
    } else {
      const { syncableSettings, localSettings } = UserSettings.splitSettings(
        UserSettings.items,
      );

      await Promise.all([
        chrome.storage[StorageLocation.Local].set({
          UserSettings: JSON.parse(JSON.stringify(localSettings)),
        }),
        chrome.storage[StorageLocation.Sync].set({
          UserSettings: JSON.parse(JSON.stringify(syncableSettings)),
        }),
      ]);
    }

    await UserSettings.updateItems();
  }

  private static async getStorageData(location: StorageLocation) {
    const storageData: UserSettingsData =
      (await chrome.storage[location].get("UserSettings"))?.UserSettings || {};

    return storageData;
  }

  private static splitSettings(storageData: UserSettingsData) {
    const syncableSettings: UserSettingsData = Object.assign({}, storageData);
    const localSettings: UserSettingsData = Object.assign({}, storageData);

    let key: keyof UserSettingsData;
    for (key in storageData) {
      if (LocalUserSettingsDataKeys.includes(key)) {
        delete syncableSettings[key];
      } else {
        delete localSettings[key];
      }
    }

    return {
      syncableSettings,
      localSettings,
    };
  }

  private static async getAllItems() {
    const localSettings = await UserSettings.getStorageData(
      StorageLocation.Local,
    );
    const storageLocation =
      localSettings.storageLocation || StorageLocation.Local;

    if (storageLocation === StorageLocation.Local) {
      return localSettings;
    }

    const syncableSettings = await UserSettings.getStorageData(
      StorageLocation.Sync,
    );
    return { ...syncableSettings, ...localSettings };
  }
}
