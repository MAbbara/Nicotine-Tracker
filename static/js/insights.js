import {
  enhanceChart,
  getEffectiveTheme,
} from './analytics/runtime.js';
import { createDisclosure } from './analytics/disclosure.js';
import { buildInsightsViewModel } from './insights/view_model.js';

export { buildInsightsViewModel };

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function aggregateToWeekly(points) {
  const weeks = new Map();
  (points || []).forEach((point) => {
    const [year, month, dayOfMonth] = point.date.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
    const monday = new Date(date);
    const day = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - day + 1);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) || 0) + (Number(point.value) || 0));
  });
  return [...weeks].map(([date, value]) => ({ date, value }));
}

export function buildTrendModel(data = {}, trendType = 'daily') {
  const points = trendType === 'weekly'
    ? aggregateToWeekly(data.consumption_trend)
    : data.consumption_trend || [];
  return points.map((point) => ({
    label: point.date,
    value: Number(point.value) || 0,
  }));
}

export function shouldShowTrendDataLabels(pointCount) {
  return pointCount > 0 && pointCount <= 14;
}

export function buildInsightsAlternativeModel(data = {}, trendType = 'daily') {
  const pairs = (value) => Object.entries(value || {}).map(([label, count]) => ({
    label,
    value: Number(count) || 0,
  }));
  const mgRows = (value) => pairs(value).map(({ label, value: mg }) => ({ label, value: mg }));
  const bars = (rows) => {
    const positive = rows.filter(({ value }) => value > 0).sort((a, b) => b.value - a.value);
    const total = positive.reduce((sum, row) => sum + row.value, 0);
    return positive.map(({ label, value }) => ({
      label,
      mg: value,
      share: total ? Math.round((value / total) * 1000) / 10 : 0,
    }));
  };
  const timeOfDayMg = mgRows(data.nicotine_by_time_of_day);
  const productMg = mgRows(data.nicotine_by_product);
  return {
    trend: buildTrendModel(data, trendType),
    timeOfDay: pairs(data.consumption_by_time_of_day),
    dayOfWeek: DAYS.map((label) => ({
      label,
      value: Number(data.consumption_by_day_of_week?.[label]) || 0,
    })),
    brands: pairs(data.brand_analysis),
    timeOfDayMg,
    productMg,
    timeOfDayBars: bars(timeOfDayMg),
    productBars: bars(productMg),
    strengthCoverage: data.strength_coverage || {
      known_pouches: 0, unknown_pouches: 0, total_pouches: 0,
      known_percent: 0, complete: true,
    },
    heatmap: (data.heatmap_data || []).flatMap((series) => (
      (series.data || []).map((point, index) => ({
        day: series.name,
        hour: typeof point === 'object' && point.x != null
          ? String(point.x)
          : `${String(index).padStart(2, '0')}:00`,
        value: Number(typeof point === 'object' ? point.y : point) || 0,
      }))
    )),
  };
}

function hasPositive(values) {
  return (values || []).some((value) => Number(value) > 0);
}

export function selectEligibleChartIds(data = {}, trendType = 'daily', { detailsOpen = false } = {}) {
  const model = buildInsightsAlternativeModel(data, trendType);
  const sufficient = data.data_sufficiency || {};
  const eligible = [];
  if (sufficient.trend && hasPositive(model.trend.map((row) => row.value))) {
    eligible.push('consumption-trend-chart');
  }
  if (sufficient.time_pattern && hasPositive(model.timeOfDayBars.map((row) => row.mg))) {
    eligible.push('time-of-day-chart');
  }
  if (sufficient.trend && hasPositive(model.dayOfWeek.map((row) => row.value))) {
    eligible.push('day-of-week-chart');
  }
  if (sufficient.brand_pattern && hasPositive(model.productBars.map((row) => row.mg))) {
    eligible.push('brand-chart');
  }
  if (detailsOpen && sufficient.heatmap && hasPositive(model.heatmap.map((row) => row.value))) {
    eligible.push('heatmap-chart');
  }
  return eligible;
}

function renderRows(root, key, rows, emptyMessage) {
  const body = root.querySelector(`[data-analytics-key="${key}"]`);
  if (!body) return;
  body.replaceChildren();
  if (!rows.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 2;
    cell.textContent = emptyMessage;
    return;
  }
  rows.forEach(({ label, value }) => {
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    const cell = row.insertCell();
    cell.textContent = String(value);
  });
}

function renderHeatmapRows(root, rows) {
  const body = root.querySelector('[data-analytics-key="heatmap"]');
  const head = body?.closest('table')?.querySelector('thead tr');
  if (!body || !head) return;
  const hours = [...new Set(rows.map((row) => row.hour))];
  const days = [...new Set(rows.map((row) => row.day))];
  head.replaceChildren();
  ['Day', ...hours].forEach((label) => {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    head.append(heading);
  });
  body.replaceChildren();
  if (!rows.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.textContent = 'No hourly pattern available.';
    return;
  }
  days.forEach((day) => {
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = day;
    row.append(heading);
    hours.forEach((hour) => {
      const cell = row.insertCell();
      cell.textContent = String(rows.find((item) => item.day === day && item.hour === hour)?.value ?? 0);
    });
  });
}

function updateAlternatives(root, data, trendType) {
  const model = buildInsightsAlternativeModel(data, trendType);
  renderRows(root, 'trend', model.trend, 'No consumption logged in this range.');
  renderRows(root, 'timeOfDay', model.timeOfDayMg, 'No known-strength nicotine logged in this range.');
  renderRows(root, 'dayOfWeek', model.dayOfWeek, 'No weekly pattern available.');
  renderRows(root, 'brands', model.productMg, 'No known-strength product data in this range.');
  renderHeatmapRows(root, model.heatmap);
  return model;
}

function themeConfig() {
  const mode = getEffectiveTheme(document.documentElement);
  return {
    mode,
    foreColor: mode === 'dark' ? '#EEE8D8' : '#1E2A24',
    gridColor: mode === 'dark' ? '#344139' : '#D7D1C3',
  };
}

function commonChart(type, height, theme) {
  return {
    chart: {
      type,
      height,
      toolbar: { show: false },
      background: 'transparent',
      fontFamily: 'DM Sans, sans-serif',
      animations: { enabled: !window.matchMedia('(prefers-reduced-motion: reduce)').matches },
    },
    theme: { mode: theme.mode },
    grid: { borderColor: theme.gridColor },
    tooltip: { theme: theme.mode },
    legend: { labels: { colors: theme.foreColor } },
  };
}

function barLabelOptions(rows, theme) {
  const narrow = window.innerWidth <= 480;
  const limit = narrow ? 18 : 32;
  return {
    categories: rows.map(({ label }) => label),
    labels: {
      formatter: (label) => String(label).length > limit
        ? `${String(label).slice(0, limit - 1)}…`
        : String(label),
      style: { colors: theme.foreColor },
    },
  };
}

function decorateBarLabels(target, rows) {
  target?.querySelectorAll('.apexcharts-yaxis-label').forEach((label, index) => {
    const fullLabel = rows[index]?.label;
    if (!fullLabel) return;
    label.setAttribute('aria-label', fullLabel);
    let title = label.querySelector('title');
    if (!title) {
      title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      label.append(title);
    }
    title.textContent = fullLabel;
  });
}

function statusFor(target) {
  return target?.parentElement?.querySelector('.analytics-chart__status') || null;
}

export function chartDefinitions(data, trendType) {
  const theme = themeConfig();
  const model = buildInsightsAlternativeModel(data, trendType);
  return [
    ['consumption-trend-chart', {
      ...commonChart('line', 250, theme),
      series: [{ name: trendType === 'weekly' ? 'Weekly pouches' : 'Daily pouches', data: model.trend.map((point) => ({ x: point.label, y: point.value })) }],
      colors: ['#55755F'],
      stroke: { curve: 'smooth', width: 3 },
      dataLabels: { enabled: shouldShowTrendDataLabels(model.trend.length) },
      xaxis: { type: 'datetime', labels: { style: { colors: theme.foreColor } } },
      yaxis: { min: 0, labels: { style: { colors: theme.foreColor } } },
    }],
    ['time-of-day-chart', {
      ...commonChart('bar', 250, theme),
      series: [{ name: 'Nicotine (mg)', data: model.timeOfDayBars.map((row) => row.mg) }],
      plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
      xaxis: barLabelOptions(model.timeOfDayBars, theme),
      yaxis: { labels: { style: { colors: theme.foreColor }, maxWidth: Math.max(72, Math.min(180, Math.floor(window.innerWidth * 0.32))) } },
      colors: ['#55755F'],
      noData: { text: 'No data available' },
    }],
    ['day-of-week-chart', {
      ...commonChart('bar', 250, theme),
      series: [{ name: 'Pouches', data: model.dayOfWeek.map((row) => row.value) }],
      colors: ['#B76343'],
      xaxis: { categories: model.dayOfWeek.map((row) => row.label.slice(0, 3)), labels: { style: { colors: theme.foreColor } } },
      yaxis: { min: 0, labels: { style: { colors: theme.foreColor } } },
    }],
    ['brand-chart', {
      ...commonChart('bar', 250, theme),
      series: [{ name: 'Nicotine (mg)', data: model.productBars.map((row) => row.mg) }],
      plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
      xaxis: barLabelOptions(model.productBars, theme),
      yaxis: { labels: { style: { colors: theme.foreColor }, maxWidth: Math.max(72, Math.min(180, Math.floor(window.innerWidth * 0.32))) } },
      colors: ['#B76343'],
      noData: { text: 'No brand data available' },
    }],
    ['heatmap-chart', {
      ...commonChart('heatmap', 310, theme),
      series: data.heatmap_data || [],
      colors: ['#55755F'],
      xaxis: { labels: { style: { colors: theme.foreColor } } },
    }],
  ];
}

function updateMetrics(root, data, viewModel) {
  const values = {
    'total-pouches': data.total_pouches ?? 0,
    'daily-average': data.daily_average ?? 0,
    'peak-day': data.peak_day ?? '--',
    'avg-time-between': data.average_time_between_pouches ?? '--',
    'total-nicotine': data.total_nicotine ?? 0,
    'best-day': data.best_day ?? '--',
    'consistency-score': `${data.consistency_score ?? 0}%`,
    'trend-direction': data.trend_direction ?? '--',
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = root.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  });
  root.querySelectorAll('.insights-measures dd').forEach((element, index) => {
    if (viewModel.metrics[index]) element.textContent = viewModel.metrics[index].value;
  });
}

function updateEditorial(root, viewModel, rangeDays) {
  root.dataset.insightsState = viewModel.state;
  const setText = (selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  };
  setText('[data-insights-headline]', viewModel.headline);
  setText('[data-insights-interpretation]', viewModel.interpretation);
  setText('[data-insights-plan-context]', viewModel.planContext.interpretation);
  setText('[data-insights-time-copy]', viewModel.sections.timePattern.interpretation);
  setText('[data-insights-weekly-copy]', viewModel.sections.weeklyPattern.interpretation);
  setText('[data-insights-product-copy]', viewModel.sections.productPattern.interpretation);
  setText('[data-insights-hourly-copy]', viewModel.sections.hourlyDetail.interpretation);
  const distributionCopy = (model, subject) => {
    if (model.state === 'no-logs') return `No nicotine is available by ${subject} yet. ${model.coverageCopy}`;
    if (model.state === 'unknown-only') return `Nicotine by ${subject} is unavailable because every logged pouch is missing a saved strength. ${model.coverageCopy}`;
    if (model.state === 'known-zero') return `Known strengths in this range add up to 0 mg by ${subject}. ${model.coverageCopy}`;
    if (model.state === 'single') return `All known nicotine in this range is in one ${subject} category. ${model.coverageCopy}`;
    return `${model.coverageCopy} Bars show known nicotine only.`;
  };
  setText('[data-insights-time-nicotine-copy]', distributionCopy(viewModel.sections.timeNicotine, 'time'));
  setText('[data-insights-product-nicotine-copy]', distributionCopy(viewModel.sections.productNicotine, 'product'));
  const planContext = root.querySelector('[data-insights-plan-context]');
  if (planContext) planContext.hidden = !viewModel.planContext.visible;
  const cravingPattern = root.querySelector('[data-craving-pattern]');
  if (cravingPattern) {
    cravingPattern.hidden = !viewModel.cravingPattern.visible;
    setText('[data-insights-craving-copy]', viewModel.cravingPattern.interpretation);
    setText(
      '[data-craving-leading-trigger]',
      viewModel.cravingPattern.leadingTrigger || '',
    );
    setText(
      '[data-craving-resolved-pattern]',
      viewModel.cravingPattern.resolvedPattern || '',
    );
    setText(
      '[data-craving-non-nicotine-rate]',
      viewModel.cravingPattern.nonNicotineResponse || '',
    );
  }
  const nextStep = root.querySelector('[data-insights-next-step]');
  if (nextStep) {
    nextStep.textContent = viewModel.nextStep.label;
    nextStep.href = viewModel.nextStep.href;
  }
  root.querySelectorAll('[data-days]').forEach((control) => {
    const selected = Number(control.dataset.days) === rangeDays;
    control.classList.toggle('is-active', selected);
    if (selected) control.setAttribute('aria-current', 'true');
    else control.removeAttribute('aria-current');
  });
  const exportButton = root.querySelector('#export-data');
  if (exportButton) exportButton.dataset.exportHref = `/insights/api/export?days=${rangeDays}`;
}

function setLoadStatus(root, message = '') {
  let status = root.querySelector('[data-insights-load-status]');
  if (!status) {
    status = document.createElement('p');
    status.dataset.insightsLoadStatus = '';
    status.className = 'analytics-chart__status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.querySelector('.insights-actions')?.append(status);
  }
  status.textContent = message;
  status.hidden = !message;
}

function setPending(root, pending, message = '') {
  if (pending) root.setAttribute('aria-busy', 'true');
  else root.removeAttribute('aria-busy');
  root.querySelectorAll('[data-days]').forEach((control) => {
    const requested = pending && Number(control.dataset.days) === Number(root.dataset.pendingDays);
    control.classList.toggle('is-pending', requested);
    if (requested) control.setAttribute('aria-busy', 'true');
    else control.removeAttribute('aria-busy');
  });
  setLoadStatus(root, message);
}

function exportFilename(response) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  try {
    return decodeURIComponent(encoded || plain || 'nicotine-data.csv');
  } catch {
    return plain || 'nicotine-data.csv';
  }
}

async function exportRange(root, days) {
  const button = root.querySelector('#export-data');
  if (!button || button.disabled) return;
  if (root.dataset.insightsState === 'empty') {
    setLoadStatus(root, 'There is no data to export in this range yet.');
    return;
  }
  const initiatedWithFocus = document.activeElement === button;
  button.disabled = true;
  const focusAfterDisable = document.activeElement;
  button.setAttribute('aria-busy', 'true');
  setLoadStatus(root, 'Preparing CSV…');
  try {
    const response = await fetch(`/insights/api/export?days=${days}`);
    if (!response.ok) {
      if (response.status === 404) {
        setLoadStatus(root, 'There is no data to export in this range yet.');
        return;
      }
      throw new Error(`Export request failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = url;
    download.download = exportFilename(response);
    download.hidden = true;
    document.body.append(download);
    download.click();
    download.remove();
    URL.revokeObjectURL(url);
    setLoadStatus(root);
  } catch (_) {
    setLoadStatus(root, 'The CSV could not be prepared. Your insights are still available.');
  } finally {
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    const focusWasNotMoved = (
      document.activeElement === focusAfterDisable
      || document.activeElement === button
    );
    if (
      initiatedWithFocus
      && focusWasNotMoved
      && root.isConnected
      && button.isConnected
      && document.visibilityState === 'visible'
    ) button.focus();
  }
}

export function renderInsights(
  root,
  viewModel,
  rawData,
  { rangeDays = 30, trendType = 'daily', detailsOpen = false } = {},
) {
  updateEditorial(root, viewModel, rangeDays);
  updateMetrics(root, rawData, viewModel);
  updateAlternatives(root, rawData, trendType);
  root.querySelectorAll('.trend-toggle').forEach((control) => {
    const selected = control.dataset.type === trendType;
    control.classList.toggle('is-active', selected);
    control.setAttribute('aria-pressed', String(selected));
  });
  const eligible = new Set(selectEligibleChartIds(rawData, trendType, { detailsOpen }));
  root.querySelectorAll('.analytics-chart').forEach((target) => {
    target.hidden = !eligible.has(target.id);
    if (target.hidden) {
      target.replaceChildren();
      const status = statusFor(target);
      if (status) {
        status.textContent = '';
        status.hidden = true;
      }
    }
  });
  return eligible;
}

export function createLatestChartRenderer(renderSnapshot) {
  let requestedGeneration = 0;
  let activeCharts = [];
  let queue = Promise.resolve();
  const destroyCharts = (charts) => {
    charts.forEach((chart) => chart?.destroy?.());
  };
  const render = () => {
    const generation = ++requestedGeneration;
    const execute = async () => {
      if (generation !== requestedGeneration) return;
      destroyCharts(activeCharts);
      activeCharts = [];
      const nextCharts = (await renderSnapshot({
        isCurrent: () => generation === requestedGeneration,
      })) || [];
      if (generation !== requestedGeneration) {
        destroyCharts(nextCharts);
        return;
      }
      activeCharts = nextCharts.filter(Boolean);
    };
    queue = queue.then(execute, execute);
    return queue;
  };
  const destroy = () => {
    requestedGeneration += 1;
    destroyCharts(activeCharts);
    activeCharts = [];
  };
  return { render, destroy };
}

export function createSerialTaskQueue() {
  let tail = Promise.resolve();
  const run = (task) => {
    const execute = () => task();
    tail = tail.then(execute, execute);
    return tail;
  };
  return { run };
}

export function captureInsightsFocus(root, activeElement, enabled = true) {
  if (!enabled || !activeElement || !root?.contains?.(activeElement)) return null;
  for (const [selector, kind, dataKey] of [
    ['[data-days]', 'range', 'days'],
    ['.trend-toggle[data-type]', 'trend', 'type'],
  ]) {
    const control = activeElement.closest?.(selector);
    if (!control || !root.contains(control)) continue;
    const value = control.dataset?.[dataKey];
    if (value) return { kind, value: String(value) };
  }
  const summary = activeElement.closest?.('.analytics-details > summary');
  if (summary && root.contains(summary)) {
    const value = summary.textContent?.trim();
    if (value) return { kind: 'summary', value };
  }
  return null;
}

export function restoreInsightsFocus(root, identity, activeDocument = document) {
  if (!identity || activeDocument?.visibilityState !== 'visible') return false;
  const definition = {
    range: { selector: '[data-days]', dataKey: 'days' },
    trend: { selector: '.trend-toggle[data-type]', dataKey: 'type' },
    summary: { selector: '.analytics-details > summary', text: true },
  }[identity.kind];
  if (!definition) return false;
  const replacement = [...root.querySelectorAll(definition.selector)].find((control) => (
    definition.text
      ? control.textContent?.trim() === identity.value
      : String(control.dataset?.[definition.dataKey]) === identity.value
  ));
  if (!replacement?.focus) return false;
  replacement.focus({ preventScroll: true });
  return true;
}

export async function buildLatestPresentation({
  build,
  isTransactionCurrent,
  nextGeneration,
  isGenerationCurrent,
}) {
  while (isTransactionCurrent()) {
    const generation = nextGeneration();
    const isCurrent = () => (
      isTransactionCurrent() && isGenerationCurrent(generation)
    );
    const candidate = await build(isCurrent);
    if (candidate && isCurrent()) return candidate;
  }
  return null;
}

export async function startInsights(scope = document) {
  const root = scope.matches?.('[data-insights-root]')
    ? scope
    : scope.querySelector?.('[data-insights-root]');
  const payload = scope.querySelector?.('#initial-insights-data')
    || document.getElementById('initial-insights-data');
  if (!root || !payload || root.dataset.insightsStarted === 'true') return null;
  root.dataset.insightsStarted = 'true';
  let currentData = JSON.parse(payload.textContent || '{}');
  let currentRange = Number(currentData.range_days) || 30;
  let trendType = 'daily';
  let requestGeneration = 0;
  let presentationGeneration = 0;
  let rangeController = null;
  let activeCharts = [];
  let detailsOpen = Boolean(root.querySelector('.analytics-details')?.open);
  let committedHistoryIndex = Number(history.state?.insightsIndex);
  if (!Number.isFinite(committedHistoryIndex)) committedHistoryIndex = 0;
  history.replaceState({
    ...(history.state || {}),
    insightsIndex: committedHistoryIndex,
    days: currentRange,
  }, '', window.location.href);
  let suppressPop = false;
  const disclosure = createDisclosure({
    trigger: document.querySelector('[data-analytics-disclosure-trigger]'),
    panel: document.querySelector('[data-analytics-disclosure-menu]'),
  });
  const destroyCharts = (charts) => charts.forEach((chart) => chart?.destroy?.());
  const chartRenderQueue = createSerialTaskQueue();

  const renderCharts = async (
    targetRoot, data, range,
    { strict = false, isCurrent = () => true } = {},
  ) => {
    const charts = [];
    const viewModel = buildInsightsViewModel(data, range);
    const eligible = renderInsights(targetRoot, viewModel, data, {
      rangeDays: range,
      trendType,
      detailsOpen: Boolean(targetRoot.querySelector('.analytics-details')?.open),
    });
    const alternative = buildInsightsAlternativeModel(data, trendType);
    for (const [id, options] of chartDefinitions(data, trendType)) {
      if (!eligible.has(id)) continue;
      if (!isCurrent()) {
        destroyCharts(charts);
        return null;
      }
      const target = targetRoot.querySelector(`#${id}`);
      const chart = await chartRenderQueue.run(async () => {
        if (!isCurrent()) return null;
        return enhanceChart({
          target,
          status: statusFor(target),
          options,
          ApexChartsClass: window.ApexCharts,
        });
      });
      if (!isCurrent()) {
        chart?.destroy?.();
        destroyCharts(charts);
        return null;
      }
      if (!chart && strict && typeof window.ApexCharts === 'function') {
        destroyCharts(charts);
        throw new Error(`Candidate chart failed: ${id}`);
      }
      if (chart) {
        charts.push(chart);
        if (id === 'time-of-day-chart') decorateBarLabels(target, alternative.timeOfDayBars);
        if (id === 'brand-chart') decorateBarLabels(target, alternative.productBars);
      }
      if (!isCurrent()) {
        destroyCharts(charts);
        return null;
      }
    }
    return charts;
  };

  const buildCandidate = async (
    data, range, isCurrent, { strict = true } = {},
  ) => {
    const host = document.createElement('div');
    host.className = 'insights-staging';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0 auto auto -10000px',
      width: `${Math.max(320, root.getBoundingClientRect().width)}px`,
      visibility: 'hidden',
      pointerEvents: 'none',
    });
    const candidateRoot = root.cloneNode(true);
    candidateRoot.dataset.insightsCandidate = 'true';
    candidateRoot.querySelectorAll('.analytics-chart').forEach((target) => target.replaceChildren());
    host.attachShadow({ mode: 'open' }).append(candidateRoot);
    document.body.append(host);
    let charts = [];
    let completed = false;
    try {
      if (!isCurrent()) return null;
      charts = await renderCharts(candidateRoot, data, range, {
        strict,
        isCurrent,
      });
      if (!charts || !isCurrent()) {
        destroyCharts(charts || []);
        return null;
      }
      delete candidateRoot.dataset.pendingDays;
      setPending(candidateRoot, false);
      completed = true;
      return { host, root: candidateRoot, charts };
    } catch (error) {
      destroyCharts(charts);
      throw error;
    } finally {
      if (!completed) host.remove();
    }
  };

  const commitCandidate = (candidate, data, range, { preserveFocus = false } = {}) => {
    const focusIdentity = captureInsightsFocus(root, document.activeElement, preserveFocus);
    const previousCharts = activeCharts;
    root.replaceChildren(...candidate.root.childNodes);
    root.dataset.insightsState = candidate.root.dataset.insightsState;
    root.removeAttribute('aria-busy');
    delete root.dataset.pendingDays;
    currentData = data;
    currentRange = range;
    activeCharts = candidate.charts;
    detailsOpen = Boolean(root.querySelector('.analytics-details')?.open);
    candidate.host.remove();
    destroyCharts(previousCharts);
    restoreInsightsFocus(root, focusIdentity, document);
  };

  const renderLive = async ({ preserveFocus = false } = {}) => {
    const generation = ++presentationGeneration;
    if (root.getAttribute('aria-busy') === 'true') return false;
    const candidate = await buildCandidate(
      currentData,
      currentRange,
      () => generation === presentationGeneration,
      { strict: false },
    );
    if (!candidate || generation !== presentationGeneration) return false;
    commitCandidate(candidate, currentData, currentRange, { preserveFocus });
    return true;
  };

  const loadRange = async (
    days,
    { historyMode = 'push', targetHistoryIndex = null } = {},
  ) => {
    if (![7, 30, 90, 365].includes(Number(days))) return false;
    if (historyMode === 'push' && Number(days) === currentRange) return true;
    presentationGeneration += 1;
    rangeController?.abort();
    rangeController = new AbortController();
    const controller = rangeController;
    const generation = ++requestGeneration;
    root.dataset.pendingDays = String(days);
    setPending(root, true, 'Updating insights…');
    try {
      const response = await fetch(`/insights/api/insights?days=${days}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Insights request failed (${response.status})`);
      const data = await response.json();
      if (generation !== requestGeneration || controller.signal.aborted) return false;
      const candidateRange = Number(data.range_days) || Number(days);
      const isTransactionCurrent = () => (
        generation === requestGeneration && !controller.signal.aborted
      );
      const candidate = await buildLatestPresentation({
        build: (isCurrent) => buildCandidate(
          data,
          candidateRange,
          isCurrent,
        ),
        isTransactionCurrent,
        nextGeneration: () => ++presentationGeneration,
        isGenerationCurrent: (candidateGeneration) => (
          candidateGeneration === presentationGeneration
        ),
      });
      if (!candidate) return false;
      if (generation !== requestGeneration || controller.signal.aborted) return false;
      commitCandidate(candidate, data, candidateRange, {
        preserveFocus: historyMode === 'push',
      });
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('days', String(currentRange));
      if (historyMode === 'push') {
        committedHistoryIndex += 1;
        history.pushState({
          insightsIndex: committedHistoryIndex,
          days: currentRange,
        }, '', nextUrl);
      } else if (historyMode === 'replace') {
        history.replaceState({
          insightsIndex: committedHistoryIndex,
          days: currentRange,
        }, '', nextUrl);
      } else if (historyMode === 'pop') {
        committedHistoryIndex = targetHistoryIndex;
      }
      setPending(root, false);
      delete root.dataset.pendingDays;
      return true;
    } catch (_) {
      if (generation !== requestGeneration || controller.signal.aborted) return false;
      if (historyMode === 'pop' && Number.isFinite(targetHistoryIndex)) {
        const recoveryDelta = committedHistoryIndex - targetHistoryIndex;
        if (recoveryDelta) {
          suppressPop = true;
          history.go(recoveryDelta);
        }
      }
      setPending(root, false, 'Insights could not refresh. Your current values are still available; choose the range again to retry.');
      delete root.dataset.pendingDays;
      return false;
    }
  };

  root.addEventListener('click', (event) => {
    const item = event.target.closest?.('.dropdown-item[data-days]');
    if (item) {
      event.preventDefault();
      const days = Number(item.dataset.days) || 30;
      disclosure?.close();
      loadRange(days);
      return;
    }
    const button = event.target.closest?.('.trend-toggle');
    if (button) {
      trendType = button.dataset.type === 'weekly' ? 'weekly' : 'daily';
      renderLive({ preserveFocus: true });
      return;
    }
    if (event.target.closest?.('#export-data')) exportRange(root, currentRange);
  });
  root.addEventListener('toggle', (event) => {
    if (!event.target.matches?.('.analytics-details')) return;
    if (event.target.open === detailsOpen) return;
    detailsOpen = event.target.open;
    renderLive({ preserveFocus: true });
  }, true);
  document.documentElement.addEventListener('nicotine-tracker:theme-change', renderLive);
  window.addEventListener('popstate', (event) => {
    if (suppressPop) {
      suppressPop = false;
      return;
    }
    const targetHistoryIndex = Number(event.state?.insightsIndex);
    if (!Number.isFinite(targetHistoryIndex)) return;
    const days = Number(event.state?.days)
      || Number(new URL(window.location.href).searchParams.get('days'))
      || 30;
    loadRange(days, { historyMode: 'pop', targetHistoryIndex });
  });
  await renderLive();
  return { render: renderLive, loadRange };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startInsights(); }, { once: true });
  } else {
    startInsights();
  }
}
