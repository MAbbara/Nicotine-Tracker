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


async function proveKeyboardActivation(page, locator, recorder, state, action, key = 'Enter') {
  await recorder.prove(state, action, 'keyboard', async (check) => {
    await locator.focus();
    await check(expect(locator).toBeFocused());
    await check(expect(locator).toHaveAccessibleName(action));
    await page.keyboard.press(key);
  });
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
  if (evidence) {
    await proveKeyboardActivation(
      page, locator, evidence.recorder, evidence.state, evidence.action,
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
    await evidence.recorder.prove(
      evidence.state, evidence.action, 'request', async (check) => {
        await check(expect(response.request().method()).toBe('GET'));
        await check(expect(new URL(response.url()).pathname).toBe(expectedPath));
        await check(expect(response.status()).toBe(expectedStatus));
        await check(expect(response.request().postData()).toBeNull());
      },
    );
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
  await proveKeyboardActivation(page, page.getByRole('button', { name: action }), recorder, state, action);
  await recorder.prove(state, action, 'focus', async (check) => {
    await check(expect(field).toBeFocused());
  });
  await recorder.prove(state, action, 'error', async (check) => {
    await check(expect.poll(() => posts).toBe(0));
    await check(expect(field).toBeFocused());
  });
  await recorder.prove(state, action, 'feedback', async (check) => {
    await check(expect(field).toHaveJSProperty('validationMessage', rejectedFeedback));
  });

  await field.fill(confirmation);
  const responsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/settings/data'
  ));
  await field.focus();
  await page.getByRole('button', { name: action }).focus();
  await page.keyboard.press('Enter');
  const response = await responsePending;
  await recorder.prove(state, action, 'request', async (check) => {
    await check(expect(response.request().method()).toBe('POST'));
    await check(expect(new URL(response.url()).pathname).toBe('/settings/data'));
    await check(expect(response.status()).toBe(302));
    await check(expect(formPayload(response.request())).toEqual(expect.objectContaining(requestPayload)));
    await check(expect(posts).toBe(1));
  });
  page.off('request', countPost);
  await recorder.prove(state, action, 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText(successFeedback));
  });
  await recorder.prove(state, action, 'persistence', verifyPersistence);
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
  expect(() => emptyProfileRecorder.assertComplete())
    .toThrow(/supporting runtime dimension evidence/);

  await expect(emptyProfileRecorder.prove(
    'profile', 'Save profile', 'keyboard', async () => {},
  )).rejects.toThrow(/must execute at least one assertion/);
  await expect(emptyProfileRecorder.prove(
    'profile', 'Save profile', 'keyboard', async (check) => {
      await check(expect(false).toBe(true));
    },
  )).rejects.toThrow();
  expect(() => emptyProfileRecorder.assertComplete())
    .toThrow(/supporting runtime dimension evidence/);

  await expect(emptyProfileRecorder.prove(
    'preferences', 'Save preferences', 'keyboard', async (check) => {
      await check(expect(true).toBe(true));
    },
  )).rejects.toThrow(/owns profile › Save profile/);
  await expect(emptyProfileRecorder.prove(
    'profile', 'Save profile', 'loading', async (check) => {
      await check(expect(true).toBe(true));
    },
  )).rejects.toThrow(/not asserted/);
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
    await proveKeyboardActivation(
      page, skip, recorder, state.name, 'Skip to main content',
    );
    await recorder.prove(state.name, 'Skip to main content', 'focus', async (check) => {
      await check(expect(page.locator('#main-content')).toBeFocused());
    });
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
      verifyPersistence: async (check) => {
        const afterCleanup = await accountSnapshot(page);
        await check(expect(
          afterCleanup.logs.filter((entry) => entry.notes === `duplicate ${state}`),
        ).toHaveLength(1));
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
      verifyPersistence: async (check) => {
        const afterMerge = await accountSnapshot(page);
        const retained = afterMerge.pouches.filter(
          (entry) => entry.brand.toLowerCase() === mergeBrand.toLowerCase(),
        );
        await check(expect(retained).toHaveLength(1));
        await check(expect(
          afterMerge.logs.find((entry) => entry.notes === `merge-linked ${state}`).pouch_id,
        ).toBe(retained[0].id));
      },
    });

    const recalculateResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/settings/data'
    ));
    await proveKeyboardActivation(
      page, page.getByRole('button', { name: 'Recalculate' }), recorder, state, 'Recalculate',
    );
    const recalculateResponse = await recalculateResponsePending;
    await recorder.prove(state, 'Recalculate', 'request', async (check) => {
      await check(expect(recalculateResponse.status()).toBe(302));
      await check(expect(new URL(recalculateResponse.url()).pathname).toBe('/settings/data'));
      await check(expect(formPayload(recalculateResponse.request())).toEqual(expect.objectContaining({
        action: 'recalculate_goals',
      })));
    });
    await recorder.prove(state, 'Recalculate', 'feedback', async (check) => {
      await check(expect(page.getByRole('status')).toHaveText('Recalculated streaks for 1 goals.'));
    });
    await recorder.prove(state, 'Recalculate', 'persistence', async (check) => {
      const afterRecalculation = await accountSnapshot(page);
      await check(expect(afterRecalculation.goals).toEqual([
        expect.objectContaining({ current_streak: 0, best_streak: 1 }),
      ]));
    });

    await runConfirmedDataAction({
      page, recorder, state, action: 'Anonymize Data',
      fieldName: 'Type ANONYMIZE to confirm', confirmation: 'ANONYMIZE',
      requestPayload: { action: 'anonymize_data', confirm_anonymize: 'ANONYMIZE' },
      rejectedFeedback: 'Please match the requested format.',
      successFeedback: 'Your personal data has been anonymized successfully.',
      verifyPersistence: async (check) => {
        const afterAnonymize = await accountSnapshot(page);
        await check(expect(afterAnonymize.profile).toEqual(expect.objectContaining({
          age: null, gender: null, weight: null,
        })));
        await check(expect(afterAnonymize.preferences).toEqual(expect.objectContaining({
          units_preference: 'mg', preferred_brands: null,
        })));
        await check(expect(afterAnonymize.logs.every((entry) => entry.notes === null)).toBe(true));
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
      verifyPersistence: async (check) => {
        const afterDelete = await accountSnapshot(page);
        await check(expect(afterDelete.logs).toEqual([]));
      },
    });

    if (state !== 'data') {
      const downloadPending = page.waitForEvent('download');
      const exportResponsePending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/settings/data'
      ));
      const exportButton = page.getByRole('button', { name: 'Download Data' });
      await proveKeyboardActivation(page, exportButton, recorder, state, 'Download Data');
      const [download, exportResponse] = await Promise.all([downloadPending, exportResponsePending]);
      await recorder.prove(state, 'Download Data', 'request', async (check) => {
        await check(expect(exportResponse.request().method()).toBe('POST'));
        await check(expect(exportResponse.status()).toBe(200));
        await check(expect(new URL(exportResponse.url()).pathname).toBe('/settings/data'));
        await check(expect(formPayload(exportResponse.request())).toEqual(expect.objectContaining({
          action: 'export_data',
        })));
        await check(expect(download.suggestedFilename()).toMatch(/^nicotine_tracker_data_/));
      });
      const offline = page.getByRole('checkbox', { name: 'Save actions for offline use' });
      const requested = !(await offline.isChecked());
      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === '/settings/privacy/offline-queue'
      ));
      await recorder.prove(state, 'Save actions for offline use', 'keyboard', async (check) => {
        await offline.focus();
        await check(expect(offline).toBeFocused());
        await page.keyboard.press('Space');
      });
      const success = await successPending;
      await recorder.prove(state, 'Save actions for offline use', 'request', async (check) => {
        await check(expect(success.request().method()).toBe('PATCH'));
        await check(expect(new URL(success.url()).pathname).toBe('/settings/privacy/offline-queue'));
        await check(expect(success.status()).toBe(200));
        await check(expect(success.request().postDataJSON()).toEqual({ enabled: requested }));
      });
      await recorder.prove(state, 'Save actions for offline use', 'feedback', async (check) => {
        await check(expect(page.locator('#offline-queue-status')).toHaveAttribute('data-state', 'success'));
        await check(expect(page.locator('#offline-queue-status')).toHaveText(
          requested ? 'Offline saving is on.' : 'Offline saving is off.',
        ));
      });
      await page.reload();
      await recorder.prove(state, 'Save actions for offline use', 'persistence', async (check) => {
        await check(expect(page.getByRole('checkbox', { name: 'Save actions for offline use' }))
          .toBeChecked({ checked: requested }));
      });

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
      await recorder.prove(state, 'Save actions for offline use', 'loading', async (check) => {
        await check(expect(retryToggle).toBeDisabled());
        await check(expect(page.locator('#offline-queue-status')).toHaveAttribute('data-state', 'loading'));
        await check(expect(page.locator('#offline-queue-status')).toHaveText('Saving offline preference…'));
      });
      await retryToggle.evaluate((element) => element.dispatchEvent(new Event('change', { bubbles: true })));
      expect(failures).toBe(1);
      releaseFailure();
      await recorder.prove(state, 'Save actions for offline use', 'error', async (check) => {
        await check(expect(page.locator('#offline-queue-status')).toHaveAttribute('data-state', 'error'));
        await check(expect(page.locator('#offline-queue-status')).toHaveText(
          'Offline preference could not be saved. Please try again.',
        ));
      });
      await recorder.prove(state, 'Save actions for offline use', 'focus', async (check) => {
        await check(expect(retryToggle).toBeFocused());
      });
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
  await proveKeyboardActivation(page, logbookAdd, recorder, 'logbook', 'Add log');
  let dialog = page.getByRole('dialog', { name: 'Add a log' });
  await recorder.prove('logbook', 'Add log', 'focus', async (check) => {
    await check(expect(dialog).toBeVisible());
    await check(expect(dialog.getByLabel('Date')).toBeFocused());
  });
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/log/add');
  dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog).toBeVisible();
  const closeDialog = dialog.getByRole('button', { name: 'Close add log dialog' });
  await proveKeyboardActivation(
    page, closeDialog, recorder, 'log-add', 'Close add log dialog',
  );
  await recorder.prove('log-add', 'Close add log dialog', 'focus', async (check) => {
    await check(expect(dialog).not.toBeVisible());
    await check(expect(page.getByRole('button', { name: 'Add log', exact: true })).toBeFocused());
  });

  const logAddTrigger = page.getByRole('button', { name: 'Add log', exact: true });
  await proveKeyboardActivation(page, logAddTrigger, recorder, 'log-add', 'Add log');
  await recorder.prove('log-add', 'Add log', 'focus', async (check) => {
    await check(expect(dialog).toBeVisible());
    await check(expect(dialog.getByLabel('Date')).toBeFocused());
  });
  const cancelDialog = dialog.getByRole('button', { name: 'Cancel' });
  await proveKeyboardActivation(page, cancelDialog, recorder, 'log-add', 'Cancel');
  await recorder.prove('log-add', 'Cancel', 'focus', async (check) => {
    await check(expect(dialog).not.toBeVisible());
    await check(expect(logAddTrigger).toBeFocused());
  });

  await logAddTrigger.click();
  const addEntry = dialog.getByRole('button', { name: 'Add entry' });
  await proveKeyboardActivation(page, addEntry, recorder, 'log-add', 'Add entry');
  const product = dialog.getByLabel('Product');
  await recorder.prove('log-add', 'Add entry', 'focus', async (check) => {
    await check(expect(product).toBeFocused());
  });
  await recorder.prove('log-add', 'Add entry', 'error', async (check) => {
    await check(expect(product).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('log-add', 'Add entry', 'feedback', async (check) => {
    await check(expect(product).toHaveJSProperty('validationMessage', 'Please select an item in the list.'));
  });
  await dialog.getByLabel('Date').fill('2026-01-11');
  await product.selectOption({ index: 1 });
  await dialog.getByLabel('Quantity').fill('2');
  await dialog.getByLabel('Notes').fill('supporting add entry');
  const addEntryResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/log/add'
  ));
  await addEntry.focus();
  await page.keyboard.press('Enter');
  const addEntryResponse = await addEntryResponsePending;
  await recorder.prove('log-add', 'Add entry', 'request', async (check) => {
    await check(expect(addEntryResponse.status()).toBe(302));
    await check(expect(formPayload(addEntryResponse.request())).toEqual(expect.objectContaining({
      log_date: '2026-01-11', quantity: '2', notes: 'supporting add entry',
    })));
  });
  await recorder.prove('log-add', 'Add entry', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText('Log entry added successfully!'));
  });
  await recorder.prove('log-add', 'Add entry', 'persistence', async (check) => {
    await check(expect(page.locator('.logbook-row', { hasText: 'supporting add entry' })).toBeVisible());
  });

  for (const [state, path] of [['logbook', '/log/view'], ['log-add', '/log/add']]) {
    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
    }
    await page.getByLabel('Search logs').fill('supporting add entry');
    const filterNavigationPending = page.waitForNavigation({ waitUntil: 'load' });
    const filterResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/log/view'
    ));
    await proveKeyboardActivation(
      page, page.getByRole('button', { name: 'Apply filters' }),
      recorder, state, 'Apply filters',
    );
    const [filterResponse] = await Promise.all([
      filterResponsePending, filterNavigationPending,
    ]);
    await recorder.prove(state, 'Apply filters', 'request', async (check) => {
      await check(expect(filterResponse.status()).toBe(200));
      await check(expect(new URL(filterResponse.url()).search).toBe(
        '?q=supporting+add+entry&from_date=&to_date=',
      ));
      await check(expect(filterResponse.request().postData()).toBeNull());
    });

    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
    }
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: 'Bulk add' }), '/log/bulk', 200,
      { recorder, state, action: 'Bulk add' },
    );

    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
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
  await proveKeyboardActivation(page, addEntries, recorder, 'log-bulk', 'Add entries');
  const entries = page.getByLabel('Entries', { exact: true });
  await recorder.prove('log-bulk', 'Add entries', 'focus', async (check) => {
    await check(expect(entries).toBeFocused());
  });
  await recorder.prove('log-bulk', 'Add entries', 'error', async (check) => {
    await check(expect(entries).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('log-bulk', 'Add entries', 'feedback', async (check) => {
    await check(expect(entries).toHaveJSProperty('validationMessage', 'Please fill out this field.'));
  });
  await page.getByLabel('Date for these entries').fill('2026-01-12');
  await entries.fill('1 Bulk Evidence 4mg at 13:00');
  const bulkResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/log/bulk'
  ));
  await addEntries.focus();
  await page.keyboard.press('Enter');
  const bulkResponse = await bulkResponsePending;
  await recorder.prove('log-bulk', 'Add entries', 'request', async (check) => {
    await check(expect(bulkResponse.status()).toBe(302));
    await check(expect(formPayload(bulkResponse.request())).toEqual(expect.objectContaining({
      log_date: '2026-01-12', bulk_text: '1 Bulk Evidence 4mg at 13:00',
    })));
  });
  await recorder.prove('log-bulk', 'Add entries', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText('Successfully added 1 log entries!'));
  });
  await recorder.prove('log-bulk', 'Add entries', 'persistence', async (check) => {
    await check(expect(page.locator('.logbook-row', { hasText: 'Bulk Evidence' })).toBeVisible());
  });

  const supportingRow = page.locator('.logbook-row', { hasText: 'supporting add entry' });
  await supportingRow.getByRole('link', { name: 'Edit' }).click();
  const saveChanges = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Quantity').fill('');
  await proveKeyboardActivation(page, saveChanges, recorder, 'log-edit', 'Save changes');
  const editQuantity = page.getByLabel('Quantity');
  await recorder.prove('log-edit', 'Save changes', 'focus', async (check) => {
    await check(expect(editQuantity).toBeFocused());
  });
  await recorder.prove('log-edit', 'Save changes', 'error', async (check) => {
    await check(expect(editQuantity).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('log-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(editQuantity).toHaveJSProperty('validationMessage', 'Please fill out this field.'));
  });
  await editQuantity.fill('3');
  await page.getByLabel('Notes').fill('supporting edit saved');
  const editSaveResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/log\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  await saveChanges.focus();
  await page.keyboard.press('Enter');
  const editSaveResponse = await editSaveResponsePending;
  await recorder.prove('log-edit', 'Save changes', 'request', async (check) => {
    await check(expect(editSaveResponse.status()).toBe(302));
    await check(expect(formPayload(editSaveResponse.request())).toEqual(expect.objectContaining({
      quantity: '3', notes: 'supporting edit saved',
    })));
  });
  await recorder.prove('log-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText('Log entry updated successfully!'));
  });
  await recorder.prove('log-edit', 'Save changes', 'persistence', async (check) => {
    await check(expect(page.locator('.logbook-row', { hasText: 'supporting edit saved' })).toContainText('3 pouches'));
  });

  for (const [state, path, note, time] of [
    ['logbook', '/log/view', 'delete logbook evidence', '10:15'],
    ['log-add', '/log/add', 'delete log-add evidence', '10:30'],
  ]) {
    await addDetailedLog(page, { date: '2026-01-13', time, notes: note });
    await page.goto(path);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
    }
    const deleteRow = page.locator('.logbook-row', { hasText: note });
    const deleteButton = deleteRow.getByRole('button', { name: 'Delete' });
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await proveKeyboardActivation(page, deleteButton, recorder, state, 'Delete');
    let dismissalPreservedRow = false;
    await recorder.prove(state, 'Delete', 'error', async (check) => {
      await check(expect(deleteRow).toBeVisible());
      dismissalPreservedRow = await deleteRow.isVisible();
    });

    const deleteResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /\/log\/delete\/\d+$/.test(new URL(response.url()).pathname)
    ));
    page.once('dialog', (confirmation) => confirmation.accept());
    await deleteButton.click();
    const deleteResponse = await deleteResponsePending;
    await recorder.prove(state, 'Delete', 'request', async (check) => {
      await check(expect(deleteResponse.request().method()).toBe('POST'));
      await check(expect(deleteResponse.status()).toBe(302));
      await check(expect(new URL(deleteResponse.url()).pathname).toMatch(/^\/log\/delete\/\d+$/));
    });
    await recorder.prove(state, 'Delete', 'persistence', async (check) => {
      await check(expect(dismissalPreservedRow).toBe(true));
      await check(expect(page.locator('.logbook-row', { hasText: note })).toHaveCount(0));
    });
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
      await proveKeyboardActivation(page, button, recorder, state, action);
      await recorder.prove(state, action, 'loading', async (check) => {
        await check(expect(button).toBeDisabled());
        await check(expect(button).toContainText('Adding...'));
      });
      await button.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(requests).toBe(1);
      releaseFailure();
      const failedResponse = await failedResponsePending;
      await recorder.prove(state, action, 'error', async (check) => {
        await check(expect(failedResponse.status()).toBe(503));
        await check(expect(page.getByText('Quick add is temporarily unavailable.')).toBeVisible());
        await check(expect(button).toBeEnabled());
      });
      await recorder.prove(state, action, 'feedback', async (check) => {
        await check(expect(page.getByText('Quick add is temporarily unavailable.')).toBeVisible());
      });
      await recorder.prove(state, action, 'focus', async (check) => {
        await check(expect.poll(() => page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          name: document.activeElement?.getAttribute?.('aria-label'),
          id: document.activeElement?.id || null,
        }))).toEqual({ tag: 'BUTTON', name: action, id: null }));
      });

      const successPending = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/log/api/quick_add'
        && response.status() === 200
      ));
      await keyboardActivate(page, button);
      const success = await successPending;
      await recorder.prove(state, action, 'request', async (check) => {
        await check(expect(failedResponse.request().method()).toBe('POST'));
        await check(expect(failedResponse.request().postDataJSON()).toEqual(expect.objectContaining({
          quantity: 1,
        })));
        await check(expect(success.request().method()).toBe('POST'));
        await check(expect(success.status()).toBe(200));
        await check(expect(success.request().postDataJSON()).toEqual(expect.objectContaining({
          quantity: 1,
        })));
      });
      await page.waitForLoadState('load');
      await recorder.prove(state, action, 'persistence', async (check) => {
        await check(expect(page.locator('.logbook-row')).not.toHaveCount(0));
      });
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
      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: action }), destination, 200,
        { recorder, state, action },
      );
    }
    await page.goto('/dashboard/');
    const disclosure = page.getByText('View daily values', { exact: true });
    if (await disclosure.count()) {
      await recorder.prove(state, 'View daily values', 'keyboard', async (check) => {
        await disclosure.focus();
        await check(expect(disclosure).toBeFocused());
        await check(expect(disclosure.locator('..')).toHaveAttribute('open', ''));
        await check(expect(disclosure).toHaveAccessibleName(/^View daily values −$/));
        await page.keyboard.press('Enter');
        await check(expect(disclosure.locator('..')).not.toHaveAttribute('open', ''));
        await check(expect(disclosure).toHaveAccessibleName(/^View daily values \+$/));
        await page.keyboard.press('Enter');
      });
      await recorder.prove(state, 'View daily values', 'focus', async (check) => {
        await check(expect(disclosure).toBeFocused());
        await check(expect(disclosure.locator('..')).toHaveAttribute('open', ''));
        await check(expect(disclosure).toHaveAccessibleName(/^View daily values −$/));
      });
    }
    if (state === 'dashboard-empty') {
      await expectKeyboardNavigation(
        page, page.getByRole('link', { name: 'Start with Today' }), '/today/', 200,
        { recorder, state, action: 'Start with Today' },
      );
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
    await expectKeyboardNavigation(
      page, page.getByRole('link', { name: action }), '/', 200,
      { recorder, state, action },
    );
  }
  recorder.assertComplete();
});
