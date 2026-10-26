import "mocha";
import "chai/register-should";
import * as sinon from "sinon";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { Pinia } from "pinia";

import BackupPage from "../../../components/Popup/BackupPage.vue";
import { BrowserStorage } from "../../../models/storage";
import { loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { resetStorage } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

describe("BackupPage", () => {
  let blobs: Map<string, Blob>;
  let revoked: string[];

  async function storeAccounts(...accounts: Partial<RawOTPStorage>[]) {
    const items: { [hash: string]: RawOTPStorage } = {};
    accounts.forEach((account, index) => {
      const hash = crypto.randomUUID();
      items[hash] = {
        dataType: "OTPStorage",
        encrypted: false,
        hash,
        index,
        secret: SECRET,
        type: "totp",
        ...account,
      };
    });
    await chrome.storage.local.set(items);
  }

  async function openAccounts() {
    const pinia = createTestPinia();
    await useAccountsStore(pinia).init();
    return pinia;
  }

  async function readTextBackup(wrapper: VueWrapper) {
    await nextTick();
    const link = () => wrapper.find("a[download='authenticator.txt']");
    for (let i = 0; i < 100 && !link().exists(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const blob = blobs.get(link().attributes("href") as string);
    return (blob as Blob).text();
  }

  async function textBackup(pinia: Pinia) {
    const wrapper = mount(BackupPage, mountOptions(pinia));
    const text = await readTextBackup(wrapper);
    wrapper.unmount();
    return text;
  }

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(async () => {
    await resetStorage();
    blobs = new Map();
    revoked = [];
    sinon.replace(
      URL,
      "createObjectURL",
      sinon.fake((blob: Blob) => {
        const url = `blob:test-${blobs.size}`;
        blobs.set(url, blob);
        return url;
      }),
    );
    sinon.replace(
      URL,
      "revokeObjectURL",
      sinon.fake((url: string) => {
        revoked.push(url);
      }),
    );
  });

  afterEach(() => resetStorage());

  it("should give the same text backup when opened twice", async () => {
    await storeAccounts({ issuer: "My Bank", account: "alice" });
    const pinia = await openAccounts();

    const first = await textBackup(pinia);
    const second = await textBackup(pinia);

    second.should.equal(first);
    first.should.equal(
      `otpauth://totp/My%20Bank:alice?secret=${SECRET}&issuer=My%20Bank`,
    );
  });

  it("should back up the accounts as they are when the page is opened again", async () => {
    await storeAccounts(
      { issuer: "My Bank", account: "alice" },
      { issuer: "Counter", account: "bob", type: "hotp", counter: 0 },
    );
    const pinia = await openAccounts();
    const accounts = useAccountsStore(pinia);
    let wrapper: VueWrapper | undefined;
    const open = () => {
      wrapper = mount(BackupPage, mountOptions(pinia));
      return readTextBackup(wrapper);
    };

    (await open())
      .split("\r\n")
      .should.have.members([
        `otpauth://totp/My%20Bank:alice?secret=${SECRET}&issuer=My%20Bank`,
        `otpauth://hotp/Counter:bob?secret=${SECRET}&issuer=Counter&counter=0`,
      ]);
    wrapper?.unmount();

    const [alice, bob] = accounts.entries;
    alice.issuer = "New Bank";
    await bob.next();

    (await open())
      .split("\r\n")
      .should.have.members([
        `otpauth://totp/New%20Bank:alice?secret=${SECRET}&issuer=New%20Bank`,
        `otpauth://hotp/Counter:bob?secret=${SECRET}&issuer=Counter&counter=1`,
      ]);
    wrapper?.unmount();
  });

  it("should revoke the files of the previous backup when the page is opened again", async () => {
    await storeAccounts({ issuer: "My Bank", account: "alice" });
    const pinia = await openAccounts();
    let wrapper: VueWrapper | undefined;
    const open = async () => {
      wrapper = mount(BackupPage, mountOptions(pinia));
      await readTextBackup(wrapper);
      return [...blobs.keys()];
    };

    const first = await open();
    first.should.have.lengthOf(2);
    revoked.should.deep.equal([]);
    wrapper?.unmount();
    revoked.should.have.members(first);

    (await open()).should.have.lengthOf(4);
    wrapper?.unmount();
  });

  it("should revoke the files when the page is closed", async () => {
    await storeAccounts({ issuer: "My Bank", account: "alice" });
    const pinia = await openAccounts();
    const wrapper = mount(BackupPage, mountOptions(pinia));
    await readTextBackup(wrapper);
    blobs.size.should.equal(2);

    wrapper.unmount();

    revoked.should.have.members([...blobs.keys()]);
  });

  it("should not create files when the page is closed before the backup is built", async () => {
    await storeAccounts({ issuer: "My Bank", account: "alice" });
    const pinia = await openAccounts();
    const keys = await BrowserStorage.getKeys();
    let readKeys: () => void = () => undefined;
    const getKeys = sinon.fake(
      () =>
        new Promise<Key[]>((resolve) => {
          readKeys = () => resolve(keys);
        }),
    );
    sinon.replace(BrowserStorage, "getKeys", getKeys);
    const wrapper = mount(BackupPage, mountOptions(pinia));
    for (let i = 0; i < 100 && !getKeys.called; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    getKeys.calledOnce.should.equal(true);

    wrapper.unmount();
    readKeys();
    await new Promise((resolve) => setTimeout(resolve, 50));

    blobs.size.should.equal(0);
  });
});
