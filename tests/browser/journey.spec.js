const { test, expect } = require('@playwright/test');
const {
  OWNER_TITLES,
  createBehaviorRecorder,
} = require('./helpers/core_behavior_contract');


function deterministicEmail(testInfo, label) {
  const retry = Number(testInfo.retry) || 0;
  const repeat = Number(testInfo.repeatEachIndex) || 0;
  const source = `${testInfo.project.name}:${testInfo.title}:${retry}:${repeat}:${label}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `journey-${hash}@example.com`;
}

test('Journey registration identities are stable per attempt and isolated across retries and repeats', () => {
  const attempt = {
    project: { name: 'chromium-desktop' },
    title: 'Journey lifecycle',
    retry: 0,
    repeatEachIndex: 0,
  };
  const email = deterministicEmail(attempt, 'lifecycle');

  expect(deterministicEmail({ ...attempt }, 'lifecycle')).toBe(email);
  expect(deterministicEmail({ ...attempt, retry: 1 }, 'lifecycle')).not.toBe(email);
  expect(deterministicEmail({ ...attempt, repeatEachIndex: 1 }, 'lifecycle')).not.toBe(email);
  expect(deterministicEmail({
    ...attempt,
    project: { name: 'chromium-mobile' },
  }, 'lifecycle')).not.toBe(email);
});

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

async function isoDate(page, daysFromToday = 0) {
  const response = await page.request.get('/__test__/release-clock');
  expect(response.status()).toBe(200);
  const { fixed_now: fixedNow } = await response.json();
  const value = new Date(fixedNow);
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
  await page.getByLabel('Email address').fill(`journey-review-flow-${project}@example.com`);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.goto('/journey/');
}

async function loginFixture(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.goto('/journey/');
}

async function createPlan(page, { startDays = 0 } = {}) {
  await page.locator('input[name="intention"][value="reduce"]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="baseline_source"][value="manual"]').check();
  await page.locator('#field-baseline_mg').fill('48');
  await page.locator('#field-baseline_mg_per_pouch').fill('6');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Steady · 49 days/).check();
  await page.getByLabel(/End target nicotine per day/).fill('12');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('No reminder').check();
  await page.getByLabel('Plan start date').fill(await isoDate(page, startDays));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Activate this reviewed plan' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await page.goto('/journey/');
}

async function previewRevision(page, duration = '35', { keyboard = false } = {}) {
  const editor = page.locator('[data-plan-editor="revision"]');
  const effectiveDate = await isoDate(page, 1);
  await editor.getByLabel('Effective date').fill(effectiveDate);
  await editor.getByLabel('Duration days').fill(duration);
  const preview = editor.getByRole('button', { name: 'Preview revision' });
  const responsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/api\/plans\/\d+\/revisions\/preview$/.test(new URL(response.url()).pathname)
  ));
  if (keyboard) {
    await preview.focus();
    await expect(preview).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await preview.click();
  }
  expect((await responsePending).status()).toBe(200);
  await expect(editor.locator('[data-plan-editor-preview]')).toContainText(effectiveDate);
  await expect(editor.locator('[data-plan-editor-preview] tbody tr')).not.toHaveCount(0);
  await expect(editor.getByRole('status')).toContainText(/persisted plan is unchanged/i);
}

async function keyboardPost(page, button, pathSuffix) {
  const responsePending = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(pathSuffix)
  ));
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  const response = await responsePending;
  expect(response.status()).toBe(302);
  expect(response.request().postData()).toMatch(/csrf_token=/);
  await expect(page).toHaveURL(/\/journey\/?$/);
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

test('first viewport explains nicotine progress and next change before technical details', async ({ page }, testInfo) => {
  await register(page, testInfo, 'comprehension');
  await createPlan(page);
  const errors = watchForErrors(page);

  const progress = page.locator('[data-journey-progress]');
  await expect(progress.getByRole('heading', { name: 'Today in this plan' })).toBeVisible();
  await expect(progress.locator('[data-known-mg]')).toHaveText('0.00 mg');
  await expect(progress.locator('[data-ceiling-mg]')).toHaveText('48.00 mg');
  await expect(progress.locator('[data-remaining-mg]')).toHaveText('48.00 mg');
  await expect(progress).toContainText(/Below today’s ceiling/i);
  await expect(progress).toContainText(/Pouches logged\s+0/i);

  const nextChange = page.locator('[data-next-change]');
  await expect(nextChange).toBeVisible();
  await expect(nextChange).toContainText(/mg on/i);
  await expect(nextChange).toContainText(/lower than today/i);

  const fold = await page.evaluate(() => ({
    viewport: window.innerHeight,
    intro: document.querySelector('.journey-intro').getBoundingClientRect().toJSON(),
    plan: document.querySelector('.journey-plan').getBoundingClientRect().toJSON(),
    progress: document.querySelector('[data-journey-progress]').getBoundingClientRect().toJSON(),
    next: document.querySelector('[data-next-change]').getBoundingClientRect().toJSON(),
    progressBottom: document.querySelector('[data-journey-progress]').getBoundingClientRect().bottom,
    nextBottom: document.querySelector('[data-next-change]').getBoundingClientRect().bottom,
    knownSize: parseFloat(getComputedStyle(document.querySelector('[data-known-mg]')).fontSize),
    pouchSize: parseFloat(getComputedStyle(document.querySelector('.journey-today__context')).fontSize),
  }));
  expect(fold.progressBottom, JSON.stringify(fold)).toBeLessThanOrEqual(fold.viewport + 1);
  expect(fold.nextBottom, JSON.stringify(fold)).toBeLessThanOrEqual(fold.viewport + 1);
  expect(fold.knownSize).toBeGreaterThan(fold.pouchSize);

  await expect(page.locator('[data-mobile-schedule] tbody tr')).toHaveCount(7);
  const editor = page.locator('[data-plan-editor="revision"]');
  await expect(editor.getByRole('heading', { name: 'Change what comes next' })).toBeVisible();
  const details = page.locator('.journey-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-complete-schedule]')).not.toBeVisible();
  const summary = details.getByText('Plan details and history');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-complete-schedule]')).toBeVisible();
  await expect(page.locator('.journey-history')).toBeVisible();
  await expect(summary).toBeFocused();
  expect(errors).toEqual([]);
});

test('pre-start and paused Journey explain neutral schedule transitions', async ({ page }, testInfo) => {
  await register(page, testInfo, 'neutral-transitions');
  const startDate = await isoDate(page, 2);
  await createPlan(page, { startDays: 2 });
  const errors = watchForErrors(page);

  const nextChange = page.locator('[data-next-change]');
  await expect(nextChange).toContainText(/First ceiling begins/i);
  await expect(nextChange).toContainText(/48\.00 mg/i);
  await expect(nextChange.locator('time')).toHaveAttribute('datetime', startDate);
  await expect(nextChange).not.toContainText(/final scheduled ceiling/i);

  await page.getByText('Plan details and history').click();
  await keyboardPost(page, page.getByRole('button', { name: 'Pause plan' }), '/pause');

  const progress = page.locator('[data-journey-progress]');
  await expect(progress).toContainText(/Plan paused/i);
  await expect(progress.locator('[data-ceiling-mg]')).toHaveText(/Paused.*not in effect/i);
  await expect(nextChange).toContainText(/Resume this plan before future ceiling dates are scheduled/i);
  await expect(nextChange.locator('time')).toHaveCount(0);
  await expect(nextChange).not.toContainText(/final scheduled ceiling|mg on/i);
  expect(errors).toEqual([]);
});

test('paused Observe describes neutral continuation without ceiling dates', async ({ page }, testInfo) => {
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await loginFixture(page, `journey-paused-observe-${project}@example.com`);
  const errors = watchForErrors(page);

  await page.getByText('Plan details and history').click();
  await keyboardPost(page, page.getByRole('button', { name: 'Pause plan' }), '/pause');

  const nextChange = page.locator('[data-next-change]');
  await expect(nextChange).toContainText(/Observation is paused/i);
  await expect(nextChange).toContainText(/continue neutral observation/i);
  await expect(nextChange).not.toContainText(/ceiling dates|mg on/i);
  await expect(nextChange.locator('time')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('legacy pace-only and duration-only edits convert through the nicotine UI', async ({ page }, testInfo) => {
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  const effectiveDate = await isoDate(page, 1);
  const today = await isoDate(page);

  for (const edit of ['pace', 'duration']) {
    await loginFixture(page, `journey-legacy-${edit}-${project}@example.com`);
    const errors = watchForErrors(page);
    const editor = page.locator('[data-plan-editor="revision"]');
    const target = editor.getByLabel(/End target nicotine per day/);
    await expect(target).toHaveValue('12.00');
    await expect(target).toHaveAttribute('required', '');
    await editor.getByLabel('Effective date').fill(effectiveDate);
    if (edit === 'pace') {
      await editor.getByLabel('Pace change').selectOption('focused');
    } else {
      await editor.getByLabel('Duration days').fill('42');
    }
    await editor.getByRole('button', { name: 'Preview revision' }).click();
    await expect(editor.locator('[data-plan-editor-preview]')).toContainText(
      effectiveDate,
    );
    await expect(editor.getByRole('status')).not.toContainText(/target basis/i);
    await Promise.all([
      page.waitForURL(/\/journey\/?$/),
      editor.getByRole('button', { name: 'Confirm revision' }).click(),
    ]);

    await page.getByText('Plan details and history').click();
    const schedule = page.locator('[data-complete-schedule]');
    const historical = schedule.getByRole('row').filter({ hasText: today });
    const converted = schedule.getByRole('row').filter({ hasText: effectiveDate });
    await expect(historical).not.toContainText('Not used');
    await expect(converted).toContainText('Not used');
    expect(errors).toEqual([]);
    const signedOut = await page.request.get('/auth/logout');
    expect(signedOut.status()).toBe(200);
    await page.goto('/');
  }
});

test('Journey previews explicitly, mutates future rows only, and carries status history through archive', async ({ page }, testInfo) => {
  const recorder = createBehaviorRecorder(OWNER_TITLES.journeyLifecycle, expect);
  await register(page, testInfo, 'lifecycle');
  await createPlan(page);
  const errors = watchForErrors(page);

  await expect(page.getByRole('heading', { name: 'Today in this plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What changes next' })).toBeVisible();
  await expect(page.locator('[data-mobile-schedule] tbody tr')).toHaveCount(7);
  const planDetails = page.getByText('Plan details and history');
  await planDetails.focus();
  await page.keyboard.press('Enter');
  const completeSchedule = page.locator('[data-complete-schedule]');
  await expect(page.locator('[data-complete-schedule] tbody tr')).not.toHaveCount(0);
  await expect(planDetails).toBeFocused();
  recorder.record('journey', 'Plan details and history', ['focus', 'keyboard']);
  await expect(page.locator('.journey-history')).toContainText(/Plan change \d+/);

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
  await previewRevision(page, '42', { keyboard: true });
  expect(mutationRequests).toHaveLength(0);
  recorder.record('journey', 'Preview revision', ['keyboard', 'persistence', 'request']);
  await revision.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page).toHaveURL(/\/journey\/?$/);
  expect(mutationRequests).toHaveLength(1);
  await page.getByText('Plan details and history').click();
  const after = await page.locator('[data-complete-schedule] tbody tr').evaluateAll((rows) => rows.map((row) => row.textContent));
  expect(after[0]).toBe(before[0]);
  expect(after.slice(1)).not.toEqual(before.slice(1));

  await keyboardPost(page, page.getByRole('button', { name: 'Pause plan' }), '/pause');
  await expect(page.getByText(/Plan paused\. Your history is unchanged/i)).toBeVisible();
  await page.reload();
  await page.getByText('Plan details and history').click();
  await expect(page.locator('.journey-facts')).toContainText(/Status\s*Paused/i);
  recorder.record('journey', 'Pause plan', ['keyboard', 'persistence', 'request']);
  const resume = page.locator('[data-plan-editor="resume"]');
  await resume.getByLabel('Required resume date').fill(await isoDate(page, 2));
  await resume.getByRole('button', { name: 'Preview resume' }).click();
  await expect(resume.locator('[data-plan-editor-preview] tbody tr')).not.toHaveCount(0);
  await resume.getByRole('button', { name: 'Confirm resume' }).click();
  await page.getByText('Plan details and history').click();
  await expect(page.locator('.journey-facts')).toContainText(/Status\s*Active/i);
  await expect(page.locator('.journey-history')).toContainText(/Paused .* to .* UTC/s);

  await keyboardPost(page, page.getByRole('button', { name: 'Mark complete' }), '/complete');
  await expect(page.getByText('Plan marked complete.')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-historical-plan]')).toContainText('Completed');
  recorder.record('journey', 'Mark complete', ['keyboard', 'persistence', 'request']);
  await keyboardPost(page, page.getByRole('button', { name: 'Archive plan' }), '/archive');
  await expect(page.getByText(/Plan archived\. Your history is still available/i)).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-historical-plan]')).toContainText('Archived');
  await expect(page.locator('[data-historical-plan]')).toContainText(/Plan change \d+/);

  const legacy = page.locator('.legacy-review');
  await expect(legacy.getByRole('heading', { name: 'Legacy Goals remain intact' })).toBeVisible();
  await expect(legacy).toContainText(/history and review context, not an active reduction plan/i);
  expect(errors).toEqual([]);
  recorder.record('journey', 'Archive plan', ['keyboard', 'persistence', 'request']);
  recorder.assertComplete();
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
  await expect(page.locator('.journey-history')).toContainText(/User Edit/i);
  expect(staleReturned).toBe(true);
  expect(errors).toEqual([]);
});

test('Journey planning flow stays contiguous and balanced across target viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'One canonical exact-viewport geometry run');
  await register(page, testInfo, 'geometry');
  await createPlan(page);

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    const layout = await page.evaluate(() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          top: value.top, right: value.right, bottom: value.bottom,
          left: value.left, width: value.width, height: value.height,
        };
      };
      const visible = (element) => {
        const value = rect(element);
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && value.width > 0 && value.height > 0;
      };
      const plan = document.querySelector('.journey-plan');
      const today = plan.querySelector(':scope > .journey-today');
      const nextChange = plan.querySelector(':scope > .journey-next-change');
      const schedule = plan.querySelector(':scope > .journey-plan__schedule');
      const maintenance = plan.querySelector(':scope > .journey-plan__maintenance');
      const details = plan.querySelector(':scope > .journey-details');
      const editor = maintenance.querySelector('[data-plan-editor="revision"]');
      const fieldItems = [...editor.querySelectorAll('.journey-editor__fields > div')];
      const fullWidthItems = [
        editor.querySelector('.journey-editor__fields'),
        editor.querySelector('form > p'),
        editor.querySelector('.journey-editor__buttons'),
        editor.querySelector('[data-plan-editor-status]'),
        editor.querySelector('[data-plan-editor-preview]'),
      ].filter((element) => element && visible(element)).map(rect);
      const flowChildren = [...plan.children].filter(visible).map(rect)
        .sort((left, right) => left.top - right.top);
      const emptyGaps = flowChildren.slice(1).map((item, index) => (
        item.top - flowChildren[index].bottom
      )).filter((gap) => gap > 0);
      const actualHorizontalScrollers = [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowX))
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          className: String(element.className || ''),
          insideSchedule: Boolean(element.closest('.journey-plan__schedule')),
        }));
      return {
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        today: rect(today),
        nextChange: rect(nextChange),
        schedule: rect(schedule),
        maintenance: rect(maintenance),
        details: rect(details),
        editor: rect(editor),
        fieldItems: fieldItems.map(rect),
        fullWidthItems,
        emptyGaps,
        actualHorizontalScrollers,
        scheduleBeforeEditor: Boolean(schedule.compareDocumentPosition(editor)
          & Node.DOCUMENT_POSITION_FOLLOWING),
        editorBeforeDetails: Boolean(editor.compareDocumentPosition(details)
          & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });

    expect(layout.scheduleBeforeEditor).toBe(true);
    expect(layout.editorBeforeDetails).toBe(true);
    expect(layout.nextChange.top).toBeGreaterThanOrEqual(layout.today.bottom);
    expect(layout.schedule.top).toBeGreaterThanOrEqual(layout.nextChange.bottom);
    expect(layout.editor.top - layout.schedule.bottom).toBeGreaterThanOrEqual(0);
    expect(layout.editor.top - layout.schedule.bottom).toBeLessThanOrEqual(96);
    expect(layout.editor.width).toBeGreaterThanOrEqual(layout.schedule.width * 0.95);
    expect(Math.max(0, ...layout.emptyGaps)).toBeLessThanOrEqual(192);
    const fullWidthValues = layout.fullWidthItems.map((item) => item.width);
    expect(
      Math.max(...fullWidthValues) - Math.min(...fullWidthValues),
      `${viewport.width}x${viewport.height}: ${JSON.stringify(layout.fullWidthItems)}`,
    ).toBeLessThanOrEqual(1);

    const columnStarts = new Set(layout.fieldItems.map((item) => Math.round(item.left)));
    if (viewport.width >= 1024) {
      expect(columnStarts.size).toBe(2);
      expect(layout.fieldItems).toHaveLength(4);
      expect(layout.fieldItems[0].width).toBeGreaterThanOrEqual(layout.editor.width * 0.4);
      expect(layout.fieldItems[1].width).toBeGreaterThanOrEqual(layout.editor.width * 0.4);
    } else {
      expect(columnStarts.size).toBe(1);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentWidth + 1);
      expect(layout.actualHorizontalScrollers.every(({ insideSchedule }) => insideSchedule)).toBe(true);
    }
  }
});

test('Observe recovery and migrated Goal review remain visibly separate and non-activating', async ({ page }, testInfo) => {
  const recorder = createBehaviorRecorder(OWNER_TITLES.journeyObserve, expect);
  const errors = watchForErrors(page);
  await loginReviewFixture(page, testInfo);

  await expect(page.getByRole('heading', { name: 'Today in this plan' })).toBeVisible();
  await page.getByText('Plan details and history').click();
  await expect(page.getByRole('button', { name: 'Finish Observe' })).toBeVisible();
  const legacy = page.locator('.legacy-review');
  await expect(legacy.getByRole('heading', { name: 'History and migration review' })).toBeVisible();
  await expect(legacy).toContainText(/Candidate plan \d+/);
  await expect(legacy).toContainText(/Source Goal IDs \d+, \d+/);
  await expect(legacy).toContainText(/Exactly matched nicotine context: Goal \d+/);
  await expect(legacy).toContainText(/Conflicts and unattached context/);
  await expect(legacy.locator('tbody tr')).toHaveCount(3);

  await keyboardPost(page, page.getByRole('button', { name: 'Finish Observe' }), '/finish-observe');
  await expect(page.getByText(/Observe is complete.*enter a baseline manually/i)).toBeVisible();
  await expect(page.getByText(/Status:\s*Active/i)).toHaveCount(0);
  await expect(page.locator('[data-historical-plan]')).toContainText('Completed');
  await page.reload();
  await expect(page.locator('[data-historical-plan]')).toContainText('Completed');
  await expect(legacy).toContainText(/Candidate plan \d+/);
  expect(errors).toEqual([]);
  recorder.assertComplete();
});

test('Journey remains usable in dark theme, keyboard focus, 200% text, and reduced motion', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, testInfo, 'visual');
  await createPlan(page);
  const errors = watchForErrors(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByText('Plan details and history').click();

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
  const pauseButton = page.getByRole('button', { name: 'Pause plan' });
  await pauseButton.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(pauseButton).toBeFocused();
  const focus = await pauseButton.evaluate((element) => {
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
