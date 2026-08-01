const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
}


async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


async function expectKeyboardScrollableOnMobile(region, testInfo) {
  if (!testInfo.project.name.includes('mobile')) return;

  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAccessibleName(/schedule|recent logs|log history/i);
  await region.focus();
  expect(await region.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
}


test('login page has semantic structure, natural tab order, and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');

  await expect(page.getByRole('heading', { name: 'Sign in to your account', level: 1 })).toBeVisible();
  await expect(page.locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveCount(0);
  await expectNoWcagViolations(page);
});


for (const path of ['/', '/auth/register', '/auth/forgot_password']) {
  test(`public page ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoWcagViolations(page);
  });
}


test('primary authenticated pages have one h1 and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  for (const path of ['/today', '/journey/', '/insights/', '/you']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoWcagViolations(page);
  }
});


test('Data & Privacy has a labelled retention control and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  await page.goto('/settings/data');
  const daysToKeep = page.getByLabel('Days to keep');
  await expect(daysToKeep).toBeVisible();
  await expect(daysToKeep).toHaveAttribute('required', '');
  await expect(daysToKeep).toHaveAttribute('aria-describedby', 'days_to_keep_help');
  await expectNoWcagViolations(page);
});


test('populated Journey schedule has no WCAG A/AA violations and its mobile overflow is keyboard accessible', async ({ page }, testInfo) => {
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await login(page, `journey-review-${project}@example.com`);
  await page.goto('/journey/');

  const schedule = page.locator('.journey-table-scroll');
  await expect(schedule).toBeVisible();
  await expectNoWcagViolations(page);
  await expectKeyboardScrollableOnMobile(schedule, testInfo);
});


test('populated dashboard has no WCAG A/AA violations and Recent Logs mobile overflow is keyboard accessible', async ({ page }, testInfo) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/dashboard/');

  await expectNoWcagViolations(page);
  const recentLogs = page.locator('.horizontal-scroll-region', { has: page.getByRole('table', { name: /recent logs/i }) });
  await expect(recentLogs).toBeVisible();
  await expectKeyboardScrollableOnMobile(recentLogs, testInfo);
});


test('populated log history has no WCAG A/AA violations and its mobile overflow is keyboard accessible', async ({ page }, testInfo) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/log/view');

  await expectNoWcagViolations(page);
  const logHistory = page.locator('.horizontal-scroll-region', { has: page.getByRole('table', { name: /log history/i }) });
  await expect(logHistory).toBeVisible();
  await expectKeyboardScrollableOnMobile(logHistory, testInfo);
});


test('authenticated 404 has one main landmark, a Today recovery link, and no WCAG A/AA violations', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/missing-accessibility-fixture');

  await expectNoWcagViolations(page);
  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
});
