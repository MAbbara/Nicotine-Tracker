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


const COMPACT_DIALOGS = DIALOGS.filter(({ compact }) => compact);


function splitComputedList(value) {
  const items = [];
  let depth = 0;
  let item = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      items.push(item.trim());
      item = '';
    } else {
      item += character;
    }
  }
  if (item) items.push(item.trim());
  return items;
}


function durationInMilliseconds(value) {
  const duration = Number.parseFloat(value);
  return value.endsWith('ms') ? duration : duration * 1000;
}


async function readDialogMotion(dialog) {
  return dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      durations: style.transitionDuration,
      properties: style.transitionProperty,
      timingFunctions: style.transitionTimingFunction,
    };
  });
}


function expectDialogMotion(motion, direction) {
  const properties = splitComputedList(motion.properties);
  const durations = splitComputedList(motion.durations);
  const timingFunctions = splitComputedList(motion.timingFunctions);
  const visualProperties = properties.filter((property) => !['display', 'overlay'].includes(property));

  expect(visualProperties, `${direction}: only opacity and transform may animate`).toEqual([
    'opacity',
    'transform',
  ]);
  expect(
    properties.filter((property) => !visualProperties.includes(property))
      .every((property) => ['display', 'overlay'].includes(property)),
    `${direction}: any discrete transitions must only preserve native dialog lifecycle`,
  ).toBe(true);

  for (const property of visualProperties) {
    const index = properties.indexOf(property);
    const duration = durationInMilliseconds(durations[index % durations.length]);
    expect(duration, `${direction}: ${property} duration`).toBeGreaterThanOrEqual(180);
    expect(duration, `${direction}: ${property} duration`).toBeLessThanOrEqual(220);
    expect(
      timingFunctions[index % timingFunctions.length],
      `${direction}: ${property} must use the shared ease-out curve`,
    ).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  }
}


async function readCloseFeedback(close) {
  return close.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
}


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
    const panelBox = await current.panel.boundingBox();
    const restingFeedback = await readCloseFeedback(close);
    await close.hover();
    await expect(close).toHaveCSS('cursor', 'pointer');

    if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
      const hoverFeedback = await readCloseFeedback(close);
      expect(
        hoverFeedback.backgroundColor !== restingFeedback.backgroundColor
          || hoverFeedback.borderColor !== restingFeedback.borderColor,
        'hover must produce calm visible color feedback',
      ).toBe(true);
      expect(hoverFeedback.borderRadius).toBe(restingFeedback.borderRadius);
    }

    await page.keyboard.press('Tab');
    await close.focus();
    const focusFeedback = await readCloseFeedback(close);
    expect(focusFeedback.outlineStyle).not.toBe('none');
    expect(focusFeedback.outlineWidth).toBeGreaterThanOrEqual(3);
    expect(focusFeedback.borderRadius).toBe(restingFeedback.borderRadius);

    const closeBox = await close.boundingBox();
    await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
    await page.mouse.down();
    const activeFeedback = await readCloseFeedback(close);
    expect(
      activeFeedback.backgroundColor !== restingFeedback.backgroundColor
        || activeFeedback.borderColor !== restingFeedback.borderColor,
      'active press must produce calm visible color feedback',
    ).toBe(true);
    expect(activeFeedback.borderRadius).toBe(restingFeedback.borderRadius);
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    await page.mouse.up();
    await expect(current.dialog).toBeVisible();

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


test('add-log actions reserve the mobile safe area without changing desktop spacing', async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  try {
    await loginAs(page, 'release-inventory@example.com');
    await page.goto('/log/view');
    const { dialog } = await openDialog(page, DIALOGS[2]);
    const actions = dialog.locator('.c-dialog__actions');
    const baselinePadding = await actions.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    ));

    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, right: 0, bottom: 34, left: 0 },
    });

    const safeLayout = await actions.evaluate((element) => {
      const actionsRect = element.getBoundingClientRect();
      const buttonRects = [...element.querySelectorAll('button')]
        .filter((button) => getComputedStyle(button).display !== 'none')
        .map((button) => button.getBoundingClientRect());
      return {
        bottomReserve: actionsRect.bottom - Math.max(...buttonRects.map((rect) => rect.bottom)),
        minButtonHeight: Math.min(...buttonRects.map((rect) => rect.height)),
        paddingBottom: Number.parseFloat(getComputedStyle(element).paddingBottom),
      };
    });

    if (testInfo.project.name.includes('mobile')) {
      expect(safeLayout.paddingBottom - baselinePadding).toBeGreaterThanOrEqual(33);
      expect(safeLayout.bottomReserve).toBeGreaterThanOrEqual(34);
      expect(safeLayout.minButtonHeight).toBeGreaterThanOrEqual(44);
    } else {
      expect(Math.abs(safeLayout.paddingBottom - baselinePadding)).toBeLessThanOrEqual(0.1);
    }
  } finally {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
    await cdp.detach();
  }
});


test('quick-log and craving dialogs share compliant bidirectional motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginAs(page, 'today-targeted@example.com');
  await page.goto('/today/');

  for (const contract of COMPACT_DIALOGS) {
    await contract.ready(page);
    const dialog = page.locator(contract.name === 'quick log' ? 'dialog.quick-log' : 'dialog.craving-flow');
    await expect(dialog).toBeHidden();
    expectDialogMotion(await readDialogMotion(dialog), `${contract.name} close`);

    const current = await openDialog(page, contract);
    expectDialogMotion(await readDialogMotion(current.dialog), `${contract.name} open`);
    await page.keyboard.press('Escape');
    await expect(current.dialog).toBeHidden();
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const contract of COMPACT_DIALOGS) {
    const current = await openDialog(page, contract);
    const durations = splitComputedList((await readDialogMotion(current.dialog)).durations)
      .map(durationInMilliseconds);
    expect(Math.max(...durations), `${contract.name} reduced-motion duration`).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(current.dialog).toBeHidden();
  }
});


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
