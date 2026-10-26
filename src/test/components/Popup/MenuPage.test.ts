import "mocha";
import * as chai from "chai";
import "chai/register-should";
import { assert } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { mount, VueWrapper } from "@vue/test-utils";
import type { Pinia } from "pinia";

import { i18n, loadI18nMessages, t } from "../../../store/i18n";
import { useMenuStore } from "../../../store/Menu";
import MenuPage from "../../../components/Popup/MenuPage.vue";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

describe("MenuPage", () => {
  before(async () => {
    await loadI18nMessages();
  });

  let pinia: Pinia;

  let wrapper: VueWrapper;

  beforeEach(async () => {
    pinia = createTestPinia();
    useMenuStore(pinia).version = "1.2.3";
    wrapper = mount(MenuPage, mountOptions(pinia));
  });

  const clickMenuPageButtonByTitle = async (
    wrapper: VueWrapper,
    title: string,
  ) => wrapper.find(`*[title='${title}']`).trigger("click");

  describe("feedback button", () => {
    const realNavigator = Object.getOwnPropertyDescriptor(global, "navigator");

    after(() => {
      Object.defineProperty(
        global,
        "navigator",
        realNavigator as PropertyDescriptor,
      );
    });

    // mocks the user agent for testing purposes
    const mockUserAgent = (userAgent: string) => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent,
        },
        configurable: true,
        enumerable: true,
        writable: true,
      });
    };

    let createTab: sinon.SinonSpy;

    beforeEach(() => {
      createTab = sinon.fake.resolves(undefined);
      sinon.replace(chrome.tabs, "create", createTab);
      wrapper = mount(MenuPage, mountOptions(pinia));
    });

    it("should open a new tab to the issues page of the fork when the feedback button is clicked", async () => {
      await clickMenuPageButtonByTitle(wrapper, i18n.feedback);
      createTab.should.have.been.calledOnceWithExactly({
        url: "https://github.com/nolequen/Authenticator/issues",
      });
    });

    it("should open the same issues page when the user agent is Firefox", async () => {
      mockUserAgent(
        "Mozilla/5.0 (Windows NT x.y; rv:10.0) Gecko/20100101 Firefox/10.0",
      );
      await clickMenuPageButtonByTitle(wrapper, i18n.feedback);
      createTab.should.have.been.calledOnceWithExactly({
        url: "https://github.com/nolequen/Authenticator/issues",
      });
    });
  });

  describe("extension version", () => {
    it("should be displayed", () => {
      assert.equal(wrapper.find("#version").text(), t("version", "1.2.3"));
      assert.include(wrapper.find("#version").text(), "1.2.3");
    });
  });
});
