const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;


let userSequence = 0;


function uniqueEmail(testInfo) {
  userSequence += 1;
  const source = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `dashboard-${process.pid}-${userSequence}-${hash}@example.com`;
}


async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(uniqueEmail(testInfo));
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}


async function loginPopulated(page) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('today-targeted@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


function collectUnexpectedErrors(page, {
  ignoreFailed = () => false,
  ignoreConsole = () => false,
} = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !ignoreConsole(message)) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!ignoreFailed(request)) {
      errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`);
  });
  return errors;
}


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}


test('Dashboard keeps one server-first compatibility review with purposeful destinations', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  await loginPopulated(page);
  await page.goto('/dashboard/');

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(/compatibility view/i)).toBeVisible();
  await expect(page.locator('[data-dashboard-today]')).toHaveCount(1);
  await expect(page.locator('figure[data-dashboard-trend]')).toHaveCount(1);
  await expect(page.locator('.analytics-chart .apexcharts-canvas')).toBeVisible();
  await expect(page.locator('.apexcharts-toolbar')).toHaveCount(0);
  const repeatedStart = await page.evaluate(async () => {
    const module = await import('/static/js/dashboard-charts.js');
    return module.startDashboardCharts(document, window);
  });
  expect(repeatedStart).toBe(false);
  await expect(page.locator('.analytics-chart .apexcharts-canvas')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Recent daily intake data' })).toBeVisible();
  await expect(page.locator('#addLogModal, [data-hs-overlay], [data-dashboard-table="hourly"]')).toHaveCount(0);

  const destinations = page.locator('[data-dashboard-destinations] a');
  await expect(destinations).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today/');
  await expect(page.getByRole('link', { name: 'Open Insights' })).toHaveAttribute('href', '/insights/');
  await expect(page.getByRole('link', { name: 'Review Journey' })).toHaveAttribute('href', '/journey/');
  await page.getByRole('link', { name: 'Go to Today' }).focus();
  await expect(page.getByRole('link', { name: 'Go to Today' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open Insights' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Review Journey' })).toBeFocused();

  await expectNoWcagViolations(page);
  expect(errors).toEqual([]);
});


test('Empty Dashboard guides action without loading or drawing an empty chart', async ({ page }, testInfo) => {
  const errors = collectUnexpectedErrors(page);
  const dashboardAssets = [];
  page.on('request', (request) => {
    if (/apexcharts|dashboard-charts/.test(request.url())) dashboardAssets.push(request.url());
  });
  await register(page, testInfo);
  await page.goto('/dashboard/');

  await expect(page.locator('[data-dashboard-empty]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start with Today' })).toBeVisible();
  await expect(page.locator('figure[data-dashboard-trend], .analytics-chart, .apexcharts-canvas')).toHaveCount(0);
  expect(dashboardAssets).toEqual([]);
  expect(errors).toEqual([]);
});


test('Dashboard preserves its semantic trend when chart enhancement cannot load', async ({ page }) => {
  const errors = collectUnexpectedErrors(page, {
    ignoreFailed: (request) => request.url().includes('/static/js/apexcharts.min.js'),
    ignoreConsole: (message) => message.text() === 'Failed to load resource: net::ERR_FAILED',
  });
  await page.route('**/static/js/apexcharts.min.js', (route) => route.abort());
  await loginPopulated(page);
  await page.goto('/dashboard/');

  await expect(page.getByRole('status')).toContainText('Chart unavailable');
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Recent daily intake data' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('Dashboard keeps semantic values first and collapses the chart when its module is blocked', async ({ page }) => {
  await page.route('**/static/js/dashboard-charts.js', (route) => route.abort());
  await loginPopulated(page);
  await page.goto('/dashboard/');

  const table = page.getByRole('table', { name: 'Recent daily intake data' });
  const chart = page.locator('#dashboard-trend-chart');
  await expect(table).toBeVisible();
  await expect(chart).toBeHidden();
  await expect(chart).toHaveAttribute('hidden', '');
  expect(await chart.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
  expect(await page.evaluate(() => {
    const values = document.querySelector('.analytics-figure__table');
    const target = document.querySelector('#dashboard-trend-chart');
    return Boolean(values.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
});


test('Dashboard supports light and dark themes without accessibility regressions', async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 320, height: 800 });
  await loginPopulated(page);

  await page.evaluate(() => localStorage.setItem('nicotine-tracker-theme', 'light'));
  await page.goto('/dashboard/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectNoWcagViolations(page);

  await page.evaluate(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoWcagViolations(page);
});


test('Dashboard remains operable at 320px and 200% text with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await loginPopulated(page);
  await page.goto('/dashboard/');

  await expect(page.locator('#dashboard-trend-chart')).toHaveAttribute('data-motion', 'reduced');
  const actions = page.locator('[data-dashboard-destinations] a, .analytics-figure__table > summary');
  const heights = await actions.evaluateAll((elements) => elements.map(
    (element) => element.getBoundingClientRect().height,
  ));
  expect(heights.every((height) => height >= 44)).toBe(true);

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
  const overflow = await page.locator('body *').evaluateAll((items) => {
    const viewportWidth = document.documentElement.clientWidth;
    return items.flatMap((item) => {
      if (item.closest('.analytics-chart') || getComputedStyle(item).display === 'none') return [];
      const rect = item.getBoundingClientRect();
      if (rect.right <= viewportWidth + 1 && rect.left >= -1) return [];
      return [{ tag: item.tagName, className: item.className, left: rect.left, right: rect.right }];
    }).slice(0, 12);
  });
  expect(overflow).toEqual([]);

  const clearance = await page.evaluate(() => {
    const navigation = document.querySelector('.primary-nav');
    const main = document.querySelector('main');
    if (!navigation || getComputedStyle(navigation).position !== 'fixed') return 0;
    return parseFloat(getComputedStyle(main).paddingBottom) - navigation.getBoundingClientRect().height;
  });
  expect(clearance).toBeGreaterThanOrEqual(0);
});
