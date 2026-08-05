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


async function readDialogVisualContract(dialog) {
  return dialog.evaluate((element) => {
    const panelStyle = getComputedStyle(element.querySelector('[data-dialog-panel]'));
    const hostStyle = getComputedStyle(element);
    const backdropStyle = getComputedStyle(element, '::backdrop');
    const colorPixel = (value) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const overlayProbe = document.createElement('span');
    overlayProbe.style.backgroundColor = 'var(--color-overlay)';
    document.body.append(overlayProbe);
    const overlayColor = getComputedStyle(overlayProbe).backgroundColor;
    overlayProbe.remove();
    return {
      backdrop: {
        background: colorPixel(backdropStyle.backgroundColor),
        duration: backdropStyle.transitionDuration,
        opacity: Number.parseFloat(backdropStyle.opacity),
        properties: backdropStyle.transitionProperty,
        timing: backdropStyle.transitionTimingFunction,
      },
      host: {
        opacity: hostStyle.opacity,
        properties: hostStyle.transitionProperty,
        transform: hostStyle.transform,
      },
      overlay: colorPixel(overlayColor),
      panel: {
        duration: panelStyle.transitionDuration,
        opacity: Number.parseFloat(panelStyle.opacity),
        properties: panelStyle.transitionProperty,
        timing: panelStyle.transitionTimingFunction,
        transform: panelStyle.transform,
      },
      state: element.dataset.dialogState || null,
    };
  });
}


function expectTransition(style, { properties, duration, timing }, label) {
  const actualProperties = splitComputedList(style.properties);
  const durations = splitComputedList(style.duration).map(durationInMilliseconds);
  const timingFunctions = splitComputedList(style.timing);
  expect(actualProperties, `${label}: transition properties`).toEqual(properties);
  for (let index = 0; index < properties.length; index += 1) {
    expect(durations[index % durations.length], `${label}: ${properties[index]} duration`)
      .toBeCloseTo(duration, 3);
    expect(timingFunctions[index % timingFunctions.length], `${label}: ${properties[index]} easing`)
      .toBe(timing);
  }
}


async function sampleDialogFrames(dialog, count) {
  return dialog.evaluate(async (element, frameCount) => {
    const frames = [];
    const panel = element.querySelector('[data-dialog-panel]');
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frames.push({
        backdropOpacity: Number.parseFloat(getComputedStyle(element, '::backdrop').opacity),
        open: element.open,
        panelOpacity: Number.parseFloat(getComputedStyle(panel).opacity),
        panelTransform: getComputedStyle(panel).transform,
        state: element.dataset.dialogState || null,
      });
    }
    return frames;
  }, count);
}


function hasIntermediateOpacity(frames, key) {
  return frames.some((frame) => frame[key] > 0.01 && frame[key] < 0.99);
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
  const dialogId = await dialog.getAttribute('id');
  const attachedDialog = page.locator(`#${dialogId}`);
  return { opener, dialog, attachedDialog, panel: dialog.locator('[data-dialog-panel]') };
}


async function expectSharedDismissalLifecycle(current, activate) {
  const lifecycleDialog = current.attachedDialog || current.dialog;
  await current.dialog.evaluate((element) => {
    element.dataset.testCloseEvents = '0';
    element.addEventListener('close', () => {
      element.dataset.testCloseEvents = String(Number(element.dataset.testCloseEvents) + 1);
    }, { once: true });
  });
  await activate();
  await expect(lifecycleDialog).toHaveAttribute('data-dialog-state', 'closing');
  await expect(current.dialog).toBeVisible();
  await expect(current.dialog).toBeHidden();
  await expect(lifecycleDialog).not.toHaveAttribute('data-dialog-state');
  await expect(lifecycleDialog).toHaveAttribute('data-test-close-events', '1');
  await expect(current.opener).toBeFocused();
}


async function expectSharedGeometry(page, panel, { compact }, testInfo) {
  await page.waitForTimeout(320);
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
  test(`${contract.name} shared dismissal lifecycle preserves responsive geometry`, async ({ page }, testInfo) => {
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

    await expectSharedDismissalLifecycle(current, () => page.keyboard.press('Escape'));

    current = await openDialog(page, contract);
    await expectSharedDismissalLifecycle(current, () => page.mouse.click(4, 4));

    current = await openDialog(page, contract);
    await expectSharedDismissalLifecycle(
      current,
      () => current.dialog.locator('.c-dialog__close').click(),
    );

    if (contract.name === 'add log') {
      current = await openDialog(page, contract);
      await expectSharedDismissalLifecycle(
        current,
        () => current.dialog.getByRole('button', { name: 'Cancel' }).click(),
      );
    }
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
    await page.waitForTimeout(320);
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


for (const contract of DIALOGS) {
  test(`${contract.name} backdrop and panel motion use shared theme-safe frames`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await loginAs(page, contract.email);
    await page.goto(contract.path);
    await contract.ready(page);

    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((element, nextTheme) => {
        element.dataset.theme = nextTheme;
      }, theme);
      const current = await openDialog(page, contract);
      const entranceFrames = await sampleDialogFrames(current.dialog, 14);
      await page.waitForTimeout(100);
      const entered = await readDialogVisualContract(current.dialog);

      expect(entered.state).toBe('open');
      expect(entered.host.transform).toBe('none');
      expect(entered.host.opacity).toBe('1');
      expect(splitComputedList(entered.host.properties).sort()).toEqual(['display', 'overlay']);
      expectTransition(entered.panel, {
        properties: ['opacity', 'transform'],
        duration: 300,
        timing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }, `${contract.name} ${theme} entrance panel`);
      expectTransition(entered.backdrop, {
        properties: ['opacity'],
        duration: 260,
        timing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }, `${contract.name} ${theme} entrance backdrop`);
      expect(hasIntermediateOpacity(entranceFrames, 'panelOpacity')).toBe(true);
      expect(hasIntermediateOpacity(entranceFrames, 'backdropOpacity')).toBe(true);
      expect(entranceFrames.some((frame) => frame.panelTransform !== 'none')).toBe(true);
      expect(entered.panel.opacity).toBeCloseTo(1, 2);
      expect(entered.backdrop.opacity).toBeCloseTo(1, 2);
      entered.backdrop.background.slice(0, 3).forEach((channel, index) => {
        expect(Math.abs(channel - entered.overlay[index])).toBeLessThanOrEqual(1);
      });
      expect(entered.backdrop.background[3]).toBeGreaterThan(0);
      expect(entered.backdrop.background[3]).toBeLessThan(255);

      await current.dialog.locator('.c-dialog__close').click();
      await expect(current.dialog).toHaveAttribute('data-dialog-state', 'closing');
      await expect(current.dialog).toBeVisible();
      const exiting = await readDialogVisualContract(current.dialog);
      expectTransition(exiting.panel, {
        properties: ['opacity', 'transform'],
        duration: 220,
        timing: 'cubic-bezier(0.4, 0, 1, 1)',
      }, `${contract.name} ${theme} exit panel`);
      expectTransition(exiting.backdrop, {
        properties: ['opacity'],
        duration: 180,
        timing: 'cubic-bezier(0.4, 0, 1, 1)',
      }, `${contract.name} ${theme} exit backdrop`);
      const exitFrames = await sampleDialogFrames(current.dialog, 10);
      expect(hasIntermediateOpacity(exitFrames, 'panelOpacity')).toBe(true);
      expect(hasIntermediateOpacity(exitFrames, 'backdropOpacity')).toBe(true);
      expect(exitFrames.some((frame) => frame.open)).toBe(true);
      await expect(current.dialog).toBeHidden();
      await expect(current.opener).toBeFocused();
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await openDialog(page, contract);
    const reducedContract = await readDialogVisualContract(reduced.dialog);
    const panelDurations = splitComputedList(reducedContract.panel.duration)
      .map(durationInMilliseconds);
    const backdropDurations = splitComputedList(reducedContract.backdrop.duration)
      .map(durationInMilliseconds);
    expect(Math.max(...panelDurations)).toBeLessThanOrEqual(1);
    expect(Math.max(...backdropDurations)).toBeLessThanOrEqual(1);
    const closeElapsed = await reduced.dialog.evaluate((element) => new Promise((resolve) => {
      const startedAt = performance.now();
      element.addEventListener('close', () => resolve(performance.now() - startedAt), { once: true });
      element.querySelector('.c-dialog__close').click();
    }));
    expect(closeElapsed).toBeLessThanOrEqual(32);
    await expect(reduced.opener).toBeFocused();
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
