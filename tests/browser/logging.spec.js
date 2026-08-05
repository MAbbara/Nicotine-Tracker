const { test, expect } = require('@playwright/test');


function deterministicEmail(testInfo) {
  const source = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}:async-logbook`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `async-logbook-${hash}@example.com`;
}


async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicEmail(testInfo));
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}


test('usual-product add replaces server history without navigation, focus loss, or scroll drift', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/log/view?q=Steady#main-content');
  const button = page.getByRole('button', { name: /Log one Steady Mint/ });
  await expect(button).toBeVisible();
  const initialUrl = page.url();
  await page.evaluate(() => window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight)));
  await button.focus();
  const initialScroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  let releaseRequest;
  const heldRequest = new Promise((resolve) => { releaseRequest = resolve; });
  const payloads = [];
  await page.route('**/log/api/quick_add', async (route) => {
    payloads.push(route.request().postDataJSON());
    await heldRequest;
    await route.continue();
  });

  await button.press('Enter');
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Adding…');
  await button.evaluate((element) => element.click());
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toEqual({
    pouch_id: Number(await button.getAttribute('data-pouch-id')),
    quantity: 1,
    client_event_id: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    view: { page: 1, q: 'Steady', from_date: '', to_date: '' },
  });
  releaseRequest();

  const notification = page.locator(
    '[data-notification-type="success"] [data-notification-message]',
  );
  await expect(notification).toHaveText('Log saved.');
  const newRow = page.locator('.logbook-row--new');
  await expect(newRow).toHaveCount(1);
  const highlightMotion = await newRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      property: style.transitionProperty,
      duration: style.transitionDuration,
    };
  });
  expect(highlightMotion.property).toContain('background-color');
  expect(highlightMotion.duration).toContain('0.7s');
  expect(page.url()).toBe(initialUrl);
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual(initialScroll);
  await expect(page.locator('[data-logbook-history]')).toHaveAttribute(
    'data-fragment-version',
    'logbook-history-v1',
  );
});


test('filtered-out success keeps filters and explains that the saved row is outside the view', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/log/view?q=does-not-match#main-content');
  const button = page.getByRole('button', { name: /Log one Steady Mint/ });
  const initialUrl = page.url();

  await button.click();

  await expect(page.locator(
    '[data-notification-type="success"] [data-notification-message]',
  )).toHaveText('Log saved. It is outside the current view.');
  await expect(page.locator('.logbook-row')).toHaveCount(0);
  await expect(page.locator('.logbook-row--new')).toHaveCount(0);
  await expect(page.getByLabel('Search logs')).toHaveValue('does-not-match');
  expect(page.url()).toBe(initialUrl);
  await expect(button).toBeFocused();
});


test('reduced motion keeps the short color cue without a transition', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, testInfo);
  await page.goto('/log/view?q=Steady');

  await page.getByRole('button', { name: /Log one Steady Mint/ }).click();

  const newRow = page.locator('.logbook-row--new');
  await expect(newRow).toHaveCount(1);
  const cue = await newRow.evaluate((element) => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--color-constructive-soft)';
    document.body.appendChild(probe);
    const expectedBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      duration: style.transitionDuration,
      expectedBackground,
    };
  });
  expect(cue.duration).toBe('0s');
  expect(cue.background).toBe(cue.expectedBackground);
});


test('failure and rate limit responses leave authoritative history unchanged', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/log/view');
  const button = page.getByRole('button', { name: /Log one Steady Mint/ });
  const originalHistory = await page.locator('[data-logbook-history]').innerHTML();
  let attempt = 0;
  await page.route('**/log/api/quick_add', async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'Quick add is temporarily unavailable.',
            field_errors: {},
            retryable: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 429,
      headers: { 'Retry-After': '9' },
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'rate_limited',
          message: 'Too many requests.',
          field_errors: {},
          retryable: true,
        },
      }),
    });
  });

  await button.click();
  await expect(page.locator(
    '[data-notification-type="error"] [data-notification-message]',
  ).last()).toHaveText('Quick add is temporarily unavailable.');
  expect(await page.locator('[data-logbook-history]').innerHTML()).toBe(originalHistory);
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();

  await button.click();
  await expect(page.locator(
    '[data-notification-type="error"] [data-notification-message]',
  ).last()).toHaveText('You’re adding logs quickly. Try again in 9 seconds.');
  expect(await page.locator('[data-logbook-history]').innerHTML()).toBe(originalHistory);
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
});
