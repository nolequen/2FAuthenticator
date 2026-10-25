import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import { createPinia, setActivePinia } from "pinia";

import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useStyleStore } from "../../store/Style";
import { Encryption } from "../../models/encryption";
import { EntryStorage } from "../../models/storage";
import { OTPEntry, OTPType } from "../../models/otp";
import { StorageLocation, UserSettings } from "../../models/settings";
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
  sinon.stub(useCurrentViewStore(pinia), "changeView");
  sinon.stub(useStyleStore(pinia), "hideInfo");
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

  describe("search", () => {
    const KEY_ID = "search-key";
    const PASSPHRASE = randomPassphrase();

    async function storeEncryptedEntries(count: number) {
      const data: { [hash: string]: RawOTPStorage } = {};
      for (let i = 0; i < count; i++) {
        const hash = crypto.randomUUID();
        data[hash] = rawEntry(hash, `user${i}`, i);
      }
      await chrome.storage.local.set({ [KEY_ID]: key(KEY_ID) });
      await EntryStorage.import(new Encryption(PASSPHRASE, KEY_ID), data);
    }

    async function enterPassword(store: ReturnType<typeof useAccountsStore>) {
      chai.expect(store.entries).to.have.lengthOf(0);
      store.encryption.set(KEY_ID, new Encryption(PASSPHRASE, KEY_ID));
      await store.updateEntries();
      return store;
    }

    it("should show the search box after the password is entered with 10 accounts", async () => {
      await storeEncryptedEntries(10);
      const store = await enterPassword(await createStore());

      chai.expect(store.entries).to.have.lengthOf(10);
      store.showSearch.should.equal(true);
    });

    it("should not show the search box after the password is entered with 9 accounts", async () => {
      await storeEncryptedEntries(9);
      const store = await enterPassword(await createStore());

      chai.expect(store.entries).to.have.lengthOf(9);
      store.showSearch.should.equal(false);
    });
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

    it("should store the order of the screen when an account is moved past a pinned one", async () => {
      await storeAccounts(["alice", false], ["bob", false], ["carol", true]);
      const store = await createStore();
      accountNames(store.orderedEntries).should.deep.equal([
        "carol",
        "alice",
        "bob",
      ]);

      const list = [...store.orderedEntries];
      list.splice(1, 0, list.splice(2, 1)[0]);
      await store.reorderEntries(list);

      accountNames(store.orderedEntries).should.deep.equal([
        "carol",
        "bob",
        "alice",
      ]);
      const stored = await chrome.storage.local.get<{
        [hash: string]: OTPStorage;
      }>();
      const indexes: { [account: string]: number } = {};
      for (const entry of store.entries) {
        indexes[entry.account] = stored[entry.hash].index;
      }
      indexes.should.deep.equal({ carol: 0, bob: 1, alice: 2 });
      accountNames(await EntryStorage.get()).should.deep.equal([
        "carol",
        "bob",
        "alice",
      ]);
    });

    it("should pin the clicked account after an account was added", async () => {
      await storeAccounts(["alice", false], ["bob", false]);
      const store = await createStore();
      store.addCode(
        new OTPEntry({
          type: OTPType.totp,
          index: 0,
          account: "new",
          encrypted: false,
          secret: SECRET,
        }),
      );

      const bob = store.entries.find((entry) => entry.account === "bob");
      store.pinEntry(bob as OTPEntryInterface);

      const pinned: { [account: string]: boolean } = {};
      for (const entry of store.entries) {
        pinned[entry.account] = !!entry.pinned;
      }
      pinned.should.deep.equal({ new: false, alice: false, bob: true });
    });
  });
});
