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

test('typography remains compact and responsive', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  const primary = page.locator('[data-logged-mg]');
  const typography = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: Number.parseFloat(style.fontSize) };
  });
  assert.ok(typography.size <= 64, `primary metric was ${typography.size}px`);
  assert.match(typography.family, /Newsreader/);

  const nextBox = await page.locator('[data-next-change]').boundingBox();
  const trajectoryBox = await page.locator('[data-trajectory]').boundingBox();
  assert.ok(nextBox && nextBox.y < 900, 'next change was outside the first viewport');
  assert.ok(trajectoryBox && trajectoryBox.y < 900, 'trajectory was outside the first viewport');

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  await page.close();
});

test('light and dark themes retain usable trajectory controls', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  await page.goto(url);

  for (const theme of ['light', 'dark']) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;
    }, theme);
    assert.equal(
      await page.locator('html').getAttribute('data-theme'),
      theme,
    );
    const colors = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      surface: getComputedStyle(document.querySelector('[data-journey-prototype]')).backgroundColor,
    }));
    assert.notEqual(colors.body, 'rgba(0, 0, 0, 0)');
    assert.notEqual(colors.surface, 'rgba(0, 0, 0, 0)');

    const days = page.locator('[data-day]');
    for (let index = 0; index < await days.count(); index += 1) {
      const box = await days.nth(index).boundingBox();
      assert.ok(box && box.width >= 44, `${theme} day ${index + 1} was ${box?.width}px wide`);
      assert.ok(box && box.height >= 44, `${theme} day ${index + 1} was ${box?.height}px high`);
    }

    await days.first().focus();
    const focus = await days.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    assert.notEqual(focus.style, 'none');
    assert.ok(focus.width >= 2, `${theme} focus outline was ${focus.width}px`);
  }

  await page.close();
});
