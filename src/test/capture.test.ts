import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import {
  handleCaptureMessage,
  startCaptureFromCommand,
  stopCaptureOnAutolock,
} from "../capture";
import { EntryStorage } from "../models/storage";
import { account, migrationUri, payload } from "./migration-helper";
import {
  cacheSessionKey,
  clearSession,
  resetStorage,
  storeKey,
} from "./storage-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const CAPTURE_URL = "data:image/png;base64,AAAA";
const SECRET = "JBSWY3DPEHPK3PXP";
const TAB = { id: 7, windowId: 3 } as chrome.tabs.Tab;

describe("capture", () => {
  let sendMessage: sinon.SinonStub;
  let captureVisibleTab: sinon.SinonSpy;

  beforeEach(async () => {
    await resetStorage();
    await clearSession();
    sendMessage = sinon.stub().resolves(undefined);
    sinon.replace(
      chrome.tabs,
      "sendMessage",
      sendMessage as unknown as typeof chrome.tabs.sendMessage,
    );
    captureVisibleTab = sinon.fake.resolves(CAPTURE_URL);
    sinon.replace(
      chrome.tabs,
      "captureVisibleTab",
      captureVisibleTab as typeof chrome.tabs.captureVisibleTab,
    );
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
  });

  it("should send the capture to the tab that asked for it", async () => {
    await handleCaptureMessage(
      { action: "getCapture", info: { captureBoxLeft: 1 } },
      { tab: TAB },
    );

    captureVisibleTab.should.have.been.calledOnceWith(3, { format: "png" });
    sendMessage.should.have.been.calledOnceWith(7, {
      action: "sendCaptureUrl",
      info: { captureBoxLeft: 1, url: CAPTURE_URL },
    });
  });

  it("should add a scanned account and tell the tab that scanned it", async () => {
    await handleCaptureMessage(
      {
        action: "getTotp",
        info: `otpauth://totp/Example:alice?secret=${SECRET}`,
      },
      { tab: TAB },
    );

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    entries[0].account.should.equal("alice");
    sendMessage.should.have.been.calledOnceWith(7, {
      action: "added",
      account: "alice",
    });
  });

  it("should add a scanned account under the key of the session", async () => {
    await storeKey("capture-key");
    const encryption = await cacheSessionKey("capture-key");

    await handleCaptureMessage(
      {
        action: "getTotp",
        info: `otpauth://totp/Example:alice?secret=${SECRET}`,
      },
      { tab: TAB },
    );

    const entries = await EntryStorage.get();
    entries.should.have.lengthOf(1);
    chai.expect(entries[0].keyId).to.equal("capture-key");
    await entries[0].applyEncryption(encryption);
    entries[0].account.should.equal("alice");
    sendMessage.should.have.been.calledOnceWith(7, {
      action: "added",
      account: "alice",
    });
  });

  it("should not add a scanned account when the key of the session is no longer stored", async () => {
    await storeKey("new-key");
    await cacheSessionKey("old-key");

    await handleCaptureMessage(
      {
        action: "getTotp",
        info: `otpauth://totp/Example:alice?secret=${SECRET}`,
      },
      { tab: TAB },
    );

    (await EntryStorage.get()).should.have.lengthOf(0);
    sendMessage.should.have.been.calledOnceWith(7, { action: "errorenc" });
  });

  it("should ignore a capture request that does not come from a tab", async () => {
    await handleCaptureMessage(
      { action: "getCapture", info: { captureBoxLeft: 1 } },
      {},
    );

    captureVisibleTab.should.not.have.been.called;
    sendMessage.should.not.have.been.called;
  });

  it("should ignore a scan result that does not come from a tab", async () => {
    await handleCaptureMessage(
      {
        action: "getTotp",
        info: `otpauth://totp/Example:alice?secret=${SECRET}`,
      },
      {},
    );

    (await EntryStorage.get()).should.have.lengthOf(0);
    sendMessage.should.not.have.been.called;
  });

  it("should stop the capture in the saved tab on autolock", async () => {
    await chrome.storage.session.set({ contentTabId: 7 });

    await stopCaptureOnAutolock();

    sendMessage.should.have.been.calledOnceWith(7, { action: "stopCapture" });
    chai
      .expect((await chrome.storage.session.get("contentTabId")).contentTabId)
      .to.equal(undefined);
  });

  it("should stop the capture on autolock when the saved tab is gone", async () => {
    sendMessage.rejects(
      new Error(
        "Could not establish connection. Receiving end does not exist.",
      ),
    );
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      await chrome.storage.session.set({ contentTabId: 7 });
      await stopCaptureOnAutolock();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }

    rejections.should.have.lengthOf(0);
    chai
      .expect((await chrome.storage.session.get("contentTabId")).contentTabId)
      .to.equal(undefined);
  });

  it("should save the tab of a capture started from the popup", async () => {
    await handleCaptureMessage(
      { action: "updateContentTab", data: { id: 9 } as chrome.tabs.Tab },
      {},
    );

    chai
      .expect((await chrome.storage.session.get("contentTabId")).contentTabId)
      .to.equal(9);
  });

  describe("Google Authenticator export", () => {
    async function scan(uri: string) {
      await handleCaptureMessage({ action: "updateContentTab", data: TAB }, {});
      await handleCaptureMessage(
        { action: "getTotp", info: uri },
        { tab: TAB },
      );
    }

    it("should add every account of the export at its own position", async () => {
      await scan(
        migrationUri(
          payload(
            account({ name: "alice", issuer: "Example" }),
            account({ name: "bob", issuer: "Example" }),
            account({ name: "carol", issuer: "Example" }),
          ),
        ),
      );

      sendMessage.should.have.been.calledWith(7, {
        action: "migrationsuccess",
      });
      const entries = await EntryStorage.get();
      entries
        .map((entry) => entry.account)
        .should.have.members(["alice", "bob", "carol"]);
      new Set(entries.map((entry) => entry.index)).size.should.equal(3);
    });

    it("should report that some accounts could not be added", async () => {
      await scan(
        migrationUri(
          payload(
            account({ name: "alice", issuer: "Example" }),
            account({ name: "bob", issuer: "Example", secret: [] }),
          ),
        ),
      );

      sendMessage.should.have.been.calledWith(7, {
        action: "migrationpartlyfail",
      });
      (await EntryStorage.get()).should.have.lengthOf(1);
    });

    it("should report that no account could be added", async () => {
      await scan(
        migrationUri(
          payload(account({ name: "bob", issuer: "Example", secret: [] })),
        ),
      );

      sendMessage.should.have.been.calledWith(7, { action: "migrationfail" });
      (await EntryStorage.get()).should.have.lengthOf(0);
    });
  });

  describe("keyboard shortcut", () => {
    beforeEach(() => {
      sinon.replace(
        chrome.tabs,
        "query",
        sinon.fake.resolves([
          { id: 7, windowId: 3, url: "https://example.com/" },
        ]) as unknown as typeof chrome.tabs.query,
      );
      sinon.replace(
        chrome.scripting,
        "executeScript",
        sinon.fake.resolves(
          [],
        ) as unknown as typeof chrome.scripting.executeScript,
      );
      sinon.replace(
        chrome.scripting,
        "insertCSS",
        sinon.fake.resolves(
          undefined,
        ) as unknown as typeof chrome.scripting.insertCSS,
      );
    });

    it("should start a capture when no password is set", async () => {
      await startCaptureFromCommand();

      sendMessage.should.have.been.calledOnceWith(7, { action: "capture" });
      chai
        .expect((await chrome.storage.session.get("contentTabId")).contentTabId)
        .to.equal(7);
    });

    it("should not start a capture while the accounts are locked", async () => {
      await chrome.storage.local.set({
        "capture-key": {
          dataType: "Key",
          id: "capture-key",
          salt: "salt",
          hash: "hash",
          version: 3,
        },
      });

      await startCaptureFromCommand();

      sendMessage.should.not.have.been.called;
    });
  });
});
