import "mocha";
import * as chai from "chai";

import { mount } from "@vue/test-utils";

import MainHeader from "../../../components/Popup/MainHeader.vue";
import IconCheck from "../../../../svg/check.svg";
import IconPencil from "../../../../svg/pencil.svg";
import { loadI18nMessages } from "../../../store/i18n";
import { useStyleStore } from "../../../store/Style";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.should();
mocha.setup("bdd");

describe("MainHeader", () => {
  before(async () => {
    await loadI18nMessages();
  });

  it("should switch the icon of the single edit button", async () => {
    const pinia = createTestPinia();
    const wrapper = mount(MainHeader, mountOptions(pinia));
    wrapper.findAll("#i-edit").should.have.lengthOf(1);
    wrapper.findComponent(IconPencil).exists().should.equal(true);
    wrapper.findComponent(IconCheck).exists().should.equal(false);

    await wrapper.find("#i-edit").trigger("click");

    useStyleStore(pinia).style.isEditing.should.equal(true);
    wrapper.findAll("#i-edit").should.have.lengthOf(1);
    wrapper.findComponent(IconPencil).exists().should.equal(false);
    wrapper.findComponent(IconCheck).exists().should.equal(true);
  });
});
