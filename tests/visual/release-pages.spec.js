const { test, expect } = require('@playwright/test');

const { RELEASE_STATES } = require('../browser/helpers/release_manifest');
const {
  rebuildArtifactCatalog,
  runPageCapture,
} = require('./helpers/release_visual');
const { expectNarrowReflow } = require('./helpers/narrow_reflow');


const DARK_STATE_NAMES = [
  'landing', 'login', 'register', 'forgot-password', 'reset-password',
  'today', 'journey', 'insights', 'you', 'profile', 'logbook',
];
const PUBLIC_DARK_STATE_NAMES = new Set([
  'landing', 'login', 'register', 'forgot-password', 'reset-password',
]);
const NARROW_TEXT_STATE_NAMES = ['today', 'insights', 'profile', 'logbook'];
const AUTH_GEOMETRY_CASES = [
  { viewport: { width: 1440, height: 900 }, layout: 'desktop' },
  { viewport: { width: 1920, height: 1080 }, layout: 'desktop' },
  { viewport: { width: 390, height: 844 }, layout: 'mobile' },
  { viewport: { width: 320, height: 700 }, layout: 'mobile' },
];


function stateNamed(name) {
  const state = RELEASE_STATES.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`Unknown visual release state: ${name}`);
  return state;
}


async function useSavedTheme(page, theme) {
  await page.evaluate((savedTheme) => {
    localStorage.setItem('nicotine-tracker-theme', savedTheme);
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}


async function readAuthGeometry(page) {
  return page.evaluate(() => {
    const brand = document.querySelector('.auth-brand');
    const flash = document.querySelector('.flash-region');
    const content = document.querySelector('.auth-content');
    const panel = document.querySelector('.auth-panel');
    const brandRect = brand.getBoundingClientRect();
    const flashRect = flash.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const shellStyle = getComputedStyle(document.body);
    const contentStyle = getComputedStyle(content);
    const precedingBottom = Math.max(brandRect.bottom, flashRect.bottom);
    const usableMidpoint = precedingBottom + ((innerHeight - precedingBottom) / 2);
    const panelMidpoint = panelRect.top + (panelRect.height / 2);
    return {
      alignContent: contentStyle.alignContent,
      alignSelf: contentStyle.alignSelf,
      clearance: panelRect.top - precedingBottom,
      contentBottom: contentRect.bottom,
      contentHeight: contentRect.height,
      contentMinHeight: contentStyle.minHeight,
      contentTop: contentRect.top,
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      midpointDelta: panelMidpoint - usableMidpoint,
      panelBottom: panelRect.bottom,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      shellGridRows: shellStyle.gridTemplateRows,
      shellHeight: document.body.getBoundingClientRect().height,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
}


test.describe('release page visual captures', () => {
  for (const { viewport, layout } of AUTH_GEOMETRY_CASES) {
    test(`auth panel uses ${layout} alignment at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const projectLayout = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
      test.skip(projectLayout !== layout, `${layout} geometry belongs to its matching project`);
      await page.setViewportSize(viewport);
      await page.goto('/auth/login');

      for (const theme of ['light', 'dark']) {
        await useSavedTheme(page, theme);
        const geometry = await readAuthGeometry(page);
        const message = `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`;

        expect.soft(geometry.horizontalOverflow, message).toBeLessThanOrEqual(1);
        expect.soft(geometry.panelLeft, message).toBeGreaterThanOrEqual(-1);
        expect.soft(geometry.panelRight, message).toBeLessThanOrEqual(viewport.width + 1);
        expect.soft(geometry.panelTop, message).toBeGreaterThanOrEqual(0);
        expect.soft(geometry.panelBottom, message).toBeLessThanOrEqual(
          geometry.documentHeight + 1,
        );
        if (layout === 'desktop') {
          expect.soft(Math.abs(geometry.midpointDelta), message).toBeLessThanOrEqual(3);
        } else {
          expect.soft(geometry.alignContent, message).toBe('start');
          expect.soft(geometry.clearance, message).toBeGreaterThanOrEqual(16);
        }
      }
    });
  }

  for (const state of RELEASE_STATES) {
    test(`light full page: ${state.name}`, async ({ page }, testInfo) => {
      const result = await runPageCapture({
        page,
        testInfo,
        state,
        captureName: `${state.name}--light--full`,
        group: 'pages',
      });

      expect(result.bytes, `${state.name} PNG bytes`).toBeGreaterThan(1_000);
      expect(result.geometry.viewport.width).toBeGreaterThan(0);
      expect(result.geometry.document.height).toBeGreaterThan(0);
    });
  }

  for (const stateName of DARK_STATE_NAMES) {
    test(`dark full page: ${stateName}`, async ({ page }, testInfo) => {
      const result = await runPageCapture({
        page,
        testInfo,
        state: stateNamed(stateName),
        captureName: `${stateName}--dark--full`,
        group: 'dark-pages',
        theme: 'dark',
      });

      expect(result.bytes, `${stateName} dark PNG bytes`).toBeGreaterThan(1_000);
      expect(result.geometry.theme).toBe('dark');
      if (PUBLIC_DARK_STATE_NAMES.has(stateName)) {
        expect(
          result.geometry.themeAppliedByHarness,
          `${stateName} must activate dark through the product theme path`,
        ).toBe(false);
      }
    });
  }

  for (const stateName of NARROW_TEXT_STATE_NAMES) {
    test(`320px and 200% text: ${stateName}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text capture');
      const result = await runPageCapture({
        page,
        testInfo,
        state: stateNamed(stateName),
        captureName: `${stateName}--light--320px--200pct`,
        group: 'narrow-200',
        viewport: { width: 320, height: 900 },
        textScale: 2,
      });

      expect(result.bytes, `${stateName} narrow PNG bytes`).toBeGreaterThan(1_000);
      expect(result.geometry.textScale).toBe(2);
      await expectNarrowReflow(page, result, { stateName });
    });
  }

  test.afterAll(async ({ browser }, testInfo) => {
    await rebuildArtifactCatalog({ browser, projectName: testInfo.project.name });
  });
});
