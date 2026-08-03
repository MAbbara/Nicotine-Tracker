const { test, expect } = require('@playwright/test');


function deterministicEmail(testInfo, label) {
  const source = `${testInfo.project.name}:${testInfo.title}:${label}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `journey-${hash}@example.com`;
}

function watchForErrors(page, { ignoreConsole = [] } = {}) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !ignoreConsole.some((pattern) => pattern.test(message.text()))) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  return errors;
}

function isoDate(daysFromToday = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

async function register(page, testInfo, label) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicEmail(testInfo, label));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('browser-password');
  await page.getByLabel('Confirm Password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}

async function loginReviewFixture(page, testInfo) {
  await page.goto('/auth/login');
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await page.getByLabel('Email address').fill(`journey-review-${project}@example.com`);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.goto('/journey/');
}

async function createPlan(page) {
  await page.locator('input[name="intention"][value="reduce"]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="baseline_source"][value="manual"]').check();
  await page.locator('#field-baseline_pouches').fill('8');
  await page.locator('#field-baseline_mg_per_pouch').fill('6');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Steady · 49 days/).check();
  await page.getByLabel(/End target in pouches per day/).fill('2');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('No reminder').check();
  await page.getByLabel('Plan start date').fill(isoDate());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Activate this reviewed plan' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.goto('/journey/');
}

async function previewRevision(page, duration = '35') {
  const editor = page.locator('[data-plan-editor="revision"]');
  await editor.getByLabel('Effective date').fill(isoDate(1));
  await editor.getByLabel('Duration days').fill(duration);
  await editor.getByRole('button', { name: 'Preview revision' }).click();
  await expect(editor.locator('[data-plan-editor-preview]')).toContainText(isoDate(1));
  await expect(editor.locator('[data-plan-editor-preview] tbody tr')).not.toHaveCount(0);
  await expect(editor.getByRole('status')).toContainText(/persisted plan is unchanged/i);
}

test('no-plan Journey prioritizes creation while neutral tracking remains available', async ({ page }, testInfo) => {
  await register(page, testInfo, 'empty');
  const errors = watchForErrors(page);
  await page.goto('/journey/');

  const empty = page.locator('.journey-empty');
  await expect(empty.getByRole('link', { name: 'Create a plan' })).toBeVisible();
  await expect(empty.getByRole('link', { name: 'Continue neutral tracking' })).toBeVisible();
  await expect(empty).not.toContainText(/failed|failure|guilt/i);
  const links = await empty.getByRole('link').evaluateAll((elements) => elements.map((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  })));
  for (const size of links) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test('Journey previews explicitly, mutates future rows only, and carries status history through archive', async ({ page }, testInfo) => {
  await register(page, testInfo, 'lifecycle');
  await createPlan(page);
  const errors = watchForErrors(page);

  await expect(page.getByRole('heading', { name: 'Current stage' })).toBeVisible();
  await expect(page.locator('[data-mobile-schedule] tbody tr')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Plan facts' })).toBeVisible();
  await page.getByText('Show the complete schedule').click();
  await expect(page.locator('[data-complete-schedule] tbody tr')).not.toHaveCount(0);
  await expect(page.locator('.journey-history')).toContainText(/Revision \d+/);

  const before = await page.locator('[data-complete-schedule] tbody tr').evaluateAll((rows) => rows.map((row) => row.textContent));
  const mutationRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/plans\/\d+\/revisions$/.test(new URL(request.url()).pathname)) {
      mutationRequests.push(request.url());
    }
  });
  const revision = page.locator('[data-plan-editor="revision"]');
  await revision.getByLabel('Duration days').fill('42');
  expect(mutationRequests).toHaveLength(0);
  await previewRevision(page, '42');
  expect(mutationRequests).toHaveLength(0);
  await revision.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);
  expect(mutationRequests).toHaveLength(1);
  await page.getByText('Show the complete schedule').click();
  const after = await page.locator('[data-complete-schedule] tbody tr').evaluateAll((rows) => rows.map((row) => row.textContent));
  expect(after[0]).toBe(before[0]);
  expect(after.slice(1)).not.toEqual(before.slice(1));

  await page.getByRole('button', { name: 'Pause plan' }).click();
  await expect(page.getByText(/Plan paused\. Your history is unchanged/i)).toBeVisible();
  const resume = page.locator('[data-plan-editor="resume"]');
  await resume.getByLabel('Required resume date').fill(isoDate(2));
  await resume.getByRole('button', { name: 'Preview resume' }).click();
  await expect(resume.locator('[data-plan-editor-preview] tbody tr')).not.toHaveCount(0);
  await resume.getByRole('button', { name: 'Confirm resume' }).click();
  await expect(page.getByText(/Status:\s*Active/i)).toBeVisible();
  await expect(page.locator('.journey-history')).toContainText(/Paused .* to .* UTC/s);

  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Plan marked complete.')).toBeVisible();
  await page.getByRole('button', { name: 'Archive plan' }).click();
  await expect(page.getByText(/Plan archived\. Your history is still available/i)).toBeVisible();
  await expect(page.locator('[data-historical-plan]')).toContainText('Archived');
  await expect(page.locator('[data-historical-plan]')).toContainText(/Revision \d+/);

  const legacy = page.locator('.legacy-review');
  await expect(legacy.getByRole('heading', { name: 'Legacy Goals remain intact' })).toBeVisible();
  await expect(legacy).toContainText(/history and review context, not an active reduction plan/i);
  expect(errors).toEqual([]);
});

test('stale revision preview refreshes and requires a second explicit confirmation', async ({ page }, testInfo) => {
  await register(page, testInfo, 'stale');
  await createPlan(page);
  const errors = watchForErrors(page, { ignoreConsole: [/Failed to load resource.*409/] });
  await previewRevision(page, '42');

  let staleReturned = false;
  await page.route(/\/api\/plans\/\d+\/revisions$/, async (route) => {
    if (!staleReturned) {
      staleReturned = true;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'preview_stale', message: 'Preview stale.', field_errors: {} } }),
      });
      return;
    }
    await route.continue();
  });

  const editor = page.locator('[data-plan-editor="revision"]');
  await editor.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(editor.getByRole('status')).toContainText(/fresh preview.*confirm again/i);
  await expect(page).toHaveURL(/\/journey\/?$/);
  await editor.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page.locator('.journey-history')).toContainText(/reason user edit/i);
  expect(staleReturned).toBe(true);
  expect(errors).toEqual([]);
});

test('Observe recovery and migrated Goal review remain visibly separate and non-activating', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await loginReviewFixture(page, testInfo);

  await expect(page.getByRole('heading', { name: 'Observe your current pattern' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish Observe' })).toBeVisible();
  const legacy = page.locator('.legacy-review');
  await expect(legacy.getByRole('heading', { name: 'History and migration review' })).toBeVisible();
  await expect(legacy).toContainText(/Candidate plan \d+/);
  await expect(legacy).toContainText(/Source Goal IDs \d+, \d+/);
  await expect(legacy).toContainText(/Exactly matched nicotine context: Goal \d+/);
  await expect(legacy).toContainText(/Conflicts and unattached context/);
  await expect(legacy.locator('tbody tr')).toHaveCount(3);

  await page.getByRole('button', { name: 'Finish Observe' }).click();
  await expect(page.getByText(/Observe is complete.*enter a baseline manually/i)).toBeVisible();
  await expect(page.getByText(/Status:\s*Active/i)).toHaveCount(0);
  await expect(page.locator('[data-historical-plan]')).toContainText('Completed');
  await expect(legacy).toContainText(/Candidate plan \d+/);
  expect(errors).toEqual([]);
});

test('Journey remains usable in dark theme, keyboard focus, 200% text, and reduced motion', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, testInfo, 'visual');
  await createPlan(page);
  const errors = watchForErrors(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const metrics = await page.evaluate(() => ({
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
  expect(metrics.scrollWidth, JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(metrics.clientWidth + 1);
  await page.getByRole('button', { name: 'Pause plan' }).focus();
  const focus = await page.getByRole('button', { name: 'Pause plan' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth), height: element.getBoundingClientRect().height };
  });
  expect(focus.outline).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.height).toBeGreaterThanOrEqual(44);
  const duration = await page.getByRole('button', { name: 'Pause plan' }).evaluate(
    (element) => Math.max(...getComputedStyle(element).transitionDuration
      .split(',').map((value) => parseFloat(value) * (value.includes('ms') ? 0.001 : 1))),
  );
  expect(duration).toBeLessThanOrEqual(0.001);
  expect(errors).toEqual([]);
});
