import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { handleAlarm, handleMessage } from "../backgroundEvents";
import { DRIVE_ALARM, DRIVE_CHECK_ALARM } from "../drive/config";
import {
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "./drive-helper";
import { cacheSessionKey, clearSession, resetStorage } from "./storage-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

async function storeOpenAccount() {
  const hash = crypto.randomUUID();
  const entry: RawOTPStorage = {
    dataType: "OTPStorage",
    account: "alice",
    encrypted: false,
    hash,
    index: 0,
    secret: SECRET,
    type: "totp",
  };
  await chrome.storage.local.set({ [hash]: entry });
}

async function waitFor(condition: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The condition did not come true.");
}

function alarm(name: string): chrome.alarms.Alarm {
  return { name, scheduledTime: Date.now(), persistAcrossSessions: true };
}

async function sessionPassphrase() {
  return (await chrome.storage.session.get<SessionData>("cachedPassphrase"))
    .cachedPassphrase;
}

describe("background events", () => {
  beforeEach(async () => {
    await resetStorage();
    await clearSession();
    await resetDrive();
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
    await resetDrive();
    await chrome.alarms.clear("autolock");
  });

  describe("alarms", () => {
    it("should lock the extension on the autolock alarm and leave Google Drive alone", async () => {
      sinon.replace(
        chrome.runtime,
        "sendMessage",
        sinon.fake.resolves(
          undefined,
        ) as unknown as typeof chrome.runtime.sendMessage,
      );
      await cacheSessionKey("session-key");
      await storeOpenAccount();
      const record = await storeDriveRecord();

      await handleAlarm(alarm("autolock"));

      await waitFor(async () => !(await sessionPassphrase()));
      chai.expect(await storedDriveRecord()).to.deep.equal(record);
    });

    it("should back up to Google Drive on its alarm and keep the extension unlocked", async () => {
      await cacheSessionKey("session-key");
      await storeOpenAccount();
      await storeDriveRecord(driveRecord());

      await handleAlarm(alarm(DRIVE_ALARM));

      chai.expect(await sessionPassphrase()).to.be.a("string");
      chai
        .expect((await storedDriveRecord())?.attention)
        .to.deep.equal({ kind: "backupPassword" });
    });
  });

  it("should check the copy on the alarm set at the browser start", async () => {
    await storeOpenAccount();
    await storeDriveRecord(driveRecord());

    await handleAlarm(alarm(DRIVE_CHECK_ALARM));

    chai
      .expect((await storedDriveRecord())?.attention)
      .to.deep.equal({ kind: "backupPassword" });
  });

  describe("messages", () => {
    const page = () => ({
      id: chrome.runtime.id,
      url: chrome.runtime.getURL("view/popup.html"),
    });

    it("should send the answer to a Google Drive message back", async () => {
      const sendResponse = sinon.fake();

      chai
        .expect(handleMessage({ action: "drive.list" }, page(), sendResponse))
        .to.equal(true);

      await waitFor(() => sendResponse.called);
      sendResponse.should.have.been.calledOnceWith({ error: "disconnected" });
    });

    it("should ignore a Google Drive message from a web page", async () => {
      await storeDriveRecord();
      const sendResponse = sinon.fake();

      chai
        .expect(
          handleMessage(
            { action: "drive.disconnect" },
            {
              id: chrome.runtime.id,
              url: "https://example.com/",
              tab: { id: 1 } as chrome.tabs.Tab,
            },
            sendResponse,
          ),
        )
        .to.equal(false);

      await new Promise((resolve) => setTimeout(resolve, 100));
      sendResponse.should.not.have.been.called;
      chai.expect(await storedDriveRecord()).to.not.equal(undefined);
    });

    it("should answer the other messages once they are handled", async () => {
      await cacheSessionKey("session-key");
      const sendResponse = sinon.fake();

      chai
        .expect(handleMessage({ action: "lock" }, page(), sendResponse))
        .to.equal(true);

      await waitFor(() => sendResponse.called);
      sendResponse.should.have.been.calledOnceWith(true);
      chai.expect(await sessionPassphrase()).to.equal(null);
    });

    it("should keep the session it is sent", async () => {
      const sendResponse = sinon.fake();

      handleMessage(
        { action: "cachePassphrase", value: "passphrase", keyId: "key" },
        page(),
        sendResponse,
      );

      await waitFor(() => sendResponse.called);
      chai.expect(await sessionPassphrase()).to.equal("passphrase");
    });
  });
});
