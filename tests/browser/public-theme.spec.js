const { test, expect } = require('@playwright/test');


const PUBLIC_ROUTES = [
  ['landing', '/'],
  ['login', '/auth/login'],
  ['register', '/auth/register'],
  ['forgot password', '/auth/forgot_password'],
  ['reset password', '/auth/reset_password/browser-accessibility-reset-token'],
];


async function expectThemeContract(page, { saved, effective }) {
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-saved-theme', saved);
  await expect(root).toHaveAttribute('data-theme', effective);
  await expect(root).toHaveCSS('color-scheme', effective);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    effective === 'dark' ? '#111915' : '#F5F1E7',
  );
  if (effective === 'dark') {
    await expect(root).toHaveClass(/\bdark\b/);
  } else {
    await expect(root).not.toHaveClass(/\bdark\b/);
  }
}


for (const [name, path] of PUBLIC_ROUTES) {
  test(`${name} applies a saved dark choice without a harness`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      localStorage.setItem('nicotine-tracker-theme', 'dark');
    });

    await page.goto(path);

    await expectThemeContract(page, { saved: 'dark', effective: 'dark' });
  });
}


test('anonymous System follows initial and live device preference changes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nicotine-tracker-theme', 'system');
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectThemeContract(page, { saved: 'system', effective: 'light' });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectThemeContract(page, { saved: 'system', effective: 'dark' });

  await page.emulateMedia({ colorScheme: 'light' });
  await expectThemeContract(page, { saved: 'system', effective: 'light' });
});


test('saved Light overrides a dark anonymous device preference', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nicotine-tracker-theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/auth/login');

  await expectThemeContract(page, { saved: 'light', effective: 'light' });
});


test('invalid anonymous storage falls back safely to System', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nicotine-tracker-theme', 'sepia');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await expectThemeContract(page, { saved: 'system', effective: 'dark' });
});


test('unavailable anonymous storage falls back safely to System', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/auth/login');

  await expectThemeContract(page, { saved: 'system', effective: 'dark' });
});


test('blocked localStorage getter still initializes anonymous System handling', async ({ page }) => {
  const preferenceWrites = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/api/preferences/theme')) {
      preferenceWrites.push(request.postData());
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/auth/login');

  await expectThemeContract(page, { saved: 'system', effective: 'dark' });
  await page.evaluate(() => {
    window.__themeChanges = [];
    document.documentElement.addEventListener('nicotine-tracker:theme-change', (event) => {
      window.__themeChanges.push(event.detail);
    });
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await expectThemeContract(page, { saved: 'system', effective: 'light' });
  await expect.poll(() => page.evaluate(() => window.__themeChanges)).toEqual([
    { saved: 'system', effective: 'light' },
  ]);
  expect(preferenceWrites).toEqual([]);
});
