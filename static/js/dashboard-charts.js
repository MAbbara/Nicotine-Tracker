import { enhanceChart, getEffectiveTheme, setChartFailure } from './analytics/runtime.js';

function statusFor(target) {
  return target?.parentElement?.querySelector('.analytics-chart__status') || null;
}

function replaceRows(selector, rows, fields) {
  const body = document.querySelector(selector);
  if (!body) return;
  body.replaceChildren();
  rows.forEach((item) => {
    const row = body.insertRow();
    fields.forEach((field, index) => {
      const cell = index === 0 ? document.createElement('th') : document.createElement('td');
      if (index === 0) cell.scope = 'row';
      cell.textContent = String(item[field] ?? 0);
      row.append(cell);
    });
  });
}

function chartTheme() {
  const mode = getEffectiveTheme(document.documentElement);
  return {
    mode,
    foreColor: mode === 'dark' ? '#EEE8D8' : '#1E2A24',
    gridColor: mode === 'dark' ? '#344139' : '#D7D1C3',
  };
}

function baseOptions(type, theme) {
  return {
    chart: {
      type,
      height: 256,
      toolbar: { show: false },
      background: 'transparent',
      fontFamily: 'DM Sans, sans-serif',
      animations: { enabled: !window.matchMedia('(prefers-reduced-motion: reduce)').matches },
    },
    theme: { mode: theme.mode },
    grid: { borderColor: theme.gridColor, strokeDashArray: 4 },
    tooltip: { theme: theme.mode },
  };
}

async function startDashboardCharts() {
  const payload = document.getElementById('initial-dashboard-analytics');
  if (!payload) return;
  let data = JSON.parse(payload.textContent || '{"trend":[],"hourly":[]}');
  let charts = [];

  const render = async () => {
    charts.forEach((chart) => chart?.destroy?.());
    charts = [];
    replaceRows('[data-dashboard-table="trend"]', data.trend || [], ['date', 'pouches', 'mg']);
    replaceRows('[data-dashboard-table="hourly"]', data.hourly || [], ['hour', 'pouches']);
    const theme = chartTheme();
    const definitions = [
      ['dailyIntakeChart', {
        ...baseOptions('line', theme),
        series: [{ name: 'Pouches', data: (data.trend || []).map((point) => Number(point.pouches) || 0) }],
        colors: ['#55755F'],
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { categories: (data.trend || []).map((point) => point.date), labels: { style: { colors: theme.foreColor } } },
        yaxis: { min: 0, labels: { style: { colors: theme.foreColor } } },
      }],
      ['hourlyChart', {
        ...baseOptions('bar', theme),
        series: [{ name: 'Pouches', data: (data.hourly || []).map((point) => Number(point.pouches) || 0) }],
        colors: ['#B76343'],
        xaxis: { categories: (data.hourly || []).map((point) => point.hour), labels: { style: { colors: theme.foreColor } } },
        yaxis: { min: 0, labels: { style: { colors: theme.foreColor } } },
      }],
    ];
    for (const [id, options] of definitions) {
      const target = document.getElementById(id);
      charts.push(await enhanceChart({
        target,
        status: statusFor(target),
        options,
        ApexChartsClass: window.ApexCharts,
      }));
    }
  };

  const load = async (days) => {
    try {
      const [trendResponse, hourlyResponse] = await Promise.all([
        fetch(`/dashboard/api/daily_intake_chart?days=${days}`),
        fetch(`/dashboard/api/hourly_distribution?days=${days}`),
      ]);
      const [trend, hourly] = await Promise.all([trendResponse.json(), hourlyResponse.json()]);
      if (!trendResponse.ok || !hourlyResponse.ok || !trend.success || !hourly.success) {
        throw new Error('Analytics request failed');
      }
      data = { trend: trend.data, hourly: hourly.data };
      await render();
    } catch (_) {
      document.querySelectorAll('.analytics-chart__status').forEach((status) => {
        setChartFailure(status, 'Chart unavailable. Current table values remain available.');
      });
    }
  };

  document.querySelectorAll('#daily-intake-filter-dropdown [data-range]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const days = Number(link.dataset.range) || 30;
      const label = document.getElementById('selected-range-text');
      if (label) label.textContent = link.textContent.trim();
      load(days);
    });
  });
  document.getElementById('hs-dropdown-default')?.addEventListener('click', () => {
    document.getElementById('daily-intake-filter-dropdown')?.classList.toggle('hidden');
  });
  document.getElementById('apply_custom_range')?.addEventListener('click', () => {
    const start = document.getElementById('start_date_filter')?.value;
    const end = document.getElementById('end_date_filter')?.value;
    if (!start || !end) return;
    const days = Math.max(1, Math.min(365, Math.round((new Date(end) - new Date(start)) / 86400000) + 1));
    load(days);
  });
  window.addEventListener('nicotine-tracker:theme-change', render);
  await render();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startDashboardCharts(); }, { once: true });
  } else {
    startDashboardCharts();
  }
}
