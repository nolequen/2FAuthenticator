import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { Pinia } from "pinia";

import NotificationHandler from "../../../components/Popup/NotificationHandler.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useNotificationStore } from "../../../store/Notification";
import { createTestPinia, mountOptions } from "../../vue-helper";

mocha.setup("bdd");

describe("NotificationHandler", () => {
  let pinia: Pinia;
  let wrapper: VueWrapper;

  async function answer(text: string) {
    await nextTick();
    const button = wrapper
      .findAll(".buttons button")
      .find((item) => item.text() === text);
    await button?.trigger("click");
  }

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => {
    pinia = createTestPinia();
    wrapper = mount(NotificationHandler, mountOptions(pinia));
  });

  it("should answer yes", async () => {
    const notification = useNotificationStore(pinia);
    const confirmed = notification.confirm("Delete?");
    await nextTick();
    wrapper.text().should.contain("Delete?");

    await answer(i18n.yes);

    (await confirmed).should.equal(true);
    notification.confirmMessage.should.equal("");
  });

  it("should answer no", async () => {
    const confirmed = useNotificationStore(pinia).confirm("Delete?");

    await answer(i18n.no);

    (await confirmed).should.equal(false);
  });

  it("should answer no to a question that a new one replaced", async () => {
    const notification = useNotificationStore(pinia);
    const first = notification.confirm("First?");
    const second = notification.confirm("Second?");

    (await first).should.equal(false);
    notification.confirmMessage.should.equal("Second?");
    await answer(i18n.yes);
    (await second).should.equal(true);
  });

  it("should name the action of a dangerous question", async () => {
    const notification = useNotificationStore(pinia);
    const confirmed = notification.confirm({
      title: "Delete Cloudflare?",
      message: "The account will disappear.",
      confirm: "Delete",
      danger: true,
    });
    await nextTick();

    wrapper.find(".dialog-title").text().should.equal("Delete Cloudflare?");
    wrapper.find(".button.danger").text().should.equal("Delete");
    await answer(i18n.cancel);

    (await confirmed).should.equal(false);
  });

  it("should answer no on Escape", async () => {
    const confirmed = useNotificationStore(pinia).confirm("Delete?");
    await nextTick();

    await wrapper.find(".dialog").trigger("keydown", { key: "Escape" });

    (await confirmed).should.equal(false);
  });

  it("should show the messages one by one", async () => {
    const notification = useNotificationStore(pinia);
    notification.alert("First");
    notification.alert("Second");
    await nextTick();

    wrapper.find(".message").text().should.equal("Second");
    await answer(i18n.ok);
    wrapper.find(".message").text().should.equal("First");
    await answer(i18n.ok);

    wrapper.find(".dialog").exists().should.equal(false);
  });

  describe("prompt", () => {
    function ask() {
      return useNotificationStore(pinia).prompt({
        title: "Rename group",
        label: "Name",
        value: "Work",
        confirm: "Save",
        maxlength: 32,
      });
    }

    function input() {
      return wrapper.find<HTMLInputElement>(".dialog input");
    }

    it("should show the current name selected and answer with the entered one when the form is sent", async () => {
      wrapper.unmount();
      wrapper = mount(NotificationHandler, {
        ...mountOptions(pinia),
        attachTo: document.body,
      });
      const answered = ask();
      await nextTick();
      await nextTick();

      wrapper.find(".dialog-title").text().should.equal("Rename group");
      wrapper.find("label").text().should.equal("Name");
      input().element.value.should.equal("Work");
      input().attributes("maxlength")?.should.equal("32");
      chai.expect(document.activeElement).to.equal(input().element);
      chai.expect(input().element.selectionStart).to.equal(0);
      chai.expect(input().element.selectionEnd).to.equal(4);

      await input().setValue("Job");
      await wrapper.find("form").trigger("submit");

      chai.expect(await answered).to.equal("Job");
      wrapper.find(".dialog").exists().should.equal(false);
      wrapper.unmount();
    });

    it("should answer nothing on Escape and on cancel", async () => {
      const escaped = ask();
      await nextTick();
      await wrapper.find(".dialog").trigger("keydown", { key: "Escape" });
      chai.expect(await escaped).to.equal(null);

      const cancelled = ask();
      await answer(i18n.cancel);
      chai.expect(await cancelled).to.equal(null);
    });

    it("should not save an empty name", async () => {
      const answered = ask();
      await nextTick();
      await input().setValue("   ");

      wrapper
        .find("button[type='submit']")
        .attributes()
        .should.have.property("disabled");
      await wrapper.find("form").trigger("submit");
      wrapper.find(".dialog").exists().should.equal(true);

      await answer(i18n.cancel);
      chai.expect(await answered).to.equal(null);
    });
  });
});
