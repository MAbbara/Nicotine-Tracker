const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
} = require('./helpers/supporting_behavior_contract');


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
  await page.goto('/goals/');

  await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible();
  await expect(page.getByText(/support your Journey plan/i)).toBeVisible();
  await page.getByRole('link', { name: 'Create a goal' }).click();
  await page.getByLabel('Goal type').selectOption('daily_pouches');
  await page.getByLabel('Target value').fill('7');
  await page.getByLabel('Notification threshold').fill('75');
  await page.getByRole('button', { name: 'Create goal' }).click();

  const active = page.locator('article.goal-row[data-goal-state="active"]', { hasText: 'Daily pouch ceiling' });
  await expect(active).toContainText('7 pouches');
  await active.getByRole('link', { name: 'Adjust goal' }).click();
  const activeCheckbox = page.getByLabel('Keep this goal active');
  await expect(activeCheckbox).toBeChecked();
  await page.getByLabel('Target value').fill('6');
  await expect(activeCheckbox).toBeChecked();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('article.goal-row[data-goal-state="active"]')).toContainText('6 pouches');

  const pauseButton = page.locator('article.goal-row[data-goal-state="active"]')
    .getByRole('button', { name: 'Pause goal' });
  await expect(pauseButton).toBeVisible();
  await pauseButton.click();
  const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', { hasText: 'Daily pouch ceiling' });
  await expect(inactive).toBeVisible();
  await expect(inactive.getByRole('button', { name: 'Resume goal' })).toHaveCount(0);
  await expect(inactive.locator('form[action*="/goals/toggle/"]')).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await inactive.getByRole('button', { name: 'Delete goal' }).click();
  await expect(page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' })).toHaveCount(0);
  for (const [state, action, dimensions] of [
    ['goals', 'Adjust goal', ['keyboard', 'request']],
    ['goals', 'Create a goal', ['keyboard', 'request']],
    ['goals', 'Delete goal', ['error', 'keyboard', 'persistence', 'request']],
    ['goals', 'Pause goal', ['keyboard', 'persistence', 'request']],
    ['goal-create', 'Create goal', ['error', 'focus', 'keyboard', 'persistence', 'request']],
    ['goal-create', 'Notify me as I approach this goal', ['focus', 'keyboard', 'persistence']],
    ['goal-edit', 'Keep this goal active', ['focus', 'keyboard', 'persistence']],
    ['goal-edit', 'Notify me as I approach this goal', ['focus', 'keyboard', 'persistence']],
    ['goal-edit', 'Save changes', ['error', 'focus', 'keyboard', 'persistence', 'request']],
  ]) recorder.record(state, action, dimensions);
  recorder.assertComplete();
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
