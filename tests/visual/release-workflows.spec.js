const { test, expect } = require('@playwright/test');

const {
  rebuildArtifactCatalog,
  runWorkflowCapture,
} = require('./helpers/release_visual');
const { expectNarrowReflow } = require('./helpers/narrow_reflow');

test.use({ trace: 'off' });


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


async function expectSharedDialogGeometry(page) {
  const geometry = await page.locator('dialog[open] [data-dialog-panel]').evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const dialog = panel.closest('dialog');
    return {
      x: panelRect.x,
      y: panelRect.y,
      width: panelRect.width,
      height: panelRect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      compact: dialog.matches('.quick-log, .craving-flow'),
    };
  });

  if (geometry.viewportWidth < 768) {
    expect(geometry.x).toBeLessThanOrEqual(1);
    expect(geometry.width).toBeGreaterThanOrEqual(geometry.viewportWidth - 2);
    expect(geometry.y + geometry.height).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight - 16);
  } else {
    const center = geometry.x + geometry.width / 2;
    expect(Math.abs(center - geometry.viewportWidth / 2)).toBeLessThanOrEqual(2);
    expect(geometry.width).toBeLessThanOrEqual(geometry.compact ? 576 : 672);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight - 48);
  }
}


for (const workflow of DIALOG_WORKFLOWS) {
  for (const theme of ['light', 'dark']) {
    test(`${workflow.name} ${theme} dialog/sheet`, async ({ page, context }, testInfo) => {
      const result = await runWorkflowCapture({
        page,
        context,
        testInfo,
        stateName: workflow.stateName,
        captureName: `${workflow.name}--${theme}--open`,
        group: 'dialogs',
        theme,
        open: workflow.open,
      });

      expect(result.bytes).toBeGreaterThan(1_000);
      expect(result.geometry.openDialogs).toHaveLength(1);
      expect(result.geometry.theme).toBe(theme);
      await expectSharedDialogGeometry(page);
    });
  }

  test(`${workflow.name} reduced-motion transition`, async ({ page, context }, testInfo) => {
    const result = await runWorkflowCapture({
      page,
      context,
      testInfo,
      stateName: workflow.stateName,
      captureName: `${workflow.name}--light--reduced-motion--open`,
      group: 'reduced-motion',
      reducedMotion: 'reduce',
      open: workflow.open,
    });

    expect(result.bytes).toBeGreaterThan(1_000);
    expect(result.geometry.reducedMotion).toBe(true);
    expect(result.geometry.openDialogs).toHaveLength(1);
    await expectSharedDialogGeometry(page);
  });

  test(`${workflow.name} at 320px and 200% text`, async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text capture');
    const result = await runWorkflowCapture({
      page,
      context,
      testInfo,
      stateName: workflow.stateName,
      captureName: `${workflow.name}--light--320px--200pct--open`,
      group: 'narrow-200',
      viewport: { width: 320, height: 900 },
      textScale: 2,
      open: workflow.open,
    });

    expect(result.bytes).toBeGreaterThan(1_000);
    expect(result.geometry.openDialogs).toHaveLength(1);
    await expectSharedDialogGeometry(page);
    await expectNarrowReflow(page, result, { kind: 'dialog', stateName: workflow.name });
  });
}


test('Today check-in open under reduced motion', async ({ page, context }, testInfo) => {
  const result = await runWorkflowCapture({
    page,
    context,
    testInfo,
    stateName: 'today-exceeded',
    captureName: 'today-check-in--light--reduced-motion--open',
    group: 'reduced-motion',
    reducedMotion: 'reduce',
    async open(currentPage) {
      await currentPage.getByRole('button', { name: 'Take a short check-in' }).click();
      await expect(currentPage.locator('[data-check-in-form]')).toBeVisible();
    },
  });

  expect(result.geometry.reducedMotion).toBe(true);
  expect(result.geometry.visibleCheckIn).toBe(true);
});


test('Today check-in at 320px and 200% text', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text capture');
  const result = await runWorkflowCapture({
    page,
    context,
    testInfo,
    stateName: 'today-exceeded',
    captureName: 'today-check-in--light--320px--200pct--open',
    group: 'narrow-200',
    viewport: { width: 320, height: 900 },
    textScale: 2,
    async open(currentPage) {
      await currentPage.getByRole('button', { name: 'Take a short check-in' }).click();
      await expect(currentPage.locator('[data-check-in-form]')).toBeVisible();
    },
  });

  expect(result.geometry.visibleCheckIn).toBe(true);
  await expectNarrowReflow(page, result, { stateName: 'today-check-in' });
});


for (const narrow of [false, true]) {
  test(`Journey revision preview${narrow ? ' at 320px and 200% text' : ''}`, async ({ page, context }, testInfo) => {
    if (narrow) {
      test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text capture');
    }
    const result = await runWorkflowCapture({
      page,
      context,
      testInfo,
      state: {
        name: 'journey-revision',
        path: '/journey/',
        status: 200,
        email: 'today-targeted@example.com',
      },
      captureName: narrow
        ? 'journey-revision--light--320px--200pct--preview'
        : 'journey-revision--light--preview',
      group: narrow ? 'narrow-200' : 'workflows',
      viewport: narrow ? { width: 320, height: 900 } : undefined,
      textScale: narrow ? 2 : 1,
      async open(currentPage) {
        const editor = currentPage.locator('[data-plan-editor="revision"]');
        await editor.getByLabel('Effective date').fill('2026-08-04');
        await editor.getByLabel('Duration days').fill('42');
        const previewResponse = currentPage.waitForResponse((response) => (
          response.url().includes('/revisions/preview')
          && response.request().method() === 'POST'
        ));
        await editor.getByRole('button', { name: 'Preview revision' }).click();
        const response = await previewResponse;
        expect(
          response.status(),
          `Journey revision preview response: ${await response.text()}`,
        ).toBe(200);
        await expect(editor.locator('[data-plan-editor-preview]')).toBeVisible();
      },
    });

    expect(result.geometry.visibleJourneyPreview).toBe(true);
    if (narrow) {
      await expectNarrowReflow(page, result, { stateName: 'journey-revision' });
    }
  });
}


for (const surface of [
  {
    name: 'account-deletion',
    stateName: 'account-destructive',
    selector: '#account-delete-title',
  },
  {
    name: 'data-destructive-confirmations',
    stateName: 'data-settings-action',
    selector: '#data-anonymize-title',
  },
]) {
  test(`${surface.name} at 320px and 200% text`, async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'One canonical narrow-text capture');
    const result = await runWorkflowCapture({
      page,
      context,
      testInfo,
      stateName: surface.stateName,
      captureName: `${surface.name}--light--320px--200pct`,
      group: 'narrow-200',
      viewport: { width: 320, height: 900 },
      textScale: 2,
      async open(currentPage) {
        await currentPage.locator(surface.selector).scrollIntoViewIfNeeded();
        await expect(currentPage.locator(surface.selector)).toBeVisible();
      },
    });

    await expectNarrowReflow(page, result, { stateName: surface.name });
  });
}


test.afterAll(async ({ browser }, testInfo) => {
  await rebuildArtifactCatalog({ browser, projectName: testInfo.project.name });
});
