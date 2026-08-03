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
  const responsePending = page.waitForResponse((response) => (
    response.request().isNavigationRequest()
    && response.request().method() === 'GET'
    && new URL(response.url()).pathname === path
    && (search === undefined || new URL(response.url()).search === search)
  ));
  const evidence = recorder.forAction(state, action, { page, control });
  const keyboardToken = await evidence.keyboard({
    key: 'Enter',
    outcome: {
      kind: 'response', pending: responsePending,
      method: 'GET', path: exactPath(path), search, status: 200,
    },
  });
  recorder.accept(keyboardToken);
  recorder.accept(await evidence.request({
    activation: keyboardToken,
    method: 'GET', path: exactPath(path), search, status: 200,
  }));
}


async function acceptToken(recorder, tokenPromise) {
  recorder.accept(await tokenPromise);
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
  recorder.accept(await addEvidence.keyboard({
    key: 'Enter', outcome: { kind: 'focused', locator: brand },
  }));
  expect(addPosts).toBe(0);
  await acceptToken(recorder, addEvidence.focus({ locator: brand }));
  await acceptToken(recorder, addEvidence.error({
    locator: brand, validationMessage: 'Please fill out this field.',
  }));
  await acceptToken(recorder, addEvidence.feedback({
    locator: brand, validationMessage: 'Please fill out this field.',
  }));

  await brand.fill('Calm Orchard');
  await page.getByLabel('Nicotine strength').fill('2.75');
  const addResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/add'
  ));
  const validAddKeyboard = await addEvidence.keyboard({
    key: 'Enter',
    outcome: {
      kind: 'response', pending: addResponsePending,
      method: 'POST', path: /^\/catalog\/add$/, status: 302,
    },
  });
  recorder.accept(validAddKeyboard);
  await acceptToken(recorder, addEvidence.request({
    activation: validAddKeyboard,
    method: 'POST', path: /^\/catalog\/add$/, status: 302,
    payload: { kind: 'form', exact: { brand: 'Calm Orchard', nicotine_mg: '2.75' } },
    dynamicFields: { csrf_token: 'non-empty' },
  }));
  const createdRow = page.locator('.catalog-row', { hasText: 'Calm Orchard' });
  await expect(createdRow).toContainText('2.75 mg');
  await acceptToken(recorder, addEvidence.persistence({ locator: createdRow, count: 1 }));
  await acceptToken(recorder, addEvidence.feedback({
    locator: page.getByRole('status'),
    text: 'Successfully added Calm Orchard (2.75mg) to your catalog!',
  }));

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
  recorder.accept(await editEvidence.keyboard({
    key: 'Enter', outcome: { kind: 'focused', locator: strength },
  }));
  await acceptToken(recorder, editEvidence.focus({ locator: strength }));
  await acceptToken(recorder, editEvidence.error({
    locator: strength, validationMessage: 'Please fill out this field.',
  }));
  await acceptToken(recorder, editEvidence.feedback({
    locator: strength, validationMessage: 'Please fill out this field.',
  }));

  await page.getByLabel('Brand').fill('Calm Cedar');
  await strength.fill('3.25');
  const editResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  const validEditKeyboard = await editEvidence.keyboard({
    key: 'Enter',
    outcome: {
      kind: 'response', pending: editResponsePending,
      method: 'POST', path: /^\/catalog\/edit\/\d+$/, status: 302,
    },
  });
  recorder.accept(validEditKeyboard);
  await acceptToken(recorder, editEvidence.request({
    activation: validEditKeyboard,
    method: 'POST', path: /^\/catalog\/edit\/\d+$/, status: 302,
    payload: { kind: 'form', exact: { brand: 'Calm Cedar', nicotine_mg: '3.25' } },
    dynamicFields: { csrf_token: 'non-empty' },
  }));
  const editedRow = page.locator('.catalog-row', { hasText: 'Calm Cedar' });
  await acceptToken(recorder, editEvidence.feedback({
    locator: page.getByRole('status'), text: 'Successfully updated Calm Cedar (3.25mg)!',
  }));
  await acceptToken(recorder, editEvidence.persistence({ locator: editedRow, count: 1 }));

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
  page.once('dialog', (dialogEvent) => dialogEvent.dismiss());
  recorder.accept(await searchDeleteEvidence.keyboard({
    key: 'Enter', outcome: { kind: 'visible', locator: searchDeleteRow },
  }));
  await acceptToken(recorder, searchDeleteEvidence.error({ locator: searchDeleteRow, count: 1 }));

  const searchDeleteResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  const acceptedSearchDelete = await searchDeleteEvidence.keyboard({
    key: 'Enter',
    outcome: {
      kind: 'response', pending: searchDeleteResponse,
      method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
    },
  });
  recorder.accept(acceptedSearchDelete);
  await acceptToken(recorder, searchDeleteEvidence.request({
    activation: acceptedSearchDelete,
    method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
    payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  await acceptToken(recorder, searchDeleteEvidence.feedback({
    locator: page.getByRole('status'),
    text: 'Successfully deleted Calm Cedar (3.25mg) from your catalog.',
  }));
  await acceptToken(recorder, searchDeleteEvidence.persistence({
    locator: page.locator('.catalog-row', { hasText: 'Calm Cedar' }), count: 0,
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
  page.once('dialog', (dialogEvent) => dialogEvent.dismiss());
  recorder.accept(await catalogDeleteEvidence.keyboard({
    key: 'Enter', outcome: { kind: 'visible', locator: catalogDeleteRow },
  }));
  await acceptToken(recorder, catalogDeleteEvidence.error({ locator: catalogDeleteRow, count: 1 }));
  const catalogDeleteResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  const acceptedCatalogDelete = await catalogDeleteEvidence.keyboard({
    key: 'Enter',
    outcome: {
      kind: 'response', pending: catalogDeleteResponse,
      method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
    },
  });
  recorder.accept(acceptedCatalogDelete);
  await acceptToken(recorder, catalogDeleteEvidence.request({
    activation: acceptedCatalogDelete,
    method: 'POST', path: /^\/catalog\/delete\/\d+$/, status: 302,
    payload: { kind: 'form', exact: {} }, dynamicFields: { csrf_token: 'non-empty' },
  }));
  await acceptToken(recorder, catalogDeleteEvidence.feedback({
    locator: page.getByRole('status'),
    text: 'Successfully deleted Catalog Delete Fixture (1.50mg) from your catalog.',
  }));
  await acceptToken(recorder, catalogDeleteEvidence.persistence({
    locator: page.locator('.catalog-row', { hasText: 'Catalog Delete Fixture' }), count: 0,
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
