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
      await expect(table.locator('tbody td').filter({ hasText: /^2$/ })).toHaveCount(1);
      expect(pageErrors).toEqual([]);
    });
  }
});


test('Insights range response binds identical daily and weekly values to chart and table', async ({ page }) => {
  const response = {
    total_pouches: 24,
    daily_average: 3.4,
    peak_day: 13,
    average_time_between_pouches: '2h',
    total_nicotine: 144,
    unknown_strength_count: 0,
    best_day: 11,
    consistency_score: 92,
    trend_direction: 'Stable',
    consumption_by_time_of_day: { Morning: 24 },
    consumption_by_day_of_week: { Monday: 11, Tuesday: 13 },
    brand_analysis: { 'Range Mint': 24 },
    consumption_trend: [
      { date: '2026-07-27', value: 11 },
      { date: '2026-07-28', value: 13 },
    ],
    heatmap_data: [{ name: 'Monday', data: [0, 11] }, { name: 'Tuesday', data: [0, 13] }],
    ai_insights: [],
  };
  await page.route('**/insights/api/insights?days=7', (route) => route.fulfill({ json: response }));
  await login(page);
  await page.goto('/insights/');
  await page.getByRole('button', { name: /Last 30 days/i }).click();
  await page.getByText('Last 7 days', { exact: true }).click();

  const table = page.getByRole('table', { name: /consumption trend data/i });
  await expect(table.locator('tbody tr')).toHaveText([
    '2026-07-2711',
    '2026-07-2813',
  ]);
  expect((await page.locator('#consumption-trend-chart .apexcharts-data-labels text').allTextContents()).filter(Boolean))
    .toEqual(['11', '13']);

  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveText(['2026-07-2724']);
  expect((await page.locator('#consumption-trend-chart .apexcharts-data-labels text').allTextContents()).filter(Boolean))
    .toEqual(['24']);
});
