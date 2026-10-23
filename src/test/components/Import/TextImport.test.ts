import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";

import Vue from "vue";
import { mount, createLocalVue, Wrapper } from "@vue/test-utils";
import CommonComponents from "../../../components/common/index";

import TextImport from "../../../components/Import/TextImport.vue";
import { loadI18nMessages } from "../../../store/i18n";
import { EntryStorage } from "../../../models/storage";
import {
  cacheSessionKey,
  clearSession,
  resetStorage,
  storeKey,
} from "../../storage-helper";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");
const localVue = createLocalVue();

const SECRET = "JBSWY3DPEHPK3PXP";

async function importCode(wrapper: Wrapper<Vue>) {
  await wrapper.setData({
    importCode: `otpauth://totp/Example:alice?secret=${SECRET}`,
  });
  await (
    wrapper.vm as unknown as { importBackupCode(): Promise<void> }
  ).importBackupCode();
}

describe("TextImport", () => {
  let alert: sinon.SinonSpy;
  let close: sinon.SinonSpy;

  before(async () => {
    localVue.prototype.i18n = await loadI18nMessages();
    for (const component of CommonComponents) {
      localVue.component(component.name, component.component);
    }
  });

  beforeEach(async () => {
    await resetStorage();
    await clearSession();
    alert = sinon.fake();
    close = sinon.fake();
    sinon.replace(window, "alert", alert);
    sinon.replace(window, "close", close);
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
  });

  it("should import under the current key of the session", async () => {
    await storeKey("session-key");
    const encryption = await cacheSessionKey("session-key");
    const wrapper = mount(TextImport, { localVue });

    await importCode(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].keyId).to.equal("session-key");
    await entries[0].applyEncryption(encryption);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.updateSuccess,
    );
    close.should.have.been.calledOnce;
  });

  it("should not import while the accounts are locked", async () => {
    await storeKey("session-key");
    const wrapper = mount(TextImport, { localVue });

    await importCode(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.phrase_incorrect,
    );
    close.should.not.have.been.called;
  });

  it("should not import when the key of the session is no longer stored", async () => {
    await storeKey("new-key");
    await cacheSessionKey("old-key");
    const wrapper = mount(TextImport, { localVue });

    await importCode(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.phrase_incorrect,
    );
    close.should.not.have.been.called;
  });

  it("should import an account in the open when no password is set", async () => {
    const wrapper = mount(TextImport, { localVue });

    await importCode(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].secret).to.equal(SECRET);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.updateSuccess,
    );
  });
});
