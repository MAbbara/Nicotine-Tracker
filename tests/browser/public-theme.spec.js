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
  return page.locator('.landing-sketch').evaluate((sketch) => {
    const hero = sketch.closest('.landing-hero');
    const sketchColumn = sketch.parentElement;
    const caption = sketchColumn.querySelector('.landing-sketch__caption');
    const how = document.querySelector('#how');
    const sketchRect = sketch.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const style = getComputedStyle(sketch);
    return {
      afterContent: getComputedStyle(sketch, '::after').content,
      borderStyle: style.borderTopStyle,
      borderWidth: parseFloat(style.borderTopWidth),
      borderRadius: parseFloat(style.borderTopLeftRadius),
      documentHorizontalOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      heroHorizontalOverflow: hero.scrollWidth - hero.clientWidth,
      sketchHorizontalOverflow: sketch.scrollWidth - sketch.clientWidth,
      sketchVerticalOverflow: sketch.scrollHeight - sketch.clientHeight,
      captionFollowsSketch: captionRect.top >= sketchRect.bottom,
      captionIsLast: sketchColumn.lastElementChild === caption,
      sketchInsideHero: sketchRect.left >= heroRect.left - 1
        && sketchRect.right <= heroRect.right + 1,
      heroPrecedesHow: Boolean(hero.compareDocumentPosition(how)
        & Node.DOCUMENT_POSITION_FOLLOWING),
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


test('landing sketch keeps current editorial ordering, theme, and bounded geometry', async ({ page }, testInfo) => {
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
    expect.soft(geometry.borderStyle, message).toBe('solid');
    expect.soft(geometry.borderWidth, message).toBeGreaterThanOrEqual(1);
    expect.soft(geometry.borderRadius, message).toBeGreaterThan(0);
    expect.soft(geometry.captionFollowsSketch, message).toBe(true);
    expect.soft(geometry.captionIsLast, message).toBe(true);
    expect.soft(geometry.sketchInsideHero, message).toBe(true);
    expect.soft(geometry.heroPrecedesHow, message).toBe(true);
    expect.soft(geometry.documentHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.heroHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.sketchHorizontalOverflow, message).toBeLessThanOrEqual(1);
    expect.soft(geometry.sketchVerticalOverflow, message).toBeLessThanOrEqual(1);
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
