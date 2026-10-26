const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

process.chdir(path.resolve(__dirname, ".."));

const NAME = "2fauthenticator";
const REPO_URL = "https://github.com/nolequen/2FAuthenticator";
const UPDATE_URL = `${REPO_URL}/releases/latest/download/updates.json`;
const KEY_VARS = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"];
const WEB_EXT = "node_modules/web-ext/bin/web-ext.js";
const FIREFOX_DIR = path.join("release", "firefox");

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

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function treeHash(dir) {
  const hash = crypto.createHash("sha256");
  fs.readdirSync(dir, { recursive: true })
    .map((file) => file.split(path.sep).join("/"))
    .filter(
      (file) =>
        !file.split("/").some((part) => part.startsWith(".")) &&
        fs.statSync(path.join(dir, file)).isFile()
    )
    .sort()
    .forEach((file) =>
      hash.update(`${file}\0${sha256(path.join(dir, file))}\n`)
    );
  return hash.digest("hex");
}

function readZipEntry(file, name) {
  const zip = fs.readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) {
    fail(`${file} is not a ZIP file.`);
  }
  let offset = zip.readUInt32LE(end + 16);
  for (let count = zip.readUInt16LE(end + 10); count > 0; count--) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const entry = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entry === name) {
      const method = zip.readUInt16LE(offset + 10);
      const size = zip.readUInt32LE(offset + 20);
      const local = zip.readUInt32LE(offset + 42);
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    offset +=
      46 +
      nameLength +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
  }
  fail(`${name} not found in ${file}.`);
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

function buildPackages() {
  if (keysInEnv().length > 0) {
    fail(
      "`npm run package` does not need the AMO API key. Remove it from the environment:\nRemove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue"
    );
  }
  const info = { version, commit: headCommit(), clean: isTreeClean() };
  fs.rmSync(buildInfoFile, { force: true });
  fs.rmSync(outDir, { recursive: true, force: true });

  check(runNode("scripts/build.js", ["prod"]));
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

async function submit(info) {
  if (keysInEnv().length < KEY_VARS.length) {
    fail(
      [
        "Set the AMO API key first (addons.mozilla.org > Developer Hub > Manage API Keys):",
        "$env:WEB_EXT_API_KEY = Read-Host 'JWT issuer'",
        "$env:WEB_EXT_API_SECRET = [Net.NetworkCredential]::new('', (Read-Host 'JWT secret' -AsSecureString)).Password",
      ].join("\n")
    );
  }
  if (fs.existsSync(uploadInfoFile)) {
    console.log(
      color(
        "7;33",
        `${version} was already submitted once. If Developer Hub shows this version, download the signed .xpi into ${signedDir} and run \`npm run sign\` again instead of submitting.`
      )
    );
  }
  const answer = await ask(
    `Submit ${version} to AMO? This version number can never be reused. [y/N] `
  );
  if (answer.toLowerCase() !== "y") {
    fail("Cancelled.");
  }

  const sourceArchive = path.join(amoDir, packageName("source.zip"));
  git(["archive", "--format=zip", "-o", sourceArchive, info.commit]);

  const metadataFile = path.join(amoDir, "amo-metadata.json");
  writeJson(metadataFile, {
    version: {
      approval_notes: [
        `The source archive is \`git archive\` of commit ${info.commit} (${REPO_URL}).`,
        "Build on Windows, Linux or macOS with Node.js 24 and npm 11: run `npm ci`, then `npm run prod`.",
        "The submitted package is the folder release/firefox. `npm run prod` needs network access to generate view/licenses.html.",
      ].join("\n"),
    },
  });

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
        "Signing failed. Do NOT run `npm run sign` again right away: AMO may already have this version.",
        `Open Developer Hub. If ${version} is there, upload ${sourceArchive} as its source code if it is missing,`,
        `download the signed .xpi into ${signedDir} and run \`npm run sign\` again to finish packaging.`,
        "If the version is not there, fix the error above and run `npm run sign` again.",
      ].join("\n"),
      result.status || 1
    );
  }
}

async function sign() {
  const { info, gecko } = checkBuild();

  let xpis = signedXpis();
  if (xpis.length === 0) {
    await submit(info);
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
  const signed = JSON.parse(
    readZipEntry(xpis[0], "manifest.json").toString("utf8")
  );
  const signedId = signed.browser_specific_settings?.gecko?.id;
  if (signed.version !== version || signedId !== gecko.id) {
    fail(
      `${xpis[0]} is ${signedId} ${signed.version}, expected ${gecko.id} ${version}. Put the right signed .xpi into ${signedDir}.`
    );
  }

  const xpi = path.join(outDir, PACKAGES[0]);
  fs.copyFileSync(xpis[0], xpi);
  writeJson(path.join(outDir, "updates.json"), {
    addons: {
      [gecko.id]: {
        updates: [
          {
            version,
            update_link: `${REPO_URL}/releases/download/v${version}/${PACKAGES[0]}`,
            update_hash: `sha256:${sha256(xpi)}`,
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
      (file) => `${sha256(path.join(outDir, file))}  ${file}\n`
    ).join("")
  );

  console.log(color("32", `Release files for ${version} are in ${outDir}:`));
  for (const file of fs.readdirSync(outDir)) {
    console.log(`  ${file}`);
  }
  console.log(`Tag this commit: git tag v${version} ${info.commit}`);
}

const [command, ...rest] = process.argv.slice(2);

if (rest.length > 0) {
  fail(`Unknown arguments: ${rest.join(" ")}`);
} else if (command === "package") {
  buildPackages();
} else if (command === "sign") {
  sign().catch((error) => fail(error.stack || String(error)));
} else {
  fail("Usage: node scripts/package.js <package|sign>");
}
