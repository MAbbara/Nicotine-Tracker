const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function prepare(page) {
  const clock = await page.request.get('/__test__/release-clock');
  await page.clock.install({ time: new Date((await clock.json()).fixed_now) });
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('today-targeted@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('nicotine-offline-context-v1');
    return Boolean(await cache.match('/api/offline-context'));
  })).toBe(true);
}

test('home-screen URL reopens offline, queues a log and syncs once online', async ({ page, context }) => {
  await prepare(page);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today, offline' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Number of pouches').fill('2');
  await page.getByRole('button', { name: 'Save log on this device' }).click();
  await expect(page.locator('#offline-pending')).toContainText('2 pouches');
  await page.reload();
  await expect(page.locator('#offline-pending li')).toHaveCount(1);
  await expect(page.locator('#offline-pending')).toContainText('2 pouches');
  const replay = page.waitForResponse((response) => response.url().endsWith('/api/logs') && response.request().method() === 'POST');
  await context.setOffline(false);
  // Chromium's emulated offline navigation can retain onLine=true; deliver the reconnect event explicitly.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const replayResponse = await replay;
  expect(replayResponse.status()).toBe(201);
  const savedLogId = (await replayResponse.json()).log.id;
  await expect(page).toHaveURL(/\/today\/?$/);
  await expect.poll(() => page.evaluate(async () => {
    const { getOfflineQueueRuntime } = await import('/static/js/today/offline_queue.js');
    return (await getOfflineQueueRuntime().list()).length;
  })).toBe(0);
  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const deleted = await page.request.delete(`/api/logs/${savedLogId}`, { headers: { 'X-CSRFToken': csrf } });
  expect(deleted.ok()).toBe(true);
});

test('logout removes private offline choices even without Clear-Site-Data support', async ({ page, context }) => {
  await prepare(page);
  await page.goto('/auth/logout');
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('nicotine-offline-context-v1');
    return Boolean(await cache.match('/api/offline-context'));
  })).toBe(false);
  // Reinstall public shell if this browser honored Clear-Site-Data.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.locator('#offline-status')).toContainText('Connect and open Today once');
  await expect(page.locator('#offline-log')).toBeHidden();
});


test('offline logout clears choices and finishes server logout on reconnect', async ({ page, context }) => {
  await prepare(page);
  await context.setOffline(true);
  await page.goto('/auth/logout');
  await expect(page.locator('#offline-status')).toContainText('Local offline data cleared');
  await expect(page.locator('#offline-log')).toBeHidden();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect((await page.request.get('/api/offline-context')).status()).toBe(401);
});
