// Runs tests via puppeteer. Do not compile using webpack.

import puppeteer from "puppeteer";
import path from "path";
import { execSync } from "child_process";
import merge from "lodash/merge";

interface MochaTestResults {
  total?: number;
  tests?: StrippedTestResults[];
  completed?: boolean;
}

interface StrippedTestResults {
  title: string;
  duration: number;
  path: string[];
  err?: string;
  status: "failed" | "passed" | "pending";
}

declare global {
  interface Window {
    __mocha_test_results__: MochaTestResults;
  }
}
interface TestDisplay {
  [key: string]: TestDisplay | StrippedTestResults
}

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
}

const MIN_TESTS = 395;

async function runTests() {
  const extensionDir = path.resolve(__dirname, "../test/chrome");
  const puppeteerArgs: string[] = [
    // for CI
    "--no-sandbox",
    "--lang=en-US,en"
  ];

  const browser = await puppeteer.launch({
    enableExtensions: true,
    pipe: true,
    args: puppeteerArgs,
    headless: true,
    executablePath: process.env.PUPPETEER_EXEC_PATH,
  });
  const extensionId = await browser.installExtension(extensionDir);
  const mochaPage = await browser.newPage();
  await mochaPage.goto(`chrome-extension://${extensionId}/view/test.html`);

  // by setting this env var, console logging works for both components and testing
  if (process.env.ENABLE_CONSOLE) {
    mochaPage.on("console", consoleMessage => console.log(consoleMessage.text()));
  }

  const results: {
    testResults: MochaTestResults;
  } = await mochaPage.evaluate(() => {
    return new Promise((resolve: (value: {
    testResults: MochaTestResults;
  }) => void) => {
      window.addEventListener("testsComplete", () => {
        resolve({
          testResults: window.__mocha_test_results__,
        });
      });

      if (window.__mocha_test_results__.completed) {
        resolve({
          testResults: window.__mocha_test_results__,
        });
      }
    });
  });

  let failedTest = false;
  let display: TestDisplay = {};
  if (results?.testResults.tests) {
    for (const test of results.testResults.tests) {
      let tmp: TestDisplay = {};
      test.path.reduce((acc, current, index) => {
        return acc[current] = test.path.length - 1 === index ? test : {}
      }, tmp);
      display = merge(display, tmp);
    }
  }

  const printDisplayTests = (display: TestDisplay | StrippedTestResults) => {
    for (const key in display) {
      if (typeof display[key].status === "string") {
        const test = display[key];
        switch (test.status) {
          case "passed":
            console.log(`${colors.green}✓${colors.reset} ${test.title}`);
            break;
          case "failed":
            console.log(`${colors.red}✗ ${test.title}${colors.reset}`);
            if (test.err) {
              console.log(test.err)
            }
            failedTest = true;
            break;
          case "pending":
            console.log(`- ${test.title}`);
            break;
        }
      } else {
        console.log(key)
        console.group();
        printDisplayTests(display[key]);
      }
    }
    console.groupEnd();
  }
  printDisplayTests(display);

  const tests = results?.testResults.tests ?? [];
  const count = (status: StrippedTestResults["status"]) =>
    tests.filter((test) => test.status === status).length;
  console.log(
    `passed ${count("passed")}, failed ${count("failed")}, pending ${count("pending")}, total ${tests.length}`
  );
  if (tests.length < MIN_TESTS) {
    console.log(
      `${colors.red}Expected at least ${MIN_TESTS} tests, ran ${tests.length}${colors.reset}`
    );
    process.exit(1);
  }
  process.exit(failedTest ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
