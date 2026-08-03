const { test, expect } = require('@playwright/test');
const {
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


function formPayload(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''));
}


async function keyboardActivate(page, locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}


async function accept(recorder, tokenPromise) {
  recorder.accept(await tokenPromise);
}


async function expectGuardClean(guard, page, stateName, options = {}) {
  await page.waitForLoadState('networkidle');
  guard.assertClean(expect, {
    stateName,
    expectedPath: new URL(page.url()).pathname,
    expectedStatus: 200,
    ...options,
  });
}


async function login(page, email = 'release-settings@example.com', password = 'browser-password') {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


test('Profile values persist and actions stay clear of mobile navigation', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsProfile, expect,
  );
  await login(page);
  const guard = watchForProductProblems(page);
  await recorder.visitState(page, 'profile');
  const profileBeforeResponse = await page.request.get('/__test__/account-snapshot');
  expect(profileBeforeResponse.status()).toBe(200);
  const profileBefore = await profileBeforeResponse.json();
  const targetAge = profileBefore.profile.age === 36 ? 37 : 36;

  let profilePosts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/settings/profile'
    ) profilePosts += 1;
  });
  await recorder.runScenario(page, 'profile', 'Save profile', 'invalid', 'success');
  expect(profilePosts).toBe(1);

  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole('status')).toContainText('Profile updated successfully!');
  await expect(page.getByLabel('Age')).toHaveValue(String(targetAge));
  await expect(page.getByLabel('Gender')).toHaveValue('other');
  await expect(page.getByLabel('Weight')).toHaveValue('81.4');
  await page.reload();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector('.primary-nav').getBoundingClientRect();
      const save = document.querySelector('.settings-save-row button').getBoundingClientRect();
      const weight = document.querySelector('#weight').getBoundingClientRect();
      return {
        saveBottom: save.bottom,
        weightBottom: weight.bottom,
        navTop: nav.top,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.saveBottom).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.weightBottom).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.overflow).toBeLessThanOrEqual(0);
  }
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'profile supporting owner');
});


test('Preferences update with native controls and persist after reload', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsPreferences, expect,
  );
  await login(page);
  const guard = watchForProductProblems(page);
  await recorder.visitState(page, 'preferences');
  const preferencesBeforeResponse = await page.request.get('/__test__/account-snapshot');
  expect(preferencesBeforeResponse.status()).toBe(200);
  const preferencesBefore = await preferencesBeforeResponse.json();
  const targetUnits = preferencesBefore.preferences.units_preference === 'mg'
    ? 'percentage' : 'mg';

  await page.getByLabel('Units', { exact: true }).selectOption(targetUnits);
  await page.getByLabel('Time zone').selectOption('Asia/Riyadh');
  await page.getByLabel('Daily reset time').fill('04:30');

  const preferredBrand = page.getByRole('checkbox', { name: 'Steady Mint' });
  if (await preferredBrand.isChecked()) await preferredBrand.uncheck();
  await recorder.runScenario(page, 'preferences', 'Steady Mint', 'toggle');
  await recorder.runScenario(page, 'preferences', 'Save preferences', 'success');

  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(page.getByRole('status')).toContainText('Preferences updated successfully!');
  await expect(page.getByLabel('Units', { exact: true })).toHaveValue(targetUnits);
  await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Riyadh');
  await expect(page.getByLabel('Daily reset time')).toHaveValue('04:30');
  await expect(preferredBrand).toBeChecked();

  await page.reload();
  await expect(page.getByLabel('Units', { exact: true })).toHaveValue(targetUnits);
  await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Riyadh');
  await expect(page.getByLabel('Daily reset time')).toHaveValue('04:30');
  await expect(page.getByRole('checkbox', { name: 'Steady Mint' })).toBeChecked();
  const nativeControls = await page.locator(
    'select[name="units_preference"], select[name="timezone"], input[name="daily_reset_time"]',
  ).evaluateAll((controls) => controls.map((control) => ({
    tag: control.tagName,
    type: control.getAttribute('type'),
    hidden: control.hidden || getComputedStyle(control).display === 'none',
    height: control.getBoundingClientRect().height,
  })));
  expect(nativeControls.every((control) => !control.hidden)).toBe(true);
  expect(nativeControls.every((control) => control.height >= 44)).toBe(true);
  await expect(page.locator('label.c-field__check', { has: preferredBrand })).toHaveCSS('min-height', '44px');

  const units = page.getByLabel('Units', { exact: true });
  await units.focus();
  const focusStyle = await units.evaluate((control) => {
    const style = getComputedStyle(control);
    return {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      outlineColor: style.outlineColor,
    };
  });
  expect(focusStyle.borderColor).toBe('rgb(47, 107, 74)');
  expect(focusStyle.outlineColor).toBe('rgb(47, 107, 74)');
  expect(focusStyle.boxShadow).toBe('none');

  await preferredBrand.focus();
  await page.keyboard.press('Space');
  await expect(preferredBrand).not.toBeChecked();
  const clearBrandResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/settings/preferences'
  ));
  await keyboardActivate(page, page.getByRole('button', { name: 'Save preferences' }));
  expect((await clearBrandResponsePending).status()).toBe(302);
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Steady Mint' })).not.toBeChecked();
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'preferences supporting owner');
});


test('Reminders persist and async actions expose success and failure feedback', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsReminders, expect,
  );
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });

  await login(page);
  const clearOutboundResponse = await page.request.post('/__test__/clear-outbound');
  expect(clearOutboundResponse.status()).toBe(200);
  const sameOrigin = new URL(page.url()).origin;
  const blockedExternalRequests = [];
  await page.route(/^https?:\/\//, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === sameOrigin) {
      await route.fallback();
      return;
    }
    blockedExternalRequests.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    await route.abort('blockedbyclient');
  });
  const blockedRequest = page.waitForEvent('requestfailed', (request) => (
    request.url() === 'https://unexpected-boundary.invalid/probe'
  ));
  await page.evaluate(() => fetch('https://unexpected-boundary.invalid/probe', {
    method: 'POST', body: '{"probe":true}',
  }).catch(() => null));
  await blockedRequest;
  expect(blockedExternalRequests).toEqual([{
    method: 'POST', url: 'https://unexpected-boundary.invalid/probe',
  }]);
  blockedExternalRequests.splice(0);
  const guard = watchForProductProblems(page);
  await recorder.visitState(page, 'reminders');
  const toggleNames = [
    'Email', 'Discord', 'Goal progress', 'Milestones',
    'Daily logging reminder', 'Weekly progress report',
  ];
  if (await page.getByRole('checkbox', { name: 'Weekly progress report' }).isChecked()) {
    for (const name of toggleNames) {
      const toggle = page.getByRole('checkbox', { name });
      if (await toggle.isChecked()) await toggle.uncheck();
    }
    const resetResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/settings/notifications'
    ));
    await page.getByRole('button', { name: 'Save reminders' }).click();
    expect((await resetResponse).status()).toBe(302);
    await expect(page.getByRole('checkbox', { name: 'Weekly progress report' })).not.toBeChecked();
    await page.reload();
  }
  for (const name of toggleNames) {
    const toggle = page.getByRole('checkbox', { name });
    if (await toggle.isChecked()) {
      await toggle.uncheck();
      await expect(toggle).not.toBeChecked();
    }
    await recorder.runScenario(page, 'reminders', name, 'toggle');
  }
  await page.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/example/token');
  await page.getByLabel('Daily reminder time').fill('09:10');
  await page.getByLabel('Quiet hours start').fill('21:30');
  await page.getByLabel('Quiet hours end').fill('06:15');
  await page.getByLabel('Delivery frequency').selectOption('weekly');
  await recorder.runScenario(page, 'reminders', 'Save reminders', 'success');

  const discordButton = page.locator('#test-discord-webhook');
  const discordStatus = page.locator('#discord-test-status');
  await recorder.runScenario(
    page, 'reminders', 'Test Discord connection', 'success', 'failure',
  );
  await expect(discordStatus).toHaveText('Discord rejected the test.');

  const weeklyButton = page.locator('#trigger-weekly-report');
  const weeklyStatus = page.locator('#weekly-report-status');
  await expect(weeklyButton).toBeEnabled();
  await recorder.runScenario(
    page, 'reminders', 'Send weekly report', 'success', 'failure',
  );
  await expect(weeklyStatus).toHaveText('Weekly report could not be queued.');
  expect(dialogs).toBe(0);

  await page.unroute('**/settings/test-discord-webhook');
  const directDiscordResponsePending = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/settings/test-discord-webhook'
    && response.status() === 200
  ));
  await keyboardActivate(page, discordButton);
  const directDiscordResponse = await directDiscordResponsePending;
  expect(directDiscordResponse.request().method()).toBe('POST');
  expect(directDiscordResponse.request().postDataJSON()).toEqual({
    webhook_url: 'https://discord.com/api/webhooks/example/token',
  });
  expect(await directDiscordResponse.json()).toEqual({
    success: true, message: 'Discord boundary recorded.',
  });
  await expect(discordStatus).toHaveText('Discord boundary recorded.');
  await expect(discordButton).toBeFocused();

  await page.unroute('**/settings/notifications/trigger-weekly');
  const directWeeklyResponsePending = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/settings/notifications/trigger-weekly'
    && response.status() === 200
  ));
  await keyboardActivate(page, weeklyButton);
  const directWeeklyResponse = await directWeeklyResponsePending;
  expect(directWeeklyResponse.request().method()).toBe('POST');
  expect(directWeeklyResponse.request().postDataJSON()).toEqual({});
  await expect(weeklyStatus).toHaveText('Weekly report queued. It should arrive shortly.');
  await expect(weeklyButton).toBeFocused();

  const outboundResponse = await page.request.get('/__test__/external-notifications');
  expect(outboundResponse.status()).toBe(200);
  const outbound = await outboundResponse.json();
  expect(outbound.unexpected).toEqual([]);
  expect(blockedExternalRequests).toEqual([]);
  expect(outbound.boundaries.filter((entry) => entry.kind === 'discord-test')).toEqual([{
    kind: 'discord-test',
    method: 'POST',
    url: 'https://discord.com/api/webhooks/example/token',
    payload: {
      embeds: [{
        title: '🧪 Webhook Test',
        description: 'This is a test message from Nicotine Tracker to verify your Discord webhook is working correctly.',
        color: 0x10b981,
        timestamp: '2026-08-03T12:00:00',
        footer: { text: 'Nicotine Tracker - Test Message' },
      }],
    },
  }]);
  const weeklyBoundary = outbound.notifications.find((entry) => entry.category === 'weekly_report');
  expect(weeklyBoundary).toEqual({
    kind: 'notification-queue',
    user_id: 27,
    category: 'weekly_report',
    subject: 'Your Weekly Progress Report',
    message: '<h3>Week of July 27 - August 02, 2026</h3>\n\n'
      + '<h4>Usage Summary</h4>\n<ul>\n'
      + '  <li><strong>Total Pouches:</strong> 0</li>\n'
      + '  <li><strong>Total Nicotine:</strong> 0.0mg</li>\n'
      + '  <li><strong>Daily Average:</strong> 0.0 pouches</li>\n'
      + '</ul>\n\n<h4>Goals Progress</h4>\n'
      + '<p>No active goals. Consider setting some goals to track your progress!</p>'
      + '<p>Keep up the great work! Remember, every small step counts towards your health goals.</p>',
    priority: 4,
    scheduled_for: null,
    extra_data: {
      active_streaks: 0,
      daily_average_mg: 0,
      daily_average_pouches: 0,
      goals_count: 0,
      goals_on_track: 0,
      total_logs: 0,
      total_nicotine: 0,
      total_pouches: 0,
      unknown_strength_count: 0,
      week_end: '2026-08-02',
      week_start: '2026-07-27',
    },
  });

  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 640) {
    await weeklyButton.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector('.primary-nav').getBoundingClientRect();
      const button = document.querySelector('#trigger-weekly-report').getBoundingClientRect();
      const status = document.querySelector('#weekly-report-status').getBoundingClientRect();
      return {
        buttonHeight: button.height,
        buttonBottom: button.bottom,
        statusRight: status.right,
        navTop: nav.top,
        viewportWidth: window.innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.buttonBottom).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.statusRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.overflow).toBeLessThanOrEqual(0);
  }

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Weekly progress report' })).toBeChecked();
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('21:30');
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'reminders supporting owner', {
    expectedHttpErrors: [
      {
        method: 'POST', path: '/settings/test-discord-webhook', status: 503, count: 1,
      },
      {
        method: 'POST', path: '/settings/notifications/trigger-weekly', status: 503, count: 1,
      },
    ],
  });
});


test('Data privacy controls persist and Statistics hands off to Insights', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsData, expect,
  );
  await login(page);
  const guard = watchForProductProblems(page);
  await recorder.visitState(page, 'data');

  await expect(page.locator('.data-section h2')).toHaveText([
    'Export', 'Offline use', 'Anonymize', 'Delete logs', 'Delete account',
  ]);
  await recorder.runScenario(page, 'data', 'Download Data', 'success');

  await recorder.runScenario(
    page, 'data', 'Save actions for offline use', 'success', 'failure',
  );

  await recorder.runScenario(page, 'data', 'Review account deletion', 'success');
  await expect(page.locator('#account-delete-title')).toBeVisible();

  await recorder.visitState(page, 'statistics');
  await expect(page.locator('dl.statistics-facts dt')).toHaveCount(6);
  await recorder.runScenario(
    page, 'statistics', 'Explore patterns in Insights', 'success',
  );
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'data and statistics supporting owner', {
    allowAnalytics: true,
    allowedCanceledNavigationPaths: ['/settings/data'],
    expectedHttpErrors: [
      {
        method: 'PATCH', path: '/settings/privacy/offline-queue', status: 500, count: 1,
      },
    ],
  });
});


test('Account rejects incorrect credentials without losing the form', async ({ page }) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountValidation, expect,
  );
  await login(page);
  const guard = watchForProductProblems(page);
  await recorder.visitState(page, 'account');

  await recorder.runScenario(page, 'account', 'Update email', 'rejected');
  await page.reload();

  await recorder.runScenario(page, 'account', 'Change password', 'rejected');
  await page.reload();

  await recorder.runScenario(page, 'account', 'Delete account', 'rejected');

  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
  await expect(page.getByLabel('New email address')).toHaveValue('release-settings@example.com');
  await expect(page.getByRole('button', { name: 'Delete account' })).toHaveClass(/c-button--danger/);
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'account validation supporting owner');
});


test('Account email, password, and deletion mutations work for a disposable user', async ({ page }, testInfo) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.settingsAccountDisposable, expect,
  );
  const suffix = testInfo.project.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const originalEmail = `account-${suffix}@example.com`;
  const updatedEmail = `account-updated-${suffix}@example.com`;
  const originalPassword = 'account-password';
  const updatedPassword = 'updated-account-password';
  const disposableBrand = `Disposable Cedar ${suffix}`;
  const disposableCravingNote = `Disposable craving ${suffix}`;

  await login(page, 'release-inventory@example.com');
  const fixtureBeforeResponse = await page.request.get('/__test__/account-snapshot');
  expect(fixtureBeforeResponse.status()).toBe(200);
  const fixtureBefore = await fixtureBeforeResponse.json();
  expect(fixtureBefore.profile).toEqual(expect.objectContaining({
    email: 'release-inventory@example.com', age: 34, gender: 'prefer_not_to_say',
  }));
  expect(fixtureBefore.logs.some((entry) => entry.notes === 'Release Fixture log')).toBe(true);
  expect(fixtureBefore.pouches.some((entry) => entry.brand === 'Release Fixture')).toBe(true);
  expect(fixtureBefore.goals).not.toHaveLength(0);
  expect(fixtureBefore.cravings).toEqual([
    expect.objectContaining({ trigger: 'release fixture', intensity: 5 }),
  ]);
  await page.request.get('/auth/logout');

  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(originalEmail);
  await page.locator('#password').fill(originalPassword);
  await page.locator('#confirm_password').fill(originalPassword);
  await page.locator('#terms').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding$/);
  const guard = watchForProductProblems(page);

  // Seed every owned-data category through public UI before destructive coverage.
  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill(disposableBrand);
  await page.getByLabel('Nicotine strength').fill('2.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();
  await page.goto('/log/view');
  await page.getByRole('button', { name: /Log one Steady Mint/ }).click();
  await expect(page.locator('.logbook-row')).toHaveCount(1);
  await page.goto('/goals/create');
  await page.getByLabel('Goal type').selectOption('daily_pouches');
  await page.getByLabel('Target value').fill('5');
  await page.getByRole('button', { name: 'Create goal' }).click();
  await expect(page.locator('article.goal-row')).toHaveCount(1);
  await page.goto('/cravings/cravings');
  const cravingForm = page.locator('#craving-form');
  await cravingForm.getByLabel('Intensity').fill('7');
  await cravingForm.getByLabel('Trigger').selectOption('stress');
  await cravingForm.getByLabel('Notes').fill(disposableCravingNote);
  await cravingForm.getByRole('button', { name: 'Record craving' }).click();
  await expect(cravingForm.locator('[data-craving-form-status]')).toHaveText(
    'Craving recorded. Thank you for noticing the moment.',
  );
  await page.goto('/settings/data');
  const offlineToggle = page.getByRole('checkbox', { name: 'Save actions for offline use' });
  if (await offlineToggle.isChecked()) {
    const offlineResponse = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/settings/privacy/offline-queue'
    ));
    await offlineToggle.uncheck();
    expect((await offlineResponse).status()).toBe(200);
  }
  const cleared = await page.request.post('/__test__/clear-verification-cooldown');
  expect(cleared.status()).toBe(200);
  const disposableBeforeResponse = await page.request.get('/__test__/account-snapshot');
  expect(disposableBeforeResponse.status()).toBe(200);
  const disposableBefore = await disposableBeforeResponse.json();
  expect(disposableBefore.profile.email).toBe(originalEmail);
  expect(disposableBefore.pouches).toEqual([
    expect.objectContaining({ brand: disposableBrand, nicotine_mg: '2.50' }),
  ]);
  expect(disposableBefore.logs).toHaveLength(1);
  expect(disposableBefore.goals).toHaveLength(1);
  expect(disposableBefore.cravings).toEqual([
    expect.objectContaining({
      intensity: 7, trigger: 'stress', notes: disposableCravingNote,
    }),
  ]);
  const disposableUserId = disposableBefore.profile.id;

  await recorder.visitState(page, 'account-destructive');
  await expect(page.locator('dl.account-facts dd')).toContainText(['1', '1', '1']);
  const emailForm = page.locator('form', { has: page.locator('input[value="update_email"]') });
  let accountPosts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/settings/account'
    ) accountPosts += 1;
  });
  await recorder.runScenario(
    page, 'account-destructive', 'Update email', 'invalid', 'success',
  );
  expect(accountPosts).toBe(1);
  await expect(page.getByLabel('New email address')).toHaveValue(updatedEmail);
  await page.reload();
  await expect(page.getByLabel('New email address')).toHaveValue(updatedEmail);
  const notificationsResponse = await page.request.get('/__test__/external-notifications');
  expect(notificationsResponse.status()).toBe(200);
  const notifications = (await notificationsResponse.json()).notifications;
  expect(notifications).toHaveLength(2);
  expect(notifications.at(-1)).toEqual(expect.objectContaining({
    category: 'email_verification', priority: 1,
    subject: expect.stringContaining('Verify Your Email'),
    extra_data: { verification_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:5000\/auth\/verify_email\//) },
  }));

  await recorder.runScenario(
    page, 'account-destructive', 'Change password', 'invalid', 'success',
  );
  await page.request.get('/auth/logout');
  await login(page, updatedEmail, updatedPassword);
  await page.goto('/settings/account');

  const deleteScenario = recorder.forScenario(page, 'account-destructive', 'Delete account');
  await deleteScenario.run('invalid');
  await expect(page.getByText('Total logs').locator('..')).toContainText('1');
  recorder.accept(await deleteScenario.run('success'));
  const ownedSnapshotUrl = `/__test__/owned-artifact-snapshot?user_id=${disposableUserId}`
    + `&brand=${encodeURIComponent(disposableBrand)}`;
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('status')).toHaveText('Your account has been deleted.');
  await page.reload();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.goto('/?account_deleted=1');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.goto('/settings/account');
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.getByLabel('Email address').fill(updatedEmail);
  await page.getByLabel('Password').fill(updatedPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/login(?:\?.*)?$/);
  await expect(page.getByRole('status')).toContainText('Invalid email or password.');
  const deletedSnapshotResponse = await page.request.get(ownedSnapshotUrl);
  expect(deletedSnapshotResponse.status()).toBe(200);
  expect(await deletedSnapshotResponse.json()).toEqual({
    users: 0,
    logs: 0,
    goals: 0,
    cravings: 0,
    owned_pouches: 0,
    named_pouches: 0,
    orphan_named_pouches: 0,
  });

  // The destructive path is isolated: the stable inventory fixture remains intact.
  await login(page, 'release-inventory@example.com');
  const fixtureAfterResponse = await page.request.get('/__test__/account-snapshot');
  expect(fixtureAfterResponse.status()).toBe(200);
  expect(await fixtureAfterResponse.json()).toEqual(fixtureBefore);
  recorder.assertComplete();
  await expectGuardClean(guard, page, 'disposable account supporting owner');
});
