const { test, expect } = require('@playwright/test');


function deterministicEmail(testInfo) {
  const source = `${testInfo.project.name}:${testInfo.title}`;
  let hash = 0;
  for (const character of source) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }
  return `onboarding-${hash}@example.com`;
}

function watchForErrors(page, { ignoreConsole = [] } = {}) {
  const errors = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error'
      && !ignoreConsole.some((pattern) => pattern.test(message.text()))
    ) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  return errors;
}

async function register(page, testInfo) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicEmail(testInfo));
  await page.getByLabel('Password', { exact: true }).fill('browser-password');
  await page.getByLabel('Confirm Password').fill('browser-password');
  await page.getByLabel(/I agree to the/i).check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
  await expect(page.getByRole('heading', { name: 'Choose your intention' })).toBeFocused();
}

async function selectManualBaseline(page) {
  await page.locator('input[name="intention"][value="reduce"]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Set an honest starting point' })).toBeFocused();
  await page.locator('input[name="baseline_source"][value="manual"]').check();
  await page.locator('#field-baseline_pouches').fill('8');
  await page.locator('#field-baseline_mg_per_pouch').fill('6');
}

async function advanceToSupport(page) {
  await selectManualBaseline(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a pace' })).toBeFocused();
  await page.getByLabel(/Steady · 49 days/).check();
  await page.getByLabel(/End target in pouches per day/).fill('2');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add useful support' })).toBeFocused();
}

async function previewManualPlan(page) {
  await advanceToSupport(page);
  await page.getByLabel('Morning', { exact: true }).check();
  await page.getByLabel('Stress').check();
  await page.getByLabel(/Steady Mint/).check();
  await page.getByLabel('No reminder').check();
  await page.getByLabel('Plan start date').fill('2099-01-01');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review every assumption' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Activate this reviewed plan' })).toBeVisible();
}

test('registration previews transparently and activates only after final confirmation', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  const creationRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/plans') {
      creationRequests.push(request.url());
    }
  });

  await register(page, testInfo);
  await previewManualPlan(page);

  await expect(page.getByText('Complete daily schedule')).toBeVisible();
  await expect(page.getByText(/behavioral tracking aid, not medical advice/i)).toBeVisible();
  const decisions = page.locator('.review-decisions');
  for (const label of [
    'Intention', 'Baseline source', 'Starting pouches', 'Direct median strength',
    'Pace and duration', 'Dates', 'Difficult times', 'Triggers', 'Pouches', 'Reminder',
  ]) {
    await expect(decisions).toContainText(label);
  }
  expect(creationRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Activate this reviewed plan' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
  expect(creationRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('back and forward navigation preserves entered answers', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await register(page, testInfo);
  await selectManualBaseline(page);

  const planSoFar = page.locator('.onboarding-margin');
  await expect(planSoFar).toContainText('Reduce steadily');
  await expect(planSoFar).toContainText('Manual entry');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('input[name="baseline_source"][value="manual"]')).toBeChecked();
  await expect(page.locator('#field-baseline_pouches')).toHaveValue('8');
  await expect(page.locator('#field-baseline_mg_per_pouch')).toHaveValue('6');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('input[name="intention"][value="reduce"]')).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#field-baseline_pouches')).toHaveValue('8');
  expect(errors).toEqual([]);
});

test('keyboard operation follows a visible focus path into each step', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await register(page, testInfo);

  await page.keyboard.press('Tab');
  const reduceChoice = page.locator('input[name="intention"][value="reduce"]');
  await expect(reduceChoice).toBeFocused();
  await page.keyboard.press('Space');
  await expect(reduceChoice).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  const outline = await page.getByRole('button', { name: 'Continue' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Set an honest starting point' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('invalid plan data returns to a clearly linked field error', async ({ page }, testInfo) => {
  const errors = watchForErrors(page, {
    ignoreConsole: [/Failed to load resource.*422 \(UNPROCESSABLE ENTITY\)/],
  });
  await register(page, testInfo);
  await advanceToSupport(page);
  await page.getByLabel('Plan start date').fill('2099-01-01');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel(/End target in pouches per day/).fill('9');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const endTarget = page.getByLabel(/End target in pouches per day/);
  await expect(endTarget).toBeFocused();
  await expect(endTarget).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.field-error')).toContainText(/cannot exceed/i);
  const border = await endTarget.evaluate((element) => getComputedStyle(element).borderColor);
  const normalBorder = await page.locator('#field-baseline_pouches').evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  expect(border).not.toBe(normalBorder);
  expect(errors).toEqual([]);
});

test('onboarding adapts from thumb-zone field guide to editorial desktop spread', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await register(page, testInfo);

  const choice = page.locator('input[name="intention"][value="reduce"]').locator('..');
  const choiceRule = await choice.evaluate((element) => getComputedStyle(element).borderBottomStyle);
  expect(choiceRule).not.toBe('none');

  const controls = page.locator('[data-onboarding-enhanced-actions] button:visible');
  const targetSizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  for (const size of targetSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  if (testInfo.project.name.includes('mobile')) {
    await expect(page.locator('.onboarding-margin')).toBeHidden();
    await expect(page.locator('[data-onboarding-step]:visible')).toHaveCount(1);
    const actionStyle = await page.locator('[data-onboarding-enhanced-actions]').evaluate((element) => {
      const style = getComputedStyle(element);
      return { position: style.position, bottom: parseFloat(style.bottom) };
    });
    expect(actionStyle.position).toBe('sticky');
    expect(actionStyle.bottom).toBeGreaterThan(44);
  } else {
    await expect(page.locator('.onboarding-margin')).toBeVisible();
    const layout = await page.locator('.onboarding-layout').evaluate((element) => {
      const style = getComputedStyle(element);
      const form = element.querySelector('.onboarding-form').getBoundingClientRect();
      const margin = element.querySelector('.onboarding-margin').getBoundingClientRect();
      return { display: style.display, columns: style.gridTemplateColumns, formWidth: form.width, marginWidth: margin.width };
    });
    expect(layout.display).toBe('grid');
    expect(layout.columns.split(' ')).toHaveLength(2);
    expect(layout.formWidth).toBeGreaterThan(layout.marginWidth);
    await expect(page.locator('.onboarding-margin')).toHaveCSS('position', 'sticky');
  }
  expect(errors).toEqual([]);
});

test('dark theme keeps the editorial hierarchy without transparent choice surfaces', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await register(page, testInfo);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colors = await page.locator('input[name="intention"][value="reduce"]').locator('..').evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, border: style.borderBottomColor };
  });
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors.color).not.toBe(colors.background);
  expect(colors.border).not.toBe(colors.background);
  expect(errors).toEqual([]);
});

test('200 percent text and reduced motion remain usable without page overflow', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, testInfo);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  const duration = await page.getByRole('button', { name: 'Continue' }).evaluate(
    (element) => Math.max(...getComputedStyle(element).transitionDuration
      .split(',').map((value) => parseFloat(value) * (value.includes('ms') ? 0.001 : 1))),
  );
  expect(duration).toBeLessThanOrEqual(0.001);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  expect(errors).toEqual([]);
});
