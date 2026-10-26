import { MASK_DIGIT, OTPAlgorithm } from "./models/otp";
import { i18n } from "./store/i18n";

export const ISSUER_COLORS = [
  "#475569",
  "#2457C5",
  "#C2410C",
  "#BE185D",
  "#A16207",
  "#6D3FD1",
  "#0F766E",
  "#15803D",
];

const GROUPS: { [length: number]: number } = { 6: 3, 8: 4 };
const GROUPABLE = new RegExp(`^(\\d+|${MASK_DIGIT}+)$`);

export function formatCode(code: string) {
  const group = GROUPS[code.length];
  if (!group || !GROUPABLE.test(code)) {
    return code;
  }
  return `${code.slice(0, group)} ${code.slice(group)}`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const IPV4 = /^\d+(\.\d+){3}$/;

export function issuerName(issuer: string) {
  return issuer.split("::")[0].trim();
}

export function issuerSite(issuer: string) {
  return (issuer.split("::")[1] ?? "").trim().toLowerCase();
}

export function joinIssuer(name: string, site: string) {
  const issuer = name.replace(/:{2,}/g, ":").trim();
  return site ? `${issuer.replace(/:+$/, "")}::${site}` : issuer;
}

export function normalizeSite(input: string) {
  const value = input.trim();
  if (!value) {
    return "";
  }
  let url: URL;
  try {
    url = new URL(SCHEME.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!host || (!host.includes(".") && host !== "localhost")) {
    return null;
  }
  return host;
}

export function faviconUrl(site: string) {
  if (
    !site.includes(".") ||
    site.endsWith(".localhost") ||
    IPV4.test(site) ||
    normalizeSite(site) !== site
  ) {
    return null;
  }
  return new URL("/favicon.ico", `https://${site}`).href;
}

export function issuerLetter(issuer: string) {
  const [letter] = Array.from(issuerName(issuer));
  return letter ? letter.toLocaleUpperCase() : "?";
}

export function algorithmName(algorithm: OTPAlgorithm) {
  switch (algorithm) {
    case OTPAlgorithm.SHA256:
      return "SHA-256";
    case OTPAlgorithm.SHA512:
      return "SHA-512";
    case OTPAlgorithm.GOST3411_2012_256:
      return i18n.algorithm_gost256;
    case OTPAlgorithm.GOST3411_2012_512:
      return i18n.algorithm_gost512;
    default:
      return "SHA-1";
  }
}

export function issuerColor(issuer: string) {
  let hash = 0;
  for (const char of issuerName(issuer)) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return ISSUER_COLORS[hash % ISSUER_COLORS.length];
}
