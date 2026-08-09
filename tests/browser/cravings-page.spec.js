const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  SUPPORTING_OWNER_TITLES,
  createSupportingBehaviorRecorder,
} = require('./helpers/supporting_behavior_contract');
const { watchForProductProblems } = require('./helpers/product_guard');


function deterministicEmail(testInfo) {
  const retry = Number(testInfo.retry) || 0;
  const repeat = Number(testInfo.repeatEachIndex) || 0;
  const source = `${testInfo.project.name}:${testInfo.title}:${retry}:${repeat}:cravings-page`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `cravings-page-${hash}@example.com`;
}


test('Craving history registration identities are stable per attempt and isolated across retries and repeats', () => {
  const attempt = {
    project: { name: 'chromium-desktop' },
    title: 'Craving history narrow state',
    retry: 0,
    repeatEachIndex: 0,
  };
  const email = deterministicEmail(attempt);

  expect(deterministicEmail({ ...attempt })).toBe(email);
  expect(deterministicEmail({ ...attempt, retry: 1 })).not.toBe(email);
  expect(deterministicEmail({ ...attempt, repeatEachIndex: 1 })).not.toBe(email);
  expect(deterministicEmail({
    ...attempt,
    project: { name: 'chromium-mobile' },
  })).not.toBe(email);
});


async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicEmail(testInfo));
  await page.locator('#password').fill('browser-password');
  await page.locator('#confirm_password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
}


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}


test('Craving history records complete and minimal entries in chronological order', async ({ page }, testInfo) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.cravingsSymptoms, expect,
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await register(page, testInfo);
  await recorder.visitState(page, 'cravings');

  await expect(page.getByRole('heading', { name: 'Craving history', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Get immediate support on Today/i })).toHaveAttribute('href', '/today/');

  const form = page.locator('#craving-form');
  await form.getByLabel('Intensity').fill('8');
  await form.getByLabel('Trigger').selectOption('stress');
  await form.getByLabel('Mood before').fill('4');
  await form.getByLabel('Stress level').fill('9');
  await form.getByLabel('Duration').fill('12');
  const symptomControls = [
    ['Restlessness', 'restlessness'],
    ['Irritability', 'irritability'],
    ['Difficulty concentrating', 'difficulty_concentrating'],
    ['Increased appetite', 'increased_appetite'],
  ];
  for (const [action] of symptomControls) {
    await recorder.runScenario(page, 'cravings', action, 'toggle');
  }
  await form.getByLabel('Situation context').fill('After a difficult meeting');
  await form.getByLabel('Outcome').selectOption('used_alternative');
  await form.getByLabel('Mood after').fill('6');
  await form.getByLabel('Notes').fill('The urge eased gradually');
  await form.getByLabel('What helped afterward').fill('Walked outside and had water');
  await form.getByRole('button', { name: 'Record craving' }).click();

  await expect(form.locator('[data-craving-form-status]')).toContainText('Craving recorded');
  const completeRow = page.locator('.craving-row', { hasText: 'After a difficult meeting' });
  await expect(completeRow).toContainText('Intensity 8 of 10');
  await expect(completeRow).toContainText('Used an alternative');
  await expect(completeRow).toContainText('12 minutes');
  const savedResponse = await page.request.get('/cravings/api/cravings');
  expect(savedResponse.status()).toBe(200);
  const savedCravings = await savedResponse.json();
  const savedSymptoms = JSON.parse(savedCravings[0].physical_symptoms);
  expect(savedSymptoms).toEqual([
    'restlessness', 'irritability', 'difficulty_concentrating', 'increased_appetite',
  ]);
  await form.getByLabel('Intensity').fill('3');
  await form.getByRole('button', { name: 'Record craving' }).click();
  await expect(page.locator('.craving-row')).toHaveCount(2);
  await expect(page.locator('.craving-row').first()).toContainText('Intensity 3 of 10');
  recorder.assertComplete();
  expect(errors).toEqual([]);
});


test('Craving history exposes native validation and recoverable server feedback', async ({ page }, testInfo) => {
  const recorder = createSupportingBehaviorRecorder(
    SUPPORTING_OWNER_TITLES.cravingsRecord, expect,
  );
  const guard = watchForProductProblems(page);
  await register(page, testInfo);
  await recorder.visitState(page, 'cravings');
  const form = page.locator('#craving-form');
  let posts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/cravings/api/cravings'
    ) posts += 1;
  });

  await recorder.runScenario(
    page, 'cravings', 'Record craving', 'invalid', 'failure', 'success',
  );
  expect(posts).toBe(2);
  const status = form.locator('[data-craving-form-status]');
  await expect(status).toHaveAttribute('data-state', 'success');
  await expect(page.locator('.craving-row').first()).toContainText('Intensity 6 of 10');
  recorder.assertComplete();
  guard.assertClean(expect, {
    stateName: 'cravings record supporting owner',
    expectedHttpErrors: [{
      method: 'POST', path: '/cravings/api/cravings', status: 503, count: 1,
    }],
  });
  guard.stop();
});


test('Craving history records minimal and detailed entries when its page module is blocked', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.route('**/static/js/cravings/page.js', (route) => route.abort());
  await page.goto('/cravings/cravings');

  let form = page.locator('#craving-form');
  await form.getByLabel('Intensity').fill('3');
  await form.getByRole('button', { name: 'Record craving' }).click();
  await expect(page).toHaveURL(/\/cravings\/cravings$/);
  await expect(page.locator('.craving-row').first()).toContainText('Intensity 3 of 10');

  form = page.locator('#craving-form');
  await form.getByLabel('Intensity').fill('8');
  await form.getByLabel('Trigger').selectOption('stress');
  await form.getByLabel('Duration').fill('12');
  await form.getByLabel('Situation context').fill('Blocked module detail');
  await form.getByLabel('Outcome').selectOption('used_alternative');
  await form.getByLabel('Notes').fill('Stayed in the form body');
  await form.getByRole('button', { name: 'Record craving' }).click();

  await expect(page).toHaveURL(/\/cravings\/cravings$/);
  await expect(page).not.toHaveURL(/[?&](?:notes|situation_context)=/);
  const detailed = page.locator('.craving-row', { hasText: 'Blocked module detail' });
  await expect(detailed).toContainText('Intensity 8 of 10');
  await expect(detailed).toContainText('Used an alternative');
  await expect(page.locator('.craving-row')).toHaveCount(2);
});


for (const theme of ['light', 'dark']) {
  test(`Craving history meets WCAG A/AA in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => {
      localStorage.setItem('nicotine-tracker-theme', value);
    }, theme);
    await register(page, testInfo);
    await page.goto('/cravings/cravings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoWcagViolations(page);
  });
}


test('Craving history remains keyboard reachable without mobile overflow', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await page.goto('/cravings/cravings');
  await page.getByLabel('Intensity').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Trigger')).toBeFocused();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
  if (testInfo.project.name.includes('mobile')) {
    const paddingBottom = await page.locator('main').evaluate((element) => (
      parseFloat(getComputedStyle(element).paddingBottom)
    ));
    expect(paddingBottom).toBeGreaterThanOrEqual(80);
  }
});


test('Craving history remains usable at 320px, 200% text, and reduced motion', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await register(page, testInfo);
  await page.goto('/cravings/cravings');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  const form = page.locator('#craving-form');
  const submit = form.getByRole('button', { name: 'Record craving' });
  await submit.focus();
  const focus = await submit.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      height: bounds.height,
      outlineStyle: style.outlineStyle,
      width: bounds.width,
    };
  });
  expect(focus.height).toBeGreaterThanOrEqual(44);
  expect(focus.width).toBeGreaterThanOrEqual(44);
  expect(focus.outlineStyle).not.toBe('none');

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  const navigationLinks = primaryNavigation.getByRole('link');
  const navigationLayout = await primaryNavigation.evaluate((navigation) => {
    const style = getComputedStyle(navigation);
    const clippedLabels = [...navigation.querySelectorAll('.primary-nav__link > span')]
      .filter((label) => {
        const labelStyle = getComputedStyle(label);
        const labelBounds = label.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(label);
        const textBounds = textRange.getBoundingClientRect();
        return (
          labelStyle.overflowX === 'hidden'
          || labelStyle.textOverflow === 'ellipsis'
          || textBounds.left < labelBounds.left - 1
          || textBounds.right > labelBounds.right + 1
          || textBounds.top < labelBounds.top - 1
          || textBounds.bottom > labelBounds.bottom + 1
        );
      })
      .map((label) => label.textContent.trim());
    return {
      clippedLabels,
      paddingInlineEnd: parseFloat(style.paddingInlineEnd),
      paddingInlineStart: parseFloat(style.paddingInlineStart),
    };
  });
  expect(navigationLayout.clippedLabels).toEqual([]);
  expect(navigationLayout.paddingInlineStart).toBeGreaterThan(0);
  expect(navigationLayout.paddingInlineEnd).toBeGreaterThan(0);

  for (const edgeLink of [navigationLinks.first(), navigationLinks.last()]) {
    await edgeLink.focus();
    await expect(edgeLink).toBeFocused();
    const focusClearance = await edgeLink.evaluate((link) => {
      const navigationBounds = link.closest('.primary-nav').getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();
      const style = getComputedStyle(link);
      const outlineExtent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return {
        left: linkBounds.left - outlineExtent - navigationBounds.left,
        outlineStyle: style.outlineStyle,
        right: navigationBounds.right - linkBounds.right - outlineExtent,
      };
    });
    expect(focusClearance.outlineStyle).not.toBe('none');
    expect(focusClearance.left).toBeGreaterThanOrEqual(0);
    expect(focusClearance.right).toBeGreaterThanOrEqual(0);
  }

  const overflow = await page.evaluate(() => ({
    pageClient: document.documentElement.clientWidth,
    pageScroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 12)
      .map((element) => ({
        className: String(element.className || ''),
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName,
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(overflow.pageScroll, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.pageClient + 1);

  const motion = await page.locator('.cravings-page, .cravings-page *').evaluateAll((elements) => (
    elements.map((element) => {
      const style = getComputedStyle(element);
      return `${style.animationDuration},${style.transitionDuration}`;
    })
  ));
  expect(motion.every((value) => value.split(',').every((duration) => {
    const parsed = parseFloat(duration) || 0;
    return duration.trim().endsWith('ms') ? parsed <= 1 : parsed <= 0.001;
  }))).toBe(true);
});
