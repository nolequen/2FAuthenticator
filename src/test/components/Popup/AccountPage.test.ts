import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import jsQR from "jsqr";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import type { Pinia } from "pinia";

import AccountPage from "../../../components/Popup/AccountPage.vue";
import { OTPEntry, OTPType } from "../../../models/otp";
import { parseOTPAuthURI } from "../../../models/otpauth";
import { getQrUrl } from "../../../models/qr";
import { EntryStorage } from "../../../models/storage";
import { i18n, loadI18nMessages, t } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useMenuStore } from "../../../store/Menu";
import { UserSettings } from "../../../models/settings";
import { resetStorage } from "../../storage-helper";
import { useNotificationStore } from "../../../store/Notification";
import { useQrStore } from "../../../store/Qr";
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

function createEntry(issuer: string, account: string) {
  return reactive(
    new OTPEntry({
      type: OTPType.totp,
      index: 0,
      issuer,
      account,
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
    }),
  ) as OTPEntryInterface;
}

describe("AccountPage", () => {
  let pinia: Pinia;
  let entry: OTPEntryInterface;
  let wrapper: VueWrapper;

  before(async () => {
    await loadI18nMessages();
  });

  function openPage(target: OTPEntryInterface) {
    entry = target;
    pinia = createTestPinia();
    useAccountsStore(pinia).entries = [entry];
    useCurrentViewStore(pinia).open("Account", entry.hash);
    wrapper = mount(AccountPage, mountOptions(pinia));
  }

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should leave the site out of the QR code label of an issuer with a site", async () => {
    const google = createEntry("Google::google.com", "alice");

    const text = await decodeQr(getQrUrl(google));
    chai.expect(text).to.be.a("string");
    const result = parseOTPAuthURI(text as string);
    if ("error" in result) {
      throw new Error(`Expected an entry, got error ${result.error}`);
    }
    (result.entry.issuer as string).should.equal("Google");
    (result.entry.account as string).should.equal("alice");
  });

  it("should show the QR code with the issuer without its site", async () => {
    openPage(createEntry("Google::google.com", "alice"));

    await wrapper.find(".show-qr").trigger("click");

    const qr = useQrStore(pinia).qr;
    chai.expect(qr?.issuer).to.equal("Google");
    chai.expect(qr?.account).to.equal("alice");
    chai.expect(qr?.url).to.equal(getQrUrl(entry));
  });

  it("should show the parameters of the account", () => {
    openPage(createEntry("Example", "alice"));

    wrapper
      .find(".account-params")
      .text()
      .should.equal(
        `TOTP · ${t("params_digits", "6")} · ${t("params_period", "30")} · SHA-1`,
      );
  });

  it("should save a renamed account", async () => {
    openPage(createEntry("Example", "alice"));
    const update = sinon.stub(entry, "update").resolves();

    await wrapper.findAll("input[type='text']")[0].setValue("Renamed");

    entry.issuer.should.equal("Renamed");
    update.should.have.been.calledOnce;
  });

  it("should show a failed rename", async () => {
    openPage(createEntry("Example", "alice"));
    sinon.stub(entry, "update").rejects(new Error("quota"));
    const showWriteFailure = sinon
      .stub(useAccountsStore(pinia), "showWriteFailure")
      .resolves();

    await wrapper.findAll("input[type='text']")[1].trigger("change");
    await new Promise((resolve) => setTimeout(resolve, 0));

    showWriteFailure.should.have.been.calledOnce;
  });

  describe("site", () => {
    function input(field: string) {
      return wrapper.find<HTMLInputElement>(`.${field} input`);
    }

    it("should show the service and the site in their own fields", () => {
      openPage(createEntry("GitHub::github.com", "alice"));

      input("issuer-field").element.value.should.equal("GitHub");
      input("site-field").element.value.should.equal("github.com");
      wrapper.find(".account-title").text().should.equal("GitHub");
    });

    it("should save the host of the entered address with the service", async () => {
      openPage(createEntry("GitHub", "alice"));
      const update = sinon.stub(entry, "update").resolves();

      await input("site-field").setValue("https://www.GitHub.com/login");

      entry.issuer.should.equal("GitHub::github.com");
      update.should.have.been.calledOnce;
      input("site-field").element.value.should.equal("github.com");
    });

    it("should keep the site when the service is renamed", async () => {
      openPage(createEntry("GitHub::github.com", "alice"));
      sinon.stub(entry, "update").resolves();

      await input("issuer-field").setValue("Git::Hub");

      entry.issuer.should.equal("Git:Hub::github.com");
    });

    it("should remove the site", async () => {
      openPage(createEntry("GitHub::github.com", "alice"));
      sinon.stub(entry, "update").resolves();

      await input("site-field").setValue("");

      entry.issuer.should.equal("GitHub");
    });

    it("should keep the stored site when the entered one is invalid", async () => {
      openPage(createEntry("GitHub::github.com", "alice"));
      const update = sinon.stub(entry, "update").resolves();

      await input("site-field").setValue("not a site");
      await input("account-field").setValue("bob");

      entry.issuer.should.equal("GitHub::github.com");
      entry.account.should.equal("bob");
      update.should.have.been.calledTwice;
      input("site-field").element.value.should.equal("not a site");
      wrapper
        .find(".site-field .field-error")
        .text()
        .should.equal(i18n.site_invalid);
      chai
        .expect(input("site-field").attributes("aria-invalid"))
        .to.equal("true");
    });
  });

  it("should show the stored service again after a failed save", async () => {
    openPage(createEntry("GitHub::github.com", "alice"));
    sinon.stub(entry, "update").rejects(new Error("quota"));
    const accounts = useAccountsStore(pinia);
    const stored = createEntry("GitHub::github.com", "alice");
    stored.hash = entry.hash;
    sinon.stub(accounts, "showWriteFailure").callsFake(async () => {
      accounts.entries = [stored];
    });

    await wrapper.find(".issuer-field input").setValue("Renamed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    wrapper
      .find<HTMLInputElement>(".issuer-field input")
      .element.value.should.equal("GitHub");
    wrapper.find(".account-title").text().should.equal("GitHub");
  });

  describe("website icon", () => {
    beforeEach(() => resetStorage());
    afterEach(() => resetStorage());

    it("should be turned off for this account only", async () => {
      openPage(createEntry("GitHub::github.com", "alice"));
      const menu = useMenuStore(pinia);
      const toggle = wrapper.find<HTMLInputElement>(".site-icon-toggle input");
      toggle.element.checked.should.equal(true);
      wrapper.find(".account-summary img").exists().should.equal(true);

      await toggle.setValue(false);
      await UserSettings.updateItems();

      [...menu.siteIconsOff].should.deep.equal([entry.hash]);
      chai.expect(UserSettings.items.siteIconsOff).to.deep.equal([entry.hash]);
      wrapper.find(".account-summary img").exists().should.equal(false);

      await toggle.setValue(true);

      await UserSettings.updateItems();
      menu.siteIconsOff.length.should.equal(0);
      chai.expect(UserSettings.items.siteIconsOff).to.deep.equal([]);
      wrapper.find(".account-summary img").exists().should.equal(true);
    });

    it("should be hidden for an account that is not decrypted or has no icon address", () => {
      const locked = createEntry("GitHub::github.com", "alice");
      locked.secret = null;
      openPage(locked);
      wrapper.find(".site-icon-toggle").exists().should.equal(false);
      wrapper.unmount();

      openPage(createEntry("Router::192.168.1.1", "admin"));
      wrapper.find(".site-icon-toggle").exists().should.equal(false);
    });

    it("should forget the choice of a deleted account", async () => {
      openPage(createEntry("GitHub::github.com", "alice"));
      const menu = useMenuStore(pinia);
      menu.siteIconsOff = ["other", entry.hash];
      sinon.stub(useNotificationStore(pinia), "confirm").resolves(true);
      sinon.stub(entry, "delete").resolves();

      await wrapper.find(".delete-account").trigger("click");
      await new Promise((resolve) => setTimeout(resolve, 0));

      [...menu.siteIconsOff].should.deep.equal(["other"]);
    });

    it("should be hidden without a site or with the website icons turned off", async () => {
      openPage(createEntry("GitHub", "alice"));
      wrapper.find(".site-icon-toggle").exists().should.equal(false);
      wrapper.unmount();

      openPage(createEntry("GitHub::github.com", "alice"));
      useMenuStore(pinia).siteIcons = false;
      await nextTick();
      wrapper.find(".site-icon-toggle").exists().should.equal(false);
    });
  });

  it("should save an account with an old site without a dot", async () => {
    openPage(createEntry("GitHub::github", "alice"));
    const update = sinon.stub(entry, "update").resolves();

    await wrapper.find(".site-field input").trigger("change");
    await wrapper.find(".account-field input").setValue("bob");

    entry.issuer.should.equal("GitHub::github");
    entry.account.should.equal("bob");
    update.should.have.been.calledTwice;
    wrapper.find(".site-field .field-error").exists().should.equal(false);
  });

  it("should pin the account and save the list", async () => {
    openPage(createEntry("Example", "alice"));
    const set = sinon.fake.resolves(undefined);
    sinon.replace(EntryStorage, "set", set);

    await wrapper.find("input[role='switch']").setValue(true);
    for (let i = 0; i < 100 && !set.called; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    entry.pinned.should.equal(true);
    set.should.have.been.calledOnce;
  });

  it("should delete the account only after the confirmation", async () => {
    openPage(createEntry("Cloudflare", "ivan@example.org"));
    const confirm = sinon
      .stub(useNotificationStore(pinia), "confirm")
      .resolves(false);
    const remove = sinon.stub(entry, "delete").resolves();
    const currentView = useCurrentViewStore(pinia);

    await wrapper.find(".delete-account").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    confirm.should.have.been.calledOnceWith({
      title: t("delete_account_title", "Cloudflare"),
      message: t("confirm_delete", "ivan@example.org"),
      confirm: i18n.delete,
      danger: true,
    });
    remove.should.not.have.been.called;
    chai.expect(currentView.current).to.equal("Account");

    confirm.resolves(true);
    await wrapper.find(".delete-account").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    remove.should.have.been.calledOnce;
    useAccountsStore(pinia).entries.length.should.equal(0);
    chai.expect(currentView.current).to.equal(null);
  });

  it("should show a failed delete and stay on the page", async () => {
    openPage(createEntry("Cloudflare", "ivan@example.org"));
    sinon.stub(useNotificationStore(pinia), "confirm").resolves(true);
    sinon.stub(entry, "delete").rejects(new Error("quota"));
    const showWriteFailure = sinon
      .stub(useAccountsStore(pinia), "showWriteFailure")
      .resolves();

    await wrapper.find(".delete-account").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    showWriteFailure.should.have.been.calledOnce;
    useAccountsStore(pinia).entries.length.should.equal(1);
    chai.expect(useCurrentViewStore(pinia).current).to.equal("Account");
  });

  it("should only allow to delete an account that is not decrypted", () => {
    const locked = createEntry("Example", "alice");
    locked.secret = null;
    openPage(locked);

    for (const input of wrapper.findAll("input[type='text']")) {
      chai.expect(input.attributes("readonly")).to.not.equal(undefined);
    }
    wrapper.find(".show-qr").exists().should.equal(false);
    wrapper.find("input[role='switch']").exists().should.equal(false);
    wrapper.find(".account-params").exists().should.equal(false);
    wrapper.find(".notice").text().should.equal(i18n.account_locked_hint);
    wrapper.find(".delete-account").exists().should.equal(true);
  });

  it("should go back when the account disappears", async () => {
    openPage(createEntry("Example", "alice"));
    const currentView = useCurrentViewStore(pinia);

    useAccountsStore(pinia).entries = [];
    await nextTick();

    chai.expect(currentView.current).to.equal(null);
  });
});
