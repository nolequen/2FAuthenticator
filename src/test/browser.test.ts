import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { isAndroid, setAndroid } from "../browser";

mocha.setup("bdd");

describe("browser", () => {
  afterEach(() => setAndroid(false));

  it("should tell Android by the user agent", () => {
    isAndroid.should.equal(navigator.userAgent.includes("Android"));
    isAndroid.should.equal(false);
  });

  it("should switch to Android for the tests", () => {
    setAndroid(true);

    chai.expect(isAndroid).to.equal(true);
  });
});
