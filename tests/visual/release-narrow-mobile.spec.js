const { test, expect } = require('@playwright/test');

const { RELEASE_STATES } = require('../browser/helpers/release_manifest');
const {
  rebuildArtifactCatalog,
  runPageCapture,
  runWorkflowCapture,
} = require('./helpers/release_visual');
const { expectNarrowMobileReflow } = require('./helpers/narrow_reflow');


const WIDTHS = [320, 360, 375];
const PAGE_STATES = ['today', 'insights', 'profile', 'logbook'];
const DIALOG_WORKFLOWS = [
  {
    name: 'quick-log',
    stateName: 'today',
    async open(page) {
      await page.locator('#today-log-action').click();
      await expect(page.getByRole('dialog', { name: 'Log nicotine use' })).toBeVisible();
    },
  },
  {
    name: 'craving-support',
    stateName: 'today',
    async open(page) {
      await page.locator('#today-craving-action').click();
      await expect(page.getByRole('dialog', { name: 'Take the next useful step' })).toBeVisible();
    },
  },
  {
    name: 'add-log',
    stateName: 'logbook',
    async open(page) {
      await page.getByRole('button', { name: 'Add log', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Add a log' })).toBeVisible();
    },
  },
];


function stateNamed(name) {
  const state = RELEASE_STATES.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`Unknown visual release state: ${name}`);
  return state;
}


async function expectBottomSheetGeometry(page) {
  const geometry = await page.locator('dialog[open] [data-dialog-panel]').evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return {
      x: rect.x,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      topRadius: Number.parseFloat(style.borderTopLeftRadius),
      bottomRadius: Number.parseFloat(style.borderBottomLeftRadius),
    };
  });

  expect(geometry.x).toBeLessThanOrEqual(1);
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.viewportWidth - 2);
  expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight - 16);
  expect(geometry.topRadius).toBeGreaterThan(0);
  expect(geometry.bottomRadius).toBeLessThanOrEqual(1);
}


for (const width of WIDTHS) {
  for (const stateName of PAGE_STATES) {
    test(`${stateName} normal text at ${width}px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes('mobile'), 'Canonical custom-width coverage');
      const result = await runPageCapture({
        page,
        testInfo,
        state: stateNamed(stateName),
        captureName: `${stateName}--light--${width}px--normal`,
        group: 'narrow-normal',
        viewport: { width, height: 900 },
      });

      expect(result.bytes).toBeGreaterThan(1_000);
      await expectNarrowMobileReflow(page, result, { stateName, width });
    });
  }

  for (const workflow of DIALOG_WORKFLOWS) {
    test(`${workflow.name} normal text at ${width}px`, async ({ page, context }, testInfo) => {
      test.skip(testInfo.project.name.includes('mobile'), 'Canonical custom-width coverage');
      const result = await runWorkflowCapture({
        page,
        context,
        testInfo,
        stateName: workflow.stateName,
        captureName: `${workflow.name}--light--${width}px--normal--open`,
        group: 'narrow-normal',
        viewport: { width, height: 900 },
        open: workflow.open,
      });

      expect(result.bytes).toBeGreaterThan(1_000);
      await expectBottomSheetGeometry(page);
      await expectNarrowMobileReflow(page, result, {
        kind: 'dialog',
        stateName: workflow.name,
        width,
      });
    });
  }
}


test.afterAll(async ({ browser }, testInfo) => {
  await rebuildArtifactCatalog({ browser, projectName: testInfo.project.name });
});
