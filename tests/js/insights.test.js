const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function importModule(relativePath) {
  let source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  if (source.includes("'./analytics/runtime.js'")) {
    const runtimeSource = fs.readFileSync(
      path.join(projectRoot, 'static/js/analytics/runtime.js'),
      'utf8',
    );
    const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString('base64')}`;
    source = source.replace("'./analytics/runtime.js'", `'${runtimeUrl}'`);
  }
  if (source.includes("'./analytics/disclosure.js'")) {
    const disclosureSource = fs.readFileSync(
      path.join(projectRoot, 'static/js/analytics/disclosure.js'),
      'utf8',
    );
    const disclosureUrl = `data:text/javascript;base64,${Buffer.from(disclosureSource).toString('base64')}`;
    source = source.replace("'./analytics/disclosure.js'", `'${disclosureUrl}'`);
  }
  if (source.includes("'./insights/view_model.js'")) {
    const viewModelSource = fs.readFileSync(
      path.join(projectRoot, 'static/js/insights/view_model.js'),
      'utf8',
    );
    const viewModelUrl = `data:text/javascript;base64,${Buffer.from(viewModelSource).toString('base64')}`;
    source = source.replace("'./insights/view_model.js'", `'${viewModelUrl}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('effective chart theme uses only the root effective value', async () => {
  const { getEffectiveTheme } = await importModule('static/js/analytics/runtime.js');

  assert.equal(getEffectiveTheme({ dataset: { theme: 'dark' } }), 'dark');
  assert.equal(getEffectiveTheme({ dataset: { theme: 'light' } }), 'light');
  assert.equal(getEffectiveTheme({ dataset: { theme: 'system' } }), 'light');
  assert.equal(getEffectiveTheme({ dataset: {} }), 'light');
});

test('chart enhancement renders real options and returns the chart', async () => {
  const { enhanceChart } = await importModule('static/js/analytics/runtime.js');
  const constructed = [];
  class RecordingChart {
    constructor(target, options) {
      this.target = target;
      this.options = options;
      this.rendered = false;
      constructed.push(this);
    }
    async render() { this.rendered = true; }
  }
  const target = { id: 'trend' };
  const status = { hidden: false, textContent: 'old failure' };
  const options = { series: [{ name: 'Pouches', data: [2, 4] }] };

  const result = await enhanceChart({ target, status, options, ApexChartsClass: RecordingChart });

  assert.equal(result, constructed[0]);
  assert.equal(result.target, target);
  assert.equal(result.options, options);
  assert.equal(result.rendered, true);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('missing constructor or target exposes fallback without throwing', async () => {
  const { enhanceChart } = await importModule('static/js/analytics/runtime.js');

  for (const input of [
    { target: {}, ApexChartsClass: undefined },
    { target: null, ApexChartsClass: class {} },
  ]) {
    const status = { hidden: true, textContent: '' };
    const result = await enhanceChart({ ...input, status, options: { series: [] } });
    assert.equal(result, null);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Chart unavailable/);
  }
});

test('chart render rejection exposes fallback without throwing', async () => {
  const { enhanceChart } = await importModule('static/js/analytics/runtime.js');
  const status = { hidden: true, textContent: '' };
  let destroyed = false;
  let cleared = false;
  const BrokenChart = class {
    render() { return Promise.reject(new Error('boom')); }
    destroy() { destroyed = true; }
  };
  const result = await enhanceChart({
    target: { replaceChildren() { cleared = true; } },
    status,
    options: { series: [] },
    ApexChartsClass: BrokenChart,
  });
  assert.equal(result, null);
  assert.equal(destroyed, true);
  assert.equal(cleared, true);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Chart unavailable/);
});

test('insights alternatives preserve the same labels and values as chart series', async () => {
  const { buildInsightsAlternativeModel } = await importModule('static/js/insights.js');
  const model = buildInsightsAlternativeModel({
    consumption_trend: [
      { date: '2026-07-30', value: 2 },
      { date: '2026-07-31', value: 5 },
    ],
    consumption_by_time_of_day: {
      'Morning (6AM-12PM)': 4,
      'Evening (6PM-12AM)': 3,
    },
    consumption_by_day_of_week: { Monday: 2, Tuesday: 5 },
    brand_analysis: { 'Steady Mint': 7 },
  });

  assert.deepEqual(model.trend, [
    { label: '2026-07-30', value: 2 },
    { label: '2026-07-31', value: 5 },
  ]);
  assert.deepEqual(model.timeOfDay, [
    { label: 'Morning (6AM-12PM)', value: 4 },
    { label: 'Evening (6PM-12AM)', value: 3 },
  ]);
  assert.deepEqual(model.dayOfWeek.slice(0, 2), [
    { label: 'Monday', value: 2 },
    { label: 'Tuesday', value: 5 },
  ]);
  assert.deepEqual(model.brands, [{ label: 'Steady Mint', value: 7 }]);
});

test('nicotine bar models are sorted, exclude zero visuals, and preserve complete tables', async () => {
  const { buildInsightsAlternativeModel } = await importModule('static/js/insights.js');
  const model = buildInsightsAlternativeModel({
    nicotine_by_time_of_day: { Night: 0, Morning: 6.5, Evening: 18 },
    nicotine_by_product: {
      'Very long catalog snapshot label that must remain exact': 12,
      Zero: 0,
      Mint: 24,
    },
    strength_coverage: {
      known_pouches: 4, unknown_pouches: 2, total_pouches: 6,
      known_percent: 66.7, complete: false,
    },
  });

  assert.deepEqual(model.timeOfDayBars, [
    { label: 'Evening', mg: 18, share: 73.5 },
    { label: 'Morning', mg: 6.5, share: 26.5 },
  ]);
  assert.deepEqual(model.productBars, [
    { label: 'Mint', mg: 24, share: 66.7 },
    { label: 'Very long catalog snapshot label that must remain exact', mg: 12, share: 33.3 },
  ]);
  assert.deepEqual(model.timeOfDayMg, [
    { label: 'Night', value: 0 },
    { label: 'Morning', value: 6.5 },
    { label: 'Evening', value: 18 },
  ]);
  assert.equal(model.strengthCoverage.complete, false);
});

test('nicotine distributions render horizontal mg bars rather than donuts', async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = { matchMedia: () => ({ matches: false }) };
  global.document = { documentElement: { dataset: { theme: 'light' } } };
  try {
    const { chartDefinitions } = await importModule('static/js/insights.js');
    const definitions = new Map(chartDefinitions({
      nicotine_by_time_of_day: { Morning: 8, Night: 0 },
      nicotine_by_product: { Mint: 8, Zero: 0 },
    }, 'daily'));
    for (const id of ['time-of-day-chart', 'brand-chart']) {
      const options = definitions.get(id);
      assert.equal(options.chart.type, 'bar');
      assert.equal(options.plotOptions.bar.horizontal, true);
      assert.deepEqual(options.series[0].data, [8]);
      assert.equal(options.series[0].name, 'Nicotine (mg)');
    }
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test('nicotine distribution copy distinguishes no logs, unknown-only, known zero, single, and ready', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const model = (values, coverage) => buildInsightsViewModel({
    log_count: coverage.total_pouches,
    observed_days: coverage.total_pouches ? 1 : 0,
    data_sufficiency: {},
    nicotine_by_product: values,
    strength_coverage: coverage,
  }, 7).sections.productNicotine;

  assert.equal(model({}, {
    total_pouches: 0, known_pouches: 0, unknown_pouches: 0, complete: true,
  }).state, 'no-logs');
  assert.equal(model({}, {
    total_pouches: 2, known_pouches: 0, unknown_pouches: 2, complete: false,
  }).state, 'unknown-only');
  assert.equal(model({ Zero: 0 }, {
    total_pouches: 2, known_pouches: 2, unknown_pouches: 0, complete: true,
  }).state, 'known-zero');
  assert.equal(model({ Mint: 6, Zero: 0 }, {
    total_pouches: 2, known_pouches: 2, unknown_pouches: 0, complete: true,
  }).state, 'single');
  assert.equal(model({ Mint: 6, Citrus: 3 }, {
    total_pouches: 2, known_pouches: 2, unknown_pouches: 0, complete: true,
  }).state, 'ready');
});

test('weekly trend model is the single source for chart and alternative rows', async () => {
  const { buildTrendModel } = await importModule('static/js/insights.js');
  const data = {
    consumption_trend: [
      { date: '2026-07-27', value: 2 },
      { date: '2026-07-28', value: 5 },
      { date: '2026-08-03', value: 11 },
    ],
  };

  assert.deepEqual(buildTrendModel(data, 'weekly'), [
    { label: '2026-07-27', value: 7 },
    { label: '2026-08-03', value: 11 },
  ]);
  assert.deepEqual(buildTrendModel(data, 'daily'), [
    { label: '2026-07-27', value: 2 },
    { label: '2026-07-28', value: 5 },
    { label: '2026-08-03', value: 11 },
  ]);
});

test('heatmap alternatives preserve every day hour and value', async () => {
  const { buildInsightsAlternativeModel } = await importModule('static/js/insights.js');
  const model = buildInsightsAlternativeModel({
    heatmap_data: [
      { name: 'Monday', data: [0, 3, 0] },
      { name: 'Tuesday', data: [{ x: '00:00', y: 2 }, { x: '01:00', y: 5 }] },
    ],
  });

  assert.deepEqual(model.heatmap, [
    { day: 'Monday', hour: '00:00', value: 0 },
    { day: 'Monday', hour: '01:00', value: 3 },
    { day: 'Monday', hour: '02:00', value: 0 },
    { day: 'Tuesday', hour: '00:00', value: 2 },
    { day: 'Tuesday', hour: '01:00', value: 5 },
  ]);
});

test('trend data labels are limited to short readable series', async () => {
  const { shouldShowTrendDataLabels } = await importModule('static/js/insights.js');

  assert.equal(shouldShowTrendDataLabels(0), false);
  assert.equal(shouldShowTrendDataLabels(7), true);
  assert.equal(shouldShowTrendDataLabels(14), true);
  assert.equal(shouldShowTrendDataLabels(15), false);
  assert.equal(shouldShowTrendDataLabels(365), false);
});

test('progress-first model separates period direction from active plan evidence', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const model = buildInsightsViewModel({
    total_pouches: 21,
    daily_average: 0.7,
    observed_days: 30,
    log_count: 30,
    comparison: {
      available: true,
      current_total: 21,
      previous_total: 28,
      percent_change: -25,
      direction: 'down',
    },
    data_sufficiency: {
      trend: true,
      time_pattern: true,
      brand_pattern: true,
      heatmap: true,
    },
    plan_context: {
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
    },
    consumption_by_time_of_day: {
      'Morning (6AM-12PM)': 5,
      'Evening (6PM-12AM)': 16,
    },
    brand_analysis: { 'Steady Mint': 18, 'Calm Citrus': 3 },
    ai_insights: [{ title: 'Ignore me', description: 'Unverified legacy copy.' }],
  }, 30);

  assert.equal(model.state, 'ready');
  assert.equal(model.headline, 'You used 25% less than the previous 30 days.');
  assert.doesNotMatch(model.interpretation, /your plan/i);
  assert.equal(model.planContext.visible, true);
  assert.match(model.planContext.interpretation, /15 pouches against a target of 18/i);
  assert.match(model.planContext.interpretation, /2 of 3 days/i);
  assert.deepEqual(model.metrics.map(({ key }) => key), [
    'current-use', 'daily-average', 'days-observed',
  ]);
  assert.equal(model.sections.timePattern.leadingLabel, 'Evening (6PM-12AM)');
  assert.equal(model.sections.productPattern.leadingLabel, 'Steady Mint');
  assert.equal(model.sections.weeklyPattern.leadingLabel, null);
  assert.equal(model.sections.hourlyDetail.leadingLabel, null);
  assert.doesNotMatch(JSON.stringify(model), /Ignore me|Unverified legacy copy/);
  assert.equal(model.nextStep.label, 'Plan for Evening (6PM-12AM)');
  assert.match(model.nextStep.description, /before this window begins/i);
  assert.equal(model.nextStep.href, '/journey/');
});

test('plan context gates plan language and gives neutral state-aware next steps', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const base = {
    total_pouches: 15,
    observed_days: 3,
    log_count: 3,
    comparison: {
      available: true,
      current_total: 15,
      previous_total: 18,
      percent_change: -16.7,
      direction: 'down',
    },
    data_sufficiency: { trend: true, time_pattern: true },
    consumption_by_time_of_day: { Morning: 15 },
  };
  const neutralCases = [
    [{ state: 'none', adherence_available: false }, 'Plan for Morning'],
    [{ state: 'active_observe', mode: 'observe', status: 'active', adherence_available: false }, 'Review your observations'],
    [{ state: 'paused', mode: 'reduce', status: 'paused', adherence_available: false }, 'Review or resume your plan'],
  ];

  for (const [planContext, expectedNextStep] of neutralCases) {
    const model = buildInsightsViewModel({ ...base, plan_context: planContext }, 7);
    assert.equal(model.planContext.visible, false);
    assert.equal(model.planContext.interpretation, '');
    assert.equal(model.nextStep.label, expectedNextStep);
    assert.doesNotMatch(`${model.headline} ${model.interpretation}`, /your plan/i);
  }

  const insufficient = buildInsightsViewModel({
    ...base,
    plan_context: {
      state: 'active_targeted',
      mode: 'reduce',
      status: 'active',
      adherence_available: false,
      compared_days: 2,
    },
  }, 7);
  assert.equal(insufficient.planContext.visible, true);
  assert.equal(insufficient.planContext.available, false);
  assert.match(insufficient.planContext.interpretation, /2 matched plan days/i);
  assert.match(insufficient.planContext.interpretation, /keep logging on plan days/i);

  const onTarget = buildInsightsViewModel({
    ...base,
    plan_context: {
      state: 'active_targeted',
      mode: 'reduce',
      status: 'active',
      adherence_available: true,
      compared_days: 3,
      days_on_or_below_target: 2,
      actual_pouches: 15,
      target_pouches: 18,
      difference_pouches: -3,
      adherence_rate: 66.7,
    },
  }, 7);
  const aboveTarget = buildInsightsViewModel({
    ...base,
    plan_context: {
      state: 'active_targeted',
      mode: 'quit_by_date',
      status: 'active',
      adherence_available: true,
      compared_days: 3,
      days_on_or_below_target: 1,
      actual_pouches: 21,
      target_pouches: 18,
      difference_pouches: 3,
      adherence_rate: 33.3,
    },
  }, 7);

  assert.match(onTarget.planContext.interpretation, /15 pouches against a target of 18/i);
  assert.match(onTarget.planContext.interpretation, /2 of 3 days/i);
  assert.match(aboveTarget.planContext.interpretation, /21 pouches against a target of 18/i);
  assert.match(aboveTarget.planContext.interpretation, /1 of 3 days/i);
  assert.doesNotMatch(JSON.stringify([onTarget, aboveTarget]), /success|failure/i);
});

test('craving pattern model stays hidden until bounded evidence is available', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const base = {
    total_pouches: 4,
    observed_days: 3,
    log_count: 3,
    data_sufficiency: { trend: true },
  };
  const insufficient = buildInsightsViewModel({
    ...base,
    craving_pattern: {
      available: false,
      event_count: 2,
      resolved_count: 2,
      leading_trigger: null,
      leading_trigger_count: null,
      non_nicotine_rate: null,
    },
  }, 7);
  const available = buildInsightsViewModel({
    ...base,
    craving_pattern: {
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
    },
  }, 7);

  assert.equal(insufficient.cravingPattern.visible, false);
  assert.equal(insufficient.cravingPattern.leadingTrigger, null);
  assert.equal(available.cravingPattern.visible, true);
  assert.equal(available.cravingPattern.leadingTrigger, 'Stress');
  assert.equal(available.cravingPattern.resolvedPattern, '2 of 3 resolved');
  assert.equal(available.cravingPattern.nonNicotineResponse, '66.7%');
  assert.match(available.cravingPattern.interpretation, /Stress appeared in 2 of 3 resolved cravings/i);
  assert.match(available.cravingPattern.interpretation, /non-nicotine response 66.7%/i);
  assert.doesNotMatch(JSON.stringify(available.cravingPattern), /notes|context/i);
});

test('weekly and hourly figures receive honest sufficiency-gated interpretations', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const ready = buildInsightsViewModel({
    total_pouches: 12,
    observed_days: 7,
    log_count: 12,
    data_sufficiency: { trend: true, time_pattern: true, brand_pattern: true, heatmap: true },
    consumption_by_day_of_week: { Monday: 2, Friday: 6, Sunday: 4 },
    heatmap_data: [
      { name: 'Monday', data: [{ x: '08:00', y: 2 }] },
      { name: 'Friday', data: [{ x: '18:00', y: 6 }] },
    ],
  }, 7);
  const sparse = buildInsightsViewModel({
    total_pouches: 2,
    observed_days: 1,
    log_count: 2,
    data_sufficiency: { trend: false, heatmap: false },
    consumption_by_day_of_week: { Friday: 2 },
    heatmap_data: [{ name: 'Friday', data: [{ x: '18:00', y: 2 }] }],
  }, 7);

  assert.equal(ready.sections.weeklyPattern.leadingLabel, 'Friday');
  assert.match(ready.sections.weeklyPattern.interpretation, /Friday has the most logged pouches/i);
  assert.equal(ready.sections.hourlyDetail.leadingLabel, 'Friday at 18:00');
  assert.match(ready.sections.hourlyDetail.interpretation, /Friday around 18:00/i);
  assert.equal(sparse.sections.weeklyPattern.available, false);
  assert.match(sparse.sections.weeklyPattern.interpretation, /more complete days/i);
  assert.equal(sparse.sections.hourlyDetail.available, false);
  assert.match(sparse.sections.hourlyDetail.interpretation, /more days and times/i);
});

test('progress-first model uses candid neutral language for higher and steady use', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const base = {
    total_pouches: 28,
    observed_days: 7,
    log_count: 7,
    data_sufficiency: { trend: true, time_pattern: false, brand_pattern: false },
  };
  const higher = buildInsightsViewModel({
    ...base,
    comparison: {
      available: true,
      current_total: 28,
      previous_total: 25,
      percent_change: 12,
      direction: 'up',
    },
  }, 7);
  const steady = buildInsightsViewModel({
    ...base,
    comparison: {
      available: true,
      current_total: 28,
      previous_total: 28,
      percent_change: 0,
      direction: 'steady',
    },
  }, 7);

  assert.equal(higher.headline, 'You used 12% more than the previous 7 days.');
  assert.doesNotMatch(`${higher.headline} ${higher.interpretation}`, /fail/i);
  assert.equal(steady.headline, 'Your use was steady compared with the previous 7 days.');
  assert.equal(higher.sections.timePattern.available, false);
  assert.equal(higher.sections.productPattern.available, false);
});

test('sparse and empty models invite continued logging without inventing direction', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const sparse = buildInsightsViewModel({
    total_pouches: 4,
    observed_days: 2,
    log_count: 2,
    comparison: { available: false, current_total: 4 },
    data_sufficiency: { trend: false, time_pattern: false, brand_pattern: false },
  }, 30);
  const empty = buildInsightsViewModel({
    total_pouches: 0,
    observed_days: 0,
    log_count: 0,
    comparison: { available: false, current_total: 0 },
    data_sufficiency: { trend: false, time_pattern: false, brand_pattern: false },
  }, 30);

  assert.equal(sparse.state, 'sparse');
  assert.equal(sparse.headline, 'Keep logging to reveal a reliable direction.');
  assert.match(sparse.interpretation, /4 pouches across 2 days/i);
  assert.doesNotMatch(sparse.interpretation, /less|more|steady/i);
  assert.equal(sparse.nextStep.href, '/today/');
  assert.equal(empty.state, 'empty');
  assert.match(empty.headline, /first log/i);
  assert.equal(empty.nextStep.href, '/today/');
});

test('missing comparison reports the observed fact without claiming a trend', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const model = buildInsightsViewModel({
    total_pouches: 18,
    daily_average: 4.5,
    observed_days: 4,
    log_count: 6,
    comparison: { available: false, current_total: 18 },
    data_sufficiency: { trend: true, time_pattern: true, brand_pattern: true },
    consumption_by_time_of_day: { Morning: 0, Afternoon: 6, Evening: 12 },
    brand_analysis: { Mint: 7, Citrus: 11 },
  }, 7);

  assert.equal(model.state, 'ready');
  assert.equal(model.headline, 'You logged 18 pouches across 4 days.');
  assert.doesNotMatch(`${model.headline} ${model.interpretation}`, /less|more|steady/i);
  assert.equal(model.sections.timePattern.leadingLabel, 'Evening');
  assert.equal(model.sections.productPattern.leadingLabel, 'Citrus');
});

test('a zero previous total never becomes a false zero-percent comparison', async () => {
  const { buildInsightsViewModel } = await importModule('static/js/insights/view_model.js');
  const model = buildInsightsViewModel({
    total_pouches: 2,
    observed_days: 3,
    log_count: 3,
    comparison: {
      available: true,
      current_total: 2,
      previous_total: 0,
      percent_change: null,
      direction: 'up',
    },
    data_sufficiency: { trend: true, time_pattern: false, brand_pattern: false },
  }, 7);

  assert.equal(model.headline, 'You logged 2 pouches; the previous 7 days had none.');
  assert.doesNotMatch(model.headline, /0%/);
});

test('chart eligibility follows sufficiency, non-zero data, and visible detail', async () => {
  const { renderInsights, selectEligibleChartIds } = await importModule('static/js/insights.js');
  assert.equal(typeof renderInsights, 'function');
  const ready = {
    consumption_trend: [{ date: '2026-08-01', value: 2 }],
    consumption_by_time_of_day: { Morning: 2 },
    nicotine_by_time_of_day: { Morning: 8 },
    consumption_by_day_of_week: { Monday: 2 },
    brand_analysis: { Mint: 2 },
    nicotine_by_product: { Mint: 8 },
    heatmap_data: [{ name: 'Monday', data: [0, 2] }],
    data_sufficiency: {
      trend: true,
      time_pattern: true,
      brand_pattern: true,
      heatmap: true,
    },
  };

  assert.deepEqual(selectEligibleChartIds(ready, 'daily', { detailsOpen: false }), [
    'consumption-trend-chart',
    'time-of-day-chart',
    'day-of-week-chart',
    'brand-chart',
  ]);
  assert.deepEqual(selectEligibleChartIds(ready, 'daily', { detailsOpen: true }), [
    'consumption-trend-chart',
    'time-of-day-chart',
    'day-of-week-chart',
    'brand-chart',
    'heatmap-chart',
  ]);
  assert.deepEqual(selectEligibleChartIds({
    ...ready,
    consumption_trend: [{ date: '2026-08-01', value: 0 }],
    consumption_by_time_of_day: { Morning: 0 },
    nicotine_by_time_of_day: { Morning: 0 },
    consumption_by_day_of_week: { Monday: 0 },
    brand_analysis: { Mint: 0 },
    nicotine_by_product: { Mint: 0 },
    heatmap_data: [{ name: 'Monday', data: [0, 0] }],
  }, 'daily', { detailsOpen: true }), []);
});

test('a delayed chart generation is destroyed before the latest render becomes active', async () => {
  const { createLatestChartRenderer } = await importModule('static/js/insights.js');
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const runs = [];
  const destroyed = [];
  const renderer = createLatestChartRenderer(async () => {
    const id = runs.length + 1;
    runs.push(id);
    const chart = { destroy: () => destroyed.push(id) };
    if (id === 1) {
      markFirstStarted();
      await firstGate;
    }
    return [chart];
  });

  const first = renderer.render();
  await firstStarted;
  const latest = renderer.render();
  releaseFirst();
  await Promise.all([first, latest]);

  assert.deepEqual(runs, [1, 2]);
  assert.deepEqual(destroyed, [1]);
  renderer.destroy();
  assert.deepEqual(destroyed, [1, 2]);
});

test('chart tasks serialize without losing the newest presentation', async () => {
  const { createSerialTaskQueue } = await importModule('static/js/insights.js');
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const commits = [];
  const queue = createSerialTaskQueue();
  let generation = 0;
  const task = (id, gate = Promise.resolve()) => {
    const ownGeneration = ++generation;
    return queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (id === 1) markFirstStarted();
      await gate;
      const isCurrent = ownGeneration === generation;
      if (isCurrent) commits.push(id);
      active -= 1;
      return isCurrent;
    });
  };

  const first = task(1, firstGate);
  await firstStarted;
  const latest = task(2);
  releaseFirst();
  const results = await Promise.all([first, latest]);

  assert.equal(maxActive, 1);
  assert.deepEqual(commits, [2]);
  assert.deepEqual(results, [false, true]);
});

test('a current range transaction retries after its presentation theme is invalidated', async () => {
  const { buildLatestPresentation } = await importModule('static/js/insights.js');
  let presentationGeneration = 0;
  let theme = 'light';
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const attempts = [];
  const resultPromise = buildLatestPresentation({
    build: async (isCurrent) => {
      const attemptTheme = theme;
      attempts.push(attemptTheme);
      if (attempts.length === 1) {
        markFirstStarted();
        await firstGate;
      }
      return isCurrent() ? { theme: attemptTheme } : null;
    },
    isTransactionCurrent: () => true,
    nextGeneration: () => ++presentationGeneration,
    isGenerationCurrent: (generation) => generation === presentationGeneration,
  });

  await firstStarted;
  theme = 'dark';
  presentationGeneration += 1;
  releaseFirst();
  const result = await resultPromise;

  assert.deepEqual(attempts, ['light', 'dark']);
  assert.deepEqual(result, { theme: 'dark' });
});
