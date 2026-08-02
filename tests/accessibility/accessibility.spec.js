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


test('Insights editorial figures expose labelled keyboard-accessible data', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/insights/');

  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
  const regions = page.locator('.analytics-data');
  expect(await regions.count()).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < await regions.count(); index += 1) {
    const region = regions.nth(index);
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveAttribute('aria-label', /data/i);
  }
  await expectNoWcagViolations(page);
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
  test(`Reminders failure feedback meets WCAG A/AA in ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await page.route('**/settings/test-discord-webhook', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Discord rejected the test.' }),
      });
    });
    await login(page, 'browser@example.com');
    await page.goto('/settings/notifications');
    await expectExplicitTheme(page, theme);
    await page.getByRole('checkbox', { name: 'Discord' }).check();
    await page.getByLabel('Discord webhook URL').fill(
      'https://discord.com/api/webhooks/example/token',
    );
    await page.getByRole('button', { name: 'Test Discord connection' }).click();
    await expect(page.locator('#discord-test-status')).toHaveAttribute('data-state', 'error');
    await expectNoWcagViolations(page);
  });
}


test('Settings navigation is labelled, scrollable, and keeps one visible current page', async ({ page }) => {
  await login(page, 'browser@example.com');
  await page.setViewportSize({ width: 320, height: 800 });

  for (const [path, heading] of [
    ['/settings/profile', 'Profile'],
    ['/settings/data', 'Data & privacy'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
    const nav = page.getByRole('navigation', { name: 'Settings' });
    await expect(nav).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav).toHaveAttribute('tabindex', '0');
    expect(await nav.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await nav.focus();
    expect(await nav.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);
  }

  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/settings/profile');
  const savePadding = await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'settings-save-row';
    document.querySelector('.settings-content').append(row);
    return parseFloat(getComputedStyle(row).paddingBottom);
  });
  expect(savePadding).toBeGreaterThanOrEqual(76);
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


test('anonymous 404 has one main landmark, a landing recovery action, and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/missing-accessibility-fixture');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const recovery = main.getByRole('link', { name: 'Back to the start page', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute('href', '/');
  await expectNoWcagViolations(page);
});


for (const theme of ['light', 'dark']) {
  test(`anonymous 404 has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await page.goto('/missing-accessibility-fixture');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
}
