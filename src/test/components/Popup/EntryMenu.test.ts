import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import type { Pinia } from "pinia";

import EntryMenu from "../../../components/Popup/EntryMenu.vue";
import { OTPEntry, OTPType } from "../../../models/otp";
import { EntryStorage } from "../../../models/storage";
import { i18n, loadI18nMessages, t } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useEntryMenuStore } from "../../../store/EntryMenu";
import { useMenuStore } from "../../../store/Menu";
import { useNotificationStore } from "../../../store/Notification";
import { useQrStore } from "../../../store/Qr";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

describe("EntryMenu", () => {
  let pinia: Pinia;
  let entry: OTPEntryInterface;
  let wrapper: VueWrapper;

  before(async () => {
    await loadI18nMessages();
  });

  function openMenu(change?: (target: OTPEntryInterface) => void) {
    entry = reactive(
      new OTPEntry({
        type: OTPType.totp,
        index: 0,
        issuer: "GitHub::github.com",
        account: "alice",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ) as OTPEntryInterface;
    change?.(entry);
    pinia = createTestPinia();
    useAccountsStore(pinia).entries = [entry];
    useEntryMenuStore(pinia).open(entry.hash, 20, 30);
    wrapper = mount(EntryMenu, {
      ...mountOptions(pinia),
      attachTo: document.body,
    });
  }

  function items() {
    return wrapper.findAll<HTMLButtonElement>("[role='menuitem']");
  }

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should offer every action for a decrypted account", () => {
    openMenu();
    items()
      .map((item) => item.text())
      .should.deep.equal([
        i18n.edit_account,
        i18n.pin_short,
        i18n.qr_code,
        i18n.delete,
      ]);
    wrapper
      .find("[role='menu']")
      .attributes("aria-label")
      ?.should.equal(i18n.account_actions);
  });

  it("should offer to unpin a pinned account", () => {
    openMenu((target) => {
      target.pinned = true;
    });
    items()[1].text().should.equal(i18n.unpin);
  });

  it("should only offer to edit and delete an account that is not decrypted", () => {
    openMenu((target) => {
      target.secret = null;
    });
    items()
      .map((item) => item.text())
      .should.deep.equal([i18n.edit_account, i18n.delete]);
  });

  it("should open the account page", async () => {
    openMenu();
    const currentView = useCurrentViewStore(pinia);

    await items()[0].trigger("click");

    chai.expect(currentView.current).to.equal("Account");
    currentView.accountHash.should.equal(entry.hash);
    chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
  });

  it("should pin the account and save the list", async () => {
    openMenu();
    const set = sinon.fake.resolves(undefined);
    sinon.replace(EntryStorage, "set", set);

    await items()[1].trigger("click");
    for (let i = 0; i < 100 && !set.called; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    entry.pinned.should.equal(true);
    set.should.have.been.calledOnce;
    chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
  });

  it("should show the QR code", async () => {
    openMenu();

    await items()[2].trigger("click");

    const qr = useQrStore(pinia).qr;
    chai.expect(qr?.issuer).to.equal("GitHub");
    chai.expect(qr?.account).to.equal("alice");
  });

  it("should delete the account only after the confirmation", async () => {
    openMenu();
    const confirm = sinon
      .stub(useNotificationStore(pinia), "confirm")
      .resolves(false);
    const remove = sinon.stub(entry, "delete").resolves();

    await items()[3].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    confirm.should.have.been.calledOnce;
    remove.should.not.have.been.called;
    useAccountsStore(pinia).entries.length.should.equal(1);

    confirm.resolves(true);
    useEntryMenuStore(pinia).open(entry.hash, 20, 30);
    await nextTick();
    await items()[3].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    remove.should.have.been.calledOnce;
    useAccountsStore(pinia).entries.length.should.equal(0);
  });

  it("should move the focus with the arrows and close with Escape", async () => {
    openMenu();
    const [first, second, , last] = items();
    first.element.focus();

    await first.trigger("keydown", { key: "ArrowDown" });
    chai.expect(document.activeElement).to.equal(second.element);
    await second.trigger("keydown", { key: "ArrowUp" });
    chai.expect(document.activeElement).to.equal(first.element);
    await first.trigger("keydown", { key: "ArrowUp" });
    chai.expect(document.activeElement).to.equal(last.element);
    await last.trigger("keydown", { key: "Home" });
    chai.expect(document.activeElement).to.equal(first.element);

    await first.trigger("keydown", { key: "Escape" });
    chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
  });

  it("should close by a click outside", async () => {
    openMenu();

    await wrapper.find("[role='menu']").trigger("click");
    chai.expect(useEntryMenuStore(pinia).menu).to.not.equal(null);

    await wrapper.find(".menu-backdrop").trigger("click");
    chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
  });

  describe("group", () => {
    let set: sinon.SinonSpy;

    function account(name: string, group: string, pinned = false) {
      return reactive(
        new OTPEntry({
          type: OTPType.totp,
          index: 0,
          account: name,
          encrypted: false,
          secret: "JBSWY3DPEHPK3PXP",
          group,
          pinned,
        }),
      ) as OTPEntryInterface;
    }

    function openGroupMenu() {
      pinia = createTestPinia();
      const accounts = useAccountsStore(pinia);
      accounts.entries = [
        account("p", "Work", true),
        account("w1", "Work"),
        account("h1", "Home"),
      ];
      set = sinon.fake.resolves(undefined);
      sinon.replace(EntryStorage, "set", set);
      sinon.stub(useMenuStore(pinia), "setCollapsed").resolves();
      useEntryMenuStore(pinia).openGroup("work", 20, 30);
      wrapper = mount(EntryMenu, {
        ...mountOptions(pinia),
        attachTo: document.body,
      });
      return accounts;
    }

    function groups(accounts: { entries: OTPEntryInterface[] }) {
      return accounts.entries.map((item) => `${item.account}:${item.group}`);
    }

    async function settle() {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    it("should offer to rename and ungroup", () => {
      openGroupMenu();
      items()
        .map((item) => item.text())
        .should.deep.equal([i18n.rename_group, i18n.ungroup]);
      wrapper
        .find("[role='menu']")
        .attributes("aria-label")
        ?.should.equal(i18n.group_actions);
    });

    it("should rename the group with its pinned accounts", async () => {
      const accounts = openGroupMenu();
      const prompt = sinon
        .stub(useNotificationStore(pinia), "prompt")
        .resolves(" Job ");

      await items()[0].trigger("click");
      await settle();

      prompt.should.have.been.calledOnce;
      prompt.firstCall.args[0].should.deep.include({
        title: i18n.rename_group_title,
        label: i18n.group_name,
        value: "Work",
        confirm: i18n.save,
        maxlength: 32,
      });
      chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
      groups(accounts).should.deep.equal(["p:Job", "w1:Job", "h1:Home"]);
      set.should.have.been.calledOnce;
    });

    it("should change nothing when the rename is cancelled", async () => {
      const accounts = openGroupMenu();
      sinon.stub(useNotificationStore(pinia), "prompt").resolves(null);

      await items()[0].trigger("click");
      await settle();

      groups(accounts).should.deep.equal(["p:Work", "w1:Work", "h1:Home"]);
      set.should.not.have.been.called;
    });

    it("should merge into an existing group only after the confirmation", async () => {
      const accounts = openGroupMenu();
      const notification = useNotificationStore(pinia);
      sinon.stub(notification, "prompt").resolves("home");
      const confirm = sinon.stub(notification, "confirm").resolves(false);

      await items()[0].trigger("click");
      await settle();

      confirm.should.have.been.calledOnceWith({
        title: i18n.merge_groups_title,
        message: t("merge_groups_text", "Home"),
        confirm: i18n.merge,
      });
      set.should.not.have.been.called;

      confirm.resolves(true);
      useEntryMenuStore(pinia).openGroup("work", 20, 30);
      await nextTick();
      await items()[0].trigger("click");
      await settle();

      groups(accounts).should.deep.equal(["p:Home", "h1:Home", "w1:Home"]);
      set.should.have.been.calledOnce;
    });

    it("should ungroup the accounts only after the confirmation", async () => {
      const accounts = openGroupMenu();
      const confirm = sinon
        .stub(useNotificationStore(pinia), "confirm")
        .resolves(false);

      await items()[1].trigger("click");
      await settle();

      confirm.should.have.been.calledOnceWith({
        title: t("ungroup_title", "Work"),
        message: i18n.ungroup_text,
        confirm: i18n.ungroup,
      });
      groups(accounts).should.deep.equal(["p:Work", "w1:Work", "h1:Home"]);
      set.should.not.have.been.called;

      confirm.resolves(true);
      useEntryMenuStore(pinia).openGroup("work", 20, 30);
      await nextTick();
      await items()[1].trigger("click");
      await settle();

      groups(accounts).should.deep.equal(["p:", "h1:Home", "w1:"]);
      set.should.have.been.calledOnce;
    });

    it("should close when the group is gone", async () => {
      const accounts = openGroupMenu();

      accounts.entries = accounts.entries.filter(
        (item) => item.group !== "Work",
      );
      await nextTick();

      chai.expect(useEntryMenuStore(pinia).menu).to.equal(null);
    });
  });
});
