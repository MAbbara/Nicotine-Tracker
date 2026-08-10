const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const {
  CORE_ACTION_STATES,
  CORE_BEHAVIOR_OBLIGATIONS,
  EXPECTED_ACTIONS,
  RELEASE_STATES,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const {
  OWNER_TITLES,
  createBehaviorRecorder,
  validateCoverage,
} = require('./helpers/core_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


function formPayload(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''));
}


async function keyboardActivate(page, locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}


async function resolvedTokenColor(page, token) {
  return page.locator('body').evaluate((body, property) => {
    const probe = document.createElement('span');
    probe.style.cssText = `position:fixed;visibility:hidden;background:${property}`;
    body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, `var(${token})`);
}


async function readYouRowState(link) {
  return link.evaluate((element) => {
    const icon = element.querySelector(':scope > svg');
    const arrow = element.querySelector(':scope > span[aria-hidden="true"]');
    const style = getComputedStyle(element);
    const accent = getComputedStyle(element, '::before');
    return {
      accentLeft: accent.left,
      accentOpacity: parseFloat(accent.opacity),
      accentRight: accent.right,
      arrowTransform: getComputedStyle(arrow).transform,
      background: style.backgroundColor,
      iconColor: getComputedStyle(icon).color,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  });
}


async function signOut(page) {
  const response = await page.request.get('/auth/logout');
  expect(response.status()).toBe(200);
  await page.goto('/');
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


async function handoffProductGuard(page, sourceGuard, stateName, options = {}) {
  const destinationGuard = watchForProductProblems(page);
  await expectGuardClean(sourceGuard, page, stateName, options);
  sourceGuard.stop();
  destinationGuard.clear();
  return destinationGuard;
}


async function expectKeyboardNavigation(page, locator, expectedPath, {
  expectedStatus = 200,
  finalPath = expectedPath,
} = {}) {
  const navigationPending = page.waitForNavigation({ waitUntil: 'load' });
  const responsePending = page.waitForResponse((response) => (
    response.request().isNavigationRequest()
    && new URL(response.url()).pathname === expectedPath
  ));
  await keyboardActivate(page, locator);
  const [response] = await Promise.all([responsePending, navigationPending]);
  expect(response.request().method()).toBe('GET');
  expect(response.request().postData()).toBeNull();
  expect(response.status()).toBe(expectedStatus);
  await expect.poll(() => new URL(page.url()).pathname).toBe(finalPath);
  return response;
}


test('every core release action names an exact state-scoped behavioral receipt', () => {
  expect(
    CORE_BEHAVIOR_OBLIGATIONS,
    'coverage obligations must be authored independently from coveredBy receipts',
  ).toBeDefined();
  expect(validateCoverage(EXPECTED_ACTIONS, Object.fromEntries(
    CORE_ACTION_STATES.map((state) => [state, EXPECTED_ACTIONS[state].coveredBy]),
  ))).toBe(true);
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
    OWNER_TITLES.todayCheckIn,
  ]);
  for (const [owner, states] of ownerStates) {
    const [ownerFile] = owner.split(' › ');
    const ownerSource = fs.readFileSync(path.resolve(ownerFile), 'utf8');
    expect(ownerSource, `${owner} creates owner-local runtime receipts`)
      .toContain('createBehaviorRecorder');
    expect(ownerSource, `${owner} fails when an obligation is never recorded`)
      .toContain('recorder.assertComplete()');
    if (states.size > 1) {
      expect(exactMultiStateOwners, `${owner} spans ${[...states].join(', ')}`).toContain(owner);
    }
  }
});


test('independent behavior contract rejects omissions, remaps, and dimension overclaims', () => {
  const coverage = Object.fromEntries(CORE_ACTION_STATES.map((state) => [
    state,
    { ...EXPECTED_ACTIONS[state].coveredBy },
  ]));

  delete coverage.landing['Create account'];
  expect(() => validateCoverage(EXPECTED_ACTIONS, coverage)).toThrow(/missing receipt/);
  coverage.landing['Create account'] = EXPECTED_ACTIONS.landing.coveredBy['Create account'];

  coverage.today['Edit reflection'] = {
    ...coverage.today['Edit reflection'],
    test: OWNER_TITLES.todayRepeated,
  };
  expect(() => validateCoverage(EXPECTED_ACTIONS, coverage)).toThrow(/owner mismatch/);
  coverage.today['Edit reflection'] = EXPECTED_ACTIONS.today.coveredBy['Edit reflection'];

  coverage.insights['30 days'] = {
    ...coverage.insights['30 days'],
    dimensions: {
      ...coverage.insights['30 days'].dimensions,
      persistence: { status: 'asserted', reason: 'Unproven durable selection.' },
    },
  };
  expect(() => validateCoverage(EXPECTED_ACTIONS, coverage)).toThrow(/dimension evidence mismatch/);

  const syntheticOwner = 'synthetic owner with an unproved focus claim';
  const syntheticObligation = Object.freeze({
    state: 'synthetic-state',
    action: 'Synthetic action',
    owner: syntheticOwner,
    dimensions: Object.freeze({
      error: { status: 'not-applicable', reason: 'Synthetic synchronous action.' },
      focus: { status: 'asserted', reason: 'Deliberately overclaimed focus evidence.' },
      keyboard: { status: 'asserted', reason: 'Keyboard evidence is recorded.' },
      loading: { status: 'not-applicable', reason: 'Synthetic synchronous action.' },
      persistence: { status: 'not-applicable', reason: 'Synthetic transient action.' },
      request: { status: 'not-applicable', reason: 'Synthetic local action.' },
    }),
  });
  const incompleteRecorder = createBehaviorRecorder(
    syntheticOwner, expect, [syntheticObligation],
  );
  expect(() => incompleteRecorder.record(
    'synthetic-state', 'Synthetic action', ['keyboard'],
  )).not.toThrow();
  expect(() => incompleteRecorder.assertComplete()).toThrow(/focus/);

  const mandatoryLandingRecorder = createBehaviorRecorder(
    OWNER_TITLES.landing, expect, [],
  );
  expect(() => mandatoryLandingRecorder.assertComplete())
    .toThrow(/runtime dimension evidence/);

  const landingCreate = CORE_BEHAVIOR_OBLIGATIONS.find((obligation) => (
    obligation.state === 'landing' && obligation.action === 'Create account'
  ));
  expect(() => createBehaviorRecorder(
    OWNER_TITLES.landing, expect, [landingCreate],
  )).toThrow(/mandatory core obligation/);
  expect(() => createBehaviorRecorder(
    syntheticOwner, expect, [syntheticObligation, syntheticObligation],
  )).toThrow(/duplicate injected obligation/);
});


test('every core chrome action runs in its exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const states = CORE_ACTION_STATES.map((name) => (
    resolveReleaseState(RELEASE_STATES.find((state) => state.name === name), testInfo.project.name)
  ));
  const recorder = createBehaviorRecorder(OWNER_TITLES.chrome, expect);

  for (const state of states) {
    if (state.email) {
      await signOut(page);
      await loginAs(page, state.email);
    } else {
      await signOut(page);
    }

    let sourceGuard = watchForProductProblems(page);
    await page.goto(state.path);
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await keyboardActivate(page, skip);
    await expect(page.locator('#main-content')).toBeFocused();
    recorder.record(state.name, 'Skip to main content', ['focus', 'keyboard']);
    await expectGuardClean(sourceGuard, page, `${state.name} skip`, {
      allowAnalytics: state.allowAnalytics,
    });
    sourceGuard.stop();

    sourceGuard = watchForProductProblems(page);
    await page.goto(state.path);
    let destinationGuard = await handoffProductGuard(
      page, sourceGuard, `${state.name} before wordmark`, { allowAnalytics: state.allowAnalytics },
    );
    await expectKeyboardNavigation(
      page,
      page.getByRole('link', { name: 'Nicotine Tracker home' }),
      state.email ? '/today/' : '/',
    );
    recorder.record(state.name, 'Nicotine Tracker home', ['keyboard', 'request']);
    await expectGuardClean(destinationGuard, page, `${state.name} wordmark destination`);
    destinationGuard.stop();

    if (state.email) {
      sourceGuard = watchForProductProblems(page);
      await page.goto(state.path);
      const accountName = `Open your space for ${state.email}`;
      destinationGuard = await handoffProductGuard(
        page, sourceGuard, `${state.name} before account`, { allowAnalytics: state.allowAnalytics },
      );
      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: accountName }), '/you/',
      );
      recorder.record(state.name, accountName, ['keyboard', 'request']);
      await expectGuardClean(destinationGuard, page, `${state.name} account destination`);
      destinationGuard.stop();

      for (const [name, path, destinationAllowsAnalytics] of [
        ['Today', '/today/', false],
        ['Logbook', '/log/view', false],
        ['Journey', '/journey/', false],
        ['Insights', '/insights/', true],
        ['You', '/you/', false],
      ]) {
        sourceGuard = watchForProductProblems(page);
        await page.goto(state.path);
        const link = page.getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name, exact: true });
        const currentDestination = (
          (name === 'Today' && state.name.startsWith('today'))
          || (name === 'Journey' && state.name === 'journey')
          || (name === 'Insights' && state.name.startsWith('insights'))
          || (name === 'You' && state.name === 'you')
        );
        if (currentDestination) {
          await keyboardActivate(page, link);
          await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}#main-content$`));
          await expect(page.locator('#main-content')).toBeFocused();
          recorder.record(state.name, name, ['focus', 'keyboard']);
          await expectGuardClean(sourceGuard, page, `${state.name} current ${name}`, {
            allowAnalytics: state.allowAnalytics,
          });
          sourceGuard.stop();
          continue;
        }
        destinationGuard = await handoffProductGuard(
          page, sourceGuard, `${state.name} before ${name}`, { allowAnalytics: state.allowAnalytics },
        );
        await expectKeyboardNavigation(page, link, path);
        await expect(page.locator('#main-content')).toBeFocused();
        recorder.record(state.name, name, ['focus', 'keyboard', 'request']);
        await expectGuardClean(destinationGuard, page, `${state.name} ${name} destination`, {
          allowAnalytics: destinationAllowsAnalytics,
        });
        destinationGuard.stop();
      }
    }
  }
  recorder.assertComplete();
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
    ['Logbook', '/log/view'],
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


test('every You link has restrained theme-aware keyboard, pointer, and touch states', async ({ page }, testInfo) => {
  await loginAs(page, 'release-settings@example.com');
  const touchProject = testInfo.project.name.includes('mobile');

  for (const theme of ['light', 'dark']) {
    await page.goto('/you/');
    await page.evaluate((value) => localStorage.setItem('nicotine-tracker-theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const rows = page.locator('.you-links > a');
    await expect(rows).toHaveCount(5);
    const raisedSurface = await resolvedTokenColor(page, '--color-surface-raised');

    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      await row.scrollIntoViewIfNeeded();
      const rest = await readYouRowState(row);

      await row.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(row).toBeFocused();
      expect(await row.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      const focused = await readYouRowState(row);
      expect(focused.outlineStyle).not.toBe('none');
      expect(focused.outlineWidth).toBeGreaterThanOrEqual(3);

      if (touchProject) {
        await row.evaluate((element) => {
          element.addEventListener('click', (event) => event.preventDefault(), { once: true });
        });
        await row.tap();
        const afterTap = await readYouRowState(row);
        expect(afterTap.background).toBe(rest.background);
        expect(afterTap.arrowTransform).toBe(rest.arrowTransform);
        continue;
      }

      await row.hover();
      await expect.poll(async () => (await readYouRowState(row)).accentOpacity).toBe(1);
      const hovered = await readYouRowState(row);
      expect(hovered.background).not.toBe(rest.background);
      expect(hovered.background).not.toBe(raisedSurface);
      expect(hovered.iconColor).not.toBe(rest.iconColor);
      expect(hovered.arrowTransform).not.toBe(rest.arrowTransform);

      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      await row.evaluate((element) => {
        element.addEventListener('click', (event) => event.preventDefault(), { once: true });
      });
      await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
      await page.mouse.down();
      await expect.poll(async () => (await readYouRowState(row)).transform)
        .not.toBe(rest.transform);
      await page.mouse.up();

      await row.evaluate((element) => { document.documentElement.dir = 'rtl'; });
      const rtlAccent = await readYouRowState(row);
      expect(parseFloat(rtlAccent.accentRight)).toBeLessThanOrEqual(1);
      expect(parseFloat(rtlAccent.accentLeft)).toBeGreaterThan(1);
      await row.evaluate(() => { document.documentElement.dir = 'ltr'; });
    }
  }
});


test('You link motion collapses under the reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAs(page, 'release-settings@example.com');
  await page.goto('/you/');

  const rows = page.locator('.you-links > a');
  for (let index = 0; index < await rows.count(); index += 1) {
    const durations = (await readYouRowState(rows.nth(index))).transitionDuration
      .split(',')
      .map((value) => parseFloat(value) * (value.includes('ms') ? 0.001 : 1));
    expect(Math.max(...durations)).toBeLessThanOrEqual(0.001);
  }
});


test('authentication links reach the neighboring recovery or account form', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.authLinks, expect);
  for (const [stateName, source, action, destination] of [
    ['login', '/auth/login', 'Create one here', '/auth/register'],
    ['login', '/auth/login', 'Forgot password?', '/auth/forgot_password'],
    ['register', '/auth/register', 'Sign in here', '/auth/login'],
    ['forgot-password', '/auth/forgot_password', 'Sign in here', '/auth/login'],
    [
      'reset-password', '/auth/reset_password/browser-accessibility-reset-token',
      'Sign in here', '/auth/login',
    ],
  ]) {
    await page.goto(source);
    await expectKeyboardNavigation(page, page.getByRole('link', { name: action }), destination);
    recorder.record(stateName, action, ['keyboard', 'request']);
  }
  recorder.assertComplete();

  await expectGuardClean(guard, page, 'authentication links');
});


test('login validation and Remember me preserve the authenticated session', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.authLogin, expect);
  await page.goto('/auth/login');

  const invalidLoginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByLabel('Email address').fill('release-settings@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await keyboardActivate(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  const invalidLogin = await invalidLoginResponse;
  expect(invalidLogin.status()).toBe(200);
  expect(formPayload(invalidLogin.request())).toEqual(expect.objectContaining({
    email: 'release-settings@example.com',
    password: 'wrong-password',
  }));
  await expect(page.getByRole('status')).toContainText('Invalid email or password.');

  await page.getByLabel('Email address').fill('release-settings@example.com');
  await page.getByLabel('Password').fill('browser-password');
  const remember = page.getByRole('checkbox', { name: 'Remember me' });
  await remember.focus();
  await page.keyboard.press('Space');
  await expect(remember).toBeChecked();
  const validLoginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/login'
    && response.request().method() === 'POST'
  ));
  await keyboardActivate(page, page.getByRole('button', { name: 'Sign in', exact: true }));
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
  recorder.record('login', 'Remember me', ['keyboard', 'persistence']);
  recorder.record('login', 'Sign in', ['error', 'keyboard', 'persistence', 'request']);
  recorder.assertComplete();

  await expectGuardClean(guard, page, 'login validation and session');
});


test('forgot form enforces validation and preserves a neutral recovery response', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.authForgot, expect);
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
  await keyboardActivate(page, page.getByRole('button', { name: 'Send reset link' }));
  await expect(forgotEmail).toBeFocused();
  expect(await forgotEmail.evaluate((element) => element.validity.typeMismatch)).toBe(true);
  expect(forgotPosts).toBe(0);

  await forgotEmail.fill('no-release-account@example.com');
  const forgotResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/forgot_password'
    && response.request().method() === 'POST'
  ));
  await keyboardActivate(page, page.getByRole('button', { name: 'Send reset link' }));
  const forgot = await forgotResponse;
  expect(forgot.status()).toBe(302);
  expect(formPayload(forgot.request())).toEqual(expect.objectContaining({
    email: 'no-release-account@example.com',
  }));
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole('status')).toContainText(
    'If an account with that email exists, a password reset link has been sent.',
  );
  recorder.record(
    'forgot-password', 'Send reset link', ['error', 'focus', 'keyboard', 'request'],
  );
  recorder.assertComplete();

  await expectGuardClean(guard, page, 'forgot-password validation');
});


test('reset form enforces native and matching validation without consuming the token', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.authReset, expect);

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
  await keyboardActivate(page, page.getByRole('button', { name: 'Reset password' }));
  await expect(newPassword).toBeFocused();
  expect(await newPassword.evaluate((element) => element.validity.tooShort)).toBe(true);
  expect(resetPosts).toBe(0);

  await newPassword.fill('browser-password');
  await confirmation.fill('different-password');
  await keyboardActivate(page, page.getByRole('button', { name: 'Reset password' }));
  await expect(confirmation).toBeFocused();
  expect(await confirmation.evaluate((element) => element.validity.customError)).toBe(true);
  expect(resetPosts).toBe(0);
  await confirmation.fill('browser-password');
  expect(await confirmation.evaluate((element) => element.validity.valid)).toBe(true);
  recorder.record(
    'reset-password', 'Reset password', ['error', 'focus', 'keyboard', 'request'],
  );
  recorder.assertComplete();

  await expectGuardClean(guard, page, 'reset-password validation');
});


test('exact Today check-in actions open and return focus in their representative fixtures', async ({ page }) => {
  const recorder = createBehaviorRecorder(OWNER_TITLES.todayCheckIn, expect);
  for (const [stateName, email, actionName, cancelName] of [
    ['today', 'today-targeted@example.com', 'Edit reflection', 'Keep saved reflection'],
    ['today-exceeded', 'today-exceeded@example.com', 'Take a short check-in', 'Not now'],
  ]) {
    await signOut(page);
    await loginAs(page, email);
    const guard = watchForProductProblems(page);
    const action = page.getByRole('button', { name: actionName, exact: true });
    await keyboardActivate(page, action);
    const form = page.locator('[data-check-in-form]');
    await expect(form).toBeVisible();
    await expect(form.locator('[name="mood"]').first()).toBeFocused();
    await keyboardActivate(page, form.getByRole('button', { name: cancelName }));
    await expect(form).toBeHidden();
    await expect(action).toBeFocused();
    recorder.record(stateName, actionName, ['focus', 'keyboard']);
    await expectGuardClean(guard, page, `${stateName} exact check-in`);
    guard.stop();
  }
  recorder.assertComplete();
});


test('Today fallback and recovery links reach their intended next action', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.todayLinks, expect);
  await loginAs(page, 'browser@example.com');

  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Create a plan', exact: true }),
    '/journey/onboarding',
  );
  recorder.record('today-no-plan', 'Create a plan', ['keyboard', 'request']);
  await page.goto('/today/');
  const neutral = page.getByRole('link', { name: 'Continue neutral tracking' });
  await expectKeyboardNavigation(page, neutral, '/log/view');
  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
  recorder.record('today-no-plan', 'Continue neutral tracking', ['keyboard', 'request']);
  await page.goto('/today/');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Log your first nicotine use' }), '/log/view',
  );
  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
  recorder.record('today-no-plan', 'Log your first nicotine use', ['keyboard', 'request']);

  await signOut(page);
  await loginAs(page, 'today-paused@example.com');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Review or resume in Journey' }), '/journey/',
  );
  recorder.record('today-paused', 'Review or resume in Journey', ['keyboard', 'request']);

  await signOut(page);
  await loginAs(page, 'today-exceeded@example.com');
  await keyboardActivate(page, page.getByRole('link', { name: 'Keep logging' }));
  await expect(page).toHaveURL(/\/today\/#quick-log$/);
  await expect(page.locator('#quick-log')).toBeInViewport();
  recorder.record('today-exceeded', 'Keep logging', ['keyboard']);
  await keyboardActivate(page, page.getByRole('link', { name: 'Reflect on today' }));
  await expect(page).toHaveURL(/\/today\/#check-in$/);
  await expect(page.locator('#check-in')).toBeInViewport();
  recorder.record('today-exceeded', 'Reflect on today', ['keyboard']);
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Review the plan in Journey' }), '/journey/',
  );
  recorder.record('today-exceeded', 'Review the plan in Journey', ['keyboard', 'request']);
  await page.goto('/today/');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Pause or revise in Journey' }), '/journey/',
  );
  recorder.record('today-exceeded', 'Pause or revise in Journey', ['keyboard', 'request']);
  recorder.assertComplete();

  await expectGuardClean(guard, page, 'Today fallback and recovery actions');
});


test('Today repeated controls run in each exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const recorder = createBehaviorRecorder(OWNER_TITLES.todayRepeated, expect);
  for (const stateName of ['today', 'today-no-plan', 'today-paused', 'today-exceeded']) {
    const state = resolveReleaseState(
      RELEASE_STATES.find((candidate) => candidate.name === stateName),
      testInfo.project.name,
    );
    await signOut(page);
    await loginAs(page, state.email);
    await page.goto(state.path);
    const guard = watchForProductProblems(page);
    const expected = CORE_BEHAVIOR_OBLIGATIONS
      .filter((entry) => entry.owner === OWNER_TITLES.todayRepeated && entry.state === stateName)
      .map(({ action }) => action);

    if (expected.includes('Log nicotine use')) {
      const quickLogJump = page.getByRole('link', { name: 'Log nicotine use', exact: true });
      await keyboardActivate(page, quickLogJump);
      await expect(page).toHaveURL(/\/today\/?#quick-log$/);
      await expect(page.locator('#quick-log')).toBeInViewport();
      recorder.record(stateName, 'Log nicotine use', ['keyboard']);
    }

    const primaryName = expected.find((action) => action.startsWith('Log nicotine use '));
    if (primaryName) {
      await page.goto(state.path);
      const trigger = page.getByRole(stateName === 'today-no-plan' ? 'link' : 'button', {
        name: primaryName,
      });
      if (stateName === 'today-no-plan') {
        const href = await trigger.getAttribute('href');
        const destinationPath = new URL(href, page.url()).pathname;
        await expectKeyboardNavigation(page, trigger, destinationPath, {
          expectedStatus: 302,
          finalPath: '/log/view',
        });
        await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        recorder.record(stateName, primaryName, ['keyboard', 'request']);
      } else {
        await keyboardActivate(page, trigger);
        const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Log one pouch' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        recorder.record(stateName, primaryName, ['focus', 'keyboard']);
      }
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
      recorder.record(stateName, cravingName, ['focus', 'keyboard']);
    }
    await expectGuardClean(guard, page, `${stateName} repeated controls`);
  }
  recorder.assertComplete();
});


test('uncovered onboarding choices and Journey handoffs preserve user control', async ({ page }) => {
  const guard = watchForProductProblems(page);
  const recorder = createBehaviorRecorder(OWNER_TITLES.journeyChoices, expect);
  await loginAs(page, 'browser@example.com');
  await page.goto('/journey/onboarding');

  const quit = page.getByRole('radio', {
    name: 'Quit by a date Build a schedule that ends at zero.',
  });
  await quit.focus();
  await page.keyboard.press('Space');
  await expect(quit).toBeChecked();
  await expect(page.locator('.onboarding-margin')).toContainText('Quit by a date');
  recorder.record(
    'journey-onboarding',
    'Quit by a date Build a schedule that ends at zero.',
    ['focus', 'keyboard'],
  );

  const observe = page.getByRole('radio', {
    name: 'Understand my baseline first Track for seven days without a reduction target.',
  });
  await observe.focus();
  await page.keyboard.press('Space');
  await expect(observe).toBeChecked();
  await expect(page.locator('.onboarding-margin')).toContainText('Understand my baseline first');
  recorder.record(
    'journey-onboarding',
    'Understand my baseline first Track for seven days without a reduction target.',
    ['focus', 'keyboard'],
  );

  await signOut(page);
  await loginAs(page, 'journey-review-desktop@example.com');
  await page.goto('/journey/');
  for (const action of [
    'Mon 48.00 mg Current', 'Tue 47.50 mg Aug 4', 'Wed 47.00 mg Aug 5',
    'Thu 46.50 mg Aug 6', 'Fri 46.00 mg Aug 7', 'Sat 45.50 mg Aug 8',
    'Sun 45.00 mg Aug 9',
  ]) {
    const day = page.getByRole('button', { name: action, exact: true });
    await day.focus();
    await page.keyboard.press('Enter');
    await expect(day).toBeFocused();
    await expect(day).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-journey-day][aria-pressed="true"]')).toHaveCount(1);
    recorder.record('journey', action, ['focus', 'keyboard']);
  }
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Review this draft' }), '/journey/onboarding',
  );
  await expect(page.getByRole('heading', { name: 'Choose your intention' })).toBeFocused();
  recorder.record('journey', 'Review this draft', ['keyboard', 'request']);

  await signOut(page);
  await loginAs(page, 'today-targeted@example.com');
  await page.goto('/journey/');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Log nicotine or respond to a craving' }), '/today/',
  );
  recorder.record(
    'journey', 'Log nicotine or respond to a craving', ['keyboard', 'request'],
  );
  recorder.assertComplete();

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
    ['View time-of-day data', 'Time of day nicotine data'],
    ['View weekly pattern data', 'Weekly pattern data'],
    ['View product data', 'Product nicotine data'],
  ]) {
    const summary = page.getByText(summaryName, { exact: true });
    const region = page.getByRole('region', { name: regionName, exact: true });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(region).toHaveCount(1);
    await expect(region).toBeVisible();
    await expect(region.locator('tbody tr')).not.toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(region).toBeFocused();
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
  test.setTimeout(180_000);
  const stateNames = ['insights', 'insights-empty', 'insights-sparse'];
  const recorder = createBehaviorRecorder(OWNER_TITLES.insights, expect);
  const disclosurePairs = [
    ['View consumption trend data', 'Consumption trend data'],
    ['View time-of-day data', 'Time of day nicotine data'],
    ['View weekly pattern data', 'Weekly pattern data'],
    ['View product data', 'Product nicotine data'],
  ];

  for (const stateName of stateNames) {
    const state = resolveReleaseState(
      RELEASE_STATES.find((candidate) => candidate.name === stateName),
      testInfo.project.name,
    );
    await signOut(page);
    await loginAs(page, state.email);
    const guard = watchForProductProblems(page);
    await page.goto(state.path);

    const rangeAttempts = new Map();
    let releaseRangeFailure;
    await page.route('**/insights/api/insights?days=*', async (route) => {
      const days = new URL(route.request().url()).searchParams.get('days');
      const attempts = (rangeAttempts.get(days) || 0) + 1;
      rangeAttempts.set(days, attempts);
      if (attempts === 1) {
        await new Promise((resolve) => { releaseRangeFailure = resolve; });
        await route.fulfill({ status: 503, json: { error: 'controlled range failure' } });
        return;
      }
      await route.continue();
    });

    for (const [name, days] of [
      ['7 days', '7'], ['30 days', '30'], ['90 days', '90'], ['1 year', '365'],
    ]) {
      const beforeCurrent = await page.locator('[data-days][aria-current="true"]')
        .getAttribute('data-days');
      const range = page.getByRole('link', { name, exact: true });
      const failedResponsePending = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/insights'
        && new URL(response.url()).searchParams.get('days') === days
        && response.status() === 503
      ));
      await keyboardActivate(page, range);
      await expect(page.locator('[data-insights-root]')).toHaveAttribute('aria-busy', 'true');
      await expect(range).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('[data-days][aria-current="true"]'))
        .toHaveAttribute('data-days', beforeCurrent);
      await expect(page.locator('[data-insights-load-status]')).toContainText('Updating insights');
      releaseRangeFailure();
      const failedResponse = await failedResponsePending;
      expect(failedResponse.request().method()).toBe('GET');
      expect(failedResponse.request().postData()).toBeNull();
      await expect(page.locator('[data-insights-load-status]'))
        .toContainText('choose the range again to retry');
      await expect(range).toBeFocused();
      await expect(page.locator('[data-insights-root]')).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('[data-days][aria-current="true"]'))
        .toHaveAttribute('data-days', beforeCurrent);

      const responsePending = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/insights'
        && new URL(response.url()).searchParams.get('days') === days
        && response.status() === 200
      ));
      await keyboardActivate(page, range);
      const response = await responsePending;
      expect(response.request().method()).toBe('GET');
      expect(response.status()).toBe(200);
      expect(response.request().postData()).toBeNull();
      await expect(range).toHaveAttribute('aria-current', 'true');
      await expect(range).toBeFocused();
      recorder.record(stateName, name, ['error', 'focus', 'keyboard', 'loading', 'request']);
    }
    await page.unroute('**/insights/api/insights?days=*');

    const weekly = page.getByRole('button', { name: 'Weekly' });
    await keyboardActivate(page, weekly);
    await expect(weekly).toHaveAttribute('aria-pressed', 'true');
    await expect(weekly).toBeFocused();
    recorder.record(stateName, 'Weekly', ['focus', 'keyboard']);
    const daily = page.getByRole('button', { name: 'Daily' });
    await keyboardActivate(page, daily);
    await expect(daily).toHaveAttribute('aria-pressed', 'true');
    await expect(daily).toBeFocused();
    recorder.record(stateName, 'Daily', ['focus', 'keyboard']);

    for (const [summaryName, regionName] of disclosurePairs) {
      const summary = page.getByText(summaryName, { exact: true });
      await keyboardActivate(page, summary);
      const region = page.getByRole('region', { name: regionName, exact: true });
      await expect(region).toHaveCount(1);
      await expect(region).toBeVisible();
      await expect(region.locator('tbody tr')).not.toHaveCount(0);
      await page.keyboard.press('Tab');
      await expect(region).toBeFocused();
      recorder.record(stateName, summaryName, ['focus', 'keyboard']);
    }
    const hourlySummary = page.getByText(
      'Open hourly detail and supporting measures', { exact: true },
    );
    await keyboardActivate(page, hourlySummary);
    await expect(hourlySummary.locator('..')).toHaveAttribute('open', '');
    await expect(hourlySummary).toBeFocused();
    recorder.record(
      stateName, 'Open hourly detail and supporting measures', ['focus', 'keyboard'],
    );

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
      await expect(exportButton).toBeFocused();
      expect(exportRequests).toBe(0);
      page.off('request', countExport);
      recorder.record(stateName, 'Export CSV', ['error', 'focus', 'keyboard', 'request']);
    } else {
      let exportAttempts = 0;
      let releaseExportFailure;
      await page.route('**/insights/api/export?days=365', async (route) => {
        exportAttempts += 1;
        if (exportAttempts === 1) {
          await new Promise((resolve) => { releaseExportFailure = resolve; });
          await route.fulfill({ status: 503, body: 'controlled export failure' });
          return;
        }
        await route.continue();
      });
      const failedExportPending = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/export'
        && response.status() === 503
      ));
      await keyboardActivate(page, exportButton);
      await expect(exportButton).toBeDisabled();
      await expect(exportButton).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('[data-insights-load-status]')).toContainText('Preparing CSV');
      releaseExportFailure();
      const failedExport = await failedExportPending;
      expect(failedExport.request().method()).toBe('GET');
      expect(failedExport.request().postData()).toBeNull();
      await expect(page.locator('[data-insights-load-status]'))
        .toContainText('CSV could not be prepared');
      await expect(exportButton).toBeEnabled();
      await expect(exportButton).toHaveAttribute('aria-busy', 'false');
      await expect(exportButton).toBeFocused();

      const exportResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/insights/api/export'
        && response.status() === 200
      ));
      const downloadStarted = page.waitForEvent('download');
      await keyboardActivate(page, exportButton);
      const [response, download] = await Promise.all([exportResponse, downloadStarted]);
      expect(response.request().method()).toBe('GET');
      expect(new URL(response.url()).searchParams.get('days')).toBe('365');
      expect(response.request().postData()).toBeNull();
      expect(response.status()).toBe(200);
      expect(download.suggestedFilename()).toMatch(/^nicotine_data_\d{8}\.csv$/);
      await expect(exportButton).toBeFocused();
      expect(exportAttempts).toBe(2);
      await page.unroute('**/insights/api/export?days=365');
      recorder.record(
        stateName, 'Export CSV', ['error', 'focus', 'keyboard', 'loading', 'request'],
      );
    }

    const nextActionName = stateName === 'insights'
      ? 'Plan for Afternoon (12PM-6PM)'
      : 'Log today';
    const destinationPath = stateName === 'insights' ? '/journey/' : '/today/';
    const destinationGuard = await handoffProductGuard(page, guard, `${stateName} exact actions`, {
      allowAnalytics: true,
      expectedHttpErrors: [
        ...['7', '30', '90', '365'].map((days) => ({
          method: 'GET', path: `/insights/api/insights?days=${days}`, status: 503, count: 1,
        })),
        ...(state.insightsState === 'empty' ? [] : [{
          method: 'GET', path: '/insights/api/export?days=365', status: 503, count: 1,
        }]),
      ],
    });
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: nextActionName }), destinationPath,
    );
    recorder.record(stateName, nextActionName, ['keyboard', 'request']);
    await expectGuardClean(destinationGuard, page, `${stateName} next-step destination`);
    destinationGuard.stop();
  }
  recorder.assertComplete();
});


test('pending Insights export preserves an intentional focus move', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAs(page, 'release-analytics-ready@example.com');
  await page.goto('/insights/');

  let releaseExport;
  const exportGate = new Promise((resolve) => { releaseExport = resolve; });
  await page.route('**/insights/api/export?days=30', async (route) => {
    await exportGate;
    await route.continue();
  });

  const exportButton = page.getByRole('button', { name: 'Export CSV' });
  const weekly = page.getByRole('button', { name: 'Weekly' });
  const downloadStarted = page.waitForEvent('download');
  await keyboardActivate(page, exportButton);
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'true');
  await weekly.focus();
  await expect(weekly).toBeFocused();
  releaseExport();
  await downloadStarted;
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'false');
  await expect(weekly).toBeFocused();
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
  await page.evaluate(async () => {
    const controller = new AbortController();
    await fetch('/insights/api/insights?days=90', { signal: controller.signal });
    controller.abort();
  });
  await expect.poll(() => exactGuard.problems().filter(({ kind }) => kind === 'http-5xx').length)
    .toBe(1);
  await expect.poll(() => exactGuard.problems().filter(({ kind }) => (
    kind === 'request-failed'
  )).length).toBe(1);
  exactGuard.assertClean(expect, {
    stateName: 'exact intentional 503', expectedHttpErrors: [expectedFailure],
  });
  exactGuard.stop();

  const unrelatedGuard = watchForProductProblems(page);
  await page.evaluate(async () => {
    const controller = new AbortController();
    await fetch('/insights/api/insights?days=365', { signal: controller.signal });
    controller.abort();
  });
  await expect.poll(() => unrelatedGuard.problems().filter(({ kind }) => kind === 'http-5xx').length)
    .toBe(1);
  await expect.poll(() => unrelatedGuard.problems().filter(({ kind }) => (
    kind === 'request-failed'
  )).length).toBe(1);
  expect(() => unrelatedGuard.assertClean(expect, {
    stateName: 'unrelated 503', expectedHttpErrors: [expectedFailure],
  })).toThrow(/unrelated 503 product guard findings/);
});


test('transition guard rejects analytics leakage from Insights into non-analytics destinations', async ({ page }) => {
  await page.addInitScript(() => {
    if (['/today/', '/log/view', '/journey/', '/you/'].includes(window.location.pathname)) {
      window.addEventListener('DOMContentLoaded', () => {
        fetch('/static/js/analytics/runtime.js');
      }, { once: true });
    }
  });
  await loginAs(page, 'release-analytics-ready@example.com');

  for (const [name, path] of [
    ['Today', '/today/'], ['Logbook', '/log/view'],
    ['Journey', '/journey/'], ['You', '/you/'],
  ]) {
    const sourceGuard = watchForProductProblems(page);
    await page.goto('/insights/');
    const destinationGuard = await handoffProductGuard(
      page, sourceGuard, `Insights before injected ${name}`, { allowAnalytics: true },
    );
    await keyboardActivate(
      page,
      page.getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name, exact: true }),
    );
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}#main-content$`));
    await page.waitForLoadState('networkidle');
    expect(() => destinationGuard.assertClean(expect, {
      stateName: `injected Insights to ${name}`,
      expectedStatus: 200,
      expectedPath: path,
      allowAnalytics: false,
    })).toThrow(/analytics-bundle/);
    destinationGuard.stop();
  }
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
  const beforeCurrent = await page.locator('[data-days][aria-current="true"]')
    .getAttribute('data-days');
  await range.click();
  await expect(page.locator('[data-insights-root]')).toHaveAttribute('aria-busy', 'true');
  await expect(range).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[data-days][aria-current="true"]'))
    .toHaveAttribute('data-days', beforeCurrent);
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
  const recorder = createBehaviorRecorder(OWNER_TITLES.youLinks, expect);
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
    await expectKeyboardNavigation(page, link, path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    recorder.record('you', name, ['keyboard', 'request']);
  }

  expect(unusedBundles).toEqual([]);
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'You settings and catalog links');
});
