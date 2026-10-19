import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";

import { mount, createLocalVue } from "@vue/test-utils";
import Vuex from "vuex";
import CommonComponents from "../../../components/common/index";

import AddAccountPage from "../../../components/Popup/AddAccountPage.vue";
import { loadI18nMessages } from "../../../store/i18n";
import { Encryption } from "../../../models/encryption";
import { OTPAlgorithm, OTPType } from "../../../models/otp";
import { resetStorage } from "../../storage-helper";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");
const localVue = createLocalVue();

const SECRET = "JBSWY3DPEHPK3PXP";
const SHA512_SECRET = "blxnmpn2m2ebd4glchipydbbsclfvh553vnjqlmuqlzyxlbjsgga";

describe("AddAccountPage", () => {
  before(async () => {
    localVue.prototype.i18n = await loadI18nMessages();
    localVue.use(Vuex);
    for (const component of CommonComponents) {
      localVue.component(component.name, component.component);
    }
  });

  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  it("should save a new account encrypted when a password is set", async () => {
    const store = new Vuex.Store({
      modules: {
        accounts: {
          namespaced: true,
          state: {
            defaultEncryption: "test-key-id",
            encryption: new Map([
              ["test-key-id", new Encryption("test-passphrase", "test-key-id")],
            ]),
            OTPType,
            OTPAlgorithm,
          },
          actions: { addCode: sinon.fake() },
        },
        notification: {
          namespaced: true,
          mutations: { alert: sinon.fake() },
        },
        style: {
          namespaced: true,
          mutations: { hideInfo: sinon.fake(), toggleEdit: sinon.fake() },
        },
      },
    });
    const wrapper = mount(AddAccountPage, { store, localVue });

    await wrapper.setData({
      newAccount: {
        issuer: "Example",
        account: "user",
        secret: SECRET,
        type: OTPType.totp,
        period: undefined,
        digits: 6,
        algorithm: OTPAlgorithm.SHA1,
      },
    });
    await (
      wrapper.vm as unknown as {
        addNewAccount(): Promise<void>;
      }
    ).addNewAccount();

    const stored = await chrome.storage.local.get();
    const entries = Object.keys(stored)
      .map((key) => stored[key])
      .filter((item) => item.dataType !== undefined && item.dataType !== "Key");
    entries.should.have.lengthOf(1);
    entries[0].dataType.should.equal("EncOTPStorage");
    JSON.stringify(stored).should.not.contain(SECRET);
  });

  describe("with SHA-512 and 8 digits", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    it("should add the account with the selected algorithm and digits", async () => {
      const addCode = sinon.fake();
      const store = new Vuex.Store({
        modules: {
          accounts: {
            namespaced: true,
            state: {
              defaultEncryption: "",
              encryption: new Map(),
              OTPType,
              OTPAlgorithm,
            },
            actions: { addCode },
          },
          notification: {
            namespaced: true,
            mutations: { alert: sinon.fake() },
          },
          style: {
            namespaced: true,
            mutations: { hideInfo: sinon.fake(), toggleEdit: sinon.fake() },
          },
        },
      });
      const wrapper = mount(AddAccountPage, { store, localVue });
      await wrapper.setData({
        newAccount: { issuer: "Example", secret: SHA512_SECRET },
      });

      const selects = wrapper.findAll("select");
      const choose = async (optionText: string, value: string) => {
        const select = selects
          .filter((item) => item.text().includes(optionText))
          .at(0);
        (select.element as HTMLSelectElement).value = value;
        await select.trigger("input");
      };
      await choose("SHA-512", String(OTPAlgorithm.SHA512));
      await choose("8", "8");

      clock = sinon.useFakeTimers({
        now: 1700000000 * 1000,
        toFake: ["Date"],
      });
      await (
        wrapper.vm as unknown as {
          addNewAccount(): Promise<void>;
        }
      ).addNewAccount();

      addCode.should.have.been.calledOnce;
      const entry = addCode.lastCall.args[1];
      chai.expect(entry.algorithm).to.equal(OTPAlgorithm.SHA512);
      chai.expect(entry.digits).to.equal(8);
      chai.expect(entry.code).to.equal("79500213");
    });
  });
});
