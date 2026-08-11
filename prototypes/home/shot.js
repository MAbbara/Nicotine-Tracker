/* Screenshot + smoke-test script for the home page prototype. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const url = "http://127.0.0.1:8613/prototypes/home/";

  // Desktop, full page
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await desktop.goto(url, { waitUntil: "networkidle" });
  await desktop.waitForTimeout(1400); // let entrance motion finish
  await desktop.screenshot({ path: "shot-desktop-hero.png" });
  await desktop.screenshot({ path: "shot-desktop-full.png", fullPage: true });

  // Interaction: log past plan + open craving pause
  await desktop.click('[data-brand="Velo"]');
  await desktop.waitForTimeout(300);
  await desktop.click('[data-brand="ZYN"]');
  await desktop.waitForTimeout(300);
  await desktop.click('[data-brand="Velo"]');
  await desktop.waitForTimeout(300);
  await desktop.click('[data-brand="On!"]'); // 3 + 4 = 7 -> past plan
  await desktop.click("#cravingBtn");
  await desktop.waitForTimeout(500);
  await desktop.screenshot({ path: "shot-desktop-interaction.png" });
  // FAQ open state
  await desktop.click(".faq summary");
  await desktop.waitForTimeout(300);
  await desktop.close();

  // Mobile, full page
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(url, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(1400);
  await mobile.screenshot({ path: "shot-mobile-hero.png" });
  await mobile.screenshot({ path: "shot-mobile-full.png", fullPage: true });
  await mobile.close();

  await browser.close();
  console.log("done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
