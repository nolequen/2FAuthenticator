import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";

import EntryComponent from "../../../components/Popup/EntryComponent.vue";
import { CodeState, OTPEntry, OTPType } from "../../../models/otp";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useEntryMenuStore } from "../../../store/EntryMenu";
import { useMenuStore } from "../../../store/Menu";
import { useNotificationStore } from "../../../store/Notification";
import { useStyleStore } from "../../../store/Style";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

function createEntry(type = OTPType.totp, digits = 6) {
  return reactive(
    new OTPEntry({
      type,
      index: 0,
      issuer: "Example",
      account: "alice",
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
      digits,
    }),
  );
}

function mountEntry(entry: OTPEntryInterface) {
  const pinia = createTestPinia();
  const wrapper = mount(EntryComponent, {
    ...mountOptions(pinia),
    props: { entry, tabindex: 0 },
    attachTo: document.body,
  });
  return { pinia, wrapper };
}

describe("EntryComponent", () => {
  let clipboard: HTMLInputElement;
  let execCommand: sinon.SinonStub;
  let request: sinon.SinonSpy;

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => {
    clipboard = document.createElement("input");
    clipboard.id = "codeClipboard";
    document.body.appendChild(clipboard);
    execCommand = sinon.stub(document, "execCommand").returns(true);
    request = sinon.fake();
    sinon.replace(
      chrome.permissions,
      "request",
      request as unknown as typeof chrome.permissions.request,
    );
  });

  afterEach(() => {
    clipboard.remove();
    document.documentElement.classList.remove("kbd");
  });

  describe("next code of a counter based account", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sinon.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "Date"],
      });
    });

    afterEach(() => {
      clock.restore();
    });

    it("should be disabled for 3 seconds after a click", async () => {
      const entry = createEntry(OTPType.hotp);
      const next = sinon.stub(entry, "next").resolves();
      const { wrapper } = mountEntry(entry);
      clock.tick(1);
      const counter = wrapper.find(".counter");
      counter.classes().should.not.include("disabled");

      await counter.trigger("click");
      await nextTick();
      counter.classes().should.include("disabled");
      await counter.trigger("click");
      next.should.have.been.calledOnce;

      clock.tick(2999);
      await nextTick();
      counter.classes().should.include("disabled");
      clock.tick(1);
      await nextTick();
      counter.classes().should.not.include("disabled");
      await counter.trigger("click");
      next.should.have.been.calledTwice;
      wrapper.unmount();
    });
  });

  describe("copy", () => {
    it("should not copy the code of a counter based account before the first click on next", async () => {
      const entry = createEntry(OTPType.hotp);
      const { wrapper } = mountEntry(entry);
      const link = wrapper.find("a.entry");
      wrapper.find(".code").text().should.equal("••• •••");
      link.classes().should.include("no-copy");
      await link.trigger("click");
      execCommand.should.not.have.been.called;

      entry.code = "123456";
      await nextTick();
      wrapper.find(".code").text().should.equal("123 456");
      link.classes().should.not.include("no-copy");
      await link.trigger("click");
      execCommand.should.have.been.calledOnceWith("Copy");
      clipboard.value.should.equal("123456");
      wrapper.unmount();
    });

    it("should copy the code without asking for a permission", async () => {
      const entry = createEntry();
      entry.code = "123456";
      const { pinia, wrapper } = mountEntry(entry);
      const toast = sinon.stub(useNotificationStore(pinia), "ephermalMessage");
      const card = wrapper.find("a.entry").element as HTMLElement;
      card.focus();

      await wrapper.find("a.entry").trigger("click");

      execCommand.should.have.been.calledOnceWith("Copy");
      request.should.not.have.been.called;
      toast.should.have.been.calledOnceWith(i18n.copied);
      chai.expect(document.activeElement).to.equal(card);
      wrapper.unmount();
    });

    it("should highlight the card for a moment after copying", async () => {
      const entry = createEntry();
      entry.code = "123456";
      const { wrapper } = mountEntry(entry);
      const card = wrapper.find("a.entry");

      await card.trigger("click");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await nextTick();
      card.classes().should.include("copied");

      await new Promise((resolve) => setTimeout(resolve, 600));
      card.classes().should.not.include("copied");
      wrapper.unmount();
    });

    it("should copy the code with Enter", async () => {
      const entry = createEntry();
      entry.code = "123456";
      const { wrapper } = mountEntry(entry);
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });

      wrapper.find("a.entry").element.dispatchEvent(event);

      execCommand.should.have.been.calledOnceWith("Copy");
      event.defaultPrevented.should.equal(true);
      wrapper.unmount();
    });

    it("should not copy the code when Enter is pressed on the next code button", async () => {
      const entry = createEntry(OTPType.hotp);
      const next = sinon.stub(entry, "next").resolves();
      const { wrapper } = mountEntry(entry);

      await wrapper.find(".counter").trigger("keydown", { key: "Enter" });
      await wrapper.find(".counter").trigger("click");

      next.should.have.been.calledOnce;
      execCommand.should.not.have.been.called;
      wrapper.unmount();
    });

    it("should copy the code before pasting it and when it cannot be pasted", async () => {
      sinon.replace(
        chrome.tabs,
        "query",
        sinon.fake.resolves([
          { id: 7, windowId: 3, url: "file:///C:/page.html" },
        ]) as unknown as typeof chrome.tabs.query,
      );
      const executeScript = sinon.fake.rejects(
        new Error("Cannot access contents of url"),
      );
      sinon.replace(
        chrome.scripting,
        "executeScript",
        executeScript as unknown as typeof chrome.scripting.executeScript,
      );
      const entry = createEntry();
      entry.code = "123456";
      const { pinia, wrapper } = mountEntry(entry);
      useMenuStore(pinia).useAutofill = true;
      const toast = sinon.stub(useNotificationStore(pinia), "ephermalMessage");

      await wrapper.find("a.entry").trigger("click");
      execCommand.should.have.been.calledWith("Copy");
      for (let i = 0; i < 50 && !executeScript.called; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      execCommand.should.have.been.calledBefore(executeScript);
      clipboard.value.should.equal("123456");
      toast.should.have.been.calledOnceWith(i18n.copied);
      wrapper.unmount();
    });

    it("should not copy the code with the click that ends a drag", async () => {
      const entry = createEntry();
      entry.code = "123456";
      const { pinia, wrapper } = mountEntry(entry);
      useStyleStore(pinia).style.dragging = true;

      await wrapper.find("a.entry").trigger("click");

      execCommand.should.not.have.been.called;
      wrapper.unmount();
    });

    it("should lock the popup when the code is not decrypted", async () => {
      const entry = createEntry();
      entry.code = CodeState.Encrypted;
      const { pinia, wrapper } = mountEntry(entry);

      await wrapper.find("a.entry").trigger("click");

      useCurrentViewStore(pinia).locked.should.equal(true);
      execCommand.should.not.have.been.called;
      wrapper.unmount();
    });
  });

  describe("context menu", () => {
    it("should open at the pointer", async () => {
      const entry = createEntry();
      const { pinia, wrapper } = mountEntry(entry);
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      });

      wrapper.find("a.entry").element.dispatchEvent(event);

      chai
        .expect(useEntryMenuStore(pinia).menu)
        .to.deep.equal({ hash: entry.hash, x: 120, y: 80 });
      event.defaultPrevented.should.equal(true);
      execCommand.should.not.have.been.called;
      wrapper.unmount();
    });

    it("should open at the card when the keyboard is used", async () => {
      const entry = createEntry();
      const { pinia, wrapper } = mountEntry(entry);
      document.documentElement.classList.add("kbd");
      const card = wrapper.find("a.entry").element as HTMLElement;
      const rect = card.getBoundingClientRect();

      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );

      chai.expect(useEntryMenuStore(pinia).menu).to.deep.equal({
        hash: entry.hash,
        x: rect.left + 12,
        y: rect.bottom - 8,
      });
      wrapper.unmount();
    });

    it("should open with Shift+F10", async () => {
      const entry = createEntry();
      const { pinia, wrapper } = mountEntry(entry);
      const event = new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      wrapper.find("a.entry").element.dispatchEvent(event);

      chai.expect(useEntryMenuStore(pinia).menu?.hash).to.equal(entry.hash);
      event.defaultPrevented.should.equal(true);
      wrapper.unmount();
    });
  });
});
