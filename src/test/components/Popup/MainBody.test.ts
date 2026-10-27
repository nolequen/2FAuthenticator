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
import { useEntryMenuStore } from "../../../store/EntryMenu";
import { useMenuStore } from "../../../store/Menu";
import { useNotificationStore } from "../../../store/Notification";
import { useStyleStore } from "../../../store/Style";
import { OTPEntry, OTPType } from "../../../models/otp";
import { UserSettings } from "../../../models/settings";
import { EntryStorage } from "../../../models/storage";
import { resetStorage } from "../../storage-helper";
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
      await nextTick();
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

  describe("groups", () => {
    let set: sinon.SinonSpy;
    let style: HTMLStyleElement | undefined;

    function grouped(
      issuer: string,
      account: string,
      group: string,
      pinned = false,
    ) {
      const item = entry(issuer, account, 0);
      item.group = group;
      item.pinned = pinned;
      return item;
    }

    function standard() {
      return [
        grouped("GitHub", "p", "Work", true),
        grouped("GitLab", "w1", "Work"),
        grouped("Jira", "w2", "work"),
        grouped("Google", "h1", "Home"),
        grouped("Proton", "n1", ""),
      ];
    }

    function mountGroups(
      entries: OTPEntryInterface[],
      collapsed: OTPEntryInterface[] = [],
    ) {
      pinia = createTestPinia();
      const accounts = useAccountsStore(pinia);
      accounts.entries = entries;
      accounts.completeInit();
      useMenuStore(pinia).collapsed = collapsed.map((item) => item.hash);
      set = sinon.fake.resolves(undefined);
      sinon.replace(EntryStorage, "set", set);
      wrapper = mount(MainBody, {
        ...mountOptions(pinia),
        attachTo: document.body,
      });
      return wrapper;
    }

    function headers() {
      return (wrapper as VueWrapper).findAll<HTMLButtonElement>(
        ".section-header",
      );
    }

    function header(name: string) {
      const found = headers().find(
        (item) => item.find(".section-name").text() === name,
      );
      if (!found) {
        throw new Error(`No header ${name}`);
      }
      return found;
    }

    function shown() {
      return (wrapper as VueWrapper)
        .findAll(".section")
        .map((section) => [
          section.find(".section-name").exists()
            ? section.find(".section-name").text()
            : "",
          section.find(".section-count").exists()
            ? section.find(".section-count").text()
            : "",
          ...section
            .findAll(".entry:not([filtered]):not([not-searched])")
            .map((card) => card.find(".account").text()),
        ]);
    }

    beforeEach(() => resetStorage());

    afterEach(async () => {
      style?.remove();
      style = undefined;
      await resetStorage();
    });

    it("should show no headers while no account has a group", () => {
      mountGroups([
        grouped("GitHub", "p", "Work", true),
        grouped("GitLab", "a", ""),
      ]);

      headers().should.have.lengthOf(0);
      shown().should.deep.equal([["", "", "p", "a"]]);
    });

    it("should show the sections with the count of their cards and hide the empty ones", () => {
      mountGroups([
        grouped("GitHub", "p", "", true),
        grouped("GitLab", "w1", "Work"),
        grouped("Jira", "w2", "WORK"),
      ]);

      shown().should.deep.equal([
        [i18n.group_pinned, "1", "p"],
        ["Work", "2", "w1", "w2"],
      ]);
      headers()
        .map((item) => item.attributes("aria-expanded"))
        .should.deep.equal(["true", "true"]);
    });

    it("should collapse a section by a click and remember it in the settings", async () => {
      const entries = standard();
      mountGroups(entries);

      await header("Work").trigger("click");
      await nextTick();

      header("Work").attributes("aria-expanded")?.should.equal("false");
      shown()[1].should.deep.equal(["Work", "2"]);
      [...useMenuStore(pinia).collapsed].should.deep.equal([entries[1].hash]);
      chai
        .expect(UserSettings.items.collapsed)
        .to.deep.equal([entries[1].hash]);

      await header("Work").trigger("click");
      await nextTick();

      shown()[1].should.deep.equal(["Work", "2", "w1", "w2"]);
      chai.expect(useMenuStore(pinia).collapsed).to.have.lengthOf(0);
    });

    it("should show a saved collapsed section without its cards for Tab and the arrows", async () => {
      const entries = standard();
      mountGroups(entries, [entries[1]]);
      await nextTick();

      shown().should.deep.equal([
        [i18n.group_pinned, "1", "p"],
        ["Work", "2"],
        ["Home", "1", "h1"],
        [i18n.group_none, "1", "n1"],
      ]);
      chai.expect(cards()[0].attributes("tabindex")).to.equal("0");
      cards()[0].element.focus();
      await press("ArrowDown");
      focused().should.contain("h1");
      await press("ArrowDown");
      focused().should.contain("n1");
      await press("ArrowDown");
      focused().should.contain("p");
    });

    it("should give the first tab stop to the first card that is shown", async () => {
      const entries = standard();
      mountGroups(entries, [entries[0], entries[1]]);
      await nextTick();

      const first = cards().find((card) => card.attributes("tabindex") === "0");
      first?.find(".account").text().should.equal("h1");
    });

    it("should find the accounts by the name of their group and show collapsed sections open", async () => {
      const entries = standard();
      mountGroups(entries, [entries[1]]);

      await wrapper?.find("#searchInput").setValue("WOR");

      shown().should.deep.equal([
        [i18n.group_pinned, "1", "p"],
        ["Work", "2", "w1", "w2"],
      ]);
      header("Work").attributes("aria-expanded")?.should.equal("true");
      header("Work").attributes("aria-disabled")?.should.equal("true");
      wrapper?.find(".search-found").text().should.contain("3");
      cards()
        .flatMap((card) => card.findAll("mark"))
        .should.have.lengthOf(0);

      await header("Work").trigger("click");
      [...useMenuStore(pinia).collapsed].should.deep.equal([entries[1].hash]);

      await wrapper?.find("#searchInput").setValue("");
      shown()[1].should.deep.equal(["Work", "2"]);
    });

    it("should keep the headers for the smart filter and hide the sections without matches", async () => {
      const entries = [
        grouped("Proton", "p", "", true),
        grouped("GitHub", "w1", "Work"),
        grouped("Jira", "w2", "Work"),
        grouped("Google", "h1", "Home"),
      ];
      mountGroups(entries, [entries[1]]);
      const accounts = useAccountsStore(pinia);
      accounts.siteName = ["signintogithub", "github", "github.com"];
      useMenuStore(pinia).smartFilter = true;
      await nextTick();

      shown().should.deep.equal([
        [i18n.group_pinned, "1", "p"],
        ["Work", "1", "w1"],
      ]);
    });

    it("should open the menu of a group by the right button and Shift+F10, but not of the other sections", async () => {
      mountGroups(standard());
      const entryMenu = useEntryMenuStore(pinia);

      await header("Work").trigger("contextmenu", { clientX: 30, clientY: 40 });
      chai.expect(entryMenu.menu?.group).to.equal("work");

      entryMenu.close();
      await header("Work").trigger("keydown", { key: "F10", shiftKey: true });
      chai.expect(entryMenu.menu?.group).to.equal("work");

      entryMenu.close();
      await header(i18n.group_pinned).trigger("contextmenu");
      await header(i18n.group_none).trigger("keydown", {
        key: "ContextMenu",
      });
      chai.expect(entryMenu.menu).to.equal(null);
    });

    describe("drag", () => {
      const wait = (ms = 20) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      function layoutStyle() {
        style = document.createElement("style");
        style.textContent = `
          .sections, .cards { display: flex; flex-direction: column; }
          .entry { display: block; height: 40px; overflow: hidden; }
          .entry > *, .section-header > * { display: none; }
          .section-header { display: block; width: 300px; height: 24px; }
        `;
        document.head.appendChild(style);
      }

      function point(element: Element, share = 0.5) {
        const rect = element.getBoundingClientRect();
        return {
          clientX: rect.left + 20,
          clientY: rect.top + rect.height * share,
        };
      }

      async function drag(
        from: Element,
        to: Element,
        share = 0.5,
        beforeDrop: () => void = () => undefined,
      ) {
        await nextTick();
        const start = point(from);
        const end = point(to, share);
        from.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerType: "mouse",
            isPrimary: true,
            ...start,
          }),
        );
        const steps = 8;
        for (let step = 1; step <= steps; step++) {
          document.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerType: "mouse",
              isPrimary: true,
              clientX: start.clientX,
              clientY:
                start.clientY + ((end.clientY - start.clientY) * step) / steps,
            }),
          );
          await wait();
        }
        await wait(150);
        beforeDrop();
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, ...end }),
        );
        await wait();
        await nextTick();
      }

      function card(name: string) {
        const found = cards().find(
          (item) => item.find(".account").text() === name,
        );
        if (!found) {
          throw new Error(`No card ${name}`);
        }
        return found.element;
      }

      it("should move a card into another group with one write of all the accounts", async () => {
        layoutStyle();
        const entries = standard();
        mountGroups(entries);

        await drag(card("w1"), card("h1"), 0.75);

        JSON.stringify(shown()).should.equal(
          JSON.stringify([
            [i18n.group_pinned, "1", "p"],
            ["Work", "1", "w2"],
            ["Home", "2", "h1", "w1"],
            [i18n.group_none, "1", "n1"],
          ]),
        );
        entries[1].group.should.equal("Home");
        set.should.have.been.calledOnce;
        set.firstCall.args[0].should.have.lengthOf(5);
        set.firstCall.args[0]
          .map((item: OTPEntryInterface) => `${item.index}:${item.account}`)
          .should.deep.equal(["0:p", "1:w2", "2:h1", "3:w1", "4:n1"]);
      });

      it("should pin a card dropped into the pinned section and unpin a card dropped out of it", async () => {
        layoutStyle();
        const entries = standard();
        mountGroups(entries);

        await drag(card("n1"), card("p"), 0.25);
        entries[4].pinned.should.equal(true);
        shown()[0].should.deep.equal([i18n.group_pinned, "2", "n1", "p"]);

        await drag(card("p"), card("h1"), 0.75);
        entries[0].pinned.should.equal(false);
        entries[0].group.should.equal("Home");
        set.should.have.been.calledTwice;
      });

      it("should take the group away from a card dropped into the section without a group", async () => {
        layoutStyle();
        const entries = standard();
        mountGroups(entries);

        await drag(card("h1"), card("n1"), 0.75);

        entries[3].group.should.equal("");
        shown().should.deep.equal([
          [i18n.group_pinned, "1", "p"],
          ["Work", "2", "w1", "w2"],
          [i18n.group_none, "2", "n1", "h1"],
        ]);
      });

      it("should put a card dropped on the header of another group first into it", async () => {
        layoutStyle();
        const entries = standard();
        mountGroups(entries);

        await drag(card("w1"), header("Home").element, 0.5);

        shown()[2].should.deep.equal(["Home", "2", "w1", "h1"]);
        entries[1].group.should.equal("Home");
        set.should.have.been.calledOnce;
      });

      it("should not take a card into a collapsed section by its header", async () => {
        layoutStyle();
        const entries = standard();
        mountGroups(entries, [entries[3]]);

        await drag(card("n1"), header("Home").element, 0.5);

        shown()[2].should.deep.equal(["Home", "1"]);
        entries[4].group.should.equal("");
        set.should.not.have.been.called;
      });

      it("should move a group by its header without collapsing it", async () => {
        layoutStyle();
        mountGroups(standard());

        await drag(header("Home").element, header("Work").element, 0.25, () => {
          chai
            .expect(
              header("Home")
                .element.closest(".section")
                ?.parentElement?.classList.contains("sections"),
            )
            .to.equal(true);
        });

        shown()
          .map((section) => section[0])
          .should.deep.equal([
            i18n.group_pinned,
            "Home",
            "Work",
            i18n.group_none,
          ]);
        headers()
          .map((item) => item.attributes("aria-expanded"))
          .should.deep.equal(["true", "true", "true", "true"]);
        set.should.have.been.calledOnce;
      });

      it("should keep a card that is not decrypted in its section", async () => {
        layoutStyle();
        const hidden = new OTPEntry({
          encrypted: true,
          keyId: "other-key",
          encData: "data",
          hash: crypto.randomUUID(),
          index: 0,
        }) as OTPEntryInterface;
        mountGroups([
          grouped("GitLab", "w1", "Work"),
          grouped("Proton", "n1", ""),
          hidden,
        ]);
        const locked = (wrapper as VueWrapper).find(
          `.entry[data-hash="${hidden.hash}"]`,
        );

        await drag(locked.element, card("w1"), 0.25, () => {
          chai
            .expect(
              locked.element
                .closest(".section")
                ?.classList.contains("section-none"),
            )
            .to.equal(true);
        });

        shown()[0].should.deep.equal(["Work", "1", "w1"]);
        shown()[1].slice(0, 2).should.deep.equal([i18n.group_none, "2"]);
        hidden.group.should.equal("");
        hidden.pinned.should.equal(false);
      });
    });
  });
});
