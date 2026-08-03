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


async function proveKeyboard(recorder, state, action, page, control, key = 'Enter') {
  await recorder.prove(state, action, 'keyboard', async (check) => {
    await control.focus();
    await check(expect(control).toBeFocused());
    await check(expect(control).toHaveAccessibleName(action));
    await page.keyboard.press(key);
  });
}


async function proveRequest(recorder, state, action, response, expected) {
  await recorder.prove(state, action, 'request', async (check) => {
    await check(expect(response.request().method()).toBe(expected.method));
    await check(expect(new URL(response.url()).pathname).toBe(expected.path));
    await check(expect(response.status()).toBe(expected.status));
    if (expected.payload) {
      await check(expect(Object.fromEntries(
        new URLSearchParams(response.request().postData() || ''),
      )).toEqual(expect.objectContaining(expected.payload)));
    } else {
      await check(expect(response.request().postData()).toBeNull());
    }
  });
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
  await proveKeyboard(recorder, 'goals', 'Create a goal', page, createLink);
  await proveRequest(recorder, 'goals', 'Create a goal', await createNavigation, {
    method: 'GET', path: '/goals/create', status: 200,
  });

  const createButton = page.getByRole('button', { name: 'Create goal' });
  let createPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/goals/create') {
      createPosts += 1;
    }
  });
  await proveKeyboard(recorder, 'goal-create', 'Create goal', page, createButton);
  const goalType = page.getByLabel('Goal type');
  await recorder.prove('goal-create', 'Create goal', 'focus', async (check) => {
    await check(expect(goalType).toBeFocused());
  });
  await recorder.prove('goal-create', 'Create goal', 'error', async (check) => {
    await check(expect.poll(() => createPosts).toBe(0));
    await check(expect(goalType).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('goal-create', 'Create goal', 'feedback', async (check) => {
    await check(expect(goalType).toHaveJSProperty('validationMessage', 'Please select an item in the list.'));
  });

  const createNotifications = page.getByLabel('Notify me as I approach this goal');
  await recorder.prove('goal-create', 'Notify me as I approach this goal', 'keyboard', async (check) => {
    await createNotifications.focus();
    await check(expect(createNotifications).toBeFocused());
    await page.keyboard.press('Space');
    await check(expect(createNotifications).not.toBeChecked());
  });
  await recorder.prove('goal-create', 'Notify me as I approach this goal', 'focus', async (check) => {
    await check(expect(createNotifications).toBeFocused());
  });
  await page.getByLabel('Goal type').selectOption('daily_pouches');
  await page.getByLabel('Target value').fill('7');
  await page.getByLabel('Notification threshold').fill('75');
  const createResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/goals/create'
  ));
  await createButton.focus();
  await page.keyboard.press('Enter');
  const createResponse = await createResponsePending;
  await proveRequest(recorder, 'goal-create', 'Create goal', createResponse, {
    method: 'POST', path: '/goals/create', status: 302,
    payload: {
      goal_type: 'daily_pouches', target_value: '7', end_date: '',
      notification_threshold: '75',
    },
  });

  const active = page.locator('article.goal-row[data-goal-state="active"]', { hasText: 'Daily pouch ceiling' });
  await expect(active).toContainText('7 pouches');
  await recorder.prove('goal-create', 'Create goal', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toContainText('Goal created successfully!'));
  });
  await recorder.prove('goal-create', 'Create goal', 'persistence', async (check) => {
    await check(expect(active).toContainText('7 pouches'));
  });
  const adjustLink = active.getByRole('link', { name: 'Adjust goal' });
  const adjustResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && /\/goals\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  await proveKeyboard(recorder, 'goals', 'Adjust goal', page, adjustLink);
  const adjustResponse = await adjustResponsePending;
  await recorder.prove('goals', 'Adjust goal', 'request', async (check) => {
    await check(expect(adjustResponse.request().method()).toBe('GET'));
    await check(expect(adjustResponse.status()).toBe(200));
    await check(expect(new URL(adjustResponse.url()).pathname).toMatch(/^\/goals\/edit\/\d+$/));
    await check(expect(adjustResponse.request().postData()).toBeNull());
  });
  const activeCheckbox = page.getByLabel('Keep this goal active');
  await expect(activeCheckbox).toBeChecked();
  const editNotifications = page.getByLabel('Notify me as I approach this goal');
  await recorder.prove('goal-create', 'Notify me as I approach this goal', 'persistence', async (check) => {
    await check(expect(editNotifications).not.toBeChecked());
  });

  const saveButton = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Target value').fill('');
  await proveKeyboard(recorder, 'goal-edit', 'Save changes', page, saveButton);
  const targetValue = page.getByLabel('Target value');
  await recorder.prove('goal-edit', 'Save changes', 'focus', async (check) => {
    await check(expect(targetValue).toBeFocused());
  });
  await recorder.prove('goal-edit', 'Save changes', 'error', async (check) => {
    await check(expect(targetValue).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('goal-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(targetValue).toHaveJSProperty('validationMessage', 'Please fill out this field.'));
  });

  await recorder.prove('goal-edit', 'Keep this goal active', 'keyboard', async (check) => {
    await activeCheckbox.focus();
    await check(expect(activeCheckbox).toBeFocused());
    await page.keyboard.press('Space');
    await check(expect(activeCheckbox).not.toBeChecked());
    await page.keyboard.press('Space');
    await check(expect(activeCheckbox).toBeChecked());
  });
  await recorder.prove('goal-edit', 'Keep this goal active', 'focus', async (check) => {
    await check(expect(activeCheckbox).toBeFocused());
  });
  await recorder.prove('goal-edit', 'Notify me as I approach this goal', 'keyboard', async (check) => {
    await editNotifications.focus();
    await check(expect(editNotifications).toBeFocused());
    await page.keyboard.press('Space');
    await check(expect(editNotifications).toBeChecked());
  });
  await recorder.prove('goal-edit', 'Notify me as I approach this goal', 'focus', async (check) => {
    await check(expect(editNotifications).toBeFocused());
  });
  await page.getByLabel('Target value').fill('6');
  const saveResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  await saveButton.focus();
  await page.keyboard.press('Enter');
  const saveResponse = await saveResponsePending;
  await recorder.prove('goal-edit', 'Save changes', 'request', async (check) => {
    await check(expect(saveResponse.request().method()).toBe('POST'));
    await check(expect(saveResponse.status()).toBe(302));
    await check(expect(new URL(saveResponse.url()).pathname).toMatch(/^\/goals\/edit\/\d+$/));
    const payload = Object.fromEntries(new URLSearchParams(saveResponse.request().postData() || ''));
    await check(expect(payload).toEqual(expect.objectContaining({
      target_value: '6', end_date: '', enable_notifications: 'on',
      notification_threshold: '75', is_active: 'on',
    })));
  });
  await expect(page.locator('article.goal-row[data-goal-state="active"]')).toContainText('6 pouches');
  await recorder.prove('goal-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toContainText('Goal updated successfully!'));
  });
  await recorder.prove('goal-edit', 'Save changes', 'persistence', async (check) => {
    await check(expect(page.locator('article.goal-row[data-goal-state="active"]')).toContainText('6 pouches'));
  });

  await page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('link', { name: 'Adjust goal' }).click();
  await recorder.prove('goal-edit', 'Keep this goal active', 'persistence', async (check) => {
    await check(expect(page.getByLabel('Keep this goal active')).toBeChecked());
  });
  await recorder.prove('goal-edit', 'Notify me as I approach this goal', 'persistence', async (check) => {
    await check(expect(page.getByLabel('Notify me as I approach this goal')).toBeChecked());
  });
  await page.getByRole('link', { name: 'Back to goals' }).click();

  const pauseButton = page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('button', { name: 'Pause goal' });
  await expect(pauseButton).toBeVisible();
  const pauseResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/toggle\/\d+$/.test(new URL(response.url()).pathname)
  ));
  await proveKeyboard(recorder, 'goals', 'Pause goal', page, pauseButton);
  const pauseResponse = await pauseResponsePending;
  await recorder.prove('goals', 'Pause goal', 'request', async (check) => {
    await check(expect(pauseResponse.request().method()).toBe('POST'));
    await check(expect(pauseResponse.status()).toBe(302));
    await check(expect(new URL(pauseResponse.url()).pathname).toMatch(/^\/goals\/toggle\/\d+$/));
  });
  const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', { hasText: 'Daily pouch ceiling' });
  await expect(inactive).toBeVisible();
  await recorder.prove('goals', 'Pause goal', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toContainText('Goal deactivated successfully.'));
  });
  await recorder.prove('goals', 'Pause goal', 'persistence', async (check) => {
    await check(expect(inactive).toBeVisible());
  });
  await expect(inactive.getByRole('button', { name: 'Resume goal' })).toHaveCount(0);
  await expect(inactive.locator('form[action*="/goals/toggle/"]')).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.dismiss());
  await proveKeyboard(
    recorder, 'goals', 'Delete goal', page,
    inactive.getByRole('button', { name: 'Delete goal' }),
  );
  await recorder.prove('goals', 'Delete goal', 'error', async (check) => {
    await check(expect(inactive).toBeVisible());
  });

  const deleteResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/goals\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (dialog) => dialog.accept());
  await inactive.getByRole('button', { name: 'Delete goal' }).focus();
  await page.keyboard.press('Enter');
  const deleteResponse = await deleteResponsePending;
  await recorder.prove('goals', 'Delete goal', 'request', async (check) => {
    await check(expect(deleteResponse.request().method()).toBe('POST'));
    await check(expect(deleteResponse.status()).toBe(302));
    await check(expect(new URL(deleteResponse.url()).pathname).toMatch(/^\/goals\/delete\/\d+$/));
  });
  await expect(page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' })).toHaveCount(0);
  await recorder.prove('goals', 'Delete goal', 'persistence', async (check) => {
    await check(expect(page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' })).toHaveCount(0));
  });
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
