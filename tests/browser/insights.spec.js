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


function rangePayload({
  days,
  planContext,
  cravingPattern,
  total = 15,
}) {
  return {
    range_days: days,
    observed_days: 3,
    log_count: 3,
    comparison: {
      available: true,
      current_total: total,
      previous_total: 18,
      absolute_change: total - 18,
      percent_change: Number((((total - 18) / 18) * 100).toFixed(1)),
      direction: total < 18 ? 'down' : total > 18 ? 'up' : 'steady',
    },
    data_sufficiency: {
      trend: true,
      time_pattern: false,
      brand_pattern: false,
      heatmap: false,
      plan_adherence: Boolean(planContext?.adherence_available),
      craving_pattern: Boolean(cravingPattern?.available),
    },
    total_pouches: total,
    daily_average: Number((total / days).toFixed(1)),
    peak_day: 7,
    average_time_between_pouches: '2h',
    total_nicotine: 60,
    unknown_strength_count: 0,
    best_day: 3,
    consistency_score: 75,
    trend_direction: 'Stable',
    consumption_by_time_of_day: {},
    consumption_by_day_of_week: {},
    brand_analysis: {},
    consumption_trend: [
      { date: '2026-08-01', value: 5 },
      { date: '2026-08-02', value: 7 },
      { date: '2026-08-03', value: total - 12 },
    ],
    heatmap_data: [],
    ai_insights: [],
    plan_context: planContext,
    craving_pattern: cravingPattern,
  };
}


const NO_PLAN = {
  state: 'none',
  adherence_available: false,
  mode: null,
  status: null,
  compared_days: 0,
};
const NO_CRAVING_PATTERN = {
  available: false,
  event_count: 2,
  resolved_count: 2,
  leading_trigger: null,
  leading_trigger_count: null,
  non_nicotine_rate: null,
};
const TARGETED_PLAN = {
  state: 'active_targeted',
  adherence_available: true,
  mode: 'reduce',
  status: 'active',
  compared_days: 3,
  days_on_or_below_target: 2,
  actual_pouches: 15,
  target_pouches: 18,
  difference_pouches: -3,
  adherence_rate: 66.7,
};
const READY_CRAVINGS = {
  available: true,
  event_count: 4,
  resolved_count: 3,
  leading_trigger: 'Stress',
  leading_trigger_count: 2,
  outcome_counts: {
    resisted: 1,
    used_alternative: 1,
    used_nicotine: 1,
  },
  non_nicotine_rate: 66.7,
};


test('Insights server fallback keeps neutral plan states neutral and reveals only sufficient cravings', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.route('**/static/js/insights.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  const states = [
    ['insights-no-plan@example.com', false, false],
    ['insights-observe@example.com', false, false],
    ['insights-paused@example.com', false, false],
    ['insights-targeted@example.com', true, true],
  ];

  for (const [email, planVisible, cravingVisible] of states) {
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
  }

  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Stress');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
  guard.assertClean(expect, {
    stateName: 'Insights fallback plan and craving states',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});


test('Insights range refresh hides and restores plan and craving evidence from one contract', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.route('**/insights/api/insights?days=90', (route) => route.fulfill({
    json: rangePayload({
      days: 90,
      planContext: NO_PLAN,
      cravingPattern: NO_CRAVING_PATTERN,
    }),
  }));
  await page.route('**/insights/api/insights?days=365', (route) => route.fulfill({
    json: rangePayload({
      days: 365,
      total: 21,
      planContext: {
        ...TARGETED_PLAN,
        mode: 'quit_by_date',
        days_on_or_below_target: 1,
        actual_pouches: 21,
        difference_pouches: 3,
        adherence_rate: 33.3,
      },
      cravingPattern: {
        ...READY_CRAVINGS,
        leading_trigger: 'Routine',
      },
    }),
  }));
  await login(page, 'insights-targeted@example.com');
  await page.goto('/insights/?days=7');
  await expect(page.locator('[data-insights-root]')).toHaveAttribute(
    'data-insights-started', 'true',
  );
  await expect(page.locator('[data-insights-plan-context]')).toBeVisible();
  await expect(page.locator('[data-craving-pattern]')).toBeVisible();

  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page.locator('[data-insights-plan-context]')).toBeHidden();
  await expect(page.locator('[data-craving-pattern]')).toBeHidden();
  await expect(page.locator('[data-insights-interpretation]')).not.toContainText(/your plan/i);

  await page.getByRole('link', { name: '1 year', exact: true }).click();
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 21 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-pattern]')).toBeVisible();
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Routine');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
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
