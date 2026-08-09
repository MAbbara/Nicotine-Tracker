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

async function setActualTwoHundredPercentZoom(page) {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect.poll(() => page.evaluate(() => (
    Number.parseFloat(getComputedStyle(document.documentElement).zoom)
  ))).toBe(2);
}

async function rangeGeometry(page) {
  return page.locator(
    '[data-insights-root]:not([data-insights-candidate]) [data-days]',
  ).evaluateAll((controls) => Object.fromEntries(
    controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return [control.dataset.days, {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      }];
    }),
  ));
}

function expectStableRangeGeometry(actual, expected) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const days of Object.keys(expected)) {
    for (const key of ['top', 'left', 'width', 'height']) {
      expect(Math.abs(actual[days][key] - expected[days][key])).toBeLessThanOrEqual(1);
    }
  }
}

async function fullInsightsSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-insights-root]:not([data-insights-candidate])');
    const attributes = (node, names) => Object.fromEntries(
      names.map((name) => [name, node?.getAttribute(name) ?? null]),
    );
    const described = (selector) => [...root.querySelectorAll(selector)].map((node) => ({
      selector: node.id || [...node.attributes]
        .find((attribute) => attribute.name.startsWith('data-'))?.name || node.tagName,
      text: node.textContent,
      hidden: node.hidden,
      attributes: attributes(node, [
        'aria-busy', 'aria-current', 'aria-hidden', 'aria-pressed',
        'aria-live', 'role', 'href', 'open', 'disabled',
      ]),
      classes: node.className?.baseVal ?? node.className ?? '',
    }));
    return {
      url: window.location.href,
      root: {
        state: root.dataset.insightsState,
        pendingDays: root.dataset.pendingDays || null,
        attributes: attributes(root, ['aria-busy']),
      },
      metrics: described('.insights-measures dt, .insights-measures dd'),
      narratives: described([
        '[data-insights-headline]', '[data-insights-interpretation]',
        '[data-insights-plan-context]', '[data-insights-time-copy]',
        '[data-insights-time-nicotine-copy]', '[data-insights-weekly-copy]',
        '[data-insights-product-copy]', '[data-insights-product-nicotine-copy]',
        '[data-insights-craving-copy]', '[data-insights-hourly-copy]',
      ].join(',')),
      nextStep: described('[data-insights-next-step]'),
      craving: described([
        '[data-craving-pattern]', '[data-craving-leading-trigger]',
        '[data-craving-resolved-pattern]', '[data-craving-non-nicotine-rate]',
      ].join(',')),
      tables: [...root.querySelectorAll('[data-analytics-key]')].map((body) => ({
        key: body.dataset.analyticsKey,
        rows: [...body.rows].map((row) => [...row.cells].map((cell) => cell.textContent)),
      })),
      charts: [...root.querySelectorAll('.analytics-chart')].map((node) => ({
        id: node.id,
        text: node.textContent,
        hidden: node.hidden,
        attributes: attributes(node, ['aria-label', 'aria-labelledby', 'role']),
        values: [...node.querySelectorAll('[val]')].map((item) => item.getAttribute('val')),
        titles: [...node.querySelectorAll('title')].map((title) => title.textContent),
      })),
      chartStatuses: described('.analytics-chart__status'),
      details: described('details'),
      trendControls: described('.trend-toggle'),
      rangeControls: described('[data-days]'),
      export: described('#export-data').map((item) => ({
        ...item,
        href: root.querySelector('#export-data')?.dataset.exportHref || null,
      })),
    };
  });
}

function committedSnapshot(snapshot) {
  return {
    ...snapshot,
    root: { ...snapshot.root, pendingDays: null, attributes: { 'aria-busy': null } },
    chartStatuses: snapshot.chartStatuses.map((status) => (
      status.selector === 'data-insights-load-status'
        ? { ...status, text: '', hidden: true }
        : status
    )),
    rangeControls: snapshot.rangeControls.map((control) => ({
      ...control,
      classes: control.classes.replace(/\bis-pending\b/g, '').replace(/\s+/g, ' ').trim(),
      attributes: { ...control.attributes, 'aria-busy': null },
    })),
  };
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LONG_PRODUCT = 'An intentionally long immutable nicotine product snapshot label';
const SPACED_PRODUCT = ' Exact snapshot ';

const INSIGHTS_FIXTURES = {
  7: {
    range_days: 7, observed_days: 0, log_count: 0,
    total_pouches: 0, daily_average: 0, total_nicotine: 0,
    best_day: '--', consistency_score: 0, trend_direction: 'stable',
    peak_day: '--', average_time_between_pouches: '--',
    comparison: { available: false, current_total: 0, previous_total: 0 },
    data_sufficiency: {
      trend: false, time_pattern: false, brand_pattern: false, heatmap: false,
    },
    plan_context: {
      state: 'active_targeted', adherence_available: false, compared_days: 0,
    },
    craving_pattern: { available: false },
    consumption_trend: [], consumption_by_time_of_day: {},
    consumption_by_day_of_week: {}, brand_analysis: {}, heatmap_data: [],
    nicotine_by_time_of_day: {}, nicotine_by_product: {},
    strength_coverage: {
      known_pouches: 0, unknown_pouches: 0, total_pouches: 0,
      known_percent: 0, complete: true,
    },
    expectedCopy: {
      headline: 'Your patterns will appear after your first log.',
      interpretation: 'Start with one honest entry. Insights becomes more useful as your day-to-day pattern takes shape.',
      plan: 'This range does not have a matched plan day yet. Keep logging on plan days; three matched days are needed before comparing intake with your targets.',
      time: 'Keep logging throughout the day to reveal a dependable time pattern.',
      timeNicotine: 'No nicotine is available by time yet. Strength coverage will appear after you log a pouch.',
      weekly: 'Log across more complete days to reveal a dependable weekly pattern.',
      product: 'A few more product logs will reveal what you reach for most often.',
      productNicotine: 'No nicotine is available by product yet. Strength coverage will appear after you log a pouch.',
      craving: '', hourly: 'Log across more days and times to reveal a dependable hourly pattern.',
      nextStep: ['Log today', '/today/'],
    },
  },
  30: {
    range_days: 30, observed_days: 3, log_count: 5,
    total_pouches: 15, daily_average: 5, total_nicotine: 60,
    best_day: 'Wednesday', consistency_score: 80, trend_direction: 'decreasing',
    peak_day: 'Thursday', average_time_between_pouches: '2h 10m',
    comparison: {
      available: true, current_total: 15, previous_total: 18,
      direction: 'down', percent_change: -16.7,
    },
    data_sufficiency: {
      trend: true, time_pattern: true, brand_pattern: true, heatmap: true,
    },
    plan_context: {
      state: 'active_targeted', adherence_available: true, compared_days: 3,
      actual_pouches: 15, target_pouches: 18, days_on_or_below_target: 2,
    },
    craving_pattern: {
      available: true, leading_trigger: 'Stress', leading_trigger_count: 2,
      resolved_count: 3, non_nicotine_rate: 66.7,
    },
    consumption_trend: [
      { date: '2026-07-22', value: 5 }, { date: '2026-07-23', value: 7 },
      { date: '2026-07-24', value: 3 },
    ],
    consumption_by_time_of_day: { Morning: 15, Afternoon: 0 },
    consumption_by_day_of_week: { Wednesday: 5, Thursday: 7, Friday: 3 },
    brand_analysis: { Main: 10, Backup: 5 },
    heatmap_data: [{ name: 'Monday', data: [{ x: '10:00', y: 15 }] }],
    nicotine_by_time_of_day: { Morning: 60, Afternoon: 0 },
    nicotine_by_product: { Main: 36, Backup: 24, 'Known zero': 0 },
    strength_coverage: {
      known_pouches: 15, unknown_pouches: 0, total_pouches: 15,
      known_percent: 100, complete: true,
    },
    expectedCopy: {
      headline: 'You used 16.7% less than the previous 30 days.',
      interpretation: 'This lower total is useful context. Notice what changed in this range and what you may want to repeat.',
      plan: 'Across 3 matched plan days, you logged 15 pouches against a target of 18. 2 of 3 days were on or below target.',
      time: 'Morning is your most active part of the day. Plan support just before it begins.',
      timeNicotine: 'All known nicotine in this range is in one time category. Every pouch in this range has a saved strength.',
      weekly: 'Thursday has the most logged pouches in this range. Use it as a cue to plan support, not a verdict.',
      product: 'Main appears most often in this range. Use that context when you adjust your plan.',
      productNicotine: 'Every pouch in this range has a saved strength. Bars show known nicotine only.',
      craving: 'Stress appeared in 2 of 3 resolved cravings. You chose a non-nicotine response 66.7% of the time.',
      hourly: 'Monday around 10:00 has the highest logged use in this detail. Consider support before that time.',
      nextStep: ['Plan for Morning', '/journey/'],
    },
  },
  90: {
    range_days: 90, observed_days: 7, log_count: 8,
    total_pouches: 42, daily_average: 6, total_nicotine: 180,
    best_day: 'Tuesday', consistency_score: 72, trend_direction: 'increasing',
    peak_day: 'Friday', average_time_between_pouches: '1h 45m',
    comparison: {
      available: true, current_total: 42, previous_total: 30,
      direction: 'up', percent_change: 40,
    },
    data_sufficiency: {
      trend: true, time_pattern: true, brand_pattern: true, heatmap: true,
    },
    plan_context: { state: 'active_observe', adherence_available: false, compared_days: 0 },
    craving_pattern: { available: false },
    consumption_trend: [
      { date: '2026-05-04', value: 8 }, { date: '2026-05-11', value: 14 },
      { date: '2026-05-18', value: 20 },
    ],
    consumption_by_time_of_day: { Morning: 12, Afternoon: 30 },
    consumption_by_day_of_week: { Monday: 8, Wednesday: 14, Friday: 20 },
    brand_analysis: { Third: 20, Main: 12, Backup: 10 },
    heatmap_data: [{ name: 'Tuesday', data: [{ x: '18:00', y: 20 }] }],
    nicotine_by_time_of_day: { Morning: 48, Afternoon: 132 },
    nicotine_by_product: {
      'Third product': 30, [SPACED_PRODUCT]: 60, [LONG_PRODUCT]: 90,
      'Accessible zero category': 0,
    },
    strength_coverage: {
      known_pouches: 41, unknown_pouches: 1, total_pouches: 42,
      known_percent: 97.6, complete: false,
    },
    expectedCopy: {
      headline: 'You used 40% more than the previous 90 days.',
      interpretation: 'This is useful context, not a verdict. Look for what made this range harder, then choose one adjustment.',
      plan: '',
      time: 'Afternoon is your most active part of the day. Plan support just before it begins.',
      timeNicotine: '1 pouch had no saved strength, so nicotine totals are incomplete. Bars show known nicotine only.',
      weekly: 'Friday has the most logged pouches in this range. Use it as a cue to plan support, not a verdict.',
      product: 'Third appears most often in this range. Use that context when you adjust your plan.',
      productNicotine: '1 pouch had no saved strength, so nicotine totals are incomplete. Bars show known nicotine only.',
      craving: '',
      hourly: 'Tuesday around 18:00 has the highest logged use in this detail. Consider support before that time.',
      nextStep: ['Review your observations', '/journey/'],
    },
  },
};

function apiFixture(days) {
  const { expectedCopy: _expectedCopy, ...payload } = INSIGHTS_FIXTURES[days];
  return structuredClone(payload);
}

async function installChartConfigProbe(page) {
  await page.addInitScript(() => {
    const configs = new WeakMap();
    window.__insightsChartConfigs = configs;
    Object.defineProperty(window, 'ApexCharts', {
      configurable: true,
      set(BaseChart) {
        class ProbedChart extends BaseChart {
          constructor(target, options) {
            super(target, options);
            configs.set(target, {
              type: options.chart?.type || null,
              horizontal: Boolean(options.plotOptions?.bar?.horizontal),
              series: (options.series || []).map((series) => ({
                name: series.name,
                data: JSON.parse(JSON.stringify(series.data || [])),
              })),
              categories: options.xaxis?.categories || null,
            });
          }
        }
        Object.defineProperty(window, 'ApexCharts', {
          configurable: true, writable: true, value: ProbedChart,
        });
      },
    });
  });
}

async function semanticInsightsSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-insights-root]:not([data-insights-candidate])');
    const text = (selector) => root.querySelector(selector)?.textContent.trim() ?? '';
    const narrative = (selector) => {
      const node = root.querySelector(selector);
      return { text: node?.textContent.trim() ?? '', hidden: Boolean(node?.hidden) };
    };
    const chartConfig = window.__insightsChartConfigs;
    return {
      url: `${location.pathname}${location.search}`,
      root: {
        state: root.dataset.insightsState,
        busy: root.getAttribute('aria-busy'),
        pendingDays: root.dataset.pendingDays || null,
      },
      metrics: {
        lead: [...root.querySelectorAll('.insights-measures dd')].map((node) => node.textContent.trim()),
        totalNicotine: text('#total-nicotine'), bestDay: text('#best-day'),
        consistency: text('#consistency-score'), trendDirection: text('#trend-direction'),
        peakDay: text('#peak-day'), averageTimeBetween: text('#avg-time-between'),
      },
      narratives: Object.fromEntries([
        ['headline', '[data-insights-headline]'],
        ['interpretation', '[data-insights-interpretation]'],
        ['plan', '[data-insights-plan-context]'], ['time', '[data-insights-time-copy]'],
        ['timeNicotine', '[data-insights-time-nicotine-copy]'],
        ['weekly', '[data-insights-weekly-copy]'],
        ['product', '[data-insights-product-copy]'],
        ['productNicotine', '[data-insights-product-nicotine-copy]'],
        ['craving', '[data-insights-craving-copy]'],
        ['hourly', '[data-insights-hourly-copy]'],
      ].map(([key, selector]) => [key, narrative(selector)])),
      nextStep: {
        text: text('[data-insights-next-step]'),
        href: root.querySelector('[data-insights-next-step]')?.getAttribute('href'),
      },
      craving: {
        hidden: root.querySelector('[data-craving-pattern]').hidden,
        leading: text('[data-craving-leading-trigger]'),
        resolved: text('[data-craving-resolved-pattern]'),
        nonNicotine: text('[data-craving-non-nicotine-rate]'),
      },
      tables: Object.fromEntries([...root.querySelectorAll('[data-analytics-key]')].map((body) => [
        body.dataset.analyticsKey,
        [...body.rows].map((row) => [...row.cells].map((cell) => cell.textContent)),
      ])),
      charts: Object.fromEntries([...root.querySelectorAll('.analytics-chart')].map((chart) => [
        chart.id,
        {
          hidden: chart.hidden,
          role: chart.getAttribute('role'),
          labelledBy: chart.getAttribute('aria-labelledby'),
          config: chartConfig?.get(chart) || null,
        },
      ])),
      statuses: {
        load: (() => {
          const node = root.querySelector('[data-insights-load-status]');
          return { text: node.textContent, hidden: node.hidden, role: node.getAttribute('role'), live: node.getAttribute('aria-live') };
        })(),
        charts: [...root.querySelectorAll('.analytics-chart__status')].map((node) => ({
          text: node.textContent, hidden: node.hidden,
          role: node.getAttribute('role'), live: node.getAttribute('aria-live'),
        })),
      },
      range: [...root.querySelectorAll('[data-days]')].map((node) => ({
        days: Number(node.dataset.days), current: node.getAttribute('aria-current'),
        busy: node.getAttribute('aria-busy'), active: node.classList.contains('is-active'),
        pending: node.classList.contains('is-pending'),
      })),
      trend: [...root.querySelectorAll('.trend-toggle')].map((node) => ({
        type: node.dataset.type, pressed: node.getAttribute('aria-pressed'),
        active: node.classList.contains('is-active'),
      })),
      export: {
        href: root.querySelector('#export-data').dataset.exportHref,
        busy: root.querySelector('#export-data').getAttribute('aria-busy'),
        disabled: root.querySelector('#export-data').disabled,
      },
      details: [...root.querySelectorAll('details')].map((node) => node.open),
    };
  });
}

function weeklyTrend(points) {
  const weeks = new Map();
  points.forEach(({ date, value }) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    const day = parsed.getUTCDay() || 7;
    parsed.setUTCDate(parsed.getUTCDate() - day + 1);
    const monday = parsed.toISOString().slice(0, 10);
    weeks.set(monday, (weeks.get(monday) || 0) + Number(value));
  });
  return [...weeks].map(([date, value]) => ({ date, value }));
}

function expectedSemanticSnapshot(payload, days, trendType = 'daily') {
  const copy = INSIGHTS_FIXTURES[days].expectedCopy;
  const trend = trendType === 'weekly'
    ? weeklyTrend(payload.consumption_trend)
    : payload.consumption_trend;
  const pairs = (value) => Object.entries(value).map(([label, amount]) => [label, String(Number(amount))]);
  const bars = (value) => Object.entries(value)
    .map(([label, amount]) => ({ label, amount: Number(amount) }))
    .filter(({ amount }) => amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const timeBars = bars(payload.nicotine_by_time_of_day);
  const productBars = bars(payload.nicotine_by_product);
  const weekdays = DAYS.map((label) => Number(payload.consumption_by_day_of_week[label]) || 0);
  const eligible = {
    'consumption-trend-chart': payload.data_sufficiency.trend && trend.some(({ value }) => Number(value) > 0),
    'time-of-day-chart': payload.data_sufficiency.time_pattern && timeBars.length > 0,
    'day-of-week-chart': payload.data_sufficiency.trend && weekdays.some((value) => value > 0),
    'brand-chart': payload.data_sufficiency.brand_pattern && productBars.length > 0,
    'heatmap-chart': false,
  };
  const chart = (id, config) => ({
    hidden: !eligible[id], role: 'img',
    labelledBy: {
      'consumption-trend-chart': 'consumption-trend-title',
      'time-of-day-chart': 'time-of-day-title',
      'day-of-week-chart': 'day-of-week-title',
      'brand-chart': 'brand-title', 'heatmap-chart': 'heatmap-title',
    }[id],
    config: eligible[id] ? config : null,
  });
  const emptyRow = (message) => [[message]];
  const heatmapRows = payload.heatmap_data.length
    ? payload.heatmap_data.map((series) => [
      series.name, ...series.data.map((point) => String(Number(point.y ?? point))),
    ])
    : emptyRow('No hourly pattern available.');
  const status = { text: '', hidden: true, role: 'status', live: 'polite' };
  return {
    url: `/insights/?days=${days}`,
    root: {
      state: payload.log_count <= 0 ? 'empty' : payload.data_sufficiency.trend ? 'ready' : 'sparse',
      busy: null, pendingDays: null,
    },
    metrics: {
      lead: [String(payload.comparison.current_total), String(payload.daily_average), String(payload.observed_days)],
      totalNicotine: String(payload.total_nicotine), bestDay: String(payload.best_day),
      consistency: `${payload.consistency_score}%`, trendDirection: String(payload.trend_direction),
      peakDay: String(payload.peak_day), averageTimeBetween: String(payload.average_time_between_pouches),
    },
    narratives: Object.fromEntries(Object.entries(copy).filter(([key]) => !['nextStep'].includes(key)).map(([key, value]) => [
      key, { text: value, hidden: key === 'plan' ? payload.plan_context.state !== 'active_targeted' : false },
    ])),
    nextStep: { text: copy.nextStep[0], href: copy.nextStep[1] },
    craving: {
      hidden: !payload.craving_pattern.available,
      leading: payload.craving_pattern.leading_trigger || '',
      resolved: payload.craving_pattern.available ? `${payload.craving_pattern.leading_trigger_count} of ${payload.craving_pattern.resolved_count} resolved` : '',
      nonNicotine: payload.craving_pattern.available ? `${payload.craving_pattern.non_nicotine_rate}%` : '',
    },
    tables: {
      trend: trend.length ? trend.map(({ date, value }) => [date, String(value)]) : emptyRow('No consumption logged in this range.'),
      timeOfDay: Object.keys(payload.nicotine_by_time_of_day).length ? pairs(payload.nicotine_by_time_of_day) : emptyRow('No known-strength nicotine logged in this range.'),
      dayOfWeek: DAYS.map((label, index) => [label, String(weekdays[index])]),
      brands: Object.keys(payload.nicotine_by_product).length ? pairs(payload.nicotine_by_product) : emptyRow('No known-strength product data in this range.'),
      heatmap: heatmapRows,
    },
    charts: {
      'consumption-trend-chart': chart('consumption-trend-chart', {
        type: 'line', horizontal: false,
        series: [{ name: trendType === 'weekly' ? 'Weekly pouches' : 'Daily pouches', data: trend.map(({ date, value }) => ({ x: date, y: Number(value) })) }],
        categories: null,
      }),
      'time-of-day-chart': chart('time-of-day-chart', {
        type: 'bar', horizontal: true,
        series: [{ name: 'Nicotine (mg)', data: timeBars.map(({ amount }) => amount) }],
        categories: timeBars.map(({ label }) => label),
      }),
      'day-of-week-chart': chart('day-of-week-chart', {
        type: 'bar', horizontal: false, series: [{ name: 'Pouches', data: weekdays }],
        categories: DAYS.map((label) => label.slice(0, 3)),
      }),
      'brand-chart': chart('brand-chart', {
        type: 'bar', horizontal: true,
        series: [{ name: 'Nicotine (mg)', data: productBars.map(({ amount }) => amount) }],
        categories: productBars.map(({ label }) => label),
      }),
      'heatmap-chart': chart('heatmap-chart', null),
    },
    statuses: { load: status, charts: Array.from({ length: 5 }, () => ({ ...status })) },
    range: [7, 30, 90, 365].map((value) => ({
      days: value, current: value === days ? 'true' : null,
      busy: null, active: value === days, pending: false,
    })),
    trend: ['daily', 'weekly'].map((type) => ({
      type, pressed: String(type === trendType), active: type === trendType,
    })),
    export: { href: `/insights/api/export?days=${days}`, busy: null, disabled: false },
    details: Array(6).fill(false),
  };
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
  expect(payload.nicotine_by_time_of_day).toBeTruthy();
  expect(payload.nicotine_by_product).toBeTruthy();
  expect(payload.strength_coverage).toMatchObject({ complete: true, unknown_pouches: 0 });
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
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'No nicotine is available',
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
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'one product category',
  );
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

test('Insights range transaction retains geometry, content, focus, and atomic history', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await installChartConfigProbe(page);
  await page.goto('/insights/?days=30');
  const actions = page.locator('.insights-actions');
  const seven = page.getByRole('link', { name: '7 days', exact: true });
  const headline = page.locator('[data-insights-headline]');
  const before = await actions.boundingBox();
  const controlGeometry = await rangeGeometry(page);
  const snapshot = await fullInsightsSnapshot(page);
  const expectedThirty = expectedSemanticSnapshot(INSIGHTS_FIXTURES[30], 30);
  await page.evaluate(() => {
    window.__insightsLayoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__insightsLayoutShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources || []).map((source) => (
            source.node?.closest?.('.insights-actions') ? 'insights-actions' : 'other'
          )),
        });
      }
    }).observe({ type: 'layout-shift', buffered: false });
  });
  await seven.focus();

  let delayed = true;
  await page.route('**/insights/api/insights?days=7', async (route) => {
    if (delayed) {
      delayed = false;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"held"}' });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(apiFixture(7)),
    });
  });
  await page.route('**/insights/api/insights?days=30', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(apiFixture(30)),
  }));
  const failed = seven.click();
  await expect(page.locator('[data-insights-load-status]')).toContainText('Updating');
  const pending = await actions.boundingBox();
  expect(Math.abs(pending.y - before.y)).toBeLessThanOrEqual(1);
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(await headline.textContent()).toBe(snapshot.narratives[0].text);
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(snapshot),
  );
  await expect(seven).toBeFocused();
  await failed;
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(snapshot),
  );
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(await page.evaluate(() => window.__insightsLayoutShifts
    .filter((entry) => entry.sources.includes('insights-actions')))).toEqual([]);

  const sevenResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
    && new URL(response.url()).search === '?days=7'
    && response.status() === 200
  ));
  await seven.click();
  const sevenPayload = await (await sevenResponsePromise).json();
  expect(sevenPayload).toEqual(apiFixture(7));
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-current', 'true');
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  const expectedSeven = expectedSemanticSnapshot(INSIGHTS_FIXTURES[7], 7);
  const sevenSnapshot = await semanticInsightsSnapshot(page);
  const intentionallyStaleSeven = structuredClone(sevenSnapshot);
  intentionallyStaleSeven.narratives.headline.text = 'Stale headline mutation';
  expect(intentionallyStaleSeven).not.toEqual(expectedSeven);
  expect(sevenSnapshot).toEqual(expectedSeven);
  await page.goBack();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(await semanticInsightsSnapshot(page)).toEqual(expectedThirty);
});

test('Insights presentation commits preserve owned focus without stealing moved focus', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');

  const weekly = page.getByRole('button', { name: 'Weekly' });
  await weekly.focus();
  await page.keyboard.press('Enter');
  await expect(weekly).toHaveAttribute('aria-pressed', 'true');
  await expect(weekly).toBeFocused();

  const daily = page.getByRole('button', { name: 'Daily' });
  await daily.focus();
  await page.keyboard.press('Enter');
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
  await expect(daily).toBeFocused();

  let releaseNinety;
  const ninetyHeld = new Promise((resolve) => { releaseNinety = resolve; });
  await page.route('**/insights/api/insights?days=90', async (route) => {
    await ninetyHeld;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiFixture(90)),
    });
  });
  const ninety = page.getByRole('link', { name: '90 days', exact: true });
  await ninety.focus();
  await page.keyboard.press('Enter');
  await expect(ninety).toHaveAttribute('aria-busy', 'true');
  const outside = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Today', exact: true });
  await outside.focus();
  releaseNinety();
  await expect(page.locator('[data-days="90"]')).toHaveAttribute('aria-current', 'true');
  await expect(outside).toBeFocused();

  const beforeTheme = await page.locator('[data-insights-headline]').elementHandle();
  await page.evaluate(() => {
    document.documentElement.dispatchEvent(new CustomEvent('nicotine-tracker:theme-change'));
  });
  await expect.poll(() => beforeTheme.evaluate((node) => node.isConnected)).toBe(false);
  await expect(outside).toBeFocused();

  const beforePop = await page.locator('[data-insights-headline]').elementHandle();
  await page.goBack();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => beforePop.evaluate((node) => node.isConnected)).toBe(false);
  await expect(outside).toBeFocused();

  await page.route('**/insights/api/insights?days=7', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{"error":"controlled"}',
  }));
  const seven = page.getByRole('link', { name: '7 days', exact: true });
  await seven.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-insights-load-status]'))
    .toContainText('choose the range again to retry');
  await expect(seven).toBeFocused();
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
});

test('pre-activation disclosure input invalidates a fully built background candidate', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.evaluate(() => {
    const BaseChart = window.ApexCharts;
    window.__summaryCommitRace = {
      active: 0,
      maxActive: 0,
      armed: false,
      held: false,
      holdId: null,
      eligibleIds: [],
      builtIds: [],
      liveCommits: 0,
    };
    const liveRoot = document.querySelector(
      '[data-insights-root]:not([data-insights-candidate])',
    );
    new MutationObserver((records) => {
      window.__summaryCommitRace.liveCommits += records.filter((record) => (
        record.type === 'childList' && record.target === liveRoot
      )).length;
    }).observe(liveRoot, { childList: true });
    window.ApexCharts = class HeldBackgroundChart {
      constructor(target, options) {
        this.targetId = target.id;
        this.chart = new BaseChart(target, options);
      }
      async render() {
        const audit = window.__summaryCommitRace;
        audit.active += 1;
        audit.maxActive = Math.max(audit.maxActive, audit.active);
        try {
          await this.chart.render();
          if (audit.armed) audit.builtIds.push(this.targetId);
          if (audit.armed && this.targetId === audit.holdId) {
            audit.armed = false;
            audit.held = true;
            await new Promise((resolve) => { window.__releaseSummaryCommitRace = resolve; });
          }
        } finally {
          audit.active -= 1;
        }
      }
      destroy() { this.chart.destroy(); }
    };
    window.__armSummaryCommitRace = () => {
      const currentRoot = document.querySelector(
        '[data-insights-root]:not([data-insights-candidate])',
      );
      const eligible = [...currentRoot.querySelectorAll('.analytics-chart')]
        .filter((chart) => !chart.hidden);
      const audit = window.__summaryCommitRace;
      audit.eligibleIds = eligible.map((chart) => chart.id);
      audit.builtIds = [];
      audit.holdId = eligible.at(-1).id;
      audit.armed = true;
      audit.held = false;
      window.__releaseSummaryCommitRace = null;
      document.documentElement.dispatchEvent(
        new CustomEvent('nicotine-tracker:theme-change'),
      );
    };
  });

  const liveRoot = page.locator('[data-insights-root]:not([data-insights-candidate])');
  const summaryLabel = 'Open hourly detail and supporting measures';
  const activate = async (input, expectedOpen) => {
    await page.evaluate(() => window.__armSummaryCommitRace());
    await expect.poll(() => page.evaluate(() => ({
      held: window.__summaryCommitRace.held,
      releaseReady: typeof window.__releaseSummaryCommitRace === 'function',
    }))).toEqual({ held: true, releaseReady: true });
    const builtCandidate = await page.evaluate(() => ({
      eligible: window.__summaryCommitRace.eligibleIds,
      built: window.__summaryCommitRace.builtIds,
    }));
    expect(builtCandidate.built).toEqual(builtCandidate.eligible);
    const commitsBefore = await page.evaluate(() => window.__summaryCommitRace.liveCommits);
    const summary = liveRoot.getByText(summaryLabel, { exact: true });
    await summary.scrollIntoViewIfNeeded();
    await summary.focus({ preventScroll: true });
    const oldSummary = await summary.elementHandle();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    if (input === 'programmatic') {
      await oldSummary.evaluate((node) => {
        node.addEventListener('click', () => window.__releaseSummaryCommitRace(), {
          once: true,
        });
        node.click();
      });
    } else if (input === 'pointer') {
      await oldSummary.evaluate((node) => {
        node.addEventListener('pointerdown', () => window.__releaseSummaryCommitRace(), {
          once: true,
        });
      });
      const box = await summary.boundingBox();
      await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
    } else {
      await oldSummary.evaluate((node, key) => {
        node.addEventListener('keydown', (event) => {
          if (event.key === key) window.__releaseSummaryCommitRace();
        }, { once: true });
      }, input);
      await summary.press(input);
    }

    await expect.poll(() => oldSummary.evaluate((node) => node.isConnected)).toBe(false);
    const replacement = liveRoot.getByText(summaryLabel, { exact: true });
    if (expectedOpen) await expect(replacement.locator('..')).toHaveAttribute('open', '');
    else await expect(replacement.locator('..')).not.toHaveAttribute('open', '');
    await expect(replacement).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore))
      .toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => window.__summaryCommitRace.active)).toBe(0);
    expect(await page.evaluate(() => window.__summaryCommitRace.liveCommits))
      .toBe(commitsBefore + 1);
  };

  await activate('programmatic', true);
  await activate('pointer', false);
  await activate('Enter', true);
  await activate(' ', false);
  expect(await page.evaluate(() => window.__summaryCommitRace.maxActive)).toBe(1);
});

test('Export handoff preserves focus and defers one invalidated disclosure successor', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.evaluate(() => {
    const BaseChart = window.ApexCharts;
    const liveRoot = document.querySelector(
      '[data-insights-root]:not([data-insights-candidate])',
    );
    window.__exportHandoffRace = {
      active: 0,
      maxActive: 0,
      armed: false,
      held: false,
      holdId: null,
      eligibleIds: [],
      builtIds: [],
      liveCommits: 0,
    };
    new MutationObserver((records) => {
      window.__exportHandoffRace.liveCommits += records.filter((record) => (
        record.type === 'childList' && record.target === liveRoot
      )).length;
    }).observe(liveRoot, { childList: true });
    window.ApexCharts = class HeldDisclosureChart {
      constructor(target, options) {
        this.targetId = target.id;
        this.chart = new BaseChart(target, options);
      }
      async render() {
        const audit = window.__exportHandoffRace;
        audit.active += 1;
        audit.maxActive = Math.max(audit.maxActive, audit.active);
        try {
          if (audit.armed && !audit.holdId) {
            await new Promise((resolve) => { window.__releaseExportInspection = resolve; });
          }
          await this.chart.render();
          if (audit.armed) audit.builtIds.push(this.targetId);
          if (audit.armed && this.targetId === audit.holdId) {
            audit.armed = false;
            audit.held = true;
            await new Promise((resolve) => { window.__releaseExportHandoff = resolve; });
          }
        } finally {
          audit.active -= 1;
        }
      }
      destroy() { this.chart.destroy(); }
    };
    window.__armExportHandoff = () => {
      const audit = window.__exportHandoffRace;
      audit.armed = true;
      audit.held = false;
      audit.holdId = null;
      audit.eligibleIds = [];
      audit.builtIds = [];
      window.__releaseExportInspection = null;
      window.__releaseExportHandoff = null;
    };
  });

  let exportRequests = 0;
  const releaseResponses = [];
  await page.route('**/insights/api/export?days=30', async (route) => {
    exportRequests += 1;
    await new Promise((resolve) => { releaseResponses.push(resolve); });
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      headers: { 'content-disposition': 'attachment; filename="nicotine_data_20260809.csv"' },
      body: 'date,nicotine_mg\n2026-08-09,6\n',
    });
  });

  const liveRoot = page.locator('[data-insights-root]:not([data-insights-candidate])');
  const summary = () => liveRoot.getByText(
    'Open hourly detail and supporting measures', { exact: true },
  );
  const exportButton = page.getByRole('button', { name: 'Export CSV' });
  const freezeScroll = () => page.evaluate(() => {
    const position = { x: window.scrollX, y: window.scrollY };
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    return position.y;
  });
  const settleCommit = () => page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const settle = () => requestAnimationFrame(() => {
      frames += 1;
      if (frames === 6) resolve();
      else settle();
    });
    settle();
  }));
  const armDisclosure = async (key) => {
    await page.evaluate(() => window.__armExportHandoff());
    await summary().focus({ preventScroll: true });
    await summary().press(key);
    await expect.poll(() => page.evaluate(() => (
      typeof window.__releaseExportInspection
    ))).toBe('function');
    await page.evaluate(() => {
      const candidate = [...document.querySelectorAll('.insights-staging')]
        .map((host) => host.shadowRoot?.querySelector('[data-insights-candidate]'))
        .find(Boolean);
      const eligible = [...candidate.querySelectorAll('.analytics-chart')]
        .filter((chart) => !chart.hidden);
      const audit = window.__exportHandoffRace;
      audit.eligibleIds = eligible.map((chart) => chart.id);
      audit.holdId = audit.eligibleIds.at(-1);
      window.__releaseExportInspection();
    });
    await expect.poll(() => page.evaluate(() => ({
      held: window.__exportHandoffRace.held,
      releaseReady: typeof window.__releaseExportHandoff === 'function',
    }))).toEqual({ held: true, releaseReady: true });
    const builtCandidate = await page.evaluate(() => ({
      eligible: window.__exportHandoffRace.eligibleIds,
      built: window.__exportHandoffRace.builtIds,
    }));
    expect(builtCandidate.built).toEqual(builtCandidate.eligible);
  };

  await armDisclosure('Enter');
  const firstOldExport = await exportButton.elementHandle();
  await freezeScroll();
  await firstOldExport.evaluate((node) => {
    node.addEventListener('focus', () => {
      window.__exportHandoffRace.focusReleaseScroll = window.scrollY;
      window.__releaseExportHandoff();
    }, { once: true });
    node.focus({ preventScroll: true });
  });
  await expect.poll(() => firstOldExport.evaluate((node) => node.isConnected)).toBe(false);
  await expect(exportButton).toBeFocused();
  await settleCommit();
  const firstScroll = await page.evaluate(() => (
    window.__exportHandoffRace.focusReleaseScroll
  ));
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - firstScroll),
    'focus-event candidate commit must not scroll',
  )
    .toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const audit = window.__exportHandoffRace;
    audit.scrollPhases = [];
    const root = document.querySelector('[data-insights-root]');
    for (const eventName of ['keydown', 'click']) {
      root.addEventListener(eventName, () => {
        audit.scrollPhases.push({
          eventName,
          scrollY: window.scrollY,
          maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        });
      }, { capture: true, once: true });
    }
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => exportRequests).toBe(1);
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[data-insights-load-status]')).toContainText('Preparing CSV');
  const firstPendingGeometry = await page.evaluate(() => ({
    firstScroll: window.__exportHandoffRace.scrollPhases,
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(
    Math.abs(firstPendingGeometry.scrollY - firstScroll),
    JSON.stringify(firstPendingGeometry),
  ).toBeLessThanOrEqual(1);
  releaseResponses[0]();
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'false');
  await expect(exportButton).toBeFocused();

  await armDisclosure(' ');
  await exportButton.focus({ preventScroll: true });
  const secondOldExport = await exportButton.elementHandle();
  await freezeScroll();
  const commitsBefore = await page.evaluate(() => window.__exportHandoffRace.liveCommits);
  await secondOldExport.evaluate((node) => {
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        window.__exportHandoffRace.keydownReleaseScroll = window.scrollY;
        window.__releaseExportHandoff();
      }
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => exportRequests).toBe(2);
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[data-insights-load-status]')).toContainText('Preparing CSV');
  await expect.poll(() => page.evaluate(() => window.__exportHandoffRace.active)).toBe(0);
  expect(await page.evaluate(() => window.__exportHandoffRace.liveCommits))
    .toBe(commitsBefore);
  await page.waitForTimeout(100);
  await expect(exportButton).toBeDisabled();
  expect(exportRequests).toBe(2);
  releaseResponses[1]();
  await expect.poll(() => secondOldExport.evaluate((node) => node.isConnected)).toBe(false);
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveAttribute('aria-busy', 'false');
  await expect(exportButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__exportHandoffRace.liveCommits))
    .toBe(commitsBefore + 1);
  await settleCommit();
  const secondScroll = await page.evaluate(() => (
    window.__exportHandoffRace.keydownReleaseScroll
  ));
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - secondScroll),
    'deferred post-export successor must not scroll',
  )
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__exportHandoffRace.maxActive)).toBe(1);
  expect(exportRequests).toBe(2);
});

test('latest range wins after abort and long snapshot labels stay contained at 320px 200%', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, 'insights-range@example.com');
  await installChartConfigProbe(page);
  await page.goto('/insights/?days=30');
  await setActualTwoHundredPercentZoom(page);
  const controlGeometry = await rangeGeometry(page);
  await page.route('**/insights/api/insights?days=7', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(apiFixture(7)),
    });
  });
  await page.route('**/insights/api/insights?days=90', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(apiFixture(90)),
  }));

  const beforeTop = await page.locator('.insights-actions').evaluate((node) => (
    node.getBoundingClientRect().top + window.scrollY
  ));
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText(LONG_PRODUCT);
  await expect(page.locator('[data-analytics-key="brands"] th')).toHaveText([
    'Third product', SPACED_PRODUCT, LONG_PRODUCT, 'Accessible zero category',
  ]);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Accessible zero category');
  const productLabels = page.locator('#brand-chart .apexcharts-yaxis-label');
  await expect(productLabels).toHaveCount(3);
  await expect(productLabels.locator('title')).toHaveText([
    LONG_PRODUCT, SPACED_PRODUCT, 'Third product',
  ]);
  await expect(page.locator('#brand-chart .apexcharts-bar-area')).toHaveCount(3);
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-days="90"]')).toHaveAttribute('aria-current', 'true');
  expect(await semanticInsightsSnapshot(page)).toEqual(
    expectedSemanticSnapshot(INSIGHTS_FIXTURES[90], 90),
  );
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  const afterTop = await page.locator('.insights-actions').evaluate((node) => (
    node.getBoundingClientRect().top + window.scrollY
  ));
  expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBe(0);
});

test('range request invalidates an already-running live presentation before pending begins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'insights-range@example.com');
  await installChartConfigProbe(page);
  await page.goto('/insights/?days=30');
  const before = await fullInsightsSnapshot(page);
  const geometry = await rangeGeometry(page);
  let releaseRange;
  const rangeHeld = new Promise((resolve) => { releaseRange = resolve; });
  await page.route('**/insights/api/insights?days=90', async (route) => {
    await rangeHeld;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiFixture(90)),
    });
  });
  await page.evaluate(() => {
    const original = window.ApexCharts.prototype.render;
    window.ApexCharts.prototype.render = function heldLiveRender(...args) {
      if (window.__heldLiveRenderOnce) return original.apply(this, args);
      window.__heldLiveRenderOnce = true;
      return new Promise((resolve) => {
        window.__releaseHeldLiveRender = async () => resolve(await original.apply(this, args));
      });
    };
  });

  await page.getByRole('button', { name: 'Weekly' }).click();
  await expect.poll(() => page.evaluate(() => (
    typeof window.__releaseHeldLiveRender
  ))).toBe('function');
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  const liveRoot = page.locator('[data-insights-root]:not([data-insights-candidate])');
  await expect(liveRoot).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.__releaseHeldLiveRender());
  await page.waitForTimeout(100);

  await expect(liveRoot).toHaveAttribute('aria-busy', 'true');
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(before),
  );
  expectStableRangeGeometry(await rangeGeometry(page), geometry);
  releaseRange();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-days="90"]')).toHaveAttribute('aria-current', 'true');
  expect(await semanticInsightsSnapshot(page)).toEqual(
    expectedSemanticSnapshot(INSIGHTS_FIXTURES[90], 90, 'weekly'),
  );
  expectStableRangeGeometry(await rangeGeometry(page), geometry);
});

test('range response builds offscreen and chart delay or failure cannot partially commit live state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  const liveSnapshot = () => page.evaluate(() => {
    const root = document.querySelector('[data-insights-root]:not([data-insights-candidate])');
    return {
      metrics: [...root.querySelectorAll('.insights-measures dd')].map((node) => node.textContent),
      narratives: [...root.querySelectorAll('[data-insights-headline], [data-insights-interpretation], [data-insights-time-nicotine-copy], [data-insights-product-nicotine-copy]')].map((node) => node.textContent),
      tables: [...root.querySelectorAll('[data-analytics-key="timeOfDay"], [data-analytics-key="brands"]')].map((node) => node.textContent),
      chartText: [...root.querySelectorAll('#time-of-day-chart, #brand-chart')].map((node) => node.textContent),
      current: root.querySelector('[data-days][aria-current="true"]')?.dataset.days,
      exportHref: root.querySelector('#export-data')?.dataset.exportHref,
    };
  });
  const before = await liveSnapshot();
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.comparison.current_total = 99;
    payload.total_pouches = 99;
    payload.nicotine_by_product = { 'Candidate only': 321 };
    payload.data_sufficiency.brand_pattern = true;
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.evaluate(() => {
    const original = window.ApexCharts.prototype.render;
    window.__insightsOriginalRender = original;
    window.__holdInsightsChart = true;
    window.ApexCharts.prototype.render = function heldRender(...args) {
      if (!window.__holdInsightsChart) return original.apply(this, args);
      return new Promise((resolve, reject) => {
        window.__releaseInsightsChart = async ({ fail = false } = {}) => {
          window.__holdInsightsChart = false;
          if (fail) reject(new Error('forced candidate render failure'));
          else resolve(await original.apply(this, args));
        };
      });
    };
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(before);
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  await page.evaluate(() => window.__releaseInsightsChart());
  await page.waitForTimeout(100);
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-analytics-key="brands"]')).not.toContainText('Candidate only');

  await page.getByRole('link', { name: '30 days', exact: true }).click();
  await expect(page).toHaveURL(/days=30/);
  await page.evaluate(() => {
    window.__holdInsightsChart = true;
    delete window.__releaseInsightsChart;
  });
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(before);
  await page.evaluate(() => window.__releaseInsightsChart());
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Candidate only');

  await page.getByRole('link', { name: '30 days', exact: true }).click();
  await expect(page).toHaveURL(/days=30/);
  const committed = await liveSnapshot();
  await page.evaluate(() => {
    window.__holdInsightsChart = true;
    delete window.__releaseInsightsChart;
  });
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(committed);
  await page.evaluate(() => window.__releaseInsightsChart({ fail: true }));
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=30/);
  expect(await liveSnapshot()).toEqual(committed);
});

test('failed popstate returns to committed entry without overwriting the destination history entry', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  let failThirty = true;
  await page.route('**/insights/api/insights?days=30', async (route) => {
    if (!failThirty) return route.continue();
    failThirty = false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"held"}' });
  });

  await page.goBack();
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-current', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
});

test('known-zero and unknown-only nicotine states stay truthful with authoritative tables', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.route('**/insights/api/insights?days=*', async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    if (![90, 365].includes(days)) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.data_sufficiency.time_pattern = true;
    payload.data_sufficiency.brand_pattern = true;
    if (days === 90) {
      payload.nicotine_by_time_of_day = { Morning: 0 };
      payload.nicotine_by_product = { 'Known zero product': 0 };
      payload.strength_coverage = {
        known_pouches: 2, unknown_pouches: 1, total_pouches: 3,
        known_percent: 66.7, complete: false,
      };
    } else {
      payload.nicotine_by_time_of_day = {};
      payload.nicotine_by_product = {};
      payload.strength_coverage = {
        known_pouches: 0, unknown_pouches: 2, total_pouches: 2,
        known_percent: 0, complete: false,
      };
    }
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('add up to 0 mg');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Known zero product0');
  await expect(page.locator('#brand-chart')).toBeHidden();

  await page.getByRole('link', { name: '1 year', exact: true }).click();
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'every logged pouch is missing a saved strength',
  );
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText(
    'No known-strength product data',
  );
  await expect(page.locator('#brand-chart')).toBeHidden();
});

test('client refresh keeps mixed unknown-strength coverage visible for a single positive bar', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data_sufficiency.time_pattern = true;
    payload.data_sufficiency.brand_pattern = true;
    payload.nicotine_by_time_of_day = { Morning: 8, Evening: 0 };
    payload.nicotine_by_product = { 'Only positive product': 8, 'Known zero': 0 };
    payload.strength_coverage = {
      known_pouches: 2, unknown_pouches: 1, total_pouches: 3,
      known_percent: 66.7, complete: false,
    };
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();

  await expect(page.locator('[data-insights-time-nicotine-copy]')).toContainText('one time category');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('one product category');
  await expect(page.locator('[data-insights-time-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('#brand-chart .apexcharts-yaxis-label title')).toHaveText(
    'Only positive product',
  );
  await expect(page.locator('#brand-chart .apexcharts-yaxis-label title')).not.toContainText(
    'Known zero',
  );
});


test('Insights plan and craving facts remain readable in dark 320px 200% reduced-motion mode', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, 'insights-targeted@example.com');
  await page.goto('/you/');
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.goto('/insights/?days=7');
  await setActualTwoHundredPercentZoom(page);

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
