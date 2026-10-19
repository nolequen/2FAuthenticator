import "mocha";
import * as chai from "chai";
import { assert } from "chai";
import * as sinonChai from "sinon-chai";
import { createLocalVue, mount, Wrapper } from "@vue/test-utils";
import Vuex, { Store } from "vuex";

import { loadI18nMessages } from "../../../store/i18n";
import MenuPage from "../../../components/Popup/MenuPage.vue";

import chrome from "sinon-chrome";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");
const localVue = createLocalVue();

describe("MenuPage", () => {
  before(async () => {
    localVue.prototype.i18n = await loadI18nMessages();
    localVue.use(Vuex);
  });

  let storeOpts = {
    menu: {
      state: {
        version: "1.2.3",
      },
      namespaced: true,
    },
  };

  let store: Store<{}>;

  let wrapper: Wrapper<any>;

  before(() => {
    // mock the chrome global object
    global.chrome.tabs.create = chrome.tabs.create;
  });

  beforeEach(async () => {
    store = new Vuex.Store({
      modules: storeOpts,
    });
    wrapper = mount(MenuPage, {
      store,
      localVue,
    });
  });

  const clickMenuPageButtonByTitle = async (
    wrapper: Wrapper<any>,
    title: string,
  ) => wrapper.find(`*[title='${title}']`).trigger("click");

  describe("feedback button", () => {
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

    beforeEach(() => {
      chrome.tabs.create.resetHistory();
      wrapper = mount(MenuPage, {
        store,
        localVue,
      });
    });

    it("should open a new tab to the issues page of the fork when the feedback button is clicked", async () => {
      await clickMenuPageButtonByTitle(wrapper, "Feedback");
      assert.ok(
        chrome.tabs.create.withArgs({
          url: "https://github.com/nolequen/Authenticator/issues",
        }).calledOnce,
        "Tab create should be called with the issues URL",
      );
    });

    it("should open the same issues page when the user agent is Firefox", async () => {
      mockUserAgent(
        "Mozilla/5.0 (Windows NT x.y; rv:10.0) Gecko/20100101 Firefox/10.0",
      );
      await clickMenuPageButtonByTitle(wrapper, "Feedback");
      assert.ok(
        chrome.tabs.create.withArgs({
          url: "https://github.com/nolequen/Authenticator/issues",
        }).calledOnce,
        "Tab create should be called with the issues URL",
      );
    });
  });

  describe("extension version", () => {
    it("should be displayed", () => {
      assert.equal(wrapper.find("#version").text(), "Version 1.2.3");
    });
  });
});
