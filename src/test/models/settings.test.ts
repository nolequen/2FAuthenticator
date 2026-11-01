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
  "zoom",
];

async function storedSettings(location: StorageLocation) {
  return (
    await chrome.storage[location].get<{ UserSettings: object }>("UserSettings")
  ).UserSettings;
}

describe("UserSettings", () => {
  afterEach(() => resetStorage());

  it("should sync the collapsed sections with the other syncable settings", async () => {
    await resetStorage();
    await chrome.storage.local.set({
      UserSettings: { storageLocation: StorageLocation.Sync },
    });
    await UserSettings.updateItems();

    UserSettings.items.collapsed = ["first-hash"];
    UserSettings.items.siteIconsOff = ["other-hash"];
    await UserSettings.commitItems();

    const sync = await storedSettings(StorageLocation.Sync);
    sync.should.deep.include({
      collapsed: ["first-hash"],
      siteIconsOff: ["other-hash"],
    });
    (await storedSettings(StorageLocation.Local)).should.not.have.property(
      "collapsed",
    );
  });

  it("should merge the lists of another browser and take only the settings this one lacks", () => {
    UserSettings.items = {
      storageLocation: StorageLocation.Local,
      siteIconsOff: ["first-hash"],
      theme: "light",
    };

    UserSettings.mergeItems({
      autofill: true,
      collapsed: "broken" as unknown as string[],
      offset: 30,
      siteIconsOff: ["first-hash", 7 as unknown as string, "second-hash"],
      storageLocation: StorageLocation.Sync,
      theme: "dark",
      zoom: 2,
    } as typeof UserSettings.items);

    UserSettings.items.should.deep.equal({
      autofill: true,
      siteIconsOff: ["first-hash", "second-hash"],
      storageLocation: StorageLocation.Local,
      theme: "light",
    });
  });

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
            zoom: 125,
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
