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


async function useExplicitTheme(page, theme) {
  await page.addInitScript((value) => {
    localStorage.setItem('nicotine-tracker-theme', value);
  }, theme);
}


async function expectExplicitTheme(page, theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}


async function expectKeyboardScrollable(region) {

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


for (const theme of ['light', 'dark']) {
  test(`populated Journey has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await useExplicitTheme(page, theme);
    const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
    await login(page, `journey-review-${project}@example.com`);
    await page.goto('/journey/');

    await expectExplicitTheme(page, theme);
    await expect(page.locator('.journey-table-scroll')).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`populated dashboard has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/dashboard/');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('table', { name: /recent logs/i })).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`populated log history has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/log/view');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('table', { name: /log history/i })).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`authenticated 404 has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/missing-accessibility-fixture');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
}


test('populated Journey mobile overflow is keyboard accessible', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Overflow geometry is mobile-specific');
  await login(page, 'journey-review-mobile@example.com');
  await page.goto('/journey/');

  const schedule = page.locator('.journey-table-scroll');
  await expect(schedule).toBeVisible();
  await expectKeyboardScrollable(schedule);
});


test('populated dashboard and log history mobile overflows are keyboard accessible', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Overflow geometry is mobile-specific');
  await login(page, 'today-targeted@example.com');
  await page.goto('/dashboard/');

  const recentLogs = page.locator('.horizontal-scroll-region', { has: page.getByRole('table', { name: /recent logs/i }) });
  await expect(recentLogs).toBeVisible();
  await expectKeyboardScrollable(recentLogs);

  await page.goto('/log/view');
  const logHistory = page.locator('.horizontal-scroll-region', { has: page.getByRole('table', { name: /log history/i }) });
  await expect(logHistory).toBeVisible();
  await expectKeyboardScrollable(logHistory);
});


test('authenticated 404 has one main landmark and a Today recovery link', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/missing-accessibility-fixture');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
});
