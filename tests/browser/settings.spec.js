const { test, expect } = require('@playwright/test');


async function login(page) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


test('Profile values persist and actions stay clear of mobile navigation', async ({ page }) => {
  await login(page);
  await page.goto('/settings/profile');

  await page.getByLabel('Age').fill('36');
  await page.getByLabel('Gender').selectOption('other');
  await page.getByLabel('Weight').fill('81.4');
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole('status')).toContainText('Profile updated successfully!');
  await expect(page.getByLabel('Age')).toHaveValue('36');
  await expect(page.getByLabel('Gender')).toHaveValue('other');
  await expect(page.getByLabel('Weight')).toHaveValue('81.4');

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
});


test('Preferences update with native controls and persist after reload', async ({ page }) => {
  await login(page);
  await page.goto('/settings/preferences');

  await page.getByLabel('Units', { exact: true }).selectOption('percentage');
  await page.getByLabel('Time zone').selectOption('Asia/Riyadh');
  await page.getByLabel('Daily reset time').fill('04:30');

  const preferredBrand = page.getByRole('checkbox', { name: 'Steady Mint' });
  await preferredBrand.focus();
  await page.keyboard.press('Space');
  await expect(preferredBrand).toBeChecked();
  await page.getByRole('button', { name: 'Save preferences' }).click();

  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(page.getByRole('status')).toContainText('Preferences updated successfully!');
  await expect(page.getByLabel('Units', { exact: true })).toHaveValue('percentage');
  await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Riyadh');
  await expect(page.getByLabel('Daily reset time')).toHaveValue('04:30');
  await expect(preferredBrand).toBeChecked();

  await page.reload();
  await expect(page.getByLabel('Units', { exact: true })).toHaveValue('percentage');
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
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Steady Mint' })).not.toBeChecked();
});


test('Reminders persist and async actions expose success and failure feedback', async ({ page }) => {
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
      status: success ? 200 : 400,
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
      status: success ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success,
        message: success ? 'Weekly report queued.' : 'Weekly report could not be queued.',
      }),
    });
  });

  await login(page);
  await page.goto('/settings/notifications');
  await page.getByRole('checkbox', { name: 'Email' }).check();
  await page.getByRole('checkbox', { name: 'Discord' }).check();
  await page.getByRole('checkbox', { name: 'Goal progress' }).check();
  await page.getByRole('checkbox', { name: 'Milestones' }).check();
  await page.getByRole('checkbox', { name: 'Daily logging reminder' }).check();
  await page.getByRole('checkbox', { name: 'Weekly progress report' }).check();
  await page.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/example/token');
  await page.getByLabel('Daily reminder time').fill('09:10');
  await page.getByLabel('Quiet hours start').fill('21:30');
  await page.getByLabel('Quiet hours end').fill('06:15');
  await page.getByLabel('Delivery frequency').selectOption('weekly');
  await page.getByRole('button', { name: 'Save reminders' }).click();

  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await expect(page.getByRole('status').filter({ hasText: 'Notification settings updated successfully!' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Discord' })).toBeChecked();
  await expect(page.getByLabel('Daily reminder time')).toHaveValue('09:10');
  await expect(page.getByLabel('Delivery frequency')).toHaveValue('weekly');

  const discordButton = page.locator('#test-discord-webhook');
  const discordStatus = page.locator('#discord-test-status');
  await discordButton.click();
  await expect.poll(() => discordRequests).toBe(1);
  await expect(discordButton).toBeDisabled();
  await expect(discordButton).toHaveText('Testing…');
  await expect(discordStatus).toHaveText('Testing…');
  await expect(discordStatus).toHaveAttribute('data-state', 'loading');
  await discordButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => discordRequests).toBe(1);
  await page.getByRole('checkbox', { name: 'Discord' }).uncheck();
  releaseDiscordSuccess();
  await expect(discordStatus).toHaveText('Discord connection confirmed.');
  await expect(discordStatus).toHaveAttribute('data-state', 'success');
  await expect(discordButton).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Discord' }).check();
  await expect(discordButton).toBeEnabled();
  await discordButton.click();
  await expect(discordStatus).toHaveText('Discord rejected the test.');
  await expect(discordStatus).toHaveAttribute('data-state', 'error');

  const weeklyButton = page.locator('#trigger-weekly-report');
  const weeklyStatus = page.locator('#weekly-report-status');
  await expect(weeklyButton).toBeEnabled();
  await weeklyButton.click();
  await expect.poll(() => weeklyRequests).toBe(1);
  await expect(weeklyButton).toBeDisabled();
  await expect(weeklyButton).toHaveText('Sending…');
  await expect(weeklyStatus).toHaveAttribute('data-state', 'loading');
  await weeklyButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => weeklyRequests).toBe(1);
  await page.getByRole('checkbox', { name: 'Weekly progress report' }).uncheck();
  releaseWeeklySuccess();
  await expect(weeklyStatus).toHaveText('Weekly report queued.');
  await expect(weeklyStatus).toHaveAttribute('data-state', 'success');
  await expect(weeklyButton).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Weekly progress report' }).check();
  await expect(weeklyButton).toBeEnabled();
  await weeklyButton.click();
  await expect(weeklyStatus).toHaveText('Weekly report could not be queued.');
  await expect(weeklyStatus).toHaveAttribute('data-state', 'error');

  expect(discordRequests).toBe(2);
  expect(weeklyRequests).toBe(2);
  expect(discordBodies).toEqual([
    { webhook_url: 'https://discord.com/api/webhooks/example/token' },
    { webhook_url: 'https://discord.com/api/webhooks/example/token' },
  ]);
  expect(weeklyBodies).toEqual([{}, {}]);
  expect(dialogs).toBe(0);

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
});


test('Data privacy controls persist and Statistics hands off to Insights', async ({ page }) => {
  await login(page);
  await page.goto('/settings/data');

  await expect(page.locator('.data-section h2')).toHaveText([
    'Export', 'Offline use', 'Anonymize', 'Delete logs', 'Delete account',
  ]);
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Data' }).click();
  const download = await exportDownload;
  expect(download.suggestedFilename()).toMatch(/^nicotine_tracker_data_\d{4}-\d{2}-\d{2}\.json$/);

  const offlineToggle = page.getByRole('checkbox', { name: 'Save actions for offline use' });
  const offlineStatus = page.locator('#offline-queue-status');
  await expect(offlineToggle).toBeChecked();
  await offlineToggle.uncheck();
  await expect(offlineStatus).toContainText('Offline saving is off.');
  await expect(offlineStatus).toHaveAttribute('data-state', 'success');
  await page.reload();
  await expect(offlineToggle).not.toBeChecked();
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'false');

  await offlineToggle.check();
  await expect(offlineStatus).toContainText('Offline saving is on.');
  await page.reload();
  await expect(offlineToggle).toBeChecked();
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'true');

  const accountDeletion = page.getByRole('link', { name: 'Review account deletion' });
  await expect(accountDeletion).toHaveAttribute('href', '/settings/account#account-delete-title');

  await page.goto('/settings/statistics');
  await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
  await expect(page.locator('dl.statistics-facts dt')).toHaveCount(6);
  await page.getByRole('link', { name: 'Explore patterns in Insights' }).click();
  await expect(page).toHaveURL(/\/insights\/$/);
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
});


test('Account rejects incorrect credentials without losing the form', async ({ page }) => {
  await login(page);
  await page.goto('/settings/account');

  await page.getByLabel('New email address').fill('browser-changed@example.com');
  await page.locator('form', { has: page.locator('input[value="update_email"]') })
    .getByLabel('Current password').fill('wrong-password');
  await page.getByRole('button', { name: 'Update email' }).click();

  await expect(page.getByRole('status')).toContainText('Current password is incorrect.');
  await expect(page.locator('#password-error')).toHaveText('Current password is incorrect.');
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
  await expect(page.getByLabel('New email address')).toHaveValue('browser@example.com');
  await expect(page.getByRole('button', { name: 'Delete account' })).toHaveClass(/c-button--danger/);
});


test('Account email, password, and deletion mutations work for a disposable user', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const originalEmail = `account-${suffix}@example.com`;
  const updatedEmail = `account-updated-${suffix}@example.com`;
  const originalPassword = 'account-password';
  const updatedPassword = 'updated-account-password';

  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(originalEmail);
  await page.locator('#password').fill(originalPassword);
  await page.locator('#confirm_password').fill(originalPassword);
  await page.locator('#terms').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding$/);

  await page.goto('/settings/account');
  await page.getByLabel('New email address').fill(updatedEmail);
  await page.locator('form', { has: page.locator('input[value="update_email"]') })
    .getByLabel('Current password').fill(originalPassword);
  await page.getByRole('button', { name: 'Update email' }).click();
  await expect(page.getByRole('status')).toContainText('Email updated successfully!');
  await expect(page.getByLabel('New email address')).toHaveValue(updatedEmail);

  const passwordForm = page.locator('form', { has: page.locator('input[value="change_password"]') });
  await passwordForm.getByLabel('Current password').fill('wrong-password');
  await passwordForm.locator('#new_password').fill(updatedPassword);
  await passwordForm.locator('#confirm_password').fill(updatedPassword);
  await passwordForm.getByRole('button', { name: 'Change password' }).click();
  await expect(page.locator('#current_password-error')).toHaveText('Current password is incorrect.');

  await passwordForm.getByLabel('Current password').fill(originalPassword);
  await passwordForm.locator('#new_password').fill(updatedPassword);
  await passwordForm.locator('#confirm_password').fill(updatedPassword);
  await passwordForm.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toContainText('Password changed successfully!');

  const deleteForm = page.locator('form', { has: page.locator('input[value="delete_account"]') });
  await deleteForm.getByLabel('Password').fill(updatedPassword);
  await deleteForm.getByLabel(/delete my account/i).fill('delete my account');
  const deletion = page.waitForResponse((response) => (
    response.url().includes('/settings/account') && response.request().method() === 'POST'
  ));
  await deleteForm.getByRole('button', { name: 'Delete account' }).click();
  const deletionResponse = await deletion;
  expect(deletionResponse.status()).toBe(302);
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/settings/account');
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.getByLabel('Email address').fill(updatedEmail);
  await page.getByLabel('Password').fill(updatedPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/login(?:\?.*)?$/);
  await expect(page.getByRole('status')).toContainText('Invalid email or password.');
});
