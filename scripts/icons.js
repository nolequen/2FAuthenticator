const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

process.chdir(path.resolve(__dirname, ".."));

const ICONS = [
  ["images/icon-small.svg", [16]],
  ["images/icon.svg", [24, 32, 48, 128]],
];

async function render() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  for (const [source, sizes] of ICONS) {
    const svg = fs.readFileSync(source, "utf8");
    for (const size of sizes) {
      await page.setViewport({ width: size, height: size });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
      );
      const file = `images/icon${size}.png`;
      await page.screenshot({ path: file, omitBackground: true });
      console.log(file);
    }
  }
  await browser.close();
}

render().catch((error) => {
  console.error(error);
  process.exit(1);
});
