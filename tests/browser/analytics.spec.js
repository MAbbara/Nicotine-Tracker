const { test, expect } = require('@playwright/test');


async function login(page) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('today-targeted@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}


for (const destination of ['/insights/', '/dashboard/']) {
  test(`${destination} enhances server analytics without runtime errors or overflow`, async ({ page }, testInfo) => {
    if (testInfo.project.name.includes('mobile')) {
      await page.setViewportSize({ width: 320, height: 800 });
    }
    const runtimeErrors = collectRuntimeErrors(page);
    await login(page);
    await page.goto(destination);

    expect(runtimeErrors).toEqual([]);
    await expect(page.locator('.analytics-chart .apexcharts-canvas').first()).toBeVisible();
    await expect(page.getByRole('table', { name: /consumption trend data/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}


test.describe('when the local chart library cannot load', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/static/js/apexcharts.min.js', (route) => route.abort());
    await login(page);
  });

  for (const destination of ['/insights/', '/dashboard/']) {
    test(`${destination} keeps named fallback values available`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(destination);

      await expect(page.getByRole('status').filter({ hasText: 'Chart unavailable' }).first()).toBeVisible();
      const table = page.getByRole('table', { name: /consumption trend data/i });
      await expect(table).toBeVisible();
      await expect(table.locator('tbody tr').first()).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
});
