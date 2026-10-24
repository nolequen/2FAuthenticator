import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";

import { mount } from "@vue/test-utils";
import type { Pinia } from "pinia";

import EnterPasswordPage from "../../../components/Popup/EnterPasswordPage.vue";
import { loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");

describe("EnterPasswordPage", () => {
  before(async () => {
    await loadI18nMessages();
  });

  let pinia: Pinia;
  let applyPassphrase: sinon.SinonStub;

  beforeEach(() => {
    pinia = createTestPinia();
    applyPassphrase = sinon
      .stub(useAccountsStore(pinia), "applyPassphrase")
      .resolves();
  });

  it("should apply password when button is clicked", async () => {
    const wrapper = mount(EnterPasswordPage, mountOptions(pinia));

    const passwordInput = wrapper.find("input");
    const passwordButton = wrapper.find("button");

    await passwordInput.setValue("somePassword");
    await passwordButton.trigger("click");
    applyPassphrase.should.have.been.calledWith("somePassword");
  });

  it("should apply password when enter is pressed", async () => {
    const wrapper = mount(EnterPasswordPage, mountOptions(pinia));

    const passwordInput = wrapper.find("input");

    await passwordInput.setValue("anotherPassword");
    await passwordInput.trigger("keyup.enter");
    applyPassphrase.should.have.been.calledWith("anotherPassword");
  });

  it("should autofocus password input", () => {
    const wrapper = mount(EnterPasswordPage, {
      ...mountOptions(pinia),
      attachTo: document.body,
    });

    const passwordInput = wrapper.find("input");

    passwordInput.element.should.eq(document.activeElement);
    wrapper.unmount();
  });

  it("should not show incorrect password message", () => {
    const wrapper = mount(EnterPasswordPage, {
      ...mountOptions(pinia),
      attachTo: document.body,
    });

    const errorText = wrapper.find("label.warning");

    errorText.isVisible().should.be.false;
    wrapper.unmount();
  });

  context("Incorrect password was entered", () => {
    beforeEach(() => {
      useAccountsStore(pinia).wrongPassword = true;
    });

    it("should show incorrect password message", () => {
      const wrapper = mount(EnterPasswordPage, {
        ...mountOptions(pinia),
        attachTo: document.body,
      });

      const errorText = wrapper.find("label.warning");

      errorText.isVisible().should.be.true;
      wrapper.unmount();
    });
  });
});
