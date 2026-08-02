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
