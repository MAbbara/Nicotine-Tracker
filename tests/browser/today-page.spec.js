const { test, expect } = require('@playwright/test');


function watchForProductProblems(page) {
  const errors = [];
  const forbiddenRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  page.on('request', (request) => {
    if (/apexcharts|lodash|dashboard-charts/i.test(request.url())) {
      forbiddenRequests.push(request.url());
    }
  });
  return { errors, forbiddenRequests };
}


async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


async function expectNoNavigationOverlap(page, action) {
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  const geometry = await action.evaluate((element, navigationElement) => {
    const actionBox = element.getBoundingClientRect();
    const navigationBox = navigationElement.getBoundingClientRect();
    return {
      action: {
        top: actionBox.top,
        right: actionBox.right,
        bottom: actionBox.bottom,
        left: actionBox.left,
        width: actionBox.width,
        height: actionBox.height,
      },
      navigation: {
        top: navigationBox.top,
        right: navigationBox.right,
        bottom: navigationBox.bottom,
        left: navigationBox.left,
      },
    };
  }, await navigation.elementHandle());
  const intersects = !(
    geometry.action.right <= geometry.navigation.left
    || geometry.action.left >= geometry.navigation.right
    || geometry.action.bottom <= geometry.navigation.top
    || geometry.action.top >= geometry.navigation.bottom
  );
  expect(intersects, JSON.stringify(geometry)).toBe(false);
  expect(geometry.action.width).toBeGreaterThanOrEqual(44);
  expect(geometry.action.height).toBeGreaterThanOrEqual(44);
}


test('no-plan Today keeps both choices and the primary action usable above navigation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'light'));
  const problems = watchForProductProblems(page);
  await login(page, 'browser@example.com');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { name: 'No active plan', level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a plan', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue neutral tracking', exact: true })).toBeVisible();
  await expect(page.getByText(/Your first log will make timing, pouch totals, and nicotine exposure visible/)).toBeVisible();

  const primary = page.locator('#today-log-action');
  await expect(primary).toBeVisible();
  await expect(primary).toBeInViewport();
  await expectNoNavigationOverlap(page, primary);
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);

  await primary.click();
  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
});


test('populated targeted Today presents status, coaching, timeline, and reflection in order', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'light'));
  const problems = watchForProductProblems(page);
  await login(page, 'today-targeted@example.com');

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toHaveCount(1);
  const status = page.locator('section.today-status');
  await expect(status.getByRole('heading', { name: 'On track', level: 2 })).toBeVisible();
  await expect(status).toContainText('2 of 6 pouches');
  await expect(status).toContainText('12.00 of 36.00 mg');
  await expect(status).toContainText('Steady pace');

  await expect(page.getByRole('heading', { name: 'You are on pace', level: 2 })).toBeVisible();
  const timeline = page.locator('[data-today-timeline]');
  await expect(timeline.locator(':scope > li')).toHaveCount(3);
  await expect(timeline.locator('time')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Daily check-in', level: 2 })).toBeVisible();
  await expect(page.locator('[data-check-in-summary-reflection]'))
    .toHaveText('The pause before lunch helped.');

  const sectionOrder = await page.locator('.today-home > section').evaluateAll(
    (sections) => sections.map((section) => section.classList[0]),
  );
  expect(sectionOrder).toEqual([
    'today-status',
    'today-actions',
    'today-coaching',
    'today-timeline',
    'today-check-in',
  ]);
  const layout = await page.locator('.today-home').evaluate((element) => {
    const statusBox = element.querySelector('.today-status').getBoundingClientRect();
    const actionsBox = element.querySelector('.today-actions').getBoundingClientRect();
    return {
      display: getComputedStyle(element).display,
      status: { left: statusBox.left, right: statusBox.right, top: statusBox.top, bottom: statusBox.bottom, width: statusBox.width },
      actions: { left: actionsBox.left, right: actionsBox.right, top: actionsBox.top, bottom: actionsBox.bottom, width: actionsBox.width },
    };
  });
  expect(layout.display).toBe('grid');
  if (testInfo.project.name.includes('mobile')) {
    expect(layout.actions.top).toBeGreaterThanOrEqual(layout.status.bottom);
    expect(Math.abs(layout.actions.width - layout.status.width)).toBeLessThanOrEqual(2);
    const primary = page.locator('#today-log-action');
    await expect(primary).toBeInViewport();
    const aboveNavigation = await primary.evaluate((element) => {
      const actionBox = element.getBoundingClientRect();
      const navigationBox = document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect();
      return {
        actionTop: actionBox.top,
        actionBottom: actionBox.bottom,
        navigationTop: navigationBox.top,
        viewportHeight: window.innerHeight,
      };
    });
    expect(aboveNavigation.actionTop, JSON.stringify(aboveNavigation)).toBeGreaterThanOrEqual(0);
    expect(aboveNavigation.actionBottom, JSON.stringify(aboveNavigation)).toBeLessThanOrEqual(
      aboveNavigation.navigationTop,
    );
  } else {
    expect(layout.status.left).toBeLessThan(layout.actions.left);
    expect(layout.status.right).toBeLessThanOrEqual(layout.actions.left);
    expect(layout.status.width).toBeGreaterThan(layout.actions.width);
  }
  await expectNoNavigationOverlap(page, page.locator('#today-log-action'));
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);
});


test('action slot controls fill their slot before and after enhancement with no horizontal overflow', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'light'));
  for (const moduleName of ['quick_log.js', 'craving_flow.js']) {
    await page.route(`**/static/js/today/${moduleName}`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: '',
    }));
  }
  const problems = watchForProductProblems(page);
  await login(page, 'today-empty-smart@example.com');

  const slots = page.locator('[data-action-slot]');
  await expect(slots).toHaveCount(2);
  await expect(page.locator('[data-log-action-slot]')).toHaveCount(1);
  await expect(page.locator('[data-craving-action-slot]')).toHaveCount(1);

  const measure = () => page.evaluate(() => (
    [...document.querySelectorAll('[data-action-slot]')].map((slot) => {
      const slotBox = slot.getBoundingClientRect();
      const controls = [...slot.querySelectorAll('[data-action-fallback], [data-action-enhanced]')];
      const visible = controls.find((control) => !control.hidden);
      const controlBox = visible.getBoundingClientRect();
      return {
        kind: slot.hasAttribute('data-log-action-slot') ? 'log' : 'craving',
        controlTag: visible.tagName,
        slotLeft: slotBox.left,
        slotRight: slotBox.right,
        slotWidth: slotBox.width,
        controlLeft: controlBox.left,
        controlRight: controlBox.right,
        controlWidth: controlBox.width,
        controlHeight: controlBox.height,
      };
    })
  ));

  const expectControlsFillSlots = (phase, entries) => {
    expect(entries.map((entry) => entry.kind).sort(), phase).toEqual(['craving', 'log']);
    for (const entry of entries) {
      const detail = JSON.stringify({ phase, ...entry });
      expect(entry.controlWidth, detail).toBeGreaterThanOrEqual(entry.slotWidth - 2);
      expect(Math.abs(entry.controlLeft - entry.slotLeft), detail).toBeLessThanOrEqual(2);
      expect(entry.controlRight, detail).toBeLessThanOrEqual(entry.slotRight + 2);
      expect(entry.controlHeight, detail).toBeGreaterThanOrEqual(44);
    }
  };

  const before = await measure();
  expect(before.every((entry) => entry.controlTag === 'A')).toBe(true);
  expectControlsFillSlots('server-rendered fallback', before);

  // Activate both slots through the real enhancement helper, exactly as
  // the Tasks 2/3 bootstraps will, so the enhanced control is the one
  // measured against its slot.
  await page.evaluate(async () => {
    const { activateActionEnhancement } = await import('/static/js/today/action_enhancement.js');
    document.querySelectorAll('[data-action-slot]').forEach((slot) => {
      activateActionEnhancement(slot, (event) => event.preventDefault());
    });
  });
  await expect(page.locator('[data-action-slot][data-controller-ready="true"]')).toHaveCount(2);

  const after = await measure();
  expect(after.every((entry) => entry.controlTag === 'BUTTON')).toBe(true);
  expectControlsFillSlots('enhanced control', after);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);
});


test('Today supports dark theme, visible focus, 200% text, and reduced motion', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchForProductProblems(page);
  await login(page, 'today-targeted@example.com');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const primary = page.locator('#today-log-action');
  await primary.focus();
  const focus = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const durations = style.transitionDuration.split(',').map((value) => (
      parseFloat(value) * (value.includes('ms') ? 0.001 : 1)
    ));
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      height: element.getBoundingClientRect().height,
      maxTransitionSeconds: Math.max(...durations),
    };
  });
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focus.height).toBeGreaterThanOrEqual(44);
  expect(focus.maxTransitionSeconds).toBeLessThanOrEqual(0.001);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className || ''),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
  await expect(page.getByRole('heading', { name: 'Timeline', level: 2 })).toBeVisible();
  await expectNoNavigationOverlap(page, primary);
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);
});
