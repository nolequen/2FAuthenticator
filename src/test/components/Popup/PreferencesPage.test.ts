import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount } from "@vue/test-utils";

import PreferencesPage from "../../../components/Popup/PreferencesPage.vue";
import ToggleInput from "../../../components/common/ToggleInput.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { UserSettings } from "../../../models/settings";
import { resetStorage } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

describe("PreferencesPage", () => {
  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  it("should move the storage once for each click on the sync toggle", async () => {
    const pinia = createTestPinia();
    const migrateStorage = sinon
      .stub(useAccountsStore(pinia), "migrateStorage")
      .resolves("updateSuccess");
    const wrapper = mount(PreferencesPage, {
      ...mountOptions(pinia),
      attachTo: document.body,
    });
    await UserSettings.updateItems();
    const toggle = wrapper
      .findAllComponents(ToggleInput)
      .find((input) => input.find("label").text() === i18n.browser_sync);
    const checkbox = toggle?.find("input");

    await checkbox?.trigger("click");
    migrateStorage.should.have.been.calledOnceWith("sync");

    await checkbox?.trigger("click");
    migrateStorage.should.have.been.calledTwice;
    migrateStorage.secondCall.should.have.been.calledWith("local");
    wrapper.unmount();
  });
});
