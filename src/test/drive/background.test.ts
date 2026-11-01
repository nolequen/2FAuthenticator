import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { handleAlarm } from "../../backgroundEvents";
import {
  type DriveListResponse,
  backupAfterUnlock,
  handleDriveMessage,
  handleStorageChange,
  scheduleIfConnected,
} from "../../drive/background";
import {
  DRIVE_ALARM,
  DRIVE_CHECK_ALARM,
  DRIVE_MIRROR_ALARM,
  DRIVE_RECORD,
  DRIVE_SESSION,
} from "../../drive/config";
import type { DriveRecord } from "../../drive/state";
import { runBackup } from "../../drive/upload";
import { StorageLocation } from "../../models/settings";
import { EntryStorage } from "../../models/storage";
import {
  CONNECTION_ID,
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import { resetStorage, storeKey } from "../storage-helper";
import { FakeDrive } from "./fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const CHANGE = { newValue: {} };

function mirrorRecord(fields: Partial<DriveRecord> = {}) {
  return driveRecord({
    client: "desktop",
    browser: "firefox",
    refreshToken: "refresh",
    mirror: { source: "chrome", keys: {} },
    ...fields,
  });
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
      secret: "JBSWY3DPEHPK3PXP",
      type: "totp",
    };
  }
  await chrome.storage.local.set(items);
}

async function storeSession() {
  await chrome.storage.session.set({
    [DRIVE_SESSION]: {
      accessToken: "access-token",
      expiresAt: Date.now() + 3600 * 1000,
      connectionId: CONNECTION_ID,
    },
  });
}

describe("Drive background", () => {
  let create: sinon.SinonStub;

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    create = sinon.stub(chrome.alarms, "create").resolves();
  });

  afterEach(async () => {
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  describe("storage changes", () => {
    it("should schedule a backup a minute after an account changes", async () => {
      await storeDriveRecord();

      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "local");

      create.should.have.been.calledOnceWith(DRIVE_ALARM, {
        delayInMinutes: 1,
      });
    });

    it("should not schedule a backup for the settings and the connection", async () => {
      await storeDriveRecord();

      await handleStorageChange(
        { UserSettings: CHANGE, [DRIVE_RECORD]: CHANGE },
        "local",
      );

      create.should.not.have.been.called;
    });

    it("should not schedule a backup for another storage area", async () => {
      await storeDriveRecord();

      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "sync");
      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "session");

      create.should.not.have.been.called;
    });

    it("should follow the accounts to sync", async () => {
      await chrome.storage.local.set({
        UserSettings: { storageLocation: StorageLocation.Sync },
      });
      await storeDriveRecord();

      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "sync");

      create.should.have.been.calledOnce;
    });

    it("should not schedule a backup without Google Drive", async () => {
      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "local");

      create.should.not.have.been.called;
    });
  });

  describe("messages", () => {
    let drive: FakeDrive;

    beforeEach(async () => {
      drive = new FakeDrive().install();
      await storeSession();
    });

    it("should list the copies of every browser with the newest first", async () => {
      const folder = drive.addFolder();
      for (const [browser, day, accounts] of [
        ["chrome", "2026-10-20", "4"],
        ["firefox", "2026-10-26", "12"],
        ["edge", "2026-10-21", "4"],
      ]) {
        drive.addFile({
          name: `2fauthenticator-${browser}-${day}.json`,
          parents: [folder.id],
          properties: { app: "2fauthenticator", browser, day, accounts },
        });
      }
      drive.addFile({ name: "notes.txt", parents: [folder.id] });
      await storeDriveRecord(driveRecord({ folderId: folder.id }));

      const response = (await handleDriveMessage({
        action: "drive.list",
      })) as DriveListResponse;

      if (!("files" in response)) {
        throw new Error(`The list failed: ${response.error}`);
      }
      response.files
        .map((file) => [file.browser, file.day, file.accounts])
        .should.deep.equal([
          ["firefox", "2026-10-26", 12],
          ["edge", "2026-10-21", 4],
          ["chrome", "2026-10-20", 4],
        ]);
    });

    it("should find the folder of another browser", async () => {
      const folder = drive.addFolder();
      await storeDriveRecord();

      (await handleDriveMessage({ action: "drive.list" })).should.deep.equal({
        files: [],
      });
      chai.expect((await storedDriveRecord())?.folderId).to.equal(folder.id);
    });

    it("should download a copy", async () => {
      const file = drive.addFile({ content: '{"a":1}' });
      await storeDriveRecord();

      (
        await handleDriveMessage({ action: "drive.download", id: file.id })
      ).should.deep.equal({ text: '{"a":1}' });
    });

    it("should ask to sign in when the list needs it", async () => {
      drive.token = "another-token";
      await chrome.storage.session.remove(DRIVE_SESSION);
      await storeDriveRecord(driveRecord({ client: "desktop" }));

      (await handleDriveMessage({ action: "drive.list" })).should.deep.equal({
        error: "signin",
      });
      chai
        .expect((await storedDriveRecord())?.attention)
        .to.deep.equal({ kind: "signin" });
    });

    it("should forget the connection without revoking the access", async () => {
      await storeAccounts(1);
      await storeDriveRecord(driveRecord({ refreshToken: "refresh" }));
      const clear = sinon.spy(chrome.alarms, "clear");

      await handleDriveMessage({ action: "drive.disconnect" });

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      chai
        .expect(
          (await chrome.storage.session.get(DRIVE_SESSION))[DRIVE_SESSION],
        )
        .to.equal(undefined);
      drive.requests.should.have.lengthOf(0);
      for (const alarm of [
        DRIVE_ALARM,
        DRIVE_CHECK_ALARM,
        DRIVE_MIRROR_ALARM,
      ]) {
        clear.should.have.been.calledWith(alarm);
      }
      (await EntryStorage.count()).should.equal(1);
    });

    it("should revoke the access and then forget the connection when signing out everywhere", async () => {
      await storeDriveRecord(driveRecord({ refreshToken: "refresh" }));
      let connected: DriveRecord | undefined;
      const original = window.fetch;
      sinon.restore();
      sinon.replace(
        window,
        "fetch",
        sinon.fake(async (input: RequestInfo | URL, init?: RequestInit) => {
          connected = await storedDriveRecord();
          return original(input, init);
        }) as unknown as typeof fetch,
      );

      (
        await handleDriveMessage({ action: "drive.signOutEverywhere" })
      ).should.deep.equal({ status: "done" });

      const revoke = drive.requests.find(
        (request) => request.url.pathname === "/revoke",
      );
      chai.expect(revoke?.body).to.equal("token=refresh");
      chai.expect(connected?.connectionId).to.equal(CONNECTION_ID);
      chai.expect(await storedDriveRecord()).to.equal(undefined);
    });

    it("should revoke the access token when there is no refresh token", async () => {
      await storeDriveRecord();

      (
        await handleDriveMessage({ action: "drive.signOutEverywhere" })
      ).should.deep.equal({ status: "done" });

      const revoke = drive.requests.find(
        (request) => request.url.pathname === "/revoke",
      );
      chai.expect(revoke?.body).to.equal("token=access-token");
      chai.expect(await storedDriveRecord()).to.equal(undefined);
    });

    it("should stay connected when the access cannot be revoked", async () => {
      await storeAccounts(1);
      await storeDriveRecord(mirrorRecord());
      drive.fail(
        (request) => request.url.pathname === "/revoke",
        503,
        "backendError",
      );

      (
        await handleDriveMessage({ action: "drive.signOutEverywhere" })
      ).should.deep.equal({ status: "failed" });

      chai.expect(await storedDriveRecord()).to.not.equal(undefined);
      chai
        .expect(
          (await chrome.storage.session.get(DRIVE_SESSION))[DRIVE_SESSION],
        )
        .to.not.equal(undefined);
      (await EntryStorage.count()).should.equal(1);
    });

    it("should remove the accounts and the keys of a phone on disconnect", async () => {
      await storeAccounts(2);
      await storeKey("extension-key");
      await storeDriveRecord(mirrorRecord());

      await handleDriveMessage({ action: "drive.disconnect" });

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      (await EntryStorage.count()).should.equal(0);
      (await EntryStorage.hasEncryptionKey()).should.equal(false);
      chai
        .expect((await chrome.storage.local.get("UserSettings")).UserSettings)
        .to.not.equal(undefined);
      drive.requests.should.have.lengthOf(0);
    });

    it("should keep the accounts of a phone whose browser was not chosen yet", async () => {
      await storeAccounts(2);
      await storeDriveRecord(
        mirrorRecord({ mirror: { source: undefined, keys: {} } }),
      );

      await handleDriveMessage({ action: "drive.disconnect" });

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      (await EntryStorage.count()).should.equal(2);
    });

    it("should leave the copy as it is when a smaller one is not saved", async () => {
      await storeDriveRecord(
        driveRecord({
          attention: { kind: "shrink", from: 10, to: 3, sourceHash: "hash" },
          error: { kind: "network", at: 1 },
        }),
      );

      await handleDriveMessage({ action: "drive.shrink", decision: "skip" });

      const stored = await storedDriveRecord();
      chai.expect(stored?.error).to.equal(undefined);
      chai.expect(stored?.attention).to.equal(undefined);
      chai.expect(stored?.shrinkApproved).to.equal(undefined);
      chai.expect(stored?.shrinkSkipped).to.equal("hash");
      drive.uploads().should.have.lengthOf(0);
    });
  });

  describe("phone", () => {
    let drive: FakeDrive;

    beforeEach(async () => {
      drive = new FakeDrive().install();
      await storeSession();
      await storeAccounts(2);
    });

    async function expectNoUpload(record: DriveRecord) {
      drive.requests.should.have.lengthOf(0);
      (await storedDriveRecord())!.should.deep.equal(record);
    }

    it("should not back up the accounts of a phone", async () => {
      const record = await storeDriveRecord(mirrorRecord());

      (await runBackup(true)).should.deep.equal({ status: "unavailable" });
      await handleAlarm({
        name: DRIVE_ALARM,
        scheduledTime: Date.now(),
        persistAcrossSessions: false,
      });
      await handleAlarm({
        name: DRIVE_CHECK_ALARM,
        scheduledTime: Date.now(),
        persistAcrossSessions: false,
      });

      await expectNoUpload(record);
      create.should.not.have.been.called;
    });

    it("should not schedule a backup when the accounts of a phone change", async () => {
      await storeDriveRecord(mirrorRecord());

      await handleStorageChange({ [crypto.randomUUID()]: CHANGE }, "local");

      create.should.not.have.been.called;
    });

    it("should schedule the hourly check of a phone instead of a backup", async () => {
      await storeDriveRecord(mirrorRecord());

      await scheduleIfConnected();

      create.should.have.been.calledOnceWith(DRIVE_MIRROR_ALARM, {
        periodInMinutes: 60,
      });
    });

    it("should still check the copy of a computer at the start", async () => {
      await storeDriveRecord();

      await scheduleIfConnected();

      create.should.have.been.calledOnceWith(DRIVE_CHECK_ALARM, {
        delayInMinutes: 1,
      });
    });

    it("should not back up after an unlock on a phone", async () => {
      const record = await storeDriveRecord(
        mirrorRecord({ attention: { kind: "unlock" } }),
      );

      await backupAfterUnlock();

      await expectNoUpload(record);
    });

    it("should refuse to save now or decide on a smaller copy on a phone", async () => {
      const record = await storeDriveRecord(
        mirrorRecord({
          attention: { kind: "shrink", from: 10, to: 3, sourceHash: "hash" },
        }),
      );

      (
        await handleDriveMessage({ action: "drive.backupNow" })
      ).should.deep.equal({ status: "unavailable" });
      (
        await handleDriveMessage({ action: "drive.shrink", decision: "save" })
      ).should.deep.equal({ status: "unavailable" });
      (
        await handleDriveMessage({ action: "drive.shrink", decision: "skip" })
      ).should.deep.equal({ status: "unavailable" });

      await expectNoUpload(record);
    });

    it("should check the copies on the hourly alarm of a phone", async () => {
      await storeDriveRecord(mirrorRecord());

      await handleAlarm({
        name: DRIVE_MIRROR_ALARM,
        scheduledTime: Date.now(),
        persistAcrossSessions: false,
      });

      chai
        .expect((await storedDriveRecord())?.mirror?.checkedAt)
        .to.be.a("number");
      drive.requests.length.should.be.greaterThan(0);
      drive.uploads().should.have.lengthOf(0);
    });
  });
});
