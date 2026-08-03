const { test, expect } = require('@playwright/test');
const {
  OWNER_TITLES,
  createBehaviorRecorder,
} = require('./helpers/core_behavior_contract');


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
  const recorder = createBehaviorRecorder(OWNER_TITLES.theme, expect);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/you');
  const root = page.locator('html');
  const themeColor = page.locator('meta[name="theme-color"]');

  async function saveTheme(button, theme) {
    let attempt = 0;
    let releaseSuccess;
    let reportPending;
    const successGate = new Promise((resolve) => { releaseSuccess = resolve; });
    const pendingRequest = new Promise((resolve) => { reportPending = resolve; });
    await page.route('/api/preferences/theme', async (route) => {
      attempt += 1;
      expect(route.request().method()).toBe('PATCH');
      expect(route.request().postDataJSON()).toEqual({ theme });
      if (attempt === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'controlled theme persistence failure' }),
        });
        return;
      }
      reportPending();
      await successGate;
      await route.continue();
    });

    await button.focus();
    await expect(button).toBeFocused();
    const failedResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/preferences/theme'
    ));
    await page.keyboard.press('Enter');
    const failedResponse = await failedResponsePending;
    expect(failedResponse.status()).toBe(503);
    expect(failedResponse.request().postDataJSON()).toEqual({ theme });
    await expect(page.locator('[data-theme-feedback]'))
      .toHaveText('Appearance changed here, but could not be saved yet.');
    await expect(root).toHaveAttribute('data-saved-theme', theme);
    await expect(button).toBeFocused();

    const savedResponsePending = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/preferences/theme'
    ));
    await page.keyboard.press('Enter');
    await pendingRequest;
    await expect(page.locator('[data-theme-feedback]')).toHaveText('Saving appearance…');
    await expect(button).toBeFocused();
    releaseSuccess();
    const savedResponse = await savedResponsePending;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().postDataJSON()).toEqual({ theme });
    await expect(page.locator('[data-theme-feedback]')).toHaveText('Appearance saved.');
    expect(attempt).toBe(2);
    await page.unroute('/api/preferences/theme');
  }

  const dark = page.getByRole('button', { name: 'Dark' });
  await saveTheme(dark, 'dark');
  await expect(root).toHaveAttribute('data-saved-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(themeColor).toHaveAttribute('content', '#111915');
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toBeFocused();

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-saved-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(themeColor).toHaveAttribute('content', '#111915');
  recorder.record('you', 'Dark', [
    'error', 'focus', 'keyboard', 'loading', 'persistence', 'request',
  ]);

  const system = page.getByRole('button', { name: 'System' });
  await saveTheme(system, 'system');
  await expect(root).toHaveAttribute('data-saved-theme', 'system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(themeColor).toHaveAttribute('content', '#F5F1E7');
  await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toBeFocused();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-saved-theme', 'system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(themeColor).toHaveAttribute('content', '#111915');
  await page.reload();
  await expect(root).toHaveAttribute('data-saved-theme', 'system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  recorder.record('you', 'System', [
    'error', 'focus', 'keyboard', 'loading', 'persistence', 'request',
  ]);

  const light = page.getByRole('button', { name: 'Light' });
  await saveTheme(light, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-saved-theme', 'light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect(light).toBeFocused();
  await page.reload();
  await expect(root).toHaveAttribute('data-saved-theme', 'light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  recorder.record('you', 'Light', [
    'error', 'focus', 'keyboard', 'loading', 'persistence', 'request',
  ]);
  recorder.assertComplete();
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
