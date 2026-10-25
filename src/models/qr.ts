import qrcode from "qrcode-generator";
import { OTPAlgorithm, OTPType } from "./otp";

export function getQrUrl(entry: OTPEntryInterface) {
  const label = entry.issuer
    ? entry.issuer.split("::")[0] + ":" + entry.account
    : entry.account;
  const type =
    entry.type === OTPType.hex
      ? OTPType[OTPType.totp]
      : entry.type === OTPType.hhex
        ? OTPType[OTPType.hotp]
        : OTPType[entry.type];
  const otpauth =
    "otpauth://" +
    type +
    "/" +
    encodeURIComponent(label) +
    "?secret=" +
    entry.secret +
    (entry.issuer
      ? "&issuer=" + encodeURIComponent(entry.issuer.split("::")[0])
      : "") +
    (entry.type === OTPType.hotp || entry.type === OTPType.hhex
      ? "&counter=" + entry.counter
      : "") +
    ((entry.type === OTPType.totp || entry.type === OTPType.hex) &&
    entry.period !== 30
      ? "&period=" + entry.period
      : "") +
    (entry.digits !== 6 ? "&digits=" + entry.digits : "") +
    (entry.algorithm !== OTPAlgorithm.SHA1
      ? "&algorithm=" + OTPAlgorithm[entry.algorithm]
      : "");
  const qr = qrcode(0, "L");
  qr.addData(otpauth);
  qr.make();
  return qr.createDataURL(5);
}
