import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { mount, VueWrapper } from "@vue/test-utils";
import type { Pinia } from "pinia";

import AddAccountPage from "../../../components/Popup/AddAccountPage.vue";
import TextInput from "../../../components/common/TextInput.vue";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useCurrentViewStore } from "../../../store/CurrentView";
import { useNotificationStore } from "../../../store/Notification";
import { Encryption } from "../../../models/encryption";
import { OTPAlgorithm, OTPEntry, OTPType } from "../../../models/otp";
import { EntryStorage } from "../../../models/storage";
import { randomPassphrase, resetStorage, storeKey } from "../../storage-helper";
import { createTestPinia, mountOptions } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const SHA512_SECRET = "blxnmpn2m2ebd4glchipydbbsclfvh553vnjqlmuqlzyxlbjsgga";

function stubStores(pinia: Pinia) {
  const accounts = useAccountsStore(pinia);
  let closed: () => void = () => undefined;
  const entryAdded = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const addEntry = sinon.spy(accounts, "addEntry");
  sinon.stub(useNotificationStore(pinia), "alert");
  const close = sinon
    .stub(useCurrentViewStore(pinia), "close")
    .callsFake(() => closed());
  return { accounts, addEntry, entryAdded, close };
}

async function setText(wrapper: VueWrapper, label: string, value: string) {
  const field = wrapper
    .findAllComponents(TextInput)
    .find((input) => input.find("label").text() === label);
  if (!field) {
    throw new Error(`No text field ${label}`);
  }
  await field.find("input").setValue(value);
}

describe("AddAccountPage", () => {
  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  it("should save a new account encrypted when a password is set", async () => {
    await storeKey("test-key-id");
    const pinia = createTestPinia();
    const { accounts, entryAdded } = stubStores(pinia);
    accounts.defaultEncryption = "test-key-id";
    accounts.encryption.set(
      "test-key-id",
      new Encryption(randomPassphrase(), "test-key-id"),
    );
    const wrapper = mount(AddAccountPage, mountOptions(pinia));

    await setText(wrapper, i18n.issuer, "Example");
    await setText(wrapper, i18n.secret, SECRET);
    await setText(wrapper, i18n.accountName, "user");
    await wrapper.find("button.add-account").trigger("click");
    await entryAdded;

    const stored = await chrome.storage.local.get<{
      [key: string]: { dataType: string; data: string };
    }>();
    const entries = Object.keys(stored)
      .map((key) => stored[key])
      .filter((item) => item.dataType !== undefined && item.dataType !== "Key");
    entries.should.have.lengthOf(1);
    entries[0].dataType.should.equal("EncOTPStorage");
    entries[0].data.should.match(/^v4:/);
    JSON.stringify(stored).should.not.contain(SECRET);
  });

  describe("with SHA-512 and 8 digits", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    it("should add the account with the selected algorithm and digits", async () => {
      const pinia = createTestPinia();
      const { addEntry, entryAdded, close } = stubStores(pinia);
      clock = sinon.useFakeTimers({
        now: 1700000000 * 1000,
        toFake: ["Date"],
      });
      const wrapper = mount(AddAccountPage, mountOptions(pinia));
      clock.tick(1000);
      await setText(wrapper, i18n.issuer, "Example");
      await setText(wrapper, i18n.secret, SHA512_SECRET);

      const selects = wrapper.findAll("select");
      const choose = async (optionText: string, value: string) => {
        const select = selects.filter((item) =>
          item.text().includes(optionText),
        )[0];
        (select.element as HTMLSelectElement).value = value;
        await select.trigger("input");
      };
      await choose("SHA-512", String(OTPAlgorithm.SHA512));
      await choose("8", "8");

      await wrapper.find("button.add-account").trigger("click");
      await entryAdded;

      addEntry.should.have.been.calledOnce;
      close.should.have.been.calledOnce;
      const entry = addEntry.lastCall.args[0];
      chai.expect(entry.algorithm).to.equal(OTPAlgorithm.SHA512);
      chai.expect(entry.digits).to.equal(8);
      chai.expect(entry.code).to.equal("79500213");
    });
  });

  it("should add the account first into the chosen group", async () => {
    const pinia = createTestPinia();
    const { accounts, entryAdded } = stubStores(pinia);
    const work = new OTPEntry({
      type: OTPType.totp,
      index: 0,
      account: "w1",
      encrypted: false,
      secret: SECRET,
      group: "Work",
    });
    accounts.entries = [
      work,
      new OTPEntry({
        type: OTPType.totp,
        index: 1,
        account: "n1",
        encrypted: false,
        secret: SECRET,
      }),
    ];
    const wrapper = mount(AddAccountPage, mountOptions(pinia));
    const group = wrapper.find<HTMLInputElement>(".group-field input");
    group.attributes("maxlength")?.should.equal("32");

    await setText(wrapper, i18n.issuer, "Example");
    await setText(wrapper, i18n.secret, SECRET);
    await wrapper.find(".group-chips button").trigger("click");
    group.element.value.should.equal("Work");
    await wrapper.find("button.add-account").trigger("click");
    await entryAdded;

    accounts.entries
      .map((item) => `${item.index}:${item.issuer}:${item.group}`)
      .should.deep.equal(["0:Example:Work", "1::Work", "2::"]);
    const stored = (await EntryStorage.get()).map(
      (item) => `${item.index}:${item.issuer}:${item.group}`,
    );
    stored.should.deep.equal(["0:Example:Work", "1::Work", "2::"]);
  });
});
