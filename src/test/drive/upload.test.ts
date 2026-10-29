import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import {
  DRIVE_ALARM,
  DRIVE_CHECK_ALARM,
  DRIVE_SESSION,
  RETRY_DELAY_MINUTES,
} from "../../drive/config";
import type { BackupKey, DriveRecord } from "../../drive/state";
import {
  copyName,
  filesToTrash,
  localDay,
  runBackup,
  sortCopies,
} from "../../drive/upload";
import type { DriveFile } from "../../drive/api";
import { createKey } from "../../models/password";
import { today } from "../../models/settings";
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

const SECRET = "JBSWY3DPEHPK3PXP";

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
  return items;
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

function copyFile(
  browser: string,
  day: string,
  fields: Partial<DriveFile> = {},
): DriveFile {
  return {
    id: `${browser}-${day}`,
    name: `2fauthenticator-${browser}-${day}.json`,
    modifiedTime: `${day}T10:00:00.000Z`,
    properties: { app: "2fauthenticator", browser, day, accounts: "3" },
    ...fields,
  };
}

function dayBefore(days: number) {
  return localDay(Date.now() - days * 24 * 3600 * 1000);
}

describe("Drive upload", function () {
  this.timeout(20000);

  let backupKey: BackupKey;
  let drive: FakeDrive;
  let createAlarm: sinon.SinonStub;

  before(async () => {
    const created = await createKey("backup password");
    backupKey = { key: created.key, passphrase: created.passphrase };
  });

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    await storeSession();
    drive = new FakeDrive().install();
    createAlarm = sinon.stub(chrome.alarms, "create").resolves();
  });

  afterEach(async () => {
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  async function connect(fields: Partial<DriveRecord> = {}) {
    return await storeDriveRecord(driveRecord({ backupKey, ...fields }));
  }

  it("should create the folder and upload the first copy", async () => {
    await storeAccounts(2);
    const record = await connect();

    (await runBackup()).should.deep.equal({ status: "uploaded" });

    const [folder] = [...drive.files.values()].filter(
      (file) => file.mimeType === "application/vnd.google-apps.folder",
    );
    folder.name.should.equal("2FAuthenticator");
    const [copy] = drive.copies();
    copy.name.should.equal(copyName("chrome", localDay()));
    copy.parents.should.deep.equal([folder.id]);
    copy.properties.should.deep.equal({
      app: "2fauthenticator",
      browser: "chrome",
      day: localDay(),
      accounts: "2",
    });
    const stored = await storedDriveRecord();
    chai.expect(stored?.folderId).to.equal(folder.id);
    chai.expect(stored?.lastUpload).to.include({
      day: today(),
      fileId: copy.id,
      accounts: 2,
    });
    chai.expect(stored?.connectionId).to.equal(record.connectionId);
  });

  it("should not upload a copy that did not change", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();
    const uploads = drive.uploads().length;

    (await runBackup()).should.deep.equal({ status: "unchanged" });

    drive.uploads().should.have.lengthOf(uploads);
  });

  it("should upload the same copy again when asked to", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();

    (await runBackup(true)).should.deep.equal({ status: "uploaded" });

    drive.copies().should.have.lengthOf(1);
  });

  it("should upload when asked to while a background run is going", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();

    const background = runBackup();
    const forced = runBackup(true);

    (await background).should.deep.equal({ status: "unchanged" });
    (await forced).should.deep.equal({ status: "uploaded" });
    drive.uploads().should.have.lengthOf(2);
  });

  it("should upload once when asked twice at the same time", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();

    const results = await Promise.all([runBackup(true), runBackup(true)]);

    results.should.deep.equal([{ status: "uploaded" }, { status: "uploaded" }]);
    drive.uploads().should.have.lengthOf(2);
  });

  it("should keep the request to sign in when the copy did not change", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();
    const stored = (await storedDriveRecord())!;
    await storeDriveRecord({ ...stored, attention: { kind: "signin" } });

    (await runBackup()).should.deep.equal({ status: "unchanged" });

    chai
      .expect((await storedDriveRecord())?.attention)
      .to.deep.equal({ kind: "signin" });
  });

  it("should replace the copy of today instead of adding one", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();
    await storeAccounts(1);

    (await runBackup()).should.deep.equal({ status: "uploaded" });

    const copies = drive.copies();
    copies.should.have.lengthOf(1);
    copies[0].properties.accounts.should.equal("3");
    drive.uploads()[1].method.should.equal("PATCH");
  });

  it("should create a new copy when the copy of today is in the trash", async () => {
    await storeAccounts(2);
    await connect();
    await runBackup();
    drive.copies()[0].trashed = true;
    await storeAccounts(1);

    await runBackup();

    drive
      .copies()
      .filter((file) => !file.trashed)
      .should.have.lengthOf(1);
    drive.copies().should.have.lengthOf(2);
  });

  it("should not upload an empty list of accounts", async () => {
    await connect({ error: { kind: "network", at: 1 } });

    (await runBackup()).should.deep.equal({ status: "empty" });

    drive.requests.should.have.lengthOf(0);
    chai.expect((await storedDriveRecord())?.error).to.equal(undefined);
  });

  it("should ask before a copy loses more than half of the accounts", async () => {
    await storeAccounts(3);
    await connect({
      lastUpload: {
        day: today() - 1,
        at: Date.now() - 24 * 3600 * 1000,
        fileId: "old",
        sourceHash: "old",
        accounts: 10,
      },
    });

    const result = await runBackup();

    chai.expect(result).to.deep.include({ status: "attention" });
    const attention = (await storedDriveRecord())?.attention;
    chai.expect(attention).to.deep.include({ kind: "shrink", from: 10, to: 3 });
    drive.uploads().should.have.lengthOf(0);
  });

  it("should compare with the copy of today in Drive", async () => {
    await storeAccounts(3);
    const folder = drive.addFolder();
    drive.addFile({
      name: copyName("chrome", localDay()),
      parents: [folder.id],
      properties: {
        app: "2fauthenticator",
        browser: "chrome",
        day: localDay(),
        accounts: "8",
      },
    });
    await connect({ folderId: folder.id });

    await runBackup();

    chai
      .expect((await storedDriveRecord())?.attention)
      .to.deep.include({ kind: "shrink", from: 8, to: 3 });
  });

  it("should upload a smaller copy once after it is approved", async () => {
    await storeAccounts(3);
    await connect({
      lastUpload: {
        day: today() - 1,
        at: Date.now() - 24 * 3600 * 1000,
        fileId: "old",
        sourceHash: "old",
        accounts: 10,
      },
    });
    await runBackup();
    const attention = (await storedDriveRecord())?.attention;
    if (attention?.kind !== "shrink") {
      throw new Error("No shrink attention.");
    }
    await storeDriveRecord({
      ...(await storedDriveRecord())!,
      shrinkApproved: attention.sourceHash,
    });

    (await runBackup()).should.deep.equal({ status: "uploaded" });

    const stored = await storedDriveRecord();
    chai.expect(stored?.shrinkApproved).to.equal(undefined);
    chai.expect(stored?.attention).to.equal(undefined);
  });

  it("should retry in half an hour when the network fails", async () => {
    await storeAccounts(1);
    await connect();
    drive.fail(() => true, 503, "backendError");

    (await runBackup()).should.deep.equal({
      status: "error",
      error: "network",
    });

    chai
      .expect((await storedDriveRecord())?.error)
      .to.include({ kind: "network" });
    createAlarm.should.have.been.calledWith(DRIVE_CHECK_ALARM, {
      delayInMinutes: RETRY_DELAY_MINUTES,
    });
    createAlarm.should.not.have.been.calledWith(DRIVE_ALARM);
  });

  it("should tell when Drive is full", async () => {
    await storeAccounts(1);
    await connect();
    drive.fail(
      (request) => request.url.pathname.startsWith("/upload/"),
      403,
      "storageQuotaExceeded",
    );

    (await runBackup()).should.deep.equal({ status: "error", error: "quota" });
  });

  it("should ask to sign in again when the access cannot be renewed", async () => {
    await storeAccounts(1);
    await connect({ client: "desktop" });
    sinon.replace(
      chrome.permissions,
      "contains",
      sinon.fake.resolves(
        true,
      ) as unknown as typeof chrome.permissions.contains,
    );
    drive.token = "another-token";

    (await runBackup()).should.deep.equal({
      status: "attention",
      attention: { kind: "signin" },
    });
    createAlarm.should.not.have.been.called;
  });

  it("should wait for the Firefox permission to transfer data", async () => {
    await storeAccounts(1);
    await connect({ client: "desktop" });
    sinon.replace(
      chrome.permissions,
      "contains",
      sinon.fake.resolves(
        false,
      ) as unknown as typeof chrome.permissions.contains,
    );

    (await runBackup()).should.deep.equal({
      status: "attention",
      attention: { kind: "consent" },
    });
    drive.requests.should.have.lengthOf(0);
  });

  it("should not write the result after Drive is disconnected", async () => {
    await storeAccounts(1);
    await connect();
    const original = window.fetch;
    sinon.restore();
    createAlarm = sinon.stub(chrome.alarms, "create").resolves();
    sinon.replace(
      window,
      "fetch",
      sinon.fake(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/upload/")) {
          await resetDrive();
        }
        return original(input, init);
      }) as unknown as typeof fetch,
    );

    await runBackup();

    chai.expect(await storedDriveRecord()).to.equal(undefined);
  });

  it("should not write the result after another sign-in", async () => {
    await storeAccounts(1);
    await connect();
    const original = window.fetch;
    sinon.restore();
    createAlarm = sinon.stub(chrome.alarms, "create").resolves();
    sinon.replace(
      window,
      "fetch",
      sinon.fake(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/upload/")) {
          await storeDriveRecord(
            driveRecord({ connectionId: "another", backupKey }),
          );
        }
        return original(input, init);
      }) as unknown as typeof fetch,
    );

    await runBackup();

    const stored = await storedDriveRecord();
    chai.expect(stored?.connectionId).to.equal("another");
    chai.expect(stored?.lastUpload).to.equal(undefined);
  });

  it("should replace an action that is no longer needed with the network error", async () => {
    await storeAccounts(1);
    await connect({ attention: { kind: "backupPassword" } });
    drive.fail(() => true, 503, "backendError");

    await runBackup();

    const stored = await storedDriveRecord();
    chai.expect(stored?.attention).to.equal(undefined);
    chai.expect(stored?.error).to.include({ kind: "network" });
  });

  it("should not ask again about a smaller copy that was not saved", async () => {
    await storeAccounts(3);
    await connect({
      lastUpload: {
        day: today() - 1,
        at: Date.now() - 24 * 3600 * 1000,
        fileId: "old",
        sourceHash: "old",
        accounts: 10,
      },
    });
    await runBackup();
    const attention = (await storedDriveRecord())?.attention;
    if (attention?.kind !== "shrink") {
      throw new Error("No shrink attention.");
    }
    const stored = (await storedDriveRecord())!;
    delete stored.attention;
    await storeDriveRecord({ ...stored, shrinkSkipped: attention.sourceHash });

    (await runBackup()).should.deep.equal({ status: "unchanged" });

    chai.expect((await storedDriveRecord())?.attention).to.equal(undefined);
    drive.uploads().should.have.lengthOf(0);
  });

  it("should count the skipped accounts when nothing can be saved", async () => {
    await chrome.storage.local.set({
      [crypto.randomUUID()]: {
        dataType: "EncOTPStorage",
        data: "v4:AAAA",
        keyId: "lost-key",
        index: 0,
      },
    });
    await connect();

    (await runBackup()).should.deep.equal({ status: "empty" });

    chai.expect((await storedDriveRecord())?.skipped).to.equal(1);
  });

  it("should forget the backup key once the extension has a password", async () => {
    await storeKey("extension-key");
    await chrome.storage.local.set({
      [crypto.randomUUID()]: {
        dataType: "EncOTPStorage",
        data: "v4:AAAA",
        keyId: "extension-key",
        index: 0,
      },
    });
    await connect();

    await runBackup();

    const stored = await storedDriveRecord();
    chai.expect(stored?.backupKey).to.equal(undefined);
    chai.expect(stored?.backupKeyRetiredDay).to.equal(today());
  });

  describe("old copies", () => {
    it("should move the own copies beyond the last 30 to the trash", () => {
      const own = Array.from({ length: 32 }, (_, days) =>
        copyFile("chrome", dayBefore(days)),
      );
      const others = Array.from({ length: 31 }, (_, days) =>
        copyFile("firefox", dayBefore(days)),
      );
      const foreign = copyFile("chrome", dayBefore(40), {
        properties: { browser: "chrome", day: dayBefore(40) },
      });

      const trashed = filesToTrash([...others, foreign, ...own], "chrome");

      trashed
        .map((file) => file.id)
        .should.deep.equal([own[30].id, own[31].id]);
    });

    it("should trash them in Drive after an upload", async () => {
      await storeAccounts(1);
      const folder = drive.addFolder();
      for (let days = 1; days <= 30; days++) {
        const day = dayBefore(days);
        drive.addFile({
          name: copyName("chrome", day),
          parents: [folder.id],
          properties: {
            app: "2fauthenticator",
            browser: "chrome",
            day,
            accounts: "1",
          },
        });
      }
      await connect({ folderId: folder.id });

      await runBackup();

      const trashed = drive.copies().filter((file) => file.trashed);
      trashed.should.have.lengthOf(1);
      trashed[0].properties.day.should.equal(dayBefore(30));
    });

    it("should sort the copies by day and then by time", () => {
      const sorted = sortCopies([
        copyFile("chrome", "2026-10-20"),
        copyFile("firefox", "2026-10-21", {
          modifiedTime: "2026-10-21T08:00:00.000Z",
        }),
        copyFile("chrome", "2026-10-21", {
          modifiedTime: "2026-10-21T09:00:00.000Z",
        }),
      ]);

      sorted
        .map((file) => file.id)
        .should.deep.equal([
          "chrome-2026-10-21",
          "firefox-2026-10-21",
          "chrome-2026-10-20",
        ]);
    });
  });
});
