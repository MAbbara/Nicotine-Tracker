const { test, expect } = require('@playwright/test');


test.beforeEach(async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
});


async function mountLegacyThemeProbe(page) {
  await page.locator('main').evaluate((main) => {
    const probe = document.createElement('div');
    probe.dataset.legacyThemeProbe = '';
    probe.className = 'bg-white dark:bg-neutral-800';
    main.append(probe);
  });
  return page.locator('[data-legacy-theme-probe]');
}

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

test('theme choice publishes one effective contract and System alone follows the device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/you');
  const root = page.locator('html');
  const themeColor = page.locator('meta[name="theme-color"]');

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(root).toHaveAttribute('data-saved-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(themeColor).toHaveAttribute('content', '#111915');
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-saved-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(themeColor).toHaveAttribute('content', '#111915');

  await page.getByRole('button', { name: 'System' }).click();
  await expect(root).toHaveAttribute('data-saved-theme', 'system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(themeColor).toHaveAttribute('content', '#F5F1E7');
  await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-saved-theme', 'system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(themeColor).toHaveAttribute('content', '#111915');

  await page.getByRole('button', { name: 'Light' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-saved-theme', 'light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveClass(/\bdark\b/);
});

test('explicit Dark activates legacy dark utilities under a light device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/you');
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.goto('/insights/');

  const legacyCard = await mountLegacyThemeProbe(page);
  await expect(legacyCard).toHaveCSS('background-color', 'oklch(0.269 0 0)');
});

test('explicit Light suppresses legacy dark utilities under a dark device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/you');
  await page.getByRole('button', { name: 'Light' }).click();
  await page.goto('/insights/');

  const legacyCard = await mountLegacyThemeProbe(page);
  await expect(legacyCard).toHaveCSS('background-color', 'rgb(255, 255, 255)');
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
