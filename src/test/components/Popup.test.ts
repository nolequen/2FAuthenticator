import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { Pinia } from "pinia";

import Popup from "../../components/Popup.vue";
import { OTPEntry, OTPType } from "../../models/otp";
import { loadI18nMessages } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { useQrStore } from "../../store/Qr";
import { createTestPinia, mountOptions } from "../vue-helper";

mocha.setup("bdd");

describe("Popup", () => {
  let pinia: Pinia;
  let wrapper: VueWrapper;

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => {
    pinia = createTestPinia();
    const accounts = useAccountsStore(pinia);
    accounts.entries = [
      new OTPEntry({
        type: OTPType.totp,
        index: 0,
        issuer: "Example",
        account: "alice",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ];
    accounts.completeInit();
    wrapper = mount(Popup, { ...mountOptions(pinia), attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  function isInert(selector: string) {
    const element = wrapper.find(selector);
    chai.expect(element.exists(), selector).to.equal(true);
    return (element.element as HTMLElement).inert;
  }

  function layers() {
    return {
      base: isInert(".base"),
      page: wrapper.find(".page").exists() ? isInert(".page") : undefined,
      lock: wrapper.find(".lock-screen").exists()
        ? isInert(".lock-screen")
        : undefined,
    };
  }

  it("should leave the list open when nothing covers it", () => {
    layers().base.should.equal(false);
  });

  it("should make the list inert under a page", async () => {
    useCurrentViewStore(pinia).open("Menu");
    await nextTick();

    layers().should.deep.equal({ base: true, page: false, lock: undefined });
  });

  it("should make the list and the page inert under the lock screen", async () => {
    const currentView = useCurrentViewStore(pinia);
    currentView.open("Menu");
    await nextTick();
    currentView.lock();
    await nextTick();

    layers().should.deep.equal({ base: true, page: true, lock: false });
  });

  it("should make everything inert while busy", async () => {
    const currentView = useCurrentViewStore(pinia);
    currentView.open("Preferences");
    await nextTick();
    currentView.lock();
    currentView.setBusy(true);
    await nextTick();

    wrapper.find(".busy").exists().should.equal(true);
    layers().should.deep.equal({ base: true, page: true, lock: true });
  });

  it("should make the page inert under the QR code", async () => {
    useCurrentViewStore(pinia).open("Menu");
    useQrStore(pinia).setQr({ url: "data:,", issuer: "Example", account: "" });
    await nextTick();

    layers().should.deep.equal({ base: true, page: true, lock: undefined });
    isInert(".dialog-backdrop").should.equal(false);
  });

  it("should make the QR code inert under a message", async () => {
    useCurrentViewStore(pinia).open("Menu");
    useQrStore(pinia).setQr({ url: "data:,", issuer: "Example", account: "" });
    useNotificationStore(pinia).alert("Message");
    await nextTick();

    const backdrops = wrapper.findAll(".dialog-backdrop");
    backdrops.should.have.lengthOf(2);
    (backdrops[0].element as HTMLElement).inert.should.equal(true);
    (backdrops[1].element as HTMLElement).inert.should.equal(false);
    layers().should.deep.equal({ base: true, page: true, lock: undefined });
  });

  it("should keep a message usable over the lock screen", async () => {
    const currentView = useCurrentViewStore(pinia);
    currentView.lock();
    useNotificationStore(pinia).alert("Message");
    await nextTick();

    layers().should.deep.equal({ base: true, page: undefined, lock: true });
    chai
      .expect(
        (wrapper.find(".dialog").element as HTMLElement).closest("[inert]"),
      )
      .to.equal(null);
  });

  it("should close the QR code with Escape", async () => {
    const qr = useQrStore(pinia);
    qr.setQr({ url: "data:,", issuer: "Example", account: "" });
    await nextTick();

    await wrapper.find(".qr-dialog button").trigger("keydown", {
      key: "Escape",
    });

    chai.expect(qr.qr).to.equal(null);
  });

  async function settle() {
    await nextTick();
    await nextTick();
  }

  it("should return the focus to the card after the page closes", async () => {
    const accounts = useAccountsStore(pinia);
    accounts.entries = [
      ...accounts.entries,
      new OTPEntry({
        type: OTPType.totp,
        index: 1,
        issuer: "Second",
        account: "bob",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ];
    await nextTick();
    const card = wrapper.findAll<HTMLElement>("a.entry")[1].element;
    card.focus();
    const currentView = useCurrentViewStore(pinia);

    currentView.open("Account", accounts.entries[1].hash);
    await settle();
    document.activeElement?.classList.contains("back").should.equal(true);

    currentView.back();
    await settle();

    chai.expect(document.activeElement).to.equal(card);
  });

  it("should make the list inert under the menu of a card and return the focus to the card", async () => {
    const card = wrapper.find<HTMLElement>("a.entry").element;
    card.focus();

    card.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }),
    );
    await settle();

    isInert(".base").should.equal(true);
    isInert(".menu-backdrop").should.equal(false);
    chai
      .expect(document.activeElement)
      .to.equal(wrapper.find("[role='menuitem']").element);

    await wrapper
      .find("[role='menuitem']")
      .trigger("keydown", { key: "Escape" });
    await settle();

    wrapper.find(".menu-backdrop").exists().should.equal(false);
    isInert(".base").should.equal(false);
    chai.expect(document.activeElement).to.equal(card);
  });

  it("should focus the next card after the menu deletes a card", async () => {
    const accounts = useAccountsStore(pinia);
    accounts.entries = [
      ...accounts.entries,
      new OTPEntry({
        type: OTPType.totp,
        index: 1,
        issuer: "Second",
        account: "bob",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ];
    await nextTick();
    sinon.stub(accounts.entries[0], "delete").resolves();
    const card = wrapper.find<HTMLElement>("a.entry").element;
    card.focus();
    card.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();

    await wrapper.findAll("[role='menuitem']")[3].trigger("click");
    await settle();
    await wrapper.find(".dialog .button.danger").trigger("click");
    for (let i = 0; i < 20 && accounts.entries.length > 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await settle();

    accounts.entries.length.should.equal(1);
    chai
      .expect(document.activeElement)
      .to.equal(wrapper.find("a.entry").element);
    document.activeElement?.textContent?.should.contain("Second");
  });

  it("should close the menu of a card when the popup locks", async () => {
    wrapper
      .find<HTMLElement>("a.entry")
      .element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    await settle();
    wrapper.find(".menu-backdrop").exists().should.equal(true);

    useCurrentViewStore(pinia).lock();
    await settle();

    wrapper.find(".menu-backdrop").exists().should.equal(false);
  });

  it("should focus the password field again after a wrong password", async () => {
    const currentView = useCurrentViewStore(pinia);
    currentView.lock();
    await settle();
    const input = wrapper.find<HTMLInputElement>(".lock-screen input").element;
    chai.expect(document.activeElement).to.equal(input);

    currentView.setBusy(true);
    await settle();
    input.blur();
    currentView.setBusy(false);
    await settle();

    chai.expect(document.activeElement).to.equal(input);
  });
});
