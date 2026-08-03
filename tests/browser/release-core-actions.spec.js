const { test, expect } = require('@playwright/test');

const {
  CORE_ACTION_STATES,
  EXPECTED_ACTIONS,
  loginAs,
} = require('./helpers/release_manifest');
const { watchForProductProblems } = require('./helpers/product_guard');


function formPayload(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''));
}


async function signOut(page) {
  await page.goto('/auth/logout');
  await expect(page).toHaveURL(/\/$/);
}


async function expectGuardClean(guard, page, stateName, {
  allowAnalytics = false,
  allowedCanceledNavigationPaths = [],
} = {}) {
  await page.waitForLoadState('networkidle');
  guard.assertClean(expect, {
    stateName,
    expectedStatus: 200,
    expectedPath: new URL(page.url()).pathname,
    allowAnalytics,
    allowedCanceledNavigationPaths,
  });
}


test('every core release action names one exact focused-test owner', () => {
  for (const stateName of CORE_ACTION_STATES) {
    const actions = EXPECTED_ACTIONS[stateName];
    expect(actions.coveredBy, `${stateName} has coveredBy metadata`).toBeDefined();
    if (!actions.coveredBy) continue;

    expect(
      Object.keys(actions.coveredBy).sort((left, right) => left.localeCompare(right)),
      `${stateName} covered actions`,
    ).toEqual(actions);
    for (const [actionName, owner] of Object.entries(actions.coveredBy)) {
      expect(actionName, `${stateName} action name`).toMatch(/\S/);
      expect(owner, `${stateName} › ${actionName} owner`)
        .toMatch(/^tests\/browser\/[a-z0-9-]+\.spec\.js › \S.+$/);
    }
  }
});


test('public and authenticated chrome actions reach focus and navigation targets', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.goto('/auth/login');

  const publicSkip = page.getByRole('link', { name: 'Skip to main content' });
  await publicSkip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/auth\/login#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('link', { name: 'Nicotine Tracker home' }).click();
  await expect(page).toHaveURL(/\/$/);

  await loginAs(page, 'release-settings@example.com');
  const appSkip = page.getByRole('link', { name: 'Skip to main content' });
  await appSkip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/today\/#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goto('/you/');
  await page.getByRole('link', { name: 'Nicotine Tracker home' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.getByRole('link', {
    name: 'Open your space for release-settings@example.com',
  }).click();
  await expect(page).toHaveURL(/\/you\/?$/);

  for (const [name, path] of [
    ['Today', '/today/'],
    ['Journey', '/journey/'],
    ['Insights', '/insights/'],
    ['You', '/you/'],
  ]) {
    const link = page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name, exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}?$`));
  }

  await expectGuardClean(guard, page, 'shared chrome activation', { allowAnalytics: true });
});


test('authentication links reach the neighboring recovery or account form', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.goto('/auth/login');

  await page.getByRole('link', { name: 'Create one here' }).click();
  await expect(page).toHaveURL(/\/auth\/register$/);
  await page.getByRole('link', { name: 'Sign in here' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/auth\/forgot_password$/);
  await page.getByRole('link', { name: 'Sign in here' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.goto('/auth/reset_password/browser-accessibility-reset-token');
  await page.getByRole('link', { name: 'Sign in here' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);

  await expectGuardClean(guard, page, 'authentication links');
});


test('login validation and Remember me preserve the authenticated session', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.goto('/auth/login');

  const invalidLoginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByLabel('Email address').fill('release-settings@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const invalidLogin = await invalidLoginResponse;
  expect(invalidLogin.status()).toBe(200);
  expect(formPayload(invalidLogin.request())).toEqual(expect.objectContaining({
    email: 'release-settings@example.com',
    password: 'wrong-password',
  }));
  await expect(page.getByRole('status')).toContainText('Invalid email or password.');

  await page.getByLabel('Email address').fill('release-settings@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('checkbox', { name: 'Remember me' }).check();
  const validLoginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const validLogin = await validLoginResponse;
  expect(validLogin.status()).toBe(302);
  expect(formPayload(validLogin.request())).toEqual(expect.objectContaining({
    email: 'release-settings@example.com',
    password: 'browser-password',
    remember_me: 'on',
  }));
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.reload();
  await expect(page).toHaveURL(/\/today\/?$/);

  await expectGuardClean(guard, page, 'login validation and session');
});


test('forgot form enforces validation and preserves a neutral recovery response', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.goto('/auth/forgot_password');

  const forgotEmail = page.getByLabel('Email address');
  let forgotPosts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/auth/forgot_password'
    ) forgotPosts += 1;
  });
  await forgotEmail.fill('not-an-email');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(forgotEmail).toBeFocused();
  expect(await forgotEmail.evaluate((element) => element.validity.typeMismatch)).toBe(true);
  expect(forgotPosts).toBe(0);

  await forgotEmail.fill('no-release-account@example.com');
  const forgotResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/forgot_password'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Send reset link' }).click();
  const forgot = await forgotResponse;
  expect(forgot.status()).toBe(302);
  expect(formPayload(forgot.request())).toEqual(expect.objectContaining({
    email: 'no-release-account@example.com',
  }));
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole('status')).toContainText(
    'If an account with that email exists, a password reset link has been sent.',
  );

  await expectGuardClean(guard, page, 'forgot-password validation');
});


test('reset form enforces native and matching validation without consuming the token', async ({ page }) => {
  const guard = watchForProductProblems(page);

  await page.goto('/auth/reset_password/browser-accessibility-reset-token');
  let resetPosts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname.startsWith('/auth/reset_password/')
    ) resetPosts += 1;
  });
  const newPassword = page.getByRole('textbox', { name: 'New password', exact: true });
  const confirmation = page.getByRole('textbox', {
    name: 'Confirm new password', exact: true,
  });
  await newPassword.fill('short');
  await confirmation.fill('short');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(newPassword).toBeFocused();
  expect(await newPassword.evaluate((element) => element.validity.tooShort)).toBe(true);
  expect(resetPosts).toBe(0);

  await newPassword.fill('browser-password');
  await confirmation.fill('different-password');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(confirmation).toBeFocused();
  expect(await confirmation.evaluate((element) => element.validity.customError)).toBe(true);
  expect(resetPosts).toBe(0);
  await confirmation.fill('browser-password');
  expect(await confirmation.evaluate((element) => element.validity.valid)).toBe(true);

  await expectGuardClean(guard, page, 'reset-password validation');
});


test('Today fallback and recovery links reach their intended next action', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await loginAs(page, 'browser@example.com');

  await page.getByRole('link', { name: 'Create a plan', exact: true }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
  await page.goto('/today/');
  const neutral = page.getByRole('link', { name: 'Continue neutral tracking' });
  await neutral.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
  await page.goto('/today/');
  await page.getByRole('link', { name: 'Log your first nicotine use' }).click();
  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);

  await signOut(page);
  await loginAs(page, 'today-paused@example.com');
  await page.getByRole('link', { name: 'Review or resume in Journey' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);

  await signOut(page);
  await loginAs(page, 'today-exceeded@example.com');
  await page.getByRole('link', { name: 'Keep logging' }).click();
  await expect(page).toHaveURL(/\/today\/#quick-log$/);
  await expect(page.locator('#quick-log')).toBeInViewport();
  await page.getByRole('link', { name: 'Reflect on today' }).click();
  await expect(page).toHaveURL(/\/today\/#check-in$/);
  await expect(page.locator('#check-in')).toBeInViewport();
  await page.getByRole('link', { name: 'Review the plan in Journey' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);
  await page.goto('/today/');
  await page.getByRole('link', { name: 'Pause or revise in Journey' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);

  await expectGuardClean(guard, page, 'Today fallback and recovery actions');
});


test('uncovered onboarding choices and Journey handoffs preserve user control', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await loginAs(page, 'browser@example.com');
  await page.goto('/journey/onboarding');

  const quit = page.getByRole('radio', {
    name: 'Quit by a date Build a schedule that ends at zero.',
  });
  await quit.focus();
  await page.keyboard.press('Space');
  await expect(quit).toBeChecked();
  await expect(page.locator('.onboarding-margin')).toContainText('Quit by a date');

  const observe = page.getByRole('radio', {
    name: 'Understand my baseline first Track for seven days without a reduction target.',
  });
  await observe.check();
  await expect(observe).toBeChecked();
  await expect(page.locator('.onboarding-margin')).toContainText('Understand my baseline first');

  await signOut(page);
  await loginAs(page, 'journey-review-desktop@example.com');
  await page.goto('/journey/');
  await page.getByRole('link', { name: 'Review this draft' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
  await expect(page.getByRole('heading', { name: 'Choose your intention' })).toBeFocused();

  await signOut(page);
  await loginAs(page, 'today-targeted@example.com');
  await page.goto('/journey/');
  await page.getByRole('link', { name: 'Go to Today’s next useful action' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  await expectGuardClean(guard, page, 'Journey choice and handoff actions');
});


test('Insights export disclosures and next steps keep data accessible', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await loginAs(page, 'release-analytics-ready@example.com');
  await page.goto('/insights/');

  await page.getByRole('button', { name: 'Weekly' }).click();
  const daily = page.getByRole('button', { name: 'Daily' });
  await daily.focus();
  await page.keyboard.press('Enter');
  await expect(daily).toHaveAttribute('aria-pressed', 'true');

  for (const [summaryName, regionName] of [
    ['View consumption trend data', 'Consumption trend data'],
    ['View time-of-day data', 'Time of day distribution data'],
    ['View weekly pattern data', 'Weekly pattern data'],
    ['View product data', 'Brand preference data'],
  ]) {
    const summary = page.getByText(summaryName, { exact: true });
    const details = summary.locator('..');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(details.getByRole('region', { name: regionName })).toBeFocused();
  }

  const exportResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/export'
  ));
  const downloadStarted = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const [response, download] = await Promise.all([exportResponse, downloadStarted]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  expect(response.headers()['content-disposition']).toContain('attachment;');
  expect(download.suggestedFilename()).toMatch(/^nicotine_data_\d{8}\.csv$/);

  await page.getByRole('link', { name: 'Plan for Afternoon (12PM-6PM)' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);

  await signOut(page);
  await loginAs(page, 'release-analytics-empty@example.com');
  await page.goto('/insights/');
  await page.getByRole('link', { name: 'Log today' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  await signOut(page);
  await loginAs(page, 'release-analytics-sparse@example.com');
  await page.goto('/insights/');
  await page.getByRole('link', { name: 'Log today' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  await expectGuardClean(guard, page, 'Insights missing actions', {
    allowAnalytics: true,
    allowedCanceledNavigationPaths: ['/insights/api/export'],
  });
});


test('Insights failed range can be retried without losing current data', async ({ page }) => {
  let attempts = 0;
  await page.route('**/insights/api/insights?days=90', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, json: { error: 'temporary' } });
      return;
    }
    await route.continue();
  });
  await loginAs(page, 'release-analytics-ready@example.com');
  await page.goto('/insights/');
  const headline = page.locator('[data-insights-headline]');
  const before = await headline.innerText();
  const range = page.getByRole('link', { name: '90 days', exact: true });

  await range.click();
  await expect(page.locator('[data-insights-load-status]')).toContainText('choose the range again to retry');
  await expect(headline).toHaveText(before);
  await expect(range).not.toHaveAttribute('aria-current', 'true');

  await range.click();
  await expect(range).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-insights-load-status]')).toBeHidden();
  await expect(page.locator('#export-data')).toHaveAttribute(
    'data-export-href',
    '/insights/api/export?days=90',
  );
  expect(attempts).toBe(2);
});


test('You links reach every settings and catalog destination', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const unusedBundles = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/static/js/preline.js') {
      unusedBundles.push(request.url());
    }
  });
  await loginAs(page, 'release-settings@example.com');

  for (const [name, path] of [
    ['Profile Personal details kept private', '/settings/profile'],
    ['Day & timezone Daily reset and display preferences', '/settings/preferences'],
    ['Your pouches Catalog and quick-log choices', '/catalog/'],
    ['Reminders Channels, timing, and quiet hours', '/settings/notifications'],
    ['Data & privacy Export and account controls', '/settings/data'],
  ]) {
    await page.goto('/you/');
    const link = page.getByRole('link', { name });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}?$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }

  expect(unusedBundles).toEqual([]);
  await expectGuardClean(guard, page, 'You settings and catalog links');
});
