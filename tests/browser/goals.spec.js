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
  const token = await evidence.keyboard({ key, outcome });
  recorder.accept(token);
  return { evidence, token };
}


async function accept(recorder, tokenPromise) {
  recorder.accept(await tokenPromise);
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
  const createNavigation = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/goals/create'
  ));
  const createLinkEvidence = await typedKeyboard(
    recorder, 'goals', 'Create a goal', page, createLink,
    { kind: 'response', pending: createNavigation, method: 'GET', path: /^\/goals\/create$/, status: 200 },
  );
  await accept(recorder, createLinkEvidence.evidence.request({
    activation: createLinkEvidence.token, method: 'GET', path: /^\/goals\/create$/, status: 200,
  }));

  const createButton = page.getByRole('button', { name: 'Create goal' });
  let createPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/goals/create') {
      createPosts += 1;
    }
  });
  const goalType = page.getByLabel('Goal type');
  const createEvidence = await typedKeyboard(
    recorder, 'goal-create', 'Create goal', page, createButton,
    { kind: 'focused', locator: goalType },
  );
  expect(createPosts).toBe(0);
  await accept(recorder, createEvidence.evidence.focus({ locator: goalType }));
  await accept(recorder, createEvidence.evidence.error({
    locator: goalType, validationMessage: 'Please select an item in the list.',
  }));
  await accept(recorder, createEvidence.evidence.feedback({
    locator: goalType, validationMessage: 'Please select an item in the list.',
  }));

  const createNotifications = page.getByLabel('Notify me as I approach this goal');
  const notificationEvidence = await typedKeyboard(
    recorder, 'goal-create', 'Notify me as I approach this goal', page, createNotifications,
    { kind: 'checked', locator: createNotifications, checked: false }, 'Space',
  );
  await accept(recorder, notificationEvidence.evidence.focus({ locator: createNotifications }));
  await page.getByLabel('Goal type').selectOption('daily_pouches');
  await page.getByLabel('Target value').fill('7');
  await page.getByLabel('Notification threshold').fill('75');
  const createResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/goals/create'
  ));
  const validCreate = await createEvidence.evidence.keyboard({
    key: 'Enter',
    outcome: { kind: 'response', pending: createResponsePending, method: 'POST', path: /^\/goals\/create$/, status: 302 },
  });
  recorder.accept(validCreate);
  await accept(recorder, createEvidence.evidence.request({
    activation: validCreate, method: 'POST', path: /^\/goals\/create$/, status: 302,
    payload: { kind: 'form', exact: {
      goal_type: 'daily_pouches', target_value: '7', end_date: '', notification_threshold: '75',
    } },
    dynamicFields: { csrf_token: 'non-empty' },
  }));

  const active = page.locator('article.goal-row[data-goal-state="active"]', { hasText: 'Daily pouch ceiling' });
  await expect(active).toContainText('7 pouches');
  await accept(recorder, createEvidence.evidence.feedback({
    locator: page.getByRole('status'),
    text: 'Goal created successfully! Target: 7 daily pouches',
  }));
  await accept(recorder, createEvidence.evidence.persistence({ locator: active, text: /7 pouches/ }));
  const adjustLink = active.getByRole('link', { name: 'Adjust goal' });
  const adjustResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && /\/goals\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  const adjustEvidence = await typedKeyboard(
    recorder, 'goals', 'Adjust goal', page, adjustLink,
    { kind: 'response', pending: adjustResponsePending, method: 'GET', path: /^\/goals\/edit\/\d+$/, status: 200 },
  );
  await accept(recorder, adjustEvidence.evidence.request({
    activation: adjustEvidence.token, method: 'GET', path: /^\/goals\/edit\/\d+$/, status: 200,
  }));
  const activeCheckbox = page.getByLabel('Keep this goal active');
  await expect(activeCheckbox).toBeChecked();
  const editNotifications = page.getByLabel('Notify me as I approach this goal');
  await accept(recorder, notificationEvidence.evidence.persistence({ locator: editNotifications, checked: false }));

  const saveButton = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Target value').fill('');
  const targetValue = page.getByLabel('Target value');
  const saveEvidence = await typedKeyboard(
    recorder, 'goal-edit', 'Save changes', page, saveButton,
    { kind: 'focused', locator: targetValue },
  );
  await accept(recorder, saveEvidence.evidence.focus({ locator: targetValue }));
  await accept(recorder, saveEvidence.evidence.error({
    locator: targetValue, validationMessage: 'Please fill out this field.',
  }));
  await accept(recorder, saveEvidence.evidence.feedback({
    locator: targetValue, validationMessage: 'Please fill out this field.',
  }));

  const activeEvidence = await typedKeyboard(
    recorder, 'goal-edit', 'Keep this goal active', page, activeCheckbox,
    { kind: 'checked', locator: activeCheckbox, checked: false }, 'Space',
  );
  await activeCheckbox.press('Space');
  await expect(activeCheckbox).toBeChecked();
  await accept(recorder, activeEvidence.evidence.focus({ locator: activeCheckbox }));
  const editNotificationEvidence = await typedKeyboard(
    recorder, 'goal-edit', 'Notify me as I approach this goal', page, editNotifications,
    { kind: 'checked', locator: editNotifications, checked: true }, 'Space',
  );
  await accept(recorder, editNotificationEvidence.evidence.focus({ locator: editNotifications }));
  await page.getByLabel('Target value').fill('6');
  const saveResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  const validSave = await saveEvidence.evidence.keyboard({
    key: 'Enter',
    outcome: { kind: 'response', pending: saveResponsePending, method: 'POST', path: /^\/goals\/edit\/\d+$/, status: 302 },
  });
  recorder.accept(validSave);
  await accept(recorder, saveEvidence.evidence.request({
    activation: validSave, method: 'POST', path: /^\/goals\/edit\/\d+$/, status: 302,
    payload: { kind: 'form', exact: {
      target_value: '6', end_date: '', enable_notifications: 'on',
      notification_threshold: '75', is_active: 'on',
    } },
    dynamicFields: { csrf_token: 'non-empty' },
  }));
  await expect(page.locator('article.goal-row[data-goal-state="active"]')).toContainText('6 pouches');
  await accept(recorder, saveEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Goal updated successfully!',
  }));
  await accept(recorder, saveEvidence.evidence.persistence({
    locator: page.locator('article.goal-row[data-goal-state="active"]'), text: /6 pouches/,
  }));

  await page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('link', { name: 'Adjust goal' }).click();
  await accept(recorder, activeEvidence.evidence.persistence({
    locator: page.getByLabel('Keep this goal active'), checked: true,
  }));
  await accept(recorder, editNotificationEvidence.evidence.persistence({
    locator: page.getByLabel('Notify me as I approach this goal'), checked: true,
  }));
  await page.getByRole('link', { name: 'Back to goals' }).click();

  const pauseButton = page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('button', { name: 'Pause goal' });
  await expect(pauseButton).toBeVisible();
  const pauseResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/toggle\/\d+$/.test(new URL(response.url()).pathname)
  ));
  const pauseEvidence = await typedKeyboard(
    recorder, 'goals', 'Pause goal', page, pauseButton,
    { kind: 'response', pending: pauseResponsePending, method: 'POST', path: /^\/goals\/toggle\/\d+$/, status: 302 },
  );
  await accept(recorder, pauseEvidence.evidence.request({
    activation: pauseEvidence.token, method: 'POST', path: /^\/goals\/toggle\/\d+$/, status: 302,
    payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', { hasText: 'Daily pouch ceiling' });
  await expect(inactive).toBeVisible();
  await accept(recorder, pauseEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Goal deactivated successfully.',
  }));
  await accept(recorder, pauseEvidence.evidence.persistence({ locator: inactive, count: 1 }));
  await expect(inactive.getByRole('button', { name: 'Resume goal' })).toHaveCount(0);
  await expect(inactive.locator('form[action*="/goals/toggle/"]')).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.dismiss());
  const deleteButton = inactive.getByRole('button', { name: 'Delete goal' });
  const deleteEvidence = await typedKeyboard(
    recorder, 'goals', 'Delete goal', page, deleteButton,
    { kind: 'visible', locator: inactive },
  );
  await accept(recorder, deleteEvidence.evidence.error({ locator: inactive, count: 1 }));

  const deleteResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (dialog) => dialog.accept());
  const validDelete = await deleteEvidence.evidence.keyboard({
    key: 'Enter',
    outcome: { kind: 'response', pending: deleteResponsePending, method: 'POST', path: /^\/goals\/delete\/\d+$/, status: 302 },
  });
  recorder.accept(validDelete);
  await accept(recorder, deleteEvidence.evidence.request({
    activation: validDelete, method: 'POST', path: /^\/goals\/delete\/\d+$/, status: 302,
    payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  await expect(page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' })).toHaveCount(0);
  await accept(recorder, deleteEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Goal deleted successfully.',
  }));
  await accept(recorder, deleteEvidence.evidence.persistence({
    locator: page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' }), count: 0,
  }));
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
