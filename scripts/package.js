const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { isDeepStrictEqual } = require("util");
const { spawnSync } = require("child_process");
const zip = require("./zip.js");

process.chdir(path.resolve(__dirname, ".."));

const NAME = "2fauthenticator";
const REPO_URL = "https://github.com/nolequen/2FAuthenticator";
const UPDATE_URL = `${REPO_URL}/releases/latest/download/updates.json`;
const AMO_API = "https://addons.mozilla.org/api/v5/addons/";
const AMO_SIGNING_TIMEOUT_MINUTES = 15;
const AMO_POLL_SECONDS = 10;
const KEY_VARS = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"];
const SIGN_FLAGS = ["--yes", "--dry-run"];
const WEB_EXT = "node_modules/web-ext/bin/web-ext.js";
const FIREFOX_DIR = path.join("release", "firefox");
const DRIVE_SECRET_FILE = path.join("secrets", "google-oauth.json");
const IN_CI = process.env.CI === "true";

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

function fail(text, code = 1) {
  console.error(color("31", text));
  process.exit(code);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const version = readJson("package.json").version;
const outDir = path.join("artifacts", version);
const amoDir = path.join("artifacts", `${version}-amo`);
const signedDir = path.join(amoDir, "signed");
const buildInfoFile = path.join(amoDir, "build-info.json");
const uploadInfoFile = path.join(signedDir, "build-info.json");
const sourceArchive = path.join(amoDir, `${NAME}-${version}-source.zip`);
const metadataFile = path.join(amoDir, "amo-metadata.json");
const packageName = (suffix) => `${NAME}-${version}-${suffix}`;
const PACKAGES = ["firefox.xpi", "chrome.zip", "edge.zip"].map(packageName);

function keysInEnv() {
  return Object.keys(process.env).filter(
    (name) => KEY_VARS.includes(name.toUpperCase()) && process.env[name]
  );
}

function envWithoutKeys() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !KEY_VARS.includes(name.toUpperCase())
    )
  );
}

function check(result) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

function runNode(script, args, env = envWithoutKeys()) {
  return spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env,
  });
}

function git(args) {
  return check(
    spawnSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      env: envWithoutKeys(),
    })
  ).stdout.trim();
}

function headCommit() {
  return git(["rev-parse", "HEAD"]);
}

function isTreeClean() {
  return git(["status", "--porcelain"]) === "";
}

function isHeadInMain() {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], {
      stdio: "ignore",
      env: envWithoutKeys(),
    }).status === 0
  );
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function treeFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((file) => file.split(path.sep).join("/"))
    .filter(
      (file) =>
        !file.split("/").some((part) => part.startsWith(".")) &&
        fs.statSync(path.join(dir, file)).isFile()
    )
    .sort();
}

function treeHash(dir) {
  const hash = crypto.createHash("sha256");
  for (const file of treeFiles(dir)) {
    hash.update(`${file}\0${sha256(fs.readFileSync(path.join(dir, file)))}\n`);
  }
  return hash.digest("hex");
}

function differencesFromBuild(xpi) {
  const signed = new Map(
    zip
      .readEntries(xpi)
      .filter((entry) => !entry.name.startsWith("META-INF/"))
      .map((entry) => [entry.name, entry.data])
  );
  const differences = [];
  for (const file of treeFiles(FIREFOX_DIR)) {
    const built = fs.readFileSync(path.join(FIREFOX_DIR, file));
    const data = signed.get(file);
    signed.delete(file);
    if (!data) {
      differences.push(`${file}: missing from the signed .xpi`);
    } else if (
      file === "manifest.json"
        ? !isDeepStrictEqual(JSON.parse(built), JSON.parse(data))
        : !built.equals(data)
    ) {
      differences.push(`${file}: differs`);
    }
  }
  for (const file of signed.keys()) {
    differences.push(`${file}: not in ${FIREFOX_DIR}`);
  }
  return differences;
}

function checkSigned(xpi, gecko) {
  const signed = JSON.parse(zip.readEntry(xpi, "manifest.json").toString("utf8"));
  const signedId = signed.browser_specific_settings?.gecko?.id;
  if (signed.version !== version || signedId !== gecko.id) {
    fail(
      `${xpi} is ${signedId} ${signed.version}, expected ${gecko.id} ${version}. Put the right signed .xpi into ${signedDir}.`
    );
  }
  const differences = differencesFromBuild(xpi);
  if (differences.length > 0) {
    fail(
      [
        `${xpi} does not match ${FIREFOX_DIR}:`,
        ...differences.map((line) => `  ${line}`),
        "Find out where this file comes from before anything else: it is not the build that was checked.",
      ].join("\n")
    );
  }
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

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on("SIGINT", () => rl.close());
    rl.on("close", () => resolve(""));
    rl.question(question, (answer) => {
      resolve(answer.trim());
      rl.close();
    });
  });
}

function buildEnv() {
  const env = envWithoutKeys();
  if (env.DRIVE_DESKTOP_SECRET === "") {
    delete env.DRIVE_DESKTOP_SECRET;
  }
  if (!env.DRIVE_DESKTOP_SECRET && !fs.existsSync(DRIVE_SECRET_FILE)) {
    const text = `Neither DRIVE_DESKTOP_SECRET nor ${DRIVE_SECRET_FILE} is set: Google Drive backups will not work in the Firefox package.`;
    if (IN_CI) {
      fail(text);
    }
    console.log(color("7;33", text));
  }
  return env;
}

function buildPackages() {
  if (keysInEnv().length > 0) {
    fail(
      "`npm run package` does not need the AMO API key. Remove it from the environment:\nRemove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue"
    );
  }
  const info = { version, commit: headCommit(), clean: isTreeClean() };
  fs.rmSync(buildInfoFile, { force: true });
  fs.rmSync(outDir, { recursive: true, force: true });

  check(runNode("scripts/build.js", ["prod"], buildEnv()));
  check(
    runNode(WEB_EXT, ["lint", "--source-dir", FIREFOX_DIR, "--self-hosted"])
  );

  for (const browser of ["chrome", "edge"]) {
    check(
      runNode(WEB_EXT, [
        "build",
        "--source-dir",
        path.join("release", browser),
        "--artifacts-dir",
        outDir,
        "--filename",
        packageName(`${browser}.zip`),
        "--overwrite-dest",
      ])
    );
  }

  info.firefox = treeHash(FIREFOX_DIR);
  fs.mkdirSync(amoDir, { recursive: true });
  writeJson(buildInfoFile, info);

  if (!info.clean) {
    console.log(
      color(
        "7;33",
        "The working tree has uncommitted changes: commit them and run `npm run package` again before `npm run sign`."
      )
    );
  }
  console.log(`${FIREFOX_DIR} tree hash: ${info.firefox}`);
  console.log(color("32", `Packages for ${version} are in ${outDir}`));
}

function checkBuild() {
  if (!fs.existsSync(buildInfoFile)) {
    fail(`${buildInfoFile} not found. Run \`npm run package\` first.`);
  }
  const info = readJson(buildInfoFile);
  if (info.version !== version) {
    fail(
      `release/ was built as ${info.version}, package.json says ${version}. Run \`npm run package\` again.`
    );
  }
  if (!info.clean) {
    fail(
      "release/ was built from a working tree with uncommitted changes. Commit them and run `npm run package` again."
    );
  }
  if (info.commit !== headCommit()) {
    fail(
      `release/ was built from ${info.commit}, but HEAD has moved. Run \`npm run package\` again.`
    );
  }
  if (!isTreeClean()) {
    fail(
      "The working tree has uncommitted changes. Commit or revert them: the source archive for AMO is made from HEAD."
    );
  }
  for (const file of PACKAGES.slice(1)) {
    if (!fs.existsSync(path.join(outDir, file))) {
      fail(`${path.join(outDir, file)} not found. Run \`npm run package\`.`);
    }
  }
  if (treeHash(FIREFOX_DIR) !== info.firefox) {
    fail(`${FIREFOX_DIR} has changed since \`npm run package\`. Run it again.`);
  }
  const manifest = readJson(path.join(FIREFOX_DIR, "manifest.json"));
  const gecko = manifest.browser_specific_settings.gecko;
  if (manifest.version !== version || gecko.update_url !== UPDATE_URL) {
    fail(
      `${FIREFOX_DIR}/manifest.json must have version ${version} and update_url ${UPDATE_URL}.`
    );
  }
  return { info, gecko };
}

function signedXpis() {
  if (!fs.existsSync(signedDir)) {
    return [];
  }
  return fs
    .readdirSync(signedDir)
    .filter((file) => file.endsWith(".xpi"))
    .map((file) => path.join(signedDir, file));
}

function requireKeys() {
  if (keysInEnv().length < KEY_VARS.length) {
    fail(
      [
        "Set the AMO API key first (addons.mozilla.org > Developer Hub > Manage API Keys):",
        "$env:WEB_EXT_API_KEY = Read-Host 'JWT issuer'",
        "$env:WEB_EXT_API_SECRET = [Net.NetworkCredential]::new('', (Read-Host 'JWT secret' -AsSecureString)).Password",
      ].join("\n")
    );
  }
}

let amoAuth;

async function amo(url, options = {}) {
  if (!amoAuth) {
    const { JwtApiAuth } = await import("web-ext/util/submit-addon");
    amoAuth = new JwtApiAuth({
      apiKey: process.env.WEB_EXT_API_KEY,
      apiSecret: process.env.WEB_EXT_API_SECRET,
    });
  }
  return fetch(new URL(url, AMO_API), {
    ...options,
    headers: {
      Authorization: await amoAuth.getAuthHeader(),
      Accept: "application/json",
    },
  });
}

async function amoJson(url) {
  const response = await amo(url);
  if (response.status === 404) {
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AMO ${url}: ${response.status} ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function amoDownload(url, file) {
  const response = await amo(url);
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed: ${response.status}`);
  }
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

function versionsUrl(gecko) {
  return `addon/${gecko.id}/versions/`;
}

async function amoVersions(gecko) {
  const list = await amoJson(`${versionsUrl(gecko)}?filter=all_with_unlisted`);
  return list?.results ?? [];
}

async function findVersion(gecko, wanted) {
  const found =
    (await amoVersions(gecko)).find((item) => item.version === wanted) ??
    (await amoJson(`${versionsUrl(gecko)}v${wanted}/`));
  return found && amoJson(`${versionsUrl(gecko)}${found.id}/`);
}

async function waitForSigning(gecko, id) {
  const deadline = Date.now() + AMO_SIGNING_TIMEOUT_MINUTES * 60 * 1000;
  for (;;) {
    const detail = await amoJson(`${versionsUrl(gecko)}${id}/`);
    const status = detail?.file?.status;
    if (status === "public") {
      return detail;
    }
    if (status === "disabled") {
      fail(`AMO disabled the file of ${version}. Open Developer Hub to see why.`);
    }
    if (Date.now() > deadline) {
      fail(
        `AMO has not signed ${version} in ${AMO_SIGNING_TIMEOUT_MINUTES} minutes. Run \`npm run sign\` again later.`
      );
    }
    console.log(`Waiting for AMO to sign ${version} (file status: ${status})`);
    await new Promise((resolve) => setTimeout(resolve, AMO_POLL_SECONDS * 1000));
  }
}

async function uploadSource(gecko, id) {
  const form = new FormData();
  form.set(
    "source",
    new File([fs.readFileSync(sourceArchive)], path.basename(sourceArchive))
  );
  const response = await amo(`${versionsUrl(gecko)}${id}/`, {
    method: "PATCH",
    body: form,
  });
  if (!response.ok) {
    throw new Error(
      `Uploading the source code to AMO failed: ${response.status} ${(
        await response.text()
      ).slice(0, 500)}`
    );
  }
}

function prepareSubmission(info) {
  git(["archive", "--format=zip", "-o", sourceArchive, info.commit]);
  writeJson(metadataFile, {
    version: {
      approval_notes: [
        `The source archive is \`git archive\` of commit ${info.commit} (${REPO_URL}).`,
        "Build on Windows, Linux or macOS with Node.js 24 and npm 11: run `npm ci`, then `npm run prod`.",
        "The submitted package is the folder release/firefox. `npm run prod` needs network access to generate view/licenses.html.",
      ].join("\n"),
    },
  });
}

async function finishExisting(existing, gecko, info) {
  console.log(`AMO already has ${version}: finishing it instead of submitting.`);
  const signed = await waitForSigning(gecko, existing.id);
  const url = new URL(signed.file.url);
  const xpi = path.join(signedDir, path.basename(url.pathname));
  const download = `${xpi}.download`;
  fs.mkdirSync(signedDir, { recursive: true });
  await amoDownload(url, download);
  checkSigned(download, gecko);
  if (!("source" in signed)) {
    console.log(
      color(
        "7;33",
        `AMO does not say whether ${version} has its source code. Check it in Developer Hub; the archive is ${sourceArchive}.`
      )
    );
  } else if (!signed.source) {
    console.log(`Uploading ${sourceArchive} as the source code of ${version}`);
    await uploadSource(gecko, existing.id);
  }
  writeJson(uploadInfoFile, info);
  fs.renameSync(download, xpi);
}

async function submit(info, yes) {
  if (!yes) {
    const answer = await ask(
      `Submit ${version} to AMO? This version number can never be reused. [y/N] `
    );
    if (answer.toLowerCase() !== "y") {
      fail("Cancelled.");
    }
  }

  fs.mkdirSync(signedDir, { recursive: true });
  writeJson(uploadInfoFile, info);

  const result = runNode(
    WEB_EXT,
    [
      "sign",
      "--channel=unlisted",
      "--source-dir",
      FIREFOX_DIR,
      "--upload-source-code",
      sourceArchive,
      "--amo-metadata",
      metadataFile,
      "--artifacts-dir",
      signedDir,
    ],
    process.env
  );
  if (result.error || result.status !== 0) {
    fail(
      [
        "Signing failed. Running `npm run sign` again is safe: it looks the version up in AMO first and never submits it twice.",
        `If it keeps failing and Developer Hub shows ${version}: upload ${sourceArchive} as its source code if it is missing,`,
        `download the signed .xpi into ${signedDir} and run \`npm run sign\` again to finish packaging.`,
      ].join("\n"),
      result.status || 1
    );
  }
}

async function dryRun(gecko) {
  requireKeys();
  const latest = (await amoVersions(gecko)).reduce(
    (newest, item) =>
      !newest || compareVersions(item.version, newest.version) > 0
        ? item
        : newest,
    null
  );
  if (!latest) {
    fail(`AMO lists no versions of ${gecko.id}.`);
  }
  const found = await findVersion(gecko, latest.version);
  const direct = await amoJson(`${versionsUrl(gecko)}v${latest.version}/`);
  const problems = [];
  if (found?.id !== latest.id) {
    problems.push(`the version list does not find ${latest.version}`);
  }
  if (direct?.id !== latest.id) {
    problems.push(
      `versions/v${latest.version}/ does not find ${latest.version}`
    );
  }
  if (!found?.source) {
    problems.push(`AMO does not report the source code of ${latest.version}`);
  }
  if (found?.file?.status !== "public") {
    problems.push(`the file of ${latest.version} is ${found?.file?.status}`);
  }
  if (problems.length > 0) {
    fail(`Dry run: ${problems.join("; ")}.`);
  }

  const name = `${NAME}-${latest.version}-firefox.xpi`;
  const response = await fetch(
    `${REPO_URL}/releases/download/v${latest.version}/${name}`
  );
  if (!response.ok) {
    fail(`Downloading ${name} from the GitHub release failed: ${response.status}`);
  }
  const fromGitHub = sha256(Buffer.from(await response.arrayBuffer()));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "2fa-amo-"));
  try {
    await amoDownload(found.file.url, path.join(dir, name));
    const fromAmo = sha256(fs.readFileSync(path.join(dir, name)));
    if (fromAmo !== fromGitHub) {
      fail(
        `Dry run: ${name} from AMO (${fromAmo}) differs from the GitHub release (${fromGitHub}).`
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    color(
      "32",
      `Dry run passed: AMO finds ${latest.version} both ways, has its source code, and its signed file matches the GitHub release (sha256 ${fromGitHub}, AMO reports ${found.file.hash}). Nothing was submitted.`
    )
  );
}

async function sign({ yes, dryRun: dry }) {
  const { info, gecko } = checkBuild();
  if (!dry && !IN_CI && !isHeadInMain()) {
    fail(
      "HEAD is not in origin/main. Sign only the commit the release PR left in main: run `git fetch origin` and check that commit out in a worktree."
    );
  }
  if (dry) {
    prepareSubmission(info);
    await dryRun(gecko);
    return;
  }

  let xpis = signedXpis();
  if (xpis.length === 0) {
    requireKeys();
    prepareSubmission(info);
    const existing = await findVersion(gecko, version);
    if (existing) {
      await finishExisting(existing, gecko, info);
    } else {
      await submit(info, yes);
    }
    xpis = signedXpis();
  } else {
    const uploaded = fs.existsSync(uploadInfoFile)
      ? readJson(uploadInfoFile)
      : {};
    if (uploaded.commit !== info.commit || uploaded.version !== version) {
      fail(
        `${signedDir} holds a .xpi signed from another commit. AMO does not accept ${version} twice: bump the version.`
      );
    }
    console.log(`Using the already signed ${xpis.join(", ")}`);
  }
  if (xpis.length !== 1) {
    fail(`Expected one signed .xpi in ${signedDir}, found ${xpis.length}.`);
  }
  checkSigned(xpis[0], gecko);

  const xpi = path.join(outDir, PACKAGES[0]);
  fs.copyFileSync(xpis[0], xpi);
  writeJson(path.join(outDir, "updates.json"), {
    addons: {
      [gecko.id]: {
        updates: [
          {
            version,
            update_link: `${REPO_URL}/releases/download/v${version}/${PACKAGES[0]}`,
            update_hash: `sha256:${sha256(fs.readFileSync(xpi))}`,
            applications: {
              gecko: { strict_min_version: gecko.strict_min_version },
            },
          },
        ],
      },
    },
  });
  fs.writeFileSync(
    path.join(outDir, "SHA256SUMS.txt"),
    PACKAGES.map(
      (file) =>
        `${sha256(fs.readFileSync(path.join(outDir, file)))}  ${file}\n`
    ).join("")
  );

  console.log(color("32", `Release files for ${version} are in ${outDir}:`));
  for (const file of fs.readdirSync(outDir)) {
    console.log(`  ${file}`);
  }
  console.log(`Tag this commit: git tag -a v${version} ${info.commit}`);
}

const [command, ...flags] = process.argv.slice(2);

if (command === "package" && flags.length === 0) {
  buildPackages();
} else if (
  command === "sign" &&
  flags.every((flag) => SIGN_FLAGS.includes(flag))
) {
  sign({
    yes: flags.includes("--yes"),
    dryRun: flags.includes("--dry-run"),
  }).catch((error) => fail(error.stack || String(error)));
} else {
  fail("Usage: node scripts/package.js package | sign [--yes] [--dry-run]");
}
