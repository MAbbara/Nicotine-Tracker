import {
  enhanceChart,
  getEffectiveTheme,
  setChartFailure,
} from './analytics/runtime.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function buildInsightsAlternativeModel(data = {}) {
  const pairs = (value) => Object.entries(value || {}).map(([label, count]) => ({
    label,
    value: Number(count) || 0,
  }));
  return {
    trend: (data.consumption_trend || []).map((point) => ({
      label: point.date,
      value: Number(point.value) || 0,
    })),
    timeOfDay: pairs(data.consumption_by_time_of_day),
    dayOfWeek: DAYS.map((label) => ({
      label,
      value: Number(data.consumption_by_day_of_week?.[label]) || 0,
    })),
    brands: pairs(data.brand_analysis),
    heatmap: (data.heatmap_data || []).map((series) => ({
      label: series.name,
      value: (series.data || []).reduce((total, point) => (
        total + (Number(typeof point === 'object' ? point.y : point) || 0)
      ), 0),
    })),
  };
}

function renderRows(key, rows, emptyMessage) {
  const body = document.querySelector(`[data-analytics-key="${key}"]`);
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

function updateAlternatives(data) {
  const model = buildInsightsAlternativeModel(data);
  renderRows('trend', model.trend, 'No consumption logged in this range.');
  renderRows('timeOfDay', model.timeOfDay, 'No consumption logged in this range.');
  renderRows('dayOfWeek', model.dayOfWeek, 'No weekly pattern available.');
  renderRows('brands', model.brands, 'No brand data in this range.');
  renderRows('heatmap', model.heatmap, 'No hourly pattern available.');
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

function aggregateToWeekly(points) {
  const weeks = new Map();
  (points || []).forEach((point) => {
    const date = new Date(`${point.date}T00:00:00`);
    const monday = new Date(date);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) || 0) + (Number(point.value) || 0));
  });
  return [...weeks].map(([date, value]) => ({ date, value }));
}

function chartDefinitions(data, trendType) {
  const theme = themeConfig();
  const model = buildInsightsAlternativeModel(data);
  const trend = trendType === 'weekly' ? aggregateToWeekly(data.consumption_trend) : data.consumption_trend || [];
  return [
    ['consumption-trend-chart', {
      ...commonChart('line', 250, theme),
      series: [{ name: trendType === 'weekly' ? 'Weekly pouches' : 'Daily pouches', data: trend.map((point) => ({ x: point.date, y: Number(point.value) || 0 })) }],
      colors: ['#55755F'],
      stroke: { curve: 'smooth', width: 3 },
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

function updateMetrics(data) {
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
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  });
}

function updateCoachNotes(data) {
  const container = document.getElementById('ai-insights');
  if (!container) return;
  container.replaceChildren();
  if (!(data.ai_insights || []).length) {
    const message = document.createElement('p');
    message.className = 'text-sm text-gray-500 dark:text-gray-400';
    message.textContent = 'No patterns yet. Keep logging and this view will become more useful.';
    container.append(message);
    return;
  }
  data.ai_insights.forEach((insight) => {
    const item = document.createElement('article');
    const title = document.createElement('h4');
    const description = document.createElement('p');
    title.textContent = insight.title || 'Pattern';
    description.textContent = insight.description || '';
    item.append(title, description);
    container.append(item);
  });
}

async function startInsights() {
  const payload = document.getElementById('initial-insights-data');
  if (!payload) return;
  let currentData = JSON.parse(payload.textContent || '{}');
  let currentRange = 30;
  let trendType = 'daily';
  let charts = [];

  const render = async () => {
    charts.forEach((chart) => chart?.destroy?.());
    charts = [];
    updateMetrics(currentData);
    updateAlternatives(currentData);
    updateCoachNotes(currentData);
    for (const [id, options] of chartDefinitions(currentData, trendType)) {
      const target = document.getElementById(id);
      const chart = await enhanceChart({
        target,
        status: statusFor(target),
        options,
        ApexChartsClass: window.ApexCharts,
      });
      charts.push(chart);
    }
  };

  const loadRange = async (days) => {
    try {
      const response = await fetch(`/insights/api/insights?days=${days}`);
      if (!response.ok) throw new Error(`Insights request failed (${response.status})`);
      currentData = await response.json();
      currentRange = days;
      await render();
    } catch (_) {
      document.querySelectorAll('.analytics-chart__status').forEach((status) => {
        setChartFailure(status, 'Chart unavailable. Current table values remain available.');
      });
    }
  };

  document.querySelectorAll('.dropdown-item[data-days]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      const days = Number(item.dataset.days) || 30;
      const label = document.getElementById('selected-range');
      if (label) label.textContent = item.textContent.trim();
      loadRange(days);
    });
  });
  document.getElementById('hs-dropdown-default')?.addEventListener('click', () => {
    document.querySelector('.hs-dropdown-menu')?.classList.toggle('hidden');
  });
  document.querySelectorAll('.trend-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      trendType = button.dataset.type === 'weekly' ? 'weekly' : 'daily';
      render();
    });
  });
  document.getElementById('export-data')?.addEventListener('click', () => {
    window.location.assign(`/insights/api/export?days=${currentRange}`);
  });
  window.addEventListener('nicotine-tracker:theme-change', render);
  await render();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startInsights(); }, { once: true });
  } else {
    startInsights();
  }
}
