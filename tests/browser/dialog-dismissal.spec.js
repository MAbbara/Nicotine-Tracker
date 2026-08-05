const { test, expect } = require('@playwright/test');

const { loginAs } = require('./helpers/release_manifest');


const DIALOGS = [
  {
    name: 'quick log',
    email: 'today-targeted@example.com',
    path: '/today/',
    opener: '#today-log-action',
    dialogName: 'Log nicotine use',
    compact: true,
    async ready(page) {
      await expect(page.locator('[data-log-action-slot]'))
        .toHaveAttribute('data-controller-ready', 'true');
    },
  },
  {
    name: 'craving support',
    email: 'today-targeted@example.com',
    path: '/today/',
    opener: '#today-craving-action',
    dialogName: 'Take the next useful step',
    compact: true,
    async ready(page) {
      await expect(page.locator('[data-craving-action-slot]'))
        .toHaveAttribute('data-controller-ready', 'true');
    },
  },
  {
    name: 'add log',
    email: 'release-inventory@example.com',
    path: '/log/view',
    opener: '[data-logbook-add-action]',
    dialogName: 'Add a log',
    compact: false,
    async ready() {},
  },
];


const SCROLLING_DIALOGS = [
  {
    ...DIALOGS[0],
    async exposeOverflow(dialog) {
      await dialog.locator('[data-quick-log-details] > summary').click();
    },
  },
  {
    ...DIALOGS[1],
    async exposeOverflow() {},
  },
];


function watchForProductProblems(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  return errors;
}


async function openDialog(page, contract) {
  const opener = page.locator(contract.opener).first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: contract.dialogName });
  await expect(dialog).toBeVisible();
  return { opener, dialog, panel: dialog.locator('[data-dialog-panel]') };
}


async function expectSharedGeometry(page, panel, { compact }, testInfo) {
  await expect(panel).toHaveCSS('position', 'relative');
  const [panelBox, viewport] = await Promise.all([
    panel.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(panelBox).not.toBeNull();

  if (testInfo.project.name.includes('mobile')) {
    expect(panelBox.x).toBeLessThanOrEqual(1);
    expect(panelBox.width).toBeGreaterThanOrEqual(viewport.width - 2);
    expect(panelBox.y + panelBox.height).toBeGreaterThanOrEqual(viewport.height - 2);
    expect(panelBox.height).toBeLessThanOrEqual(viewport.height - 16);
  } else {
    const panelCenter = panelBox.x + panelBox.width / 2;
    expect(Math.abs(panelCenter - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(panelBox.width).toBeLessThanOrEqual(compact ? 576 : 672);
    expect(panelBox.height).toBeLessThanOrEqual(viewport.height - 48);
  }

  const layout = await panel.evaluate((element) => {
    const visible = (candidate) => {
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0;
    };
    const rect = element.getBoundingClientRect();
    const dialog = element.closest('dialog');
    const body = element.querySelector('.c-dialog__body');
    const header = element.querySelector('.c-dialog__header');
    const actions = [...element.querySelectorAll('.c-dialog__actions')].find(visible);
    const bodyStyle = getComputedStyle(body);
    const panelStyle = getComputedStyle(element);
    const dialogStyle = getComputedStyle(dialog);
    const headerRect = header.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      bodyOverflowY: bodyStyle.overflowY,
      panelOverflowY: panelStyle.overflowY,
      dialogOverflowY: dialogStyle.overflowY,
      headerInside: headerRect.top >= rect.top - 1 && headerRect.bottom <= rect.bottom + 1,
      actionsInside: actionsRect.top >= rect.top - 1 && actionsRect.bottom <= rect.bottom + 1,
      topLeftRadius: Number.parseFloat(panelStyle.borderTopLeftRadius),
      topRightRadius: Number.parseFloat(panelStyle.borderTopRightRadius),
      bottomLeftRadius: Number.parseFloat(panelStyle.borderBottomLeftRadius),
      bottomRightRadius: Number.parseFloat(panelStyle.borderBottomRightRadius),
    };
  });

  expect(layout.bodyOverflowY).toBe('auto');
  expect(['hidden', 'clip']).toContain(layout.panelOverflowY);
  expect(layout.dialogOverflowY).toBe('visible');
  expect(layout.headerInside).toBe(true);
  expect(layout.actionsInside).toBe(true);
  if (testInfo.project.name.includes('mobile')) {
    expect(layout.topLeftRadius).toBeGreaterThan(0);
    expect(layout.topRightRadius).toBeGreaterThan(0);
    expect(layout.bottomLeftRadius).toBeLessThanOrEqual(1);
    expect(layout.bottomRightRadius).toBeLessThanOrEqual(1);
  }
}


async function readActionVisibility(body, actions, panel) {
  return body.evaluate((bodyElement, { actionsElement, panelElement }) => {
    const bodyRect = bodyElement.getBoundingClientRect();
    const actionsRect = actionsElement.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    const clippingTop = Math.max(bodyRect.top, panelRect.top, 0);
    const clippingBottom = Math.min(bodyRect.bottom, panelRect.bottom, innerHeight);
    const visibleHeight = Math.max(
      0,
      Math.min(actionsRect.bottom, clippingBottom) - Math.max(actionsRect.top, clippingTop),
    );
    return {
      actionHeight: actionsRect.height,
      actionsBottom: actionsRect.bottom,
      actionsTop: actionsRect.top,
      bodyBottom: bodyRect.bottom,
      bodyClientHeight: bodyElement.clientHeight,
      bodyTop: bodyRect.top,
      bodyScrollHeight: bodyElement.scrollHeight,
      maxScrollTop: bodyElement.scrollHeight - bodyElement.clientHeight,
      position: getComputedStyle(actionsElement).position,
      panelBottom: panelRect.bottom,
      panelTop: panelRect.top,
      scrollTop: bodyElement.scrollTop,
      visibleHeight,
    };
  }, {
    actionsElement: await actions.elementHandle(),
    panelElement: await panel.elementHandle(),
  });
}


async function expectActionVisibility(state, stage) {
  const requiredVisibleHeight = Math.min(state.actionHeight, state.bodyClientHeight) * 0.75;
  expect.soft(
    state.visibleHeight,
    `${stage}: actions must remain visibly intersecting the dialog body; ${JSON.stringify(state)}`,
  ).toBeGreaterThanOrEqual(requiredVisibleHeight);
}


for (const contract of DIALOGS) {
  test(`${contract.name} shares safe dismissal and responsive geometry`, async ({ page }, testInfo) => {
    const errors = watchForProductProblems(page);
    await loginAs(page, contract.email);
    await page.goto(contract.path);
    await contract.ready(page);

    let current = await openDialog(page, contract);
    await expectSharedGeometry(page, current.panel, contract, testInfo);

    const close = current.dialog.locator('.c-dialog__close');
    await close.hover();
    await expect(close).toHaveCSS('cursor', 'pointer');

    const panelBox = await current.panel.boundingBox();
    await page.mouse.click(panelBox.x + panelBox.width / 2, panelBox.y + 8);
    await expect(current.dialog).toBeVisible();

    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(4, 4);
    await page.mouse.up();
    await expect(current.dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(current.dialog).toBeHidden();
    await expect(current.opener).toBeFocused();

    current = await openDialog(page, contract);
    await page.mouse.click(4, 4);
    await expect(current.dialog).toBeHidden();
    await expect(current.opener).toBeFocused();

    current = await openDialog(page, contract);
    await current.dialog.locator('.c-dialog__close').click();
    await expect(current.dialog).toBeHidden();
    await expect(current.opener).toBeFocused();
    expect(errors).toEqual([]);
  });
}


for (const contract of SCROLLING_DIALOGS) {
  test(`${contract.name} actions remain visible while its overflowing body scrolls`, async ({ page }, testInfo) => {
    const mobile = testInfo.project.name.includes('mobile');
    await page.setViewportSize({ width: mobile ? 390 : 1024, height: 360 });
    await loginAs(page, contract.email);
    await page.goto(contract.path);
    await contract.ready(page);

    const { dialog, panel } = await openDialog(page, contract);
    await contract.exposeOverflow(dialog);
    const body = dialog.locator('.c-dialog__body');
    const actions = body.locator('.c-dialog__actions:visible').first();
    await expect(actions).toBeVisible();
    await expect.poll(
      () => body.evaluate((element) => element.scrollHeight - element.clientHeight),
      { message: `${contract.name} fixture must genuinely overflow` },
    ).toBeGreaterThan(32);

    const initial = await readActionVisibility(body, actions, panel);
    expect.soft(initial.position, 'the action row must use sticky positioning').toBe('sticky');
    await expectActionVisibility(initial, 'before scrolling');

    await body.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const midway = await readActionVisibility(body, actions, panel);
    await expectActionVisibility(midway, 'after meaningful scrolling');

    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(
      () => body.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    ).toBeLessThanOrEqual(1);
    const atBottom = await readActionVisibility(body, actions, panel);
    await expectActionVisibility(atBottom, 'at the bottom of the scroll range');
  });
}


test('add-log dismissal cleans only its transient URL flag and stays closed on refresh', async ({ page }) => {
  const errors = watchForProductProblems(page);
  await loginAs(page, 'release-inventory@example.com');
  await page.goto('/log/view?open_add_modal=1&q=mint#main-content');
  const dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  }))).toEqual({
    pathname: '/log/view',
    search: '?q=mint',
    hash: '#main-content',
  });

  await page.reload();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
