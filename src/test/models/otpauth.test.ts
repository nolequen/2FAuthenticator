import "mocha";
import * as chai from "chai";

import {
  getEntryDataFromOTPAuthPerLine,
  OTPAuthParseResult,
  parseOTPAuthURI,
} from "../../models/otpauth";

chai.should();
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const HEX_SECRET = "3132333435363738393031323334353637383930";

function parsedEntry(result: OTPAuthParseResult) {
  if ("error" in result) {
    throw new Error(`Expected an entry, got error ${result.error}`);
  }
  return result.entry;
}

describe("parseOTPAuthURI", () => {
  it("should read the counter of a hotp entry", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://hotp/Example:user?secret=${SECRET}&counter=7`)
    );

    entry.type.should.equal("hotp");
    (entry.counter as number).should.equal(7);
  });

  it("should use zero for an invalid counter", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://hotp/user?secret=${SECRET}&counter=-1`)
    );

    (entry.counter as number).should.equal(0);
  });

  it("should read the type in lower case", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://TOTP/user?secret=${SECRET}`)
    );

    entry.type.should.equal("totp");
  });

  it("should detect hex for a totp entry with a hex secret", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://totp/user?secret=${HEX_SECRET}`)
    );

    entry.type.should.equal("hex");
  });

  it("should detect hhex for a hotp entry with a hex secret", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://hotp/user?secret=${HEX_SECRET}`)
    );

    entry.type.should.equal("hhex");
  });

  it("should read issuer and account from the label and parameters", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(
        `otpauth://totp/Example%20Inc:user%40example.com?secret=${SECRET}&issuer=Example+Inc`
      )
    );

    (entry.issuer as string).should.equal("Example Inc");
    (entry.account as string).should.equal("user@example.com");
  });

  it("should read algorithm, period and digits", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(
        `otpauth://totp/user?secret=${SECRET}&algorithm=SHA256&period=60&digits=8`
      )
    );

    (entry.algorithm as string).should.equal("SHA256");
    (entry.period as number).should.equal(60);
    (entry.digits as number).should.equal(8);
  });

  it("should ignore a period that does not divide a minute", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://totp/user?secret=${SECRET}&period=45`)
    );

    chai.expect(entry.period).to.equal(undefined);
  });

  it("should use the default for zero or non-numeric digits", () => {
    for (const digits of ["0", "eight"]) {
      const entry = parsedEntry(
        parseOTPAuthURI(`otpauth://totp/user?secret=${SECRET}&digits=${digits}`)
      );

      chai.expect(entry.digits).to.equal(undefined);
    }
  });

  it("should accept an empty label", () => {
    const entry = parsedEntry(
      parseOTPAuthURI(`otpauth://totp/?secret=${SECRET}`)
    );

    (entry.account as string).should.equal("");
    entry.secret.should.equal(SECRET);
  });

  it("should report an invalid line without a secret", () => {
    parseOTPAuthURI("otpauth://totp/user?issuer=Example").should.deep.equal({
      error: "invalid",
    });
  });

  it("should report an invalid line without parameters", () => {
    parseOTPAuthURI("otpauth://totp/user").should.deep.equal({
      error: "invalid",
    });
  });

  it("should report an invalid line without //", () => {
    parseOTPAuthURI(`otpauth:totp/user?secret=${SECRET}`).should.deep.equal({
      error: "invalid",
    });
  });

  it("should report a secret that is neither base32 nor hex", () => {
    parseOTPAuthURI(
      "otpauth://totp/user?secret=not-a-secret!"
    ).should.deep.equal({ error: "secret", secret: "not-a-secret!" });
  });
});

describe("getEntryDataFromOTPAuthPerLine", () => {
  it("should keep the counter of a hotp entry", async () => {
    const result = await getEntryDataFromOTPAuthPerLine(
      `otpauth://hotp/Example:user?secret=${SECRET}&counter=7`
    );

    result.succeededCount.should.equal(1);
    const hashes = Object.keys(result.exportData);
    hashes.should.have.lengthOf(1);
    (result.exportData[hashes[0]].counter as number).should.equal(7);
  });

  it("should count a line without // as failed and import the others", async () => {
    const result = await getEntryDataFromOTPAuthPerLine(
      [
        `otpauth:totp/Broken?secret=${SECRET}`,
        `otpauth://totp/Example:user?secret=${SECRET}`,
      ].join("\n")
    );

    result.failedCount.should.equal(1);
    result.succeededCount.should.equal(1);
  });
});
