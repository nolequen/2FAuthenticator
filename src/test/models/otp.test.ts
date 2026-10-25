import "mocha";
import "chai/register-should";

import { CodeState, OTPEntry, OTPType, isCodeReady } from "../../models/otp";

mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

describe("isCodeReady", () => {
  it("should accept a generated code", () => {
    const entry = new OTPEntry({
      type: OTPType.totp,
      index: 0,
      encrypted: false,
      secret: SECRET,
    });

    entry.code.should.match(/^\d{6}$/);
    isCodeReady(entry.code).should.equal(true);
  });

  it("should reject the code of a counter based account before the first click on next", () => {
    const entry = new OTPEntry({
      type: OTPType.hotp,
      index: 0,
      encrypted: false,
      secret: SECRET,
    });

    isCodeReady(entry.code).should.equal(false);
  });

  it("should reject the code of an account that is not decrypted yet", () => {
    const entry = new OTPEntry({
      encrypted: true,
      keyId: "key",
      encData: "v4:data",
      hash: crypto.randomUUID(),
      index: 0,
    });

    isCodeReady(entry.code).should.equal(false);
  });

  it("should reject an encrypted or an invalid code", () => {
    isCodeReady(CodeState.Encrypted).should.equal(false);
    isCodeReady(CodeState.Invalid).should.equal(false);
  });
});
