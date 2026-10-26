import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";
import type { Pinia } from "pinia";

import SetPasswordPage from "../../../components/Popup/SetPasswordPage.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useNotificationStore } from "../../../store/Notification";
import { clearSession, resetStorage } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const PASSWORD = "right password";

describe("SetPasswordPage", function () {
  this.timeout(20000);

  let pinia: Pinia;
  let wrapper: VueWrapper;
  let changePassphrase: sinon.SinonStub;
  let alert: sinon.SinonStub;

  before(async () => {
    await loadI18nMessages();
  });

  async function openPage(withPassword: boolean) {
    pinia = createTestPinia();
    const accounts = useAccountsStore(pinia);
    await accounts.init();
    if (withPassword) {
      await accounts.changePassphrase(PASSWORD);
    }
    changePassphrase = sinon.stub(accounts, "changePassphrase").resolves();
    alert = sinon.stub(useNotificationStore(pinia), "alert");
    useCurrentViewStore(pinia).open("SetPassword");
    wrapper = mount(SetPasswordPage, mountOptions(pinia));
  }

  async function fill(...values: string[]) {
    const inputs = wrapper.findAll("input[type='password']");
    inputs.should.have.lengthOf(values.length);
    for (const [index, value] of values.entries()) {
      await inputs[index].setValue(value);
    }
  }

  async function settle() {
    const currentView = useCurrentViewStore(pinia);
    for (let i = 0; i < 2000 && currentView.busy; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await wrapper.vm.$nextTick();
  }

  beforeEach(async () => {
    await resetStorage();
    await clearSession();
  });

  afterEach(async () => {
    wrapper?.unmount();
    await resetStorage();
    await clearSession();
  });

  it("should keep the page open when the current password is wrong", async () => {
    await openPage(true);
    await fill("wrong password", "new password", "new password");

    await wrapper.find("#security-save").trigger("click");
    await settle();

    changePassphrase.should.not.have.been.called;
    chai.expect(useCurrentViewStore(pinia).current).to.equal("SetPassword");
    wrapper.find(".field-error").text().should.equal(i18n.phrase_wrong);
  });

  it("should change the password and close the page", async () => {
    await openPage(true);
    await fill(PASSWORD, "new password", "new password");

    await wrapper.find("#security-save").trigger("click");
    await settle();

    changePassphrase.should.have.been.calledOnceWith("new password");
    chai.expect(useCurrentViewStore(pinia).current).to.equal(null);
    alert.should.have.been.calledOnceWith(i18n.updateSuccess);
  });

  it("should not change the password when the new ones differ", async () => {
    await openPage(true);
    await fill(PASSWORD, "new password", "other password");

    await wrapper.find("#security-save").trigger("click");
    await settle();

    changePassphrase.should.not.have.been.called;
    wrapper.find(".field-error").text().should.equal(i18n.phrase_not_match);
  });

  it("should remove the password", async () => {
    await openPage(true);
    await fill(PASSWORD, "", "");

    await wrapper.find("#security-remove").trigger("click");
    await settle();

    changePassphrase.should.have.been.calledOnceWith("");
    chai.expect(useCurrentViewStore(pinia).current).to.equal(null);
  });

  it("should stay on the page when the change fails", async () => {
    await openPage(true);
    changePassphrase.rejects(new Error("storage"));
    await fill(PASSWORD, "new password", "new password");

    await wrapper.find("#security-save").trigger("click");
    await settle();

    alert.should.have.been.calledOnceWith(i18n.updateFailure);
    chai.expect(useCurrentViewStore(pinia).current).to.equal("SetPassword");
  });

  it("should set a password when none is set", async () => {
    await openPage(false);
    wrapper.find(".status").text().should.contain(i18n.password_not_set);
    wrapper.find("#security-remove").exists().should.equal(false);
    await fill("new password", "new password");

    await wrapper.find("#security-save").trigger("click");
    await settle();

    changePassphrase.should.have.been.calledOnceWith("new password");
  });
});
