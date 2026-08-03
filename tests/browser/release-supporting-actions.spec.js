const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const {
  EXPECTED_ACTIONS,
  RELEASE_STATES,
  SUPPORTING_ACTION_STATES,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const {
  SUPPORTING_BEHAVIOR_OBLIGATIONS,
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
  validateSupportingCoverage,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


async function keyboardActivate(page, locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}


async function signOut(page) {
  const response = await page.request.get('/auth/logout');
  expect(response.status()).toBe(200);
  await page.goto('/');
}


async function visitState(page, state) {
  const response = await page.goto(state.path);
  expect(response.status()).toBe(state.status);
  await page.waitForLoadState('networkidle');
  const openDialog = page.locator('dialog[open]');
  if (await openDialog.count()) {
    await page.keyboard.press('Escape');
    await expect(openDialog).toHaveCount(0);
  }
  return response;
}


async function expectGuardClean(guard, page, stateName, {
  allowAnalytics = false,
  expectedStatus = 200,
} = {}) {
  await page.waitForLoadState('networkidle');
  guard.assertClean(expect, {
    stateName,
    expectedStatus,
    expectedPath: new URL(page.url()).pathname,
    allowAnalytics,
  });
}


async function handoffProductGuard(page, sourceGuard, stateName, options = {}) {
  const destinationGuard = watchForProductProblems(page);
  await expectGuardClean(sourceGuard, page, stateName, options);
  sourceGuard.stop();
  destinationGuard.clear();
  return destinationGuard;
}


async function expectKeyboardNavigation(page, locator, expectedPath, expectedStatus = 200) {
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
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
  return response;
}


async function registerDisposable(page, testInfo, label) {
  const suffix = `${label}-${testInfo.project.name}-${testInfo.workerIndex}`
    .replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const email = `${suffix}@example.com`;
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(email);
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding$/);
  return email;
}


function formPayload(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''));
}


test('every supporting action has an independent exact behavior obligation', () => {
  expect(SUPPORTING_BEHAVIOR_OBLIGATIONS).toHaveLength(376);
  expect(validateSupportingCoverage(
    EXPECTED_ACTIONS,
    Object.fromEntries(SUPPORTING_ACTION_STATES.map((state) => [
      state,
      EXPECTED_ACTIONS[state].coveredBy,
    ])),
  )).toBe(true);

  const owners = new Set(SUPPORTING_BEHAVIOR_OBLIGATIONS.map(({ owner }) => owner));
  for (const owner of owners) {
    const [ownerFile, ownerTitle] = owner.split(' › ');
    const source = fs.readFileSync(path.resolve(ownerFile), 'utf8');
    expect(source, `${owner} test declaration`).toContain(`test('${ownerTitle}'`);
    expect(source, `${owner} runtime recorder`).toContain('createSupportingBehaviorRecorder');
    expect(source, `${owner} complete runtime evidence`).toContain('recorder.assertComplete()');
  }

  const coverage = Object.fromEntries(SUPPORTING_ACTION_STATES.map((state) => [
    state,
    { ...EXPECTED_ACTIONS[state].coveredBy },
  ]));
  delete coverage.profile['Save profile'];
  expect(() => validateSupportingCoverage(EXPECTED_ACTIONS, coverage))
    .toThrow(/missing supporting receipt/);
  coverage.profile['Save profile'] = EXPECTED_ACTIONS.profile.coveredBy['Save profile'];
  coverage.profile['Save profile'] = {
    ...coverage.profile['Save profile'],
    test: SUPPORTING_OWNER_TITLES.settingsPreferences,
  };
  expect(() => validateSupportingCoverage(EXPECTED_ACTIONS, coverage))
    .toThrow(/supporting owner mismatch/);

  const emptyProfileRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  expect(() => emptyProfileRecorder.assertComplete())
    .toThrow(/supporting runtime dimension evidence/);
});


test('every supporting chrome action runs in its exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(720_000);
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.chrome, expect);
  const states = SUPPORTING_ACTION_STATES.map((name) => resolveReleaseState(
    RELEASE_STATES.find((state) => state.name === name),
    testInfo.project.name,
  ));

  for (const state of states) {
    await test.step(`supporting chrome in ${state.name}`, async () => {
    await signOut(page);
    if (state.email) await loginAs(page, state.email);

    let sourceGuard = watchForProductProblems(page);
    await visitState(page, state);
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await skip.focus();
    await expect(skip, `skip link should retain focus in ${state.name}`).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    recorder.record(state.name, 'Skip to main content', ['focus', 'keyboard']);
    await expectGuardClean(sourceGuard, page, `${state.name} skip`, {
      allowAnalytics: state.allowAnalytics,
      expectedStatus: state.status,
    });
    sourceGuard.stop();

    sourceGuard = watchForProductProblems(page);
    await visitState(page, state);
    let destinationGuard = await handoffProductGuard(
      page,
      sourceGuard,
      `${state.name} before wordmark`,
      { allowAnalytics: state.allowAnalytics, expectedStatus: state.status },
    );
    await expectKeyboardNavigation(
      page,
      page.getByRole('link', { name: 'Nicotine Tracker home' }),
      state.email ? '/today/' : '/',
    );
    recorder.record(state.name, 'Nicotine Tracker home', ['keyboard', 'request']);
    await expectGuardClean(destinationGuard, page, `${state.name} wordmark destination`);
    destinationGuard.stop();

    if (!state.email) return;

    sourceGuard = watchForProductProblems(page);
    await visitState(page, state);
    const accountName = `Open your space for ${state.email}`;
    destinationGuard = await handoffProductGuard(
      page,
      sourceGuard,
      `${state.name} before account`,
      { allowAnalytics: state.allowAnalytics, expectedStatus: state.status },
    );
    await expectKeyboardNavigation(
      page,
      page.getByRole('link', { name: accountName }),
      '/you/',
    );
    recorder.record(state.name, accountName, ['keyboard', 'request']);
    await expectGuardClean(destinationGuard, page, `${state.name} account destination`);
    destinationGuard.stop();

    for (const [name, destinationPath, allowAnalytics] of [
      ['Today', '/today/', false],
      ['Journey', '/journey/', false],
      ['Insights', '/insights/', true],
      ['You', '/you/', false],
    ]) {
      sourceGuard = watchForProductProblems(page);
      await visitState(page, state);
      destinationGuard = await handoffProductGuard(
        page,
        sourceGuard,
        `${state.name} before ${name}`,
        { allowAnalytics: state.allowAnalytics, expectedStatus: state.status },
      );
      const link = page.getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name, exact: true });
      await expectKeyboardNavigation(page, link, destinationPath);
      recorder.record(state.name, name, ['keyboard', 'request']);
      await expectGuardClean(destinationGuard, page, `${state.name} ${name} destination`, {
        allowAnalytics,
      });
      destinationGuard.stop();
    }
    });
  }
  recorder.assertComplete();
});


test('every settings navigation action runs in its exact representative state', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsNavigation, expect,
  );
  const states = [
    'profile', 'account', 'preferences', 'reminders', 'data', 'statistics',
    'data-offline-enabled', 'data-offline-disabled', 'data-settings-action',
    'account-destructive',
  ].map((name) => resolveReleaseState(
    RELEASE_STATES.find((state) => state.name === name),
    testInfo.project.name,
  ));

  for (const state of states) {
    await signOut(page);
    await loginAs(page, state.email);
    for (const [name, destinationPath] of [
      ['Profile', '/settings/profile'],
      ['Account', '/settings/account'],
      ['Preferences', '/settings/preferences'],
      ['Reminders', '/settings/notifications'],
      ['Data & privacy', '/settings/data'],
      ['Statistics', '/settings/statistics'],
    ]) {
      const sourceGuard = watchForProductProblems(page);
      await visitState(page, state);
      const destinationGuard = await handoffProductGuard(
        page, sourceGuard, `${state.name} before settings ${name}`,
      );
      await expectKeyboardNavigation(
        page,
        page.getByRole('navigation', { name: 'Settings' })
          .getByRole('link', { name, exact: true }),
        destinationPath,
      );
      recorder.record(state.name, name, ['keyboard', 'request']);
      await expectGuardClean(destinationGuard, page, `${state.name} settings ${name}`);
      destinationGuard.stop();
    }
  }
  recorder.assertComplete();
});


test('data actions use isolated disposable records in every exact state', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.dataExact, expect);
  const states = ['data', 'data-offline-enabled', 'data-offline-disabled', 'data-settings-action'];

  for (const state of states) {
    await signOut(page);
    await registerDisposable(page, testInfo, `data-${state}`);

    // A genuinely old UI-created row makes Delete Logs observable.
    await page.goto('/log/add');
    const addDialog = page.getByRole('dialog', { name: 'Add a log' });
    await addDialog.getByLabel('Date').fill('2026-01-10');
    await addDialog.getByLabel('Time').fill('09:15');
    await addDialog.getByLabel('Product').selectOption({ index: 1 });
    await addDialog.getByLabel('Quantity').fill('2');
    await addDialog.getByLabel('Notes').fill(`isolated ${state}`);
    await addDialog.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.locator('.logbook-row', { hasText: `isolated ${state}` })).toBeVisible();

    await page.goto('/settings/profile');
    await page.getByLabel('Age').fill('39');
    await page.getByLabel('Gender').selectOption('other');
    await page.getByLabel('Weight').fill('82');
    await page.getByRole('button', { name: 'Save profile' }).click();

    await page.goto('/settings/data');
    for (const [action, fieldName, confirmation, requestAction] of [
      ['Cleanup', 'Type CLEANUP to confirm', 'CLEANUP', 'cleanup_duplicates'],
      ['Merge', 'Type MERGE to confirm', 'MERGE', 'merge_custom_pouches'],
      ['Anonymize Data', 'Type ANONYMIZE to confirm', 'ANONYMIZE', 'anonymize_data'],
    ]) {
      const field = page.getByLabel(fieldName);
      let postCount = 0;
      const countPost = (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/settings/data') {
          postCount += 1;
        }
      };
      page.on('request', countPost);
      await field.fill('WRONG');
      await keyboardActivate(page, page.getByRole('button', { name: action }));
      await expect(field).toBeFocused();
      expect(postCount).toBe(0);
      await field.fill(confirmation);
      const responsePending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/settings/data'
      ));
      await keyboardActivate(page, page.getByRole('button', { name: action }));
      const response = await responsePending;
      expect(response.status()).toBe(302);
      expect(formPayload(response.request())).toEqual(expect.objectContaining({ action: requestAction }));
      expect(postCount).toBe(1);
      page.off('request', countPost);
      await expect(page).toHaveURL(/\/settings\/data$/);
      await expect(page.getByRole('status')).toBeVisible();
      recorder.record(
        state, action, ['error', 'focus', 'keyboard', 'persistence', 'request'],
      );
    }

    const deleteConfirmation = page.getByLabel('Type DELETE LOGS to confirm');
    await page.getByLabel('Days to keep').fill('30');
    await deleteConfirmation.fill('WRONG');
    await keyboardActivate(page, page.getByRole('button', { name: 'Delete Logs' }));
    await expect(deleteConfirmation).toBeFocused();
    await deleteConfirmation.fill('DELETE LOGS');
    const deleteResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/settings/data'
    ));
    await keyboardActivate(page, page.getByRole('button', { name: 'Delete Logs' }));
    const deleteResponse = await deleteResponsePending;
    expect(deleteResponse.status()).toBe(302);
    expect(formPayload(deleteResponse.request())).toEqual(expect.objectContaining({
      action: 'delete_old_logs', days_to_keep: '30', confirm_delete_logs: 'DELETE LOGS',
    }));
    await expect(page).toHaveURL(/\/settings\/data$/);
    await page.goto('/log/view');
    await expect(page.locator('.logbook-row', { hasText: `isolated ${state}` })).toHaveCount(0);
    recorder.record(
      state, 'Delete Logs', ['error', 'focus', 'keyboard', 'persistence', 'request'],
    );

    await page.goto('/settings/data');
    const recalculateResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/settings/data'
    ));
    await keyboardActivate(page, page.getByRole('button', { name: 'Recalculate' }));
    const recalculateResponse = await recalculateResponsePending;
    expect(recalculateResponse.status()).toBe(302);
    expect(formPayload(recalculateResponse.request())).toEqual(expect.objectContaining({
      action: 'recalculate_goals',
    }));
    await expect(page).toHaveURL(/\/settings\/data$/);
    await expect(page.getByRole('status')).toBeVisible();
    recorder.record(state, 'Recalculate', ['keyboard', 'persistence', 'request']);

    if (state !== 'data') {
      const downloadPending = page.waitForEvent('download');
      const exportResponsePending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/settings/data'
      ));
      const exportButton = page.getByRole('button', { name: 'Download Data' });
      await keyboardActivate(page, exportButton);
      const [download, exportResponse] = await Promise.all([downloadPending, exportResponsePending]);
      expect(exportResponse.status()).toBe(200);
      expect(formPayload(exportResponse.request())).toEqual(expect.objectContaining({ action: 'export_data' }));
      expect(download.suggestedFilename()).toMatch(/^nicotine_tracker_data_/);
      recorder.record(state, 'Download Data', ['focus', 'keyboard', 'request']);

      const offline = page.getByRole('checkbox', { name: 'Save actions for offline use' });
      const requested = !(await offline.isChecked());
      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === '/settings/privacy/offline-queue'
      ));
      await offline.focus();
      await page.keyboard.press('Space');
      const success = await successPending;
      expect(success.status()).toBe(200);
      expect(success.request().postDataJSON()).toEqual({ enabled: requested });
      await page.reload();
      await expect(page.getByRole('checkbox', { name: 'Save actions for offline use' }))
        .toBeChecked({ checked: requested });

      let releaseFailure;
      const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
      let failures = 0;
      await page.route('**/settings/privacy/offline-queue', async (route) => {
        failures += 1;
        await failureGate;
        await route.fulfill({
          status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }),
        });
      });
      const retryToggle = page.getByRole('checkbox', { name: 'Save actions for offline use' });
      await retryToggle.focus();
      await page.keyboard.press('Space');
      await expect(retryToggle).toBeDisabled();
      await expect(page.locator('#offline-queue-status')).toHaveAttribute('data-state', 'loading');
      await retryToggle.evaluate((element) => element.dispatchEvent(new Event('change', { bubbles: true })));
      expect(failures).toBe(1);
      releaseFailure();
      await expect(page.locator('#offline-queue-status')).toHaveAttribute('data-state', 'error');
      await expect(retryToggle).toBeFocused();
      await page.unroute('**/settings/privacy/offline-queue');
      recorder.record(
        state, 'Save actions for offline use',
        ['error', 'focus', 'keyboard', 'loading', 'persistence', 'request'],
      );

      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: 'Review account deletion' }), '/settings/account',
      );
      recorder.record(state, 'Review account deletion', ['keyboard', 'request']);
    }
  }

  await signOut(page);
  await loginAs(page, 'release-inventory@example.com');
  await page.goto('/log/view');
  await expect(page.locator('.logbook-row', { hasText: 'Release Fixture' })).toBeVisible();
  recorder.assertComplete();
});


test('remaining catalog actions preserve exact navigation and isolated records', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.catalogGaps, expect);
  await loginAs(page, 'release-inventory@example.com');
  for (const [state, path, action] of [
    ['catalog-add', '/catalog/add', '← Your pouches'],
    ['catalog-add', '/catalog/add', 'Cancel'],
    ['catalog-edit', '/__test__/release/catalog-edit', '← Your pouches'],
    ['catalog-edit', '/__test__/release/catalog-edit', 'Cancel'],
  ]) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expectKeyboardNavigation(page, page.getByRole('link', { name: action, exact: true }), '/catalog/');
    recorder.record(state, action, ['keyboard', 'request']);
  }
  recorder.assertComplete();
});


test('remaining logging actions preserve exact navigation and isolated records', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.loggingGaps, expect);
  await registerDisposable(page, testInfo, 'logging-gaps');
  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill('Release Fixture');
  await page.getByLabel('Nicotine strength').fill('3.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();

  for (const [state, path] of [['logbook', '/log/view'], ['log-add', '/log/add']]) {
    for (const action of [
      'Log one Release Fixture, 3.5 milligrams',
      'Log one Steady Mint, 6 milligrams',
    ]) {
      await page.goto(path);
      if (state === 'log-add') {
        const dialog = page.getByRole('dialog', { name: 'Add a log' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
        await expect(dialog).not.toBeVisible();
      }
      let requests = 0;
      let releaseFailure;
      const heldFailure = new Promise((resolve) => { releaseFailure = resolve; });
      await page.route('**/log/api/quick_add', async (route) => {
        requests += 1;
        if (requests === 1) {
          await heldFailure;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'Quick add is temporarily unavailable.' }),
          });
          return;
        }
        await route.continue();
      });
      const button = page.getByRole('button', { name: action });
      const failedResponsePending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/log/api/quick_add'
        && response.status() === 503
      ));
      await keyboardActivate(page, button);
      await expect(button).toBeDisabled();
      await expect(button).toContainText('Adding...');
      await button.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(requests).toBe(1);
      releaseFailure();
      const failedResponse = await failedResponsePending;
      expect(failedResponse.request().postDataJSON()).toEqual(expect.objectContaining({ quantity: 1 }));
      await expect(page.getByText('Quick add is temporarily unavailable.')).toBeVisible();
      await expect(button).toBeEnabled();
      await expect(button).toBeFocused();

      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/log/api/quick_add'
        && response.status() === 200
      ));
      await keyboardActivate(page, button);
      const success = await successPending;
      expect(success.request().postDataJSON()).toEqual(expect.objectContaining({ quantity: 1 }));
      await page.waitForLoadState('load');
      await expect(page.locator('.logbook-row')).not.toHaveCount(0);
      await page.unroute('**/log/api/quick_add');
      recorder.record(
        state, action,
        ['error', 'focus', 'keyboard', 'loading', 'persistence', 'request'],
      );
    }
  }

  await page.goto('/log/bulk');
  await expectKeyboardNavigation(page, page.getByRole('link', { name: 'Cancel' }), '/log/view');
  recorder.record('log-bulk', 'Cancel', ['keyboard', 'request']);
  const editLink = page.locator('.logbook-row').first().getByRole('link', { name: 'Edit' });
  await expectKeyboardNavigation(page, editLink, new URL(await editLink.getAttribute('href'), page.url()).pathname);
  await expectKeyboardNavigation(page, page.getByRole('link', { name: 'Cancel' }), '/log/view');
  recorder.record('log-edit', 'Cancel', ['keyboard', 'request']);
  recorder.assertComplete();
});


test('standalone craving support link reaches Today without external traffic', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.cravingsLink, expect);
  const external = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:5000') external.push(request.url());
  });
  await loginAs(page, 'release-inventory@example.com');
  await page.goto('/cravings/cravings');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Get immediate support on Today' }), '/today/',
  );
  expect(external).toEqual([]);
  recorder.record(
    'cravings', 'Get immediate support on Today', ['keyboard', 'request'],
  );
  recorder.assertComplete();
});


test('remaining goal actions preserve exact navigation and disposable state', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.goalsGaps, expect);
  await loginAs(page, 'journey-review-desktop@example.com');
  for (const [state, path, action] of [
    ['goal-create', '/goals/create', 'Back to goals'],
    ['goal-create', '/goals/create', 'Cancel'],
    ['goal-progress', '/goals/progress', 'Back to goals'],
    ['goal-edit', '/__test__/release/goal-edit', 'Back to goals'],
    ['goal-edit', '/__test__/release/goal-edit', 'Cancel'],
  ]) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expectKeyboardNavigation(page, page.getByRole('link', { name: action, exact: true }), '/goals/');
    recorder.record(state, action, ['keyboard', 'request']);
  }
  recorder.assertComplete();
});


test('dashboard actions run in ready empty and sparse states', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.dashboard, expect);
  for (const [state, email] of [
    ['dashboard', 'release-analytics-ready@example.com'],
    ['dashboard-empty', 'release-analytics-empty@example.com'],
    ['dashboard-sparse', 'release-analytics-sparse@example.com'],
  ]) {
    await signOut(page);
    await loginAs(page, email);
    for (const [action, destination] of [
      ['Go to Today', '/today/'],
      ['Open Insights', '/insights/'],
      ['Review Journey', '/journey/'],
    ]) {
      await page.goto('/dashboard/');
      await expectKeyboardNavigation(page, page.getByRole('link', { name: action }), destination);
      recorder.record(state, action, ['keyboard', 'request']);
    }
    await page.goto('/dashboard/');
    const disclosure = page.getByText('View daily values', { exact: true });
    if (await disclosure.count()) {
      await keyboardActivate(page, disclosure);
      await expect(disclosure).toBeFocused();
      await expect(disclosure.locator('..')).not.toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      await expect(disclosure.locator('..')).toHaveAttribute('open', '');
      recorder.record(state, 'View daily values', ['focus', 'keyboard']);
    }
    if (state === 'dashboard-empty') {
      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: 'Start with Today' }), '/today/',
      );
      recorder.record(state, 'Start with Today', ['keyboard', 'request']);
    }
  }
  recorder.assertComplete();
});


test('public error recovery actions reach a safe destination', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.errors, expect);
  await signOut(page);
  for (const [state, path, status, action] of [
    ['anonymous-not-found', '/__release_missing_page__', 404, 'Back to the start page'],
    ['bad-request', '/__test__/error/400', 400, 'Return safely'],
    ['server-error', '/__test__/error/500', 500, 'Back to the start page'],
  ]) {
    expect((await page.goto(path)).status()).toBe(status);
    await expectKeyboardNavigation(page, page.getByRole('link', { name: action }), '/');
    recorder.record(state, action, ['keyboard', 'request']);
  }
  recorder.assertComplete();
});
