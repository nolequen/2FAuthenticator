const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

process.chdir(path.resolve(__dirname, ".."));

const PLATFORMS = ["chrome", "firefox", "edge", "test", "prod"];
const WATCH_PLATFORMS = ["chrome", "firefox", "edge"];
const STYLE_FILES = ["src/**/*.{ts,vue}", "sass/*.scss"];
const STATIC_FILES = ["images", "_locales", "LICENSE", "view"];
const BIN = {
  prettier: "node_modules/prettier/bin/prettier.cjs",
  eslint: "node_modules/eslint/bin/eslint.js",
  webpack: "node_modules/webpack-cli/bin/cli.js",
  tsc: "node_modules/typescript/bin/tsc",
  vueTsc: "node_modules/vue-tsc/bin/vue-tsc.js",
  sass: "node_modules/sass/sass.js",
  licenses: "node_modules/npm-license-generator/build/npm-license-generator",
};
const LICENSES_TIMEOUT_SECONDS = 60;
const LICENSES_ATTEMPTS = 4;

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

function warn(text) {
  console.log(color("7;33", text));
}

function fail(text, code = 1) {
  console.error(color("31", text));
  process.exit(code);
}

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5 });
}

function run(bin, args, options = {}) {
  return spawnSync(process.execPath, [BIN[bin], ...args], {
    stdio: "inherit",
    ...options,
  });
}

function runOrExit(bin, args) {
  const result = run(bin, args);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function lint() {
  console.log("Checking style...");
  const result = run("prettier", ["--check", ...STYLE_FILES]);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail("Run `npm run format` to fix code style.", result.status ?? 1);
  }
  runOrExit("eslint", ["."]);
  runOrExit("vueTsc", ["--noEmit", "-p", "tsconfig.json"]);
}

function copyCssExtras(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ["DroidSansMono.woff2", "mocha.css"]) {
    fs.copyFileSync(path.join("sass", file), path.join(dir, file));
  }
}

function compile(platform) {
  console.log("Compiling...");
  if (platform === "prod") {
    runOrExit("webpack", ["--config", "webpack.prod.js"]);
  } else if (platform === "test") {
    runOrExit("webpack", ["--config", "webpack.dev.js"]);
    runOrExit("tsc", [
      "--target",
      "ES2015",
      "--esModuleInterop",
      "--module",
      "nodenext",
      "scripts/test-runner.ts",
    ]);
  } else {
    runOrExit("webpack", []);
  }
  runOrExit("sass", ["sass:css"]);
  copyCssExtras("css");
}

function generateLicenses() {
  console.log("Generating licenses file...");
  const args = [
    "--out-path",
    "./view/licenses.html",
    "--template",
    "./scripts/licenses-template.html",
    "--error-missing=true",
  ];
  for (let attempt = 1; attempt <= LICENSES_ATTEMPTS; attempt++) {
    const result = run("licenses", args, {
      timeout: LICENSES_TIMEOUT_SECONDS * 1000,
    });
    if (result.error?.code !== "ETIMEDOUT") {
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        process.exit(result.status ?? 1);
      }
      return;
    }
    remove(".license-gen-tmp");
    warn(
      `Licenses generation timed out after ${LICENSES_TIMEOUT_SECONDS} seconds (attempt ${attempt} of ${LICENSES_ATTEMPTS})`
    );
  }
  fail("Licenses generation keeps timing out. Check the network and retry.");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function copyManifests(platform, dir, testing) {
  const suffix = testing ? "-testing" : "";
  const manifest = readJson(`manifests/manifest-${platform}${suffix}.json`);
  manifest.version = readJson("package.json").version;
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

function assemble(platform, dir, testing) {
  fs.mkdirSync(dir, { recursive: true });
  for (const item of ["dist", "css", ...STATIC_FILES]) {
    fs.cpSync(item, path.join(dir, item), { recursive: true });
  }
  copyManifests(platform, dir, testing);
}

function build(platform) {
  console.log("Removing old build files...");
  const outDir = platform === "prod" ? "release" : platform;
  for (const target of ["build", "dist", outDir]) {
    remove(target);
  }

  lint();
  compile(platform);

  if (platform === "prod") {
    generateLicenses();
    for (const browser of ["chrome", "firefox", "edge"]) {
      assemble(browser, path.join("release", browser), false);
    }
  } else if (platform === "test") {
    assemble("chrome", path.join("test", "chrome"), true);
  } else {
    assemble(platform, platform, false);
  }

  console.log(color("32", "Done!"));
}

function watch(platform) {
  remove(platform);
  fs.mkdirSync(platform);
  for (const item of STATIC_FILES) {
    fs.cpSync(item, path.join(platform, item), { recursive: true });
  }
  copyManifests(platform, platform, false);
  copyCssExtras(path.join(platform, "css"));

  const children = [
    ["webpack", ["--watch", "--output-path", path.resolve(platform, "dist")]],
    ["sass", ["--watch", `sass:${platform}/css`]],
  ].map(([bin, args]) =>
    spawn(process.execPath, [BIN[bin], ...args], { stdio: "inherit" })
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
    children.forEach((child) => child.kill());
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const child of children) {
    child.on("exit", (code) => {
      if (process.exitCode === undefined) {
        process.exitCode = code ?? (stopping ? 0 : 1);
      }
      stop();
    });
  }
}

const [command, ...flags] = process.argv.slice(2);
const watchMode = flags.includes("--watch");

if (flags.some((flag) => flag !== "--watch")) {
  fail(`Unknown flags: ${flags.join(" ")}. Supported flag is '--watch'`);
} else if (command === "lint" && !watchMode) {
  lint();
} else if (command === "format" && !watchMode) {
  runOrExit("prettier", ["--write", ...STYLE_FILES]);
} else if (watchMode && WATCH_PLATFORMS.includes(command)) {
  watch(command);
} else if (!watchMode && PLATFORMS.includes(command)) {
  build(command);
} else {
  fail(
    `Usage: node scripts/build.js <${PLATFORMS.join(
      "|"
    )}> | <${WATCH_PLATFORMS.join("|")}> --watch | lint | format`
  );
}
