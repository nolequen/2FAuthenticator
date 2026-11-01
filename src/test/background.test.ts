import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

chai.use(sinonChai);
mocha.setup("bdd");

describe("background", () => {
  it("should register its listeners without the commands API", () => {
    const listeners = [
      sinon.stub(chrome.runtime.onMessage, "addListener"),
      sinon.stub(chrome.alarms.onAlarm, "addListener"),
      sinon.stub(chrome.storage.onChanged, "addListener"),
      sinon.stub(chrome.runtime.onStartup, "addListener"),
      sinon.stub(chrome.runtime.onInstalled, "addListener"),
    ];
    sinon.stub(chrome, "commands").value(undefined);

    chai.expect(() => require("../background")).to.not.throw();

    for (const listener of listeners) {
      listener.should.have.been.calledOnce;
    }
  });
});
