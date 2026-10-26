import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { startCapture } from "../../../components/Popup/startCapture";
import { OTPEntry, OTPType } from "../../../models/otp";
import { i18n, loadI18nMessages } from "../../../store/i18n";
import { useAccountsStore } from "../../../store/Accounts";
import { useNotificationStore } from "../../../store/Notification";
import { createTestPinia } from "../../vue-helper";

chai.use(sinonChai);
mocha.setup("bdd");

describe("startCapture", () => {
  let alert: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let executeScript: sinon.SinonStub;
  let tabMessage: sinon.SinonSpy;
  let runtimeMessage: sinon.SinonSpy;
  let close: sinon.SinonSpy;
  let open: sinon.SinonSpy;
  let response: unknown;

  function activeTab(url: string) {
    sinon.replace(
      chrome.tabs,
      "query",
      sinon.fake.resolves([
        { id: 7, windowId: 3, url },
      ]) as unknown as typeof chrome.tabs.query,
    );
  }

  before(async () => {
    await loadI18nMessages();
  });

  beforeEach(() => {
    const pinia = createTestPinia();
    const notification = useNotificationStore(pinia);
    alert = sinon.stub(notification, "alert");
    confirm = sinon.stub(notification, "confirm").resolves(false);
    response = "beginCapture";
    executeScript = sinon.stub().resolves([]);
    sinon.replace(
      chrome.scripting,
      "executeScript",
      executeScript as unknown as typeof chrome.scripting.executeScript,
    );
    sinon.replace(
      chrome.scripting,
      "insertCSS",
      sinon.fake.resolves(
        undefined,
      ) as unknown as typeof chrome.scripting.insertCSS,
    );
    tabMessage = sinon.fake(
      (tabId: number, message: unknown, callback: (value: unknown) => void) =>
        callback(response),
    );
    sinon.replace(
      chrome.tabs,
      "sendMessage",
      tabMessage as unknown as typeof chrome.tabs.sendMessage,
    );
    runtimeMessage = sinon.fake();
    sinon.replace(
      chrome.runtime,
      "sendMessage",
      runtimeMessage as unknown as typeof chrome.runtime.sendMessage,
    );
    close = sinon.fake();
    open = sinon.fake();
    sinon.replace(window, "close", close);
    sinon.replace(window, "open", open);
  });

  it("should start the capture on a web page and close the popup", async () => {
    activeTab("https://example.com/login");

    (await startCapture()).should.equal("started");

    executeScript.should.have.been.calledOnce;
    runtimeMessage.should.have.been.calledWithMatch({
      action: "updateContentTab",
    });
    tabMessage.should.have.been.calledWith(7, { action: "capture" });
    close.should.have.been.calledOnce;
    alert.should.not.have.been.called;
  });

  it("should not start while some accounts are not decrypted", async () => {
    activeTab("https://example.com/login");
    const entry = new OTPEntry({
      type: OTPType.totp,
      index: 0,
      issuer: "Example",
      account: "alice",
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
    });
    entry.secret = null;
    useAccountsStore().entries = [entry];

    (await startCapture()).should.equal("encrypted");

    alert.should.have.been.calledOnceWith(i18n.phrase_incorrect);
    executeScript.should.not.have.been.called;
  });

  it("should tell that a page without scripts cannot be scanned", async () => {
    activeTab("chrome://newtab/");

    (await startCapture()).should.equal("unsupported");

    alert.should.have.been.calledOnceWith(i18n.capture_unsupported);
    executeScript.should.not.have.been.called;
    close.should.not.have.been.called;
  });

  it("should offer the image import on a local file before adding the script", async () => {
    activeTab("file:///C:/qr.png");
    confirm.resolves(true);

    (await startCapture()).should.equal("file-import");

    confirm.should.have.been.calledOnceWith(i18n.capture_local_file_failed);
    open.should.have.been.calledOnceWith("import.html?QrImport", "_blank");
    executeScript.should.not.have.been.called;
  });

  it("should go on with the capture on a local file when the import is declined", async () => {
    activeTab("file:///C:/qr.png");

    (await startCapture()).should.equal("started");

    confirm.should.have.been.calledBefore(executeScript);
    open.should.not.have.been.called;
    close.should.have.been.calledOnce;
  });

  it("should tell when the script cannot be added", async () => {
    activeTab("https://example.com/login");
    executeScript.rejects(new Error("Cannot access contents of the page"));

    (await startCapture()).should.equal("failed");

    alert.should.have.been.calledOnceWith(i18n.capture_failed);
    tabMessage.should.not.have.been.called;
    close.should.not.have.been.called;
  });

  it("should tell when the page does not answer", async () => {
    activeTab("https://example.com/login");
    response = undefined;

    (await startCapture()).should.equal("failed");

    alert.should.have.been.calledOnceWith(i18n.capture_failed);
    close.should.not.have.been.called;
  });
});
