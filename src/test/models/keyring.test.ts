import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as CryptoJS from "crypto-js";
import argon2 from "argon2-browser";
import { createLocalVue } from "@vue/test-utils";
import Vuex, { Store } from "vuex";

import { Accounts } from "../../store/Accounts";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { unlock, upgradeLegacyEntries } from "../../models/keyring";
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
import { randomPassphrase, resetStorage } from "../storage-helper";

chai.should();
mocha.setup("bdd");
const localVue = createLocalVue();
localVue.use(Vuex);

const HOTP_HASH = "0d9b7e14-3c2a-4f58-8e61-7a4b2c9d3e02";
let changeView: sinon.SinonSpy;
let alert: sinon.SinonSpy;

async function clearSession() {
  await chrome.storage.session.remove([
    "cachedPassphrase",
    "cachedKeyId",
    "contentTabId",
  ]);
}

async function createStore() {
  changeView = sinon.fake();
  alert = sinon.fake();
  return new Vuex.Store({
    modules: {
      accounts: await new Accounts().getModule(),
      currentView: {
        namespaced: true,
        mutations: { changeView },
      },
      notification: {
        namespaced: true,
        mutations: { alert },
      },
      style: {
        namespaced: true,
        mutations: { hideInfo: sinon.fake() },
      },
    },
  });
}

async function createCachedStore() {
  await chrome.storage.session.set({
    cachedPassphrase: V3_FIXTURE.passphrase,
    cachedKeyId: V3_KEY_ID,
  });
  return createStore();
}

function accountsState(store: Store<unknown>) {
  return (store.state as { accounts: AccountsState }).accounts;
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
  await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);
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
      await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);

      const state = accountsState(store);
      state.wrongPassword.should.equal(false);
      alert.should.have.property("calledOnce", true);
      chai.expect(changeView.lastCall.args[1]).to.equal("EnterPasswordPage");
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

    it("should upgrade the accounts to v4 when the popup opens from the cached key", async () => {
      await storeV3Fixture();
      clock = sinon.useFakeTimers({
        now: 1700000000 * 1000,
        toFake: ["Date"],
      });
      const codes = fixtureCodes();

      const store = await createCachedStore();
      await store.dispatch("accounts/updateEntries");

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

      const state = accountsState(store);
      expectFixtureAccounts(state.entries);
      entryCodes(state.entries).should.deep.equal(codes);
      const reread = await decryptedEntries(V3_FIXTURE.passphrase, V3_KEY_ID);
      expectFixtureAccounts(reread);
      entryCodes(reread).should.deep.equal(codes);
    });

    it("should upgrade the accounts to v4 after the password is entered", async () => {
      await storeV3Fixture();

      const store = await createStore();
      await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);

      const state = accountsState(store);
      state.defaultEncryption.should.equal(V3_KEY_ID);
      expectFixtureAccounts(state.entries);
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
      await store.dispatch("accounts/updateEntries");

      set.should.have.property("calledOnce", true);
      (await storedItems()).should.deep.equal(before);
      expectFixtureAccounts(accountsState(store).entries);

      set.restore();
      await store.dispatch("accounts/updateEntries");

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
      await store.dispatch("accounts/updateEntries");

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
      await store.dispatch("accounts/updateEntries");

      (await storedItems()).should.deep.equal(before);
      expectFixtureAccounts(accountsState(store).entries);
    });

    it("should not write the storage again after the upgrade", async () => {
      await storeV3Fixture();
      const store = await createCachedStore();
      await store.dispatch("accounts/updateEntries");
      const upgraded = await storedItems();
      const set = sinon.spy(BrowserStorage, "set");

      await store.dispatch("accounts/updateEntries");

      set.should.have.property("called", false);
      (await storedItems()).should.deep.equal(upgraded);
    });
  });

  describe("password change", () => {
    it("should move the accounts to a new key in v4", async () => {
      await storeV3Fixture();
      const store = await createStore();
      await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);

      await store.dispatch("accounts/changePassphrase", "new password");

      const state = accountsState(store);
      const newKeyId = state.defaultEncryption;
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

    it("should keep the accounts under the old key when the new password cannot be saved", async () => {
      const store = await unlockedFixtureStore();
      const set = sinon.stub(EntryStorage, "set").rejects(new Error("quota"));

      let error: unknown;
      try {
        await store.dispatch("accounts/changePassphrase", "new password");
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      const state = accountsState(store);
      state.defaultEncryption.should.equal(V3_KEY_ID);
      expectFixtureAccounts(state.entries);
      for (const entry of state.entries) {
        chai.expect(entry.encryption?.getEncryptionKeyId()).to.equal(V3_KEY_ID);
      }

      (await BrowserStorage.getKeys()).should.deep.equal([V3_KEY]);
      set.restore();
      await EntryStorage.set(state.entries);
      chai.expect((await storedItems())[V3_KEY_ID]).to.deep.equal(V3_KEY);
      expectFixtureAccounts(
        await decryptedEntries(V3_FIXTURE.passphrase, V3_KEY_ID),
      );
    });

    it("should use the new key when the old one cannot be removed", async () => {
      const store = await unlockedFixtureStore();
      sinon.stub(BrowserStorage, "remove").rejects(new Error("quota"));

      await store.dispatch("accounts/changePassphrase", "new password");

      const newKeyId = accountsState(store).defaultEncryption;
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
        await store.dispatch("accounts/changePassphrase", "new password");
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      const state = accountsState(store);
      state.defaultEncryption.should.not.equal(V3_KEY_ID);
      expectFixtureAccounts(state.entries);
      for (const entry of state.entries) {
        chai
          .expect(entry.encryption?.getEncryptionKeyId())
          .to.equal(state.defaultEncryption);
      }
    });

    it("should keep the old key for an account that only the storage has", async () => {
      const store = await unlockedFixtureStore();
      const synced = await encryptedAccount(
        new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
        4,
      );
      const syncedHash = crypto.randomUUID();
      await chrome.storage.local.set({ [syncedHash]: synced });

      await store.dispatch("accounts/changePassphrase", "new password");

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.deep.equal(V3_KEY);
      chai.expect(stored[syncedHash]).to.deep.equal(synced);
    });

    it("should keep the key on removal for an account that only the storage has", async () => {
      const store = await unlockedFixtureStore();
      const synced = await encryptedAccount(
        new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID),
        4,
      );
      const syncedHash = crypto.randomUUID();
      await chrome.storage.local.set({ [syncedHash]: synced });

      await store.dispatch("accounts/changePassphrase", "");

      const stored = await storedItems();
      chai.expect(stored[V3_KEY_ID]).to.deep.equal(V3_KEY);
      chai.expect(stored[syncedHash]).to.deep.equal(synced);
      for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
        (stored[hash] as RawOTPStorage).encrypted.should.equal(false);
      }
    });

    it("should store the accounts open and remove the key when the password is removed", async () => {
      await storeV3Fixture();
      const store = await createStore();
      await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);

      await store.dispatch("accounts/changePassphrase", "");

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
      await store.dispatch("accounts/applyPassphrase", V3_FIXTURE.password);

      await store.dispatch("accounts/changePassphrase", "");

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
