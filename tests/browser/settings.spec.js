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


async function expectKeyboardNavigation(page, locator, expectedPath, evidence = null) {
  if (evidence) {
    const actionEvidence = evidence.recorder.forAction(evidence.state, evidence.action, {
      page, control: locator,
    });
    evidence.recorder.accept(await actionEvidence.run({
      activation: { kind: 'keyboard', key: 'Enter' },
      request: {
        method: 'GET',
        path: new RegExp(`^${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        status: 200,
      },
    }));
  } else {
    const responsePending = page.waitForResponse((response) => (
      response.request().isNavigationRequest()
      && new URL(response.url()).pathname === expectedPath
    ));
    await keyboardActivate(page, locator);
    const response = await responsePending;
    expect(response.request().method()).toBe('GET');
    expect(response.status()).toBe(200);
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
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
  await page.goto('/settings/profile');
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
  const age = page.getByLabel('Age');
  const save = page.getByRole('button', { name: 'Save profile' });
  await age.fill('17');
  const evidence = recorder.forAction('profile', 'Save profile', { page, control: save });
  recorder.accept(await evidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: age },
    error: { locator: age, validationMessage: 'Value must be greater than or equal to 18.' },
    feedback: { locator: age, validationMessage: 'Value must be greater than or equal to 18.' },
  }));
  expect(profilePosts).toBe(0);

  await age.fill(String(targetAge));
  await page.getByLabel('Gender').selectOption('other');
  await page.getByLabel('Weight').fill('81.4');
  recorder.accept(await evidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/settings\/profile$/, status: 302,
      payload: { kind: 'form', exact: { age: String(targetAge), gender: 'other', weight: '81.4' } },
      dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'), text: 'Profile updated successfully!',
    },
    persistence: {
      kind: 'json', url: '/__test__/account-snapshot', path: 'profile.age',
      expectedBefore: profileBefore.profile.age, expectedAfter: targetAge,
    },
  }));
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
  await page.goto('/settings/preferences');
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
  const brandEvidence = recorder.forAction('preferences', 'Steady Mint', {
    page, control: preferredBrand,
  });
  recorder.accept(await brandEvidence.run({
    activation: { kind: 'keyboard', key: 'Space' },
    outcome: { kind: 'checked', locator: preferredBrand, checked: true },
    focus: { mode: 'retained' },
  }));
  const save = page.getByRole('button', { name: 'Save preferences' });
  const saveEvidence = recorder.forAction('preferences', 'Save preferences', { page, control: save });
  recorder.accept(await saveEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/settings\/preferences$/, status: 302,
      payload: { kind: 'form', exact: {
        daily_reset_time: '04:30', preferred_brands: 'Steady Mint',
        timezone: 'Asia/Riyadh', units_preference: targetUnits,
      } }, dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'), text: 'Preferences updated successfully!',
    },
    persistence: {
      kind: 'json', url: '/__test__/account-snapshot',
      path: 'preferences.units_preference',
      expectedBefore: preferencesBefore.preferences.units_preference, expectedAfter: targetUnits,
    },
  }));

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
  let discordRequests = 0;
  let weeklyRequests = 0;
  let releaseDiscordSuccess;
  let releaseWeeklySuccess;
  const discordSuccessGate = new Promise((resolve) => { releaseDiscordSuccess = resolve; });
  const weeklySuccessGate = new Promise((resolve) => { releaseWeeklySuccess = resolve; });
  const discordBodies = [];
  const weeklyBodies = [];
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });

  await page.route('**/settings/test-discord-webhook', async (route) => {
    discordRequests += 1;
    discordBodies.push(route.request().postDataJSON());
    expect(route.request().headers()['x-csrftoken']).toBeTruthy();
    const success = discordRequests === 1;
    if (success) await discordSuccessGate;
    await route.fulfill({
      status: success ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success,
        message: success ? 'Discord connection confirmed.' : 'Discord rejected the test.',
      }),
    });
  });
  await page.route('**/settings/notifications/trigger-weekly', async (route) => {
    weeklyRequests += 1;
    weeklyBodies.push(route.request().postDataJSON());
    expect(route.request().headers()['x-csrftoken']).toBeTruthy();
    const success = weeklyRequests === 1;
    if (success) await weeklySuccessGate;
    await route.fulfill({
      status: success ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success,
        message: success ? 'Weekly report queued.' : 'Weekly report could not be queued.',
      }),
    });
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
  await page.goto('/settings/notifications');
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
    const evidence = recorder.forAction('reminders', name, { page, control: toggle });
    recorder.accept(await evidence.run({
      activation: { kind: 'keyboard', key: 'Space' },
      outcome: { kind: 'checked', locator: toggle, checked: true },
      focus: { mode: 'retained' },
    }));
  }
  await page.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/example/token');
  await page.getByLabel('Daily reminder time').fill('09:10');
  await page.getByLabel('Quiet hours start').fill('21:30');
  await page.getByLabel('Quiet hours end').fill('06:15');
  await page.getByLabel('Delivery frequency').selectOption('weekly');
  const saveButton = page.getByRole('button', { name: 'Save reminders' });
  const saveEvidence = recorder.forAction('reminders', 'Save reminders', {
    page, control: saveButton,
  });
  recorder.accept(await saveEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/notifications$/, status: 302,
      payload: { kind: 'form', exact: {
        notification_channel: ['email', 'discord'],
        discord_webhook: 'https://discord.com/api/webhooks/example/token',
        goal_notifications: 'on', achievement_notifications: 'on', daily_reminders: 'on',
        weekly_reports: 'on', reminder_time: '09:10', quiet_hours_start: '21:30',
        quiet_hours_end: '06:15', notification_frequency: 'weekly',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    feedback: { locator: page.getByRole('status'), text: 'Notification settings updated successfully!' },
    persistence: {
      kind: 'json', url: '/__test__/account-snapshot', path: 'preferences.weekly_reports',
      expectedBefore: false, expectedAfter: true,
    },
  }));

  const discordButton = page.locator('#test-discord-webhook');
  const discordStatus = page.locator('#discord-test-status');
  const discordEvidence = recorder.forAction(
    'reminders', 'Test Discord connection', { page, control: discordButton },
  );
  const discordSuccessReceipt = discordEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/test-discord-webhook$/, status: 200,
      payload: { kind: 'json', exact: {
        webhook_url: 'https://discord.com/api/webhooks/example/token',
      } } },
    loading: { disabled: true, text: 'Testing…',
      status: { locator: discordStatus, text: 'Testing…' } },
    feedback: { locator: discordStatus, text: 'Discord connection confirmed.' },
    focus: { mode: 'retained' },
  });
  await expect.poll(() => discordRequests).toBe(1);
  await expect(discordButton).toBeDisabled();
  await expect(discordButton).toHaveText('Testing…');
  await expect(discordStatus).toHaveText('Testing…');
  await expect(discordStatus).toHaveAttribute('data-state', 'loading');
  await discordButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => discordRequests).toBe(1);
  releaseDiscordSuccess();
  recorder.accept(await discordSuccessReceipt);
  await expect(discordStatus).toHaveText('Discord connection confirmed.');
  await expect(discordStatus).toHaveAttribute('data-state', 'success');
  await expect(discordButton).toBeEnabled();
  await expect(discordButton).toBeFocused();
  await page.getByRole('checkbox', { name: 'Discord' }).uncheck();
  await expect(discordButton).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Discord' }).check();
  await expect(discordButton).toBeEnabled();
  recorder.accept(await discordEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/test-discord-webhook$/, status: 503,
      payload: { kind: 'json', exact: {
        webhook_url: 'https://discord.com/api/webhooks/example/token',
      } } },
    error: { locator: discordStatus, text: 'Discord rejected the test.', state: 'error' },
    feedback: { locator: discordStatus, text: 'Discord rejected the test.' },
    focus: { mode: 'retained' },
  }));
  expect(discordRequests).toBe(2);

  const weeklyButton = page.locator('#trigger-weekly-report');
  const weeklyStatus = page.locator('#weekly-report-status');
  await expect(weeklyButton).toBeEnabled();
  const weeklyEvidence = recorder.forAction(
    'reminders', 'Send weekly report', { page, control: weeklyButton },
  );
  const weeklySuccessReceipt = weeklyEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/notifications\/trigger-weekly$/,
      status: 200, payload: { kind: 'json', exact: {} } },
    loading: { disabled: true, text: 'Sending…' },
    feedback: { locator: weeklyStatus, text: 'Weekly report queued.' },
    focus: { mode: 'retained' },
  });
  await expect.poll(() => weeklyRequests).toBe(1);
  await expect(weeklyButton).toBeDisabled();
  await expect(weeklyButton).toHaveText('Sending…');
  await expect(weeklyStatus).toHaveAttribute('data-state', 'loading');
  await weeklyButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => weeklyRequests).toBe(1);
  releaseWeeklySuccess();
  recorder.accept(await weeklySuccessReceipt);
  await expect(weeklyStatus).toHaveText('Weekly report queued.');
  await expect(weeklyStatus).toHaveAttribute('data-state', 'success');
  await expect(weeklyButton).toBeEnabled();
  await expect(weeklyButton).toBeFocused();
  await page.getByRole('checkbox', { name: 'Weekly progress report' }).uncheck();
  await expect(weeklyButton).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Weekly progress report' }).check();
  await expect(weeklyButton).toBeEnabled();
  recorder.accept(await weeklyEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/notifications\/trigger-weekly$/,
      status: 503, payload: { kind: 'json', exact: {} } },
    error: { locator: weeklyStatus, text: 'Weekly report could not be queued.', state: 'error' },
    feedback: { locator: weeklyStatus, text: 'Weekly report could not be queued.' },
    focus: { mode: 'retained' },
  }));
  expect(weeklyRequests).toBe(2);

  expect(discordRequests).toBe(2);
  expect(weeklyRequests).toBe(2);
  expect(discordBodies).toEqual([
    { webhook_url: 'https://discord.com/api/webhooks/example/token' },
    { webhook_url: 'https://discord.com/api/webhooks/example/token' },
  ]);
  expect(weeklyBodies).toEqual([{}, {}]);
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
  await page.goto('/settings/data');

  await expect(page.locator('.data-section h2')).toHaveText([
    'Export', 'Offline use', 'Anonymize', 'Delete logs', 'Delete account',
  ]);
  const exportDownload = page.waitForEvent('download');
  const exportButton = page.getByRole('button', { name: 'Download Data' });
  const exportEvidence = recorder.forAction('data', 'Download Data', {
    page, control: exportButton,
  });
  recorder.accept(await exportEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/data$/, status: 200,
      settleNavigation: false, payload: { kind: 'form', exact: { action: 'export_data' } },
      dynamicFields: { csrf_token: 'non-empty' } },
  }));
  const download = await exportDownload;
  expect(download.suggestedFilename()).toMatch(/^nicotine_tracker_data_\d{4}-\d{2}-\d{2}\.json$/);

  const offlineToggle = page.getByRole('checkbox', { name: 'Save actions for offline use' });
  const offlineStatus = page.locator('#offline-queue-status');
  await expect(offlineToggle).toBeChecked();
  const offlineEvidence = recorder.forAction(
    'data', 'Save actions for offline use', { page, control: offlineToggle },
  );
  recorder.accept(await offlineEvidence.run({
    activation: { kind: 'keyboard', key: 'Space' },
    request: { method: 'PATCH', path: /^\/settings\/privacy\/offline-queue$/, status: 200,
      payload: { kind: 'json', exact: { enabled: false } } },
    feedback: { locator: offlineStatus, text: 'Offline saving is off.' },
    persistence: { kind: 'json', url: '/__test__/account-snapshot',
      path: 'preferences.offline_queue_enabled', expectedBefore: true, expectedAfter: false },
  }));
  await page.reload();
  await expect(offlineToggle).not.toBeChecked();
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'false');

  const enableResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === '/settings/privacy/offline-queue'
  ));
  await offlineToggle.focus();
  await page.keyboard.press('Space');
  const enableResponse = await enableResponsePending;
  expect(enableResponse.status()).toBe(200);
  expect(enableResponse.request().postDataJSON()).toEqual({ enabled: true });
  await expect(offlineStatus).toContainText('Offline saving is on.');
  await page.reload();
  await expect(offlineToggle).toBeChecked();
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'true');

  let offlineRequestCount = 0;
  let offlineRequestBody;
  let offlineCsrfToken;
  let releaseFailure;
  const heldFailure = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route('**/settings/privacy/offline-queue', async (route) => {
    offlineRequestCount += 1;
    offlineRequestBody = route.request().postDataJSON();
    offlineCsrfToken = route.request().headers()['x-csrftoken'];
    await heldFailure;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    });
  });
  const failedOfflineReceipt = offlineEvidence.run({
    activation: { kind: 'keyboard', key: 'Space' },
    request: { method: 'PATCH', path: /^\/settings\/privacy\/offline-queue$/, status: 500,
      payload: { kind: 'json', exact: { enabled: false } } },
    loading: { disabled: true,
      status: { locator: offlineStatus, text: 'Saving offline preference…' } },
    error: { locator: offlineStatus,
      text: 'Offline preference could not be saved. Please try again.', state: 'error' },
    feedback: { locator: offlineStatus,
      text: 'Offline preference could not be saved. Please try again.' },
    focus: { mode: 'retained' },
    outcome: { kind: 'checked', locator: offlineToggle, checked: true },
  });
  await expect(offlineToggle).toBeDisabled();
  await expect(offlineStatus).toHaveAttribute('data-state', 'loading');
  await offlineToggle.evaluate((element) => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => offlineRequestCount).toBe(1);
  expect(offlineRequestBody).toEqual({ enabled: false });
  expect(offlineCsrfToken).toBeTruthy();
  releaseFailure();
  recorder.accept(await failedOfflineReceipt);
  await expect(offlineStatus).toHaveAttribute('data-state', 'error');
  await expect(offlineToggle).toBeChecked();
  await expect(offlineToggle).toBeEnabled();
  await expect(offlineToggle).toBeFocused();
  expect(enableResponse.request().postDataJSON()).toEqual({ enabled: true });
  expect(offlineRequestBody).toEqual({ enabled: false });
  expect(offlineCsrfToken).toBeTruthy();
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'true');

  const accountDeletion = page.getByRole('link', { name: 'Review account deletion' });
  await expect(accountDeletion).toHaveAttribute('href', '/settings/account#account-delete-title');
  await expectKeyboardNavigation(page, accountDeletion, '/settings/account', {
    recorder, state: 'data', action: 'Review account deletion',
  });
  await expect(page.locator('#account-delete-title')).toBeVisible();

  await page.goto('/settings/statistics');
  await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
  await expect(page.locator('dl.statistics-facts dt')).toHaveCount(6);
  await expectKeyboardNavigation(
    page, page.getByRole('link', { name: 'Explore patterns in Insights' }), '/insights/',
    { recorder, state: 'statistics', action: 'Explore patterns in Insights' },
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
  await page.goto('/settings/account');

  await page.getByLabel('New email address').fill('browser-changed@example.com');
  const emailForm = page.locator('form', { has: page.locator('input[value="update_email"]') });
  await emailForm.getByLabel('Current password').fill('wrong-password');
  const emailButton = page.getByRole('button', { name: 'Update email' });
  const emailEvidence = recorder.forAction('account', 'Update email', {
    page, control: emailButton,
  });
  recorder.accept(await emailEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 200,
      payload: { kind: 'form', exact: {
        action: 'update_email', password: 'wrong-password',
        new_email: 'browser-changed@example.com',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    error: { locator: page.locator('#password-error'), text: 'Current password is incorrect.' },
    feedback: { locator: page.locator('#password-error'), text: 'Current password is incorrect.' },
    focus: { mode: 'moved', locator: emailForm.getByLabel('Current password') },
  }));
  await page.reload();

  const passwordForm = page.locator('form', { has: page.locator('input[value="change_password"]') });
  await passwordForm.getByLabel('Current password').fill('wrong-password');
  await passwordForm.locator('#new_password').fill('replacement-password');
  await passwordForm.locator('#confirm_password').fill('replacement-password');
  const passwordButton = passwordForm.getByRole('button', { name: 'Change password' });
  const passwordEvidence = recorder.forAction('account', 'Change password', {
    page, control: passwordButton,
  });
  recorder.accept(await passwordEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 200,
      payload: { kind: 'form', exact: {
        action: 'change_password', current_password: 'wrong-password',
        new_password: 'replacement-password', confirm_password: 'replacement-password',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    error: { locator: page.locator('#current_password-error'), text: 'Current password is incorrect.' },
    feedback: { locator: page.locator('#current_password-error'), text: 'Current password is incorrect.' },
    focus: { mode: 'moved', locator: passwordForm.getByLabel('Current password') },
  }));
  await page.reload();

  const deleteForm = page.locator('form', { has: page.locator('input[value="delete_account"]') });
  await deleteForm.getByLabel('Password').fill('wrong-password');
  await deleteForm.getByLabel(/delete my account/i).fill('not the confirmation');
  const deleteButton = deleteForm.getByRole('button', { name: 'Delete account' });
  const deleteEvidence = recorder.forAction('account', 'Delete account', {
    page, control: deleteButton,
  });
  recorder.accept(await deleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 200,
      payload: { kind: 'form', exact: {
        action: 'delete_account', password: 'wrong-password',
        confirmation: 'not the confirmation',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    error: { locator: page.locator('#delete_password-error'), text: 'Password is incorrect.' },
    feedback: { locator: page.locator('#delete_password-error'), text: 'Password is incorrect.' },
    focus: { mode: 'moved', locator: deleteForm.getByLabel('Password') },
  }));

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

  await page.goto('/settings/account');
  await expect(page.locator('dl.account-facts dd')).toContainText(['1', '1', '1']);
  const emailForm = page.locator('form', { has: page.locator('input[value="update_email"]') });
  let accountPosts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/settings/account'
    ) accountPosts += 1;
  });
  const newEmail = page.getByLabel('New email address');
  const emailButton = emailForm.getByRole('button', { name: 'Update email' });
  const emailEvidence = recorder.forAction('account-destructive', 'Update email', {
    page, control: emailButton,
  });
  await emailForm.getByLabel('Current password').fill(originalPassword);
  await newEmail.fill('not-an-email');
  recorder.accept(await emailEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: newEmail },
    error: { locator: newEmail,
      validationMessage: "Please include an '@' in the email address. 'not-an-email' is missing an '@'." },
  }));
  expect(accountPosts).toBe(0);

  await newEmail.fill(updatedEmail);
  recorder.accept(await emailEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 302,
      payload: { kind: 'form', exact: {
        action: 'update_email', new_email: updatedEmail, password: originalPassword,
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    feedback: { locator: page.getByRole('status'),
      text: 'Email updated successfully! Please verify your new email address.' },
    persistence: { kind: 'json', url: '/__test__/account-snapshot', path: 'profile.email',
      expectedBefore: originalEmail, expectedAfter: updatedEmail },
  }));
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

  const passwordForm = page.locator('form', { has: page.locator('input[value="change_password"]') });
  const passwordButton = passwordForm.getByRole('button', { name: 'Change password' });
  const passwordEvidence = recorder.forAction('account-destructive', 'Change password', {
    page, control: passwordButton,
  });
  await passwordForm.getByLabel('Current password').fill('wrong-password');
  await passwordForm.locator('#new_password').fill(updatedPassword);
  await passwordForm.locator('#confirm_password').fill(updatedPassword);
  recorder.accept(await passwordEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 200,
      payload: { kind: 'form', exact: {
        action: 'change_password', current_password: 'wrong-password',
        new_password: updatedPassword, confirm_password: updatedPassword,
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    error: { locator: page.locator('#current_password-error'), text: 'Current password is incorrect.' },
    focus: { mode: 'moved', locator: page.locator('#current_password') },
  }));

  const refreshedPasswordForm = page.locator('form', { has: page.locator('input[value="change_password"]') });
  await refreshedPasswordForm.getByLabel('Current password').fill(originalPassword);
  await refreshedPasswordForm.locator('#new_password').fill(updatedPassword);
  await refreshedPasswordForm.locator('#confirm_password').fill(updatedPassword);
  const validPasswordButton = refreshedPasswordForm.getByRole('button', { name: 'Change password' });
  const validPasswordEvidence = recorder.forAction('account-destructive', 'Change password', {
    page, control: validPasswordButton,
  });
  recorder.accept(await validPasswordEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 302,
      payload: { kind: 'form', exact: {
        action: 'change_password', current_password: originalPassword,
        new_password: updatedPassword, confirm_password: updatedPassword,
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    feedback: { locator: page.getByRole('status'), text: 'Password changed successfully!' },
    persistence: { kind: 'json',
      url: `/__test__/password-match?password=${encodeURIComponent(updatedPassword)}`,
      path: 'matches', expectedBefore: false, expectedAfter: true },
  }));
  await page.request.get('/auth/logout');
  await login(page, updatedEmail, updatedPassword);
  await page.goto('/settings/account');

  const deleteForm = page.locator('form', { has: page.locator('input[value="delete_account"]') });
  const deleteButton = deleteForm.getByRole('button', { name: 'Delete account' });
  const deleteEvidence = recorder.forAction('account-destructive', 'Delete account', {
    page, control: deleteButton,
  });
  await deleteForm.getByLabel('Password').fill(updatedPassword);
  await deleteForm.getByLabel(/delete my account/i).fill('keep my account');
  recorder.accept(await deleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 200,
      payload: { kind: 'form', exact: {
        action: 'delete_account', password: updatedPassword,
        confirmation: 'keep my account',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    error: { locator: page.locator('#confirmation-error'),
      text: 'Please type "delete my account" to confirm.' },
    feedback: { locator: page.locator('#confirmation-error'),
      text: 'Please type "delete my account" to confirm.' },
    focus: { mode: 'moved', locator: page.getByLabel(/delete my account/i) },
  }));
  await expect(page.getByText('Total logs').locator('..')).toContainText('1');

  const refreshedDeleteForm = page.locator('form', { has: page.locator('input[value="delete_account"]') });
  await refreshedDeleteForm.getByLabel('Password').fill(updatedPassword);
  await refreshedDeleteForm.getByLabel(/delete my account/i).fill('delete my account');
  const validDeleteButton = refreshedDeleteForm.getByRole('button', { name: 'Delete account' });
  const validDeleteEvidence = recorder.forAction('account-destructive', 'Delete account', {
    page, control: validDeleteButton,
  });
  const ownedSnapshotUrl = `/__test__/owned-artifact-snapshot?user_id=${disposableUserId}`
    + `&brand=${encodeURIComponent(disposableBrand)}`;
  recorder.accept(await validDeleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: { method: 'POST', path: /^\/settings\/account$/, status: 302,
      payload: { kind: 'form', exact: {
        action: 'delete_account', password: updatedPassword,
        confirmation: 'delete my account',
      } }, dynamicFields: { csrf_token: 'non-empty' } },
    feedback: { locator: page.getByRole('status'), text: 'Your account has been deleted.' },
    persistence: { kind: 'json', url: ownedSnapshotUrl,
      expectedBefore: {
        users: 1, logs: 1, goals: 1, cravings: 1, owned_pouches: 1,
        named_pouches: 1, orphan_named_pouches: 0,
      },
      expectedAfter: {
        users: 0, logs: 0, goals: 0, cravings: 0, owned_pouches: 0,
        named_pouches: 0, orphan_named_pouches: 0,
      } },
  }));
  await expect(page).toHaveURL(/\/\?account_deleted=1$/);
  await expect(page.getByRole('status')).toHaveText('Your account has been deleted.');
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
