const { test, expect } = require('@playwright/test');


test.beforeEach(async ({ page }) => {
  await page.goto('/');
});


test('public landing exposes one promise and working account actions', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Cut back at the pace of your own life.',
  })).toBeVisible();

  const actions = page.locator('.landing-actions');
  const createAccount = actions.getByRole('link', { name: 'Create account', exact: true });
  const signIn = page.locator('.marketing-actions').getByRole('link', { name: 'Sign in', exact: true });
  await expect(createAccount).toHaveAttribute('href', '/auth/register');
  await expect(signIn).toHaveAttribute('href', '/auth/login');

  for (const action of [createAccount, signIn]) {
    const size = await action.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  await signIn.click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Sign in to your account',
  })).toBeVisible();
});

test('landing follows the saved dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('nicotine-tracker-theme', 'dark');
  });
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(canvas).toBe('rgb(17, 25, 21)');
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Cut back at the pace of your own life.',
  })).toBeVisible();
});


test('primary landing action has a visible keyboard focus indicator', async ({ page }) => {
  await page.keyboard.press('Tab');
  const primary = page.locator('.landing-actions .c-button--primary');
  await primary.focus();

  const focus = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
    };
  });
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focus.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
});


test('landing contains at 320px and removes motion when requested', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className || ''),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );

  const motion = await page.locator('.landing-page, .landing-page *').evaluateAll((elements) => {
    const seconds = (value) => value.split(',').map((part) => {
      const duration = part.trim();
      const number = parseFloat(duration) || 0;
      return duration.endsWith('ms') ? number / 1000 : number;
    });
    return elements.reduce((largest, element) => {
      const style = getComputedStyle(element);
      return Math.max(
        largest,
        ...seconds(style.transitionDuration),
        ...seconds(style.animationDuration),
      );
    }, 0);
  });
  expect(motion).toBeLessThanOrEqual(0.01);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
