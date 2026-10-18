import "mocha";
import * as chai from "chai";

chai.should();
mocha.setup("bdd");

describe("content style", () => {
  let stylesheet: HTMLLinkElement;

  before(async () => {
    stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("css/content.css");
    await new Promise((resolve, reject) => {
      stylesheet.addEventListener("load", resolve);
      stylesheet.addEventListener("error", reject);
      document.head.appendChild(stylesheet);
    });
  });

  after(() => {
    stylesheet.remove();
  });

  afterEach(() => {
    document.body.style.pointerEvents = "";
    document.getElementById("__ga_grayLayout__")?.remove();
  });

  it("should let the scan overlay take clicks when the page disables them on body", () => {
    document.body.style.pointerEvents = "none";
    const grayLayout = document.createElement("div");
    grayLayout.id = "__ga_grayLayout__";
    grayLayout.style.display = "block";
    document.body.appendChild(grayLayout);

    getComputedStyle(grayLayout).pointerEvents.should.equal("auto");
    chai
      .expect(
        document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      )
      .to.equal(grayLayout);
  });
});
