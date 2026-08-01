const { test, expect } = require('@playwright/test');


test.beforeEach(async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
});

test('authenticated shell exposes four useful destinations with one active item', async ({ page }) => {
  const destinations = [
    ['/today', 'Today'],
    ['/journey/', 'Journey'],
    ['/insights/', 'Insights'],
    ['/you', 'You'],
  ];

  for (const [path, heading] of destinations) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: new RegExp(heading), level: 1 })).toBeVisible();
    const primary = page.getByRole('navigation', { name: 'Primary' });
    await expect(primary.getByRole('link')).toHaveText(['Today', 'Journey', 'Insights', 'You']);
    await expect(primary.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  }
});

test('theme choice applies immediately, persists, and system follows the device', async ({ page }) => {
  await page.goto('/you');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
});

test('offline state uses the shell live region without duplicating navigation', async ({ page, context }) => {
  await page.goto('/today');
  await context.setOffline(true);
  const status = page.getByRole('status').filter({ hasText: /offline/i });
  await expect(status).toBeVisible();

  await context.setOffline(false);
  await expect(page.locator('#connection-status')).toContainText(/Back online/i);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1);
});

test('primary navigation adapts between bottom bar and side rail', async ({ page }, testInfo) => {
  await page.goto('/today');
  const position = await page.getByRole('navigation', { name: 'Primary' }).evaluate(
    (element) => getComputedStyle(element).position,
  );
  if (testInfo.project.name.includes('mobile')) {
    expect(position).toBe('fixed');
  } else {
    expect(position).toBe('sticky');
  }
});
