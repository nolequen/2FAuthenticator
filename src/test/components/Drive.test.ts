import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import type { Pinia } from "pinia";

import DriveTab from "../../components/Drive.vue";
import BackupPasswordForm from "../../components/Drive/BackupPasswordForm.vue";
import BackupPasswordPage from "../../components/Popup/BackupPasswordPage.vue";
import DriveCopiesPage from "../../components/Popup/DriveCopiesPage.vue";
import DriveSection from "../../components/Popup/DriveSection.vue";
import MainBody from "../../components/Popup/MainBody.vue";
import NotificationHandler from "../../components/Popup/NotificationHandler.vue";
import type { DriveMessage } from "../../drive/background";
import { DRIVE_ALARM } from "../../drive/config";
import {
  accountsCount,
  copyTitle,
  epochDayDate,
  formatTime,
} from "../../drive/display";
import type { BackupKey, DriveRecord } from "../../drive/state";
import { localDay } from "../../drive/upload";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { today } from "../../models/settings";
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
import { resetStorage } from "../storage-helper";
import { createTestPinia, mountOptions } from "../vue-helper";
import { FakeDrive } from "../drive/fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const BACKUP_PASSWORD = "backup password";

type Answers = { [action: string]: unknown };

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

async function backupWith(backupKey: BackupKey) {
  const encryption = new Encryption(backupKey.passphrase, backupKey.key.id);
  const hash = crypto.randomUUID();
  const entry: RawOTPStorage = {
    dataType: "OTPStorage",
    account: "restored",
    encrypted: false,
    hash,
    index: 0,
    secret: SECRET,
    type: "totp",
  };
  return JSON.stringify({
    [hash]: {
      dataType: "EncOTPStorage",
      data: await encryption.encrypt(JSON.stringify(entry)),
      keyId: backupKey.key.id,
      index: 0,
    },
    [backupKey.key.id]: backupKey.key,
  });
}

describe("Google Drive components", function () {
  this.timeout(30000);

  let pinia: Pinia;
  let wrapper: VueWrapper | undefined;
  let backupKey: BackupKey;

  before(async () => {
    await loadI18nMessages();
    const created = await createKey(BACKUP_PASSWORD);
    backupKey = { key: created.key, passphrase: created.passphrase };
  });

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    pinia = createTestPinia();
    useDriveStore(pinia).available = true;
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  async function mountSection(record?: DriveRecord) {
    if (record) {
      await storeDriveRecord(record);
    }
    await useDriveStore(pinia).refresh();
    wrapper = mount(
      { render: () => h("div", [h(DriveSection), h(NotificationHandler)]) },
      mountOptions(pinia),
    );
    return wrapper;
  }

  describe("section", () => {
    it("should tell when the build has no Google client", async () => {
      useDriveStore(pinia).available = false;

      const section = await mountSection();

      section.text().should.contain(i18n.drive_unavailable);
      section.find(".option").exists().should.equal(false);
    });

    it("should open the tab to connect", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      const section = await mountSection();

      await section.find("button.option").trigger("click");

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html"),
      });
    });

    it("should show the account and the last copy", async () => {
      const at = Date.now();
      const section = await mountSection(
        driveRecord({
          email: "user@example.com",
          lastUpload: {
            day: today(),
            at,
            fileId: "file",
            sourceHash: "hash",
            accounts: 2,
          },
        }),
      );

      section.find(".drive-email").text().should.equal("user@example.com");
      section
        .find(".drive-status")
        .text()
        .should.equal(
          t("drive_status_last", t("drive_today_at", formatTime(at))),
        );
      section.find(".drive-status").classes().should.contain("ok");
    });

    it("should show a copy that waits for the upload", async () => {
      await chrome.alarms.create(DRIVE_ALARM, { delayInMinutes: 10 });

      const section = await mountSection(driveRecord());

      section
        .find(".drive-status")
        .text()
        .should.equal(i18n.drive_status_pending);
    });

    it("should show why the copy waits", async () => {
      const section = await mountSection(
        driveRecord({ error: { kind: "quota", at: Date.now() } }),
      );

      section
        .find(".drive-status")
        .text()
        .should.equal(i18n.drive_status_quota);
      section.find(".drive-status").classes().should.contain("warn");
    });

    it("should change the backup password only without the extension password", async () => {
      const section = await mountSection(driveRecord({ backupKey }));
      section
        .find(".drive-link")
        .text()
        .should.equal(i18n.drive_change_backup_password);

      useAccountsStore(pinia).defaultEncryption = "extension-key";
      await nextTick();

      section.find(".drive-link").exists().should.equal(false);
      section.text().should.contain(i18n.drive_footer_password);
    });

    it("should remind which password opens the copies of the backup password", async () => {
      const section = await mountSection(
        driveRecord({ backupKeyRetiredDay: today() - 3, skipped: 2 }),
      );

      section
        .text()
        .should.contain(t("drive_retired", epochDayDate(today() - 3)));
      section.text().should.contain(t("drive_skipped", "2"));
    });

    it("should save now and tell the result", async () => {
      const send = answerMessages({
        "drive.backupNow": { status: "uploaded" },
      });
      const section = await mountSection(driveRecord());

      await section.find(".drive-actions .primary").trigger("click");
      await flushPromises();

      send.should.have.been.calledWith({ action: "drive.backupNow" });
      useNotificationStore(pinia).toast.should.equal(i18n.drive_saved);
    });

    it("should disconnect after the confirmation", async () => {
      const send = answerMessages({ "drive.disconnect": {} });
      const section = await mountSection(driveRecord());

      await section.find(".drive-links .button").trigger("click");
      await nextTick();
      await section.find(".dialog .button.danger").trigger("click");
      await flushPromises();

      send.should.have.been.calledWith({ action: "drive.disconnect" });
    });
  });

  describe("banner", () => {
    function mountBody() {
      const accounts = useAccountsStore(pinia);
      accounts.completeInit();
      wrapper = mount(MainBody, mountOptions(pinia));
      return wrapper;
    }

    it("should ask to sign in again before the backup reminder", async () => {
      const create = sinon.stub(chrome.tabs, "create").resolves();
      useNotificationStore(pinia).backupReminder = true;
      await storeDriveRecord(driveRecord({ attention: { kind: "signin" } }));
      await useDriveStore(pinia).refresh();
      const body = mountBody();

      body.findAll(".reminder").should.have.lengthOf(1);
      body
        .find(".reminder-title")
        .text()
        .should.equal(i18n.drive_banner_signin_title);
      await body.find(".reminder-primary").trigger("click");

      create.should.have.been.calledOnceWith({
        url: chrome.runtime.getURL("view/drive.html?signin"),
      });
    });

    it("should ask before a copy with fewer accounts is saved", async () => {
      const send = answerMessages({
        "drive.shrink": { status: "unchanged" },
      });
      await storeDriveRecord(
        driveRecord({
          attention: { kind: "shrink", from: 12, to: 3, sourceHash: "hash" },
        }),
      );
      await useDriveStore(pinia).refresh();
      const body = mountBody();

      body
        .find(".reminder-text")
        .text()
        .should.equal(t("drive_banner_shrink_text", "12", "3"));
      await body.find(".reminder-secondary").trigger("click");

      send.should.have.been.calledOnceWith({
        action: "drive.shrink",
        decision: "skip",
      });
    });

    it("should open the backup password page", async () => {
      await storeDriveRecord(
        driveRecord({ attention: { kind: "backupPassword" } }),
      );
      await useDriveStore(pinia).refresh();
      const body = mountBody();

      await body.find(".reminder-primary").trigger("click");

      chai
        .expect(useCurrentViewStore(pinia).current)
        .to.equal("BackupPassword");
    });
  });

  describe("backup password", () => {
    it("should refuse a short password and a different repeat", async () => {
      await storeDriveRecord(driveRecord());
      await useDriveStore(pinia).refresh();
      wrapper = mount(BackupPasswordForm, {
        ...mountOptions(pinia),
        props: {
          passwordLabel: "password",
          repeatLabel: "repeat",
          warning: "warning",
          submitLabel: "save",
        },
      });
      const [first, second] = wrapper.findAll("input");

      await first.setValue("short");
      await wrapper.find("form").trigger("submit");
      wrapper.text().should.contain(i18n.drive_password_short);

      await first.setValue("long enough");
      await second.setValue("long enougH");
      await wrapper.find("form").trigger("submit");
      wrapper.text().should.contain(i18n.phrase_not_match);
      chai.expect((await storedDriveRecord())?.backupKey).to.equal(undefined);
    });

    it("should keep the key of the backup password and upload a copy", async () => {
      const send = answerMessages({
        "drive.backupNow": { status: "uploaded" },
      });
      await storeDriveRecord(
        driveRecord({ attention: { kind: "backupPassword" } }),
      );
      await useDriveStore(pinia).refresh();
      useCurrentViewStore(pinia).open("BackupPassword");
      wrapper = mount(BackupPasswordPage, mountOptions(pinia));
      const [first, second] = wrapper.findAll("input");

      await first.setValue(BACKUP_PASSWORD);
      await second.setValue(BACKUP_PASSWORD);
      await wrapper.find("form").trigger("submit");
      await waitFor(() => send.called);

      const stored = await storedDriveRecord();
      chai.expect(stored?.backupKey?.key.dataType).to.equal("Key");
      chai.expect(stored?.backupKey?.passphrase).to.be.a("string");
      (await EntryStorage.hasEncryptionKey()).should.equal(false);
      send.should.have.been.calledWith({ action: "drive.backupNow" });
    });
  });

  describe("copies", () => {
    async function mountCopies(files: object[], text: string) {
      answerMessages({
        "drive.list": { files },
        "drive.download": { text },
      });
      await useAccountsStore(pinia).init();
      await useDriveStore(pinia).refresh();
      wrapper = mount(
        {
          render: () => h("div", [h(DriveCopiesPage), h(NotificationHandler)]),
        },
        mountOptions(pinia),
      );
      await waitFor(
        () => wrapper!.findAll(".drive-copy").length === files.length,
      );
      return wrapper;
    }

    const todays = {
      id: "today",
      name: "copy",
      modifiedTime: new Date().toISOString(),
      browser: "firefox",
      day: localDay(),
      accounts: 12,
    };

    it("should show the copies with their browser and number of accounts", async () => {
      const page = await mountCopies([todays], "{}");

      const copy = page.find(".drive-copy");
      copy.text().should.contain("Firefox");
      copy.text().should.contain(accountsCount(12));
      copy.find(".option-title").text().should.equal(copyTitle(localDay()));
    });

    it("should restore a copy of the current backup password without asking", async () => {
      await storeDriveRecord(driveRecord({ backupKey }));
      const page = await mountCopies([todays], await backupWith(backupKey));

      await page.find(".drive-copy").trigger("click");
      await waitFor(() => useNotificationStore(pinia).message.length > 0);

      page.find("#restore-title").exists().should.equal(false);
      const entries = await EntryStorage.get();
      entries.map((entry) => entry.account).should.deep.equal(["restored"]);
    });

    it("should ask for the password of an older copy and keep asking while it is wrong", async () => {
      await storeDriveRecord(driveRecord());
      const page = await mountCopies([todays], await backupWith(backupKey));

      await page.find(".drive-copy").trigger("click");
      await waitFor(() => page.find("#restore-title").exists());
      await page.find(".dialog input").setValue("wrong password");
      await page.find("form.dialog").trigger("submit");
      await waitFor(() => page.text().includes(i18n.drive_wrong_password));

      (await EntryStorage.get()).should.have.lengthOf(0);

      await page.find(".dialog input").setValue(BACKUP_PASSWORD);
      await page.find("form.dialog").trigger("submit");
      await waitFor(() => !page.find("#restore-title").exists());

      (await EntryStorage.get()).should.have.lengthOf(1);
    });
  });

  describe("tab", () => {
    it("should tell when the build has no Google client", async () => {
      useDriveStore(pinia).available = false;
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      wrapper.text().should.contain(i18n.drive_unavailable);
      wrapper.find(".drive-steps").exists().should.equal(false);
    });

    it("should sign in, ask for the backup password and upload the first copy", async () => {
      new FakeDrive().install();
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
      sinon.stub(chrome.alarms, "create").resolves();
      const send = answerMessages({
        "drive.list": { files: [{ id: "a" }, { id: "b" }] },
        "drive.backupNow": { status: "uploaded" },
      });
      wrapper = mount(DriveTab, mountOptions(pinia));
      await flushPromises();

      await wrapper.find(".drive-step.active .button.primary").trigger("click");
      await waitFor(() => wrapper!.find(".backup-password-form").exists());

      const record = await storedDriveRecord();
      chai.expect(record?.email).to.equal("user@example.com");
      chai.expect(record?.client).to.equal("web");
      wrapper.text().should.contain(t("drive_copies_found", "2"));
      wrapper.text().should.contain(i18n.drive_restore_hint);

      const [first, second] = wrapper.findAll(".backup-password-form input");
      await first.setValue(BACKUP_PASSWORD);
      await second.setValue(BACKUP_PASSWORD);
      await wrapper.find(".backup-password-form").trigger("submit");
      await waitFor(() => wrapper!.text().includes(i18n.drive_done));

      send.should.have.been.calledWith({ action: "drive.backupNow" });
      chai
        .expect((await storedDriveRecord())?.backupKey)
        .to.not.equal(undefined);
    });
  });
});
