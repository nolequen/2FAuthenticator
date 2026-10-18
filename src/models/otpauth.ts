import { getOTPAuthPerLineFromOPTAuthMigration } from "./migration";
import { parseOTPCounter } from "./otp";

export type OTPAuthParseResult =
  | { entry: RawOTPStorage }
  | { error: "invalid" }
  | { error: "secret"; secret: string };

export function parseOTPAuthURI(text: string): OTPAuthParseResult {
  if (!text.startsWith("otpauth://")) {
    return { error: "invalid" };
  }

  let uri = text.slice("otpauth://".length);
  let type = uri.slice(0, 4).toLowerCase();
  uri = uri.slice(5);
  let label = uri.split("?")[0];
  const parameterPart = uri.split("?")[1];
  if (!parameterPart) {
    return { error: "invalid" };
  }

  let secret = "";
  let account: string | undefined;
  let issuer: string | undefined;
  let algorithm: string | undefined;
  let period: number | undefined;
  let digits: number | undefined;
  let counter = 0;

  try {
    label = decodeURIComponent(label);
  } catch (error) {
    console.error(error);
  }
  const labelSeparator = label.indexOf(":");
  if (labelSeparator !== -1) {
    issuer = label.slice(0, labelSeparator);
    account = label.slice(labelSeparator + 1);
  } else {
    account = label;
  }
  const parameters = parameterPart.split("&");
  parameters.forEach((item) => {
    const separator = item.indexOf("=");
    const parameter =
      separator === -1
        ? [item]
        : [item.slice(0, separator), item.slice(separator + 1)];
    if (parameter[0].toLowerCase() === "secret") {
      secret = parameter[1];
    } else if (parameter[0].toLowerCase() === "issuer") {
      const value = (parameter[1] ?? "").replace(/\+/g, " ");
      try {
        issuer = decodeURIComponent(value);
      } catch {
        issuer = value;
      }
    } else if (parameter[0].toLowerCase() === "counter") {
      counter = parseOTPCounter(parameter[1]);
    } else if (parameter[0].toLowerCase() === "period") {
      period = Number(parameter[1]);
      period =
        isNaN(period) || period < 0 || period > 60 || 60 % period !== 0
          ? undefined
          : period;
    } else if (parameter[0].toLowerCase() === "digits") {
      digits = Number(parameter[1]);
      digits = isNaN(digits) || digits === 0 ? undefined : digits;
    } else if (parameter[0].toLowerCase() === "algorithm") {
      algorithm = parameter[1];
    }
  });

  if (!secret) {
    return { error: "invalid" };
  }
  const normalizedSecret = normalizeSecret(secret);
  if (
    !/^[0-9a-f]+$/i.test(normalizedSecret) &&
    !/^[2-7a-z]+=*$/i.test(normalizedSecret)
  ) {
    return { error: "secret", secret };
  }

  if (
    !/^[2-7a-z]+=*$/i.test(normalizedSecret) &&
    /^[0-9a-f]+$/i.test(normalizedSecret) &&
    type === "totp"
  ) {
    type = "hex";
  } else if (
    !/^[2-7a-z]+=*$/i.test(normalizedSecret) &&
    /^[0-9a-f]+$/i.test(normalizedSecret) &&
    type === "hotp"
  ) {
    type = "hhex";
  }

  const hash = crypto.randomUUID();
  const entry: RawOTPStorage = {
    account,
    hash,
    issuer,
    secret: normalizedSecret,
    type,
    encrypted: false,
    index: 0,
    counter,
    pinned: false,
  };
  if (period) {
    entry.period = period;
  }
  if (digits) {
    entry.digits = digits;
  }
  if (algorithm) {
    entry.algorithm = algorithm;
  }

  return { entry };
}

function normalizeSecret(secret: string) {
  let decodedSecret = secret;
  try {
    decodedSecret = decodeURIComponent(secret);
  } catch (error) {
    console.error(error);
  }
  return decodedSecret.replace(/[+\s]/g, "").replace(/=+$/, "").toUpperCase();
}

export async function getEntryDataFromOTPAuthPerLine(importCode: string) {
  const lines = importCode.split("\n");
  const exportData: { [hash: string]: RawOTPStorage } = {};
  let failedCount = 0;
  let succeededCount = 0;
  for (let item of lines) {
    item = item.trim();
    if (item.startsWith("otpauth-migration:")) {
      const migrationData = getOTPAuthPerLineFromOPTAuthMigration(item);
      for (const line of migrationData) {
        lines.push(line);
      }
      continue;
    }
    if (!item.startsWith("otpauth:")) {
      continue;
    }

    const result = parseOTPAuthURI(item);
    if ("error" in result) {
      failedCount++;
      continue;
    }

    exportData[result.entry.hash] = result.entry;
    succeededCount++;
  }

  return { exportData, failedCount, succeededCount };
}
