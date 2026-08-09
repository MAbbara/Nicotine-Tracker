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


function readyInsights(days = 7, total = 24) {
  return {
    range_days: days,
    observed_days: 7,
    log_count: 7,
    comparison: {
      available: true,
      current_total: total,
      previous_total: 30,
      absolute_change: total - 30,
      percent_change: ((total - 30) / 30) * 100,
      direction: total < 30 ? 'down' : total > 30 ? 'up' : 'steady',
    },
    data_sufficiency: {
      trend: true,
      time_pattern: true,
      brand_pattern: true,
      heatmap: true,
    },
    total_pouches: total,
    daily_average: Number((total / days).toFixed(1)),
    peak_day: 13,
    average_time_between_pouches: '2h',
    total_nicotine: 144,
    unknown_strength_count: 0,
    strength_coverage: {
      known_pouches: total,
      unknown_pouches: 0,
      total_pouches: total,
      known_percent: 100,
      complete: true,
    },
    best_day: 11,
    consistency_score: 92,
    trend_direction: 'Stable',
    consumption_by_time_of_day: { Morning: total },
    nicotine_by_time_of_day: { Morning: total * 6 },
    consumption_by_day_of_week: { Monday: 11, Tuesday: 13 },
    brand_analysis: { 'Range Mint': total },
    nicotine_by_product: { 'Range Mint': total * 6 },
    consumption_trend: [
      { date: '2026-07-27', value: 11 },
      { date: '2026-07-28', value: 13 },
    ],
    heatmap_data: [{ name: 'Monday', data: [0, 11] }, { name: 'Tuesday', data: [0, 13] }],
    ai_insights: [],
  };
}


for (const destination of ['/dashboard/']) {
  test(`${destination} enhances server analytics without runtime errors or overflow`, async ({ page }, testInfo) => {
    if (testInfo.project.name.includes('mobile')) {
      await page.setViewportSize({ width: 320, height: 800 });
    }
    const runtimeErrors = collectRuntimeErrors(page);
    await login(page);
    await page.goto(destination);

    expect(runtimeErrors).toEqual([]);
    await expect(page.locator('.analytics-chart .apexcharts-canvas').first()).toBeVisible();
    await expect(page.getByRole('table', { name: /recent daily intake data/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}


test('Insights direct range URLs keep server data, selection, and export aligned', async ({ page }) => {
  await login(page);
  await page.goto('/insights/?days=7');

  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-days="30"]')).not.toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#export-data')).toHaveAttribute('data-export-href', '/insights/api/export?days=7');
  const payload = JSON.parse(await page.locator('#initial-insights-data').textContent());
  expect(payload.range_days).toBe(7);
});

test('Insights sparse state keeps guidance and tables without blank chart frames', async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) {
    await page.setViewportSize({ width: 320, height: 800 });
  }
  const runtimeErrors = collectRuntimeErrors(page);
  await login(page);
  await page.goto('/insights/');

  await expect(page.locator('[data-insights-root]')).toHaveAttribute('data-insights-state', 'sparse');
  await expect(page.locator('[data-insights-headline]')).toHaveText('Keep logging to reveal a reliable direction.');
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(0);
  await expect(page.locator('[data-analytics-key="trend"]')).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});


test.describe('when the local chart library cannot load', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/static/js/apexcharts.min.js', (route) => route.abort());
    await login(page);
  });

  for (const destination of ['/dashboard/']) {
    test(`${destination} keeps named fallback values available`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(destination);

      await expect(page.getByRole('status').filter({ hasText: 'Chart unavailable' }).first()).toBeVisible();
      const table = page.getByRole('table', { name: /recent daily intake data/i });
      await expect(table).toBeVisible();
      await expect(table.locator('tbody td').filter({ hasText: /^2$/ })).toHaveCount(1);
      expect(pageErrors).toEqual([]);
    });
  }


  test('Insights preserves its table when an eligible chart constructor is unavailable', async ({ page }) => {
    await page.route('**/insights/api/insights?days=7', (route) => route.fulfill({ json: readyInsights() }));
    await page.goto('/insights/');
    await page.getByRole('link', { name: '7 days', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Chart unavailable' }).first()).toBeVisible();
    await expect(page.locator('[data-analytics-key="trend"]')).toBeAttached();
  });
});


test('Insights range response updates narrative controls export chart and table together', async ({ page }) => {
  const response = readyInsights();
  await page.route('**/insights/api/insights?days=7', (route) => route.fulfill({ json: response }));
  await login(page);
  await page.goto('/insights/');
  await page.getByRole('link', { name: '7 days', exact: true }).click();

  await expect(page.locator('[data-insights-root]')).toHaveAttribute('data-insights-state', 'ready');
  await expect(page.locator('[data-insights-headline]')).toHaveText('You used 20% less than the previous 7 days.');
  await expect(page.getByRole('link', { name: '7 days', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#export-data')).toHaveAttribute('data-export-href', '/insights/api/export?days=7');
  const tableBody = page.locator('[data-analytics-key="trend"]');
  await expect(tableBody.locator('tr')).toHaveText([
    '2026-07-2711',
    '2026-07-2813',
  ]);
  expect((await page.locator('#consumption-trend-chart .apexcharts-data-labels text').allTextContents()).filter(Boolean))
    .toEqual(['11', '13']);

  await expect(page.getByRole('button', { name: 'Daily', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(tableBody.locator('tr')).toHaveText(['2026-07-2724']);
  expect((await page.locator('#consumption-trend-chart .apexcharts-data-labels text').allTextContents()).filter(Boolean))
    .toEqual(['24']);

  await page.getByText('Open hourly detail and supporting measures', { exact: true }).click();
  await expect(page.locator('#heatmap-chart .apexcharts-canvas')).toBeVisible();
  expect(await page.locator('#heatmap-chart .apexcharts-canvas').evaluate((element) => (
    element.getBoundingClientRect().width
  ))).toBeGreaterThan(0);
});


test('Insights can transition from sparse to empty without leaving a chart frame', async ({ page }) => {
  const empty = {
    ...readyInsights(90, 0),
    observed_days: 0,
    log_count: 0,
    comparison: {
      available: false,
      current_total: 0,
      previous_total: 24,
      absolute_change: null,
      percent_change: null,
      direction: null,
    },
    data_sufficiency: {
      trend: false,
      time_pattern: false,
      brand_pattern: false,
      heatmap: false,
    },
    consumption_trend: [],
    consumption_by_time_of_day: {},
    consumption_by_day_of_week: {},
    brand_analysis: {},
    heatmap_data: [],
  };
  await page.route('**/insights/api/insights?days=90', (route) => route.fulfill({ json: empty }));
  await login(page);
  await page.goto('/insights/');
  await page.getByRole('link', { name: '90 days', exact: true }).click();

  await expect(page.locator('[data-insights-root]')).toHaveAttribute('data-insights-state', 'empty');
  await expect(page.locator('[data-insights-headline]')).toContainText('first log');
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(0);
  await expect(page.locator('.analytics-chart[hidden]')).toHaveCount(5);
});


test('Insights supports every range and preserves current content when refresh fails', async ({ page }) => {
  const requested = [];
  await page.route('**/insights/api/insights?days=*', async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    requested.push(days);
    if (days === 90) {
      await route.fulfill({ status: 503, json: { error: 'temporary' } });
      return;
    }
    await route.fulfill({ json: readyInsights(days) });
  });
  await login(page);
  await page.goto('/insights/');

  for (const [name, days] of [['7 days', 7], ['30 days', 30], ['1 year', 365]]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#export-data')).toHaveAttribute('data-export-href', `/insights/api/export?days=${days}`);
  }
  const beforeFailure = await page.locator('[data-insights-headline]').innerText();
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page.locator('[data-insights-headline]')).toHaveText(beforeFailure);
  await expect(page.getByRole('link', { name: '1 year', exact: true })).toHaveAttribute('aria-current', 'true');
  expect(requested).toEqual([7, 30, 365, 90]);
});


test('Dashboard retires the range controller and keeps focused destinations keyboard reachable', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/');

  await expect(page.locator('[data-analytics-disclosure-trigger], [data-analytics-disclosure-menu]')).toHaveCount(0);
  const first = page.getByRole('link', { name: 'Go to Today' });
  const last = page.getByRole('link', { name: 'Review Journey' });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(last).toBeFocused();
});


test('Dashboard custom-range APIs remain exact after the range controller is retired', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/');
  const query = 'start_date=2026-06-10&end_date=2026-06-12';
  const trend = await page.request.get(`/dashboard/api/daily_intake_chart?${query}`);
  const hourly = await page.request.get(`/dashboard/api/hourly_distribution?${query}`);
  expect(trend.status()).toBe(200);
  expect(hourly.status()).toBe(200);
  expect((await trend.json()).data.map((point) => point.date)).toEqual([
    '2026-06-10', '2026-06-11', '2026-06-12',
  ]);
  expect((await hourly.json()).data).toHaveLength(24);

  const reversed = await page.request.get(
    '/dashboard/api/daily_intake_chart?start_date=2026-06-12&end_date=2026-06-10',
  );
  expect(reversed.status()).toBe(400);
  expect((await reversed.json()).error).toBe('Start date must be on or before end date.');
});


test('System theme changes refresh the Insights chart palette without changing its table', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page);
  await page.goto('/you');
  await page.getByRole('button', { name: 'System' }).click();
  await page.goto('/insights/');
  await page.route('**/insights/api/insights?days=7', (route) => route.fulfill({ json: readyInsights() }));
  await page.getByRole('link', { name: '7 days', exact: true }).click();

  const tableBody = page.locator('[data-analytics-key="trend"]');
  const originalRows = await tableBody.innerText();
  const axisLabel = page.locator('#consumption-trend-chart .apexcharts-xaxis-texts-g text').first();
  await expect(axisLabel).toHaveCSS('fill', 'rgb(30, 42, 36)');

  await page.evaluate(() => {
    const BaseChart = window.ApexCharts;
    window.__insightsChartConcurrency = { active: 0, maxActive: 0, completed: 0 };
    window.ApexCharts = class DelayedChart {
      constructor(target, options) {
        this.chart = new BaseChart(target, options);
      }
      async render() {
        const audit = window.__insightsChartConcurrency;
        audit.active += 1;
        audit.maxActive = Math.max(audit.maxActive, audit.active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 60));
          await this.chart.render();
          audit.completed += 1;
        } finally {
          audit.active -= 1;
        }
      }
      destroy() {
        this.chart.destroy();
      }
    };
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.evaluate(() => window.__insightsChartConcurrency.active)).toBe(1);
  await page.evaluate(() => {
    document.documentElement.dispatchEvent(new CustomEvent('nicotine-tracker:theme-change'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(axisLabel).toHaveCSS('fill', 'rgb(238, 232, 216)');
  await expect.poll(() => page.evaluate(() => window.__insightsChartConcurrency.completed)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__insightsChartConcurrency.maxActive)).toBe(1);
  await expect(page.locator('.analytics-chart:not([hidden]) .apexcharts-canvas')).toHaveCount(4);
  expect(await tableBody.innerText()).toBe(originalRows);
});
