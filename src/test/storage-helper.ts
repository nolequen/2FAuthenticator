import { StorageLocation, UserSettings } from "../models/settings";

export async function resetStorage(settings: typeof UserSettings.items = {}) {
  await chrome.storage.local.clear();
  if (Object.keys(await chrome.storage.sync.get()).length > 0) {
    await chrome.storage.sync.clear();
  }
  await chrome.storage.local.set({
    UserSettings: { ...settings, storageLocation: StorageLocation.Local },
  });
  await UserSettings.updateItems();
}
