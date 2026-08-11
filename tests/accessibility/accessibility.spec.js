const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
}


/* Entrance fades leave text mid-opacity; audits must measure the settled
   state users actually read. */
async function settleEntranceMotion(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.landing-rise, .rise').forEach((el) => {
      el.style.transition = 'none';
      el.classList.add('is-in');
    });
  });
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
    await settleEntranceMotion(page);
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


function deterministicA11yEmail(testInfo, label) {
  const source = `${testInfo.project.name}:${testInfo.title}:${label}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `a11y-journey-${hash}@example.com`;
}


function isoDate(daysFromToday = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}


async function registerAndCreatePlan(page, testInfo, label) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicA11yEmail(testInfo, label));
  await page.getByLabel('Password', { exact: true }).fill('browser-password');
  await page.getByLabel('Confirm Password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
  await page.locator('input[name="intention"][value="reduce"]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="baseline_source"][value="manual"]').check();
  await page.locator('#field-baseline_pouches').fill('8');
  await page.locator('#field-baseline_mg_per_pouch').fill('6');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Steady · 49 days/).check();
  await page.getByLabel(/End target in pouches per day/).fill('2');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('No reminder').check();
  await page.getByLabel('Plan start date').fill(isoDate());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Activate this reviewed plan' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


for (const theme of ['light', 'dark']) {
  test(`active Journey overview has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await useExplicitTheme(page, theme);
    await registerAndCreatePlan(page, testInfo, `overview-${theme}`);
    await page.goto('/journey/');

    await expectExplicitTheme(page, theme);
    await expect(page.locator('.journey-overview h1')).toHaveCount(1);

    // The richest state: adjust open with a preview and its confirm showing.
    await page.locator('[data-adjust-toggle]').click();
    await page.getByLabel('Effective date').fill(isoDate(1));
    await page.getByLabel('Duration days').fill('42');
    await page.getByRole('button', { name: 'Preview revision' }).click();
    await expect(page.locator('[data-preview-summary]')).toContainText(/stages? change/);

    // Reveal every .rise section so the audit cannot skip below-fold content.
    await page.evaluate(() => document.querySelectorAll('.rise').forEach((el) => {
      el.style.transition = 'none'; // instant reveal; axe measures full opacity
      el.classList.add('is-in');
    }));
    await expectNoWcagViolations(page);

    // Milestone tooltip is keyboard-reachable and visible without a pointer.
    await page.locator('.path-hotspot').first().focus();
    await expect(page.locator('[data-chart-tooltip]')).toBeVisible();
    await expectNoWcagViolations(page);

    // The chart scroll region stays keyboard-accessible at 200% text.
    const scroll = page.locator('.path-scroll');
    await expect(scroll).toHaveAttribute('tabindex', '0');
    await expect(scroll).toHaveAccessibleName(/path chart/i);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
}
