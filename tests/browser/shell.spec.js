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

test('authenticated shell exposes five useful destinations with one active item', async ({ page }) => {
  const destinations = [
    ['/today', 'Today'],
    ['/log/view', 'Logbook'],
    ['/journey/', 'Journey'],
    ['/insights/', 'Insights'],
    ['/you', 'You'],
  ];

  for (const [path, heading] of destinations) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: new RegExp(heading), level: 1 })).toBeVisible();
    const primary = page.getByRole('navigation', { name: 'Primary' });
    await expect(primary.getByRole('link')).toHaveText([
      'Today', 'Logbook', 'Journey', 'Insights', 'You',
    ]);
    await expect(primary.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  }
});

test('five-item primary navigation keeps its complete contract in compact narrow rows', async ({ page }) => {
  const expectedLabels = ['Today', 'Logbook', 'Journey', 'Insights', 'You'];
  const expectedHrefs = [
    '/today/#main-content',
    '/log/view#main-content',
    '/journey/#main-content',
    '/insights/#main-content',
    '/you/#main-content',
  ];
  const scenarios = [
    { width: 320, height: 800, textScale: 2, theme: 'light', reducedMotion: 'no-preference', maxRows: 2 },
    { width: 320, height: 800, textScale: 2, theme: 'dark', reducedMotion: 'reduce', maxRows: 2 },
    { width: 360, height: 800, textScale: 1, theme: 'light', reducedMotion: 'no-preference', maxRows: 1 },
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    await page.evaluate((theme) => {
      localStorage.setItem('nicotine-tracker-theme', theme);
    }, scenario.theme);
    await page.reload();
    await page.addStyleTag({
      content: `html { font-size: ${scenario.textScale * 100}% !important; }`,
    });

    const primary = page.getByRole('navigation', { name: 'Primary' });
    const links = primary.getByRole('link');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    await expect(links).toHaveText(expectedLabels);
    expect(await links.evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('href'))
    ))).toEqual(expectedHrefs);
    await expect(primary.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(primary.locator('[aria-current="page"]')).toHaveText('Today');

    const geometry = await primary.evaluate((navigation) => {
      const navRect = navigation.getBoundingClientRect();
      const main = document.querySelector('#main-content');
      const mainStyle = getComputedStyle(main);
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        mainPaddingBottom: Number.parseFloat(mainStyle.paddingBottom),
        navClientWidth: navigation.clientWidth,
        navHeight: navRect.height,
        navScrollWidth: navigation.scrollWidth,
        rows: [...new Set([...navigation.querySelectorAll('.primary-nav__link')]
          .map((link) => Math.round(link.getBoundingClientRect().top)))],
        links: [...navigation.querySelectorAll('.primary-nav__link')].map((link) => {
          const label = link.querySelector('span');
          const linkRect = link.getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          const transitionDurations = getComputedStyle(link).transitionDuration
            .split(',').map((value) => Number.parseFloat(value) * (value.includes('ms') ? 0.001 : 1));
          return {
            height: linkRect.height,
            label: label.textContent.trim(),
            labelClientWidth: label.clientWidth,
            labelInside: labelRect.left >= linkRect.left - 1
              && labelRect.right <= linkRect.right + 1,
            labelOverflow: label.scrollWidth > label.clientWidth + 1,
            labelScrollWidth: label.scrollWidth,
            maxTransitionDuration: Math.max(0, ...transitionDurations),
            visible: linkRect.width > 0 && linkRect.height > 0,
            width: linkRect.width,
          };
        }),
      };
    });
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
    expect(geometry.navScrollWidth).toBeLessThanOrEqual(geometry.navClientWidth + 1);
    expect(geometry.rows.length).toBeLessThanOrEqual(scenario.maxRows);
    expect(geometry.mainPaddingBottom).toBeGreaterThanOrEqual(geometry.navHeight);
    for (const link of geometry.links) {
      expect(link.visible).toBe(true);
      expect(link.width).toBeGreaterThanOrEqual(44);
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(link.labelInside).toBe(true);
      expect(
        link.labelOverflow,
        `${scenario.width}px/${scenario.textScale * 100}% ${link.label}: `
          + `${link.labelScrollWidth}px content in ${link.labelClientWidth}px`,
      ).toBe(false);
      if (scenario.reducedMotion === 'reduce') {
        expect(link.maxTransitionDuration).toBeLessThanOrEqual(0.001);
      }
    }

    await links.first().focus();
    for (let index = 0; index < expectedLabels.length; index += 1) {
      await expect(links.nth(index)).toBeFocused();
      if (index < expectedLabels.length - 1) await page.keyboard.press('Tab');
    }
  }

  await page.goto('/log/view');
  const currentLogbook = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Logbook', exact: true });
  await currentLogbook.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/log\/view#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('primary navigation hands focus to main without hiding the next keyboard focus', async ({ page }) => {
  const today = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Today', exact: true });
  await today.focus();
  await page.keyboard.press('Enter');

  const main = page.locator('#main-content');
  await expect(page).toHaveURL(/\/today\/#main-content$/);
  await expect(main).toHaveAttribute('tabindex', '-1');
  await expect(main).toBeFocused();
  const mainFocus = await main.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
    };
  });
  expect(mainFocus.outlineStyle).toBe('none');

  await page.keyboard.press('Tab');
  const nextFocus = page.locator(':focus');
  expect(await nextFocus.evaluate((element) => element.matches([
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
  ].join(',')))).toBe(true);
  const nextFocusStyle = await nextFocus.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
    };
  });
  expect(nextFocusStyle.outlineStyle).not.toBe('none');
  expect(nextFocusStyle.outlineWidth).toBeGreaterThanOrEqual(3);
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


test('installable shell registers one updateable root-scoped service worker', async ({ page }) => {
  await page.goto('/today');
  await expect.poll(async () => page.evaluate(async () => (
    Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => ({
      scope: registration.scope,
      scriptURL: (registration.active || registration.waiting || registration.installing)?.scriptURL,
      updateViaCache: registration.updateViaCache,
    })))
  ))).toEqual([{
    scope: 'http://127.0.0.1:5000/',
    scriptURL: 'http://127.0.0.1:5000/service-worker.js',
    updateViaCache: 'none',
  }]);

  const updated = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration.update();
    return Boolean(registration.active);
  });
  expect(updated).toBe(true);
  const updateResponse = await page.request.get('/service-worker.js');
  expect(updateResponse.status()).toBe(200);
  expect(updateResponse.headers()['content-type']).toContain('javascript');
  expect(updateResponse.headers()['cache-control']).toContain('no-cache');
  expect(updateResponse.headers()['service-worker-allowed']).toBe('/');
  expect(await page.evaluate(async () => caches.keys())).toEqual([]);
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
