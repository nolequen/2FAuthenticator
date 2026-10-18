import "mocha";
import * as chai from "chai";

import { getAlertText } from "../contentAlerts";

chai.should();
mocha.setup("bdd");

describe("getAlertText", () => {
  it("should show an unrecognized QR code", () => {
    chai
      .expect(getAlertText({ action: "errorqr" }))
      .to.equal(chrome.i18n.getMessage("errorqr"));
  });

  it("should show an invalid secret from a QR code", () => {
    chai
      .expect(getAlertText({ action: "secretqr", secret: "not-a-secret!" }))
      .to.equal(`${chrome.i18n.getMessage("errorsecret")}\nnot-a-secret!`);
  });

  it("should show an added account", () => {
    chai
      .expect(getAlertText({ action: "added", account: "alice" }))
      .to.equal(`alice${chrome.i18n.getMessage("added")}`);
  });

  it("should show nothing for an unknown action", () => {
    chai.expect(getAlertText({ action: "unknown" })).to.equal(undefined);
  });
});
