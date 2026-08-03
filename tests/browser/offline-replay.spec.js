const { test, expect } = require('@playwright/test');
const {
  OWNER_TITLES,
  createBehaviorRecorder,
} = require('./helpers/core_behavior_contract');

async function login(page, email = 'today-targeted@example.com') {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
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

test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await page.unrouteAll({ behavior: 'wait' });
  if (!/\/today\/?$/.test(page.url())) return;
  const ids = await page.locator('[data-client-event-id][data-timeline-id]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.timelineId));
  if (!ids.length) return;
  await page.evaluate(async (logIds) => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    await Promise.all(logIds.map((id) => fetch(`/api/logs/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': csrfToken },
    })));
  }, ids);
});

test('IndexedDB removal reports whether the exact compound key existed', async ({ page }) => {
  await page.goto('/auth/login');
  const result = await page.evaluate(async () => {
    const { createIndexedDbStore } = await import('/static/js/today/offline_queue.js');
    const store = createIndexedDbStore(indexedDB);
    const offlineQueueId = 'adapter-removal-test-scope';
    const clientEventId = '00000000-0000-4000-8000-000000000099';
    const missingBefore = await store.remove(offlineQueueId, clientEventId);
    await store.put({
      offline_queue_id: offlineQueueId,
      client_event_id: clientEventId,
      pouch_id: 7,
      quantity: 1,
      occurred_at_local: '2026-07-31T09:15:00+03:00',
      timezone: 'Asia/Riyadh',
      craving_id: null,
      queue_order: 1,
    });
    const existing = await store.remove(offlineQueueId, clientEventId);
    const missingAfter = await store.remove(offlineQueueId, clientEventId);
    return { missingBefore, existing, missingAfter };
  });

  expect(result).toEqual({
    missingBefore: false,
    existing: true,
    missingAfter: false,
  });
});

test('real IndexedDB queues a private structured log offline and reconciles it once online', async ({ page, context }) => {
  await login(page);
  const initialCount = await page.locator('[data-timeline-type="log"]').count();
  await page.locator('#today-log-action').click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await dialog.getByText('Change details', { exact: true }).click();
  await dialog.getByLabel(/Notes/).fill('Private note that must not enter IndexedDB');

  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(page.locator('[data-timeline-state="queued"]')).toHaveCount(1);
  await expect(dialog).toContainText('Waiting for connection');
  await expect(dialog).toContainText('Saved for sync without notes. Notes stay only on this screen.');
  const stored = await pendingEvents(page);
  expect(stored).toHaveLength(1);
  expect(Object.keys(stored[0]).sort()).toEqual([
    'client_event_id',
    'craving_id',
    'occurred_at_local',
    'offline_queue_id',
    'pouch_id',
    'quantity',
    'queue_order',
    'timezone',
  ]);
  expect(stored[0]).not.toHaveProperty('notes');

  await context.setOffline(false);
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);
  await expect(page.locator('[data-timeline-state="queued"]')).toHaveCount(0);
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialCount + 1);
  await expect(page.locator('[data-quick-log-live]')).toContainText('Saved after reconnecting');

  const browserStorage = await page.evaluate(async () => ({
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    cacheNames: await caches.keys(),
  }));
  expect(browserStorage).toEqual({ serviceWorkers: 0, cacheNames: [] });
});

test('a response lost after commit replays the same UUID into one canonical row', async ({ page, context }) => {
  const payloads = [];
  let postCount = 0;
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    payloads.push(route.request().postDataJSON());
    if (postCount === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  await login(page);
  const initialCount = await page.locator('[data-timeline-type="log"]').count();
  await page.locator('#today-log-action').click();
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();

  await expect(page.locator('[data-timeline-state="queued"]')).toHaveCount(1);
  await context.setOffline(true);
  await context.setOffline(false);

  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialCount + 1);
  expect(payloads).toHaveLength(2);
  expect(payloads[1].client_event_id).toBe(payloads[0].client_event_id);
  await expect(page.locator(`[data-client-event-id="${payloads[0].client_event_id}"]`)).toHaveCount(1);
});

test('retryable server failure retains one queued record without a replay loop', async ({ page }) => {
  let postCount = 0;
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
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
  });
  await login(page);
  await page.locator('#today-log-action').click();
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();

  await expect(page.locator('[data-timeline-state="queued"]')).toHaveCount(1);
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(1);
  await page.waitForTimeout(150);
  expect(postCount).toBe(1);
});

test('permanent replay validation exposes calm Edit and Discard without looping', async ({ page, context }) => {
  let postCount = 0;
  const postedIds = [];
  await login(page);
  await page.locator('#today-log-action').click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(1);
  const queuedRecord = (await pendingEvents(page))[0];
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    postedIds.push(route.request().postDataJSON().client_event_id);
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'validation_error', message: 'Private validation detail.',
          field_errors: { pouch_id: ['Private detail.'] }, retryable: false,
        },
      }),
    });
  });
  await context.setOffline(false);

  const attention = page.locator('[data-timeline-state="attention"]');
  await expect(attention).toHaveCount(1);
  await expect(attention.getByRole('button', { name: 'Edit saved log' })).toBeVisible();
  await expect(attention.getByRole('button', { name: 'Discard saved log' })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-quick-log-live]')).not.toContainText('Private');
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(150);
  expect(postCount).toBe(1);

  await attention.getByRole('button', { name: 'Edit saved log' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Quantity')).toHaveValue('1');
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/api/logs', async (route) => {
    if (route.request().method() === 'POST') {
      postedIds.push(route.request().postDataJSON().client_event_id);
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();
  await expect(dialog).toBeHidden();
  expect(postedIds.at(-1)).toBe(queuedRecord.client_event_id);
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);
});

test('privacy disable plus reload clears the queue and performs no replay POST', async ({ page, context }) => {
  let postCount = 0;
  await login(page);
  await page.locator('#today-log-action').click();
  await context.setOffline(true);
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(1);

  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'internal_error', message: 'Later.', field_errors: {}, retryable: true },
      }),
    });
  });
  await context.setOffline(false);
  await expect.poll(() => postCount).toBe(1);

  const disabled = await page.evaluate(async () => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await fetch('/settings/privacy/offline-queue', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: JSON.stringify({ enabled: false }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(disabled.status).toBe(200);
  expect(disabled.body.offline_queue.enabled).toBe(false);
  await page.reload();
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);
  await page.waitForTimeout(150);
  expect(postCount).toBe(1);
  await expect(page.locator('meta[name="offline-queue-enabled"]')).toHaveAttribute('content', 'false');

  const reenabled = await page.evaluate(async () => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await fetch('/settings/privacy/offline-queue', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: JSON.stringify({ enabled: true }),
    });
    return response.ok;
  });
  expect(reenabled).toBe(true);
});

test('logout clears queued storage before another account can replay it', async ({ page, context }) => {
  const recorder = createBehaviorRecorder(OWNER_TITLES.signOut, expect);
  let postCount = 0;
  let settledPostCount = 0;
  const postPages = [];
  await login(page);
  await page.locator('#today-log-action').click();
  await context.setOffline(true);
  await page.getByRole('dialog', { name: 'Log nicotine use' })
    .getByRole('button', { name: 'Log one pouch' }).click();
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(1);

  await page.route('**/api/logs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount += 1;
    postPages.push({
      page: new URL(page.url()).pathname,
      eventId: route.request().postDataJSON().client_event_id,
    });
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'internal_error', message: 'Later.', field_errors: {}, retryable: true },
      }),
    });
    settledPostCount += 1;
  });
  await context.setOffline(false);
  await expect.poll(() => postCount).toBeGreaterThan(0);
  await expect.poll(() => settledPostCount).toBeGreaterThan(0);
  const beforeYou = postCount;
  await page.goto('/you/');
  await expect.poll(() => postCount).toBeGreaterThan(beforeYou);
  await expect.poll(() => settledPostCount).toBeGreaterThan(1);
  const beforeLogout = postCount;
  const logoutResponsePending = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/auth/logout'
    && response.request().isNavigationRequest()
  ));
  const signOut = page.getByRole('link', { name: 'Sign out' });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Enter');
  const logoutResponse = await logoutResponsePending;
  expect(logoutResponse.request().method()).toBe('GET');
  expect(logoutResponse.request().postData()).toBeNull();
  expect(logoutResponse.status()).toBe(302);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect.poll(async () => (await pendingEvents(page)).length).toBe(0);

  await login(page, 'browser@example.com');
  await page.waitForTimeout(150);
  expect(postCount, JSON.stringify(postPages)).toBe(beforeLogout);
  recorder.record('you', 'Sign out', ['keyboard', 'persistence', 'request']);
  recorder.assertComplete();
});

test('queued and attention treatments remain focused, touchable, themed, and overflow-safe', async ({ page, context }, testInfo) => {
  const theme = testInfo.project.name.includes('mobile') ? 'dark' : 'light';
  await page.addInitScript((value) => localStorage.setItem('nicotine-tracker-theme', value), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.locator('#today-log-action').click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  const retry = dialog.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeFocused();
  for (const control of [retry, dialog.getByRole('button', { name: 'Discard draft' })]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await page.route('**/api/logs', async (route) => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'validation_error', message: 'Private.', field_errors: {}, retryable: false },
    }),
  }));
  await context.setOffline(false);
  const attention = page.locator('[data-timeline-state="attention"]');
  await expect(attention).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  }

  for (const control of [
    attention.getByRole('button', { name: 'Edit saved log' }),
    attention.getByRole('button', { name: 'Discard saved log' }),
  ]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const treatment = await attention.evaluate((element) => {
    const style = getComputedStyle(element);
    const transitions = style.transitionDuration.split(',').map((value) => (
      parseFloat(value) * (value.includes('ms') ? 0.001 : 1)
    ));
    return {
      background: style.backgroundColor,
      color: style.color,
      maxTransition: Math.max(...transitions),
    };
  });
  expect(treatment.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(treatment.color).not.toBe(treatment.background);
  expect(treatment.maxTransition).toBeLessThanOrEqual(0.001);
});
