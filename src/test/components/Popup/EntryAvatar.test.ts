import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import EntryAvatar from "../../../components/Popup/EntryAvatar.vue";
import { useMenuStore } from "../../../store/Menu";
import { createTestPinia, mountOptions } from "../../vue-helper";

mocha.setup("bdd");

describe("EntryAvatar", () => {
  function mountAvatar(issuer: string, hash?: string) {
    const pinia = createTestPinia();
    const wrapper = mount(EntryAvatar, {
      ...mountOptions(pinia),
      props: { issuer, hash },
    });
    return { pinia, wrapper };
  }

  it("should show the icon of the site once it is loaded", async () => {
    const { wrapper } = mountAvatar("GitHub::github.com");
    const image = wrapper.find("img");
    chai
      .expect(image.attributes("src"))
      .to.equal("https://github.com/favicon.ico");
    wrapper.text().should.equal("G");
    image.classes().should.not.include("loaded");

    await image.trigger("load");

    image.classes().should.include("loaded");
    wrapper.classes().should.include("site-icon");
    wrapper.text().should.equal("");
  });

  it("should show the letter when the icon fails to load", async () => {
    const { wrapper } = mountAvatar("GitHub::github.com");

    await wrapper.find("img").trigger("error");

    wrapper.find("img").exists().should.equal(false);
    wrapper.text().should.equal("G");
  });

  it("should show the letter without a site", () => {
    const { wrapper } = mountAvatar("GitHub");
    wrapper.find("img").exists().should.equal(false);
    wrapper.text().should.equal("G");
  });

  it("should not load the icon of an address that is not a plain domain", () => {
    for (const issuer of ["Router::192.168.1.1", "Evil::a@10.0.0.5"]) {
      const { wrapper } = mountAvatar(issuer);
      wrapper.find("img").exists().should.equal(false);
    }
  });

  it("should show the letter for an account with its website icon turned off", async () => {
    const { pinia, wrapper } = mountAvatar("GitHub::github.com", "first");
    useMenuStore(pinia).siteIconsOff = ["second"];
    await nextTick();
    wrapper.find("img").exists().should.equal(true);

    useMenuStore(pinia).siteIconsOff = ["first"];
    await nextTick();

    wrapper.find("img").exists().should.equal(false);
    wrapper.text().should.equal("G");
  });

  it("should show the letter when the website icons are turned off", async () => {
    const { pinia, wrapper } = mountAvatar("GitHub::github.com");
    await wrapper.find("img").trigger("load");

    useMenuStore(pinia).siteIcons = false;
    await nextTick();

    wrapper.find("img").exists().should.equal(false);
    wrapper.classes().should.not.include("site-icon");
    wrapper.text().should.equal("G");
  });
});
