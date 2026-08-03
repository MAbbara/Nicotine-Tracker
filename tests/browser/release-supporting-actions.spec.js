const { test, expect } = require('@playwright/test');
const {
  EXPECTED_ACTIONS,
  RELEASE_STATES,
  SUPPORTING_ACTION_RECEIPTS,
  SUPPORTING_ACTION_STATES,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const {
  SUPPORTING_ACTION_POLICY,
} = require('./helpers/supporting_action_policy');
const {
  SUPPORTING_BEHAVIOR_OBLIGATIONS,
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
  validateSupportingCoverage,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


const SUPPORTING_EXPECTED_ACTIONS = Object.freeze(Object.fromEntries(
  SUPPORTING_ACTION_STATES.map((state) => [state, EXPECTED_ACTIONS[state]]),
));


async function keyboardActivate(page, locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
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
  page, locator, expectedPath, expectedStatus = 200,
) {
  await keyboardActivate(page, locator);
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
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


async function runConfirmedDataAction(page, recorder, state, action) {
  await recorder.visitState(page, state);
  await recorder.runScenario(page, state, action, 'invalid', 'success');
}


test('every supporting action has three independent exact coverage authorities', async () => {
  expect(SUPPORTING_BEHAVIOR_OBLIGATIONS).toHaveLength(388);
  for (const state of ['dashboard', 'dashboard-empty', 'dashboard-sparse']) {
    for (const action of ['7 days', '30 days', '90 days', '1 year']) {
      expect(EXPECTED_ACTIONS[state]).toContain(action);
    }
  }
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
    SUPPORTING_EXPECTED_ACTIONS,
    SUPPORTING_ACTION_RECEIPTS,
    SUPPORTING_ACTION_POLICY,
    SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toBe(true);

  const clone = (value) => structuredClone(value);
  const extraManifestState = clone(SUPPORTING_EXPECTED_ACTIONS);
  extraManifestState['fabricated-extra-state'] = ['Fabricated extra action'];
  expect(() => validateSupportingCoverage(
    extraManifestState,
    SUPPORTING_ACTION_RECEIPTS,
    SUPPORTING_ACTION_POLICY,
    SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toThrow(/manifest exact state set differs/);

  const extraManifestAction = clone(SUPPORTING_EXPECTED_ACTIONS);
  extraManifestAction.profile.push('Fabricated profile action');
  expect(() => validateSupportingCoverage(
    extraManifestAction,
    SUPPORTING_ACTION_RECEIPTS,
    SUPPORTING_ACTION_POLICY,
    SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toThrow(/manifest actions differ from exact baseline inventory/);

  const receiptOwnerMutation = clone(SUPPORTING_ACTION_RECEIPTS);
  receiptOwnerMutation.find((entry) => (
    entry.state === 'profile' && entry.action === 'Save profile'
  )).owner = SUPPORTING_OWNER_TITLES.settingsPreferences;
  expect(() => validateSupportingCoverage(
    SUPPORTING_EXPECTED_ACTIONS, receiptOwnerMutation,
    SUPPORTING_ACTION_POLICY, SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toThrow(/receipt owner differs/);

  const policyApplicabilityMutation = clone(SUPPORTING_ACTION_POLICY);
  policyApplicabilityMutation.find((entry) => (
    entry.state === 'account' && entry.action === 'Update email'
  )).dimensions.focus.status = 'not-applicable';
  expect(() => validateSupportingCoverage(
    SUPPORTING_EXPECTED_ACTIONS, SUPPORTING_ACTION_RECEIPTS,
    policyApplicabilityMutation, SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toThrow(/focus applicability differs/);

  const policyReasonMutation = clone(SUPPORTING_ACTION_POLICY);
  policyReasonMutation.find((entry) => (
    entry.state === 'profile' && entry.action === 'Save profile'
  )).dimensions.loading.reason = 'mutated policy reason';
  expect(() => validateSupportingCoverage(
    SUPPORTING_EXPECTED_ACTIONS, SUPPORTING_ACTION_RECEIPTS,
    policyReasonMutation, SUPPORTING_BEHAVIOR_OBLIGATIONS,
  )).toThrow(/loading reason differs/);

  const behaviorReasonMutation = clone(SUPPORTING_BEHAVIOR_OBLIGATIONS);
  behaviorReasonMutation.find((entry) => (
    entry.state === 'profile' && entry.action === 'Save profile'
  )).dimensions.loading.reason = 'mutated behavior reason';
  expect(() => validateSupportingCoverage(
    SUPPORTING_EXPECTED_ACTIONS, SUPPORTING_ACTION_RECEIPTS,
    SUPPORTING_ACTION_POLICY, behaviorReasonMutation,
  )).toThrow(/loading reason differs/);

  for (const [sourceIndex, sourceName] of [
    [1, 'supporting receipts'], [2, 'supporting policy'],
    [3, 'supporting behavior obligations'],
  ]) {
    const sources = [
      SUPPORTING_EXPECTED_ACTIONS,
      clone(SUPPORTING_ACTION_RECEIPTS),
      clone(SUPPORTING_ACTION_POLICY),
      clone(SUPPORTING_BEHAVIOR_OBLIGATIONS),
    ];
    sources[sourceIndex].push({
      ...clone(sources[sourceIndex][0]),
      state: 'fabricated-extra-state',
      action: 'Fabricated extra action',
    });
    expect(() => validateSupportingCoverage(...sources), `${sourceName} extra action`)
      .toThrow(/exact (?:length|state|action)/);

    const dimensionSources = [
      SUPPORTING_EXPECTED_ACTIONS,
      clone(SUPPORTING_ACTION_RECEIPTS),
      clone(SUPPORTING_ACTION_POLICY),
      clone(SUPPORTING_BEHAVIOR_OBLIGATIONS),
    ];
    dimensionSources[sourceIndex][0].dimensions.fabricated = {
      status: 'asserted', reason: 'fabricated dimension',
    };
    expect(
      () => validateSupportingCoverage(...dimensionSources),
      `${sourceName} extra dimension`,
    ).toThrow(/exact dimension/);
  }

  const emptyProfileRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  expect(emptyProfileRecorder.record).toBeUndefined();
  expect(emptyProfileRecorder.prove).toBeUndefined();
  expect(() => emptyProfileRecorder.assertComplete())
    .toThrow(/supporting runtime dimension evidence/);
});


test('causal supporting transactions reject unrelated, pre-existing, and reusable evidence', async ({ page, context }) => {
  await loginAs(page, 'release-settings@example.com');
  await page.goto('/settings/profile');

  const chromeRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.chrome, expect,
  );
  const skipAction = chromeRecorder.forScenario(page, 'profile', 'Skip to main content');
  const validReceipt = await skipAction.run('success');
  chromeRecorder.accept(validReceipt);
  expect(() => chromeRecorder.accept(validReceipt)).toThrow(/already consumed/);

  await page.goto('/settings/profile');
  const secondSkipReceipt = await chromeRecorder
    .forScenario(page, 'profile', 'Skip to main content').run('success');
  const wrongRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  expect(() => wrongRecorder.accept(secondSkipReceipt)).toThrow(/different recorder/);
  expect(() => chromeRecorder.accept(Object.freeze({}))).toThrow(/forged/);

  const profileRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  const firstPartial = profileRecorder.forScenario(page, 'profile', 'Save profile');
  const secondPartial = profileRecorder.forScenario(page, 'profile', 'Save profile');
  expect(await firstPartial.run('invalid')).toBeUndefined();
  await page.reload();
  expect(await secondPartial.run('invalid')).toBeUndefined();
  expect(() => profileRecorder.accept(undefined)).toThrow(/forged/);
  await expect(profileRecorder.forScenario(page, 'profile', 'Save profile').run('success'))
    .rejects.toThrow(/expected branch invalid/);

  const otherPage = await context.newPage();
  await otherPage.goto('/settings/profile');
  const otherSave = otherPage.getByRole('button', { name: 'Save profile' });
  expect(() => profileRecorder.forScenario(page, 'profile', 'Save profile', otherSave))
    .toThrow(/only page, state, and action/);
  await otherPage.close();

  await page.evaluate(() => {
    const fake = document.createElement('button');
    fake.id = 'fabricated-save-profile';
    fake.textContent = 'Save profile';
    document.body.prepend(fake);
  });
  expect(() => profileRecorder.forScenario(
    page, 'profile', 'Save profile', page.locator('#fabricated-save-profile'),
  )).toThrow(/only page, state, and action/);

  await page.evaluate(() => document.querySelector('#fabricated-save-profile')?.remove());

  const markerRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  await page.getByRole('heading', { name: 'Profile', level: 1 }).evaluate((heading) => {
    heading.textContent = 'Fabricated profile state';
  });
  await expect(markerRecorder.forScenario(page, 'profile', 'Save profile').run('invalid'))
    .rejects.toThrow(/authoritative state marker/);
  await page.reload();

  const descriptorAttempt = profileRecorder.forScenario(page, 'profile', 'Save profile');
  await expect(descriptorAttempt.run('invalid', {
    feedback: page.locator('body [role="status"]'),
    focus: page.locator('body'),
    persistence: { expectedBefore: 30, expectedAfter: 30 },
  })).rejects.toThrow(/one enumerated branch name/);

  await page.request.get('/auth/logout');
  await loginAs(page, 'release-analytics-empty@example.com');
  await page.goto('/dashboard/');
  const dashboardRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.dashboard, expect,
  );
  await expect(dashboardRecorder.forScenario(page, 'dashboard', '7 days').run('success'))
    .rejects.toThrow(/toBe/);
});


test('catalog authority rejects real control, request, artifact, state, and precondition substitutions', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');

  const chromeRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.chrome, expect,
  );
  await page.goto('/settings/profile');
  const today = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Today', exact: true });
  await today.evaluate((link) => link.setAttribute('href', '/journey/'));
  await expect(chromeRecorder.forScenario(page, 'profile', 'Today').run('success'))
    .rejects.toThrow(/catalog control (?:contract|selector)/);

  await page.goto('/settings/data?supporting_state=data-settings-action');
  await expect(chromeRecorder.forScenario(page, 'data', 'Skip to main content').run('success'))
    .rejects.toThrow(/authoritative state (?:query|invariant)/);

  const settingsDataRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsData, expect,
  );
  await page.goto('/settings/data?supporting_state=data');
  await page.evaluate(() => {
    const real = document.querySelector('a[href="/settings/account#account-delete-title"]');
    real.setAttribute('aria-label', 'Original deletion review link');
    const fake = document.createElement('a');
    fake.href = '/today/';
    fake.textContent = 'Review account deletion';
    document.querySelector('#main-content').prepend(fake);
  });
  await expect(settingsDataRecorder
    .forScenario(page, 'data', 'Review account deletion').run('success'))
    .rejects.toThrow(/catalog control (?:contract|selector)/);

  const profileRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  await page.goto('/settings/profile');
  await page.locator('form[action="/settings/profile"]').evaluate((form) => {
    form.method = 'get';
    form.action = '/settings/preferences';
  });
  await expect(profileRecorder.forScenario(page, 'profile', 'Save profile').run('invalid'))
    .rejects.toThrow(/catalog control contract|toHaveCount/);

  await page.goto('/settings/profile');
  await page.evaluate(() => {
    const real = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Save profile');
    real.setAttribute('aria-label', 'Original save profile control');
    const fake = document.createElement('button');
    fake.type = 'submit';
    fake.textContent = 'Save profile';
    real.form.prepend(fake);
  });
  await expect(profileRecorder.forScenario(page, 'profile', 'Save profile').run('invalid'))
    .rejects.toThrow(/catalog control|toHaveCount/);

  const accountRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountValidation, expect,
  );
  await page.goto('/settings/account');
  await page.evaluate(() => {
    const form = document.querySelector('input[value="update_email"]').form;
    const rogue = document.createElement('input');
    rogue.type = 'hidden';
    rogue.name = 'rogue_field';
    rogue.value = 'caller-owned';
    form.append(rogue);
  });
  await expect(accountRecorder.forScenario(page, 'account', 'Update email').run('rejected'))
    .rejects.toThrow(/catalog request payload/);

  await page.request.get('/auth/logout');
  await loginAs(page, 'release-analytics-ready@example.com');
  await page.goto('/dashboard/');
  await page.locator('[data-dashboard-range-days]').evaluate((marker) => {
    marker.setAttribute('data-dashboard-range-days', '999');
  });
  const dashboardRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.dashboard, expect,
  );
  await expect(dashboardRecorder.forScenario(page, 'dashboard', '7 days').run('success'))
    .rejects.toThrow(/catalog precondition/);
});


test('catalog authority rejects successful-looking transactions with unchanged persistence', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');
  const profileRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  await profileRecorder.visitState(page, 'profile');
  await page.route('**/settings/profile', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.continue({
      headers: {
        ...route.request().headers(),
        'X-Supporting-Persistence-Noop': '1',
      },
    });
  });
  const transaction = profileRecorder.forScenario(page, 'profile', 'Save profile');
  expect(await transaction.run('invalid')).toBeUndefined();
  await expect(transaction.run('success')).rejects.toThrow(/toEqual/);
  await page.unroute('**/settings/profile');
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
    await recorder.runScenario(page, state.name, 'Skip to main content', 'success');
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
    await recorder.runScenario(page, state.name, 'Nicotine Tracker home', 'success');
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
    await recorder.runScenario(page, state.name, accountName, 'success');
    await expectGuardClean(destinationGuard, page, `${state.name} account destination`);
    destinationGuard.stop();

    for (const [name, allowAnalytics] of [
      ['Today', false],
      ['Journey', false],
      ['Insights', true],
      ['You', false],
    ]) {
      sourceGuard = watchForProductProblems(page);
      await visitState(page, state);
      destinationGuard = await handoffProductGuard(
        page,
        sourceGuard,
        `${state.name} before ${name}`,
        { allowAnalytics: state.allowAnalytics, expectedStatus: state.status },
      );
      await recorder.runScenario(page, state.name, name, 'success');
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
    for (const name of [
      'Profile', 'Account', 'Preferences', 'Reminders', 'Data & privacy', 'Statistics',
    ]) {
      const sourceGuard = watchForProductProblems(page);
      await visitState(page, state);
      const destinationGuard = await handoffProductGuard(
        page, sourceGuard, `${state.name} before settings ${name}`,
      );
      await recorder.runScenario(page, state.name, name, 'success');
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

    await recorder.visitState(page, state);
    await expect(page.getByText('1 potential group found.')).toBeVisible();
    await expect(page.getByText('1 similar entry found.')).toBeVisible();
    await runConfirmedDataAction(page, recorder, state, 'Cleanup');
    await runConfirmedDataAction(page, recorder, state, 'Merge');

    await recorder.visitState(page, state);
    await recorder.runScenario(page, state, 'Recalculate', 'success');

    await runConfirmedDataAction(page, recorder, state, 'Anonymize Data');

    await runConfirmedDataAction(page, recorder, state, 'Delete Logs');

    if (state !== 'data') {
      await recorder.visitState(page, state);
      await recorder.runScenario(page, state, 'Download Data', 'success');
      await recorder.visitState(page, state);
      await recorder.runScenario(
        page, state, 'Save actions for offline use', 'success', 'failure',
      );

      await recorder.visitState(page, state);
      await recorder.runScenario(page, state, 'Review account deletion', 'success');
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
    await recorder.runScenario(page, state, action, 'success');
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
  let dialog = page.getByRole('dialog', { name: 'Add a log' });
  await recorder.runScenario(page, 'logbook', 'Add log', 'toggle');
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/log/add');
  dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog).toBeVisible();
  await recorder.runScenario(page, 'log-add', 'Close add log dialog', 'toggle');

  const logAddTrigger = page.getByRole('button', { name: 'Add log', exact: true });
  await recorder.runScenario(page, 'log-add', 'Add log', 'toggle');
  await recorder.runScenario(page, 'log-add', 'Cancel', 'toggle');

  await logAddTrigger.click();
  await recorder.runScenario(page, 'log-add', 'Add entry', 'invalid', 'success');
  const addedRow = page.locator('.logbook-row', { hasText: 'supporting add entry' });

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
    await recorder.runScenario(page, state, 'Apply filters', 'success');

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
    await recorder.runScenario(page, state, 'Bulk add', 'success');

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
    await recorder.runScenario(page, state, 'Edit', 'success');
  }

  await page.goto('/log/bulk');
  await recorder.runScenario(page, 'log-bulk', 'Add entries', 'invalid', 'success');
  const bulkRow = page.locator('.logbook-row', { hasText: 'Bulk Evidence' });

  const supportingRow = page.locator('.logbook-row', { hasText: 'supporting add entry' });
  await supportingRow.getByRole('link', { name: 'Edit' }).click();
  await recorder.runScenario(page, 'log-edit', 'Save changes', 'invalid', 'success');
  const editedRow = page.locator('.logbook-row', { hasText: 'supporting edit saved' });

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
    await recorder.runScenario(page, state, 'Delete', 'dismiss', 'accept');
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
      await recorder.runScenario(page, state, action, 'failure', 'success');
    }
  }

  await page.goto('/log/bulk');
  await recorder.runScenario(page, 'log-bulk', 'Cancel', 'success');
  const editLink = page.locator('.logbook-row').first().getByRole('link', { name: 'Edit' });
  await expectKeyboardNavigation(page, editLink, new URL(await editLink.getAttribute('href'), page.url()).pathname);
  await recorder.runScenario(page, 'log-edit', 'Cancel', 'success');
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
  await recorder.runScenario(
    page, 'cravings', 'Get immediate support on Today', 'success',
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
    await recorder.runScenario(page, state, action, 'success');
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
    await recorder.runScenario(page, state, action, 'success');
  }
  recorder.assertComplete();
});
