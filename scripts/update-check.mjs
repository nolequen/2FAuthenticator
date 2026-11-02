import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { Browser as BidiCoreBrowser } from "puppeteer-core/internal/bidi/core/Browser.js";
import { Browser, computeExecutablePath } from "@puppeteer/browsers";
import zip from "./zip.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEVEDITION_FILE = path.join(ROOT, ".github", "firefox-devedition-version");
const CHROME_ID = "fghognhaimenkmcpmohoogammffofkgn";
const GECKO_ID = "2fauthenticator@nolequen";
const FIREFOX_UUID = "5b1c7a0e-3f4d-4c8a-9e2b-7d6f1a2c3b4e";
const PASSWORD = "update-check-Pa55";
const USAGE =
  "Usage: npm run update-check -- <chrome|firefox> <old package> <new package>\n" +
  "A package is a ZIP or .xpi file or an extension folder.";

const ACCOUNTS = [
  { issuer: "GitHub", account: "alice", secret: "JBSWY3DPEHPK3PXP", digits: 6, pinned: true },
  { issuer: "Google", account: "alice@example.com", secret: "GEZDGNBVGY3TQOJQ", digits: 6 },
  { issuer: "AWS", account: "root", secret: "MFRGGZDFMZTWQ2LK", digits: 8 },
  { issuer: "", account: "plain", secret: "KRSXG5CTMVRXEZLU", digits: 6 },
];

let session;
const installTemporary = BidiCoreBrowser.prototype.installExtension;
BidiCoreBrowser.prototype.installExtension = async function (target) {
  session = this.session;
  if (!target.endsWith(".xpi")) {
    return installTemporary.call(this, target);
  }
  const { result } = await this.session.send("webExtension.install", {
    extensionData: { type: "archivePath", path: target },
    "moz:permanent": true,
  });
  return result.extension;
};

function fail(text) {
  console.error(text);
  process.exit(2);
}

function entries() {
  const data = {};
  ACCOUNTS.forEach((item, index) => {
    const hash = crypto.randomUUID();
    data[hash] = {
      encrypted: false,
      hash,
      index,
      issuer: item.issuer,
      account: item.account,
      secret: item.secret,
      type: "totp",
      counter: 0,
      period: 30,
      digits: item.digits,
      algorithm: "SHA1",
      pinned: !!item.pinned,
    };
  });
  return data;
}

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of text) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, digits, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(value).padStart(digits, "0");
}

function expectedCodes() {
  const step = Math.floor(Date.now() / 30000);
  return [step - 1, step, step + 1].map((s) =>
    ACCOUNTS.map((item) => totp(item.secret, item.digits, s)),
  );
}

let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
  if (!ok) {
    failed++;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(page, label) {
  page.on("pageerror", (error) =>
    check(`${label}: no page errors`, false, error.message.slice(0, 300)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      check(`${label}: no console errors`, false, message.text().slice(0, 300));
    }
  });
}

async function waitForPage(page, url) {
  await page
    .waitForFunction(
      (target) => location.href === target && document.readyState === "complete",
      { timeout: 20000 },
      url,
    )
    .catch(async () => {
      const state = await page
        .evaluate(() => location.href + " " + document.readyState)
        .catch((error) => error.message);
      throw new Error("page did not open: " + state);
    });
}

function chromePage(browser, base) {
  return async (label) => {
    const url = `${base}view/popup.html`;
    const page = await browser.newPage();
    watch(page, label);
    await page.goto(url, { timeout: 5000 }).catch(() => {});
    await waitForPage(page, url);
    return page;
  };
}

function firefoxPage(browser, base) {
  return async (label) => {
    const url = `${base}view/popup.html`;
    const known = new Set(await browser.pages());
    const { result } = await session.send("browsingContext.getTree", { "moz:scope": "chrome" });
    await session.send("script.evaluate", {
      expression: `gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); true`,
      target: { context: result.contexts[0].context },
      awaitPromise: false,
    });
    let page;
    for (let i = 0; i < 40 && !page; i++) {
      await sleep(250);
      page = (await browser.pages()).find((candidate) => !known.has(candidate));
    }
    if (!page) {
      throw new Error("extension tab did not open");
    }
    watch(page, label);
    await waitForPage(page, url);
    return page;
  };
}

async function readCodes(page) {
  await page
    .waitForFunction(
      (count) => {
        const codes = [...document.querySelectorAll(".entry .code")].map((el) =>
          el.textContent.replace(/\D/g, ""),
        );
        return codes.length === count && codes.every((code) => code.length >= 6);
      },
      { timeout: 20000 },
      ACCOUNTS.length,
    )
    .catch(async () => {
      const state = await page
        .evaluate(
          () =>
            location.href +
            " | " +
            document.readyState +
            " | " +
            document.body?.innerText.replace(/\s+/g, " ").slice(0, 300),
        )
        .catch((error) => "evaluate failed: " + error.message);
      throw new Error("codes did not appear: " + state);
    });
  return page.$$eval(".entry .code", (elements) =>
    elements.map((el) => el.textContent.replace(/\D/g, "")),
  );
}

async function readEntryTexts(page) {
  return page.$$eval(".entry", (elements) =>
    elements.map((el) => el.textContent.replace(/\s+/g, " ").trim()),
  );
}

function codesMatch(codes) {
  const sorted = [...codes].sort().join(",");
  return expectedCodes().some((set) => [...set].sort().join(",") === sorted);
}

function readStorage(page) {
  return page.evaluate(async () => ({
    ...(await chrome.storage.local.get()),
    ...(await chrome.storage.sync.get()),
  }));
}

async function storedEntries(page) {
  return page.evaluate(async () => {
    const all = { ...(await chrome.storage.local.get()), ...(await chrome.storage.sync.get()) };
    return Object.values(all)
      .filter((value) => value && typeof value === "object" && ("encrypted" in value || value.dataType === "EncOTPStorage"))
      .map((value) => ({
        encrypted: value.dataType === "EncOTPStorage",
        data: typeof value.data === "string" ? value.data.slice(0, 3) : null,
      }));
  });
}

async function setPasswordOld(page, oldVersion) {
  await page.click("#i-menu");
  await page.waitForSelector(".page .row", { visible: true });
  const rows = await page.$$(".page .row");
  await rows[1].click();
  await page.waitForSelector("#security-save", { visible: true });
  const visible = [];
  for (const input of await page.$$(".password-form input[type=password]")) {
    if (await input.isVisible()) {
      visible.push(input);
    }
  }
  check(`${oldVersion}: password form has two visible fields`, visible.length === 2, String(visible.length));
  await visible[0].type(PASSWORD);
  await visible[1].type(PASSWORD);
  await page.click("#security-save");
  await page.waitForFunction(
    async (count) => {
      const all = { ...(await chrome.storage.local.get()), ...(await chrome.storage.sync.get()) };
      const list = Object.values(all).filter(
        (value) => value && typeof value === "object" && ("encrypted" in value || value.dataType === "EncOTPStorage"),
      );
      return list.length === count && list.every((value) => value.dataType === "EncOTPStorage");
    },
    { timeout: 60000, polling: 500 },
    ACCOUNTS.length,
  );
}

async function openVersion(openPage, label, version) {
  const page = await openPage(label);
  await page
    .waitForFunction((expected) => chrome.runtime.getManifest().version === expected, { timeout: 20000 }, version)
    .catch(() => {});
  return page;
}

async function scenario({ label, openPage, withPassword, oldVersion, newVersion, upgrade }) {
  let page = await openPage(`${label} ${oldVersion}`);
  const installed = await page.evaluate(() => chrome.runtime.getManifest().version);
  check(`${label}: old version installed`, installed === oldVersion, installed);
  await page.waitForFunction(
    async () => !!(await chrome.storage.local.get("UserSettings")).UserSettings?.storageLocation,
    { timeout: 20000, polling: 250 },
  );
  const area = await page.evaluate(async (data) => {
    const settings = (await chrome.storage.local.get("UserSettings")).UserSettings ?? {};
    const name = settings.storageLocation === "sync" ? "sync" : "local";
    await chrome.storage[name].set(data);
    return name;
  }, entries());
  check(`${label}: accounts seeded`, true, `storage.${area}`);
  await page.close();
  page = await openPage(`${label} ${oldVersion}`);
  const oldCodes = await readCodes(page);
  check(`${label}: ${oldVersion} shows correct codes`, codesMatch(oldCodes), oldCodes.join(" "));
  if (withPassword) {
    await setPasswordOld(page, oldVersion);
    const stored = await storedEntries(page);
    check(
      `${label}: ${oldVersion} encrypted entries as v4`,
      stored.every((item) => item.encrypted && item.data === "v4:"),
      JSON.stringify(stored.map((item) => item.data)),
    );
  }
  const before = await readStorage(page);
  await page.close();

  await upgrade();

  page = await openVersion(openPage, `${label} ${newVersion}`, newVersion);
  const updated = await page.evaluate(() => chrome.runtime.getManifest().version);
  check(`${label}: updated to ${newVersion}`, updated === newVersion, updated);
  const after = await readStorage(page);
  check(
    `${label}: storage kept after update`,
    JSON.stringify(Object.keys(before).sort()) === JSON.stringify(Object.keys(after).sort()),
    `${Object.keys(before).length} -> ${Object.keys(after).length} keys`,
  );
  if (withPassword) {
    const field = ".lock-screen input[type=password]";
    await page.waitForSelector(field, { visible: true, timeout: 20000 });
    check(`${label}: ${newVersion} asks for the password`, true);
    await page.type(field, "wrong-password");
    await page.keyboard.press("Enter");
    const rejected = await page
      .waitForSelector(".lock-screen .field-error", { visible: true, timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    check(
      `${label}: wrong password keeps the lock screen`,
      rejected &&
        (await page.$$eval(".entry .code", (els) => els.filter((el) => /\d{3}/.test(el.textContent)).length)) === 0,
      await page.$eval(".lock-screen", (el) => el.innerText.replace(/\s+/g, " ")),
    );
    await page.click(field, { count: 3 });
    await page.keyboard.press("Backspace");
    await page.type(field, PASSWORD);
    await page.keyboard.press("Enter");
  }
  const newCodes = await readCodes(page);
  const headers = await page.$$eval(".section-header", (elements) => elements.length);
  check(`${label}: ${newVersion} shows no group headers for accounts without groups`, headers === 0, String(headers));
  check(`${label}: ${newVersion} shows correct codes`, codesMatch(newCodes), newCodes.join(" "));
  const texts = await readEntryTexts(page);
  check(
    `${label}: ${newVersion} shows all accounts`,
    ACCOUNTS.every((item) => texts.some((text) => text.includes(item.account))),
    texts.join(" | "),
  );
  check(
    `${label}: pinned account stays first`,
    texts[0]?.includes("alice") && texts[0]?.includes("GitHub"),
    texts[0],
  );
  if (withPassword) {
    const stored = await storedEntries(page);
    check(
      `${label}: entries stay encrypted after unlock`,
      stored.length === ACCOUNTS.length && stored.every((item) => item.encrypted),
      JSON.stringify(stored.map((item) => item.data)),
    );
  }
  const drive = await page.evaluate(async () => ({
    record: "GoogleDrive" in (await chrome.storage.local.get("GoogleDrive")),
    alarms: (await chrome.alarms.getAll()).map((alarm) => alarm.name).filter((name) => name.startsWith("drive")),
    banner: [...document.querySelectorAll(".reminder")].some((el) => /Drive|Google/.test(el.innerText)),
    permissions: (await chrome.permissions.getAll()).permissions ?? [],
    origins: (await chrome.permissions.getAll()).origins ?? [],
  }));
  check(
    `${label}: update leaves Google Drive disconnected and idle`,
    !drive.record && drive.alarms.length === 0 && !drive.banner,
    JSON.stringify(drive),
  );
  check(`${label}: ${newVersion} has the identity permission`, drive.permissions.includes("identity"), drive.permissions.join(","));
  check(`${label}: ${newVersion} has no loopback access until asked`, !drive.origins.some((origin) => origin.includes("127.0.0.1")), drive.origins.join(","));
  await page.click("#i-menu");
  await page.waitForSelector(".page .row", { visible: true });
  const rows = await page.$$eval(".page .row", (elements) => elements.map((el) => el.textContent.trim()));
  const backupRow = rows.findIndex((text) => /backup/i.test(text));
  await (await page.$$(".page .row"))[backupRow].click();
  await page
    .waitForFunction(() => document.querySelector(".section-title") && document.body.innerText.includes("Google Drive"), { timeout: 10000 })
    .catch(() => {});
  const section = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  check(`${label}: backup page offers to connect Google Drive`, /Connect Google Drive/.test(section), section.slice(-300));
  await page.close();
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function isFolder(source) {
  return fs.statSync(source).isDirectory();
}

function readManifest(source) {
  const text = isFolder(source)
    ? fs.readFileSync(path.join(source, "manifest.json"), "utf8")
    : zip.readEntry(source, "manifest.json").toString("utf8");
  return JSON.parse(text);
}

function manifestWithVersion(data, version) {
  const manifest = JSON.parse(data.toString("utf8"));
  manifest.version = version;
  return Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
}

function folderEntries(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((file) => file.split(path.sep).join("/"))
    .filter(
      (file) =>
        !file.split("/").some((part) => part.startsWith(".")) &&
        fs.statSync(path.join(dir, file)).isFile(),
    )
    .sort()
    .map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }));
}

function unpack(source, dir, version) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (isFolder(source)) {
    fs.cpSync(source, dir, { recursive: true });
  } else {
    zip.extract(source, dir);
  }
  const manifest = path.join(dir, "manifest.json");
  fs.writeFileSync(manifest, manifestWithVersion(fs.readFileSync(manifest), version));
}

function xpi(source, file, version) {
  if (!isFolder(source) && readManifest(source).version === version) {
    return path.resolve(source);
  }
  const files = isFolder(source) ? folderEntries(source) : zip.readEntries(source);
  zip.write(
    file,
    files
      .filter((entry) => !entry.name.startsWith("META-INF/"))
      .map((entry) =>
        entry.name === "manifest.json"
          ? { name: entry.name, data: manifestWithVersion(entry.data, version) }
          : entry,
      ),
  );
  return path.resolve(file);
}

function firefoxExecutable() {
  if (process.env.UPDATE_CHECK_FIREFOX) {
    return process.env.UPDATE_CHECK_FIREFOX;
  }
  const buildId = `devedition_${fs.readFileSync(DEVEDITION_FILE, "utf8").trim()}`;
  const cacheDir = process.env.PUPPETEER_CACHE_DIR ?? path.join(os.homedir(), ".cache", "puppeteer");
  const executable = computeExecutablePath({ browser: Browser.FIREFOX, buildId, cacheDir });
  if (!fs.existsSync(executable)) {
    fail(
      `Firefox Developer Edition is not installed: ${executable} not found.\n` +
        `Install it with \`npx puppeteer browsers install firefox@${buildId}\` or set UPDATE_CHECK_FIREFOX.`,
    );
  }
  return executable;
}

async function checkChrome({ work, oldPackage, newPackage, oldVersion, newVersion, withPassword, suffix }) {
  const label = `chrome ${suffix}`;
  const dir = path.join(work, `chrome-${withPassword}`);
  const extDir = path.join(dir, "ext");
  unpack(oldPackage, extDir, oldVersion);
  const browser = await puppeteer.launch({
    enableExtensions: true,
    pipe: true,
    headless: true,
    userDataDir: path.join(dir, "profile"),
    args: ["--no-sandbox", "--lang=en"],
  });
  try {
    const id = await browser.installExtension(extDir);
    check(`${label}: extension id`, id === CHROME_ID, id);
    await scenario({
      label,
      openPage: chromePage(browser, `chrome-extension://${id}/`),
      withPassword,
      oldVersion,
      newVersion,
      upgrade: async () => {
        unpack(newPackage, extDir, newVersion);
        const reloaded = await browser.installExtension(extDir);
        check(`${label}: ${newVersion} reloaded with the same id`, reloaded === CHROME_ID, reloaded);
      },
    });
  } catch (error) {
    check(`${label}: scenario finished`, false, error.stack?.slice(0, 500));
  } finally {
    await browser.close();
  }
}

async function checkFirefox({ executablePath, oldXpi, newXpi, oldVersion, newVersion, withPassword, suffix }) {
  const label = `firefox ${suffix}`;
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath,
    headless: true,
    args: ["--remote-allow-system-access"],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: FIREFOX_UUID }),
      "intl.locale.requested": "en-US",
      "xpinstall.signatures.required": false,
    },
  });
  try {
    const id = await browser.installExtension(oldXpi);
    check(`${label}: extension id`, id === GECKO_ID, id);
    await scenario({
      label,
      openPage: firefoxPage(browser, `moz-extension://${FIREFOX_UUID}/`),
      withPassword,
      oldVersion,
      newVersion,
      upgrade: async () => {
        const updated = await browser.installExtension(newXpi);
        check(`${label}: ${newVersion} installed over ${oldVersion}`, updated === GECKO_ID, updated);
      },
    });
  } catch (error) {
    check(`${label}: scenario finished`, false, error.stack?.slice(0, 500));
  } finally {
    await browser.close();
  }
}

const [browserName, oldPackage, newPackage, ...extra] = process.argv.slice(2);
if (!["chrome", "firefox"].includes(browserName) || !newPackage || extra.length > 0) {
  fail(USAGE);
}
for (const source of [oldPackage, newPackage]) {
  if (!fs.existsSync(source)) {
    fail(`${source} not found.\n${USAGE}`);
  }
}
const oldVersion = readManifest(oldPackage).version;
let newVersion = readManifest(newPackage).version;
const order = compareVersions(newVersion, oldVersion);
if (order < 0) {
  fail(`The new package ${newVersion} is older than the old one ${oldVersion}.`);
}
if (order === 0) {
  newVersion = `${newVersion}.1`;
  console.log(`Both packages are ${oldVersion}: the new one is installed as ${newVersion}.`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "2fa-update-"));
try {
  const firefox =
    browserName === "firefox"
      ? {
          executablePath: firefoxExecutable(),
          oldXpi: xpi(oldPackage, path.join(work, "old.xpi"), oldVersion),
          newXpi: xpi(newPackage, path.join(work, "new.xpi"), newVersion),
        }
      : {};
  for (const withPassword of [false, true]) {
    const options = {
      work,
      oldPackage,
      newPackage,
      oldVersion,
      newVersion,
      withPassword,
      suffix: withPassword ? "with password" : "without password",
      ...firefox,
    };
    if (browserName === "chrome") {
      await checkChrome(options);
    } else {
      await checkFirefox(options);
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
