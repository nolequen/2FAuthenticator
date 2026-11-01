import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import type { Pinia } from "pinia";

import { setAndroid } from "../../browser";
import DriveTab from "../../components/Drive.vue";
import MirrorConnect from "../../components/Drive/MirrorConnect.vue";
import DriveMirrorSection from "../../components/Popup/DriveMirrorSection.vue";
import MainBody from "../../components/Popup/MainBody.vue";
import MirrorBrowserPage from "../../components/Popup/MirrorBrowserPage.vue";
import MirrorPasswordPage from "../../components/Popup/MirrorPasswordPage.vue";
import NotificationHandler from "../../components/Popup/NotificationHandler.vue";
import type { DriveMessage } from "../../drive/background";
import { accountsCount, browserName, formatMoment } from "../../drive/display";
import type { Backup, DriveCopyInfo } from "../../drive/mirror";
import type { DriveMirror, DriveRecord } from "../../drive/state";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { EntryStorage } from "../../models/storage";
import { i18n, loadI18nMessages, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";
import {
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import { resetStorage, storeKey } from "../storage-helper";
import { createTestPinia, mountOptions } from "../vue-helper";
import { FakeDrive } from "../drive/fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const COPY_PASSWORD = "copy password";

type Answers = { [action: string]: unknown };

interface CopyKey {
  key: Key;
  passphrase: string;
  encryption: Encryption;
}

function answerMessages(answers: Answers) {
  const send = sinon.fake(
    async (message: DriveMessage) => answers[message.action],
  );
  sinon.replace(
    chrome.runtime,
    "sendMessage",
    send as unknown as typeof chrome.runtime.sendMessage,
  );
  return send;
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 1000 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!condition()) {
    throw new Error("The condition did not come true.");
  }
}

async function storeAccounts(count: number) {
  const items: { [hash: string]: RawOTPStorage } = {};
  for (let index = 0; index < count; index++) {
    const hash = crypto.randomUUID();
    items[hash] = {
      dataType: "OTPStorage",
      account: `account ${index}`,
      encrypted: false,
      hash,
      index,
      secret: SECRET,
      type: "totp",
    };
  }
  await chrome.storage.local.set(items);
}

function copyInfo(id: string, browser: string, modifiedTime: string) {
  const info: DriveCopyInfo = {
    id,
    name: `2fauthenticator-${browser}-2026-10-30.json`,
    modifiedTime,
    browser,
    day: "2026-10-30",
    accounts: 1,
  };
  return info;
}

describe("Google Drive components on a phone", function () {
  this.timeout(30000);

  let pinia: Pinia;
  let wrapper: VueWrapper | undefined;
  let copyKey: CopyKey;
  let copy: Backup;

  before(async () => {
    await loadI18nMessages();
    copyKey = await createKey(COPY_PASSWORD);
    const hash = crypto.randomUUID();
    const entry: RawOTPStorage = {
      dataType: "OTPStorage",
      account: "from the copy",
      encrypted: false,
      hash,
      index: 0,
      secret: SECRET,
      type: "totp",
    };
    copy = {
      [hash]: {
        dataType: "EncOTPStorage",
        data: await copyKey.encryption.encrypt(JSON.stringify(entry)),
        keyId: copyKey.key.id,
        index: 0,
      },
      [copyKey.key.id]: copyKey.key,
    };
  });

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    pinia = createTestPinia();
    useDriveStore(pinia).available = true;
    setAndroid(true);
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    setAndroid(false);
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  function mirrorRecord(
    mirror: Partial<DriveMirror> = {},
    fields: Partial<DriveRecord> = {},
  ) {
    return driveRecord({
      client: "desktop",
      browser: "firefox",
      email: "user@example.com",
      mirror: { source: "chrome", keys: {}, ...mirror },
      ...fields,
    });
  }

  async function showRecord(record: DriveRecord) {
    await storeDriveRecord(record);
    await useDriveStore(pinia).refresh();
  }

  function mountWithNotifications(component: object) {
    wrapper = mount(
      { render: () => h("div", [h(component), h(NotificationHandler)]) },
      mountOptions(pinia),
    );
    return wrapper;
  }

  async function enterPassword(page: VueWrapper, password: string) {
    await page.find(".mirror-password-form input").setValue(password);
    await page.find(".mirror-password-form").trigger("submit");
  }

  describe("tab", () => {
    let drive: FakeDrive;

    beforeEach(() => {
      drive = new FakeDrive().install();
      sinon.replace(
        chrome.identity,
        "getRedirectURL",
        () => "https://id.chromiumapp.org/",
      );
      sinon.replace(
        chrome.identity,
        "launchWebAuthFlow",
        sinon.fake(async (details: chrome.identity.WebAuthFlowDetails) => {
          const state = new URL(details.url).searchParams.get("state");
          return `https://id.chromiumapp.org/#access_token=access-token&expires_in=3600&state=${state}`;
        }) as unknown as typeof chrome.identity.launchWebAuthFlow,
      );
    });

    async function signIn(page: VueWrapper) {
      await page.find(".drive-step.active .button.primary").trigger("click");
    }

    it("should sign in, offer the newest browser, ask for the password and show the codes", async () => {
      const createAlarm = sinon.stub(chrome.alarms, "create").resolves();
      const send = answerMessages({
        "drive.list": {
          files: [
            copyInfo("chrome-copy", "chrome", "2026-10-30T08:00:00.000Z"),
            copyInfo("edge-copy", "edge", "2026-10-30T09:00:00.000Z"),
          ],
        },
        "drive.download": { text: JSON.stringify(copy) },
        "drive.mirrorCheck": { status: "applied" },
      });
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      wrapper.text().should.contain(i18n.mirror_tab_lead);
      await signIn(wrapper);
      await waitFor(() => wrapper!.find(".mirror-sources").exists());

      chai
        .expect((await storedDriveRecord())?.mirror)
        .to.deep.equal({ keys: {} });
      const sources = wrapper.findAll(".mirror-source");
      sources
        .map((source) => source.find(".mirror-source-name").text())
        .should.deep.equal([browserName("edge"), browserName("chrome")]);
      sources[0]
        .find<HTMLInputElement>("input")
        .element.checked.should.equal(true);

      await wrapper.find(".drive-step.active .button.primary").trigger("click");
      await waitFor(() => wrapper!.find(".mirror-password-form").exists());
      wrapper.text().should.contain(i18n.mirror_password_warning);

      await enterPassword(wrapper, "wrong password");
      await waitFor(() => wrapper!.text().includes(i18n.drive_wrong_password));
      chai
        .expect((await storedDriveRecord())?.mirror?.source)
        .to.equal(undefined);

      await enterPassword(wrapper, COPY_PASSWORD);
      await waitFor(() => wrapper!.text().includes(i18n.drive_done));

      const mirror = (await storedDriveRecord())?.mirror;
      chai.expect(mirror?.source).to.equal("edge");
      chai
        .expect(mirror?.keys)
        .to.deep.equal({ [copyKey.key.id]: copyKey.passphrase });
      chai.expect(mirror?.skippedKeys).to.deep.equal([]);
      send.should.have.been.calledWith({
        action: "drive.download",
        id: "edge-copy",
      });
      send.should.have.been.calledWith({
        action: "drive.mirrorCheck",
        force: true,
      });
      send.should.not.have.been.calledWith({ action: "drive.backupNow" });
      createAlarm.should.not.have.been.called;
    });

    it("should not connect when the address of the account cannot be read", async () => {
      const send = answerMessages({});
      drive.fail(
        (request) => request.url.pathname.endsWith("/about"),
        503,
        "backendError",
      );
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      await signIn(wrapper);
      await waitFor(() => wrapper!.text().includes(i18n.drive_signin_failed));

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      send.should.not.have.been.called;
    });

    it("should go on with the choice of the browser after the tab was closed", async () => {
      await storeDriveRecord(
        mirrorRecord({ source: undefined }, { refreshToken: "refresh" }),
      );
      const send = answerMessages({
        "drive.list": {
          files: [copyInfo("chrome-copy", "chrome", "2026-10-30T08:00:00Z")],
        },
      });
      wrapper = mount(DriveTab, mountOptions(pinia));

      await waitFor(() => wrapper!.find(".mirror-sources").exists());

      send.should.have.been.calledOnceWith({ action: "drive.list" });
      wrapper.text().should.contain("user@example.com");
    });

    it("should forget the connection when Drive has no copies", async () => {
      const send = answerMessages({
        "drive.list": { files: [] },
        "drive.disconnect": {},
      });
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      await signIn(wrapper);
      await waitFor(() =>
        wrapper!.text().includes(t("mirror_no_copies", "user@example.com")),
      );

      send.should.have.been.calledWith({ action: "drive.disconnect" });
      wrapper.find(".mirror-sources").exists().should.equal(false);
    });

    it("should warn about the accounts on the phone and remove them with the keys", async () => {
      await storeAccounts(2);
      await storeKey("extension-key");
      answerMessages({
        "drive.list": {
          files: [copyInfo("chrome-copy", "chrome", "2026-10-30T08:00:00Z")],
        },
        "drive.download": { text: JSON.stringify(copy) },
        "drive.mirrorCheck": { status: "applied" },
      });
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      await signIn(wrapper);
      await waitFor(() => wrapper!.find(".mirror-sources").exists());
      await wrapper.find(".drive-step.active .button.primary").trigger("click");
      await waitFor(() => wrapper!.find(".mirror-password-form").exists());
      wrapper.text().should.contain(t("mirror_replace_warning", "2"));
      (await EntryStorage.count()).should.equal(2);

      await enterPassword(wrapper, COPY_PASSWORD);
      await waitFor(() => wrapper!.text().includes(i18n.drive_done));

      (await EntryStorage.count()).should.equal(0);
      (await EntryStorage.hasEncryptionKey()).should.equal(false);
    });

    it("should show the codes again after a sign-in when the browser is known", async () => {
      await storeDriveRecord(
        mirrorRecord({ keys: { [copyKey.key.id]: copyKey.passphrase } }),
      );
      const send = answerMessages({
        "drive.mirrorCheck": { status: "unchanged" },
      });
      wrapper = mount(MirrorConnect, {
        ...mountOptions(pinia),
        props: { signin: true },
      });

      await signIn(wrapper);
      await waitFor(() => wrapper!.text().includes(i18n.drive_done));

      send.should.have.been.calledOnceWith({
        action: "drive.mirrorCheck",
        force: true,
      });
      chai
        .expect((await storedDriveRecord())?.mirror?.source)
        .to.equal("chrome");
    });

    it("should start again and remove the accounts after a sign-in with another account", async () => {
      await storeAccounts(2);
      await storeDriveRecord(
        mirrorRecord(
          { keys: { [copyKey.key.id]: copyKey.passphrase } },
          { email: "old@example.com" },
        ),
      );
      answerMessages({
        "drive.list": {
          files: [copyInfo("chrome-copy", "chrome", "2026-10-30T08:00:00Z")],
        },
      });
      wrapper = mount(MirrorConnect, {
        ...mountOptions(pinia),
        props: { signin: true },
      });

      await signIn(wrapper);
      await waitFor(() => wrapper!.find(".mirror-sources").exists());

      const stored = await storedDriveRecord();
      chai.expect(stored?.email).to.equal("user@example.com");
      chai.expect(stored?.mirror).to.deep.equal({ keys: {} });
      (await EntryStorage.count()).should.equal(0);
    });
  });

  describe("section", () => {
    it("should show the account, the browser and the applied copy", async () => {
      const at = Date.now();
      const modifiedTime = new Date(at - 60000).toISOString();
      await showRecord(
        mirrorRecord({
          applied: { fileId: "file", modifiedTime, accounts: 12, at },
          undecrypted: 2,
        }),
      );

      const section = mountWithNotifications(DriveMirrorSection);

      section.find(".drive-email").text().should.equal("user@example.com");
      section
        .find(".drive-status")
        .text()
        .should.equal(t("mirror_status_applied", formatMoment(at)));
      section.find(".drive-status").classes().should.contain("ok");
      const line = section.find(".drive-account").text();
      line.should.contain(browserName("chrome"));
      line.should.contain(accountsCount(12));
      line.should.contain(
        t("mirror_copy_time", formatMoment(Date.parse(modifiedTime))),
      );
      section.text().should.contain(t("mirror_undecrypted", "2"));
    });

    it("should check the copies now and tell the result", async () => {
      const send = answerMessages({
        "drive.mirrorCheck": { status: "applied" },
      });
      await showRecord(mirrorRecord());
      const section = mountWithNotifications(DriveMirrorSection);

      await section.find(".drive-actions .primary").trigger("click");
      await flushPromises();

      send.should.have.been.calledWith({
        action: "drive.mirrorCheck",
        force: true,
      });
      useNotificationStore(pinia).toast.should.equal(i18n.mirror_updated);
    });

    it("should tell when the browser has no copies", async () => {
      answerMessages({ "drive.mirrorCheck": { status: "none" } });
      await showRecord(mirrorRecord());
      const section = mountWithNotifications(DriveMirrorSection);

      await section.find(".drive-actions .primary").trigger("click");
      await flushPromises();

      useNotificationStore(pinia).toast.should.equal(i18n.mirror_none);
    });

    it("should open the choice of the browser", async () => {
      await showRecord(mirrorRecord());
      const section = mountWithNotifications(DriveMirrorSection);

      await section.findAll(".drive-actions .button")[1].trigger("click");

      chai.expect(useCurrentViewStore(pinia).current).to.equal("MirrorBrowser");
    });

    it("should disconnect the phone after the confirmation", async () => {
      const send = answerMessages({ "drive.disconnect": {} });
      await showRecord(mirrorRecord());
      const section = mountWithNotifications(DriveMirrorSection);
      const notification = useNotificationStore(pinia);

      await section.findAll(".drive-links .button")[0].trigger("click");
      chai
        .expect(notification.confirmation?.message)
        .to.equal(i18n.mirror_disconnect_text);
      notification.answerConfirm(true);
      await flushPromises();

      send.should.have.been.calledOnceWith({ action: "drive.disconnect" });
    });

    async function signOutEverywhere(status: string) {
      const send = answerMessages({ "drive.signOutEverywhere": { status } });
      await showRecord(mirrorRecord());
      const section = mountWithNotifications(DriveMirrorSection);
      const notification = useNotificationStore(pinia);

      await section.findAll(".drive-links .button")[1].trigger("click");
      chai
        .expect(notification.confirmation?.message)
        .to.equal(i18n.drive_sign_out_text);
      notification.answerConfirm(true);
      await flushPromises();
      await waitFor(() => !useCurrentViewStore(pinia).busy);
      await flushPromises();

      send.should.have.been.calledOnceWith({
        action: "drive.signOutEverywhere",
      });
      return notification;
    }

    it("should sign out everywhere after the confirmation", async () => {
      const notification = await signOutEverywhere("done");

      chai.expect([...notification.message]).to.deep.equal([]);
    });

    it("should tell when signing out everywhere failed", async () => {
      const notification = await signOutEverywhere("failed");

      chai
        .expect([...notification.message])
        .to.deep.equal([i18n.drive_sign_out_failed]);
    });

    it("should open the tab to connect and close the popup", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      const close = sinon.stub(window, "close");
      await useDriveStore(pinia).refresh();
      const section = mountWithNotifications(DriveMirrorSection);

      await section.find("button.option").trigger("click");
      await flushPromises();

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html"),
      });
      close.should.have.been.calledOnce;
    });
  });

  describe("password page", () => {
    it("should keep asking while the password is wrong and then show the codes", async () => {
      const send = answerMessages({
        "drive.download": { text: JSON.stringify(copy) },
        "drive.mirrorCheck": { status: "applied" },
      });
      await showRecord(
        mirrorRecord(
          { skippedKeys: ["old-key"] },
          { attention: { kind: "mirrorPassword", fileId: "file" } },
        ),
      );
      useCurrentViewStore(pinia).open("MirrorPassword");
      const page = mountWithNotifications(MirrorPasswordPage);

      await enterPassword(page, "wrong password");
      await waitFor(() => page.text().includes(i18n.drive_wrong_password));
      chai.expect((await storedDriveRecord())?.mirror?.keys).to.deep.equal({});

      await enterPassword(page, COPY_PASSWORD);
      await waitFor(() =>
        send.calledWith({
          action: "drive.mirrorCheck",
          force: true,
        }),
      );

      send.should.have.been.calledWith({
        action: "drive.download",
        id: "file",
      });
      const stored = await storedDriveRecord();
      chai
        .expect(stored?.mirror?.keys)
        .to.deep.equal({ [copyKey.key.id]: copyKey.passphrase });
      chai.expect(stored?.mirror?.skippedKeys).to.deep.equal([]);
      chai.expect(stored?.attention).to.equal(undefined);
      chai.expect(useCurrentViewStore(pinia).current).to.equal(null);
    });

    it("should tell a failure to keep the key", async () => {
      answerMessages({ "drive.download": { text: JSON.stringify(copy) } });
      await showRecord(
        mirrorRecord(
          {},
          { attention: { kind: "mirrorPassword", fileId: "f" } },
        ),
      );
      sinon.stub(useDriveStore(pinia), "unlockMirror").rejects(new Error("x"));
      sinon.stub(console, "warn");
      const page = mountWithNotifications(MirrorPasswordPage);

      await enterPassword(page, COPY_PASSWORD);
      await waitFor(() => useNotificationStore(pinia).message.length > 0);

      chai
        .expect([...useNotificationStore(pinia).message])
        .to.deep.equal([i18n.updateFailure]);
    });
  });

  describe("browser page", () => {
    const sources = {
      files: [
        copyInfo("chrome-copy", "chrome", "2026-10-30T08:00:00Z"),
        copyInfo("edge-copy", "edge", "2026-10-30T09:00:00Z"),
      ],
    };

    it("should switch to a browser whose copy opens with a known key", async () => {
      const send = answerMessages({
        "drive.list": sources,
        "drive.download": { text: JSON.stringify(copy) },
        "drive.mirrorCheck": { status: "applied" },
      });
      await showRecord(
        mirrorRecord({
          keys: { [copyKey.key.id]: copyKey.passphrase },
          applied: { fileId: "old", modifiedTime: "t", accounts: 1, at: 1 },
        }),
      );
      useCurrentViewStore(pinia).open("MirrorBrowser");
      const page = mountWithNotifications(MirrorBrowserPage);
      await waitFor(() => page.findAll(".drive-copy").length === 2);

      page
        .find(".drive-copy[aria-current]")
        .text()
        .should.contain(browserName("chrome"));
      await page.findAll(".drive-copy")[0].trigger("click");
      await waitFor(() =>
        send.calledWith({
          action: "drive.mirrorCheck",
          force: true,
        }),
      );

      send.should.have.been.calledWith({
        action: "drive.download",
        id: "edge-copy",
      });
      const mirror = (await storedDriveRecord())?.mirror;
      chai.expect(mirror?.source).to.equal("edge");
      chai.expect(mirror?.applied).to.equal(undefined);
      page.find(".mirror-password-form").exists().should.equal(false);
    });

    it("should ask for the password of a copy under another key", async () => {
      answerMessages({
        "drive.list": sources,
        "drive.download": { text: JSON.stringify(copy) },
      });
      await showRecord(mirrorRecord());
      useCurrentViewStore(pinia).open("MirrorBrowser");
      const page = mountWithNotifications(MirrorBrowserPage);
      await waitFor(() => page.findAll(".drive-copy").length === 2);

      await page.findAll(".drive-copy")[0].trigger("click");
      await waitFor(() => page.find(".mirror-password-form").exists());

      chai
        .expect((await storedDriveRecord())?.mirror?.source)
        .to.equal("chrome");
    });

    it("should tell when Drive has no copies", async () => {
      answerMessages({ "drive.list": { files: [] } });
      await showRecord(mirrorRecord());
      const page = mountWithNotifications(MirrorBrowserPage);

      await waitFor(() =>
        page.text().includes(t("mirror_no_copies", "user@example.com")),
      );
      page.findAll(".drive-copy").should.have.lengthOf(0);
    });
  });

  describe("banners and empty list", () => {
    function mountBody() {
      useAccountsStore(pinia).completeInit();
      wrapper = mount(MainBody, mountOptions(pinia));
      return wrapper;
    }

    it("should offer to connect Google Drive when the phone has no connection", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      sinon.stub(window, "close");
      await useDriveStore(pinia).refresh();
      const body = mountBody();

      body.find(".no-entry h2").text().should.equal(i18n.mirror_connect_title);
      await body.find(".no-entry .button.primary").trigger("click");

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html"),
      });
    });

    it("should offer to finish the setup before the browser is chosen", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      sinon.stub(window, "close");
      await showRecord(mirrorRecord({ source: undefined }));
      const body = mountBody();

      body.find(".no-entry h2").text().should.equal(i18n.mirror_setup_title);
      const button = body.find(".no-entry .button.primary");
      button.text().should.equal(i18n.mirror_setup_continue);
      await button.trigger("click");

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html"),
      });
    });

    it("should tell that the codes are on the way", async () => {
      await showRecord(mirrorRecord());
      const body = mountBody();

      body.find(".no-entry h2").text().should.equal(i18n.mirror_loading);
      body.find(".no-entry .button").exists().should.equal(false);
    });

    it("should tell that the codes could not be loaded", async () => {
      await showRecord(
        mirrorRecord({}, { error: { kind: "network", at: Date.now() } }),
      );
      const body = mountBody();

      body.find(".no-entry h2").text().should.equal(i18n.mirror_status_network);
    });

    it("should open the password page from its banner", async () => {
      await showRecord(
        mirrorRecord(
          {},
          { attention: { kind: "mirrorPassword", fileId: "f" } },
        ),
      );
      const body = mountBody();

      body
        .find(".reminder-title")
        .text()
        .should.equal(i18n.mirror_banner_password_title);
      await body.find(".reminder-primary").trigger("click");

      chai
        .expect(useCurrentViewStore(pinia).current)
        .to.equal("MirrorPassword");
    });

    it("should apply or keep a smaller copy from its banner", async () => {
      const send = answerMessages({
        "drive.mirrorShrink": { status: "unchanged" },
      });
      await showRecord(
        mirrorRecord(
          {},
          {
            attention: {
              kind: "mirrorShrink",
              fileId: "f",
              modifiedTime: "t",
              from: 40,
              to: 1,
            },
          },
        ),
      );
      const body = mountBody();

      body
        .find(".reminder-title")
        .text()
        .should.equal(t("mirror_banner_shrink_title", accountsCount(1), "40"));
      await body.find(".reminder-secondary").trigger("click");
      send.should.have.been.calledOnceWith({
        action: "drive.mirrorShrink",
        decision: "keep",
      });

      await body.find(".reminder-primary").trigger("click");
      await flushPromises();
      send.should.have.been.calledWith({
        action: "drive.mirrorShrink",
        decision: "apply",
      });
    });

    it("should ask the phone to sign in again in the tab", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      const close = sinon.stub(window, "close");
      await showRecord(mirrorRecord({}, { attention: { kind: "signin" } }));
      const body = mountBody();

      body
        .find(".reminder-text")
        .text()
        .should.equal(i18n.mirror_banner_signin_text);
      await body.find(".reminder-primary").trigger("click");
      await flushPromises();

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html?signin"),
      });
      close.should.have.been.calledOnce;
    });
  });
});
