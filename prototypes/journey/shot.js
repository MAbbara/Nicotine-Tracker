/* Screenshot + smoke-test script for the Journey page prototype. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const url = "http://127.0.0.1:8613/prototypes/journey/";
  const errors = [];
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  desktop.on("pageerror", (err) => errors.push(String(err)));
  desktop.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await desktop.goto(url, { waitUntil: "networkidle" });
  await desktop.waitForSelector(".app-topbar", { timeout: 5000 });
  await desktop.waitForTimeout(1400); // let entrance motion finish
  await desktop.screenshot({ path: "shot-desktop-full.png", fullPage: true });
  if (errors.length) {
    console.error("console errors:", errors);
    process.exit(1);
  }
  await browser.close();
  console.log("smoke ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
