/* Verification for the production landing page (both themes). */
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

(async () => {
  const browser = await chromium.launch();
  const url = "http://127.0.0.1:5050/";

  // ---- Light theme ----
  const light = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await light.newPage();
  await lp.goto(url, { waitUntil: "load" });
  await lp.waitForTimeout(1500);
  await lp.screenshot({ path: "prod-light-hero.png", timeout: 60000, animations: "disabled" });
  await lp.screenshot({ path: "prod-light-full.png", fullPage: true, timeout: 60000, animations: "disabled" });
  const axeLight = await new AxeBuilder({ page: lp }).analyze();
  console.log("axe light violations:", axeLight.violations.length);
  axeLight.violations.forEach((v) => console.log(" -", v.id, "|", v.impact, "|", v.help, "|", v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));

  // Interaction: log 4 pouches (7 of 6) + open pause
  await lp.click('[data-brand="Velo"]');
  await lp.waitForTimeout(250);
  await lp.click('[data-brand="ZYN"]');
  await lp.waitForTimeout(250);
  await lp.click('[data-brand="Velo"]');
  await lp.waitForTimeout(250);
  await lp.click('[data-brand="On!"]');
  await lp.click("#cravingBtn");
  await lp.waitForTimeout(500);
  console.log("summary after logs:", await lp.evaluate(() => ({
    count: document.getElementById("sumCount").textContent,
    mg: document.getElementById("sumMg").textContent,
    entries: document.getElementById("sumEntries").textContent,
    toast: document.getElementById("toastSub").textContent,
  })));
  await lp.screenshot({ path: "prod-light-interaction.png", timeout: 60000, animations: "disabled" });
  await light.close();

  // ---- Dark theme ----
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await dark.addInitScript(() => window.localStorage.setItem("nicotine-tracker-theme", "dark"));
  const dp = await dark.newPage();
  await dp.goto(url, { waitUntil: "load" });
  await dp.waitForTimeout(1500);
  await dp.screenshot({ path: "prod-dark-hero.png", timeout: 60000, animations: "disabled" });
  await dp.screenshot({ path: "prod-dark-full.png", fullPage: true, timeout: 60000, animations: "disabled" });
  const axeDark = await new AxeBuilder({ page: dp }).analyze();
  console.log("axe dark violations:", axeDark.violations.length);
  axeDark.violations.forEach((v) => console.log(" -", v.id, "|", v.impact, "|", v.help, "|", v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
  await dark.close();

  // ---- Mobile (light) ----
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  await mp.goto(url, { waitUntil: "load" });
  await mp.waitForTimeout(1500);
  await mp.screenshot({ path: "prod-mobile-full.png", fullPage: true, timeout: 60000, animations: "disabled" });
  await mobile.close();

  await browser.close();
  console.log("prod verify done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
