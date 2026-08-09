import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:5051';
const url = `${origin}/output/prototypes/journey-compact/`;
let server;
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Prototype server did not start');
}

before(async () => {
  server = spawn(
    'python3',
    ['-m', 'http.server', '5051', '--bind', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore' },
  );
  await waitForServer();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('compact Journey exposes the exact at-a-glance hierarchy', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await assert.doesNotReject(() => page.getByRole('heading', {
    name: 'Your nicotine plan',
  }).waitFor());
  await assert.equal(await page.locator('[data-journey-prototype]').count(), 1);
  await assert.equal(await page.locator('[data-logged-mg]').textContent(), '37.25 mg');
  await assert.equal(await page.locator('[data-ceiling-mg]').textContent(), '33.19 mg');
  await assert.equal(await page.locator('[data-difference-mg]').textContent(), '+4.06 mg');
  await assert.match(
    await page.locator('[data-plan-status]').textContent(),
    /Above today’s ceiling/,
  );
  await assert.match(
    await page.locator('[data-next-change]').textContent(),
    /32\.62 mg tomorrow/,
  );
  await assert.equal(await page.locator('[data-trajectory] [data-day]').count(), 7);
  await assert.equal(
    await page.locator('[data-day-detail]').textContent(),
    'Today · 33.19 mg ceiling',
  );
  await assert.equal(await page.locator('[data-theme-toggle]').count(), 1);
  await assert.equal(await page.locator('[data-state-toggle]').count(), 1);
  await assert.equal(await page.getByRole('row').count(), 8);
  await page.close();
});
