import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { Pinia } from "pinia";

import MainBody from "../../../components/Popup/MainBody.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useMenuStore } from "../../../store/Menu";
import { useNotificationStore } from "../../../store/Notification";
import { useStyleStore } from "../../../store/Style";
import { OTPEntry, OTPType } from "../../../models/otp";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

function entry(issuer: string, account: string, index: number) {
  return new OTPEntry({
    type: OTPType.totp,
    index,
    issuer,
    account,
    encrypted: false,
    secret: "JBSWY3DPEHPK3PXP",
  });
}

describe("MainBody", () => {
  let pinia: Pinia;
  let wrapper: VueWrapper | undefined;

  before(async () => {
    await loadI18nMessages();
  });

  function mountBody(...entries: OTPEntryInterface[]) {
    pinia = createTestPinia();
    const accounts = useAccountsStore(pinia);
    accounts.entries = entries;
    accounts.completeInit();
    wrapper = mount(MainBody, {
      ...mountOptions(pinia),
      attachTo: document.body,
    });
    return wrapper;
  }

  function cards() {
    return (wrapper as VueWrapper).findAll<HTMLElement>("a.entry");
  }

  function focused() {
    return document.activeElement?.textContent ?? "";
  }

  async function press(key: string) {
    const active = document.activeElement as HTMLElement;
    active.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await nextTick();
  }

  function filterBySite(...entries: OTPEntryInterface[]) {
    const body = mountBody(...entries);
    const accounts = useAccountsStore(pinia);
    accounts.siteName = ["signintogithub", "github", "github.com"];
    useMenuStore(pinia).smartFilter = true;
    return body;
  }

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("should mark only the accounts that do not match the search", async () => {
    mountBody(entry("Alpha", "alice", 0), entry("Beta", "bob", 1));

    await wrapper?.find("#searchInput").setValue("alp");

    const [alpha, beta] = cards();
    alpha.text().should.contain("Alpha");
    chai.expect(alpha.attributes("not-searched")).to.equal(undefined);
    chai.expect(beta.attributes("not-searched")).to.not.equal(undefined);
    wrapper?.find(".search-found").exists().should.equal(true);

    await wrapper?.find("#searchInput").setValue("");

    chai.expect(beta.attributes("not-searched")).to.equal(undefined);
    wrapper?.find(".search-found").exists().should.equal(false);
  });

  describe("arrows", () => {
    it("should go through all the accounts when nothing is filtered", async () => {
      mountBody(
        entry("Alpha", "alice", 0),
        entry("Beta", "bob", 1),
        entry("Gamma", "carol", 2),
      );
      for (const card of cards()) {
        chai.expect(card.attributes("filtered")).to.equal(undefined);
      }
      cards()[0].element.focus();

      await press("ArrowDown");
      focused().should.contain("Beta");
      await press("ArrowRight");
      focused().should.contain("Gamma");
      await press("ArrowDown");
      focused().should.contain("Alpha");
      await press("ArrowUp");
      focused().should.contain("Gamma");
      await press("ArrowLeft");
      focused().should.contain("Beta");
    });

    it("should skip the accounts hidden by the search", async () => {
      mountBody(
        entry("Alpha", "alice", 0),
        entry("Beta", "bob", 1),
        entry("Alps", "anna", 2),
      );
      await wrapper?.find("#searchInput").setValue("alp");
      chai.expect(cards()[0].attributes("tabindex")).to.equal("0");
      cards()[0].element.focus();

      await press("ArrowDown");
      focused().should.contain("Alps");
      await press("ArrowDown");
      focused().should.contain("Alpha");
    });

    it("should skip the accounts hidden by the smart filter", async () => {
      filterBySite(
        entry("Google", "alice", 0),
        entry("GitHub", "bob", 1),
        entry("Proton", "carol", 2),
        entry("GitHub", "dave", 3),
      );
      await nextTick();
      chai.expect(cards()[0].attributes("filtered")).to.not.equal(undefined);
      chai.expect(cards()[0].attributes("tabindex")).to.equal("-1");
      chai.expect(cards()[1].attributes("tabindex")).to.equal("0");
      cards()[1].element.focus();

      await press("ArrowDown");
      focused().should.contain("dave");
      await press("ArrowDown");
      focused().should.contain("bob");
    });
  });

  describe("smart filter", () => {
    it("should show the site and show all accounts on request", async () => {
      filterBySite(entry("Google", "alice", 0), entry("GitHub", "bob", 1));
      await nextTick();

      const bar = wrapper?.find(".filter-bar");
      chai.expect(bar?.exists()).to.equal(true);
      chai.expect(bar?.find("b").text()).to.equal("github.com");

      (bar?.find("button").element as HTMLElement).focus();
      await bar?.find("button").trigger("click");
      await nextTick();

      wrapper?.find(".filter-bar").exists().should.equal(false);
      chai.expect(cards()[0].attributes("filtered")).to.equal(undefined);
      chai.expect(document.activeElement).to.equal(cards()[0].element);
    });

    it("should stop filtering when a search is typed", async () => {
      filterBySite(entry("Google", "alice", 0), entry("GitHub", "bob", 1));
      await nextTick();

      await wrapper?.find("#searchInput").setValue("goo");

      useAccountsStore(pinia).filter.should.equal(false);
      wrapper?.find(".filter-bar").exists().should.equal(false);
      chai.expect(cards()[0].attributes("not-searched")).to.equal(undefined);
    });

    it("should follow the setting without opening the popup again", async () => {
      mountBody(entry("Google", "alice", 0), entry("GitHub", "bob", 1));
      useAccountsStore(pinia).siteName = [
        "signintogithub",
        "github",
        "github.com",
      ];
      await nextTick();
      wrapper?.find(".filter-bar").exists().should.equal(false);

      useMenuStore(pinia).smartFilter = true;
      await nextTick();

      wrapper?.find(".filter-bar").exists().should.equal(true);
    });
  });

  describe("backup reminder", () => {
    it("should be put off until later", async () => {
      mountBody(entry("Alpha", "alice", 0));
      const notification = useNotificationStore(pinia);
      const dismiss = sinon
        .stub(notification, "dismissBackupReminder")
        .callsFake(async () => {
          notification.backupReminder = false;
        });
      wrapper?.find(".reminder").exists().should.equal(false);

      notification.backupReminder = true;
      await nextTick();
      const later = wrapper?.findAll(".reminder button")[1];
      chai.expect(later?.text()).to.equal(i18n.remind_later);
      (later?.element as HTMLElement).focus();
      await later?.trigger("click");
      await nextTick();

      dismiss.should.have.been.calledOnce;
      wrapper?.find(".reminder").exists().should.equal(false);
      chai.expect(useCurrentViewStore(pinia).current).to.equal(null);
      chai.expect(document.activeElement).to.equal(cards()[0].element);
    });

    it("should move the focus to the search when no account is visible", async () => {
      mountBody(entry("Alpha", "alice", 0));
      const notification = useNotificationStore(pinia);
      sinon.stub(notification, "dismissBackupReminder").callsFake(async () => {
        notification.backupReminder = false;
      });
      notification.backupReminder = true;
      await wrapper?.find("#searchInput").setValue("nothing");
      const later = wrapper?.findAll(".reminder button")[1];
      (later?.element as HTMLElement).focus();

      await later?.trigger("click");
      await nextTick();

      chai
        .expect(document.activeElement)
        .to.equal(wrapper?.find("#searchInput").element);
    });

    it("should open the backup", async () => {
      mountBody(entry("Alpha", "alice", 0));
      const notification = useNotificationStore(pinia);
      const dismiss = sinon.stub(notification, "dismissBackupReminder");
      notification.backupReminder = true;
      await nextTick();

      await wrapper?.find(".reminder-primary").trigger("click");

      dismiss.should.have.been.calledOnce;
      chai.expect(useCurrentViewStore(pinia).current).to.equal("Backup");
    });
  });

  it("should offer to add an account to an empty list", async () => {
    mountBody();

    wrapper?.find("#searchInput").exists().should.equal(false);
    const empty = wrapper?.find(".no-entry");
    chai.expect(empty?.exists()).to.equal(true);
    chai.expect(empty?.find("a").attributes("href")).to.equal("import.html");

    await empty?.findAll("button")[1].trigger("click");

    chai.expect(useCurrentViewStore(pinia).current).to.equal("AddAccount");
  });

  describe("drag", () => {
    function sortable() {
      const element = (wrapper as VueWrapper).find(".cards")
        .element as unknown as Record<
        string,
        { option(name: string): unknown }
      >;
      const key = Object.keys(element).find((name) =>
        name.startsWith("Sortable"),
      );
      return element[key as string];
    }

    it("should be possible only while all the accounts are shown", async () => {
      filterBySite(entry("Google", "alice", 0), entry("GitHub", "bob", 1));
      await nextTick();
      chai.expect(sortable().option("disabled")).to.equal(true);

      await wrapper?.find(".filter-bar button").trigger("click");
      await nextTick();
      chai.expect(sortable().option("disabled")).to.equal(false);

      await wrapper?.find("#searchInput").setValue("goo");
      await nextTick();
      chai.expect(sortable().option("disabled")).to.equal(true);
    });

    let clipboard: HTMLInputElement;
    let execCommand: sinon.SinonStub;
    const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

    async function dragInPlace() {
      mountBody(entry("Alpha", "alice", 0));
      clipboard = document.createElement("input");
      clipboard.id = "codeClipboard";
      document.body.appendChild(clipboard);
      execCommand = sinon.stub(document, "execCommand").returns(true);
      const card = cards()[0].element;
      const rect = card.getBoundingClientRect();
      const x = rect.left + 20;
      const y = rect.top + 20;
      card.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: x,
          clientY: y,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
      for (const shift of [3, 8, 14]) {
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y + shift,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
        await wait();
      }
      useStyleStore(pinia).style.dragging.should.equal(true);
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }),
      );
    }

    function clickCard() {
      cards()[0].element.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    }

    afterEach(() => {
      clipboard?.remove();
    });

    it("should not copy the code by the click that ends a drag", async () => {
      await dragInPlace();
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      clickCard();

      execCommand.should.not.have.been.called;
    });

    it("should copy the code by the next click after a drag released without a click", async () => {
      await dragInPlace();
      await wait();

      clickCard();

      useStyleStore(pinia).style.dragging.should.equal(false);
      execCommand.should.have.been.calledOnceWith("Copy");
    });
  });
});
