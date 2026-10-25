import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";

import { KeyUtilities } from "../../models/key-utilities";
import { OTPAlgorithm, OTPType } from "../../models/otp";

mocha.setup("bdd");

function asciiToHex(text: string) {
  return Array.from(text, (char) => char.charCodeAt(0).toString(16)).join("");
}

describe("KeyUtilities", () => {
  describe("RFC 4226 test vectors", () => {
    const secret = asciiToHex("12345678901234567890");
    const codes = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];

    codes.forEach((code, counter) => {
      it(`should generate ${code} for counter ${counter}`, () => {
        KeyUtilities.generate(
          OTPType.hhex,
          secret,
          counter,
          30,
          6,
          OTPAlgorithm.SHA1,
        ).should.equal(code);
      });
    });
  });

  describe("RFC 6238 test vectors", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    const seeds = [
      {
        name: "SHA1",
        algorithm: OTPAlgorithm.SHA1,
        secret: asciiToHex("12345678901234567890"),
      },
      {
        name: "SHA256",
        algorithm: OTPAlgorithm.SHA256,
        secret: asciiToHex("12345678901234567890123456789012"),
      },
      {
        name: "SHA512",
        algorithm: OTPAlgorithm.SHA512,
        secret: asciiToHex(
          "1234567890123456789012345678901234567890123456789012345678901234",
        ),
      },
    ];

    const vectors: Array<[number, string, string, string]> = [
      [59, "94287082", "46119246", "90693936"],
      [1111111109, "07081804", "68084774", "25091201"],
      [1111111111, "14050471", "67062674", "99943326"],
      [1234567890, "89005924", "91819424", "93441116"],
      [2000000000, "69279037", "90698825", "38618901"],
      [20000000000, "65353130", "77737706", "47863826"],
    ];

    for (const [seconds, ...codes] of vectors) {
      seeds.forEach((seed, index) => {
        it(`should generate ${codes[index]} with ${seed.name} at ${seconds}`, () => {
          clock = sinon.useFakeTimers(seconds * 1000);

          KeyUtilities.generate(
            OTPType.hex,
            seed.secret,
            0,
            30,
            8,
            seed.algorithm,
          ).should.equal(codes[index]);
        });
      });
    }

    it("should generate 94287082 from a base32 secret at 59", () => {
      clock = sinon.useFakeTimers(59 * 1000);

      KeyUtilities.generate(
        OTPType.totp,
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        0,
        30,
        8,
        OTPAlgorithm.SHA1,
      ).should.equal("94287082");
    });
  });

  describe("base32 secrets", () => {
    let clock: sinon.SinonFakeTimers | undefined;

    beforeEach(() => {
      clock = sinon.useFakeTimers({
        now: 1700000000 * 1000,
        toFake: ["Date"],
      });
    });

    afterEach(() => {
      clock?.restore();
      clock = undefined;
    });

    function totp(secret: string) {
      return KeyUtilities.generate(
        OTPType.totp,
        secret,
        0,
        30,
        6,
        OTPAlgorithm.SHA1,
      );
    }

    it("should ignore the trailing bits of a secret", () => {
      KeyUtilities.generate(
        OTPType.hex,
        "4eed64576f9992f857b00204",
        0,
        30,
        6,
        OTPAlgorithm.SHA1,
      ).should.equal("363254");
      totp("J3WWIV3PTGJPQV5QAICM").should.equal("363254");
    });

    it("should accept padding, lower case and spaces", () => {
      totp("J3WWIV3PTGJPQV5QAICM====").should.equal("363254");
      totp("j3wwiv3ptgjpqv5qaicm").should.equal("363254");
      totp("J3WW IV3P TGJP QV5Q AICM").should.equal("363254");
    });

    it("should reject a character outside the base32 alphabet", () => {
      chai
        .expect(() => totp("J3WWIV3PTGJPQV5QAIC1"))
        .to.throw("Invalid Base32 string");
    });
  });
});
