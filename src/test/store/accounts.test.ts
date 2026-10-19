import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import { createLocalVue } from "@vue/test-utils";
import Vuex, { Store } from "vuex";

import { Accounts } from "../../store/Accounts";
import { Encryption } from "../../models/encryption";
import { EntryStorage } from "../../models/storage";
import { UserSettings } from "../../models/settings";
import { resetStorage } from "../storage-helper";

chai.should();
mocha.setup("bdd");
const localVue = createLocalVue();
localVue.use(Vuex);

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
  return new Vuex.Store({
    modules: {
      accounts: await new Accounts().getModule(),
      currentView: {
        namespaced: true,
        mutations: { changeView: sinon.fake() },
      },
      style: {
        namespaced: true,
        mutations: { hideInfo: sinon.fake() },
      },
    },
  });
}

function accountsState(store: Store<unknown>) {
  return (store.state as { accounts: AccountsState }).accounts;
}

function decryptStoredAccounts(
  stored: { [hash: string]: OTPStorage },
  encryption: EncryptionInterface,
) {
  const accounts: { [hash: string]: string } = {};
  for (const hash of Object.keys(stored)) {
    const item = stored[hash];
    if (item.dataType === "EncOTPStorage") {
      const data = encryption.decryptEncSecret({
        encData: item.data,
      } as OTPEntryInterface);
      accounts[hash] = data?.account ?? "";
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
        const module = await new Accounts().getModule();
        UserSettings.items.offset = offset;
        clock = sinon.useFakeTimers({
          now: new Date(2026, 0, 1, 12, 0, seconds).getTime(),
          toFake: ["Date"],
        });

        module.mutations.updateCodes(module.state as unknown as AccountsState);

        module.state.second.should.equal(expected);
      });
    }
  });

  describe("search", () => {
    const KEY_ID = "search-key";
    const PASSPHRASE = "search-passphrase";

    async function storeEncryptedEntries(count: number) {
      const data: { [hash: string]: RawOTPStorage } = {};
      for (let i = 0; i < count; i++) {
        const hash = crypto.randomUUID();
        data[hash] = rawEntry(hash, `user${i}`, i);
      }
      await chrome.storage.local.set({ [KEY_ID]: key(KEY_ID) });
      await EntryStorage.import(new Encryption(PASSPHRASE, KEY_ID), data);
    }

    async function enterPassword(store: Store<unknown>) {
      const state = accountsState(store);
      state.entries.should.have.lengthOf(0);
      state.encryption.set(KEY_ID, new Encryption(PASSPHRASE, KEY_ID));
      await store.dispatch("accounts/updateEntries");
      return state;
    }

    it("should show the search box after the password is entered with 10 accounts", async () => {
      await storeEncryptedEntries(10);
      const state = await enterPassword(await createStore());

      state.entries.should.have.lengthOf(10);
      state.showSearch.should.equal(true);
    });

    it("should not show the search box after the password is entered with 9 accounts", async () => {
      await storeEncryptedEntries(9);
      const state = await enterPassword(await createStore());

      state.entries.should.have.lengthOf(9);
      state.showSearch.should.equal(false);
    });
  });

  describe("password", function () {
    this.timeout(10000);
    let argonSandbox: HTMLIFrameElement;

    before(async () => {
      argonSandbox = document.createElement("iframe");
      argonSandbox.id = "argon-sandbox";
      argonSandbox.src = chrome.runtime.getURL("view/argon.html");
      argonSandbox.style.display = "none";
      await new Promise((resolve) => {
        argonSandbox.addEventListener("load", resolve);
        document.body.appendChild(argonSandbox);
      });
    });

    after(() => {
      argonSandbox.remove();
    });

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
      await chrome.storage.local.set({ [keyA]: key(keyA), [keyB]: key(keyB) });
      await EntryStorage.import(new Encryption("passphrase-a", keyA), {
        [hashA]: rawEntry(hashA, "alice", 0),
      });
      await EntryStorage.import(new Encryption("passphrase-b", keyB), {
        [hashB]: rawEntry(hashB, "bob", 1),
      });
      const storedB = (await chrome.storage.local.get())[hashB];

      const store = await createStore();
      const state = accountsState(store);
      state.encryption.set(keyA, new Encryption("passphrase-a", keyA));
      state.defaultEncryption = keyA;
      await store.dispatch("accounts/updateEntries");
      await store.dispatch("accounts/changePassphrase", "new password");

      const stored = await chrome.storage.local.get();
      chai.expect(stored[keyB]).to.deep.equal(key(keyB));
      chai.expect(stored[hashB]).to.deep.equal(storedB);
      decryptStoredAccounts(
        { [hashB]: stored[hashB] },
        new Encryption("passphrase-b", keyB),
      ).should.deep.equal({ [hashB]: "bob" });
    });

    it("should give a new ID only to an account with an old ID on password change", async () => {
      const uuid = crypto.randomUUID();
      await chrome.storage.local.set({
        [OLD_HASH]: { ...rawEntry(OLD_HASH, "old", 0), dataType: "OTPStorage" },
        [uuid]: { ...rawEntry(uuid, "new", 1), dataType: "OTPStorage" },
      });

      const store = await createStore();
      await store.dispatch("accounts/changePassphrase", "new password");

      const state = accountsState(store);
      const encryption = state.encryption.get(state.defaultEncryption);
      chai.expect(encryption).to.not.equal(undefined);
      const stored = await chrome.storage.local.get();
      chai.expect(stored[OLD_HASH]).to.equal(undefined);
      const accounts = decryptStoredAccounts(
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
      await (
        await createStore()
      ).dispatch("accounts/changePassphrase", "right password");

      const store = await createStore();
      const state = accountsState(store);
      state.shouldShowPassphrase.should.equal(true);

      await store.dispatch("accounts/applyPassphrase", "wrong password");
      state.wrongPassword.should.equal(true);
      chai.expect(state.defaultEncryption).to.equal(undefined);
      state.entries.should.have.lengthOf(1);
      chai.expect(state.entries[0].secret).to.equal(null);

      await store.dispatch("accounts/applyPassphrase", "right password");
      chai
        .expect(state.encryption.get(state.defaultEncryption))
        .to.not.equal(undefined);
      state.entries.should.have.lengthOf(1);
      state.entries[0].account.should.equal("alice");
      chai.expect(state.entries[0].secret).to.equal(SECRET);
    });
  });
});
