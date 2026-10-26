import "mocha";
import "chai/register-should";

import { mount } from "@vue/test-utils";

import MainHeader from "../../../components/Popup/MainHeader.vue";
import { OTPEntry, OTPType } from "../../../models/otp";
import { loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { createTestPinia, mountOptions } from "../../vue-helper";

mocha.setup("bdd");

describe("MainHeader", () => {
  before(async () => {
    await loadI18nMessages();
  });

  it("should have no edit button", () => {
    const pinia = createTestPinia();
    useAccountsStore(pinia).entries = [
      new OTPEntry({
        type: OTPType.totp,
        index: 0,
        issuer: "Example",
        account: "alice",
        encrypted: false,
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ];
    const wrapper = mount(MainHeader, mountOptions(pinia));
    wrapper.find("#i-edit").exists().should.equal(false);
    wrapper.find("#i-done").exists().should.equal(false);
    wrapper.find("#i-plus").exists().should.equal(true);
  });

  it("should open the menu and the add page", async () => {
    const pinia = createTestPinia();
    const currentView = useCurrentViewStore(pinia);
    const wrapper = mount(MainHeader, mountOptions(pinia));

    await wrapper.find("#i-plus").trigger("click");
    [...currentView.stack].should.deep.equal(["AddMethod"]);

    currentView.close();
    await wrapper.find("#i-menu").trigger("click");
    [...currentView.stack].should.deep.equal(["Menu"]);
  });

  it("should show the lock only when a password is set", async () => {
    const pinia = createTestPinia();
    const wrapper = mount(MainHeader, mountOptions(pinia));
    wrapper.find("#i-lock").exists().should.equal(false);

    useAccountsStore(pinia).defaultEncryption = "key";
    await wrapper.vm.$nextTick();

    wrapper.find("#i-lock").exists().should.equal(true);
  });
});
