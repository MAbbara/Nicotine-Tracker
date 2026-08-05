const { test, expect } = require('@playwright/test');

const { RELEASE_STATES, loginAs } = require('../browser/helpers/release_manifest');
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
const AUTH_GEOMETRY_STATES = [
  { name: 'login', path: '/auth/login' },
  { name: 'login with validation flash', path: '/auth/login', flash: 'login' },
  { name: 'register', path: '/auth/register' },
  { name: 'register with validation flash', path: '/auth/register', flash: 'register' },
];


function stateNamed(name) {
  const state = RELEASE_STATES.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`Unknown visual release state: ${name}`);
  return state;
}


async function prepareAuthState(page, state, theme) {
  await page.goto(state.path);
  await page.evaluate((savedTheme) => {
    localStorage.setItem('nicotine-tracker-theme', savedTheme);
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  if (state.flash === 'login') {
    const responsePending = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/auth/login'
      && response.request().method() === 'POST'
    ));
    await page.getByLabel('Email address').fill('release-settings@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await responsePending).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('Invalid email or password.');
  } else if (state.flash === 'register') {
    const responsePending = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/auth/register'
      && response.request().method() === 'POST'
    ));
    await page.getByLabel('Email address').fill('release-settings@example.com');
    await page.locator('#password').fill('browser-password');
    await page.locator('#confirm_password').fill('browser-password');
    await page.getByLabel('I understand this is a personal tracking tool, not medical advice.').check();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect((await responsePending).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText(
      'An account with this email already exists.',
    );
  }

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
      panelHeight: panelRect.height,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      shellGridRows: shellStyle.gridTemplateRows,
      shellHeight: document.body.getBoundingClientRect().height,
      usableHeight: innerHeight - precedingBottom,
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

      for (const state of AUTH_GEOMETRY_STATES) {
        for (const theme of ['light', 'dark']) {
          await prepareAuthState(page, state, theme);
          const geometry = await readAuthGeometry(page);
          const message = `${state.name}, ${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`;

          expect.soft(geometry.horizontalOverflow, message).toBeLessThanOrEqual(1);
          expect.soft(geometry.panelLeft, message).toBeGreaterThanOrEqual(-1);
          expect.soft(geometry.panelRight, message).toBeLessThanOrEqual(viewport.width + 1);
          expect.soft(geometry.panelTop, message).toBeGreaterThanOrEqual(0);
          expect.soft(geometry.panelBottom, message).toBeLessThanOrEqual(
            geometry.documentHeight + 1,
          );
          if (layout === 'desktop') {
            const centeringIsFeasible = geometry.panelHeight <= geometry.usableHeight + 1;
            if (centeringIsFeasible) {
              expect.soft(Math.abs(geometry.midpointDelta), message).toBeLessThanOrEqual(3);
            } else {
              expect.soft(geometry.clearance, message).toBeGreaterThanOrEqual(-1);
            }
            expect.soft(geometry.documentHeight, message).toBeLessThanOrEqual(
              Math.max(geometry.viewportHeight, geometry.panelBottom) + 1,
            );
          } else {
            expect.soft(geometry.alignContent, message).toBe('start');
            expect.soft(geometry.clearance, message).toBeGreaterThanOrEqual(16);
          }
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

  test('You rows reserve arrow space for long labels at 320px and 200% text', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text geometry check');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'light'));
    await loginAs(page, 'release-settings@example.com');
    await page.goto('/you/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.locator('.you-links > a strong').evaluateAll((labels) => {
      labels.forEach((label, index) => {
        label.textContent = `A deliberately long account preference label ${index + 1}`;
      });
    });

    const geometry = await page.locator('.you-links > a').evaluateAll((links) => ({
      documentOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      rows: links.map((link) => {
        const copy = link.querySelector(':scope > span:nth-child(2)').getBoundingClientRect();
        const arrow = link.querySelector(':scope > span[aria-hidden="true"]').getBoundingClientRect();
        const row = link.getBoundingClientRect();
        return {
          arrowLeft: arrow.left,
          arrowRight: arrow.right,
          copyRight: copy.right,
          rowRight: row.right,
        };
      }),
    }));
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    for (const row of geometry.rows) {
      expect(row.copyRight).toBeLessThanOrEqual(row.arrowLeft + 1);
      expect(row.arrowRight).toBeLessThanOrEqual(row.rowRight + 1);
    }
  });

  test.afterAll(async ({ browser }, testInfo) => {
    await rebuildArtifactCatalog({ browser, projectName: testInfo.project.name });
  });
});
