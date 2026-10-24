import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { Pinia } from "pinia";

import BackupPage from "../../../components/Popup/BackupPage.vue";
import PageHandler from "../../../components/Popup/PageHandler.vue";
import { loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useStyleStore } from "../../../store/Style";
import { resetStorage } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.should();
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

describe("BackupPage", () => {
  let blobs: Map<string, Blob>;

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
    sinon.replace(
      URL,
      "createObjectURL",
      sinon.fake((blob: Blob) => {
        const url = `blob:test-${blobs.size}`;
        blobs.set(url, blob);
        return url;
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
    const currentView = useCurrentViewStore(pinia);
    const style = useStyleStore(pinia);
    const wrapper = mount(PageHandler, mountOptions(pinia));
    const open = () => {
      style.showInfo();
      currentView.changeView("BackupPage");
      return readTextBackup(wrapper);
    };

    (await open())
      .split("\r\n")
      .should.have.members([
        `otpauth://totp/My%20Bank:alice?secret=${SECRET}&issuer=My%20Bank`,
        `otpauth://hotp/Counter:bob?secret=${SECRET}&issuer=Counter&counter=0`,
      ]);
    await wrapper.find("#infoClose").trigger("click");

    const [alice, bob] = accounts.entries;
    alice.issuer = "New Bank";
    await bob.next();

    (await open())
      .split("\r\n")
      .should.have.members([
        `otpauth://totp/New%20Bank:alice?secret=${SECRET}&issuer=New%20Bank`,
        `otpauth://hotp/Counter:bob?secret=${SECRET}&issuer=Counter&counter=1`,
      ]);
    wrapper.unmount();
  });
});
