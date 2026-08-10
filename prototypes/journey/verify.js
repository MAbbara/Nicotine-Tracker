/* Accessibility (axe) + reduced-motion verification for the Journey prototype. */
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

(async () => {
  const browser = await chromium.launch();
  const url = "http://127.0.0.1:8613/prototypes/journey/";

  // axe: default page with the adjust flow open and a preview showing
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.click("[data-adjust-toggle]");
  await page.selectOption("[data-adjust-pace]", "focused");
  await page.click("[data-adjust-preview]");
  await page.waitForSelector("[data-preview-summary]:not([hidden])", { timeout: 5000 });
  await page.click(".facts summary");
  await page.waitForTimeout(400); // let the open animation finish
  // Reveal every .rise section so axe cannot skip hidden below-fold content
  await page.evaluate(() => document.querySelectorAll(".rise").forEach((el) => el.classList.add("is-in")));
  const results = await new AxeBuilder({ page }).analyze();
  console.log("axe violations:", results.violations.length);
  results.violations.forEach((v) => {
    console.log("-", v.id, "|", v.impact, "|", v.help);
    v.nodes.slice(0, 4).forEach((n) => console.log("   ", n.target.join(" ")));
  });
  if (results.violations.length) process.exit(1);
  await context.close();

  // axe: dark theme
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const darkPage = await dark.newPage();
  await darkPage.goto(url, { waitUntil: "networkidle" });
  await darkPage.click("[data-theme-toggle]");
  await darkPage.evaluate(() => document.querySelectorAll(".rise").forEach((el) => el.classList.add("is-in")));
  const darkResults = await new AxeBuilder({ page: darkPage }).analyze();
  console.log("dark axe violations:", darkResults.violations.length);
  darkResults.violations.forEach((v) => {
    console.log("-", v.id, "|", v.help);
    v.nodes.slice(0, 4).forEach((n) => console.log("   ", n.target.join(" ")));
  });
  if (darkResults.violations.length) process.exit(1);
  await dark.close();

  // Reduced motion: .rise elements must be fully visible immediately
  const rmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rm = await rmContext.newPage();
  await rm.goto(url, { waitUntil: "networkidle" });
  const hiddenCount = await rm.evaluate(() =>
    Array.from(document.querySelectorAll(".rise")).filter((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.opacity) < 0.99;
    }).length
  );
  console.log("reduced-motion hidden .rise elements:", hiddenCount);
  if (hiddenCount > 0) process.exit(1);
  // Reduced motion: accordion toggles natively (instant, still functional)
  await rm.click(".facts summary");
  await rm.waitForTimeout(200);
  const rmFactsOpen = await rm.evaluate(() => document.querySelector("details.facts").open);
  if (!rmFactsOpen) {
    console.error("reduced-motion facts accordion failed to open");
    process.exit(1);
  }
  await rm.screenshot({ path: "shot-reduced-motion.png" });
  await rmContext.close();

  await browser.close();
  console.log("verify done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
