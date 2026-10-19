import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";
import jsQR from "jsqr";

import EntryComponent from "../../../components/Popup/EntryComponent.vue";
import { OTPEntry, OTPType } from "../../../models/otp";
import { parseOTPAuthURI } from "../../../models/otpauth";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");

function decodeQr(dataUrl: string) {
  return new Promise<string | undefined>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height);
      resolve(jsQR(data.data, data.width, data.height)?.data);
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

describe("EntryComponent", () => {
  it("should leave the site out of the QR code label of an issuer with a site", async () => {
    const commit = sinon.fake();
    const entry = new OTPEntry({
      type: OTPType.totp,
      index: 0,
      issuer: "Google::google.com",
      account: "alice",
      encrypted: false,
      secret: "JBSWY3DPEHPK3PXP",
    });
    const { methods } = (
      EntryComponent as unknown as {
        options: {
          methods: { showQr(this: unknown, entry: OTPEntry): void };
        };
      }
    ).options;

    methods.showQr.call({ $store: { commit } }, entry);

    commit.should.have.been.calledWith("qr/setQr");
    const text = await decodeQr(commit.firstCall.args[1]);
    chai.expect(text).to.be.a("string");
    const result = parseOTPAuthURI(text as string);
    if ("error" in result) {
      throw new Error(`Expected an entry, got error ${result.error}`);
    }
    (result.entry.issuer as string).should.equal("Google");
    (result.entry.account as string).should.equal("alice");
  });
});
