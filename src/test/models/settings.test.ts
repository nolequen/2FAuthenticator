import "mocha";
import "chai/register-should";

import { StorageLocation, UserSettings } from "../../models/settings";
import { resetStorage } from "../storage-helper";

mocha.setup("bdd");

const LEGACY_KEYS = [
  "driveToken",
  "dropboxToken",
  "oneDriveRefreshToken",
  "advisorIgnoreList",
  "enableContextMenu",
  "encodedPhrase",
];

async function storedSettings(location: StorageLocation) {
  return (
    await chrome.storage[location].get<{ UserSettings: object }>("UserSettings")
  ).UserSettings;
}

describe("UserSettings", () => {
  afterEach(() => resetStorage());

  describe("legacy keys", () => {
    for (const location of [StorageLocation.Local, StorageLocation.Sync]) {
      it(`should be dropped on commit with storage location ${location}`, async () => {
        await resetStorage();
        await chrome.storage.local.set({
          UserSettings: {
            storageLocation: location,
            theme: "dark",
            driveToken: "drive-token",
            dropboxToken: "dropbox-token",
            oneDriveRefreshToken: "onedrive-token",
            advisorIgnoreList: ["password_not_set"],
            enableContextMenu: true,
            encodedPhrase: "encoded-phrase",
          },
        });

        await UserSettings.updateItems();
        await UserSettings.commitItems();

        const local = await storedSettings(StorageLocation.Local);
        const sync = (await storedSettings(StorageLocation.Sync)) || {};
        (location === StorageLocation.Sync ? sync : local).should.have.property(
          "theme",
          "dark",
        );
        for (const key of LEGACY_KEYS) {
          local.should.not.have.property(key);
          sync.should.not.have.property(key);
        }
      });
    }
  });
});
