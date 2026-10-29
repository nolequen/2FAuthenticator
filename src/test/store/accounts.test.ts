import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import { createPinia, setActivePinia } from "pinia";

import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";
import { Encryption } from "../../models/encryption";
import { EntryStorage } from "../../models/storage";
import { OTPEntry, OTPType } from "../../models/otp";
import { StorageLocation, UserSettings } from "../../models/settings";
import { DRIVE_RECORD } from "../../drive/config";
import {
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import {
  holdStorageLock,
  randomPassphrase,
  resetStorage,
  waitForStorageLockRequests,
} from "../storage-helper";

mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const OLD_HASH = "0123456789abcdef0123456789abcdef";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function key(id: string): Key {
  return {
    dataType: "Key",
    id,
    salt: `salt-${id}`,
    hash: `hash-${id}`,
    version: 3,
  };
}

function rawEntry(hash: string, account: string, index = 0): RawOTPStorage {
  return {
    account,
    issuer: "Example",
    secret: SECRET,
    type: "totp",
    encrypted: false,
    hash,
    index,
  };
}

async function clearSession() {
  await chrome.storage.session.remove([
    "cachedPassphrase",
    "cachedKeyId",
    "contentTabId",
  ]);
}

async function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const accounts = useAccountsStore(pinia);
  await accounts.init();
  return accounts;
}

async function decryptStoredAccounts(
  stored: { [hash: string]: OTPStorage },
  encryption: EncryptionInterface,
) {
  const accounts: { [hash: string]: string } = {};
  for (const hash of Object.keys(stored)) {
    const item = stored[hash];
    if (item.dataType === "EncOTPStorage") {
      const decrypted = await encryption.decrypt(item.data);
      accounts[hash] = decrypted?.data.account ?? "";
    }
  }
  return accounts;
}

describe("Accounts", () => {
  beforeEach(async () => {
    await resetStorage();
    await clearSession();
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
    await resetDrive();
  });

  describe("updateCodes", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    const cases: Array<[number, number, number]> = [
      [0, -61, 59],
      [59, -300, 59],
      [30, 45, 15],
    ];

    for (const [seconds, offset, expected] of cases) {
      it(`should count ${expected} seconds at ${seconds} seconds with offset ${offset}`, async () => {
        const accounts = await createStore();
        UserSettings.items.offset = offset;
        clock = sinon.useFakeTimers({
          now: new Date(2026, 0, 1, 12, 0, seconds).getTime(),
          toFake: ["Date"],
        });

        accounts.updateCodes();

        accounts.second.should.equal(expected);
      });
    }
  });

  describe("password", function () {
    this.timeout(20000);

    beforeEach(() => {
      sinon.replace(
        chrome.runtime,
        "sendMessage",
        sinon.fake() as unknown as typeof chrome.runtime.sendMessage,
      );
    });

    it("should keep the key and the data of an account it could not decrypt", async () => {
      const keyA = crypto.randomUUID();
      const keyB = crypto.randomUUID();
      const hashA = crypto.randomUUID();
      const hashB = crypto.randomUUID();
      const passphraseA = randomPassphrase();
      const passphraseB = randomPassphrase();
      await chrome.storage.local.set({ [keyA]: key(keyA), [keyB]: key(keyB) });
      await EntryStorage.import(new Encryption(passphraseA, keyA), {
        [hashA]: rawEntry(hashA, "alice", 0),
      });
      await EntryStorage.import(new Encryption(passphraseB, keyB), {
        [hashB]: rawEntry(hashB, "bob", 1),
      });
      const storedB = (await chrome.storage.local.get())[hashB];

      const store = await createStore();
      store.encryption.set(keyA, new Encryption(passphraseA, keyA));
      store.defaultEncryption = keyA;
      await store.updateEntries();
      await store.changePassphrase("new password");

      const stored = await chrome.storage.local.get<{
        [hash: string]: OTPStorage;
      }>();
      chai.expect(stored[keyB]).to.deep.equal(key(keyB));
      chai.expect(stored[hashB]).to.deep.equal(storedB);
      (
        await decryptStoredAccounts(
          { [hashB]: stored[hashB] },
          new Encryption(passphraseB, keyB),
        )
      ).should.deep.equal({ [hashB]: "bob" });
    });

    it("should give a new ID only to an account with an old ID on password change", async () => {
      const uuid = crypto.randomUUID();
      await chrome.storage.local.set({
        [OLD_HASH]: { ...rawEntry(OLD_HASH, "old", 0), dataType: "OTPStorage" },
        [uuid]: { ...rawEntry(uuid, "new", 1), dataType: "OTPStorage" },
      });

      const store = await createStore();
      await store.changePassphrase("new password");

      const encryption = store.encryption.get(store.defaultEncryption);
      chai.expect(encryption).to.not.equal(undefined);
      const stored = await chrome.storage.local.get<{
        [hash: string]: OTPStorage;
      }>();
      chai.expect(stored[OLD_HASH]).to.equal(undefined);
      const accounts = await decryptStoredAccounts(
        stored,
        encryption as EncryptionInterface,
      );
      const hashes = Object.keys(accounts);
      hashes.should.have.lengthOf(2);
      accounts[uuid].should.equal("new");
      const newHash = hashes.filter((hash) => hash !== uuid)[0];
      newHash.should.match(UUID_V4);
      accounts[newHash].should.equal("old");
    });

    it("should check the backup reminder only after the right password", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      await (await createStore()).changePassphrase("right password");
      await clearSession();

      const store = await createStore();
      const checkBackupReminder = sinon
        .stub(useNotificationStore(), "checkBackupReminder")
        .resolves();
      const currentView = useCurrentViewStore();
      currentView.lock();

      await store.applyPassphrase("wrong password");
      checkBackupReminder.called.should.equal(false);
      currentView.locked.should.equal(true);
      currentView.busy.should.equal(false);

      await store.applyPassphrase("right password");
      checkBackupReminder.calledOnce.should.equal(true);
      currentView.locked.should.equal(false);
      currentView.busy.should.equal(false);
      store.wrongPassword.should.equal(false);
    });

    it("should unlock the accounts only with the right password", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      await (await createStore()).changePassphrase("right password");
      await clearSession();

      const store = await createStore();
      store.shouldShowPassphrase.should.equal(true);

      await store.applyPassphrase("wrong password");
      store.wrongPassword.should.equal(true);
      chai.expect(store.defaultEncryption).to.equal("");
      chai.expect(store.entries).to.have.lengthOf(1);
      chai.expect(store.entries[0].secret).to.equal(null);

      await store.applyPassphrase("right password");
      chai
        .expect(store.encryption.get(store.defaultEncryption))
        .to.not.equal(undefined);
      chai.expect(store.entries).to.have.lengthOf(1);
      store.entries[0].account.should.equal("alice");
      chai.expect(store.entries[0].secret).to.equal(SECRET);
    });
  });

  describe("migrateStorage", () => {
    it("should move the accounts to sync only after the storage lock is released", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      const store = await createStore();
      const release = await holdStorageLock();
      const migrating = store.migrateStorage(StorageLocation.Sync).then(
        (result: string) => result,
        (error: unknown) => error,
      );
      try {
        await waitForStorageLockRequests();
        (await chrome.storage.sync.get()).should.deep.equal({});
        chai
          .expect((await chrome.storage.local.get())[hash])
          .to.not.equal(undefined);
        chai
          .expect(UserSettings.items.storageLocation)
          .to.equal(StorageLocation.Local);
      } finally {
        await release();
      }

      chai.expect(await migrating).to.equal("updateSuccess");
      chai
        .expect((await chrome.storage.sync.get())[hash])
        .to.not.equal(undefined);
      chai.expect((await chrome.storage.local.get())[hash]).to.equal(undefined);
    });

    it("should keep the Google Drive connection local when the accounts move to sync", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      const record = await storeDriveRecord(
        driveRecord({ refreshToken: "refresh-token" }),
      );
      const store = await createStore();

      chai
        .expect(await store.migrateStorage(StorageLocation.Sync))
        .to.equal("updateSuccess");

      const sync = await chrome.storage.sync.get();
      chai.expect(sync[hash]).to.not.equal(undefined);
      chai.expect(sync[DRIVE_RECORD]).to.equal(undefined);
      chai.expect(await storedDriveRecord()).to.deep.equal(record);
      chai.expect((await chrome.storage.local.get())[hash]).to.equal(undefined);
    });

    it("should leave the Google Drive connection local when the accounts move back from sync", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        UserSettings: { storageLocation: StorageLocation.Sync },
      });
      await UserSettings.updateItems();
      await chrome.storage.sync.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      const record = await storeDriveRecord();
      const store = await createStore();

      chai
        .expect(await store.migrateStorage(StorageLocation.Local))
        .to.equal("updateSuccess");

      chai.expect(await storedDriveRecord()).to.deep.equal(record);
      chai
        .expect((await chrome.storage.local.get())[hash])
        .to.not.equal(undefined);
      (await chrome.storage.sync.get()).should.deep.equal({});
    });

    it("should migrate by the settings in the storage, not by an older copy in memory", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: { ...rawEntry(hash, "alice", 0), dataType: "OTPStorage" },
      });
      const store = await createStore();
      UserSettings.items.storageLocation = StorageLocation.Sync;

      chai
        .expect(await store.migrateStorage(StorageLocation.Sync))
        .to.equal("updateSuccess");

      chai
        .expect((await chrome.storage.sync.get())[hash])
        .to.not.equal(undefined);
    });
  });

  describe("order", () => {
    async function storeAccounts(...accounts: Array<[string, boolean]>) {
      const items: { [hash: string]: RawOTPStorage } = {};
      accounts.forEach(([account, pinned], index) => {
        const hash = crypto.randomUUID();
        items[hash] = {
          ...rawEntry(hash, account, index),
          dataType: "OTPStorage",
          pinned,
        };
      });
      await chrome.storage.local.set(items);
    }

    function accountNames(entries: OTPEntryInterface[]) {
      return entries.map((entry) => entry.account);
    }

    function names(entries: OTPEntryInterface[]) {
      return entries.map((entry) => entry.account);
    }

    async function storedIndexes(store: { entries: OTPEntryInterface[] }) {
      const stored = await chrome.storage.local.get<{
        [hash: string]: OTPStorage;
      }>();
      const indexes: { [account: string]: number } = {};
      for (const entry of store.entries) {
        indexes[entry.account] = stored[entry.hash].index;
      }
      return indexes;
    }

    it("should store the order of the screen when an account is moved past a pinned one", async () => {
      await storeAccounts(["alice", false], ["bob", false], ["carol", true]);
      const store = await createStore();
      names(store.sections[0].entries).should.deep.equal([
        "carol",
        "alice",
        "bob",
      ]);
      const bob = store.entries.find((entry) => entry.account === "bob");

      await store.moveEntry(
        (bob as OTPEntryInterface).hash,
        { kind: "all", key: "" },
        0,
      );

      names(store.sections[0].entries).should.deep.equal([
        "carol",
        "bob",
        "alice",
      ]);
      (await storedIndexes(store)).should.deep.equal({
        carol: 0,
        bob: 1,
        alice: 2,
      });
      accountNames(await EntryStorage.get()).should.deep.equal([
        "carol",
        "bob",
        "alice",
      ]);
    });

    it("should pin the clicked account after an account was added", async () => {
      await storeAccounts(["alice", false], ["bob", false]);
      const store = await createStore();
      await store.addEntry(
        new OTPEntry({
          type: OTPType.totp,
          index: 0,
          account: "new",
          encrypted: false,
          secret: SECRET,
        }),
      );

      const bob = store.entries.find((entry) => entry.account === "bob");
      await store.togglePin(bob as OTPEntryInterface);

      const pinned: { [account: string]: boolean } = {};
      for (const entry of await EntryStorage.get()) {
        pinned[entry.account] = !!entry.pinned;
      }
      pinned.should.deep.equal({ new: false, alice: false, bob: true });
      names(store.sections[0].entries).should.deep.equal([
        "bob",
        "new",
        "alice",
      ]);
    });

    describe("with groups", () => {
      async function storeGroups(
        ...accounts: Array<[string, string, boolean?]>
      ) {
        const items: { [hash: string]: RawOTPStorage } = {};
        accounts.forEach(([account, group, pinned], index) => {
          const hash = crypto.randomUUID();
          items[hash] = {
            ...rawEntry(hash, account, index),
            dataType: "OTPStorage",
            group,
            pinned,
          };
        });
        await chrome.storage.local.set(items);
        const store = await createStore();
        const menu = useMenuStore();
        await menu.init();
        const find = (name: string) =>
          store.entries.find(
            (entry) => entry.account === name,
          ) as OTPEntryInterface;
        return { store, menu, find };
      }

      function sections(store: {
        sections: {
          name: string;
          kind: string;
          entries: OTPEntryInterface[];
        }[];
      }) {
        return store.sections.map((section) => [
          section.kind === "group" ? section.name : section.kind,
          ...accountNames(section.entries),
        ]);
      }

      async function storedGroups() {
        return (await EntryStorage.get()).map(
          (entry) =>
            `${entry.account}:${entry.group}${entry.pinned ? "*" : ""}`,
        );
      }

      it("should write every account once when an account moves to another group", async () => {
        const { store, find } = await storeGroups(
          ["p", "", true],
          ["w1", "Work"],
          ["w2", "Work"],
          ["h1", "Home"],
          ["n1", ""],
        );
        const set = sinon.spy(EntryStorage, "set");

        (
          await store.moveEntry(
            find("w2").hash,
            { kind: "group", key: "home" },
            0,
          )
        ).should.equal(true);

        set.should.have.been.calledOnce;
        set.firstCall.args[0].should.have.lengthOf(5);
        (await storedGroups()).should.deep.equal([
          "p:*",
          "w1:Work",
          "w2:Home",
          "h1:Home",
          "n1:",
        ]);
        (await storedIndexes(store)).should.deep.equal({
          p: 0,
          w1: 1,
          w2: 2,
          h1: 3,
          n1: 4,
        });
      });

      it("should keep a section collapsed when its first account moves away", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["w2", "Work"],
          ["n1", ""],
        );
        await menu.setCollapsed([find("w1").hash]);

        await store.moveEntry(find("w1").hash, { kind: "none", key: "" }, 1);

        [...menu.collapsed].should.deep.equal([find("w2").hash]);
        chai
          .expect(UserSettings.items.collapsed)
          .to.deep.equal([find("w2").hash]);
      });

      it("should open the section that an account gets into by its group field", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["h1", "Home"],
          ["n1", ""],
        );
        await menu.setCollapsed([find("w1").hash, find("h1").hash]);

        await store.setEntryGroup(find("n1"), " home");

        sections(store).should.deep.equal([
          ["pinned"],
          ["Work", "w1"],
          ["Home", "h1", "n1"],
          ["none"],
        ]);
        find("n1").group.should.equal("Home");
        [...menu.collapsed].should.deep.equal([find("w1").hash]);
      });

      it("should add an account first into its group with one write and no repeated numbers", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["n1", ""],
        );
        await menu.setCollapsed([find("w1").hash]);
        const set = sinon.spy(EntryStorage, "set");

        await store.addEntry(
          new OTPEntry({
            type: OTPType.totp,
            index: 0,
            account: "new",
            encrypted: false,
            secret: SECRET,
            group: "work",
          }),
        );

        set.should.have.been.calledOnce;
        (await storedGroups()).should.deep.equal([
          "new:Work",
          "w1:Work",
          "n1:",
        ]);
        Object.values(await storedIndexes(store))
          .sort()
          .should.deep.equal([0, 1, 2]);
        chai.expect(menu.collapsed).to.have.lengthOf(0);
      });

      it("should keep the state of a renamed group and take the state of the group it merges into", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["h1", "Home"],
        );
        await menu.setCollapsed([find("w1").hash]);

        await store.renameGroup("work", "Job");
        [...menu.collapsed].should.deep.equal([find("w1").hash]);
        sections(store)[1][0].should.equal("Job");

        await store.renameGroup("job", "home");
        sections(store).should.deep.equal([
          ["pinned"],
          ["Home", "h1", "w1"],
          ["none"],
        ]);
        chai.expect(menu.collapsed).to.have.lengthOf(0);
      });

      it("should keep the spelling of the header when its first account moves away and change only the case on rename", async () => {
        const { store, find } = await storeGroups(
          ["w1", "Work"],
          ["w2", "work"],
          ["n1", ""],
        );

        await store.moveEntry(find("w1").hash, { kind: "none", key: "" }, 1);
        (await storedGroups()).should.deep.equal(["w2:Work", "n1:", "w1:"]);

        await store.renameGroup("work", "WORK");
        (await storedGroups()).should.deep.equal(["w2:WORK", "n1:", "w1:"]);
      });

      it("should keep the state of a collapsed group that another group merges into", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["h1", "Home"],
        );
        menu.setCollapsed([find("w1").hash, find("h1").hash]);

        await store.renameGroup("work", "home");

        [...menu.collapsed].should.deep.equal([find("h1").hash]);
      });

      it("should keep the state of a group that merges into a group of pinned accounts only", async () => {
        const { store, menu, find } = await storeGroups(
          ["p", "Home", true],
          ["w1", "Work"],
          ["n1", ""],
        );
        menu.setCollapsed([find("w1").hash]);

        await store.renameGroup("work", "home");

        sections(store).should.deep.equal([
          ["pinned", "p"],
          ["Home", "w1"],
          ["none", "n1"],
        ]);
        [...menu.collapsed].should.deep.equal([find("w1").hash]);
      });

      it("should move the collapsed state to the next account when the first one is deleted", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["n1", ""],
          ["n2", ""],
        );
        const second = find("n2").hash;
        await menu.setCollapsed([find("n1").hash]);

        await store.deleteCode(find("n1").hash);

        [...menu.collapsed].should.deep.equal([second]);
      });

      it("should show a failed write and load the stored order again", async () => {
        const { store, menu, find } = await storeGroups(
          ["w1", "Work"],
          ["n1", ""],
        );
        await menu.setCollapsed([find("w1").hash]);
        sinon.replace(
          EntryStorage,
          "set",
          sinon.fake.rejects(new Error("quota")),
        );
        const alert = sinon.stub(useNotificationStore(), "alert");
        sinon.stub(console, "error");

        (
          await store.moveEntry(find("w1").hash, { kind: "none", key: "" }, 0)
        ).should.equal(false);

        alert.should.have.been.calledOnce;
        sections(store).should.deep.equal([
          ["pinned"],
          ["Work", "w1"],
          ["none", "n1"],
        ]);
        [...menu.collapsed].should.deep.equal([find("w1").hash]);
      });
    });
  });
});
