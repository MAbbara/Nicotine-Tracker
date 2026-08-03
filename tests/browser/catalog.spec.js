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


async function proveKeyboard(recorder, state, action, page, control) {
  await recorder.prove(state, action, 'keyboard', async (check) => {
    await control.focus();
    await check(expect(control).toBeFocused());
    await check(expect(control).toHaveAccessibleName(action));
    await page.keyboard.press('Enter');
  });
}


async function proveNavigation(recorder, state, action, page, control, path) {
  const navigationPending = page.waitForNavigation({ waitUntil: 'load' });
  const responsePending = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === path
  ));
  await proveKeyboard(recorder, state, action, page, control);
  const [response] = await Promise.all([responsePending, navigationPending]);
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await recorder.prove(state, action, 'request', async (check) => {
    await check(expect(response.request().method()).toBe('GET'));
    await check(expect(new URL(response.url()).pathname).toBe(path));
    await check(expect(response.status()).toBe(200));
    await check(expect(response.request().postData()).toBeNull());
  });
  return response;
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

  await expect(page.getByRole('heading', { name: 'Your pouches', level: 1 })).toBeVisible();
  await proveNavigation(
    recorder, 'catalog', 'Add a pouch', page,
    page.getByRole('link', { name: 'Add a pouch' }), '/catalog/add',
  );
  const addButton = page.getByRole('button', { name: 'Add pouch' });
  let addPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/catalog/add') {
      addPosts += 1;
    }
  });
  await proveKeyboard(recorder, 'catalog-add', 'Add pouch', page, addButton);
  const brand = page.getByLabel('Brand');
  await recorder.prove('catalog-add', 'Add pouch', 'focus', async (check) => {
    await check(expect(brand).toBeFocused());
  });
  await recorder.prove('catalog-add', 'Add pouch', 'error', async (check) => {
    await check(expect(addPosts).toBe(0));
    await check(expect(brand).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('catalog-add', 'Add pouch', 'feedback', async (check) => {
    await check(expect(brand).toHaveJSProperty('validationMessage', 'Please fill out this field.'));
  });
  await page.getByLabel('Brand').fill('Calm Orchard');
  await page.getByLabel('Nicotine strength').fill('2.75');
  const addResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/add'
  ));
  await addButton.focus();
  await page.keyboard.press('Enter');
  const addResponse = await addResponsePending;

  const createdRow = page.locator('.catalog-row', { hasText: 'Calm Orchard' });
  await expect(createdRow).toContainText('2.75 mg');
  await recorder.prove('catalog-add', 'Add pouch', 'request', async (check) => {
    await check(expect(addResponse.status()).toBe(302));
    await check(expect(Object.fromEntries(
      new URLSearchParams(addResponse.request().postData() || ''),
    )).toEqual(expect.objectContaining({ brand: 'Calm Orchard', nicotine_mg: '2.75' })));
  });
  await recorder.prove('catalog-add', 'Add pouch', 'persistence', async (check) => {
    await check(expect(createdRow).toContainText('2.75 mg'));
  });
  await recorder.prove('catalog-add', 'Add pouch', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText(
      'Successfully added Calm Orchard (2.75mg) to your catalog!',
    ));
  });

  await page.goto('/log/view');
  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a log' });
  await expect(dialog.getByLabel('Product').locator('option', { hasText: 'Calm Orchard' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close add log dialog' }).click();

  await page.goto('/catalog/');
  await proveNavigation(
    recorder, 'catalog', 'Edit', page,
    page.locator('.catalog-row', { hasText: 'Calm Orchard' }).getByRole('link', { name: 'Edit' }),
    new URL(await page.locator('.catalog-row', { hasText: 'Calm Orchard' })
      .getByRole('link', { name: 'Edit' }).getAttribute('href'), page.url()).pathname,
  );
  const editButton = page.getByRole('button', { name: 'Save changes' });
  await page.getByLabel('Nicotine strength').fill('');
  await proveKeyboard(recorder, 'catalog-edit', 'Save changes', page, editButton);
  const strength = page.getByLabel('Nicotine strength');
  await recorder.prove('catalog-edit', 'Save changes', 'focus', async (check) => {
    await check(expect(strength).toBeFocused());
  });
  await recorder.prove('catalog-edit', 'Save changes', 'error', async (check) => {
    await check(expect(strength).toHaveJSProperty('validity.valueMissing', true));
  });
  await recorder.prove('catalog-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(strength).toHaveJSProperty('validationMessage', 'Please fill out this field.'));
  });
  await page.getByLabel('Brand').fill('Calm Cedar');
  await page.getByLabel('Nicotine strength').fill('3.25');
  const editResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/edit\/\d+$/.test(new URL(response.url()).pathname)
  ));
  await editButton.focus();
  await page.keyboard.press('Enter');
  const editResponse = await editResponsePending;
  const editedRow = page.locator('.catalog-row', { hasText: 'Calm Cedar' });
  await expect(editedRow).toContainText('3.25 mg');
  await recorder.prove('catalog-edit', 'Save changes', 'request', async (check) => {
    await check(expect(editResponse.status()).toBe(302));
    await check(expect(Object.fromEntries(
      new URLSearchParams(editResponse.request().postData() || ''),
    )).toEqual(expect.objectContaining({ brand: 'Calm Cedar', nicotine_mg: '3.25' })));
  });
  await recorder.prove('catalog-edit', 'Save changes', 'persistence', async (check) => {
    await check(expect(editedRow).toContainText('3.25 mg'));
  });
  await recorder.prove('catalog-edit', 'Save changes', 'feedback', async (check) => {
    await check(expect(page.getByRole('status')).toHaveText(
      'Successfully updated Calm Cedar (3.25mg)!',
    ));
  });

  await page.getByLabel('Search pouches').fill('Calm Cedar');
  const catalogSearchResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/catalog/search'
  ));
  await proveKeyboard(recorder, 'catalog', 'Search', page, page.getByRole('button', { name: 'Search' }));
  const catalogSearchResponse = await catalogSearchResponsePending;
  await expect(page).toHaveURL(/\/catalog\/search\?q=Calm(?:\+|%20)Cedar$/);
  await expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toBeVisible();
  await recorder.prove('catalog', 'Search', 'request', async (check) => {
    await check(expect(catalogSearchResponse.status()).toBe(200));
    await check(expect(new URL(catalogSearchResponse.url()).search).toBe('?q=Calm+Cedar'));
  });

  const searchAgainResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/catalog/search'
  ));
  await proveKeyboard(
    recorder, 'catalog-search', 'Search', page, page.getByRole('button', { name: 'Search' }),
  );
  const searchAgainResponse = await searchAgainResponsePending;
  await recorder.prove('catalog-search', 'Search', 'request', async (check) => {
    await check(expect(searchAgainResponse.status()).toBe(200));
    await check(expect(new URL(searchAgainResponse.url()).search).toBe('?q=Calm+Cedar'));
  });

  const searchEdit = page.locator('.catalog-row', { hasText: 'Calm Cedar' })
    .getByRole('link', { name: 'Edit' });
  const searchEditPath = new URL(await searchEdit.getAttribute('href'), page.url()).pathname;
  await proveNavigation(recorder, 'catalog-search', 'Edit', page, searchEdit, searchEditPath);
  await page.goto('/catalog/search?q=Calm+Cedar');
  await expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toBeVisible();

  await proveNavigation(
    recorder, 'catalog-search', '← Back to all pouches', page,
    page.getByRole('link', { name: 'Back to all pouches' }), '/catalog/',
  );
  await page.getByLabel('Search pouches').fill('Calm Cedar');
  await page.getByRole('button', { name: 'Search' }).click();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  const searchDelete = page.locator('.catalog-row', { hasText: 'Calm Cedar' })
    .getByRole('button', { name: 'Delete' });
  await proveKeyboard(recorder, 'catalog-search', 'Delete', page, searchDelete);
  await recorder.prove('catalog-search', 'Delete', 'error', async (check) => {
    await check(expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toBeVisible());
  });

  const deleteResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (confirmation) => confirmation.accept());
  await searchDelete.focus();
  await page.keyboard.press('Enter');
  const deleteResponse = await deleteResponsePending;
  await recorder.prove('catalog-search', 'Delete', 'request', async (check) => {
    await check(expect(deleteResponse.request().method()).toBe('POST'));
    await check(expect(deleteResponse.status()).toBe(302));
    await check(expect(new URL(deleteResponse.url()).pathname).toMatch(/^\/catalog\/delete\/\d+$/));
  });
  await recorder.prove('catalog-search', 'Delete', 'persistence', async (check) => {
    await check(expect(page.locator('.catalog-row', { hasText: 'Calm Cedar' })).toHaveCount(0));
  });

  // Catalog-state Delete is independently exercised against a second disposable row.
  await page.goto('/catalog/add');
  await page.getByLabel('Brand').fill('Catalog Delete Fixture');
  await page.getByLabel('Nicotine strength').fill('1.5');
  await page.getByRole('button', { name: 'Add pouch' }).click();
  const catalogDeleteRow = page.locator('.catalog-row', { hasText: 'Catalog Delete Fixture' });
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await proveKeyboard(
    recorder, 'catalog', 'Delete', page,
    catalogDeleteRow.getByRole('button', { name: 'Delete' }),
  );
  await recorder.prove('catalog', 'Delete', 'error', async (check) => {
    await check(expect(catalogDeleteRow).toBeVisible());
  });
  const catalogDeleteResponsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/catalog\/delete\/\d+$/.test(new URL(response.url()).pathname)
  ));
  page.once('dialog', (confirmation) => confirmation.accept());
  await catalogDeleteRow.getByRole('button', { name: 'Delete' }).click();
  const catalogDeleteResponse = await catalogDeleteResponsePending;
  await recorder.prove('catalog', 'Delete', 'request', async (check) => {
    await check(expect(catalogDeleteResponse.status()).toBe(302));
    await check(expect(catalogDeleteResponse.request().method()).toBe('POST'));
  });
  await recorder.prove('catalog', 'Delete', 'persistence', async (check) => {
    await check(expect(catalogDeleteRow).toHaveCount(0));
  });
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
