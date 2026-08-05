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


async function readLandingEditorialGeometry(page) {
  return page.locator('.landing-next').evaluate((next) => {
    const note = next.querySelector('.landing-next__note');
    const bodyCopy = next.querySelector(':scope > p:not(.landing-next__note)');
    const nextRect = next.getBoundingClientRect();
    const noteRect = note.getBoundingClientRect();
    const bodyCopyRect = bodyCopy.getBoundingClientRect();
    const style = getComputedStyle(next);
    return {
      afterContent: getComputedStyle(next, '::after').content,
      borderBottomStyle: style.borderBottomStyle,
      borderBottomWidth: parseFloat(style.borderBottomWidth),
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: parseFloat(style.borderTopWidth),
      documentHorizontalOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      heroHorizontalOverflow: next.closest('.landing-hero').scrollWidth
        - next.closest('.landing-hero').clientWidth,
      heroVerticalOverflow: next.closest('.landing-hero').scrollHeight
        - next.closest('.landing-hero').clientHeight,
      nextHorizontalOverflow: next.scrollWidth - next.clientWidth,
      nextVerticalOverflow: next.scrollHeight - next.clientHeight,
      noteFollowsCopy: noteRect.top >= bodyCopyRect.bottom,
      noteIsLast: next.lastElementChild === note,
      noteAboveLowerRule: noteRect.bottom <= nextRect.bottom - parseFloat(style.borderBottomWidth) + 1,
    };
  });
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


test('landing keeps both editorial rules and note ordering without a generated step number', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  await page.setViewportSize(mobile
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 });
  await page.goto('/');

  for (const theme of ['light', 'dark']) {
    await page.evaluate((savedTheme) => {
      localStorage.setItem('nicotine-tracker-theme', savedTheme);
    }, theme);
    await page.reload();
    await expectThemeContract(page, { saved: theme, effective: theme });

    const geometry = await readLandingEditorialGeometry(page);
    const message = `${theme} ${mobile ? 'mobile' : 'desktop'}: ${JSON.stringify(geometry)}`;
    expect.soft(geometry.afterContent, message).toBe('none');
    expect.soft(geometry.borderTopStyle, message).toBe('double');
    expect.soft(geometry.borderBottomStyle, message).toBe('double');
    expect.soft(geometry.borderTopWidth, message).toBeGreaterThanOrEqual(3);
    expect.soft(geometry.borderBottomWidth, message).toBeGreaterThanOrEqual(3);
    expect.soft(geometry.noteFollowsCopy, message).toBe(true);
    expect.soft(geometry.noteIsLast, message).toBe(true);
    expect.soft(geometry.noteAboveLowerRule, message).toBe(true);
    expect.soft(geometry.documentHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.heroHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.heroVerticalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.nextHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.nextVerticalOverflow, message).toBeLessThanOrEqual(1);
  }
});


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
