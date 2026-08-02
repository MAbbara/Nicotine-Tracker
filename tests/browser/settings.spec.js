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
