import "mocha";
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
});
