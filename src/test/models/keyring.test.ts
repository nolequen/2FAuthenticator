import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import * as CryptoJS from "crypto-js";
import argon2 from "argon2-browser";
import { createPinia, setActivePinia } from "pinia";

import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import {
  loadEntries,
  setPassword,
  unlock,
  upgradeLegacyEntries,
} from "../../models/keyring";
import { importUnderSession } from "../../models/session";
import { BrowserStorage, EntryStorage } from "../../models/storage";
import { V3_FIXTURE, V3_FIXTURE_ENTRIES } from "../fixtures/v3-storage";
import {
  BROKEN_KEYS,
  V3_KEY,
  V3_KEY_ID,
  entryCodes,
  expectFixtureAccounts,
  fixtureCodes,
  storeV3Fixture,
} from "../fixture-helper";
import {
  cacheSessionKey,
  clearSession,
  holdStorageLock,
  randomPassphrase,
  resetStorage,
  storeKey,
  waitForStorageLockRequests,
} from "../storage-helper";

mocha.setup("bdd");

const HOTP_HASH = "0d9b7e14-3c2a-4f58-8e61-7a4b2c9d3e02";
let changeView: sinon.SinonStub;
let alert: sinon.SinonStub;

async function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  changeView = sinon.stub(useCurrentViewStore(pinia), "changeView");
  alert = sinon.stub(useNotificationStore(pinia), "alert");
  sinon.stub(useStyleStore(pinia), "hideInfo");
  const accounts = useAccountsStore(pinia);
  await accounts.init();
  return accounts;
}

async function createCachedStore() {
  await chrome.storage.session.set({
    cachedPassphrase: V3_FIXTURE.passphrase,
    cachedKeyId: V3_KEY_ID,
  });
  return createStore();
}

async function storedItems() {
  const stored = await chrome.storage.local.get();
  delete stored.UserSettings;
  return stored as { [key: string]: EncOTPStorage | RawOTPStorage | Key };
}

async function storedAccounts(stored: {
  [key: string]: EncOTPStorage | RawOTPStorage | Key;
}) {
  const items: { [hash: string]: EncOTPStorage } = {};
  for (const hash of Object.keys(stored)) {
    const item = stored[hash];
    if (item.dataType === "EncOTPStorage") {
      items[hash] = item;
    }
  }
  return items;
}

async function encryptedAccount(
  encryption: Encryption,
  index: number,
): Promise<EncOTPStorage> {
  const hash = crypto.randomUUID();
  return {
    dataType: "EncOTPStorage",
    keyId: encryption.getEncryptionKeyId(),
    index,
    data: await encryption.encrypt(
      JSON.stringify({
        dataType: "OTPStorage",
        encrypted: true,
        hash,
        index,
        type: "totp",
        secret: "JBSWY3DPEHPK3PXP",
        account: "synced",
      }),
    ),
  };
}

async function unlockedFixtureStore() {
  await storeV3Fixture();
  const store = await createStore();
  await store.applyPassphrase(V3_FIXTURE.password);
  return store;
}

async function decryptedEntries(passphrase: string, keyId: string) {
  const entries = await EntryStorage.get();
  const encryption = new Encryption(passphrase, keyId);
  for (const entry of entries) {
    await entry.applyEncryption(encryption);
    chai.expect(entry.legacyData).to.equal(undefined);
  }
  return entries;
}

describe("keyring", function () {
  this.timeout(20000);

  beforeEach(async () => {
    await resetStorage();
    await clearSession();
    sinon.replace(
      chrome.runtime,
      "sendMessage",
      sinon.fake() as unknown as typeof chrome.runtime.sendMessage,
    );
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
  });

  describe("unlock", () => {
    it("should unlock with a malformed encrypted account in the storage", async () => {
      await storeV3Fixture();
      await chrome.storage.local.set({
        [crypto.randomUUID()]: {
          dataType: "EncOTPStorage",
          keyId: V3_KEY_ID,
          data: "",
          index: 9,
        },
      });
      const store = await createStore();

      await store.applyPassphrase(V3_FIXTURE.password);

      alert.called.should.equal(false);
      store.defaultEncryption.should.equal(V3_KEY_ID);
    });

    it("should unlock the v3 fixture with its password", async () => {
      await storeV3Fixture();

      const unlocked = await unlock(V3_FIXTURE.password);

      chai.expect(unlocked).to.not.equal(null);
      unlocked?.defaultKeyId.should.equal(V3_KEY_ID);
      unlocked?.passphrase.should.equal(V3_FIXTURE.passphrase);
      Array.from(unlocked?.encryptions.keys() ?? []).should.deep.equal([
        V3_KEY_ID,
      ]);
    });

    it("should not unlock with a wrong password and not change the storage", async () => {
      await storeV3Fixture();
      const before = await storedItems();

      chai.expect(await unlock("wrong password")).to.equal(null);
      (await storedItems()).should.deep.equal(before);
    });

    it("should unlock the fixture next to broken keys", async () => {
      await storeV3Fixture();
      const broken: { [id: string]: Key } = {};
      for (const name of Object.keys(BROKEN_KEYS)) {
        const id = crypto.randomUUID();
        broken[id] = { ...BROKEN_KEYS[name], id };
      }
      await chrome.storage.local.set(broken);

      const unlocked = await unlock(V3_FIXTURE.password);

      chai.expect(unlocked).to.not.equal(null);
      unlocked?.defaultKeyId.should.equal(V3_KEY_ID);
      unlocked?.encryptions.size.should.equal(1);

      await chrome.storage.local.remove(V3_KEY_ID);
      chai.expect(await unlock(V3_FIXTURE.password)).to.equal(null);
    });

    it("should show an argon2 failure and return to the password page", async () => {
      await storeV3Fixture();
      const before = await storedItems();
      sinon.stub(argon2, "verify").rejects({ code: -22, message: "memory" });

      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);

      store.wrongPassword.should.equal(false);
      alert.should.have.property("calledOnce", true);
      chai.expect(changeView.lastCall.args[0]).to.equal("EnterPasswordPage");
      (await storedItems()).should.deep.equal(before);
    });

    it("should use the key with the lowest ID as the default key", async () => {
      const first = await createKey("same password");
      const second = await createKey("same password");
      await chrome.storage.local.set({
        [first.key.id]: first.key,
        [second.key.id]: second.key,
      });

      const unlocked = await unlock("same password");

      unlocked?.encryptions.size.should.equal(2);
      unlocked?.defaultKeyId.should.equal(
        first.key.id < second.key.id ? first.key.id : second.key.id,
      );
    });
  });

  describe("upgrade of v3 accounts", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    it("should write the upgrade only after the storage lock is released", async () => {
      await storeV3Fixture();
      const before = await storedItems();
      const entries = await loadEntries(
        new Map([
          [V3_KEY_ID, new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID)],
        ]),
      );
      const changed = await encryptedAccount(
        new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
        0,
      );
      const release = await holdStorageLock();
      const upgrading = upgradeLegacyEntries(entries);
      try {
        await waitForStorageLockRequests();
        (await storedItems()).should.deep.equal(before);
        await chrome.storage.local.set({ [HOTP_HASH]: changed });
      } finally {
        await release();
      }

      await upgrading;
      const stored = await storedItems();
      chai.expect(stored[HOTP_HASH]).to.deep.equal(changed);
      chai
        .expect(entries.find((entry) => entry.hash === HOTP_HASH)?.legacyData)
        .to.not.equal(undefined);
      const accounts = await storedAccounts(stored);
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        if (hash !== HOTP_HASH) {
          accounts[hash].data.should.match(/^v4:/);
        }
      }
    });

    it("should upgrade the accounts to v4 when the popup opens from the cached key", async () => {
      await storeV3Fixture();
      clock = sinon.useFakeTimers({
        now: 1700000000 * 1000,
        toFake: ["Date"],
      });
      const codes = fixtureCodes();

      const store = await createCachedStore();
      await store.updateEntries();

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.deep.equal(V3_KEY);
      const accounts = await storedAccounts(stored);
      Object.keys(accounts).should.have.members(
        Object.keys(V3_FIXTURE_ENTRIES),
      );
      for (const hash of Object.keys(accounts)) {
        accounts[hash].data.should.match(/^v4:/);
        accounts[hash].keyId.should.equal(V3_KEY_ID);
        accounts[hash].index.should.equal(V3_FIXTURE_ENTRIES[hash].index);
      }

      expectFixtureAccounts(store.entries);
      entryCodes(store.entries).should.deep.equal(codes);
      const reread = await decryptedEntries(V3_FIXTURE.passphrase, V3_KEY_ID);
      expectFixtureAccounts(reread);
      entryCodes(reread).should.deep.equal(codes);
    });

    it("should upgrade the accounts to v4 after the password is entered", async () => {
      await storeV3Fixture();

      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);

      store.defaultEncryption.should.equal(V3_KEY_ID);
      expectFixtureAccounts(store.entries);
      const accounts = await storedAccounts(await storedItems());
      for (const hash of Object.keys(accounts)) {
        accounts[hash].data.should.match(/^v4:/);
      }
      expectFixtureAccounts(
        await decryptedEntries(V3_FIXTURE.passphrase, V3_KEY_ID),
      );
    });

    it("should keep the v3 accounts and retry when the storage cannot be written", async () => {
      await storeV3Fixture();
      const before = await storedItems();
      const set = sinon.stub(BrowserStorage, "set").rejects(new Error("quota"));

      const store = await createCachedStore();
      await store.updateEntries();

      set.should.have.property("calledOnce", true);
      (await storedItems()).should.deep.equal(before);
      expectFixtureAccounts(store.entries);

      set.restore();
      await store.updateEntries();

      const accounts = await storedAccounts(await storedItems());
      for (const hash of Object.keys(accounts)) {
        accounts[hash].data.should.match(/^v4:/);
      }
    });

    it("should not overwrite an account that changed in the storage after it was read", async () => {
      await storeV3Fixture();
      const encryption = new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID);
      const entries = await EntryStorage.get();
      for (const entry of entries) {
        await entry.applyEncryption(encryption);
      }
      const changedData = CryptoJS.AES.encrypt(
        JSON.stringify({ ...V3_FIXTURE_ENTRIES[HOTP_HASH], counter: 6 }),
        V3_FIXTURE.passphrase,
      ).toString();
      await chrome.storage.local.set({
        [HOTP_HASH]: {
          ...V3_FIXTURE.storage[HOTP_HASH],
          data: changedData,
        },
      });

      await upgradeLegacyEntries(entries);

      const accounts = await storedAccounts(await storedItems());
      accounts[HOTP_HASH].data.should.equal(changedData);
      for (const hash of Object.keys(accounts)) {
        if (hash !== HOTP_HASH) {
          accounts[hash].data.should.match(/^v4:/);
        }
      }
      const hotp = entries.find((entry) => entry.hash === HOTP_HASH);
      chai
        .expect(hotp?.legacyData)
        .to.equal((V3_FIXTURE.storage[HOTP_HASH] as EncOTPStorage).data);
    });

    it("should upgrade only v3 accounts of the unlocked key", async () => {
      await storeV3Fixture();
      const fixtureEncryption = new Encryption(
        V3_FIXTURE.passphrase,
        V3_KEY_ID,
      );
      const plainHash = crypto.randomUUID();
      const others: { [hash: string]: OTPStorage } = {
        [plainHash]: {
          dataType: "OTPStorage",
          encrypted: false,
          hash: plainHash,
          index: 4,
          type: "totp",
          secret: "JBSWY3DPEHPK3PXP",
        },
        [crypto.randomUUID()]: {
          dataType: "EncOTPStorage",
          keyId: "foreign-key",
          index: 5,
          data: CryptoJS.AES.encrypt(
            JSON.stringify({ secret: "JBSWY3DPEHPK3PXP" }),
            randomPassphrase(),
          ).toString(),
        },
        [crypto.randomUUID()]: await encryptedAccount(fixtureEncryption, 6),
      };
      await chrome.storage.local.set(others);

      const store = await createCachedStore();
      await store.updateEntries();

      const stored = await storedItems();
      for (const hash of Object.keys(others)) {
        chai.expect(stored[hash]).to.deep.equal(others[hash]);
      }
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        (stored[hash] as EncOTPStorage).data.should.match(/^v4:/);
      }
    });

    it("should not write anything when an upgraded account does not match", async () => {
      await storeV3Fixture();
      const before = await storedItems();
      const fixtureEncryption = new Encryption(
        V3_FIXTURE.passphrase,
        V3_KEY_ID,
      );
      sinon
        .stub(EntryStorage, "getOTPStorageFromEntry")
        .callsFake(async (entry) => ({
          dataType: "EncOTPStorage",
          keyId: V3_KEY_ID,
          index: entry.index,
          data: await fixtureEncryption.encrypt(
            JSON.stringify({
              ...V3_FIXTURE_ENTRIES[entry.hash],
              secret: "GEZDGNBVGY3TQOJQ",
            }),
          ),
        }));

      const store = await createCachedStore();
      await store.updateEntries();

      (await storedItems()).should.deep.equal(before);
      expectFixtureAccounts(store.entries);
    });

    it("should not write the storage again after the upgrade", async () => {
      await storeV3Fixture();
      const store = await createCachedStore();
      await store.updateEntries();
      const upgraded = await storedItems();
      const set = sinon.spy(BrowserStorage, "set");

      await store.updateEntries();

      set.should.have.property("called", false);
      (await storedItems()).should.deep.equal(upgraded);
    });
  });

  describe("password change", () => {
    it("should move the accounts to a new key in v4", async () => {
      await storeV3Fixture();
      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);

      await store.changePassphrase("new password");

      const newKeyId = store.defaultEncryption;
      newKeyId.should.not.equal(V3_KEY_ID);
      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      chai.expect(stored[newKeyId]).to.not.equal(undefined);
      const accounts = await storedAccounts(stored);
      Object.keys(accounts).should.have.members(
        Object.keys(V3_FIXTURE_ENTRIES),
      );
      for (const hash of Object.keys(accounts)) {
        accounts[hash].keyId.should.equal(newKeyId);
        accounts[hash].data.should.match(/^v4:/);
      }

      const unlocked = await unlock("new password");
      unlocked?.defaultKeyId.should.equal(newKeyId);
      chai.expect(await unlock(V3_FIXTURE.password)).to.equal(null);
      expectFixtureAccounts(
        await decryptedEntries(unlocked?.passphrase ?? "", newKeyId),
      );
    });

    it("should store the new key only after the storage lock is released", async () => {
      const release = await holdStorageLock();
      const changing = setPassword("new password", new Map(), undefined);
      try {
        await waitForStorageLockRequests();
        (await BrowserStorage.getKeys()).should.have.lengthOf(0);
      } finally {
        await release();
      }

      const { encryption } = await changing;
      (await BrowserStorage.getKeys())
        .map((key) => key.id)
        .should.deep.equal([encryption.getEncryptionKeyId()]);
    });

    it("should let an import that waits for the password change use the new key", async () => {
      await storeKey("old-key");
      await cacheSessionKey("old-key");
      const hash = crypto.randomUUID();
      const release = await holdStorageLock();
      const changing = setPassword("new password", new Map(), "old-key");
      let importing: Promise<boolean> = Promise.resolve(false);
      try {
        await waitForStorageLockRequests();
        importing = importUnderSession({
          [hash]: {
            hash,
            index: 0,
            encrypted: false,
            secret: "JBSWY3DPEHPK3PXP",
            type: "totp",
          },
        });
        await waitForStorageLockRequests(2);
      } finally {
        await release();
      }

      const { encryption } = await changing;
      (await importing).should.equal(true);
      const [entry] = await EntryStorage.get();
      chai.expect(entry.keyId).to.equal(encryption.getEncryptionKeyId());
    });

    it("should keep the accounts under the old key when the new password cannot be saved", async () => {
      const store = await unlockedFixtureStore();
      const set = sinon.stub(EntryStorage, "set").rejects(new Error("quota"));

      let error: unknown;
      try {
        await store.changePassphrase("new password");
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      store.defaultEncryption.should.equal(V3_KEY_ID);
      expectFixtureAccounts(store.entries);
      for (const entry of store.entries) {
        chai.expect(entry.encryption?.getEncryptionKeyId()).to.equal(V3_KEY_ID);
      }

      (await BrowserStorage.getKeys()).should.deep.equal([V3_KEY]);
      set.restore();
      await EntryStorage.set(store.entries);
      chai.expect((await storedItems())[V3_KEY_ID]).to.deep.equal(V3_KEY);
      expectFixtureAccounts(
        await decryptedEntries(V3_FIXTURE.passphrase, V3_KEY_ID),
      );
    });

    it("should use the new key when the old one cannot be removed", async () => {
      const store = await unlockedFixtureStore();
      sinon.stub(BrowserStorage, "remove").rejects(new Error("quota"));

      await store.changePassphrase("new password");

      const newKeyId = store.defaultEncryption;
      newKeyId.should.not.equal(V3_KEY_ID);
      const unlocked = await unlock("new password");
      unlocked?.defaultKeyId.should.equal(newKeyId);
      expectFixtureAccounts(
        await decryptedEntries(unlocked?.passphrase ?? "", newKeyId),
      );
    });

    it("should keep the accounts open in the popup when the storage cannot be rewritten", async () => {
      const store = await unlockedFixtureStore();
      sinon.stub(BrowserStorage, "clearLogs").rejects(new Error("quota"));

      let error: unknown;
      try {
        await store.changePassphrase("new password");
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      store.defaultEncryption.should.not.equal(V3_KEY_ID);
      expectFixtureAccounts(store.entries);
      for (const entry of store.entries) {
        chai
          .expect(entry.encryption?.getEncryptionKeyId())
          .to.equal(store.defaultEncryption);
      }
    });

    it("should move an account that only the storage has to the new key", async () => {
      const store = await unlockedFixtureStore();
      const syncedHash = crypto.randomUUID();
      await chrome.storage.local.set({
        [syncedHash]: await encryptedAccount(
          new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
          4,
        ),
      });

      await store.changePassphrase("new password");

      const newKeyId = store.defaultEncryption;
      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      (stored[syncedHash] as EncOTPStorage).keyId.should.equal(newKeyId);
      const unlocked = await unlock("new password");
      const entries = await decryptedEntries(
        unlocked?.passphrase ?? "",
        newKeyId,
      );
      entries
        .find((entry) => entry.hash === syncedHash)
        ?.account.should.equal("synced");
    });

    it("should store an account that only the storage has open when the password is removed", async () => {
      const store = await unlockedFixtureStore();
      const syncedHash = crypto.randomUUID();
      await chrome.storage.local.set({
        [syncedHash]: await encryptedAccount(
          new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
          4,
        ),
      });

      await store.changePassphrase("");

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      const synced = stored[syncedHash] as RawOTPStorage;
      synced.encrypted.should.equal(false);
      chai.expect(synced.account).to.equal("synced");
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        (stored[hash] as RawOTPStorage).encrypted.should.equal(false);
      }
    });

    it("should move an account added while the password change waits for the lock to the new key", async () => {
      const store = await unlockedFixtureStore();
      const addedHash = crypto.randomUUID();
      const release = await holdStorageLock();
      const changing = store.changePassphrase("new password").then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await waitForStorageLockRequests();
        await chrome.storage.local.set({
          [addedHash]: await encryptedAccount(
            new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
            4,
          ),
        });
      } finally {
        await release();
      }

      chai.expect(await changing).to.equal(undefined);
      const newKeyId = store.defaultEncryption;
      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      (stored[addedHash] as EncOTPStorage).keyId.should.equal(newKeyId);
    });

    it("should not bring back an account deleted while the password change waits for the lock", async () => {
      const store = await unlockedFixtureStore();
      const release = await holdStorageLock();
      const changing = store.changePassphrase("new password").then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await waitForStorageLockRequests();
        await chrome.storage.local.remove(HOTP_HASH);
      } finally {
        await release();
      }

      chai.expect(await changing).to.equal(undefined);
      chai.expect((await storedItems())[HOTP_HASH]).to.equal(undefined);
      store.entries.map((entry) => entry.hash).should.not.include(HOTP_HASH);
    });

    it("should store an account added while the password removal waits for the lock open", async () => {
      const store = await unlockedFixtureStore();
      const addedHash = crypto.randomUUID();
      const release = await holdStorageLock();
      const removing = store.changePassphrase("").then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await waitForStorageLockRequests();
        await chrome.storage.local.set({
          [addedHash]: await encryptedAccount(
            new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
            4,
          ),
        });
      } finally {
        await release();
      }

      chai.expect(await removing).to.equal(undefined);
      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      (stored[addedHash] as RawOTPStorage).encrypted.should.equal(false);
    });

    it("should change the password with an account under a key that is not stored", async () => {
      const store = await unlockedFixtureStore();
      const foreignHash = crypto.randomUUID();
      const foreign = await encryptedAccount(
        new Encryption(randomPassphrase(), "foreign-key"),
        4,
      );
      await chrome.storage.local.set({ [foreignHash]: foreign });

      await store.changePassphrase("new password");

      const newKeyId = store.defaultEncryption;
      newKeyId.should.not.equal(V3_KEY_ID);
      const stored = await storedItems();
      (stored[foreignHash] as EncOTPStorage).data.should.equal(foreign.data);
      (stored[foreignHash] as EncOTPStorage).keyId.should.equal("foreign-key");
      (await BrowserStorage.getKeys())
        .map((key) => key.id)
        .should.deep.equal([newKeyId]);
    });

    it("should set a new password after removing one while an old key is still stored", async () => {
      const store = await createStore();
      await store.changePassphrase("first password");
      const firstKeyId = store.defaultEncryption;
      await store.changePassphrase("second password");
      await store.changePassphrase("");
      (await BrowserStorage.getKeys())
        .map((key) => key.id)
        .should.deep.equal([firstKeyId]);

      await store.changePassphrase("third password");

      const newKeyId = store.defaultEncryption;
      (await BrowserStorage.getKeys())
        .map((key) => key.id)
        .should.have.members([firstKeyId, newKeyId]);
    });

    it("should not change the password when another window changed it first", async () => {
      const stale = await unlockedFixtureStore();
      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);
      await store.changePassphrase("new password");
      const newKeyId = store.defaultEncryption;

      let error: unknown;
      try {
        await stale.changePassphrase("other password");
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      (await BrowserStorage.getKeys())
        .map((key) => key.id)
        .should.deep.equal([newKeyId]);
      const unlocked = await unlock("new password");
      expectFixtureAccounts(
        await decryptedEntries(unlocked?.passphrase ?? "", newKeyId),
      );
    });

    it("should not let a window without a password store the accounts in the open after another window set one", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: {
          dataType: "OTPStorage",
          encrypted: false,
          hash,
          index: 0,
          type: "totp",
          secret: "JBSWY3DPEHPK3PXP",
          account: "alice",
        },
      });
      const stale = await createStore();
      const store = await createStore();
      await store.changePassphrase("new password");

      const entries = stale.entries;
      entries[0].pinned = true;
      let error: unknown;
      try {
        await EntryStorage.set(entries);
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      chai
        .expect((await storedItems())[hash].dataType)
        .to.equal("EncOTPStorage");
    });

    it("should not let a window with the old key write after another window changed the password", async () => {
      const stale = await unlockedFixtureStore();
      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);
      await store.changePassphrase("new password");
      const newKeyId = store.defaultEncryption;

      const entries = stale.entries;
      entries[0].pinned = true;
      let error: unknown;
      try {
        await EntryStorage.set(entries);
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      const unlocked = await unlock("new password");
      expectFixtureAccounts(
        await decryptedEntries(unlocked?.passphrase ?? "", newKeyId),
      );
    });

    it("should store the accounts open and remove the key when the password is removed", async () => {
      await storeV3Fixture();
      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);

      await store.changePassphrase("");

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.equal(undefined);
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        const item = stored[hash] as RawOTPStorage;
        chai.expect(item.dataType).to.equal("OTPStorage");
        item.encrypted.should.equal(false);
      }
      expectFixtureAccounts(await EntryStorage.get());
    });

    it("should keep the key when an account under it could not be decrypted", async () => {
      await storeV3Fixture();
      const broken = {
        ...(V3_FIXTURE.storage[HOTP_HASH] as EncOTPStorage),
        data: "v4:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      };
      await chrome.storage.local.set({ [HOTP_HASH]: broken });
      const store = await createStore();
      await store.applyPassphrase(V3_FIXTURE.password);

      await store.changePassphrase("");

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.deep.equal(V3_KEY);
      chai.expect(stored[HOTP_HASH]).to.deep.equal(broken);
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        if (hash !== HOTP_HASH) {
          (stored[hash] as RawOTPStorage).encrypted.should.equal(false);
        }
      }
    });
  });
});
