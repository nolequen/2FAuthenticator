import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";

import TextImport from "../../../components/Import/TextImport.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { EntryStorage } from "../../../models/storage";
import {
  cacheSessionKey,
  clearSession,
  resetStorage,
  storeKey,
} from "../../storage-helper";
import { mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

describe("TextImport", () => {
  let alert: sinon.SinonSpy;
  let alerted: Promise<void>;
  let close: sinon.SinonSpy;

  async function importCode(wrapper: VueWrapper) {
    await wrapper
      .find("textarea")
      .setValue(`otpauth://totp/Example:alice?secret=${SECRET}`);
    await wrapper.find("button").trigger("click");
    await alerted;
  }

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(async () => {
    await resetStorage();
    await clearSession();
    alerted = new Promise((resolve) => {
      alert = sinon.fake(() => resolve());
    });
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
    const wrapper = mount(TextImport, mountOptions());

    await importCode(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].keyId).to.equal("session-key");
    await entries[0].applyEncryption(encryption);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(i18n.updateSuccess);
    close.should.have.been.calledOnce;
  });

  it("should not import while the accounts are locked", async () => {
    await storeKey("session-key");
    const wrapper = mount(TextImport, mountOptions());

    await importCode(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(i18n.phrase_incorrect);
    close.should.not.have.been.called;
  });

  it("should not import when the key of the session is no longer stored", async () => {
    await storeKey("new-key");
    await cacheSessionKey("old-key");
    const wrapper = mount(TextImport, mountOptions());

    await importCode(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(i18n.phrase_incorrect);
    close.should.not.have.been.called;
  });

  it("should import an account in the open when no password is set", async () => {
    const wrapper = mount(TextImport, mountOptions());

    await importCode(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].secret).to.equal(SECRET);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(i18n.updateSuccess);
  });
});
