import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";

import { OTPEntry, OTPType } from "../../models/otp";
import { UserSettings } from "../../models/settings";
import { useNotificationStore } from "../../store/Notification";
import { resetStorage } from "../storage-helper";
import { createTestPinia } from "../vue-helper";

mocha.setup("bdd");

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);
const TODAY = Math.floor(NOW / DAY);

function entry(secret: string | null = "JBSWY3DPEHPK3PXP") {
  const item = new OTPEntry({
    type: OTPType.totp,
    index: 0,
    issuer: "Example",
    account: "alice",
    encrypted: false,
    secret: "JBSWY3DPEHPK3PXP",
  });
  item.secret = secret;
  return item;
}

async function storedReminderTime() {
  const { UserSettings: settings } = await chrome.storage.local.get<{
    UserSettings: { lastRemindingBackupTime?: number };
  }>("UserSettings");
  return settings.lastRemindingBackupTime;
}

describe("Notification", () => {
  let notification: ReturnType<typeof useNotificationStore>;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    notification = useNotificationStore(createTestPinia());
    clock = sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(async () => {
    clock.restore();
    await resetStorage();
  });

  describe("backup reminder", () => {
    async function check(
      lastRemindingBackupTime: number | undefined,
      entries = [entry()],
    ) {
      await resetStorage({ lastRemindingBackupTime });
      await notification.checkBackupReminder({
        entries,
        currentlyEncrypted: entries.some((item) => item.secret === null),
      });
    }

    it("should remind 30 days after the last reminder", async () => {
      await check(TODAY - 30);
      notification.backupReminder.should.equal(true);
    });

    it("should not remind before 30 days", async () => {
      await check(TODAY - 29);
      notification.backupReminder.should.equal(false);
    });

    it("should remind when the clock went back", async () => {
      await check(TODAY + 1);
      notification.backupReminder.should.equal(true);
    });

    it("should not remind without accounts", async () => {
      await check(TODAY - 31, []);
      notification.backupReminder.should.equal(false);
    });

    it("should not remind while some accounts are not decrypted", async () => {
      await check(TODAY - 31, [entry(), entry(null)]);
      notification.backupReminder.should.equal(false);
    });

    it("should save the first reminder time without reminding", async () => {
      await check(undefined);
      notification.backupReminder.should.equal(false);
      chai.expect(await storedReminderTime()).to.equal(TODAY);
    });

    it("should not save the reminder time when the reminder is shown", async () => {
      await check(TODAY - 31);
      notification.backupReminder.should.equal(true);
      chai.expect(await storedReminderTime()).to.equal(TODAY - 31);
    });

    it("should save the reminder time when the reminder is dismissed", async () => {
      await check(TODAY - 31);

      await notification.dismissBackupReminder();

      notification.backupReminder.should.equal(false);
      chai.expect(await storedReminderTime()).to.equal(TODAY);
      chai.expect(UserSettings.items.lastRemindingBackupTime).to.equal(TODAY);
    });
  });

  describe("confirm", () => {
    it("should keep the options of the question", async () => {
      const answer = notification.confirm({
        title: "Delete?",
        message: "It is gone.",
        confirm: "Delete",
        danger: true,
      });
      notification.dialogOpen.should.equal(true);
      chai.expect(notification.confirmation?.danger).to.equal(true);
      notification.confirmMessage.should.equal("It is gone.");

      notification.answerConfirm(true);

      (await answer).should.equal(true);
      notification.dialogOpen.should.equal(false);
    });
  });
});
