import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import {
  type DriveListResponse,
  handleDriveMessage,
  handleStorageChange,
} from "../../drive/background";
import { DRIVE_ALARM, DRIVE_RECORD, DRIVE_SESSION } from "../../drive/config";
import { StorageLocation } from "../../models/settings";
import {
  CONNECTION_ID,
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import { resetStorage } from "../storage-helper";
import { FakeDrive } from "./fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const CHANGE = { newValue: {} };

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

    it("should revoke the access and forget the connection", async () => {
      await storeDriveRecord();

      await handleDriveMessage({ action: "drive.disconnect" });

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      chai
        .expect(
          (await chrome.storage.session.get(DRIVE_SESSION))[DRIVE_SESSION],
        )
        .to.equal(undefined);
      const revoke = drive.requests.find(
        (request) => request.url.pathname === "/revoke",
      );
      chai.expect(revoke?.body).to.equal("token=access-token");
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
});
