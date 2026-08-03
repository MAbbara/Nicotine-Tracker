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
  return {
    trend: buildTrendModel(data, trendType),
    timeOfDay: pairs(data.consumption_by_time_of_day),
    dayOfWeek: DAYS.map((label) => ({
      label,
      value: Number(data.consumption_by_day_of_week?.[label]) || 0,
    })),
    brands: pairs(data.brand_analysis),
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
  if (sufficient.time_pattern && hasPositive(model.timeOfDay.map((row) => row.value))) {
    eligible.push('time-of-day-chart');
  }
  if (sufficient.trend && hasPositive(model.dayOfWeek.map((row) => row.value))) {
    eligible.push('day-of-week-chart');
  }
  if (sufficient.brand_pattern && hasPositive(model.brands.map((row) => row.value))) {
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
  renderRows(root, 'timeOfDay', model.timeOfDay, 'No consumption logged in this range.');
  renderRows(root, 'dayOfWeek', model.dayOfWeek, 'No weekly pattern available.');
  renderRows(root, 'brands', model.brands, 'No brand data in this range.');
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

function statusFor(target) {
  return target?.parentElement?.querySelector('.analytics-chart__status') || null;
}

function chartDefinitions(data, trendType) {
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
      ...commonChart('donut', 250, theme),
      series: model.timeOfDay.map((row) => row.value),
      labels: model.timeOfDay.map((row) => row.label),
      colors: ['#55755F', '#B76343', '#C5A05A', '#7C8B80'],
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
      ...commonChart('donut', 250, theme),
      series: model.brands.map((row) => row.value),
      labels: model.brands.map((row) => row.label),
      colors: ['#55755F', '#B76343', '#C5A05A', '#7C8B80', '#944733'],
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
  setText('[data-insights-time-copy]', viewModel.sections.timePattern.interpretation);
  setText('[data-insights-weekly-copy]', viewModel.sections.weeklyPattern.interpretation);
  setText('[data-insights-product-copy]', viewModel.sections.productPattern.interpretation);
  setText('[data-insights-hourly-copy]', viewModel.sections.hourlyDetail.interpretation);
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
    if (pending) control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
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
  let rangePending = false;
  const disclosure = createDisclosure({
    trigger: document.querySelector('[data-analytics-disclosure-trigger]'),
    panel: document.querySelector('[data-analytics-disclosure-menu]'),
  });
  const details = root.querySelector('.analytics-details');

  const chartRenderer = createLatestChartRenderer(async ({ isCurrent }) => {
    const charts = [];
    const viewModel = buildInsightsViewModel(currentData, currentRange);
    const eligible = renderInsights(root, viewModel, currentData, {
      rangeDays: currentRange,
      trendType,
      detailsOpen: Boolean(details?.open),
    });
    for (const [id, options] of chartDefinitions(currentData, trendType)) {
      if (!eligible.has(id)) continue;
      const target = root.querySelector(`#${id}`);
      const chart = await enhanceChart({
        target,
        status: statusFor(target),
        options,
        ApexChartsClass: window.ApexCharts,
      });
      if (chart) charts.push(chart);
      if (!isCurrent()) break;
    }
    return charts;
  });
  const render = chartRenderer.render;

  const loadRange = async (days) => {
    if (rangePending) return;
    rangePending = true;
    const generation = ++requestGeneration;
    setPending(root, true, 'Updating insights…');
    try {
      const response = await fetch(`/insights/api/insights?days=${days}`);
      if (!response.ok) throw new Error(`Insights request failed (${response.status})`);
      const data = await response.json();
      if (generation !== requestGeneration) return;
      currentData = data;
      currentRange = days;
      await render();
      setPending(root, false);
    } catch (_) {
      if (generation !== requestGeneration) return;
      setPending(root, false, 'Insights could not refresh. Your current values are still available; choose the range again to retry.');
    } finally {
      rangePending = false;
    }
  };

  root.querySelectorAll('.dropdown-item[data-days]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      if (item.getAttribute('aria-disabled') === 'true') return;
      const days = Number(item.dataset.days) || 30;
      disclosure?.close();
      loadRange(days);
    });
  });
  root.querySelectorAll('.trend-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      trendType = button.dataset.type === 'weekly' ? 'weekly' : 'daily';
      render();
    });
  });
  root.querySelector('#export-data')?.addEventListener('click', () => {
    exportRange(root, currentRange);
  });
  details?.addEventListener('toggle', render);
  document.documentElement.addEventListener('nicotine-tracker:theme-change', render);
  await render();
  return { render, loadRange };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startInsights(); }, { once: true });
  } else {
    startInsights();
  }
}
