import "mocha";
import * as chai from "chai";
import "chai/register-should";

import {
  ISSUER_COLORS,
  algorithmName,
  faviconUrl,
  formatCode,
  issuerColor,
  issuerLetter,
  issuerName,
  issuerSite,
  joinIssuer,
  normalizeSite,
} from "../display";
import { CodeState, MASK_DIGIT, OTPAlgorithm } from "../models/otp";
import { loadI18nMessages } from "../store/i18n";

mocha.setup("bdd");

describe("display", () => {
  before(async () => {
    await loadI18nMessages();
  });

  describe("formatCode", () => {
    it("should split 6 digits into groups of three", () => {
      formatCode("123456").should.equal("123 456");
    });

    it("should split 8 digits into groups of four", () => {
      formatCode("12345678").should.equal("1234 5678");
    });

    it("should leave other lengths as they are", () => {
      formatCode("1234567").should.equal("1234567");
      formatCode("12345").should.equal("12345");
    });

    it("should split the mask like the code", () => {
      formatCode(MASK_DIGIT.repeat(6)).should.equal("••• •••");
      formatCode(MASK_DIGIT.repeat(8)).should.equal("•••• ••••");
    });

    it("should leave the code states as they are", () => {
      formatCode(CodeState.Encrypted).should.equal(CodeState.Encrypted);
      formatCode(CodeState.Invalid).should.equal(CodeState.Invalid);
    });
  });

  describe("issuerLetter", () => {
    it("should take the first letter of the issuer in upper case", () => {
      issuerLetter("github").should.equal("G");
    });

    it("should skip the site of the issuer", () => {
      issuerLetter("::example.com").should.equal("?");
      issuerLetter("Proton::proton.me").should.equal("P");
    });

    it("should give a question mark for an empty issuer", () => {
      issuerLetter("").should.equal("?");
      issuerLetter("   ").should.equal("?");
    });

    it("should take a Cyrillic letter", () => {
      issuerLetter("яндекс").should.equal("Я");
    });
  });

  describe("issuerColor", () => {
    it("should give the same color for the same issuer", () => {
      issuerColor("GitHub").should.equal(issuerColor("GitHub"));
      issuerColor("GitHub::github.com").should.equal(issuerColor("GitHub"));
    });

    it("should take the color from the palette", () => {
      for (const issuer of ["", "GitHub", "Google", "Яндекс ID", "AWS"]) {
        ISSUER_COLORS.should.include(issuerColor(issuer));
      }
    });

    it("should spread the issuers over the palette", () => {
      const colors = new Set(
        ["GitHub", "Google", "Cloudflare", "Proton", "AWS", "GitLab"].map(
          issuerColor,
        ),
      );
      colors.size.should.be.greaterThan(2);
    });
  });

  describe("site of the issuer", () => {
    it("should split the service and the site", () => {
      issuerName(" GitHub ::github.com").should.equal("GitHub");
      issuerSite("GitHub:: GitHub.com ").should.equal("github.com");
      issuerSite("GitHub").should.equal("");
      issuerName("::github.com").should.equal("");
    });

    it("should join the service and the site", () => {
      joinIssuer("GitHub", "github.com").should.equal("GitHub::github.com");
      joinIssuer("GitHub ", "").should.equal("GitHub");
      joinIssuer("Git::Hub", "github.com").should.equal("Git:Hub::github.com");
      joinIssuer("", "github.com").should.equal("::github.com");
      joinIssuer("Foo:", "github.com").should.equal("Foo::github.com");
      joinIssuer("Foo:", "").should.equal("Foo:");
    });

    it("should take the host of an address", () => {
      chai.expect(normalizeSite("")).to.equal("");
      chai.expect(normalizeSite("  ")).to.equal("");
      chai.expect(normalizeSite("github.com")).to.equal("github.com");
      chai
        .expect(normalizeSite("https://www.GitHub.com/login?next=1"))
        .to.equal("github.com");
      chai
        .expect(normalizeSite("gist.github.com/alice"))
        .to.equal("gist.github.com");
      chai.expect(normalizeSite("localhost")).to.equal("localhost");
    });

    it("should reject what is not an address", () => {
      chai.expect(normalizeSite("not a site")).to.equal(null);
      chai.expect(normalizeSite("github")).to.equal(null);
      chai.expect(normalizeSite("https://")).to.equal(null);
    });

    it("should build the address of the icon only for a plain domain", () => {
      chai
        .expect(faviconUrl("github.com"))
        .to.equal("https://github.com/favicon.ico");
      for (const site of [
        "",
        "github",
        "localhost",
        "app.localhost",
        "10.0.0.5",
        "a@10.0.0.5",
        "evil.com#",
        "evil.com:8080",
        "evil.com/path",
        "www.github.com",
        "GitHub.com",
      ]) {
        chai.expect(faviconUrl(site), site).to.equal(null);
      }
    });
  });

  it("should name the algorithms", () => {
    algorithmName(OTPAlgorithm.SHA1).should.equal("SHA-1");
    algorithmName(OTPAlgorithm.SHA256).should.equal("SHA-256");
    algorithmName(OTPAlgorithm.SHA512).should.equal("SHA-512");
    algorithmName(OTPAlgorithm.GOST3411_2012_256).should.equal(
      chrome.i18n.getMessage("algorithm_gost256"),
    );
  });
});
