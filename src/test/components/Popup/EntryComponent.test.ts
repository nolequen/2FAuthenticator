import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import jsQR from "jsqr";

import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";

import EntryComponent from "../../../components/Popup/EntryComponent.vue";
import { OTPEntry, OTPType } from "../../../models/otp";
import { parseOTPAuthURI } from "../../../models/otpauth";
import { getQrUrl } from "../../../models/qr";
import { loadI18nMessages } from "../../../store/i18n";
import { useStyleStore } from "../../../store/Style";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

function decodeQr(dataUrl: string) {
  return new Promise<string | undefined>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height);
      resolve(jsQR(data.data, data.width, data.height)?.data);
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

describe("EntryComponent", () => {
  it("should leave the site out of the QR code label of an issuer with a site", async () => {
    const entry = new OTPEntry({
      type: OTPType.totp,
      index: 0,
      issuer: "Google::google.com",
      account: "alice",
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
    });

    const text = await decodeQr(getQrUrl(entry));
    chai.expect(text).to.be.a("string");
    const result = parseOTPAuthURI(text as string);
    if ("error" in result) {
      throw new Error(`Expected an entry, got error ${result.error}`);
    }
    (result.entry.issuer as string).should.equal("Google");
    (result.entry.account as string).should.equal("alice");
  });

  describe("next code of a counter based account", () => {
    let clock: sinon.SinonFakeTimers;

    before(async () => {
      await loadI18nMessages();
    });

    beforeEach(() => {
      clock = sinon.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "Date"],
      });
      sinon.replace(
        chrome.permissions,
        "request",
        sinon.fake() as unknown as typeof chrome.permissions.request,
      );
    });

    afterEach(() => {
      clock.restore();
    });

    it("should be disabled for 3 seconds after a click", async () => {
      const entry = new OTPEntry({
        type: OTPType.hotp,
        index: 0,
        issuer: "Example",
        account: "alice",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      });
      const next = sinon.stub(entry, "next").resolves();
      const wrapper = mount(EntryComponent, {
        ...mountOptions(createTestPinia()),
        props: { entry, tabindex: 0 },
      });
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
    });
  });

  describe("masked code", () => {
    let request: sinon.SinonSpy;

    before(async () => {
      await loadI18nMessages();
    });

    beforeEach(() => {
      request = sinon.fake();
      sinon.replace(
        chrome.permissions,
        "request",
        request as unknown as typeof chrome.permissions.request,
      );
    });

    function mountEntry(type: OTPType, digits: number) {
      const entry = reactive(
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
      const pinia = createTestPinia();
      const wrapper = mount(EntryComponent, {
        ...mountOptions(pinia),
        props: { entry, tabindex: 0 },
      });
      return { entry, pinia, wrapper };
    }

    it("should not copy the code of a counter based account before the first click on next", async () => {
      const { entry, wrapper } = mountEntry(OTPType.hotp, 6);
      const link = wrapper.find("a.entry");
      wrapper.find(".code").text().should.equal("••••••");
      link.classes().should.include("no-copy");
      await link.trigger("click");
      request.called.should.equal(false);

      entry.code = "123456";
      await nextTick();
      wrapper.find(".code").text().should.equal("123456");
      link.classes().should.not.include("no-copy");
      await link.trigger("click");
      request.calledOnce.should.equal(true);
    });

    it("should hide every digit of the code in edit mode", async () => {
      const { entry, pinia, wrapper } = mountEntry(OTPType.totp, 8);
      entry.code.should.match(/^\d{8}$/);
      useStyleStore(pinia).style.isEditing = true;
      await nextTick();
      wrapper.find(".code").text().should.equal("••••••••");
    });
  });
});
