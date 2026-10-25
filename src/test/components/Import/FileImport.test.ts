import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";

import FileImport from "../../../components/Import/FileImport.vue";
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

describe("FileImport", () => {
  let alert: sinon.SinonSpy;
  let alerted: Promise<void>;

  async function chooseFile(wrapper: VueWrapper, content: string) {
    const input = wrapper.find<HTMLInputElement>("input[type='file']");
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], "backup.json"));
    input.element.files = transfer.files;
    await input.trigger("change");
    await alerted;
  }

  async function importFile(wrapper: VueWrapper) {
    const hash = crypto.randomUUID();
    const backup: { [hash: string]: RawOTPStorage } = {
      [hash]: {
        hash,
        index: 0,
        encrypted: false,
        secret: SECRET,
        type: "totp",
        account: "alice",
      },
    };
    await chooseFile(wrapper, JSON.stringify(backup));
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
    sinon.replace(window, "alert", alert);
    sinon.replace(window, "close", sinon.fake());
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
  });

  it("should import a backup under the current key of the session", async () => {
    await storeKey("session-key");
    const encryption = await cacheSessionKey("session-key");
    const wrapper = mount(FileImport, mountOptions());

    await importFile(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].keyId).to.equal("session-key");
    await entries[0].applyEncryption(encryption);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(i18n.updateSuccess);
  });

  it("should not import a backup while the accounts are locked", async () => {
    await storeKey("session-key");
    const wrapper = mount(FileImport, mountOptions());

    await importFile(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(i18n.phrase_incorrect);
  });

  it("should import an otpauth line from the chosen file", async () => {
    const wrapper = mount(FileImport, mountOptions());

    await chooseFile(wrapper, `otpauth://totp/Example:alice?secret=${SECRET}`);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].secret).to.equal(SECRET);
    entries[0].issuer.should.equal("Example");
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(i18n.updateSuccess);
  });
});
