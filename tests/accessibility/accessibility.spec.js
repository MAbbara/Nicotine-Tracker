const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();

  expect(results.violations).toEqual([]);
  await expectProjectTouchTargets(page);
}


async function expectProjectTouchTargets(page) {
  const undersized = await page.locator([
    'a[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]:not([aria-disabled="true"])',
    'summary',
  ].join(',')).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || rect.width === 0
      || rect.height === 0
    ) return [];

    const isInlineProseLink = element.matches('a[href]')
      && style.display === 'inline'
      && !element.classList.contains('c-button')
      && Boolean(element.closest('p, dd, dt, figcaption, small'));
    if (isInlineProseLink) return [];

    let target = element;
    if (
      element.matches('input[type="checkbox"], input[type="radio"]')
      && element.labels?.length
    ) {
      target = element.labels[0];
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width >= 44 && targetRect.height >= 44) return [];

    return [{
      tag: element.tagName.toLowerCase(),
      id: element.id,
      classes: [...element.classList],
      text: (element.textContent || element.getAttribute('aria-label') || '')
        .trim().slice(0, 80),
      width: Math.round(targetRect.width * 10) / 10,
      height: Math.round(targetRect.height * 10) / 10,
    }];
  }));

  expect(undersized).toEqual([]);
}


async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


async function relogin(page, email) {
  await page.context().clearCookies();
  await login(page, email);
}


function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push({
    kind: 'pageerror',
    text: error.stack || error.message,
    url: page.url(),
  }));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({
        kind: 'console',
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  return errors;
}


function expectNoUnexpectedBrowserErrors(
  errors,
  allowedStatus = null,
  expectedPath = null,
) {
  const unexpected = errors.filter((error) => {
    if (!allowedStatus) return true;
    let errorPath = null;
    try {
      errorPath = new URL(error.url).pathname;
    } catch {
      return true;
    }
    const isExpectedNavigationError = error.kind === 'console'
      && error.text.includes(`status of ${allowedStatus}`)
      && errorPath === new URL(expectedPath, 'http://browser.test').pathname;
    return !isExpectedNavigationError;
  });
  expect(unexpected).toEqual([]);
  errors.length = 0;
}


async function auditRoute(page, errors, path, heading, options = {}) {
  const response = await page.goto(path);
  if (options.status) expect(response.status()).toBe(options.status);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
  await expectNoWcagViolations(page);
  expectNoUnexpectedBrowserErrors(
    errors,
    options.status >= 400 ? options.status : null,
    path,
  );
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


for (const [path, heading] of [
  ['/', 'Start with the next useful action.'],
  ['/auth/register', 'Create your account'],
  ['/auth/forgot_password', 'Reset your password'],
  ['/auth/reset_password/browser-accessibility-reset-token', 'Choose a new password'],
]) {
  test(`public page ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
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


test('remaining first-party route matrix has one h1, clean console, and no WCAG A/AA violations', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await login(page, 'browser@example.com');
  let editPouchHref = null;

  for (const [path, heading] of [
    ['/today', 'Today'],
    ['/journey/onboarding', 'Shape a plan you can learn from'],
    ['/insights/', 'Insights'],
    ['/you', 'You'],
    ['/settings/profile', 'Profile'],
    ['/settings/account', 'Account'],
    ['/settings/preferences', 'Preferences'],
    ['/settings/notifications', 'Reminders'],
    ['/settings/data', 'Data & privacy'],
    ['/settings/statistics', 'Statistics'],
    ['/log/view', 'Logbook'],
    ['/log/add', 'Logbook'],
    ['/log/bulk', 'Bulk add logs'],
    ['/catalog/', 'Your pouches'],
    ['/catalog/add', 'Add a pouch'],
    ['/catalog/search?q=Steady', 'Search pouches'],
    ['/cravings/cravings', 'Craving history'],
    ['/goals/', 'Goals'],
    ['/goals/create', 'Create a goal'],
    ['/dashboard/', 'Dashboard'],
  ]) {
    await auditRoute(page, errors, path, heading);
    if (path === '/log/add') {
      await expect(page.getByRole('dialog', { name: 'Add a log' })).toBeVisible();
    }
    if (path === '/catalog/') {
      editPouchHref = await page.getByRole('link', { name: 'Edit' })
        .first().getAttribute('href');
    }
  }
  await auditRoute(page, errors, editPouchHref, 'Edit pouch');
});


test('populated analytics, edit forms, and goal progress pass the full accessibility contract', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await login(page, 'today-targeted@example.com');

  for (const [path, heading] of [
    ['/today', 'Today'],
    ['/insights/', 'Insights'],
    ['/dashboard/', 'Dashboard'],
    ['/log/view', 'Logbook'],
  ]) {
    await auditRoute(page, errors, path, heading);
  }

  const editLogHref = await page.getByRole('link', { name: 'Edit' }).first().getAttribute('href');
  await auditRoute(page, errors, editLogHref, 'Edit log');

  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await relogin(page, `journey-review-${project}@example.com`);
  let editGoalHref = null;
  for (const [path, heading] of [
    ['/journey/', 'Journey'],
    ['/goals/', 'Goals'],
    ['/goals/progress', 'Goal progress'],
  ]) {
    await auditRoute(page, errors, path, heading);
    if (path === '/goals/') {
      editGoalHref = await page.getByRole('link', { name: 'Adjust goal' }).first().getAttribute('href');
    }
  }

  await auditRoute(page, errors, editGoalHref, 'Adjust goal');
});


test('Goal progress supports narrow dark 200% text and reduced motion without page overflow', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useExplicitTheme(page, 'dark');
  await page.setViewportSize({ width: 320, height: 800 });
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await login(page, `journey-review-${project}@example.com`);
  await page.goto('/goals/progress');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  await expectExplicitTheme(page, 'dark');
  await expect(page.getByRole('heading', { name: 'Goal progress', level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  const pageOverflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return {
      delta: document.documentElement.scrollWidth - viewportWidth,
      elements: [...document.querySelectorAll('body *')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right <= viewportWidth + 1 && rect.left >= -1) return [];
        const containingScroller = element.parentElement?.closest(
          '.journey-table-scroll, [data-horizontal-scroll]',
        );
        if (containingScroller) {
          const overflow = getComputedStyle(containingScroller).overflowX;
          if (overflow === 'auto' || overflow === 'scroll') return [];
        }
        return [{
          tag: element.tagName.toLowerCase(),
          classes: [...element.classList].slice(0, 4),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }];
      }).slice(0, 12),
    };
  });
  expect(pageOverflow).toEqual({ delta: 0, elements: [] });

  const history = page.getByRole('region', { name: 'Thirty-day goal record' }).first();
  await expect(history).toBeVisible();
  await expect(history).toHaveAttribute('tabindex', '0');
  expect(await history.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expectNoWcagViolations(page);
  expectNoUnexpectedBrowserErrors(errors);
});


test('400, 404, and 500 pages pass the accessibility and console contract', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  for (const [path, heading, status] of [
    ['/__test__/error/400', 'Refresh and try again', 400],
    ['/missing-accessibility-fixture', 'Page not found', 404],
    ['/__test__/error/500', 'Something went wrong on our end', 500],
  ]) {
    await auditRoute(page, errors, path, heading, { status });
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
  await expect(page.getByRole('checkbox', { name: 'Save actions for offline use' })).toBeVisible();
  await expectNoWcagViolations(page);
});


test('Statistics has an editorial fact list and no WCAG A/AA violations', async ({ page }) => {
  await login(page, 'browser@example.com');
  await page.goto('/settings/statistics');
  await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
  await expect(page.locator('dl.statistics-facts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore patterns in Insights' })).toBeVisible();
  await expectNoWcagViolations(page);
});


for (const theme of ['light', 'dark']) {
  test(`Data and Statistics meet WCAG A/AA in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'browser@example.com');

    for (const [path, heading] of [
      ['/settings/data', 'Data & privacy'],
      ['/settings/statistics', 'Statistics'],
    ]) {
      await page.goto(path);
      await expectExplicitTheme(page, theme);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expectNoWcagViolations(page);
    }
  });
}


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
    await expect(page.locator('[data-dashboard-today]')).toBeVisible();
    await expect(page.locator('[data-dashboard-trend]')).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`populated log history has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/log/view');

    await expectExplicitTheme(page, theme);
    await expect(page.locator('.logbook-row')).toBeVisible();
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
