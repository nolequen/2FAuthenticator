import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { OTPEntry, OTPType } from "../models/otp";
import {
  getMatchedEntries,
  injectContentScript,
  type TabWithIdAndURL,
} from "../utils";

chai.use(sinonChai);
mocha.setup("bdd");

interface WorkerResponse {
  siteName?: Array<string | null>;
  error?: string;
}

function getSiteNameInWorker(tab: Partial<chrome.tabs.Tab>) {
  const worker = new Worker(chrome.runtime.getURL("dist/site-name.worker.js"));
  return new Promise<WorkerResponse>((resolve, reject) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ tab });
  }).finally(() => worker.terminate());
}

describe("getSiteName", () => {
  it("should read the site from the active tab where document is not defined", async () => {
    const response = await getSiteNameInWorker({
      title: "Example Domain",
      url: "https://www.example.com/login",
    });

    chai.expect(response.error).to.equal(undefined);
    chai
      .expect(response.siteName)
      .to.deep.equal(["exampledomain", "example", "www.example.com"]);
  });
});

describe("injectContentScript", () => {
  const TAB = { id: 7, url: "https://example.com/" } as TabWithIdAndURL;

  it("should add the content script and its style to the tab", async () => {
    const executeScript = sinon.fake.resolves([]);
    const insertCSS = sinon.fake.resolves(undefined);
    sinon.replace(
      chrome.scripting,
      "executeScript",
      executeScript as unknown as typeof chrome.scripting.executeScript,
    );
    sinon.replace(
      chrome.scripting,
      "insertCSS",
      insertCSS as unknown as typeof chrome.scripting.insertCSS,
    );

    await injectContentScript(TAB);

    executeScript.should.have.been.calledOnceWith({
      target: { tabId: 7 },
      files: ["/dist/content.js"],
    });
    insertCSS.should.have.been.calledOnceWith({
      target: { tabId: 7 },
      files: ["/css/content.css"],
    });
  });

  it("should pass on the error of the script", async () => {
    sinon.replace(
      chrome.scripting,
      "executeScript",
      sinon.fake.rejects(
        new Error("Cannot access contents of the page"),
      ) as unknown as typeof chrome.scripting.executeScript,
    );

    let error: unknown;
    try {
      await injectContentScript(TAB);
    } catch (caught) {
      error = caught;
    }

    chai.expect(error).to.be.an("error");
  });
});

describe("getMatchedEntries", () => {
  function entry(issuer: string) {
    return new OTPEntry({
      type: OTPType.totp,
      index: 0,
      issuer,
      account: "alice",
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
    });
  }

  function matches(issuer: string, host: string, title = "") {
    const name = host.split(".").slice(-2, -1)[0] ?? host;
    const matched = getMatchedEntries([title, name, host], [entry(issuer)]);
    return matched !== false && matched.length === 1;
  }

  it("should match the site of an account without a service", () => {
    matches("::github.com", "github.com").should.equal(true);
  });

  it("should match the site and its subdomains", () => {
    matches("Code::github.com", "github.com").should.equal(true);
    matches("Code::github.com", "gist.github.com").should.equal(true);
  });

  it("should not match a host that only contains the site", () => {
    matches("Code::github.com", "github.com.evil.io").should.equal(false);
    matches("::localhost", "localhost.evil.com").should.equal(false);
    matches("Corp::localhost", "localhost").should.equal(true);
  });

  it("should match only by the site when it is set", () => {
    matches(
      "GitHub::github.com",
      "github.com.evil.io",
      "signintogithub",
    ).should.equal(false);
    matches("Dropbox::x.com", "dropbox.com").should.equal(false);
    matches("GitHub::example.org", "github.com").should.equal(false);
  });

  it("should match a site without a dot as a part of the host", () => {
    matches("Code::github", "gist.github.com").should.equal(true);
  });

  it("should not match every host with an empty site", () => {
    matches("Code::", "example.com").should.equal(false);
  });

  it("should still match the service by the name of the host", () => {
    matches("GitHub", "github.com").should.equal(true);
    matches("GitHub", "example.com", "signintogithub").should.equal(true);
  });
});
