const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const {
  CORE_ACTION_STATES,
  EXPECTED_ACTIONS,
  RELEASE_STATES,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const { watchForProductProblems } = require('./helpers/product_guard');


function formPayload(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''));
}


function coreChromeActions(stateName) {
  return EXPECTED_ACTIONS[stateName].filter((action) => (
    ['Insights', 'Journey', 'Nicotine Tracker home', 'Skip to main content', 'Today', 'You']
      .includes(action)
    || action.startsWith('Open your space for ')
  ));
}


async function keyboardActivate(page, locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}


async function signOut(page) {
  await page.goto('/auth/logout');
  await expect(page).toHaveURL(/\/$/);
}


async function expectGuardClean(guard, page, stateName, {
  allowAnalytics = false,
  allowedCanceledNavigationPaths = [],
  expectedHttpErrors = [],
} = {}) {
  await page.waitForLoadState('networkidle');
  guard.assertClean(expect, {
    stateName,
    expectedStatus: 200,
    expectedPath: new URL(page.url()).pathname,
    allowAnalytics,
    allowedCanceledNavigationPaths,
    expectedHttpErrors,
  });
}


test('every core release action names an exact state-scoped behavioral receipt', () => {
  const ownerStates = new Map();
  for (const stateName of CORE_ACTION_STATES) {
    const actions = EXPECTED_ACTIONS[stateName];
    expect(actions.coveredBy, `${stateName} has coveredBy metadata`).toBeDefined();
    if (!actions.coveredBy) continue;

    expect(
      Object.keys(actions.coveredBy).sort((left, right) => left.localeCompare(right)),
      `${stateName} covered actions`,
    ).toEqual(actions);
    for (const [actionName, receipt] of Object.entries(actions.coveredBy)) {
      expect(actionName, `${stateName} action name`).toMatch(/\S/);
      expect(receipt, `${stateName} › ${actionName} receipt`).toEqual(expect.objectContaining({
        action: actionName,
        state: stateName,
        dimensions: expect.any(Object),
      }));
      expect(receipt.test, `${stateName} › ${actionName} owner`)
        .toMatch(/^tests\/browser\/[a-z0-9-]+\.spec\.js › \S.+$/);
      const [ownerFile, ownerTitle] = receipt.test.split(' › ');
      const source = fs.readFileSync(path.resolve(ownerFile), 'utf8');
      expect(source, `${stateName} › ${actionName} owner exists`)
        .toContain(`test('${ownerTitle}'`);
      if (!ownerStates.has(receipt.test)) ownerStates.set(receipt.test, new Set());
      ownerStates.get(receipt.test).add(stateName);
      expect(Object.keys(receipt.dimensions).sort()).toEqual([
        'error', 'focus', 'keyboard', 'loading', 'persistence', 'request',
      ]);
      for (const [dimension, disposition] of Object.entries(receipt.dimensions)) {
        expect(
          ['asserted', 'not-applicable'].includes(disposition.status),
          `${stateName} › ${actionName} ${dimension} disposition`,
        ).toBe(true);
        expect(disposition.reason).toMatch(/\S/);
      }
    }
  }
  const exactMultiStateOwners = new Set([
    'tests/browser/release-core-actions.spec.js › authentication links reach the neighboring recovery or account form',
    'tests/browser/release-core-actions.spec.js › every core chrome action runs in its exact representative state',
    'tests/browser/release-core-actions.spec.js › Insights actions run in every exact representative data state',
    'tests/browser/release-core-actions.spec.js › Today fallback and recovery links reach their intended next action',
    'tests/browser/release-core-actions.spec.js › Today repeated controls run in each exact representative state',
    'tests/browser/release-core-actions.spec.js › uncovered onboarding choices and Journey handoffs preserve user control',
    'tests/browser/onboarding.spec.js › registration previews transparently and activates only after final confirmation',
    'tests/browser/today-states.spec.js › optional empty reflection saves once, reconciles one row, and reopens canonical values',
  ]);
  for (const [owner, states] of ownerStates) {
    if (states.size > 1) {
      expect(exactMultiStateOwners, `${owner} spans ${[...states].join(', ')}`).toContain(owner);
    }
  }
});


test('every core chrome action runs in its exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const states = CORE_ACTION_STATES.map((name) => (
    resolveReleaseState(RELEASE_STATES.find((state) => state.name === name), testInfo.project.name)
  ));

  for (const state of states) {
    const receipts = new Set();
    if (!state.email) {
      await page.goto(state.path);
      const guard = watchForProductProblems(page);
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await keyboardActivate(page, skip);
      await expect(page.locator('#main-content')).toBeFocused();
      receipts.add('Skip to main content');
      await page.goto(state.path);
      await keyboardActivate(page, page.getByRole('link', { name: 'Nicotine Tracker home' }));
      await expect(page).toHaveURL(/\/$/);
      receipts.add('Nicotine Tracker home');
      await expectGuardClean(guard, page, `${state.name} exact chrome`);
    } else {
      await signOut(page);
      await loginAs(page, state.email);
      await page.goto(state.path);
      const guard = watchForProductProblems(page);
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await keyboardActivate(page, skip);
      await expect(page.locator('#main-content')).toBeFocused();
      receipts.add('Skip to main content');

      await page.goto(state.path);
      await keyboardActivate(page, page.getByRole('link', { name: 'Nicotine Tracker home' }));
      await expect(page).toHaveURL(/\/today\/?$/);
      receipts.add('Nicotine Tracker home');

      await page.goto(state.path);
      const accountName = `Open your space for ${state.email}`;
      await keyboardActivate(page, page.getByRole('link', { name: accountName }));
      await expect(page).toHaveURL(/\/you\/?$/);
      receipts.add(accountName);

      for (const [name, path] of [
        ['Today', '/today/'], ['Journey', '/journey/'], ['You', '/you/'],
      ]) {
        await page.goto(state.path);
        await keyboardActivate(
          page,
          page.getByRole('navigation', { name: 'Primary' })
            .getByRole('link', { name, exact: true }),
        );
        await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}#main-content$`));
        await expect(page.locator('#main-content')).toBeFocused();
        receipts.add(name);
      }
      await expectGuardClean(guard, page, `${state.name} exact non-analytics chrome`, {
        allowAnalytics: state.allowAnalytics,
      });
      guard.stop();

      await page.goto(state.path);
      const insightsGuard = watchForProductProblems(page);
      await keyboardActivate(
        page,
        page.getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: 'Insights', exact: true }),
      );
      await expect(page).toHaveURL(/\/insights\/#main-content$/);
      await expect(page.locator('#main-content')).toBeFocused();
      receipts.add('Insights');
      await expectGuardClean(insightsGuard, page, `${state.name} exact Insights chrome`, {
        allowAnalytics: true,
      });
      insightsGuard.stop();
    }
    expect([...receipts].sort(), `${state.name} runtime chrome receipts`)
      .toEqual(coreChromeActions(state.name));
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
  const publicWordmark = page.getByRole('link', { name: 'Nicotine Tracker home' });
  await publicWordmark.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);

  await loginAs(page, 'release-settings@example.com');
  const appSkip = page.getByRole('link', { name: 'Skip to main content' });
  await appSkip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/today\/#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goto('/you/');
  const appWordmark = page.getByRole('link', { name: 'Nicotine Tracker home' });
  await appWordmark.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/today\/?$/);
  const accountLink = page.getByRole('link', {
    name: 'Open your space for release-settings@example.com',
  });
  await accountLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/you\/?$/);

  for (const [name, path] of [
    ['Today', '/today/'],
    ['Journey', '/journey/'],
    ['You', '/you/'],
  ]) {
    const link = page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name, exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}#main-content$`));
    await expect(page.locator('#main-content')).toBeFocused();
  }

  await expectGuardClean(guard, page, 'shared chrome activation');
  guard.stop();
  const insightsGuard = watchForProductProblems(page);
  const insightsLink = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Insights', exact: true });
  await insightsLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/insights\/#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();
  await expectGuardClean(insightsGuard, page, 'Insights chrome activation', {
    allowAnalytics: true,
  });
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
  const rememberedSession = (await page.context().cookies())
    .find((cookie) => cookie.name === 'session');
  expect(rememberedSession?.expires).toBeGreaterThan(Date.now() / 1000);
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.reload();
  await expect(page).toHaveURL(/\/today\/?$/);

  await signOut(page);
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await expect(page.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked();
  const sessionLoginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const sessionLogin = await sessionLoginResponse;
  expect(sessionLogin.status()).toBe(302);
  expect(formPayload(sessionLogin.request())).not.toHaveProperty('remember_me');
  const browserSession = (await page.context().cookies())
    .find((cookie) => cookie.name === 'session');
  expect(browserSession?.expires).toBe(-1);

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


test('Today repeated controls run in each exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  for (const stateName of ['today', 'today-no-plan', 'today-paused', 'today-exceeded']) {
    const state = resolveReleaseState(
      RELEASE_STATES.find((candidate) => candidate.name === stateName),
      testInfo.project.name,
    );
    await signOut(page);
    await loginAs(page, state.email);
    await page.goto(state.path);
    const guard = watchForProductProblems(page);
    const expected = Object.entries(EXPECTED_ACTIONS[stateName].coveredBy)
      .filter(([, receipt]) => receipt.test.endsWith(
        'Today repeated controls run in each exact representative state',
      ))
      .map(([action]) => action);
    const receipts = new Set();

    if (expected.includes('Log nicotine use')) {
      const quickLogJump = page.getByRole('link', { name: 'Log nicotine use', exact: true });
      await keyboardActivate(page, quickLogJump);
      await expect(page).toHaveURL(/\/today\/?#quick-log$/);
      await expect(page.locator('#quick-log')).toBeInViewport();
      receipts.add('Log nicotine use');
    }

    const primaryName = expected.find((action) => action.startsWith('Log nicotine use '));
    if (primaryName) {
      await page.goto(state.path);
      const trigger = page.getByRole(stateName === 'today-no-plan' ? 'link' : 'button', {
        name: primaryName,
      });
      await keyboardActivate(page, trigger);
      if (stateName === 'today-no-plan') {
        await expect(page).toHaveURL(/\/log\/(?:add|view)/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      } else {
        const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Log one pouch' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      receipts.add(primaryName);
    }

    const cravingName = 'I have a craving Pause and choose what helps next';
    if (expected.includes(cravingName)) {
      await page.goto(state.path);
      const trigger = page.getByRole('button', { name: cravingName });
      await keyboardActivate(page, trigger);
      const dialog = page.getByRole('dialog', { name: 'Take the next useful step' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'How strong is it right now?' }))
        .toBeFocused();
      const close = dialog.getByRole('button', { name: 'Close craving support' });
      await keyboardActivate(page, close);
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      receipts.add(cravingName);
    }

    expect([...receipts].sort(), `${stateName} repeated-control receipts`)
      .toEqual(expected.sort());
    await expectGuardClean(guard, page, `${stateName} repeated controls`);
  }
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
  expect(response.request().method()).toBe('GET');
  expect(new URL(response.url()).searchParams.get('days')).toBe('30');
  expect(response.request().postData()).toBeNull();
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


test('Insights actions run in every exact representative data state', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const stateNames = ['insights', 'insights-empty', 'insights-sparse'];
  const disclosurePairs = [
    ['View consumption trend data', 'Consumption trend data'],
    ['View time-of-day data', 'Time of day distribution data'],
    ['View weekly pattern data', 'Weekly pattern data'],
    ['View product data', 'Brand preference data'],
  ];

  for (const stateName of stateNames) {
    const state = resolveReleaseState(
      RELEASE_STATES.find((candidate) => candidate.name === stateName),
      testInfo.project.name,
    );
    await signOut(page);
    await loginAs(page, state.email);
    await page.goto(state.path);
    const guard = watchForProductProblems(page);
    const receipts = new Set();

    for (const [name, days] of [
      ['7 days', '7'], ['30 days', '30'], ['90 days', '90'], ['1 year', '365'],
    ]) {
      const responsePending = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/insights'
        && new URL(response.url()).searchParams.get('days') === days
      ));
      await keyboardActivate(page, page.getByRole('link', { name, exact: true }));
      const response = await responsePending;
      expect(response.request().method()).toBe('GET');
      expect(response.status()).toBe(200);
      expect(response.request().postData()).toBeNull();
      await expect(page.getByRole('link', { name, exact: true }))
        .toHaveAttribute('aria-current', 'true');
      receipts.add(name);
    }

    const weekly = page.getByRole('button', { name: 'Weekly' });
    await keyboardActivate(page, weekly);
    await expect(weekly).toHaveAttribute('aria-pressed', 'true');
    receipts.add('Weekly');
    const daily = page.getByRole('button', { name: 'Daily' });
    await keyboardActivate(page, daily);
    await expect(daily).toHaveAttribute('aria-pressed', 'true');
    receipts.add('Daily');

    for (const [summaryName, regionName] of disclosurePairs) {
      const summary = page.getByText(summaryName, { exact: true });
      await keyboardActivate(page, summary);
      const details = summary.locator('..');
      await expect(details).toHaveAttribute('open', '');
      await page.keyboard.press('Tab');
      await expect(details.getByRole('region', { name: regionName })).toBeFocused();
      receipts.add(summaryName);
    }
    const hourlySummary = page.getByText(
      'Open hourly detail and supporting measures', { exact: true },
    );
    await keyboardActivate(page, hourlySummary);
    await expect(hourlySummary.locator('..')).toHaveAttribute('open', '');
    receipts.add('Open hourly detail and supporting measures');

    const exportButton = page.getByRole('button', { name: 'Export CSV' });
    if (state.insightsState === 'empty') {
      let exportRequests = 0;
      const countExport = (request) => {
        if (new URL(request.url()).pathname === '/insights/api/export') exportRequests += 1;
      };
      page.on('request', countExport);
      await keyboardActivate(page, exportButton);
      await expect(page.locator('[data-insights-load-status]'))
        .toContainText('no data to export');
      expect(exportRequests).toBe(0);
      page.off('request', countExport);
    } else {
      const exportResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/export'
      ));
      const downloadStarted = page.waitForEvent('download');
      await keyboardActivate(page, exportButton);
      const [response, download] = await Promise.all([exportResponse, downloadStarted]);
      expect(response.request().method()).toBe('GET');
      expect(new URL(response.url()).searchParams.get('days')).toBe('365');
      expect(response.status()).toBe(200);
      expect(download.suggestedFilename()).toMatch(/^nicotine_data_\d{8}\.csv$/);
    }
    receipts.add('Export CSV');

    const nextActionName = stateName === 'insights'
      ? 'Plan for Afternoon (12PM-6PM)'
      : 'Log today';
    await keyboardActivate(page, page.getByRole('link', { name: nextActionName }));
    await expect(page).toHaveURL(stateName === 'insights' ? /\/journey\/?$/ : /\/today\/?$/);
    receipts.add(nextActionName);

    const pageSpecific = EXPECTED_ACTIONS[stateName]
      .filter((action) => !coreChromeActions(stateName).includes(action));
    expect([...receipts].sort(), `${stateName} runtime action receipts`)
      .toEqual(pageSpecific);
    await expectGuardClean(guard, page, `${stateName} exact actions`, {
      allowAnalytics: true,
    });
  }
});


test('Insights failed range can be retried without losing current data', async ({ page }) => {
  const guard = watchForProductProblems(page);
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
  await expectGuardClean(guard, page, 'Insights expected range failure', {
    allowAnalytics: true,
    expectedHttpErrors: [{
      method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
    }],
  });
});


test('product guard exempts only the exact intentional HTTP failure', async ({ page }) => {
  await page.route('**/insights/api/insights?days=90', (route) => (
    route.fulfill({ status: 503, json: { error: 'temporary' } })
  ));
  await page.route('**/insights/api/insights?days=365', (route) => (
    route.fulfill({ status: 503, json: { error: 'unrelated' } })
  ));
  await page.goto('/');
  const expectedFailure = {
    method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
  };
  const exactGuard = watchForProductProblems(page);
  await page.evaluate(() => fetch('/insights/api/insights?days=90'));
  await expect.poll(() => exactGuard.problems().filter(({ kind }) => kind === 'http-5xx').length)
    .toBe(1);
  exactGuard.assertClean(expect, {
    stateName: 'exact intentional 503', expectedHttpErrors: [expectedFailure],
  });
  exactGuard.stop();

  const unrelatedGuard = watchForProductProblems(page);
  await page.evaluate(() => fetch('/insights/api/insights?days=365'));
  await expect.poll(() => unrelatedGuard.problems().filter(({ kind }) => kind === 'http-5xx').length)
    .toBe(1);
  expect(() => unrelatedGuard.assertClean(expect, {
    stateName: 'unrelated 503', expectedHttpErrors: [expectedFailure],
  })).toThrow(/unrelated 503 product guard findings/);
});


test('Insights range and export expose deterministic pending state', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await loginAs(page, 'release-analytics-ready@example.com');
  await page.goto('/insights/');

  let releaseRange;
  const rangeGate = new Promise((resolve) => { releaseRange = resolve; });
  await page.route('**/insights/api/insights?days=7', async (route) => {
    await rangeGate;
    await route.continue();
  });
  const range = page.getByRole('link', { name: '7 days', exact: true });
  await range.click();
  await expect(page.locator('[data-insights-root]')).toHaveAttribute('aria-busy', 'true');
  await expect(range).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-insights-load-status]')).toContainText('Updating insights');
  releaseRange();
  await expect(range).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-insights-root]')).not.toHaveAttribute('aria-busy', 'true');

  let releaseExport;
  const exportGate = new Promise((resolve) => { releaseExport = resolve; });
  await page.route('**/insights/api/export?days=7', async (route) => {
    await exportGate;
    await route.continue();
  });
  const exportButton = page.getByRole('button', { name: 'Export CSV' });
  const downloadStarted = page.waitForEvent('download');
  await exportButton.click();
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[data-insights-load-status]')).toContainText('Preparing CSV');
  releaseExport();
  await downloadStarted;
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'false');

  await expectGuardClean(guard, page, 'Insights pending states', { allowAnalytics: true });
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
