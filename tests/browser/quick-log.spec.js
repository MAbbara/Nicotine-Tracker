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

async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}

function quickLogTrigger(page) {
  return page.locator('#today-log-action');
}

test('Quick Log fallback remains usable while enhancement is delayed', async ({ page }) => {
  await page.route('**/static/js/today/quick_log.js', async (route) => {
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    await route.continue();
  });
  await login(page, 'today-targeted@example.com');
  const slot = page.locator('[data-log-action-slot]');

  // Before the delayed module activates the controller, the enhanced
  // control must stay hidden and the slot must not claim readiness.
  await expect(slot).not.toHaveAttribute('data-controller-ready', 'true');
  await expect(slot.locator('[data-action-enhanced]')).toBeHidden();

  await slot.locator('[data-action-fallback]').click();
  await expect(page).toHaveURL(/\/log\/(?:add|view)/);
});

test('Quick Log enhanced control waits for controller-ready and opens the dialog without navigation', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const slot = page.locator('[data-log-action-slot]');

  await expect(slot).toHaveAttribute('data-controller-ready', 'true');
  const fallback = slot.locator('[data-action-fallback]');
  await expect(fallback).toBeHidden();
  const enhanced = slot.locator('[data-action-enhanced]');
  await expect(enhanced).toBeVisible();

  await enhanced.click();

  await expect(page).toHaveURL(/\/today\/?$/);
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Steady Mint');
  await expect(dialog).toContainText('6.00 mg');
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  const createdLogIds = await page
    .locator('[data-client-event-id][data-timeline-id]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.timelineId));
  if (createdLogIds.length === 0) return;

  const cleanupResults = await page.evaluate(async (logIds) => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    return Promise.all(logIds.map(async (logId) => {
      const response = await fetch(`/api/logs/${logId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': csrfToken },
      });
      return { logId, ok: response.ok, status: response.status };
    }));
  }, createdLogIds);
  expect(cleanupResults).toEqual(createdLogIds.map((logId) => ({
    logId, ok: true, status: 200,
  })));
});

test('targeted Today logs the smart default in the ordinary two taps', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.waitForLoadState('load');
  const existingLogs = page.locator('[data-timeline-type="log"]');
  const initialLogCount = await existingLogs.count();
  expect(initialLogCount).toBeGreaterThan(0);

  await quickLogTrigger(page).click();

  await expect(page).toHaveURL(/\/today\/?$/);
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Steady Mint');
  await expect(dialog).toContainText('6.00 mg');

  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount + 1);
  await expect(page.locator('[data-timeline-type="log"]').last()).toContainText('Steady Mint');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  await quickLogTrigger(page).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/today\/?$/);
});

test('the same dialog adapts to a mobile bottom sheet and desktop right panel', async ({ page }, testInfo) => {
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(dialog).toBeVisible();

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      radius: parseFloat(style.borderTopLeftRadius),
    };
  });

  if (testInfo.project.name.includes('mobile')) {
    expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
    expect(geometry.left).toBeLessThanOrEqual(1);
    expect(geometry.right).toBeGreaterThanOrEqual(geometry.viewportWidth - 1);
    expect(geometry.height).toBeLessThan(geometry.viewportHeight);
  } else {
    expect(geometry.right).toBeGreaterThanOrEqual(geometry.viewportWidth - 1);
    expect(geometry.top).toBeLessThanOrEqual(1);
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
    expect(geometry.width).toBeLessThan(geometry.viewportWidth * 0.6);
  }
  expect(geometry.radius).toBeGreaterThanOrEqual(20);
});

test('Today without a smart default keeps the detailed logging link fallback', async ({ page }) => {
  await login(page, 'browser@example.com');

  await quickLogTrigger(page).click();

  await expect(page).toHaveURL(/\/log\/view\?open_add_modal=1$/);
  await expect(page.getByRole('heading', { name: 'Logbook', level: 1 })).toBeVisible();
});

test('focus enters the native dialog and Escape returns it to the trigger', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const trigger = quickLogTrigger(page);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  const confirm = dialog.getByRole('button', { name: 'Log one pouch' });

  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('advanced saved-pouch choices preserve the default and exclude foreign custom rows', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });

  await dialog.getByText('Change details', { exact: true }).click();
  const select = dialog.getByLabel('Saved pouch');
  await expect(select.locator('option')).toContainText([
    /Steady Mint/,
    /Targeted Own/,
  ]);
  await expect(select).not.toContainText(/Other User Custom/);
  await expect(select).toHaveValue(/\d+/);
  await expect(dialog.getByLabel('Quantity')).toHaveValue('1');
  await expect(dialog.getByLabel('Local date and time')).not.toHaveValue('');
});

test('an optimistic Syncing row becomes one canonical timeline entry', async ({ page }) => {
  let releasePost;
  const postGate = new Promise((resolve) => { releasePost = resolve; });
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() === 'POST') await postGate;
    await route.continue();
  });
  await login(page, 'today-targeted@example.com');
  await page.waitForLoadState('load');
  const initialLogCount = await page.locator('[data-timeline-type="log"]').count();
  await quickLogTrigger(page).click();

  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();

  const pending = page.locator('[data-timeline-state="pending"]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('Syncing');
  releasePost();
  await expect(page.getByRole('dialog', { name: 'Log nicotine use' })).toBeHidden();
  await expect(pending).toHaveCount(0);
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount + 1);
});

test('retryable POST waits for connection, and Retry reuses the event ID', async ({ page }) => {
  const payloads = [];
  let postCount = 0;
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    payloads.push(route.request().postDataJSON());
    if (postCount === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'Could not save this log. Try again.',
            field_errors: {},
            retryable: true,
          },
        }),
      });
    }
    return route.continue();
  });
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });

  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Discard draft' })).toBeVisible();
  await expect(page.locator('[data-timeline-state="queued"]')).toContainText('Waiting for connection');
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog).toBeHidden();
  expect(payloads).toHaveLength(2);
  expect(payloads[1].client_event_id).toBe(payloads[0].client_event_id);
  expect(payloads[1]).toEqual(payloads[0]);
  await expect(page.locator(`[data-client-event-id="${payloads[0].client_event_id}"]`)).toHaveCount(1);
});

test('queued recovery visibly discloses omitted notes while a blank note stays concise', async ({ page }) => {
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'internal_error',
          message: 'Could not save this log. Try again.',
          field_errors: {},
          retryable: true,
        },
      }),
    });
  });
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  const recoveryCopy = dialog.locator('[data-quick-log-request-error]');
  const confirm = dialog.getByRole('button', { name: 'Log one pouch' });
  const privateNote = 'This note must stay out of IndexedDB';

  await dialog.getByText('Change details', { exact: true }).click();
  await dialog.getByLabel(/Notes/).evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
  }, privateNote);
  await confirm.click();

  await expect(recoveryCopy).toBeVisible();
  await expect(dialog.getByLabel(/Notes/)).toHaveValue(privateNote);
  await expect(recoveryCopy).toHaveText(
    'Waiting for connection. Saved for sync without notes. Notes stay only on this screen.',
  );
  await dialog.getByRole('button', { name: 'Discard draft' }).click();
  await expect(dialog).toBeHidden();

  await quickLogTrigger(page).click();
  await confirm.click();

  await expect(recoveryCopy).toBeVisible();
  await expect(recoveryCopy).toHaveText('Waiting for connection.');
  await expect(recoveryCopy).not.toContainText('Saved for sync without notes');
  await dialog.getByRole('button', { name: 'Discard draft' }).click();
});

test('editing a failed draft clears recovery and restores the confirm action', async ({ page }) => {
  let postCount = 0;
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    if (postCount === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error', message: 'Could not save this log. Try again.',
            field_errors: {}, retryable: true,
          },
        }),
      });
    }
    return route.continue();
  });
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();

  await dialog.getByText('Change details', { exact: true }).click();
  const notes = dialog.getByLabel(/Notes/);
  await notes.fill('Edited after the failure');
  await notes.blur();

  await expect(dialog.locator('[data-quick-log-request-error]')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeHidden();
  const confirm = dialog.getByRole('button', { name: 'Log one pouch' });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(postCount).toBe(2);
});

test('a cleared local time shows field recovery and one safely rendered failed row', async ({ page }) => {
  const postRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/logs$/.test(request.url())) {
      postRequests.push(request.url());
    }
  });
  await login(page, 'today-targeted@example.com');
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await dialog.getByText('Change details', { exact: true }).click();
  const occurredAt = dialog.getByLabel('Local date and time');
  await occurredAt.fill('');
  await occurredAt.blur();

  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-quick-log-error="occurredAtLocal"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  const failedRow = page.locator('[data-timeline-state="failed"]');
  await expect(failedRow).toHaveCount(1);
  await expect(failedRow).toContainText('Not synced');
  await expect(failedRow.getByText('Check time')).toBeVisible();
  expect(postRequests).toEqual([]);
});

test('Undo removes the canonical entry without a confirmation dialog', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.waitForLoadState('load');
  const logs = page.locator('[data-timeline-type="log"]');
  const initialLogCount = await logs.count();
  await quickLogTrigger(page).click();
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();
  await expect(logs).toHaveCount(initialLogCount + 1);

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(logs).toHaveCount(initialLogCount);
  await expect(page.locator('[data-quick-log-undo]')).toBeHidden();
  await expect(page.locator('[data-quick-log-live]')).toHaveText('Log removed');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed DELETE restores the confirmed entry after optimistic removal', async ({ page }) => {
  let releaseDelete;
  const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
  await page.route('**/api/logs/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await deleteGate;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'internal_error', message: 'Server detail that must stay private.',
          field_errors: {}, retryable: true,
        },
      }),
    });
  });
  await login(page, 'today-targeted@example.com');
  await page.waitForLoadState('load');
  const logs = page.locator('[data-timeline-type="log"]');
  const initialLogCount = await logs.count();
  await quickLogTrigger(page).click();
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();
  await expect(logs).toHaveCount(initialLogCount + 1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(logs).toHaveCount(initialLogCount);
  releaseDelete();

  await expect(logs).toHaveCount(initialLogCount + 1);
  await expect(page.locator('[data-quick-log-live]')).toContainText(/still saved.*try.*later/i);
  await expect(page.locator('[data-quick-log-live]')).not.toContainText(/Server detail/);
});

test('narrow themes support 200% text, touch targets, and reduced motion without overflow', async ({ page }, testInfo) => {
  const theme = testInfo.project.name.includes('mobile') ? 'dark' : 'light';
  await page.addInitScript((savedTheme) => {
    localStorage.setItem('nicotine-tracker-theme', savedTheme);
  }, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  const problems = watchForProductProblems(page);
  await login(page, 'today-targeted@example.com');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await quickLogTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

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
    dialog.getByRole('button', { name: 'Close quick log' }),
    dialog.getByRole('button', { name: 'Log one pouch' }),
    dialog.getByText('Change details', { exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(problems.errors).toEqual([]);
  expect(problems.forbiddenRequests).toEqual([]);
});

test('the first pending log replaces the empty state and Undo restores it', async ({ page }) => {
  await login(page, 'today-empty-smart@example.com');
  const empty = page.locator('[data-today-empty="logs"]');
  await expect(empty).toBeVisible();
  await quickLogTrigger(page).click();

  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();

  await expect(empty).toHaveCount(0);
  await expect(page.locator('[data-today-timeline] > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-today-timeline]')).toHaveCount(0);
  await expect(page.locator('[data-today-empty="logs"]')).toBeVisible();
  await expect(page.locator('[data-today-empty="logs"]')).toContainText(/first log.*timing/i);
});
