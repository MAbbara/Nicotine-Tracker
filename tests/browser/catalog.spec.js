const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


function deterministicEmail(testInfo) {
  const source = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}:catalog`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `catalog-${hash}@example.com`;
}


async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicEmail(testInfo));
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}


function exactPath(path) {
  return new RegExp('^' + path.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '$');
}


test('Catalog supports create, Quick Log availability, edit, search, and confirmed delete', async ({ page }, testInfo) => {
  const recorder = createSupportingBehaviorRecorder(SUPPORTING_OWNER_TITLES.catalog, expect);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await register(page, testInfo);
  const guard = watchForProductProblems(page);
  await page.goto('/catalog/');

  await recorder.runScenario(page, 'catalog', 'Add a pouch', 'success');

  let addPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/catalog/add') {
      addPosts += 1;
    }
  });
  await recorder.runScenario(page, 'catalog-add', 'Add pouch', 'invalid', 'success');
  expect(addPosts).toBe(1);
  const createdRow = page.locator('.catalog-row', { hasText: 'Calm Orchard' });
  await expect(createdRow).toContainText('2.75 mg');

  await page.goto('/log/view');
  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog.getByLabel('Product').locator('option', { hasText: 'Calm Orchard' }))
    .toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/catalog/');
  await recorder.runScenario(page, 'catalog', 'Edit', 'success');

  await recorder.runScenario(
    page, 'catalog-edit', 'Save changes', 'invalid', 'success',
  );
  const editedRow = page.locator('.catalog-row', { hasText: 'Calm Cedar' });

  await page.getByLabel('Search pouches').fill('Calm Cedar');
  await recorder.runScenario(page, 'catalog', 'Search', 'success');
  await expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toHaveCount(1);
  await recorder.runScenario(page, 'catalog-search', 'Search', 'success');

  await recorder.runScenario(page, 'catalog-search', 'Edit', 'success');
  await page.goto('/catalog/search?q=Calm+Cedar');
  await recorder.runScenario(page, 'catalog-search', '← Back to all pouches', 'success');

  await page.getByLabel('Search pouches').fill('Calm Cedar');
  await page.getByRole('button', { name: 'Search' }).click();
  await recorder.runScenario(page, 'catalog-search', 'Delete', 'dismiss', 'accept');

  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill('Catalog Delete Fixture');
  await page.getByLabel('Nicotine strength').fill('1.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();
  await recorder.runScenario(page, 'catalog', 'Delete', 'dismiss', 'accept');

  recorder.assertComplete();
  guard.assertClean(expect, { stateName: 'catalog supporting owner' });
  guard.stop();
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  test(`Catalog pages meet WCAG A/AA in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => {
      localStorage.setItem('nicotine-tracker-theme', value);
    }, theme);
    await register(page, testInfo);
    await page.goto('/catalog/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoWcagViolations(page);

    await page.getByRole('link', { name: 'Add a pouch' }).click();
    await expectNoWcagViolations(page);
  });
}


test('Catalog rows remain keyboard reachable without mobile overflow or bottom-nav overlap', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/catalog/');

  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(['A', 'BUTTON', 'INPUT']).toContain(focused);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
  await expect(page.locator('main table')).toHaveCount(0);
  if (testInfo.project.name.includes('mobile')) {
    const paddingBottom = await page.locator('main').evaluate((element) => (
      parseFloat(getComputedStyle(element).paddingBottom)
    ));
    expect(paddingBottom).toBeGreaterThanOrEqual(80);
  }
});
