const { test, expect } = require('@playwright/test');


test.beforeEach(async ({ page }) => {
  await page.goto('/');
});


test('public landing exposes one promise and working account actions', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Start with the next useful action.',
  })).toBeVisible();

  const actions = page.locator('.landing-actions');
  const createAccount = actions.getByRole('link', { name: 'Create account', exact: true });
  const signIn = actions.getByRole('link', { name: 'Sign in', exact: true });
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('.auth-panel')).toHaveCount(1);

  const submit = page.locator('.auth-panel').getByRole('button', { name: 'Sign in', exact: true });
  const submitSize = await submit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(submitSize.height).toBeGreaterThanOrEqual(44);
});


test('registration validates inline without dialogs or console errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  let dialogSeen = false;
  page.on('dialog', async (dialog) => {
    dialogSeen = true;
    await dialog.dismiss();
  });

  await page.goto('/auth/register');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('.auth-panel')).toHaveCount(1);

  await page.fill('#email', 'runner@example.com');
  await page.fill('#password', 'short');
  await page.fill('#confirm_password', 'short');
  await page.check('#terms');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page.locator('#password-error')).toHaveText('Use at least 6 characters.');
  await expect(page).toHaveURL(/\/auth\/register$/);
  expect(dialogSeen).toBe(false);

  await page.fill('#password', 'long-enough');
  await page.fill('#confirm_password', 'different');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page.locator('#password-error')).toHaveText('');
  await expect(page.locator('#confirm_password-error')).toHaveText('Passwords do not match.');
  await expect(page).toHaveURL(/\/auth\/register$/);
  expect(dialogSeen).toBe(false);
  expect(consoleErrors).toEqual([]);
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
