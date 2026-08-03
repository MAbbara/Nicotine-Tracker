const { test, expect } = require('@playwright/test');
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


async function typedActivation(page, locator, recorder, state, action, outcome, key = 'Enter') {
  const evidence = recorder.forAction(state, action, { page, control: locator });
  const token = await evidence.keyboard({ key, outcome });
  recorder.accept(token);
  return { evidence, token };
}


async function accept(recorder, tokenPromise) {
  recorder.accept(await tokenPromise);
}


function exactPath(path) {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
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
  if (new URL(page.url()).searchParams.get('open_add_modal') === '1') {
    await expect(openDialog).toHaveCount(1);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await openDialog.count()) {
        await page.keyboard.press('Escape');
        await expect(openDialog).toHaveCount(0);
      }
      await page.waitForTimeout(50);
    }
  }
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


async function expectKeyboardNavigation(
  page, locator, expectedPath, expectedStatus = 200, evidence = null,
) {
  const responsePending = page.waitForResponse((response) => (
    response.request().isNavigationRequest()
    && new URL(response.url()).pathname === expectedPath
  ), { timeout: 15_000 });
  let actionEvidence;
  if (evidence) {
    actionEvidence = await typedActivation(
      page, locator, evidence.recorder, evidence.state, evidence.action,
      {
        kind: 'response', pending: responsePending, method: 'GET',
        path: exactPath(expectedPath), status: expectedStatus,
      },
    );
  } else {
    await keyboardActivate(page, locator);
  }
  let response;
  try {
    response = await responsePending;
  } catch (error) {
    const label = evidence ? `${evidence.state} › ${evidence.action}` : 'unowned navigation';
    throw new Error(
      `${label} did not issue GET ${expectedPath}; current URL is ${page.url()}`,
      { cause: error },
    );
  }
  expect(response.request().method()).toBe('GET');
  expect(response.request().postData()).toBeNull();
  expect(response.status()).toBe(expectedStatus);
  await response.finished();
  await page.waitForLoadState('load');
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
  if (evidence) {
    await accept(evidence.recorder, actionEvidence.evidence.request({
      activation: actionEvidence.token, method: 'GET',
      path: exactPath(expectedPath), status: expectedStatus,
    }));
  }
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


async function accountSnapshot(page) {
  const response = await page.request.get('/__test__/account-snapshot');
  expect(response.status()).toBe(200);
  return response.json();
}


async function addCustomPouch(page, brand, strength = '4.25') {
  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill(brand);
  await page.getByLabel('Nicotine strength').fill(strength);
  await page.getByRole('button', { name: 'Add pouch' }).click();
  await expect(page.locator('.catalog-row', { hasText: brand })).not.toHaveCount(0);
}


async function addDetailedLog(page, {
  date = '2026-01-10', time = '09:15', productValue = null,
  quantity = '2', notes,
}) {
  await page.goto('/log/add');
  const dialog = page.getByRole('dialog', { name: 'Add a log' });
  await dialog.getByLabel('Date').fill(date);
  await dialog.getByLabel('Time').fill(time);
  if (productValue) {
    await dialog.getByLabel('Product').selectOption(productValue);
  } else {
    await dialog.getByLabel('Product').selectOption({ index: 1 });
  }
  await dialog.getByLabel('Quantity').fill(quantity);
  await dialog.getByLabel('Notes').fill(notes);
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.logbook-row', { hasText: notes })).not.toHaveCount(0);
}


async function runConfirmedDataAction({
  page, recorder, state, action, fieldName, confirmation, requestPayload,
  rejectedFeedback, successFeedback, verifyPersistence,
}) {
  const field = page.getByLabel(fieldName);
  let posts = 0;
  const countPost = (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/settings/data') {
      posts += 1;
    }
  };
  page.on('request', countPost);
  await field.fill('WRONG');
  const control = page.getByRole('button', { name: action });
  const actionEvidence = await typedActivation(
    page, control, recorder, state, action,
    { kind: 'focused', locator: field },
  );
  expect(posts).toBe(0);
  await accept(recorder, actionEvidence.evidence.focus({ locator: field }));
  await accept(recorder, actionEvidence.evidence.error({
    locator: field, validationMessage: rejectedFeedback,
  }));
  await accept(recorder, actionEvidence.evidence.feedback({
    locator: field, validationMessage: rejectedFeedback,
  }));

  await field.fill(confirmation);
  const responsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/settings/data'
  ));
  const validToken = await actionEvidence.evidence.keyboard({
    key: 'Enter', outcome: {
      kind: 'response', pending: responsePending, method: 'POST',
      path: /^\/settings\/data$/, status: 302,
    },
  });
  recorder.accept(validToken);
  await responsePending;
  await accept(recorder, actionEvidence.evidence.request({
    activation: validToken, method: 'POST', path: /^\/settings\/data$/, status: 302,
    payload: { kind: 'form', exact: requestPayload },
    dynamicFields: { csrf_token: 'non-empty' },
  }));
  expect(posts).toBe(1);
  page.off('request', countPost);
  await accept(recorder, actionEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: successFeedback,
  }));
  await accept(recorder, actionEvidence.evidence.persistence({
    snapshot: await verifyPersistence(),
  }));
}


test('every supporting action has an independent exact behavior obligation', async () => {
  expect(SUPPORTING_BEHAVIOR_OBLIGATIONS).toHaveLength(376);
  for (const obligation of SUPPORTING_BEHAVIOR_OBLIGATIONS) {
    expect(Object.keys(obligation.dimensions).sort()).toEqual([
      'error', 'feedback', 'focus', 'keyboard', 'loading', 'persistence', 'request',
    ]);
    for (const [dimension, requirement] of Object.entries(obligation.dimensions)) {
      expect(['asserted', 'not-applicable']).toContain(requirement.status);
      expect(requirement.reason, `${obligation.state} › ${obligation.action} ${dimension}`)
        .toMatch(/\S/);
    }
  }
  expect(validateSupportingCoverage(
    EXPECTED_ACTIONS,
    Object.fromEntries(SUPPORTING_ACTION_STATES.map((state) => [
      state,
      EXPECTED_ACTIONS[state].coveredBy,
    ])),
  )).toBe(true);

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
  expect(emptyProfileRecorder.record).toBeUndefined();
  expect(emptyProfileRecorder.prove).toBeUndefined();
  expect(() => emptyProfileRecorder.assertComplete())
    .toThrow(/supporting runtime dimension evidence/);
});


test('typed supporting evidence rejects self-authorized and mismatched artifacts', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');
  await page.goto('/settings/profile');
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  const save = page.getByRole('button', { name: 'Save profile' });
  const action = recorder.forAction('profile', 'Save profile', { page, control: save });

  await expect(action.keyboard({ key: 'Enter', outcome: true }))
    .rejects.toThrow(/typed keyboard outcome/);
  await expect(action.keyboard({ key: 'Enter', outcome: Promise.resolve() }))
    .rejects.toThrow(/typed keyboard outcome/);
  await expect(action.feedback({
    locator: page.getByRole('heading', { name: 'Profile' }),
    text: 'Profile',
  })).rejects.toThrow(/status, alert, or native validation/);
  await expect(action.focus()).rejects.toThrow(/focus locator/);
  await expect(action.loading({ locator: save, disabled: true }))
    .rejects.toThrow(/not asserted/);

  const wrongRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsPreferences, expect,
  );
  await page.goto('/settings/preferences');
  const wrongAction = wrongRecorder.forAction(
    'preferences', 'Steady Mint',
    { page, control: page.getByRole('checkbox', { name: 'Steady Mint' }) },
  );
  await page.getByRole('checkbox', { name: 'Steady Mint' }).focus();
  const wrongToken = await wrongAction.focus({
    locator: page.getByRole('checkbox', { name: 'Steady Mint' }),
  });
  expect(() => recorder.accept(wrongToken)).toThrow(/different recorder/);
  expect(() => recorder.accept(Object.freeze({}))).toThrow(/forged evidence token/);
  expect(() => recorder.assertComplete()).toThrow(/supporting runtime dimension evidence/);
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
    const skipEvidence = await typedActivation(
      page, skip, recorder, state.name, 'Skip to main content',
      { kind: 'focused', locator: page.locator('#main-content') },
    );
    await accept(recorder, skipEvidence.evidence.focus({ locator: page.locator('#main-content') }));
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
      200,
      { recorder, state: state.name, action: 'Nicotine Tracker home' },
    );
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
      200,
      { recorder, state: state.name, action: accountName },
    );
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
      await expectKeyboardNavigation(
        page, link, destinationPath, 200,
        { recorder, state: state.name, action: name },
      );
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
        200,
        { recorder, state: state.name, action: name },
      );
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

  await loginAs(page, 'release-inventory@example.com');
  const fixtureBefore = await accountSnapshot(page);
  expect(fixtureBefore.profile).toEqual(expect.objectContaining({
    email: 'release-inventory@example.com', age: 34, gender: 'prefer_not_to_say',
  }));
  expect(fixtureBefore.logs.some((entry) => entry.notes === 'Release Fixture log')).toBe(true);
  expect(fixtureBefore.pouches.some((entry) => entry.brand === 'Release Fixture')).toBe(true);
  expect(fixtureBefore.goals).not.toHaveLength(0);

  for (const state of states) {
    await signOut(page);
    await registerDisposable(page, testInfo, `data-${state}`);

    const mergeBrand = `Merge Mint ${state}`;
    await addCustomPouch(page, mergeBrand);
    await addCustomPouch(page, mergeBrand.toLowerCase());

    // Exact duplicate and merge-linked rows are created through the real UI.
    await addDetailedLog(page, { notes: `duplicate ${state}` });
    await addDetailedLog(page, { notes: `duplicate ${state}` });
    await page.goto('/log/add');
    let addDialog = page.getByRole('dialog', { name: 'Add a log' });
    const mergeOptions = addDialog.getByLabel('Product').locator('option').filter({
      hasText: new RegExp(mergeBrand, 'i'),
    });
    expect(await mergeOptions.count()).toBe(2);
    const secondMergeValue = await mergeOptions.nth(1).getAttribute('value');
    await addDialog.getByRole('button', { name: 'Close add log dialog' }).click();
    await addDetailedLog(page, {
      time: '10:30', productValue: secondMergeValue,
      quantity: '1', notes: `merge-linked ${state}`,
    });

    await page.goto('/goals/create');
    await page.getByLabel('Goal type').selectOption('daily_pouches');
    await page.getByLabel('Target value').fill('5');
    await page.getByRole('button', { name: 'Create goal' }).click();
    expect((await page.request.post('/__test__/age-goals-for-recalculation')).status()).toBe(200);

    await page.goto('/settings/profile');
    await page.getByLabel('Age').fill('39');
    await page.getByLabel('Gender').selectOption('other');
    await page.getByLabel('Weight').fill('82');
    await page.getByRole('button', { name: 'Save profile' }).click();

    await page.goto('/settings/preferences');
    await page.getByLabel('Units', { exact: true }).selectOption('percentage');
    const preferredMergeBrand = page.getByRole('checkbox', { name: mergeBrand }).first();
    await preferredMergeBrand.check();
    await page.getByRole('button', { name: 'Save preferences' }).click();

    const before = await accountSnapshot(page);
    expect(before.profile).toEqual(expect.objectContaining({ age: 39, gender: 'other', weight: 82 }));
    expect(before.preferences).toEqual(expect.objectContaining({
      units_preference: 'percentage', preferred_brands: [mergeBrand],
    }));
    expect(before.logs.filter((entry) => entry.notes === `duplicate ${state}`)).toHaveLength(2);
    expect(before.logs.some((entry) => entry.notes === `merge-linked ${state}`)).toBe(true);
    expect(before.pouches.filter(
      (entry) => entry.brand.toLowerCase() === mergeBrand.toLowerCase(),
    )).toHaveLength(2);
    expect(before.goals).toEqual([expect.objectContaining({ current_streak: 9, best_streak: 9 })]);

    await page.goto('/settings/data');
    await expect(page.getByText('1 potential group found.')).toBeVisible();
    await expect(page.getByText('1 similar entry found.')).toBeVisible();
    await runConfirmedDataAction({
      page, recorder, state, action: 'Cleanup',
      fieldName: 'Type CLEANUP to confirm', confirmation: 'CLEANUP',
      requestPayload: {
        action: 'cleanup_duplicates', confirm_cleanup_duplicates: 'CLEANUP',
      },
      rejectedFeedback: 'Please match the requested format.',
      successFeedback: 'Removed 1 duplicate log entries.',
      verifyPersistence: async () => {
        const afterCleanup = await accountSnapshot(page);
        return {
          actual: [afterCleanup.logs.filter((entry) => entry.notes === `duplicate ${state}`).length],
          expected: [1],
        };
      },
    });
    await runConfirmedDataAction({
      page, recorder, state, action: 'Merge',
      fieldName: 'Type MERGE to confirm', confirmation: 'MERGE',
      requestPayload: {
        action: 'merge_custom_pouches', confirm_merge_pouches: 'MERGE',
      },
      rejectedFeedback: 'Please match the requested format.',
      successFeedback: 'Merged 1 similar pouch entries.',
      verifyPersistence: async () => {
        const afterMerge = await accountSnapshot(page);
        const retained = afterMerge.pouches.filter(
          (entry) => entry.brand.toLowerCase() === mergeBrand.toLowerCase(),
        );
        return {
          actual: {
            retained: retained.length,
            linkedPouch: afterMerge.logs.find(
              (entry) => entry.notes === `merge-linked ${state}`,
            ).pouch_id,
          },
          expected: { retained: 1, linkedPouch: retained[0].id },
        };
      },
    });

    const recalculateResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/settings/data'
    ));
    const recalculateEvidence = await typedActivation(
      page, page.getByRole('button', { name: 'Recalculate' }), recorder, state, 'Recalculate',
      {
        kind: 'response', pending: recalculateResponsePending, method: 'POST',
        path: /^\/settings\/data$/, status: 302,
      },
    );
    await accept(recorder, recalculateEvidence.evidence.request({
      activation: recalculateEvidence.token, method: 'POST',
      path: /^\/settings\/data$/, status: 302,
      payload: { kind: 'form', exact: { action: 'recalculate_goals' } },
      dynamicFields: { csrf_token: 'non-empty' },
    }));
    await accept(recorder, recalculateEvidence.evidence.feedback({
      locator: page.getByRole('status'), text: 'Recalculated streaks for 1 goals.',
    }));
    const afterRecalculation = await accountSnapshot(page);
    await accept(recorder, recalculateEvidence.evidence.persistence({ snapshot: {
      actual: afterRecalculation.goals.map(({ current_streak, best_streak }) => ({
        current_streak, best_streak,
      })),
      expected: [{ current_streak: 0, best_streak: 1 }],
    } }));

    await runConfirmedDataAction({
      page, recorder, state, action: 'Anonymize Data',
      fieldName: 'Type ANONYMIZE to confirm', confirmation: 'ANONYMIZE',
      requestPayload: { action: 'anonymize_data', confirm_anonymize: 'ANONYMIZE' },
      rejectedFeedback: 'Please match the requested format.',
      successFeedback: 'Your personal data has been anonymized successfully.',
      verifyPersistence: async () => {
        const afterAnonymize = await accountSnapshot(page);
        return {
          actual: {
            age: afterAnonymize.profile.age,
            gender: afterAnonymize.profile.gender,
            weight: afterAnonymize.profile.weight,
            units: afterAnonymize.preferences.units_preference,
            brands: afterAnonymize.preferences.preferred_brands,
            notesCleared: afterAnonymize.logs.every((entry) => entry.notes === null),
          },
          expected: {
            age: null, gender: null, weight: null, units: 'mg', brands: null,
            notesCleared: true,
          },
        };
      },
    });

    await page.getByLabel('Days to keep').fill('30');
    await runConfirmedDataAction({
      page, recorder, state, action: 'Delete Logs',
      fieldName: 'Type DELETE LOGS to confirm', confirmation: 'DELETE LOGS',
      requestPayload: {
        action: 'delete_old_logs', days_to_keep: '30', confirm_delete_logs: 'DELETE LOGS',
      },
      rejectedFeedback: 'Please match the requested format.',
      successFeedback: 'Successfully deleted 2 old log entries.',
      verifyPersistence: async () => {
        const afterDelete = await accountSnapshot(page);
        return { actual: afterDelete.logs, expected: [] };
      },
    });

    if (state !== 'data') {
      const downloadPending = page.waitForEvent('download');
      const exportResponsePending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/settings/data'
      ));
      const exportButton = page.getByRole('button', { name: 'Download Data' });
      const exportEvidence = await typedActivation(
        page, exportButton, recorder, state, 'Download Data',
        {
          kind: 'response', pending: exportResponsePending, method: 'POST',
          path: /^\/settings\/data$/, status: 200, settleNavigation: false,
        },
      );
      const [download, exportResponse] = await Promise.all([downloadPending, exportResponsePending]);
      await accept(recorder, exportEvidence.evidence.request({
        activation: exportEvidence.token, method: 'POST', path: /^\/settings\/data$/, status: 200,
        payload: { kind: 'form', exact: { action: 'export_data' } },
        dynamicFields: { csrf_token: 'non-empty' },
      }));
      expect(download.suggestedFilename()).toMatch(/^nicotine_tracker_data_/);
      const offline = page.getByRole('checkbox', { name: 'Save actions for offline use' });
      const requested = !(await offline.isChecked());
      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === '/settings/privacy/offline-queue'
      ));
      const offlineEvidence = await typedActivation(
        page, offline, recorder, state, 'Save actions for offline use',
        {
          kind: 'response', pending: successPending, method: 'PATCH',
          path: /^\/settings\/privacy\/offline-queue$/, status: 200,
        }, 'Space',
      );
      const success = await successPending;
      await accept(recorder, offlineEvidence.evidence.request({
        activation: offlineEvidence.token, method: 'PATCH',
        path: /^\/settings\/privacy\/offline-queue$/, status: 200,
        payload: { kind: 'json', exact: { enabled: requested } },
      }));
      const offlineStatus = page.locator('#offline-queue-status');
      await accept(recorder, offlineEvidence.evidence.feedback({
        locator: offlineStatus,
        text: requested ? 'Offline saving is on.' : 'Offline saving is off.',
      }));
      await expect(offlineStatus).toHaveAttribute('data-state', 'success');
      await page.reload();
      await accept(recorder, offlineEvidence.evidence.persistence({
        locator: page.getByRole('checkbox', { name: 'Save actions for offline use' }),
        checked: requested,
      }));

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
      const retryEvidence = recorder.forAction(
        state, 'Save actions for offline use', { page, control: retryToggle },
      );
      recorder.accept(await retryEvidence.keyboard({
        key: 'Space', outcome: { kind: 'disabled', locator: retryToggle, disabled: true },
      }));
      await accept(recorder, retryEvidence.loading({
        disabled: true,
        status: { locator: page.locator('#offline-queue-status'), text: 'Saving offline preference…' },
      }));
      await retryToggle.evaluate((element) => element.dispatchEvent(new Event('change', { bubbles: true })));
      expect(failures).toBe(1);
      releaseFailure();
      await accept(recorder, retryEvidence.error({
        locator: page.locator('#offline-queue-status'),
        text: 'Offline preference could not be saved. Please try again.', state: 'error',
      }));
      await accept(recorder, retryEvidence.focus({ locator: retryToggle }));
      await page.unroute('**/settings/privacy/offline-queue');

      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: 'Review account deletion' }),
        '/settings/account', 200,
        { recorder, state, action: 'Review account deletion' },
      );
    }
  }

  await signOut(page);
  await loginAs(page, 'release-inventory@example.com');
  await page.goto('/log/view');
  await expect(page.locator('.logbook-row', { hasText: 'Release Fixture' })).toBeVisible();
  expect(await accountSnapshot(page)).toEqual(fixtureBefore);
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
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: action, exact: true }), '/catalog/', 200,
      { recorder, state, action },
    );
  }
  recorder.assertComplete();
});


test('remaining logging actions preserve exact navigation and isolated records', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.loggingGaps, expect);
  await registerDisposable(page, testInfo, 'logging-gaps');
  const guard = watchForProductProblems(page);
  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill('Release Fixture');
  await page.getByLabel('Nicotine strength').fill('3.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();

  await page.goto('/log/view');
  const logbookAdd = page.getByRole('button', { name: 'Add log', exact: true });
  let dialog = page.getByRole('dialog', { name: 'Add a log' });
  const logbookAddEvidence = await typedActivation(
    page, logbookAdd, recorder, 'logbook', 'Add log',
    { kind: 'focused', locator: dialog.getByLabel('Date') },
  );
  await expect(dialog).toBeVisible();
  await accept(recorder, logbookAddEvidence.evidence.focus({ locator: dialog.getByLabel('Date') }));
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/log/add');
  dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog).toBeVisible();
  const closeDialog = dialog.getByRole('button', { name: 'Close add log dialog' });
  const closeEvidence = await typedActivation(
    page, closeDialog, recorder, 'log-add', 'Close add log dialog',
    { kind: 'focused', locator: page.getByRole('button', { name: 'Add log', exact: true }) },
  );
  await expect(dialog).not.toBeVisible();
  await accept(recorder, closeEvidence.evidence.focus({
    locator: page.getByRole('button', { name: 'Add log', exact: true }),
  }));

  const logAddTrigger = page.getByRole('button', { name: 'Add log', exact: true });
  const logAddEvidence = await typedActivation(
    page, logAddTrigger, recorder, 'log-add', 'Add log',
    { kind: 'focused', locator: dialog.getByLabel('Date') },
  );
  await expect(dialog).toBeVisible();
  await accept(recorder, logAddEvidence.evidence.focus({ locator: dialog.getByLabel('Date') }));
  const cancelDialog = dialog.getByRole('button', { name: 'Cancel' });
  const cancelEvidence = await typedActivation(
    page, cancelDialog, recorder, 'log-add', 'Cancel',
    { kind: 'focused', locator: logAddTrigger },
  );
  await expect(dialog).not.toBeVisible();
  await accept(recorder, cancelEvidence.evidence.focus({ locator: logAddTrigger }));

  await logAddTrigger.click();
  const addEntry = dialog.getByRole('button', { name: 'Add entry' });
  const product = dialog.getByLabel('Product');
  const addEntryEvidence = await typedActivation(
    page, addEntry, recorder, 'log-add', 'Add entry',
    { kind: 'focused', locator: product },
  );
  await accept(recorder, addEntryEvidence.evidence.focus({ locator: product }));
  await accept(recorder, addEntryEvidence.evidence.error({
    locator: product, validationMessage: 'Please select an item in the list.',
  }));
  await accept(recorder, addEntryEvidence.evidence.feedback({
    locator: product, validationMessage: 'Please select an item in the list.',
  }));
  await dialog.getByLabel('Date').fill('2026-01-11');
  await dialog.getByLabel('Time').fill('09:15');
  await product.selectOption({ index: 1 });
  const selectedProductId = await product.inputValue();
  await dialog.getByLabel('Quantity').fill('2');
  await dialog.getByLabel('Notes').fill('supporting add entry');
  const addEntryResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/log/add'
  ));
  const validAddEntry = await addEntryEvidence.evidence.keyboard({
    key: 'Enter', outcome: {
      kind: 'response', pending: addEntryResponsePending, method: 'POST',
      path: /^\/log\/add$/, status: 302,
    },
  });
  recorder.accept(validAddEntry);
  const addEntryResponse = await addEntryResponsePending;
  await accept(recorder, addEntryEvidence.evidence.request({
    activation: validAddEntry, method: 'POST', path: /^\/log\/add$/, status: 302,
    payload: { kind: 'form', exact: {
      user_timezone: 'UTC', log_date: '2026-01-11', log_time: '09:15',
      pouch_id: selectedProductId, quantity: '2', notes: 'supporting add entry',
      custom_brand: '', custom_nicotine_mg: '',
    } }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  await accept(recorder, addEntryEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Log entry added successfully!',
  }));
  await accept(recorder, addEntryEvidence.evidence.persistence({
    locator: page.locator('.logbook-row', { hasText: 'supporting add entry' }), count: 1,
  }));

  for (const [state, path] of [['logbook', '/log/view'], ['log-add', '/log/add']]) {
    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await page.waitForTimeout(100);
      if (await dialog.isVisible()) {
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      }
      await expect(dialog).not.toBeVisible();
    }
    await page.getByLabel('Search logs').fill('supporting add entry');
    const filterNavigationPending = page.waitForNavigation({ waitUntil: 'load' });
    const filterResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/log/view'
    ));
    const filterEvidence = await typedActivation(
      page, page.getByRole('button', { name: 'Apply filters' }), recorder, state, 'Apply filters',
      {
        kind: 'response', pending: filterResponsePending, method: 'GET', path: /^\/log\/view$/,
        search: '?q=supporting+add+entry&from_date=&to_date=', status: 200,
      },
    );
    const [filterResponse] = await Promise.all([
      filterResponsePending, filterNavigationPending,
    ]);
    await accept(recorder, filterEvidence.evidence.request({
      activation: filterEvidence.token, method: 'GET', path: /^\/log\/view$/,
      search: '?q=supporting+add+entry&from_date=&to_date=', status: 200,
    }));

    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await page.waitForTimeout(100);
      if (await dialog.isVisible()) {
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      }
      await expect(dialog).not.toBeVisible();
    }
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: 'Bulk add' }), '/log/bulk', 200,
      { recorder, state, action: 'Bulk add' },
    );

    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await page.waitForTimeout(100);
      if (await dialog.isVisible()) {
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      }
      await expect(dialog).not.toBeVisible();
    }
    const row = page.locator('.logbook-row', { hasText: 'supporting add entry' });
    const edit = row.getByRole('link', { name: 'Edit' });
    const editPath = new URL(await edit.getAttribute('href'), page.url()).pathname;
    await expectKeyboardNavigation(
      page, edit, editPath, 200, { recorder, state, action: 'Edit' },
    );
  }

  await page.goto('/log/bulk');
  const addEntries = page.getByRole('button', { name: 'Add entries' });
  const entries = page.getByLabel('Entries', { exact: true });
  const bulkEvidence = await typedActivation(
    page, addEntries, recorder, 'log-bulk', 'Add entries',
    { kind: 'focused', locator: entries },
  );
  await accept(recorder, bulkEvidence.evidence.focus({ locator: entries }));
  await accept(recorder, bulkEvidence.evidence.error({
    locator: entries, validationMessage: 'Please fill out this field.',
  }));
  await accept(recorder, bulkEvidence.evidence.feedback({
    locator: entries, validationMessage: 'Please fill out this field.',
  }));
  await page.getByLabel('Date for these entries').fill('2026-01-12');
  await entries.fill('1 Bulk Evidence 4mg at 13:00');
  const bulkResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/log/bulk'
  ));
  const validBulk = await bulkEvidence.evidence.keyboard({
    key: 'Enter', outcome: {
      kind: 'response', pending: bulkResponsePending, method: 'POST',
      path: /^\/log\/bulk$/, status: 302,
    },
  });
  recorder.accept(validBulk);
  await accept(recorder, bulkEvidence.evidence.request({
    activation: validBulk, method: 'POST', path: /^\/log\/bulk$/, status: 302,
    payload: { kind: 'form', exact: {
      log_date: '2026-01-12', bulk_text: '1 Bulk Evidence 4mg at 13:00',
    } }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  await accept(recorder, bulkEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Successfully added 1 log entries!',
  }));
  await accept(recorder, bulkEvidence.evidence.persistence({
    locator: page.locator('.logbook-row', { hasText: 'Bulk Evidence' }), count: 1,
  }));

  const supportingRow = page.locator('.logbook-row', { hasText: 'supporting add entry' });
  await supportingRow.getByRole('link', { name: 'Edit' }).click();
  const saveChanges = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Quantity').fill('');
  const editQuantity = page.getByLabel('Quantity');
  const editEvidence = await typedActivation(
    page, saveChanges, recorder, 'log-edit', 'Save changes',
    { kind: 'focused', locator: editQuantity },
  );
  await accept(recorder, editEvidence.evidence.focus({ locator: editQuantity }));
  await accept(recorder, editEvidence.evidence.error({
    locator: editQuantity, validationMessage: 'Please fill out this field.',
  }));
  await accept(recorder, editEvidence.evidence.feedback({
    locator: editQuantity, validationMessage: 'Please fill out this field.',
  }));
  await editQuantity.fill('3');
  await page.getByLabel('Notes').fill('supporting edit saved');
  const exactEditPayload = {
    log_date: await page.getByLabel('Date').inputValue(),
    log_time: await page.getByLabel('Time').inputValue(),
    quantity: '3', notes: 'supporting edit saved',
  };
  const editSaveResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/log\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  const validEdit = await editEvidence.evidence.keyboard({
    key: 'Enter', outcome: {
      kind: 'response', pending: editSaveResponsePending, method: 'POST',
      path: /^\/log\/edit\/\d+$/, status: 302,
    },
  });
  recorder.accept(validEdit);
  await accept(recorder, editEvidence.evidence.request({
    activation: validEdit, method: 'POST', path: /^\/log\/edit\/\d+$/, status: 302,
    payload: { kind: 'form', exact: exactEditPayload },
    dynamicFields: { csrf_token: 'non-empty' },
  }));
  await accept(recorder, editEvidence.evidence.feedback({
    locator: page.getByRole('status'), text: 'Log entry updated successfully!',
  }));
  await accept(recorder, editEvidence.evidence.persistence({
    locator: page.locator('.logbook-row', { hasText: 'supporting edit saved' }),
    text: /3 pouches/,
  }));

  for (const [state, path, note, time] of [
    ['logbook', '/log/view', 'delete logbook evidence', '10:15'],
    ['log-add', '/log/add', 'delete log-add evidence', '10:30'],
  ]) {
    await addDetailedLog(page, { date: '2026-01-13', time, notes: note });
    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await page.waitForTimeout(100);
      if (await dialog.isVisible()) {
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      }
      await expect(dialog).not.toBeVisible();
    }
    const deleteRow = page.locator('.logbook-row', { hasText: note });
    const deleteButton = deleteRow.getByRole('button', { name: 'Delete' });
    page.once('dialog', (confirmation) => confirmation.dismiss());
    const deleteEvidence = await typedActivation(
      page, deleteButton, recorder, state, 'Delete',
      { kind: 'visible', locator: deleteRow },
    );
    await accept(recorder, deleteEvidence.evidence.error({ locator: deleteRow, count: 1 }));

    const deleteResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/log\/delete\/\d+$/.test(new URL(response.url()).pathname)
    ));
    page.once('dialog', (confirmation) => confirmation.accept());
    const validDelete = await deleteEvidence.evidence.keyboard({
      key: 'Enter', outcome: {
        kind: 'response', pending: deleteResponsePending, method: 'POST',
        path: /^\/log\/delete\/\d+$/, status: 302,
      },
    });
    recorder.accept(validDelete);
    await accept(recorder, deleteEvidence.evidence.request({
      activation: validDelete, method: 'POST', path: /^\/log\/delete\/\d+$/, status: 302,
      payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
    }));
    await accept(recorder, deleteEvidence.evidence.feedback({
      locator: page.getByRole('status'), text: 'Log entry deleted successfully!',
    }));
    await accept(recorder, deleteEvidence.evidence.persistence({
      locator: page.locator('.logbook-row', { hasText: note }), count: 0,
    }));
  }

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
      const actionEvidence = await typedActivation(
        page, button, recorder, state, action,
        { kind: 'disabled', locator: button, disabled: true },
      );
      await accept(recorder, actionEvidence.evidence.loading({
        disabled: true, text: 'Adding...',
      }));
      await button.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(requests).toBe(1);
      releaseFailure();
      const failedResponse = await failedResponsePending;
      expect(failedResponse.status()).toBe(503);
      await expect(button).toBeEnabled();
      await accept(recorder, actionEvidence.evidence.error({
        locator: page.getByRole('alert'), text: 'Quick add is temporarily unavailable.',
      }));
      await accept(recorder, actionEvidence.evidence.feedback({
        locator: page.getByRole('alert'), text: 'Quick add is temporarily unavailable.',
      }));
      await accept(recorder, actionEvidence.evidence.focus({ locator: button }));

      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/log/api/quick_add'
        && response.status() === 200
      ));
      const pouchId = Number(await button.getAttribute('data-pouch-id'));
      const brand = await button.getAttribute('data-pouch-brand');
      const strength = await button.getAttribute('data-pouch-strength');
      const expectedSuccess = `Added 1 ${brand} (${strength}mg)`;
      const logsBeforeSuccess = (await accountSnapshot(page)).logs;
      const successToken = await actionEvidence.evidence.keyboard({
        key: 'Enter', outcome: {
          kind: 'response', pending: successPending, method: 'POST',
          path: /^\/log\/api\/quick_add$/, status: 200,
        },
      });
      recorder.accept(successToken);
      const success = await successPending;
      await accept(recorder, actionEvidence.evidence.request({
        activation: successToken, method: 'POST', path: /^\/log\/api\/quick_add$/, status: 200,
        payload: { kind: 'json', exact: { pouch_id: String(pouchId), quantity: 1 } },
      }));
      expect(failedResponse.request().postDataJSON()).toEqual({
        pouch_id: String(pouchId), quantity: 1,
      });
      await page.waitForLoadState('load');
      await accept(recorder, actionEvidence.evidence.feedback({
        locator: page.getByRole('status'), text: expectedSuccess,
      }));
      const logsAfterSuccess = (await accountSnapshot(page)).logs;
      const priorIds = new Set(logsBeforeSuccess.map(({ id }) => id));
      const newLogs = logsAfterSuccess.filter(({ id }) => !priorIds.has(id));
      expect(newLogs).toEqual([expect.objectContaining({ pouch_id: pouchId, quantity: 1 })]);
      const exactRow = page.locator(`.logbook-row[data-log-id="${newLogs[0].id}"]`);
      await expect(exactRow).toContainText(brand);
      await expect(exactRow).toContainText('1 pouch');
      await accept(recorder, actionEvidence.evidence.persistence({ locator: exactRow, count: 1 }));
      await page.unroute('**/log/api/quick_add');
    }
  }

  await page.goto('/log/bulk');
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Cancel' }), '/log/view', 200,
    { recorder, state: 'log-bulk', action: 'Cancel' },
  );
  const editLink = page.locator('.logbook-row').first().getByRole('link', { name: 'Edit' });
  await expectKeyboardNavigation(page, editLink, new URL(await editLink.getAttribute('href'), page.url()).pathname);
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Cancel' }), '/log/view', 200,
    { recorder, state: 'log-edit', action: 'Cancel' },
  );
  recorder.assertComplete();
  await page.waitForLoadState('networkidle');
  guard.assertClean(expect, {
    stateName: 'logging supporting owner',
    expectedPath: '/log/view',
    expectedStatus: 200,
    expectedHttpErrors: [{
      method: 'POST', path: '/log/api/quick_add', status: 503, count: 4,
    }],
  });
  guard.stop();
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
    page, page.getByRole('link', { name: 'Get immediate support on Today' }), '/today/', 200,
    { recorder, state: 'cravings', action: 'Get immediate support on Today' },
  );
  expect(external).toEqual([]);
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
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: action, exact: true }), '/goals/', 200,
      { recorder, state, action },
    );
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
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: action }), '/', 200,
      { recorder, state, action },
    );
  }
  recorder.assertComplete();
});
