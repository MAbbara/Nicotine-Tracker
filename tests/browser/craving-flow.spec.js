const { test, expect } = require('@playwright/test');

function watchForProductProblems(page) {
  const errors = [];
  const forbiddenRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  page.on('request', (request) => {
    if (/preline|apexcharts|lodash|dashboard-charts/i.test(request.url())) {
      forbiddenRequests.push(request.url());
    }
  });
  return { errors, forbiddenRequests };
}

async function pendingEvents(page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'nicotine-tracker')) return [];
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('nicotine-tracker');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('pending_events')) {
          database.close();
          resolve([]);
          return;
        }
        const transaction = database.transaction('pending_events', 'readonly');
        const all = transaction.objectStore('pending_events').getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => {
          database.close();
          resolve(all.result);
        };
      };
    });
  });
}

async function login(page, email = 'today-targeted@example.com') {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  const clockResponse = await page.request.get('/__test__/release-clock');
  expect(clockResponse.status()).toBe(200);
  const { fixed_now: fixedNow } = await clockResponse.json();
  await page.clock.setFixedTime(new Date(fixedNow));
}

async function openAndRecordCraving(page, { intensity = 7, trigger = '' } = {}) {
  await page.locator('#today-craving-action').click();
  const dialog = page.getByRole('dialog', { name: 'Take the next useful step' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(String(intensity), { exact: true }).check();
  if (trigger) await dialog.getByLabel(/What set it off/).fill(trigger);
  await dialog.getByRole('button', { name: 'Record craving' }).click();
  return dialog;
}

test('Craving fallback remains usable while enhancement is delayed', async ({ page }) => {
  await page.route('**/static/js/today/craving_flow.js', async (route) => {
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    await route.continue();
  });
  await login(page);
  const slot = page.locator('[data-craving-action-slot]');

  await expect(slot).not.toHaveAttribute('data-controller-ready', 'true');
  await expect(slot.locator('[data-action-enhanced]')).toBeHidden();
  await slot.locator('[data-action-fallback]').click();

  await expect(page).toHaveURL(/\/cravings\/cravings$/);
});

test('Craving enhancement waits for readiness and opens support without navigation', async ({ page }) => {
  await login(page);
  const slot = page.locator('[data-craving-action-slot]');

  await expect(slot).toHaveAttribute('data-controller-ready', 'true');
  await expect(slot.locator('[data-action-fallback]')).toBeHidden();
  const enhanced = slot.locator('[data-action-enhanced]');
  await expect(enhanced).toBeVisible();
  await enhanced.click();

  await expect(page).toHaveURL(/\/today\/?$/);
  await expect(page.getByRole('dialog', { name: 'Take the next useful step' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  if (!/\/today\/?$/.test(new URL(page.url()).pathname)) return;
  const result = await page.evaluate(async () => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await fetch('/__test__/cleanup-today-events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': csrfToken },
    });
    return { ok: response.ok, status: response.status };
  });
  expect(result).toEqual({ ok: true, status: 200 });
});

test('initial check-in creates one canonical unresolved craving row', async ({ page }) => {
  const payloads = [];
  await page.route('**/api/cravings', async (route) => {
    if (route.request().method() === 'POST') payloads.push(route.request().postDataJSON());
    await route.continue();
  });
  await login(page);
  await page.waitForLoadState('load');
  const initialCravingCount = await page.locator('[data-timeline-type="craving"]').count();
  const trigger = page.locator('#today-craving-action');
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Take the next useful step' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'How strong is it right now?' })).toBeFocused();
  await dialog.getByLabel('7', { exact: true }).check();
  await dialog.getByLabel(/What set it off/).fill('after lunch');
  await dialog.getByRole('button', { name: 'Record craving' }).click();

  await expect(dialog.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();
  await expect(page.locator('[data-timeline-type="craving"]')).toHaveCount(initialCravingCount + 1);
  const newRow = page.locator('[data-timeline-type="craving"][data-client-event-id]').last();
  await expect(newRow).toContainText('Craving recorded');
  await expect(newRow).toContainText('Intensity 7 · Outcome not recorded');
  expect(payloads).toHaveLength(1);
  expect(payloads[0].intensity).toBe(7);
  expect(payloads[0].trigger).toBe('after lunch');
});

test('one dialog adapts to a mobile bottom sheet and centered desktop panel', async ({ page }, testInfo) => {
  await login(page);
  await page.locator('#today-craving-action').click();
  const dialog = page.getByRole('dialog', { name: 'Take the next useful step' });
  await expect(dialog).toBeVisible();

  const panel = dialog.locator('[data-dialog-panel]');
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      topRadius: parseFloat(style.borderTopLeftRadius),
      bottomRadius: parseFloat(style.borderBottomLeftRadius),
    };
  });
  if (testInfo.project.name.includes('mobile')) {
    expect(geometry.left).toBeLessThanOrEqual(1);
    expect(geometry.right).toBeGreaterThanOrEqual(geometry.viewportWidth - 1);
    expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight - 15);
    expect(geometry.bottomRadius).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs((geometry.left + geometry.right) / 2 - geometry.viewportWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((geometry.top + geometry.bottom) / 2 - geometry.viewportHeight / 2)).toBeLessThanOrEqual(1);
    expect(geometry.width).toBeLessThanOrEqual(36 * 16 + 1);
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth - 47);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight - 47);
  }
  expect(geometry.topRadius).toBeGreaterThanOrEqual(18);
  const targets = await dialog.locator('button, input[type="radio"] + span').evaluateAll(
    (elements) => elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
      .filter((target) => target.width > 0 && target.height > 0),
  );
  expect(
    targets.every((target) => target.width >= 44 && target.height >= 44),
    JSON.stringify(targets),
  ).toBe(true);
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('create retry reuses its UUID and a created flow resumes into an early outcome', async ({ page }) => {
  const payloads = [];
  let createCount = 0;
  await page.route('**/api/cravings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    createCount += 1;
    if (createCount === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'Could not save this craving yet. Try again.',
            field_errors: {},
            retryable: true,
          },
        }),
      });
    }
    return route.continue();
  });
  await login(page);
  const dialog = await openAndRecordCraving(page, { intensity: 8 });

  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('[data-timeline-type="craving"][data-timeline-state="failed"]'))
    .toContainText('Not saved yet');
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#today-craving-action')).toBeFocused();
  await page.locator('#today-craving-action').click();
  await expect(dialog.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();
  await dialog.getByRole('button', { name: /Take a three-minute pause/ }).click();
  await expect(dialog.locator('[data-craving-time]')).toHaveText('3:00');
  await dialog.getByRole('button', { name: 'Choose an outcome now' }).click();
  await expect(dialog.getByRole('heading', { name: 'Choose the outcome that fits' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'I resisted it' })).not.toBeChecked();
});

test('a fresh flow resets every control while a canonical close and reopen retains its draft', async ({ page }) => {
  await login(page);
  const trigger = page.locator('#today-craving-action');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Take the next useful step' });
  await dialog.getByLabel('4', { exact: true }).check();
  await dialog.getByLabel(/What set it off/).fill('temporary draft');
  await dialog.getByRole('button', { name: 'Keep tracking without saving' }).click();

  await trigger.click();
  await expect(dialog.locator('[name="intensity"]:checked')).toHaveCount(0);
  await expect(dialog.getByLabel(/What set it off/)).toHaveValue('');
  await dialog.getByLabel('7', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Record craving' }).click();
  await dialog.getByRole('button', { name: /Drink some water/ }).click();
  await dialog.getByRole('radio', { name: 'I used an alternative' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByLabel('Duration in minutes').fill('5');
  await dialog.getByText('Restless', { exact: true }).click();
  await dialog.getByLabel('Notes').fill('Retain this draft on close');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog.getByRole('heading', { name: 'Add only what feels useful' })).toBeVisible();
  await expect(dialog.getByLabel('Duration in minutes')).toHaveValue('5');
  await expect(dialog.getByLabel('Notes')).toHaveValue('Retain this draft on close');
  await expect(dialog.locator('[name="physical_symptoms"][value="Restless"]')).toBeChecked();

  await dialog.getByRole('button', { name: 'Save details' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await trigger.click();

  await expect(dialog.getByRole('heading', { name: 'How strong is it right now?' })).toBeVisible();
  await expect(dialog.locator('[name="intensity"]:checked')).toHaveCount(0);
  await expect(dialog.locator('[name="outcome"]:checked')).toHaveCount(0);
  await expect(dialog.getByLabel(/What set it off/)).toHaveValue('');
  await expect(dialog.getByLabel('Duration in minutes')).toHaveValue('');
  await expect(dialog.getByLabel('Notes')).toHaveValue('');
  await expect(dialog.locator('[name="physical_symptoms"]:checked')).toHaveCount(0);
  await expect(dialog.locator('[data-craving-details]')).not.toHaveAttribute('open', '');
});

test('non-nicotine outcomes support both detail skip and normalized detail save', async ({ page }) => {
  const patches = [];
  await page.route('**/api/cravings/*', async (route) => {
    if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
    await route.continue();
  });
  await login(page);
  let dialog = await openAndRecordCraving(page, { intensity: 6 });
  await dialog.getByRole('button', { name: /Drink some water/ }).click();
  await dialog.getByRole('radio', { name: 'I resisted it' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await expect(dialog.getByRole('heading', { name: 'Add only what feels useful' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip for now' }).click();
  await expect(dialog.getByRole('heading', { name: 'Your craving is saved' })).toBeVisible();
  await expect(page.locator('[data-timeline-type="craving"][data-client-event-id]').last())
    .toContainText('Resisted');
  await dialog.getByRole('button', { name: 'Done' }).click();

  dialog = await openAndRecordCraving(page, { intensity: 5 });
  await dialog.getByRole('button', { name: /Take a short walk/ }).click();
  await dialog.getByRole('radio', { name: 'I used an alternative' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByLabel('Duration in minutes').fill('3');
  await dialog.getByText('Jaw tension', { exact: true }).click();
  await dialog.getByLabel('Notes').fill('  useful context  ');
  await dialog.getByRole('button', { name: 'Save details' }).click();

  await expect(dialog.getByRole('heading', { name: 'Your craving is saved' })).toBeVisible();
  await expect(page.locator('[data-timeline-type="craving"][data-client-event-id]').last())
    .toContainText('Used an alternative');
  expect(patches[0]).toEqual({ outcome: 'resisted' });
  expect(patches[1]).toEqual({ outcome: 'used_alternative' });
  expect(patches[2]).toEqual(expect.objectContaining({
    duration_minutes: 3,
    physical_symptoms: ['Jaw tense'],
    notes: 'useful context',
  }));
  expect(patches[2]).not.toHaveProperty('outcome');
});

test('optional details send only touched fields and preserve explicit clears', async ({ page }) => {
  const patches = [];
  await page.route('**/api/cravings/*', async (route) => {
    if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
    await route.continue();
  });
  await login(page);
  let dialog = await openAndRecordCraving(page, { intensity: 6 });
  await dialog.getByRole('button', { name: /Drink some water/ }).click();
  await dialog.getByRole('radio', { name: 'I used an alternative' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByLabel('Duration in minutes').fill('3');
  await dialog.getByRole('button', { name: 'Save details' }).click();

  expect(patches[1]).toEqual({ duration_minutes: 3 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  dialog = await openAndRecordCraving(page, { intensity: 5 });
  await dialog.getByRole('button', { name: /Take a short walk/ }).click();
  await dialog.getByRole('radio', { name: 'I resisted it' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByLabel('Notes').fill('temporary');
  await dialog.getByLabel('Notes').fill('');
  await dialog.getByText('Restless', { exact: true }).click();
  await dialog.getByText('Restless', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Save details' }).click();

  expect(patches[3]).toEqual({ notes: null, physical_symptoms: [] });
});

test('outcome and detail recovery copy survives close and the same-payload Retry succeeds', async ({ page }) => {
  let patchAttempt = 0;
  await page.route('**/api/cravings/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patchAttempt += 1;
    if (patchAttempt === 1 || patchAttempt === 3) {
      const message = patchAttempt === 1
        ? 'The outcome was not saved yet. Your choice is still here.'
        : 'The optional details were not saved yet. They are still here.';
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal_error', message, field_errors: {}, retryable: true },
        }),
      });
    }
    return route.continue();
  });
  await login(page);
  await expect(page.locator('[data-craving-action-slot]'))
    .toHaveAttribute('data-controller-ready', 'true');
  const trigger = page.locator('#today-craving-action');
  const dialog = await openAndRecordCraving(page, { intensity: 7 });
  await dialog.getByRole('button', { name: /Drink some water/ }).click();
  await dialog.getByRole('radio', { name: 'I resisted it' }).check();
  await dialog.getByRole('button', { name: 'Save outcome' }).click();
  await expect(dialog.getByText('The outcome was not saved yet. Your choice is still here.'))
    .toBeVisible();

  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByText('The outcome was not saved yet. Your choice is still here.'))
    .toBeVisible();
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('heading', { name: 'Add only what feels useful' })).toBeVisible();
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByLabel('Duration in minutes').fill('4');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog.getByText('The optional details were not saved yet. They are still here.'))
    .toBeVisible();

  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByText('The optional details were not saved yet. They are still here.'))
    .toBeVisible();
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('heading', { name: 'Your craving is saved' })).toBeVisible();
});

test('used nicotine creates one linked Quick Log and Undo clears only that link', async ({ page }) => {
  const logPayloads = [];
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() === 'POST') logPayloads.push(route.request().postDataJSON());
    await route.continue();
  });
  await login(page);
  await page.waitForLoadState('load');
  const initialLogCount = await page.locator('[data-timeline-type="log"]').count();
  const initialCravingCount = await page.locator('[data-timeline-type="craving"]').count();
  const cravingDialog = await openAndRecordCraving(page, { intensity: 9 });
  await cravingDialog.getByRole('button', { name: /Change rooms/ }).click();
  await cravingDialog.getByRole('radio', { name: 'I used nicotine' }).check();
  await cravingDialog.getByRole('button', { name: 'Save outcome' }).click();
  await cravingDialog.getByRole('button', { name: 'Skip for now' }).click();

  await expect(cravingDialog).toBeHidden();
  const quickLogDialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(quickLogDialog).toBeVisible();
  await quickLogDialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(quickLogDialog).toBeHidden();
  expect(logPayloads).toHaveLength(1);
  expect(logPayloads[0].craving_id).toBeGreaterThan(0);
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount + 1);
  await expect(page.locator('[data-timeline-type="craving"]')).toHaveCount(initialCravingCount + 1);
  const cravingRow = page.locator(
    `[data-timeline-type="craving"][data-timeline-id="${logPayloads[0].craving_id}"]`,
  );
  await expect(cravingRow).toContainText('Used nicotine');
  await expect(cravingRow).toHaveAttribute('data-linked-log-id', /\d+/);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount);
  await expect(cravingRow).toHaveCount(1);
  await expect(cravingRow).toContainText('Used nicotine');
  await expect(cravingRow).not.toHaveAttribute('data-linked-log-id', /\d+/);
});

test('narrow light and dark themes keep 200% text, reduced motion, and private trigger text safe', async ({ page }, testInfo) => {
  const theme = testInfo.project.name.includes('mobile') ? 'dark' : 'light';
  await page.addInitScript((savedTheme) => {
    localStorage.setItem('nicotine-tracker-theme', savedTheme);
  }, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  const problems = watchForProductProblems(page);
  await login(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const privateTrigger = 'private craving trigger must stay out of storage';
  const dialog = await openAndRecordCraving(page, { intensity: 7, trigger: privateTrigger });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(dialog.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const transitionSeconds = getComputedStyle(element).transitionDuration
        .split(',')
        .map((value) => parseFloat(value) * (value.includes('ms') ? 0.001 : 1));
      return {
        dialogClientWidth: element.clientWidth,
        dialogScrollWidth: element.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        maxTransitionSeconds: Math.max(...transitionSeconds),
      };
    });
    expect(layout.dialogScrollWidth).toBeLessThanOrEqual(layout.dialogClientWidth + 1);
    expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth + 1);
    expect(layout.left).toBeGreaterThanOrEqual(-1);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.bottom).toBeGreaterThanOrEqual(layout.viewportHeight - 1);
    expect(layout.maxTransitionSeconds).toBeLessThanOrEqual(0.001);
  }

  for (const control of [
    dialog.getByRole('button', { name: 'Close craving support' }),
    dialog.getByRole('button', { name: /Take a three-minute pause/ }),
  ]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const persisted = await page.evaluate(async (needle) => {
    const storageValues = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
    ];
    const databases = await indexedDB.databases();
    let records = [];
    if (databases.some((database) => database.name === 'nicotine-tracker')) {
      records = await new Promise((resolve, reject) => {
        const request = indexedDB.open('nicotine-tracker');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('pending_events')) {
            database.close();
            resolve([]);
            return;
          }
          const transaction = database.transaction('pending_events', 'readonly');
          const all = transaction.objectStore('pending_events').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            database.close();
            resolve(all.result);
          };
        };
      });
    }
    return {
      storageContainsNeedle: storageValues.some((value) => String(value).includes(needle)),
      queueContainsNeedle: JSON.stringify(records).includes(needle),
    };
  }, privateTrigger);
  expect(persisted).toEqual({ storageContainsNeedle: false, queueContainsNeedle: false });
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);
});

test('linked Quick Log retry and offline replay preserve both identities and one linked row', async ({ page, context }) => {
  const logPayloads = [];
  let attempts = 0;
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts += 1;
    logPayloads.push(route.request().postDataJSON());
    if (attempts === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error', message: 'Try later.',
            field_errors: {}, retryable: true,
          },
        }),
      });
    }
    return route.continue();
  });
  await login(page);
  await page.waitForLoadState('load');
  const initialLogCount = await page.locator('[data-timeline-type="log"]').count();
  const initialCravingCount = await page.locator('[data-timeline-type="craving"]').count();
  const cravingDialog = await openAndRecordCraving(page, { intensity: 8 });
  await cravingDialog.getByRole('button', { name: /Drink some water/ }).click();
  await cravingDialog.getByRole('radio', { name: 'I used nicotine' }).check();
  await cravingDialog.getByRole('button', { name: 'Save outcome' }).click();
  await cravingDialog.getByRole('button', { name: 'Skip for now' }).click();

  const quickLogDialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(quickLogDialog).toBeVisible();
  await quickLogDialog.getByRole('button', { name: 'Log one pouch' }).click();
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(1);
  const queued = (await pendingEvents(page))[0];
  expect(queued.craving_id).toBe(logPayloads[0].craving_id);
  expect(queued.client_event_id).toBe(logPayloads[0].client_event_id);

  await context.setOffline(true);
  await context.setOffline(false);

  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);
  expect(logPayloads).toHaveLength(2);
  expect(logPayloads[1].client_event_id).toBe(logPayloads[0].client_event_id);
  expect(logPayloads[1].craving_id).toBe(logPayloads[0].craving_id);
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount + 1);
  await expect(page.locator('[data-timeline-type="craving"]')).toHaveCount(initialCravingCount + 1);
  const linkedRow = page.locator(
    `[data-timeline-type="craving"][data-timeline-id="${logPayloads[0].craving_id}"]`,
  );
  await expect(linkedRow).toHaveCount(1);
  await expect(linkedRow).toContainText('Used nicotine');
  await expect(linkedRow).toHaveAttribute('data-linked-log-id', /\d+/);
});
