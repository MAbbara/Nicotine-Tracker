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


async function typedNavigation(recorder, state, action, page, control, path, search = undefined) {
  const evidence = recorder.forAction(state, action, { page, control });
  recorder.accept(await evidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'GET', path: exactPath(path), search, status: 200,
    },
  }));
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

  await typedNavigation(
    recorder, 'catalog', 'Add a pouch', page,
    page.getByRole('link', { name: 'Add a pouch' }), '/catalog/add',
  );

  const addButton = page.getByRole('button', { name: 'Add pouch' });
  const brand = page.getByLabel('Brand');
  const addEvidence = recorder.forAction(
    'catalog-add', 'Add pouch', { page, control: addButton },
  );
  let addPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/catalog/add') {
      addPosts += 1;
    }
  });
  recorder.accept(await addEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: brand },
    error: { locator: brand, validationMessage: 'Please fill out this field.' },
    feedback: { locator: brand, validationMessage: 'Please fill out this field.' },
  }));
  expect(addPosts).toBe(0);

  await brand.fill('Calm Orchard');
  await page.getByLabel('Nicotine strength').fill('2.75');
  const createdRow = page.locator('.catalog-row', { hasText: 'Calm Orchard' });
  recorder.accept(await addEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/catalog\/add$/, status: 302,
      payload: { kind: 'form', exact: { brand: 'Calm Orchard', nicotine_mg: '2.75' } },
      dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'),
      text: 'Successfully added Calm Orchard (2.75mg) to your catalog!',
    },
    persistence: {
      kind: 'locator', locator: createdRow, property: 'count',
      expectedBefore: 0, expectedAfter: 1,
    },
  }));
  await expect(createdRow).toContainText('2.75 mg');

  await page.goto('/log/view');
  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog.getByLabel('Product').locator('option', { hasText: 'Calm Orchard' }))
    .toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/catalog/');
  const editLink = page.locator('.catalog-row', { hasText: 'Calm Orchard' })
    .getByRole('link', { name: 'Edit' });
  const editPath = new URL(await editLink.getAttribute('href'), page.url()).pathname;
  await typedNavigation(recorder, 'catalog', 'Edit', page, editLink, editPath);

  const editButton = page.getByRole('button', { name: 'Save changes' });
  const strength = page.getByLabel('Nicotine strength');
  const editEvidence = recorder.forAction(
    'catalog-edit', 'Save changes', { page, control: editButton },
  );
  await strength.fill('');
  recorder.accept(await editEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    focus: { mode: 'moved', locator: strength },
    error: { locator: strength, validationMessage: 'Please fill out this field.' },
    feedback: { locator: strength, validationMessage: 'Please fill out this field.' },
  }));

  await page.getByLabel('Brand').fill('Calm Cedar');
  await strength.fill('3.25');
  const editedRow = page.locator('.catalog-row', { hasText: 'Calm Cedar' });
  recorder.accept(await editEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    request: {
      method: 'POST', path: /^\/catalog\/edit\/\d+$/, status: 302,
      payload: { kind: 'form', exact: { brand: 'Calm Cedar', nicotine_mg: '3.25' } },
      dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'), text: 'Successfully updated Calm Cedar (3.25mg)!',
    },
    persistence: {
      kind: 'locator', locator: editedRow, property: 'count',
      expectedBefore: 0, expectedAfter: 1,
    },
  }));

  await page.getByLabel('Search pouches').fill('Calm Cedar');
  await typedNavigation(
    recorder, 'catalog', 'Search', page,
    page.getByRole('button', { name: 'Search' }), '/catalog/search', '?q=Calm+Cedar',
  );
  await expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toHaveCount(1);
  await typedNavigation(
    recorder, 'catalog-search', 'Search', page,
    page.getByRole('button', { name: 'Search' }), '/catalog/search', '?q=Calm+Cedar',
  );

  const searchEdit = page.locator('.catalog-row', { hasText: 'Calm Cedar' })
    .getByRole('link', { name: 'Edit' });
  const searchEditPath = new URL(await searchEdit.getAttribute('href'), page.url()).pathname;
  await typedNavigation(recorder, 'catalog-search', 'Edit', page, searchEdit, searchEditPath);
  await page.goto('/catalog/search?q=Calm+Cedar');
  await typedNavigation(
    recorder, 'catalog-search', '← Back to all pouches', page,
    page.getByRole('link', { name: 'Back to all pouches' }), '/catalog/',
  );

  await page.getByLabel('Search pouches').fill('Calm Cedar');
  await page.getByRole('button', { name: 'Search' }).click();
  const searchDeleteRow = page.locator('.catalog-row', { hasText: 'Calm Cedar' });
  const searchDelete = searchDeleteRow.getByRole('button', { name: 'Delete' });
  const searchDeleteEvidence = recorder.forAction(
    'catalog-search', 'Delete', { page, control: searchDelete },
  );
  recorder.accept(await searchDeleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'dismiss',
    outcome: { kind: 'visible', locator: searchDeleteRow },
    error: { kind: 'dismissed-dialog', locator: searchDeleteRow, count: 1 },
  }));

  recorder.accept(await searchDeleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'accept',
    request: {
      method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
      payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'),
      text: 'Successfully deleted Calm Cedar (3.25mg) from your catalog.',
    },
    persistence: {
      kind: 'locator', locator: page.locator('.catalog-row', { hasText: 'Calm Cedar' }),
      property: 'count', expectedBefore: 1, expectedAfter: 0,
    },
  }));

  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill('Catalog Delete Fixture');
  await page.getByLabel('Nicotine strength').fill('1.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();
  const catalogDeleteRow = page.locator('.catalog-row', { hasText: 'Catalog Delete Fixture' });
  const catalogDelete = catalogDeleteRow.getByRole('button', { name: 'Delete' });
  const catalogDeleteEvidence = recorder.forAction(
    'catalog', 'Delete', { page, control: catalogDelete },
  );
  recorder.accept(await catalogDeleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'dismiss',
    outcome: { kind: 'visible', locator: catalogDeleteRow },
    error: { kind: 'dismissed-dialog', locator: catalogDeleteRow, count: 1 },
  }));
  recorder.accept(await catalogDeleteEvidence.run({
    activation: { kind: 'keyboard', key: 'Enter' },
    dialog: 'accept',
    request: {
      method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
      payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
    },
    feedback: {
      locator: page.getByRole('status'),
      text: 'Successfully deleted Catalog Delete Fixture (1.50mg) from your catalog.',
    },
    persistence: {
      kind: 'locator',
      locator: page.locator('.catalog-row', { hasText: 'Catalog Delete Fixture' }),
      property: 'count', expectedBefore: 1, expectedAfter: 0,
    },
  }));

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
