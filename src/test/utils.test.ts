import "mocha";
import * as chai from "chai";

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
