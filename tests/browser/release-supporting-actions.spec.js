const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const {
  EXPECTED_ACTIONS,
  RELEASE_STATES,
  SUPPORTING_ACTION_RECEIPTS,
  SUPPORTING_ACTION_STATES,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const {
  SUPPORTING_ACTION_BASELINES,
} = require('./helpers/supporting_action_baseline');
const {
  SUPPORTING_ACTION_POLICY,
} = require('./helpers/supporting_action_policy');
const {
  SUPPORTING_BEHAVIOR_OBLIGATIONS,
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
  validateSupportingCoverage,
} = require('./helpers/supporting_behavior_contract');
const {
  STATE_SCENARIOS,
  supportingControlAuthority,
} = require('./helpers/supporting_action_scenarios');
const { watchForProductProblems } = require('./helpers/product_guard');


const SUPPORTING_EXPECTED_ACTIONS = Object.freeze(Object.fromEntries(
  SUPPORTING_ACTION_STATES.map((state) => [state, EXPECTED_ACTIONS[state]]),
));
let disposableRegistrationSequence = 0;


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
  disposableRegistrationSequence += 1;
  const uniqueRunId = `${process.pid}${testInfo.workerIndex}${disposableRegistrationSequence}`;
  const suffix = `${label}-${testInfo.project.name}-${uniqueRunId}`
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
  expect(SUPPORTING_BEHAVIOR_OBLIGATIONS).toHaveLength(415);
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

  const genericSelectors = new Set([
    'button[type="submit"]', 'button[type="button"]',
    'input[type="checkbox"]', 'summary', 'button[data-pouch-id]',
  ]);
  const genericAuthorities = SUPPORTING_ACTION_BASELINES.filter((entry) => {
    const authority = supportingControlAuthority(entry.state, entry.action, entry.profile);
    return authority.scope?.selector === '#main-content'
      && genericSelectors.has(authority.selector);
  }).map(({ state, action }) => `${state} › ${action}`);
  expect(genericAuthorities, 'generic supporting control authorities').toEqual([]);

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


test('current Logbook primary action is a request-free keyboard focus jump', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.chrome, expect);
  await loginAs(page, 'release-inventory@example.com');
  await recorder.visitState(page, 'logbook');
  page.setDefaultTimeout(2_000);

  let sameDocumentRequests = 0;
  const countSameDocumentRequest = (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/log/view') {
      sameDocumentRequests += 1;
    }
  };
  page.on('request', countSameDocumentRequest);
  try {
    await recorder.runScenario(page, 'logbook', 'Logbook', 'success');
    await expect(page).toHaveURL(/\/log\/view#main-content$/);
    await expect(page.locator('#main-content')).toBeFocused();
    expect(sameDocumentRequests).toBe(0);
  } finally {
    page.off('request', countSameDocumentRequest);
  }
});


test('every mutation authority has an exact form and request identity', () => {
  const mutationProfiles = new Set([
    'destructiveMutation', 'download', 'formMutation', 'rowDelete', 'validatedMutation',
  ]);
  const missingMutationForms = SUPPORTING_ACTION_BASELINES.filter((entry) => {
    const authority = supportingControlAuthority(entry.state, entry.action, entry.profile);
    return mutationProfiles.has(entry.profile) && !authority.form;
  }).map(({ state, action }) => `${state} › ${action}`);
  expect(missingMutationForms, 'mutation authorities without exact form identity').toEqual([]);
});


test('supporting owners cannot authorize state entry through the local manifest visitor', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  expect(source).not.toMatch(/async function visitState\(/);
  expect(source).not.toMatch(/await visitState\(/);
  expect(source).not.toMatch(/page\.goto\(state\.path/);
});


test('catalog state binding rejects disposable Data, anonymous, and local-visit substitutions', async ({ page }, testInfo) => {
  await registerDisposable(page, testInfo, 'data-data-offline-disabled');
  await page.goto('/settings/data');
  const chromeRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.chrome, expect,
  );
  await chromeRecorder.visitState(page, 'data-offline-enabled');
  await expect(chromeRecorder
    .forScenario(page, 'data-offline-enabled', 'Skip to main content').run('success'))
    .rejects.toThrow(/authoritative state (?:principal|invariant)/);

  await signOut(page);
  await loginAs(page, 'release-settings@example.com');
  await chromeRecorder.visitState(page, 'anonymous-not-found');
  await expect(chromeRecorder
    .forScenario(page, 'anonymous-not-found', 'Skip to main content').run('success'))
    .rejects.toThrow(/authoritative anonymous principal/);

  await page.goto('/settings/profile');
  await expect(chromeRecorder
    .forScenario(page, 'profile', 'Skip to main content').run('success'))
    .rejects.toThrow(/authoritative state invariant/);
});


test('offline supporting states reject the opposite persisted precondition', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.dataExact, expect);
  for (const [state, email, opposite] of [
    ['data-offline-enabled', 'release-offline-enabled@example.com', false],
    ['data-offline-disabled', 'release-offline-disabled@example.com', true],
  ]) {
    await signOut(page);
    await loginAs(page, email);
    await recorder.visitState(page, state);
    const control = page.getByRole('checkbox', { name: 'Save actions for offline use' });
    if (opposite) await control.check();
    else await control.uncheck();
    await page.reload();
    await expect(recorder.forScenario(
      page, state, 'Save actions for offline use',
    ).run('success')).rejects.toThrow(/precondition/);
  }
});


test('causal supporting transactions reject moved stale feedback, unrelated focus, and reusable evidence', async ({ page, context }) => {
  await loginAs(page, 'release-settings@example.com');

  const chromeRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.chrome, expect,
  );
  await chromeRecorder.visitState(page, 'profile');
  const skipAction = chromeRecorder.forScenario(page, 'profile', 'Skip to main content');
  const validReceipt = await skipAction.run('success');
  chromeRecorder.accept(validReceipt);
  expect(() => chromeRecorder.accept(validReceipt)).toThrow(/already consumed/);

  await chromeRecorder.visitState(page, 'profile');
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
  const dashboardRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.dashboard, expect,
  );
  await dashboardRecorder.visitState(page, 'dashboard');
  await expect(dashboardRecorder.forScenario(page, 'dashboard', '7 days').run('success'))
    .rejects.toThrow(/authoritative state principal/);

  await signOut(page);
  await loginAs(page, 'release-settings@example.com');
  const feedbackRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsReminders, expect,
  );
  await feedbackRecorder.visitState(page, 'reminders');
  await page.evaluate(() => {
    const realStatus = document.querySelector('#weekly-report-status');
    const staleStatus = document.createElement('p');
    staleStatus.setAttribute('role', 'status');
    staleStatus.textContent = 'Weekly report queued.';
    document.querySelector('#test-discord-webhook').closest('.reminders-action')
      .append(staleStatus);
    document.querySelector('#trigger-weekly-report').addEventListener('click', () => {
      realStatus.remove();
      staleStatus.id = 'weekly-report-status';
    }, { capture: true, once: true });
  });
  await expect(feedbackRecorder
    .forScenario(page, 'reminders', 'Send weekly report').run('success'))
    .rejects.toThrow(/feedback.*(?:existed|caused|identity)/i);
});


test('catalog authority rejects same-scope clones and real control, request, artifact, state, and precondition substitutions', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');

  const chromeRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.chrome, expect,
  );
  await chromeRecorder.visitState(page, 'profile');
  const today = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Today', exact: true });
  await today.evaluate((link) => link.setAttribute('href', '/journey/'));
  await expect(chromeRecorder.forScenario(page, 'profile', 'Today').run('success'))
    .rejects.toThrow(/catalog control (?:contract|selector)/);

  await chromeRecorder.visitState(page, 'data');
  await page.goto('/settings/data?supporting_state=data-settings-action');
  await expect(chromeRecorder.forScenario(page, 'data', 'Skip to main content').run('success'))
    .rejects.toThrow(/authoritative state (?:query|invariant)/);

  const settingsDataRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsData, expect,
  );
  await settingsDataRecorder.visitState(page, 'data');
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
  await profileRecorder.visitState(page, 'profile');
  await page.locator('form[action="/settings/profile"]').evaluate((form) => {
    form.method = 'get';
    form.action = '/settings/preferences';
  });
  await expect(profileRecorder.forScenario(page, 'profile', 'Save profile').run('invalid'))
    .rejects.toThrow(/catalog control contract|toHaveCount/);

  await profileRecorder.visitState(page, 'profile');
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

  await profileRecorder.visitState(page, 'profile');
  await page.locator(
    '.profile-section form[action="/settings/profile"] .settings-save-row',
  ).evaluate((scope) => {
    const real = scope.querySelector('button.c-button--primary[type="submit"]');
    const clone = real.cloneNode(true);
    real.setAttribute('aria-label', 'Original save profile control');
    scope.append(clone);
  });
  await expect(profileRecorder.forScenario(page, 'profile', 'Save profile').run('invalid'))
    .rejects.toThrow(/catalog control selector/);

  const accountRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountValidation, expect,
  );
  await accountRecorder.visitState(page, 'account');
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
  const dashboardRecorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.dashboard, expect,
  );
  await dashboardRecorder.visitState(page, 'dashboard');
  await page.locator('[data-dashboard-range-days]').evaluate((marker) => {
    marker.setAttribute('data-dashboard-range-days', '999');
  });
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


test('catalog authority rejects route-fulfilled account feedback with no server action invariant', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountValidation, expect,
  );
  await recorder.visitState(page, 'account');
  await page.route('**/settings/account', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 422,
      contentType: 'text/html',
      body: `<!doctype html><html><body><main id="main-content">
        <h1>Account</h1>
        <form method="post" action="/settings/account">
          <input type="hidden" name="action" value="update_email">
          <label for="new_email">New email address</label>
          <input id="new_email" name="new_email" type="email">
          <label for="password">Current password</label>
          <input id="password" name="password" type="password" autofocus>
          <p id="password-error" role="alert">Current password is incorrect.</p>
          <div class="settings-save-row"><button type="submit">Update email</button></div>
        </form>
      </main></body></html>`,
    });
  });
  await expect(recorder.forScenario(page, 'account', 'Update email').run('rejected'))
    .rejects.toThrow(/server action invariant/);
  await page.unroute('**/settings/account');
});


test('catalog authority rejects unrelated focus injected into a substituted account response', async ({ page }) => {
  await loginAs(page, 'release-settings@example.com');
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountValidation, expect,
  );
  await recorder.visitState(page, 'account');
  await page.route('**/settings/account', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 422,
      contentType: 'text/html',
      headers: { 'x-supporting-action-invariant': 'account:update_email:rejected' },
      body: `<!doctype html><html><body><main id="main-content">
        <h1>Account</h1>
        <input id="unrelated-focus" autofocus>
        <form method="post" action="/settings/account">
          <input type="hidden" name="action" value="update_email">
          <label for="new_email">New email address</label>
          <input id="new_email" name="new_email" type="email">
          <label for="password">Current password</label>
          <input id="password" name="password" type="password">
          <p id="password-error" role="alert">Current password is incorrect.</p>
          <div class="settings-save-row"><button type="submit">Update email</button></div>
        </form>
      </main></body></html>`,
    });
  });
  await expect(recorder.forScenario(page, 'account', 'Update email').run('rejected'))
    .rejects.toThrow(/focus/i);
  await page.unroute('**/settings/account');
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
    await recorder.visitState(page, state.name);
    await recorder.runScenario(page, state.name, 'Skip to main content', 'success');
    await expectGuardClean(sourceGuard, page, `${state.name} skip`, {
      allowAnalytics: state.allowAnalytics,
      expectedStatus: STATE_SCENARIOS[state.name].visit.status,
    });
    sourceGuard.stop();

    sourceGuard = watchForProductProblems(page);
    await recorder.visitState(page, state.name);
    let destinationGuard = await handoffProductGuard(
      page,
      sourceGuard,
      `${state.name} before wordmark`,
      { allowAnalytics: state.allowAnalytics,
        expectedStatus: STATE_SCENARIOS[state.name].visit.status },
    );
    await recorder.runScenario(page, state.name, 'Nicotine Tracker home', 'success');
    await expectGuardClean(destinationGuard, page, `${state.name} wordmark destination`);
    destinationGuard.stop();

    if (!state.email) return;

    sourceGuard = watchForProductProblems(page);
    await recorder.visitState(page, state.name);
    const accountName = `Open your space for ${state.email}`;
    destinationGuard = await handoffProductGuard(
      page,
      sourceGuard,
      `${state.name} before account`,
      { allowAnalytics: state.allowAnalytics,
        expectedStatus: STATE_SCENARIOS[state.name].visit.status },
    );
    await recorder.runScenario(page, state.name, accountName, 'success');
    await expectGuardClean(destinationGuard, page, `${state.name} account destination`);
    destinationGuard.stop();

    for (const [name, allowAnalytics] of [
      ['Today', false],
      ['Logbook', false],
      ['Journey', false],
      ['Insights', true],
      ['You', false],
    ]) {
      sourceGuard = watchForProductProblems(page);
      await recorder.visitState(page, state.name);
      destinationGuard = await handoffProductGuard(
        page,
        sourceGuard,
        `${state.name} before ${name}`,
        { allowAnalytics: state.allowAnalytics,
          expectedStatus: STATE_SCENARIOS[state.name].visit.status },
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
      await recorder.visitState(page, state.name);
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
  for (const [state, action] of [
    ['catalog-add', '← Your pouches'],
    ['catalog-add', 'Cancel'],
    ['catalog-edit', '← Your pouches'],
    ['catalog-edit', 'Cancel'],
  ]) {
    await recorder.visitState(page, state);
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

  await recorder.visitState(page, 'logbook');
  let dialog = page.getByRole('dialog', { name: 'Add a log' });
  await recorder.runScenario(page, 'logbook', 'Add log', 'toggle');
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await recorder.visitState(page, 'log-add');
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
    await recorder.visitState(page, state);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.getByLabel('Search logs').fill('supporting add entry');
    await recorder.runScenario(page, state, 'Apply filters', 'success');

    await recorder.visitState(page, state);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await expect(dialog).not.toBeVisible();
    }
    await recorder.runScenario(page, state, 'Bulk add', 'success');

    await recorder.visitState(page, state);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await expect(dialog).not.toBeVisible();
    }
    await recorder.runScenario(page, state, 'Edit', 'success');
  }

  await recorder.visitState(page, 'log-bulk');
  await recorder.runScenario(page, 'log-bulk', 'Add entries', 'invalid', 'success');
  const bulkRow = page.locator('.logbook-row', { hasText: 'Bulk Evidence' });

  const supportingRow = page.locator('.logbook-row', { hasText: 'supporting add entry' });
  await supportingRow.getByRole('link', { name: 'Edit' }).click();
  await recorder.visitState(page, 'log-edit');
  await recorder.runScenario(page, 'log-edit', 'Save changes', 'invalid', 'success');
  const editedRow = page.locator('.logbook-row', { hasText: 'supporting edit saved' });

  for (const [state, path, note, time] of [
    ['logbook', '/log/view', 'delete logbook evidence', '10:15'],
    ['log-add', '/log/add', 'delete log-add evidence', '10:30'],
  ]) {
    await addDetailedLog(page, { date: '2026-01-13', time, notes: note });
    await recorder.visitState(page, state);
    if (state === 'log-add') {
      dialog = page.getByRole('dialog', { name: 'Add a log' });
      await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
      await expect(dialog).not.toBeVisible();
    }
    await recorder.runScenario(page, state, 'Delete', 'dismiss', 'accept');
  }

  for (const [state, path] of [['logbook', '/log/view'], ['log-add', '/log/add']]) {
    for (const action of [
      'Log one Release Fixture, 3.5 milligrams',
      'Log one Steady Mint, 6 milligrams',
    ]) {
      await recorder.visitState(page, state);
      if (state === 'log-add') {
        const dialog = page.getByRole('dialog', { name: 'Add a log' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close add log dialog' }).click();
        await expect(dialog).not.toBeVisible();
      }
      const quickAddUrl = page.url();
      const quickAddScroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
      await recorder.runScenario(page, state, action, 'failure', 'success');
      expect(page.url()).toBe(quickAddUrl);
      expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual(
        quickAddScroll,
      );
    }
  }

  await recorder.visitState(page, 'log-bulk');
  await recorder.runScenario(page, 'log-bulk', 'Cancel', 'success');
  const editLink = page.locator('.logbook-row').first().getByRole('link', { name: 'Edit' });
  await expectKeyboardNavigation(page, editLink, new URL(await editLink.getAttribute('href'), page.url()).pathname);
  await recorder.visitState(page, 'log-edit');
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
  await recorder.visitState(page, 'cravings');
  await recorder.runScenario(
    page, 'cravings', 'Get immediate support on Today', 'success',
  );
  expect(external).toEqual([]);
  recorder.assertComplete();
});


test('remaining goal actions preserve exact navigation and disposable state', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.goalsGaps, expect);
  await loginAs(page, 'journey-review-desktop@example.com');
  for (const [state, action] of [
    ['goal-create', 'Back to goals'],
    ['goal-create', 'Cancel'],
    ['goal-progress', 'Back to goals'],
    ['goal-edit', 'Back to goals'],
    ['goal-edit', 'Cancel'],
  ]) {
    await recorder.visitState(page, state);
    await recorder.runScenario(page, state, action, 'success');
  }
  recorder.assertComplete();
});


test('public error recovery actions reach a safe destination', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.errors, expect);
  await signOut(page);
  for (const [state, action] of [
    ['anonymous-not-found', 'Back to the start page'],
    ['bad-request', 'Return safely'],
    ['server-error', 'Back to the start page'],
  ]) {
    await recorder.visitState(page, state);
    await recorder.runScenario(page, state, action, 'success');
  }
  recorder.assertComplete();
});
