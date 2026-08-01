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
  const BrokenChart = class { render() { return Promise.reject(new Error('boom')); } };
  const result = await enhanceChart({
    target: {}, status, options: { series: [] }, ApexChartsClass: BrokenChart,
  });
  assert.equal(result, null);
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
