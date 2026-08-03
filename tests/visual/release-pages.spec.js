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


function stateNamed(name) {
  const state = RELEASE_STATES.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`Unknown visual release state: ${name}`);
  return state;
}


test.describe('release page visual captures', () => {
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
