const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


let userSequence = 0;


function uniqueEmail(testInfo) {
  userSequence += 1;
  const source = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `goals-${process.pid}-${userSequence}-${hash}@example.com`;
}


async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(uniqueEmail(testInfo));
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}


function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}


async function typedKeyboard(recorder, state, action, page, control, outcome, key = 'Enter') {
  const evidence = recorder.forAction(state, action, { page, control });
  recorder.accept(await evidence.run({
    activation: { kind: 'keyboard', key },
    ...outcome,
  }));
}


test('Goals console and analytics stay clean when no analytics target is present', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await register(page, testInfo);

  const analyticsResponse = page.waitForResponse('/goals/api/goals');
  await page.goto('/goals/');
  await analyticsResponse;
  await expect(page.getByTestId('goals-analytics').locator('[data-goals-total]')).toHaveText('0');
  await expect(page.getByTestId('goals-analytics').locator('[data-goals-active]')).toHaveText('0');
  expect(errors).toEqual([]);

  await page.getByRole('link', { name: 'Create a goal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a goal' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('Goals controls stop transform motion when reduced motion is requested', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, testInfo);
  await page.goto('/goals/');

  const createLink = page.getByRole('link', { name: 'Create a goal' });
  await createLink.hover();
  await expect(createLink).toHaveCSS('transition-duration', '0s');
  await expect(createLink).toHaveCSS('transform', 'none');

  await createLink.click();
  const createButton = page.getByRole('button', { name: 'Create goal' });
  await createButton.hover();
  await expect(createButton).toHaveCSS('transition-duration', '0s');
  await expect(createButton).toHaveCSS('transform', 'none');
  expect(errors).toEqual([]);
});


test('Goals preserve create, edit, toggle, and delete behavior', async ({ page }, testInfo) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.goalsLifecycle, expect);
  const errors = collectBrowserErrors(page);
  await register(page, testInfo);
  const guard = watchForProductProblems(page);
  await page.goto('/goals/');

  await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible();
  await expect(page.getByText(/support your Journey plan/i)).toBeVisible();
  const createLink = page.getByRole('link', { name: 'Create a goal' });
  await typedKeyboard(
    recorder, 'goals', 'Create a goal', page, createLink,
    { request: { method: 'GET', path: /^\/goals\/create$/, status: 200 } },
  );

  const createButton = page.getByRole('button', { name: 'Create goal' });
  let createPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/goals/create') {
      createPosts += 1;
    }
  });
  const goalType = page.getByLabel('Goal type');
  const createEvidence = recorder.forAction(
    'goal-create', 'Create goal', { page, control: createButton },
  );
  recorder.accept(await createEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: goalType },
    error: { locator: goalType, validationMessage: 'Please select an item in the list.' },
    feedback: { locator: goalType, validationMessage: 'Please select an item in the list.' },
  }));
  expect(createPosts).toBe(0);

  const createNotifications = page.getByLabel('Notify me as I approach this goal');
  await typedKeyboard(
    recorder, 'goal-create', 'Notify me as I approach this goal', page, createNotifications,
    {
      focus: { mode: 'retained' },
      outcome: { kind: 'checked', locator: createNotifications, checked: false },
    }, 'Space',
  );
  await page.getByLabel('Goal type').selectOption('daily_pouches');
  await page.getByLabel('Target value').fill('7');
  await page.getByLabel('Notification threshold').fill('75');
  const active = page.locator('article.goal-row[data-goal-state="active"]', { hasText: 'Daily pouch ceiling' });
  recorder.accept(await createEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/goals\/create$/, status: 302,
      payload: { kind: 'form', exact: {
        goal_type: 'daily_pouches', target_value: '7', end_date: '', notification_threshold: '75',
      } },
      dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'),
      text: 'Goal created successfully! Target: 7 daily pouches',
    },
    persistence: {
      kind: 'locator', locator: active, property: 'count', expectedBefore: 0, expectedAfter: 1,
    },
  }));
  await expect(active).toContainText('7 pouches');
  const adjustLink = active.getByRole('link', { name: 'Adjust goal' });
  await typedKeyboard(
    recorder, 'goals', 'Adjust goal', page, adjustLink,
    { request: { method: 'GET', path: /^\/goals\/edit\/\d+$/, status: 200 } },
  );
  const activeCheckbox = page.getByLabel('Keep this goal active');
  await expect(activeCheckbox).toBeChecked();
  const editNotifications = page.getByLabel('Notify me as I approach this goal');
  await expect(editNotifications).not.toBeChecked();

  const saveButton = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Target value').fill('');
  const targetValue = page.getByLabel('Target value');
  const saveEvidence = recorder.forAction(
    'goal-edit', 'Save changes', { page, control: saveButton },
  );
  recorder.accept(await saveEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: targetValue },
    error: { locator: targetValue, validationMessage: 'Please fill out this field.' },
    feedback: { locator: targetValue, validationMessage: 'Please fill out this field.' },
  }));

  await typedKeyboard(
    recorder, 'goal-edit', 'Keep this goal active', page, activeCheckbox,
    {
      focus: { mode: 'retained' },
      outcome: { kind: 'checked', locator: activeCheckbox, checked: false },
    }, 'Space',
  );
  await activeCheckbox.press('Space');
  await expect(activeCheckbox).toBeChecked();
  await typedKeyboard(
    recorder, 'goal-edit', 'Notify me as I approach this goal', page, editNotifications,
    {
      focus: { mode: 'retained' },
      outcome: { kind: 'checked', locator: editNotifications, checked: true },
    }, 'Space',
  );
  await page.getByLabel('Target value').fill('6');
  const updatedActive = page.locator('article.goal-row[data-goal-state="active"]');
  recorder.accept(await saveEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/goals\/edit\/\d+$/, status: 302,
      payload: { kind: 'form', exact: {
        target_value: '6', end_date: '', enable_notifications: 'on',
        notification_threshold: '75', is_active: 'on',
      } },
      dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: { locator: page.getByRole('status'), text: 'Goal updated successfully!' },
    persistence: {
      kind: 'locator', locator: updatedActive, property: 'count',
      expectedBefore: 0, expectedAfter: 1,
    },
  }));
  await expect(updatedActive).toContainText('6 pouches');

  await page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('link', { name: 'Adjust goal' }).click();
  await expect(page.getByLabel('Keep this goal active')).toBeChecked();
  await expect(page.getByLabel('Notify me as I approach this goal')).toBeChecked();
  await page.getByRole('link', { name: 'Back to goals' }).click();

  const pauseButton = page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('button', { name: 'Pause goal' });
  await expect(pauseButton).toBeVisible();
  const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', { hasText: 'Daily pouch ceiling' });
  await typedKeyboard(
    recorder, 'goals', 'Pause goal', page, pauseButton,
    {
      request: {
        method: 'POST', path: /^\/goals\/toggle\/\d+$/, status: 302,
        payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
      },
      feedback: {
        locator: page.getByRole('status'), text: 'Goal deactivated successfully.',
      },
      persistence: {
        kind: 'locator', locator: inactive, property: 'count', expectedBefore: 0, expectedAfter: 1,
      },
    },
  );
  await expect(inactive).toBeVisible();
  await expect(inactive.getByRole('button', { name: 'Resume goal' })).toHaveCount(0);
  await expect(inactive.locator('form[action*="/goals/toggle/"]')).toHaveCount(0);

  const deleteButton = inactive.getByRole('button', { name: 'Delete goal' });
  const deleteEvidence = recorder.forAction(
    'goals', 'Delete goal', { page, control: deleteButton },
  );
  recorder.accept(await deleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'dismiss',
    outcome: { kind: 'visible', locator: inactive },
    error: { kind: 'dismissed-dialog', locator: inactive, count: 1 },
  }));

  const deletedGoal = page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' });
  recorder.accept(await deleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'accept',
    request: {
      method: 'POST', path: /^\/goals\/delete\/\d+$/, status: 302,
      payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: { locator: page.getByRole('status'), text: 'Goal deleted successfully.' },
    persistence: {
      kind: 'locator', locator: deletedGoal, property: 'count', expectedBefore: 1, expectedAfter: 0,
    },
  }));
  await expect(deletedGoal).toHaveCount(0);
  recorder.assertComplete();
  guard.assertClean(expect, { stateName: 'goals supporting owner' });
  guard.stop();
  expect(errors).toEqual([]);
});


test('Goals remain accessible in dark theme, at 320px, and at 200% text', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('nicotine-tracker-theme', 'dark');
  });
  await register(page, testInfo);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/goals/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoWcagViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'Create a goal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a goal' })).toBeVisible();
  await expectNoWcagViolations(page);
  const controls = await page.locator(
    'main a, main button, main input:not([type="checkbox"]):not([type="hidden"]), '
    + 'main select, main label.c-field__check',
  ).evaluateAll(
    (items) => items.filter((item) => getComputedStyle(item).display !== 'none')
      .map((item) => item.getBoundingClientRect().height),
  );
  expect(controls.every((height) => height >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.locator('body *').evaluateAll((items) => {
    const viewportWidth = document.documentElement.clientWidth;
    return items.flatMap((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.right <= viewportWidth + 1 && rect.left >= -1) return [];
      return [{
        tag: item.tagName,
        className: item.className,
        name: item.getAttribute('name'),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }];
    }).slice(0, 12);
  });
  expect(overflow).toEqual([]);

  if (testInfo.project.name.includes('mobile')) {
    const clearance = await page.evaluate(() => {
      const navHeight = document.querySelector('.primary-nav').getBoundingClientRect().height;
      const mainPadding = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom);
      return mainPadding - navHeight;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
