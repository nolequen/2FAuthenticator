import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";

import Vue from "vue";
import { mount, createLocalVue, Wrapper } from "@vue/test-utils";
import CommonComponents from "../../../components/common/index";

import FileImport from "../../../components/Import/FileImport.vue";
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

describe("FileImport", () => {
  let alert: sinon.SinonSpy;
  let alerted: Promise<void>;

  async function importFile(wrapper: Wrapper<Vue>) {
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
    (
      wrapper.vm as unknown as {
        importFile(event: Event, closeWindow: boolean): void;
      }
    ).importFile(
      {
        target: { files: [new File([JSON.stringify(backup)], "backup.json")] },
      } as unknown as Event,
      true,
    );
    await alerted;
  }

  before(async () => {
    localVue.prototype.i18n = await loadI18nMessages();
    for (const component of CommonComponents) {
      localVue.component(component.name, component.component);
    }
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
    const wrapper = mount(FileImport, { localVue });

    await importFile(wrapper);

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].keyId).to.equal("session-key");
    await entries[0].applyEncryption(encryption);
    entries[0].account.should.equal("alice");
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.updateSuccess,
    );
  });

  it("should not import a backup while the accounts are locked", async () => {
    await storeKey("session-key");
    const wrapper = mount(FileImport, { localVue });

    await importFile(wrapper);

    (await EntryStorage.get()).should.have.lengthOf(0);
    alert.should.have.been.calledOnceWith(
      localVue.prototype.i18n.phrase_incorrect,
    );
  });
});
