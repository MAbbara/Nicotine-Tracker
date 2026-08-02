const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;


function deterministicEmail(testInfo) {
  const source = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}:logbook`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `logbook-${hash}@example.com`;
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


async function login(page, email = 'today-targeted@example.com') {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}


test('Logbook supports saved/custom add, filter, edit, bulk add, and confirmed delete', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await register(page, testInfo);
  await page.goto('/log/view');

  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Log one Steady Mint/ }).click();
  await expect(page.locator('.logbook-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add a log' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Date').fill('2026-01-10');
  await modal.getByLabel('Time').fill('09:15');
  await modal.getByLabel('Product').selectOption({ index: 1 });
  await modal.getByLabel('Quantity').fill('2');
  await modal.getByLabel('Notes').fill('saved product note');
  await modal.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.logbook-row', { hasText: 'saved product note' })).toBeVisible();

  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  await modal.getByLabel('Date').fill('2026-01-10');
  await modal.getByLabel('Time').fill('10:30');
  await modal.getByLabel('Product').selectOption('custom');
  await modal.getByLabel('Custom brand').fill('Calm Mint');
  await modal.getByLabel('Nicotine strength').fill('3.5');
  await modal.getByLabel('Quantity').fill('1');
  await modal.getByLabel('Notes').fill('custom product note');
  await modal.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.logbook-row', { hasText: 'Calm Mint' })).toBeVisible();

  await page.getByLabel('Search logs').fill('custom product');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.locator('.logbook-row')).toHaveCount(1);
  const customRow = page.locator('.logbook-row', { hasText: 'custom product note' });
  await customRow.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Time').fill('11:45');
  await page.getByLabel('Quantity').fill('3');
  await page.getByLabel('Notes').fill('edited custom product note');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.logbook-row', { hasText: 'edited custom product note' })).toContainText('3 pouches');

  await page.getByRole('link', { name: 'Bulk add' }).click();
  await page.getByLabel('Date for these entries').fill('2026-01-10');
  await page.getByLabel('Entries', { exact: true }).fill('2 pouches at 12:00\n1 Batch Mint 4mg at 13:00');
  await page.getByRole('button', { name: 'Add entries' }).click();
  await expect(page.locator('.logbook-row', { hasText: 'Batch Mint' })).toBeVisible();

  const editedRow = page.locator('.logbook-row', { hasText: 'edited custom product note' });
  page.once('dialog', (dialog) => dialog.accept());
  await editedRow.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.logbook-row', { hasText: 'edited custom product note' })).toHaveCount(0);

  expect(errors).toEqual([]);
});


for (const theme of ['light', 'dark']) {
  test(`Logbook and logging forms meet WCAG A/AA in explicit ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('nicotine-tracker-theme', value);
    }, theme);
    await login(page);
    await page.goto('/log/view');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoWcagViolations(page);

    await page.getByRole('button', { name: 'Add log', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add a log' })).toBeVisible();
    await expectNoWcagViolations(page);
    await page.getByRole('button', { name: 'Close add log dialog' }).click();

    const firstEdit = page.locator('.logbook-row').first().getByRole('link', { name: 'Edit' });
    await firstEdit.click();
    await expect(page.getByRole('heading', { name: 'Edit log', level: 1 })).toBeVisible();
    await expectNoWcagViolations(page);

    await page.goto('/log/bulk');
    await expect(page.getByRole('heading', { name: 'Bulk add logs', level: 1 })).toBeVisible();
    await expectNoWcagViolations(page);
  });
}


test('Logbook uses readable rows without mobile overflow or bottom-navigation overlap', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/log/view');
  await page.getByRole('button', { name: 'Add log', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add a log' });
  await modal.getByLabel('Date').fill('2026-01-10');
  await modal.getByLabel('Product').selectOption({ index: 1 });
  await modal.getByLabel('Quantity').fill('1');
  await modal.getByRole('button', { name: 'Add entry' }).click();

  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.locator('.logbook-row')).toHaveCount(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
  if (testInfo.project.name.includes('mobile')) {
    await page.locator('.logbook-row').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const row = document.querySelector('.logbook-row');
      const nav = document.querySelector('.primary-nav');
      return {
        rowBottom: row.getBoundingClientRect().bottom,
        navTop: nav.getBoundingClientRect().top,
        paddingBottom: parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),
      };
    });
    expect(geometry.paddingBottom).toBeGreaterThanOrEqual(80);
    expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.navTop);
  }
});


test.describe('when the browser and account use different timezones', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('server defaults and an existing edit time remain in the UTC account timezone', async ({ page }, testInfo) => {
    await register(page, testInfo);
    await page.goto('/log/view');
    await page.getByRole('button', { name: 'Add log', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Add a log' });
    const modalTime = await modal.getByLabel('Time').inputValue();
    const clocks = await page.evaluate(() => ({
      device: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      utc: new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    }));
    expect(modalTime).toBe(clocks.utc);
    expect(modalTime).not.toBe(clocks.device);

    await modal.getByLabel('Date').fill('2026-01-12');
    await modal.getByLabel('Time').fill('07:20');
    await modal.getByLabel('Product').selectOption({ index: 1 });
    await modal.getByLabel('Quantity').fill('1');
    await modal.getByLabel('Notes').fill('timezone edit marker');
    await modal.getByRole('button', { name: 'Add entry' }).click();

    const row = page.locator('.logbook-row', { hasText: 'timezone edit marker' });
    await row.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Time')).toHaveValue('07:20');
    await page.getByLabel('Quantity').fill('2');
    await page.getByLabel('Notes').fill('timezone edit preserved');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const edited = page.locator('.logbook-row', { hasText: 'timezone edit preserved' });
    await expect(edited).toContainText('07:20');
    await edited.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Time')).toHaveValue('07:20');
  });
});
