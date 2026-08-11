const { test, expect } = require('@playwright/test');
const {
  OWNER_TITLES,
  createBehaviorRecorder,
} = require('./helpers/core_behavior_contract');


test.beforeEach(async ({ page }) => {
  await page.goto('/');
});


test('public landing exposes one promise and working account actions', async ({ page }) => {
  const recorder = createBehaviorRecorder(OWNER_TITLES.landing, expect);
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

  for (const [action, name, path, heading] of [
    [createAccount, 'Create account', '/auth/register', 'Create your account'],
    [signIn, 'Sign in', '/auth/login', 'Sign in to your account'],
  ]) {
    await page.goto('/');
    const responsePending = page.waitForResponse((response) => (
      response.request().isNavigationRequest()
      && new URL(response.url()).pathname === path
    ));
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    const response = await responsePending;
    expect(response.request().method()).toBe('GET');
    expect(response.request().postData()).toBeNull();
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    recorder.record('landing', name, ['keyboard', 'request']);
  }

  const navigationCases = [
    ['Add details', () => page.getByRole('link', { name: 'Add details', exact: true }), '/log/add', 302],
    ['Adjust plan', () => page.getByRole('link', { name: 'Adjust plan', exact: true }), '/journey/', 302],
    ['Cravings', () => page.getByRole('contentinfo').getByRole('link', { name: 'Cravings', exact: true }), '/cravings/cravings', 302],
    ['Create your account', () => page.getByRole('link', { name: 'Create your account', exact: true }), '/auth/register', 200],
    ['Export your data', () => page.getByRole('contentinfo').getByRole('link', { name: 'Export your data', exact: true }), '/settings/data', 302],
    ['Insights', () => page.getByRole('contentinfo').getByRole('link', { name: 'Insights', exact: true }), '/insights/', 302],
    ['Privacy & your data', () => page.getByRole('contentinfo').getByRole('link', { name: 'Privacy & your data', exact: true }), '/settings/data', 302],
    ['Today', () => page.getByRole('contentinfo').getByRole('link', { name: 'Today', exact: true }), '/today/', 302],
    ['Your plan', () => page.getByRole('contentinfo').getByRole('link', { name: 'Your plan', exact: true }), '/journey/', 302],
  ];
  for (const [name, locate, path, status] of navigationCases) {
    await page.goto('/');
    const action = locate();
    const responsePending = page.waitForResponse((response) => (
      response.request().isNavigationRequest()
      && new URL(response.url()).pathname === path
    ));
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    const response = await responsePending;
    expect(response.request().method()).toBe('GET');
    expect(response.request().postData()).toBeNull();
    expect(response.status()).toBe(status);
    if (status === 200) {
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    } else {
      await expect(page).toHaveURL(/\/auth\/login/);
    }
    recorder.record('landing', name, ['keyboard', 'request']);
  }

  await page.goto('/');
  const howLink = page.getByRole('link', { name: 'See how it works', exact: true });
  await howLink.focus();
  await expect(howLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole('heading', {
    level: 2,
    name: 'Three moves. No overhaul of your life required.',
  })).toBeVisible();
  recorder.record('landing', 'See how it works', ['keyboard']);

  await page.goto('/');
  let expectedCount = 3;
  for (const name of ['Velo 6 mg', 'ZYN 3 mg', 'On! 4 mg']) {
    const action = page.getByRole('button', { name, exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    expectedCount += 1;
    await expect(page.locator('#sumCount')).toHaveText(String(expectedCount));
    await expect(page.locator('#undoToast')).toBeVisible();
    recorder.record('landing', name, ['focus', 'keyboard']);
  }

  const craving = page.getByRole('button', {
    name: 'Having a craving? Pause, note it, and choose what helps next.',
    exact: true,
  });
  await craving.focus();
  await page.keyboard.press('Enter');
  await expect(craving).toBeFocused();
  await expect(craving).toHaveAttribute('aria-expanded', 'true');
  recorder.record('landing', 'Having a craving? Pause, note it, and choose what helps next.', ['focus', 'keyboard']);

  const passed = page.getByRole('button', { name: 'It passed', exact: true });
  await passed.focus();
  await page.keyboard.press('Enter');
  await expect(passed).toBeFocused();
  await expect(page.locator('#pauseResolved')).toHaveText('Noted — that urge passed. That counts.');
  recorder.record('landing', 'It passed', ['focus', 'keyboard']);

  const logAnyway = page.getByRole('button', { name: 'Log one anyway', exact: true });
  await logAnyway.focus();
  await page.keyboard.press('Enter');
  expectedCount += 1;
  await expect(logAnyway).toBeFocused();
  await expect(page.locator('#sumCount')).toHaveText(String(expectedCount));
  await expect(page.locator('#pauseResolved')).toHaveText('Logged. Honesty beats perfection.');
  recorder.record('landing', 'Log one anyway', ['focus', 'keyboard']);

  for (let level = 1; level <= 10; level += 1) {
    const name = `Intensity ${level}`;
    const action = page.getByRole('button', { name, exact: true });
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(action).toBeFocused();
    await expect(page.locator('#intensityValue')).toHaveText(String(level));
    recorder.record('landing', name, ['focus', 'keyboard']);
  }

  for (const name of ['Coffee', 'Stress', 'After a meal', 'Driving', 'Boredom', 'With alcohol']) {
    const action = page.getByRole('button', { name, exact: true });
    const before = await action.getAttribute('aria-pressed');
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(action).toBeFocused();
    await expect(action).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    recorder.record('landing', name, ['focus', 'keyboard']);
  }

  for (const name of [
    'Do I have to quit completely to use this?',
    'What happens when I go over my plan?',
    'Is it only for nicotine pouches?',
    'Will it nag me with notifications?',
    'What does it cost?',
  ]) {
    const action = page.locator('summary').filter({ hasText: name });
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(action).toBeFocused();
    await expect(action.locator('xpath=..')).toHaveAttribute('open', '');
    recorder.record('landing', name, ['focus', 'keyboard']);
  }

  recorder.assertComplete();

  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Cut back at the pace of your own life.',
  })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
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

  await expect(page.locator('#password-error')).toHaveText('Use 8 to 128 characters.');
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


test('registration clears stale mismatch when only password is edited to match', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto('/auth/register');

  await page.fill('#email', 'second-pass@example.com');
  await page.fill('#password', 'long-enough');
  await page.fill('#confirm_password', 'different');
  await page.check('#terms');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page.locator('#confirm_password-error')).toHaveText('Passwords do not match.');
  await expect(page).toHaveURL(/\/auth\/register$/);

  // Edit only the password until it matches the untouched confirmation.
  await page.fill('#password', 'different');

  // The dependent confirmation field must be recomputed: the stale mismatch
  // message and its custom validity both clear.
  await expect(page.locator('#confirm_password-error')).toHaveText('');
  const confirmationValidity = await page.locator('#confirm_password').evaluate((control) => ({
    valid: control.validity.valid,
    customError: control.validity.customError,
    validationMessage: control.validationMessage,
  }));
  expect(confirmationValidity).toEqual({ valid: true, customError: false, validationMessage: '' });

  // A now-valid form must not be blocked by the previously recorded custom
  // validity: the browser has to attempt the POST.
  const postRequest = page.waitForRequest((request) => (
    request.url().includes('/auth/register') && request.method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await postRequest;
  expect(consoleErrors).toEqual([]);
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
