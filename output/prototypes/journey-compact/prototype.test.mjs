import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:5051';
const url = `${origin}/output/prototypes/journey-compact/`;
const environments = [
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' },
  { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'no-preference' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'no-preference' },
  { name: 'narrow-dark-reduced', viewport: { width: 320, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' },
];
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

test('day selection is latest, stable, and keyboard operable', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url);
  const assertSinglePressed = async (expected) => {
    const selected = page.locator('[data-day][aria-pressed="true"]');
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.first().getAttribute('data-date'), expected);
  };
  const detail = page.locator('[data-day-detail]');
  const before = await detail.boundingBox();
  await assertSinglePressed('Today');

  const tuesday = page.getByRole('button', { name: /Tuesday.*32\.06 mg/ });
  await tuesday.focus();
  await page.keyboard.press('Enter');
  assert.equal(await tuesday.getAttribute('aria-pressed'), 'true');
  await assertSinglePressed('Tuesday');
  assert.equal(
    await page.getByRole('button', { name: /Today.*33\.19 mg/ }).getAttribute('aria-pressed'),
    'false',
  );
  assert.match(await detail.textContent(), /Tuesday.*32\.06 mg.*0\.56 mg lower/);
  const after = await detail.boundingBox();
  assert.ok(before && after && Math.abs(before.height - after.height) <= 1);
  await page.keyboard.press('ArrowRight');
  await assert.doesNotReject(() => page.getByRole('button', { name: /Wednesday/ }).evaluate((element) => {
    if (element !== document.activeElement) throw new Error('focus did not move');
  }));
  await page.keyboard.press('ArrowLeft');
  await assert.doesNotReject(() => tuesday.evaluate((element) => {
    if (element !== document.activeElement) throw new Error('focus did not move left');
  }));
  await assertSinglePressed('Tuesday');

  const today = page.getByRole('button', { name: /Today.*33\.19 mg/ });
  const saturday = page.getByRole('button', { name: /Saturday.*29\.81 mg/ });
  await today.focus();
  await page.keyboard.press('ArrowLeft');
  await assert.doesNotReject(() => saturday.evaluate((element) => {
    if (element !== document.activeElement) throw new Error('left boundary did not wrap');
  }));
  await assertSinglePressed('Tuesday');

  await page.keyboard.press('ArrowRight');
  await assert.doesNotReject(() => today.evaluate((element) => {
    if (element !== document.activeElement) throw new Error('right boundary did not wrap');
  }));
  await assertSinglePressed('Tuesday');

  await page.keyboard.press('Space');
  assert.equal(await today.getAttribute('aria-pressed'), 'true');
  await assertSinglePressed('Today');
  assert.match(await detail.textContent(), /Today.*33\.19 mg.*Current ceiling/);
  await page.close();
});

test('theme and completeness controls restore exact fixture values', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url);

  const themeToggle = page.locator('[data-theme-toggle]');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await themeToggle.click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await themeToggle.click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

  const stateToggle = page.locator('[data-state-toggle]');
  await stateToggle.click();
  assert.equal(
    await page.locator('[data-logged-mg]').evaluate((element) => element.previousElementSibling.textContent),
    'Known nicotine',
  );
  assert.equal(await page.locator('[data-logged-mg]').textContent(), '31.25 mg');
  assert.equal(await page.locator('[data-difference-mg]').textContent(), 'Total incomplete');
  assert.doesNotMatch(await page.locator('[data-difference-mg]').textContent(), /^[+-]/);
  assert.match(await page.locator('[data-plan-status]').textContent(), /Nicotine total incomplete/);
  assert.equal(
    await page.locator('[data-plan-status] [aria-hidden="true"]').textContent(),
    '■',
  );

  await stateToggle.click();
  assert.equal(
    await page.locator('[data-logged-mg]').evaluate((element) => element.previousElementSibling.textContent),
    'Logged',
  );
  assert.equal(await page.locator('[data-logged-mg]').textContent(), '37.25 mg');
  assert.equal(await page.locator('[data-difference-mg]').textContent(), '+4.06 mg');
  assert.match(await page.locator('[data-plan-status]').textContent(), /Above today’s ceiling/);
  assert.equal(
    await page.locator('[data-plan-status] [aria-hidden="true"]').textContent(),
    '●',
  );

  const disclosures = page.locator('details > summary');
  assert.equal(await disclosures.count(), 2);
  for (let index = 0; index < await disclosures.count(); index += 1) {
    await disclosures.nth(index).focus();
    assert.equal(
      await disclosures.nth(index).evaluate((element) => element === document.activeElement),
      true,
    );
  }
  await page.close();
});

test('day detail reserves stable space at 320px and 200% text', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  await page.goto(url);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const detail = page.locator('[data-day-detail]');
  const before = await detail.boundingBox();
  await page.getByRole('button', { name: /Saturday.*29\.81 mg/ }).click();
  const after = await detail.boundingBox();
  assert.ok(before && after && Math.abs(before.height - after.height) <= 1);
  assert.equal(await detail.evaluate((element) => element.scrollHeight <= element.clientHeight), true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  await page.close();
});

for (const environment of environments) {
  test(`release matrix: ${environment.name}`, async () => {
    const consoleErrors = [];
    const failedRequests = [];
    const page = await browser.newPage({
      viewport: environment.viewport,
      colorScheme: environment.colorScheme,
      reducedMotion: environment.reducedMotion,
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    });

    try {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      if (environment.name === 'narrow-dark-reduced') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
      }

      assert.equal(await page.locator('[data-logged-mg]').textContent(), '37.25 mg');
      assert.equal(await page.locator('[data-ceiling-mg]').textContent(), '33.19 mg');
      assert.equal(await page.locator('[data-difference-mg]').textContent(), '+4.06 mg');
      await assert.doesNotReject(() => page.locator('[data-plan-status]').evaluate((element) => {
        if (!element.textContent.includes('Above today’s ceiling')) throw new Error('status text changed');
        if (!element.checkVisibility()) throw new Error('status is not visible');
      }));

      const themeToggle = page.locator('[data-theme-toggle]');
      const targetTheme = environment.colorScheme;
      if (await page.locator('html').getAttribute('data-theme') !== targetTheme) {
        await themeToggle.click();
      }
      assert.equal(await page.locator('html').getAttribute('data-theme'), targetTheme);
      await themeToggle.click();
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), targetTheme);
      await themeToggle.click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), targetTheme);

      const days = page.locator('[data-day]');
      assert.equal(await days.count(), 7);
      for (let index = 0; index < await days.count(); index += 1) {
        const day = days.nth(index);
        await day.scrollIntoViewIfNeeded();
        const box = await day.boundingBox();
        assert.equal(await day.isVisible(), true);
        assert.ok(box && box.x >= -1, `${environment.name} day ${index + 1} crossed the left edge`);
        assert.ok(
          box && box.x + box.width <= environment.viewport.width + 1,
          `${environment.name} day ${index + 1} crossed the right edge`,
        );
        assert.ok(box && box.y >= -1, `${environment.name} day ${index + 1} crossed the top edge`);
        assert.ok(
          box && box.y + box.height <= environment.viewport.height + 1,
          `${environment.name} day ${index + 1} crossed the bottom edge`,
        );
      }

      await days.first().scrollIntoViewIfNeeded();
      await days.first().focus();
      await page.keyboard.press('ArrowRight');
      const focusedDay = days.nth(1);
      const focus = await focusedDay.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          active: element === document.activeElement,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
        };
      });
      assert.equal(focus.active, true);
      assert.notEqual(focus.outlineStyle, 'none');
      assert.ok(focus.outlineWidth >= 2);

      if (environment.name === 'narrow-dark-reduced') {
        const maxMotionDuration = await page.evaluate(() => {
          const toMilliseconds = (duration) => duration.endsWith('ms')
            ? Number.parseFloat(duration)
            : Number.parseFloat(duration) * 1000;
          return Math.max(...[...document.querySelectorAll('*')].flatMap((element) => {
            const style = getComputedStyle(element);
            return [...style.animationDuration.split(','), ...style.transitionDuration.split(',')]
              .map((duration) => toMilliseconds(duration.trim()));
          }));
        });
        assert.ok(maxMotionDuration <= .001, `motion duration was ${maxMotionDuration}ms`);

        for (let index = 0; index < await days.count(); index += 1) {
          await days.nth(index).click();
          assert.equal(await page.locator('[data-day][aria-pressed="true"]').count(), 1);
          assert.equal(
            await page.locator('[data-day][aria-pressed="true"]').getAttribute('data-date'),
            await days.nth(index).getAttribute('data-date'),
          );
        }

        const disclosures = page.locator('details > summary');
        assert.equal(await disclosures.count(), 2);
        for (let index = 0; index < await disclosures.count(); index += 1) {
          await disclosures.nth(index).click();
          assert.equal(await disclosures.nth(index).locator('..').getAttribute('open'), '');
        }
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${environment.name} horizontal overflow ${overflow}px`);
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(failedRequests, []);
    } finally {
      await page.close();
    }
  });
}
