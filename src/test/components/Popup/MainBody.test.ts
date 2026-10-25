import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { mount } from "@vue/test-utils";

import MainBody from "../../../components/Popup/MainBody.vue";
import { loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { OTPEntry, OTPType } from "../../../models/otp";
import { createTestPinia, mountOptions } from "../../vue-helper";

mocha.setup("bdd");

function entry(issuer: string, account: string, index: number) {
  return new OTPEntry({
    type: OTPType.totp,
    index,
    issuer,
    account,
    encrypted: false,
    secret: "JBSWY3DPEHPK3PXP",
  });
}

describe("MainBody", () => {
  before(async () => {
    await loadI18nMessages();
  });

  it("should mark only the accounts that do not match the search", async () => {
    const pinia = createTestPinia();
    const accounts = useAccountsStore(pinia);
    accounts.entries = [entry("Alpha", "alice", 0), entry("Beta", "bob", 1)];
    const wrapper = mount(MainBody, mountOptions(pinia));

    await wrapper.find("#searchInput").setValue("alp");

    const [alpha, beta] = wrapper.findAll("a.entry");
    alpha.text().should.contain("Alpha");
    chai.expect(alpha.attributes("not-searched")).to.equal(undefined);
    chai.expect(beta.attributes("not-searched")).to.not.equal(undefined);

    await wrapper.find("#searchInput").setValue("");

    chai.expect(beta.attributes("not-searched")).to.equal(undefined);
  });
});
