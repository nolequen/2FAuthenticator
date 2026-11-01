import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import type { Pinia } from "pinia";

import {
  markAndroid,
  openInTab,
  openLinksInTabs,
  openTab,
} from "../../../android";
import { setAndroid } from "../../../browser";
import BackupPage from "../../../components/Popup/BackupPage.vue";
import MainBody from "../../../components/Popup/MainBody.vue";
import MainHeader from "../../../components/Popup/MainHeader.vue";
import MenuPage from "../../../components/Popup/MenuPage.vue";
import PreferencesPage from "../../../components/Popup/PreferencesPage.vue";
import ToggleInput from "../../../components/common/ToggleInput.vue";
import { MASK_DIGIT } from "../../../models/otp";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useDriveStore } from "../../../store/Drive";
import { useMenuStore } from "../../../store/Menu";
import { driveRecord, resetDrive, storeDriveRecord } from "../../drive-helper";
import { resetStorage } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

describe("Popup on a phone", () => {
  let pinia: Pinia;
  let wrapper: VueWrapper | undefined;

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(async () => {
    await resetStorage();
    pinia = createTestPinia();
    setAndroid(true);
    sinon.stub(chrome.storage.onChanged, "addListener");
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    setAndroid(false);
    sinon.restore();
    document.documentElement.classList.remove("android");
    await resetStorage();
    await resetDrive();
  });

  describe("read only", () => {
    it("should have no button to add an account", () => {
      wrapper = mount(MainHeader, mountOptions(pinia));

      wrapper.find("#i-plus").exists().should.equal(false);
      wrapper.find("#i-menu").exists().should.equal(true);
    });

    it("should have no security page in the menu", () => {
      useMenuStore(pinia).version = "1.2.3";
      wrapper = mount(MenuPage, mountOptions(pinia));

      wrapper.find(`[title='${i18n.security}']`).exists().should.equal(false);
      wrapper.find(`[title='${i18n.backup}']`).exists().should.equal(true);
    });

    it("should show only Google Drive on the backup page", async () => {
      useDriveStore(pinia).available = true;
      await storeDriveRecord(
        driveRecord({ client: "desktop", mirror: { keys: {} } }),
      );
      await useDriveStore(pinia).refresh();
      await useAccountsStore(pinia).init();
      wrapper = mount(BackupPage, mountOptions(pinia));
      await flushPromises();

      wrapper.text().should.contain(i18n.mirror_refresh);
      wrapper.text().should.not.contain(i18n.backup_save_header);
      wrapper.text().should.not.contain(i18n.restore_header);
      wrapper.find("a[download]").exists().should.equal(false);
    });

    it("should not offer to keep the accounts in sync storage", () => {
      wrapper = mount(PreferencesPage, mountOptions(pinia));

      wrapper
        .findAllComponents(ToggleInput)
        .map((input) => input.find(".switch-title").text())
        .should.not.include(i18n.browser_sync);
    });

    it("should show the code of a counter based account without the next button", async () => {
      const hash = crypto.randomUUID();
      await chrome.storage.local.set({
        [hash]: {
          dataType: "OTPStorage",
          account: "counter",
          encrypted: false,
          hash,
          index: 0,
          secret: "JBSWY3DPEHPK3PXP",
          type: "hotp",
          counter: 3,
        },
      });
      const accounts = useAccountsStore(pinia);
      await accounts.init();
      await accounts.updateEntries();
      wrapper = mount(MainBody, mountOptions(pinia));
      await flushPromises();

      const card = wrapper.find("a.entry");
      card.find(".counter").exists().should.equal(false);
      card.find(".code").text().should.not.contain(MASK_DIGIT);
      card.classes().should.not.include("no-copy");
    });
  });

  describe("pages in tabs", () => {
    let create: sinon.SinonStub;
    let close: sinon.SinonStub;

    beforeEach(() => {
      create = sinon.stub(chrome.tabs, "create").resolves();
      close = sinon.stub(window, "close");
    });

    function link(attributes: { [name: string]: string }) {
      const anchor = document.createElement("a");
      anchor.href = "https://example.com/page";
      for (const [name, value] of Object.entries(attributes)) {
        anchor.setAttribute(name, value);
      }
      const text = document.createElement("span");
      anchor.appendChild(text);
      return { anchor, text };
    }

    function click(target: Element, defaultPrevented = false) {
      const preventDefault = sinon.fake();
      openInTab({
        target,
        defaultPrevented,
        preventDefault,
      } as unknown as MouseEvent);
      return preventDefault;
    }

    it("should open a link to a new page in a tab and close the popup", async () => {
      const { text } = link({ target: "_blank" });

      const preventDefault = click(text);
      await flushPromises();

      preventDefault.should.have.been.calledOnce;
      create.should.have.been.calledOnceWith({
        url: "https://example.com/page",
      });
      close.should.have.been.calledOnce;
    });

    it("should leave the other links alone", async () => {
      click(link({}).text);
      click(link({ target: "_blank", download: "file.txt" }).text);
      click(link({ target: "_blank" }).text, true);
      await flushPromises();

      create.should.not.have.been.called;
      close.should.not.have.been.called;
    });

    it("should watch the links and mark the page only on a phone", () => {
      const listen = sinon.spy(document, "addEventListener");
      try {
        setAndroid(false);
        openLinksInTabs();
        markAndroid();
        listen.should.not.have.been.calledWith("click");
        document.documentElement.classList
          .contains("android")
          .should.equal(false);

        setAndroid(true);
        openLinksInTabs();
        markAndroid();
        listen.should.have.been.calledOnceWith("click", openInTab);
        document.documentElement.classList
          .contains("android")
          .should.equal(true);
      } finally {
        document.removeEventListener("click", openInTab);
      }
    });

    it("should close the popup after opening a tab only on a phone", async () => {
      await openTab("https://example.com/a");
      close.should.have.been.calledOnce;

      setAndroid(false);
      await openTab("https://example.com/b");
      close.should.have.been.calledOnce;
      create.should.have.been.calledTwice;
    });
  });
});
