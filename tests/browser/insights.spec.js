const { test, expect } = require('@playwright/test');

const { watchForProductProblems } = require('./helpers/product_guard');


async function login(page, email) {
  await page.context().clearCookies();
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}

test('Insights server fallback keeps neutral plan states neutral and reveals only sufficient cravings', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.route('**/static/js/insights.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  const states = [
    [
      'insights-no-plan@example.com', false, false,
      'Plan for Morning (6AM-12PM)', '/journey/',
    ],
    [
      'insights-observe@example.com', false, false,
      'Review your observations', '/journey/',
    ],
    [
      'insights-paused@example.com', false, false,
      'Review or resume your plan', '/journey/',
    ],
    [
      'insights-targeted@example.com', true, true,
      'Plan for Morning (6AM-12PM)', '/journey/',
    ],
  ];

  for (const [email, planVisible, cravingVisible, label, href] of states) {
    await login(page, email);
    await page.goto('/insights/?days=7');
    const periodCopy = await page.locator([
      '[data-insights-headline]',
      '[data-insights-interpretation]',
    ].join(',')).allTextContents();
    expect(periodCopy.join(' ')).not.toMatch(/your plan/i);
    await expect(page.locator('[data-insights-plan-context]'))
      [planVisible ? 'toBeVisible' : 'toBeHidden']();
    await expect(page.locator('[data-craving-pattern]'))
      [cravingVisible ? 'toBeVisible' : 'toBeHidden']();
    await expect(page.locator('[data-insights-next-step]')).toHaveText(label);
    await expect(page.locator('[data-insights-next-step]')).toHaveAttribute(
      'href', href,
    );
  }

  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Stress');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
  const payload = await page.evaluate(async () => (
    fetch('/insights/api/insights?days=7').then((response) => response.json())
  ));
  expect(payload.data_sufficiency.time_pattern).toBe(true);
  expect(payload.plan_context.actual_pouches).toBe(15);
  expect(payload.plan_context.target_pouches).toBe(18);
  const privateValues = [
    'Private browser fixture note',
    'Private browser situation context',
    'Private browser outcome note',
  ];
  const serializedPayload = JSON.stringify(payload);
  const renderedHtml = await page.content();
  for (const value of privateValues) {
    expect(serializedPayload).not.toContain(value);
    expect(renderedHtml).not.toContain(value);
  }
  guard.assertClean(expect, {
    stateName: 'Insights fallback plan and craving states',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});


test('Insights range refresh hides and restores plan and craving evidence from one contract', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await expect(page.locator('[data-insights-root]')).toHaveAttribute(
    'data-insights-started', 'true',
  );
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Routine');

  const sevenResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
      && new URL(response.url()).search === '?days=7'
  ));
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  const sevenResponse = await sevenResponsePromise;
  expect(sevenResponse.status()).toBe(200);
  const sevenPayload = await sevenResponse.json();
  expect(sevenPayload.log_count).toBe(0);
  expect(sevenPayload.data_sufficiency).toMatchObject({
    plan_adherence: false,
    craving_pattern: false,
  });
  expect(sevenPayload.plan_context).toMatchObject({
    state: 'active_targeted',
    adherence_available: false,
    compared_days: 0,
  });
  expect(sevenPayload.craving_pattern.available).toBe(false);
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'This range does not have a matched plan day yet.',
  );
  await expect(page.locator('[data-craving-pattern]')).toBeHidden();
  await expect(page.locator('[data-insights-next-step]')).toHaveText('Log today');
  await expect(page.locator('[data-insights-next-step]')).toHaveAttribute(
    'href', '/today/',
  );
  await expect(page.locator('[data-insights-interpretation]')).not.toContainText(/your plan/i);

  const thirtyResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
      && new URL(response.url()).search === '?days=30'
  ));
  await page.getByRole('link', { name: '30 days', exact: true }).click();
  const thirtyResponse = await thirtyResponsePromise;
  expect(thirtyResponse.status()).toBe(200);
  const thirtyPayload = await thirtyResponse.json();
  expect(thirtyPayload.plan_context).toMatchObject({
    state: 'active_targeted',
    adherence_available: true,
    compared_days: 3,
    actual_pouches: 15,
    target_pouches: 18,
    days_on_or_below_target: 2,
  });
  expect(thirtyPayload.craving_pattern).toMatchObject({
    available: true,
    leading_trigger: 'Routine',
    leading_trigger_count: 2,
    resolved_count: 3,
    non_nicotine_rate: 66.7,
  });
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-pattern]')).toBeVisible();
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Routine');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
  const serializedPayload = JSON.stringify(thirtyPayload);
  const renderedHtml = await page.content();
  for (const value of [
    'Private range fixture note',
    'Private range situation context',
    'Private range outcome note',
    'Private range plan note',
  ]) {
    expect(serializedPayload).not.toContain(value);
    expect(renderedHtml).not.toContain(value);
  }
  guard.assertClean(expect, {
    stateName: 'Insights plan and craving range refresh',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});


test('Insights plan and craving facts remain readable in dark 320px 200% reduced-motion mode', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, 'insights-targeted@example.com');
  await page.goto('/you/');
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.goto('/insights/?days=7');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-insights-plan-context]')).toBeVisible();
  const cravingFacts = page.locator('dl[aria-label="Craving response pattern"]');
  await expect(cravingFacts).toBeVisible();
  await expect(cravingFacts.locator('dt')).toHaveText([
    'Leading trigger', 'Pattern frequency', 'Non-nicotine response',
  ]);
  await page.locator('[aria-label="Insights date range"]').focus();
  await expect(page.locator('[aria-label="Insights date range"]')).toBeFocused();
  expect(await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))).toEqual({ overflow: 0, reduced: true });
  guard.assertClean(expect, {
    stateName: 'Insights dark narrow enlarged reduced-motion facts',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});
