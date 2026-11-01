import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { disconnect, handleDriveMessage } from "../../drive/background";
import {
  DRIVE_CHECK_ALARM,
  DRIVE_MIRROR_ALARM,
  DRIVE_SESSION,
  MIRROR_TIMEOUT,
} from "../../drive/config";
import {
  type Backup,
  type DriveCopyInfo,
  copySources,
  latestCopy,
  runMirror,
} from "../../drive/mirror";
import {
  type DriveMirror,
  type DriveRecord,
  updateDriveRecord,
} from "../../drive/state";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { BrowserStorage, EntryStorage } from "../../models/storage";
import {
  CONNECTION_ID,
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import { resetStorage } from "../storage-helper";
import { FakeDrive, type FakeFile } from "./fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

interface CopyKey {
  key: Key;
  passphrase: string;
  encryption: Encryption;
}

function account(
  name: string,
  fields: Partial<RawOTPStorage> = {},
): RawOTPStorage {
  return {
    dataType: "OTPStorage",
    account: name,
    encrypted: false,
    hash: crypto.randomUUID(),
    index: 0,
    secret: SECRET,
    type: "totp",
    ...fields,
  };
}

async function encrypt(entries: RawOTPStorage[], key: CopyKey) {
  const copy: Backup = { [key.key.id]: key.key };
  for (const entry of entries) {
    copy[entry.hash] = {
      dataType: "EncOTPStorage",
      data: await key.encryption.encrypt(JSON.stringify(entry)),
      keyId: key.key.id,
      index: entry.index,
    };
  }
  return copy;
}

async function storeAccounts(entries: RawOTPStorage[]) {
  const items: { [hash: string]: RawOTPStorage } = {};
  for (const entry of entries) {
    items[entry.hash] = entry;
  }
  await chrome.storage.local.set(items);
}

async function phoneAccounts() {
  return Object.values(await BrowserStorage.get())
    .map((item) => (item as RawOTPStorage).account)
    .sort();
}

async function storedMirror() {
  return (await storedDriveRecord())?.mirror;
}

function copyInfo(
  id: string,
  browser: string,
  day: string,
  modifiedTime: string,
): DriveCopyInfo {
  return { id, name: id, browser, day, modifiedTime, accounts: 1 };
}

describe("Drive mirror", function () {
  this.timeout(30000);

  let first: CopyKey;
  let second: CopyKey;
  let drive: FakeDrive;
  let folder: FakeFile;
  let createAlarm: sinon.SinonStub;

  before(async () => {
    first = await createKey("first password");
    second = await createKey("second password");
  });

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    await chrome.storage.session.set({
      [DRIVE_SESSION]: {
        accessToken: "access-token",
        expiresAt: Date.now() + 3600 * 1000,
        connectionId: CONNECTION_ID,
      },
    });
    drive = new FakeDrive().install();
    folder = drive.addFolder();
    createAlarm = sinon.stub(chrome.alarms, "create").resolves();
  });

  afterEach(async () => {
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  function upload(
    browser: string,
    copy: Backup,
    day = "2026-10-30",
    accounts = Object.values(copy).filter((item) => item.dataType !== "Key")
      .length,
  ) {
    return drive.addFile({
      name: `2fauthenticator-${browser}-${day}.json`,
      parents: [folder.id],
      properties: {
        app: "2fauthenticator",
        browser,
        day,
        accounts: String(accounts),
      },
      content: JSON.stringify(copy),
    });
  }

  async function connect(
    mirror: Partial<DriveMirror> = {},
    fields: Partial<DriveRecord> = {},
  ) {
    return await storeDriveRecord(
      driveRecord({
        client: "desktop",
        browser: "firefox",
        refreshToken: "refresh",
        folderId: folder.id,
        mirror: {
          source: "chrome",
          keys: { [first.key.id]: first.passphrase },
          ...mirror,
        },
        ...fields,
      }),
    );
  }

  function downloads() {
    return drive.requests.filter(
      (request) => request.url.searchParams.get("alt") === "media",
    );
  }

  function pauseDownload() {
    return drive.pause(
      (request) => request.url.searchParams.get("alt") === "media",
    );
  }

  describe("copy choice", () => {
    it("should pick the copy of the source that changed last", () => {
      const files = [
        copyInfo("old", "chrome", "2026-10-21", "2026-10-21T08:00:00.000Z"),
        copyInfo("late", "chrome", "2026-10-20", "2026-10-22T09:00:00.000Z"),
        copyInfo("other", "firefox", "2026-10-23", "2026-10-23T09:00:00.000Z"),
      ];

      latestCopy(files, "chrome")?.id.should.equal("late");
      chai.expect(latestCopy(files, "edge")).to.equal(undefined);
    });

    it("should offer the newest copy of every browser with the newest first", () => {
      const sources = copySources([
        copyInfo("chrome-old", "chrome", "2026-10-20", "2026-10-20T08:00:00Z"),
        copyInfo("firefox", "firefox", "2026-10-21", "2026-10-21T08:00:00Z"),
        copyInfo("chrome", "chrome", "2026-10-22", "2026-10-22T08:00:00Z"),
        copyInfo("unknown", "", "2026-10-23", "2026-10-23T08:00:00Z"),
      ]);

      sources.map((item) => item.id).should.deep.equal(["chrome", "firefox"]);
    });
  });

  it("should replace the accounts with the copy of the source that changed last", async () => {
    await storeAccounts([account("old")]);
    const a = account("a", { index: 1 });
    const b = account("b", { index: 0, hash: "not-a-uuid" });
    upload("chrome", await encrypt([account("older")], first), "2026-10-29");
    const latest = upload("chrome", await encrypt([a, b], first), "2026-10-28");
    upload("firefox", await encrypt([account("firefox")], first));
    await connect();

    (
      await handleDriveMessage({ action: "drive.mirrorCheck", force: true })
    ).should.deep.equal({ status: "applied" });

    (await phoneAccounts()).should.deep.equal(["a", "b"]);
    const stored = await BrowserStorage.get();
    Object.keys(stored).should.have.members([a.hash, "not-a-uuid"]);
    (stored["not-a-uuid"] as RawOTPStorage).index.should.equal(0);
    (stored[a.hash] as RawOTPStorage).index.should.equal(1);
    (await EntryStorage.hasEncryptionKey()).should.equal(false);
    const mirror = await storedMirror();
    chai.expect(mirror?.applied).to.include({
      fileId: latest.id,
      modifiedTime: latest.modifiedTime,
      accounts: 2,
    });
    chai.expect(mirror?.undecrypted).to.equal(0);
    createAlarm.should.have.been.calledWith(DRIVE_MIRROR_ALARM, {
      periodInMinutes: 60,
    });
    drive.uploads().should.have.lengthOf(0);
  });

  it("should not download the copy it already applied", async () => {
    upload("chrome", await encrypt([account("a")], first));
    await connect();
    await runMirror(true);

    (await runMirror(true)).should.deep.equal({ status: "unchanged" });

    downloads().should.have.lengthOf(1);
  });

  it("should not go back to an older copy", async () => {
    upload("chrome", await encrypt([account("older")], first), "2026-10-29");
    const newer = upload("chrome", await encrypt([account("newer")], first));
    await connect();
    await runMirror(true);
    newer.trashed = true;

    (await runMirror(true)).should.deep.equal({ status: "unchanged" });

    (await phoneAccounts()).should.deep.equal(["newer"]);
    downloads().should.have.lengthOf(1);
  });

  it("should apply the copy of the day again after it changed", async () => {
    const file = upload("chrome", await encrypt([account("a")], first));
    await connect();
    await runMirror(true);
    file.content = JSON.stringify(
      await encrypt([account("a"), account("b")], first),
    );
    file.modifiedTime = new Date(
      Date.parse(file.modifiedTime) + 60000,
    ).toISOString();
    file.properties.accounts = "2";

    (await runMirror(true)).should.deep.equal({ status: "applied" });

    (await phoneAccounts()).should.deep.equal(["a", "b"]);
  });

  it("should check at most once a minute unless it is asked to", async () => {
    upload("chrome", await encrypt([account("a")], first));
    await connect();
    await runMirror(true);
    const requests = drive.requests.length;

    (await runMirror()).should.deep.equal({ status: "unchanged" });
    drive.requests.should.have.lengthOf(requests);

    await updateDriveRecord((record) => {
      record.mirror!.checkedAt = Date.now() - 2 * 60 * 1000;
      return record;
    });
    await runMirror();
    drive.requests.length.should.be.greaterThan(requests);
  });

  it("should not apply an empty copy", async () => {
    await storeAccounts([account("old")]);
    upload("chrome", {}, "2026-10-30", 0);
    await connect();

    (await runMirror(true)).should.deep.equal({ status: "unchanged" });

    downloads().should.have.lengthOf(0);
    (await phoneAccounts()).should.deep.equal(["old"]);
    chai.expect((await storedMirror())?.applied).to.equal(undefined);
  });

  it("should leave the accounts when the source has no copies", async () => {
    await storeAccounts([account("old")]);
    upload("firefox", await encrypt([account("a")], first));
    await connect();

    (await runMirror(true)).should.deep.equal({ status: "none" });

    (await phoneAccounts()).should.deep.equal(["old"]);
  });

  it("should wait until the browser is chosen", async () => {
    await connect({ source: undefined });

    (await runMirror(true)).should.deep.equal({ status: "none" });

    drive.requests.should.have.lengthOf(0);
  });

  it("should not run without the connection of a phone", async () => {
    (await runMirror(true)).should.deep.equal({ status: "disconnected" });

    await storeDriveRecord(driveRecord());
    (await runMirror(true)).should.deep.equal({ status: "unavailable" });
    (
      await handleDriveMessage({ action: "drive.mirrorCheck", force: true })
    ).should.deep.equal({ status: "unavailable" });
    (
      await handleDriveMessage({
        action: "drive.mirrorShrink",
        decision: "apply",
      })
    ).should.deep.equal({ status: "unavailable" });
    drive.requests.should.have.lengthOf(0);
  });

  describe("keys", () => {
    it("should ask for the password of a copy under an unknown key", async () => {
      await storeAccounts([account("old")]);
      const file = upload("chrome", await encrypt([account("a")], second));
      await connect();

      (await runMirror(true)).should.deep.equal({
        status: "attention",
        attention: { kind: "mirrorPassword", fileId: file.id },
      });

      (await phoneAccounts()).should.deep.equal(["old"]);
      const stored = await storedDriveRecord();
      chai
        .expect(stored?.attention)
        .to.deep.equal({ kind: "mirrorPassword", fileId: file.id });
      chai.expect(stored?.mirror?.applied).to.equal(undefined);
    });

    it("should apply the copy once its key is known", async () => {
      upload("chrome", await encrypt([account("a")], second));
      await connect();
      await runMirror(true);
      await updateDriveRecord((record) => {
        record.mirror!.keys[second.key.id] = second.passphrase;
        return record;
      });

      (await runMirror(true)).should.deep.equal({ status: "applied" });

      (await phoneAccounts()).should.deep.equal(["a"]);
      chai.expect((await storedDriveRecord())?.attention).to.equal(undefined);
    });

    it("should keep the accounts under a skipped key and count them", async () => {
      const kept = account("kept on the phone");
      await storeAccounts([kept, account("removed")]);
      upload("chrome", {
        ...(await encrypt([account("a"), account("b")], first)),
        ...(await encrypt(
          [{ ...kept, account: "kept in the copy" }, account("skipped")],
          second,
        )),
      });
      await connect({ skippedKeys: [second.key.id] });

      (await runMirror(true)).should.deep.equal({ status: "applied" });

      (await phoneAccounts()).should.deep.equal([
        "a",
        "b",
        "kept on the phone",
      ]);
      const stored = await storedDriveRecord();
      chai.expect(stored?.attention).to.equal(undefined);
      chai.expect(stored?.mirror?.undecrypted).to.equal(2);
      chai.expect(stored?.mirror?.skippedKeys).to.deep.equal([second.key.id]);
    });

    it("should keep only the keys of the applied copy", async () => {
      upload("chrome", await encrypt([account("a")], first));
      await connect({
        keys: {
          [first.key.id]: first.passphrase,
          [second.key.id]: second.passphrase,
          "old-key": "old",
        },
        skippedKeys: ["skipped-key"],
      });

      await runMirror(true);

      const mirror = await storedMirror();
      chai
        .expect(mirror?.keys)
        .to.deep.equal({ [first.key.id]: first.passphrase });
      chai.expect(mirror?.skippedKeys).to.deep.equal([]);
    });

    it("should keep the keys written while the copy is applied", async () => {
      upload("chrome", {
        ...(await encrypt([account("a")], first)),
        ...(await encrypt([account("b")], second)),
      });
      await connect({ skippedKeys: [second.key.id] });
      const paused = pauseDownload();
      const run = runMirror(true);
      await paused.reached;

      await updateDriveRecord((record) => {
        record.mirror!.keys = {
          ...record.mirror!.keys,
          [second.key.id]: second.passphrase,
        };
        record.mirror!.skippedKeys = [];
        return record;
      });
      paused.resume();
      await run;

      const mirror = await storedMirror();
      chai.expect(mirror?.keys).to.deep.equal({
        [first.key.id]: first.passphrase,
        [second.key.id]: second.passphrase,
      });
      chai.expect(mirror?.skippedKeys).to.deep.equal([]);
    });
  });

  describe("smaller copy", () => {
    async function connectWithFive() {
      await storeAccounts(
        ["1", "2", "3", "4", "5"].map((name) => account(name)),
      );
      const file = upload(
        "chrome",
        await encrypt([account("a"), account("b")], first),
      );
      await connect();
      return file;
    }

    it("should ask before a copy takes away more than half of the accounts", async () => {
      const file = await connectWithFive();

      (await runMirror(true)).should.deep.equal({
        status: "attention",
        attention: {
          kind: "mirrorShrink",
          fileId: file.id,
          modifiedTime: file.modifiedTime,
          from: 5,
          to: 2,
        },
      });

      (await phoneAccounts()).should.have.lengthOf(5);
    });

    it("should apply the smaller copy once it is approved", async () => {
      await connectWithFive();
      await runMirror(true);

      (
        await handleDriveMessage({
          action: "drive.mirrorShrink",
          decision: "apply",
        })
      ).should.deep.equal({ status: "applied" });

      (await phoneAccounts()).should.deep.equal(["a", "b"]);
      const stored = await storedDriveRecord();
      chai.expect(stored?.attention).to.equal(undefined);
      chai.expect(stored?.mirror?.shrinkApproved).to.equal(undefined);
    });

    it("should keep the accounts until the next copy when the smaller one is kept", async () => {
      await connectWithFive();
      await runMirror(true);

      (
        await handleDriveMessage({
          action: "drive.mirrorShrink",
          decision: "keep",
        })
      ).should.deep.equal({ status: "unchanged" });
      chai.expect((await storedDriveRecord())?.attention).to.equal(undefined);

      (await runMirror(true)).should.deep.equal({ status: "unchanged" });
      (await phoneAccounts()).should.have.lengthOf(5);
      downloads().should.have.lengthOf(1);

      const next = upload(
        "chrome",
        await encrypt([account("c")], first),
        "2026-10-31",
      );
      (await runMirror(true)).should.deep.include({ status: "attention" });
      chai
        .expect((await storedDriveRecord())?.attention)
        .to.deep.include({ kind: "mirrorShrink", fileId: next.id, to: 1 });
    });
  });

  describe("errors", () => {
    it("should tell a network error, keep the accounts and not set a retry", async () => {
      await storeAccounts([account("old")]);
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      drive.fail(() => true, 503, "backendError");

      (await runMirror(true)).should.deep.equal({
        status: "error",
        error: "network",
      });

      (await phoneAccounts()).should.deep.equal(["old"]);
      chai
        .expect((await storedDriveRecord())?.error)
        .to.include({ kind: "network" });
      createAlarm.should.not.have.been.calledWith(DRIVE_CHECK_ALARM);
    });

    it("should tell a copy that cannot be read", async () => {
      const file = upload("chrome", {});
      file.properties.accounts = "1";
      file.content = "not json";
      await connect();

      (await runMirror(true)).should.deep.equal({
        status: "error",
        error: "network",
      });
    });

    it("should give up a request that does not answer", async () => {
      await connect();
      sinon.restore();
      sinon.stub(chrome.alarms, "create").resolves();
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      const timeouts = sinon.fake(() => timeout(20));
      sinon.replace(
        AbortSignal,
        "timeout",
        timeouts as unknown as typeof AbortSignal.timeout,
      );
      sinon.replace(
        window,
        "fetch",
        sinon.fake(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) =>
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              ),
            ),
        ) as unknown as typeof fetch,
      );

      (await runMirror(true)).should.deep.equal({
        status: "error",
        error: "network",
      });

      timeouts.should.have.been.calledWith(MIRROR_TIMEOUT);
    });

    it("should limit the wait for a new access token too", async () => {
      await connect();
      await chrome.storage.session.remove(DRIVE_SESSION);
      sinon.restore();
      sinon.stub(chrome.alarms, "create").resolves();
      const unlimited: string[] = [];
      sinon.replace(
        window,
        "fetch",
        sinon.fake(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.signal) {
            unlimited.push(String(input));
          }
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
      );

      (await runMirror(true)).should.deep.equal({
        status: "error",
        error: "network",
      });

      unlimited.should.deep.equal([]);
    });

    it("should ask to sign in again when the access cannot be renewed", async () => {
      upload("chrome", await encrypt([account("a")], first));
      await connect({}, { refreshToken: undefined });
      await chrome.storage.session.remove(DRIVE_SESSION);

      (await runMirror(true)).should.deep.equal({
        status: "attention",
        attention: { kind: "signin" },
      });
    });

    it("should forget the error and the request to sign in after a check that works", async () => {
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      await runMirror(true);
      await updateDriveRecord((record) => ({
        ...record,
        attention: { kind: "signin" },
        error: { kind: "network", at: 1 },
      }));

      (await runMirror(true)).should.deep.equal({ status: "unchanged" });

      const stored = await storedDriveRecord();
      chai.expect(stored?.attention).to.equal(undefined);
      chai.expect(stored?.error).to.equal(undefined);
    });
  });

  describe("changes during a run", () => {
    it("should run once more after the current run when it is asked to", async () => {
      upload("chrome", await encrypt([account("chrome")], first));
      const edge = upload("edge", await encrypt([account("edge")], first));
      await connect();
      const paused = pauseDownload();
      const running = runMirror(true);
      await paused.reached;

      await updateDriveRecord((record) => {
        record.mirror!.source = "edge";
        return record;
      });
      const again = runMirror(true);
      runMirror(true).should.equal(again);
      runMirror().should.equal(running);
      paused.resume();

      (await running).should.deep.equal({ status: "unchanged" });
      (await again).should.deep.equal({ status: "applied" });
      (await phoneAccounts()).should.deep.equal(["edge"]);
      chai.expect((await storedMirror())?.applied?.fileId).to.equal(edge.id);
    });

    it("should not bring the accounts back after a disconnect", async () => {
      await storeAccounts([account("old")]);
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      const paused = pauseDownload();
      const running = runMirror(true);
      await paused.reached;

      const disconnected = disconnect();
      paused.resume();
      await running;
      await disconnected;

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      (await phoneAccounts()).should.deep.equal([]);
    });

    it("should not apply the copy after the connection is removed", async () => {
      await storeAccounts([account("old")]);
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      const paused = pauseDownload();
      const running = runMirror(true);
      await paused.reached;

      await resetDrive();
      paused.resume();
      await running;

      chai.expect(await storedDriveRecord()).to.equal(undefined);
      (await phoneAccounts()).should.deep.equal(["old"]);
    });

    it("should not apply the copy of the old source", async () => {
      await storeAccounts([account("old")]);
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      const paused = pauseDownload();
      const running = runMirror(true);
      await paused.reached;

      await updateDriveRecord((record) => {
        record.mirror!.source = "edge";
        return record;
      });
      paused.resume();

      (await running).should.deep.equal({ status: "unchanged" });
      (await phoneAccounts()).should.deep.equal(["old"]);
      chai.expect((await storedMirror())?.applied).to.equal(undefined);
    });

    it("should not apply the copy of another Google account", async () => {
      await storeAccounts([account("old")]);
      upload("chrome", await encrypt([account("a")], first));
      await connect();
      const paused = pauseDownload();
      const running = runMirror(true);
      await paused.reached;

      await connect({}, { connectionId: "another" });
      paused.resume();
      await running;

      (await phoneAccounts()).should.deep.equal(["old"]);
      const stored = await storedDriveRecord();
      chai.expect(stored?.connectionId).to.equal("another");
      chai.expect(stored?.mirror?.applied).to.equal(undefined);
    });
  });

  it("should skip the settings and the connection inside a copy", async () => {
    const settings = await chrome.storage.local.get("UserSettings");
    upload("chrome", {
      ...(await encrypt(
        [account("a"), account("drive", { hash: "GoogleDrive" })],
        first,
      )),
      UserSettings: account("settings", { hash: "UserSettings" }),
    });
    await connect();

    (await runMirror(true)).should.deep.equal({ status: "applied" });

    (await phoneAccounts()).should.deep.equal(["a"]);
    (await chrome.storage.local.get("UserSettings")).should.deep.equal(
      settings,
    );
    const stored = await storedDriveRecord();
    chai.expect(stored?.connectionId).to.equal(CONNECTION_ID);
    chai.expect(stored?.mirror?.applied).to.not.equal(undefined);
  });
});
