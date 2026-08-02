import { enhanceChart, getEffectiveTheme, setChartFailure } from './analytics/runtime.js';


const PAGE_SELECTOR = '[data-dashboard-page]';


export function trendHasData(points) {
  return Array.isArray(points) && points.some((point) => Number(point?.pouches) > 0);
}


export function dashboardTrendOptions(points, { theme = 'light', reducedMotion = false } = {}) {
  const dark = theme === 'dark';
  const foreground = dark ? '#EEE8D8' : '#1E2A24';
  const grid = dark ? '#465148' : '#D7D1C3';

  return {
    chart: {
      type: 'line',
      height: 288,
      toolbar: { show: false },
      zoom: { enabled: false },
      background: 'transparent',
      fontFamily: 'DM Sans, sans-serif',
      animations: { enabled: !reducedMotion },
    },
    series: [{
      name: 'Pouches',
      data: points.map((point) => Number(point.pouches) || 0),
    }],
    colors: ['#55755F'],
    dataLabels: { enabled: false },
    stroke: { curve: 'straight', width: 3 },
    markers: { size: 3, strokeWidth: 0 },
    fill: { opacity: 1 },
    grid: { borderColor: grid, strokeDashArray: 4 },
    theme: { mode: theme },
    tooltip: { theme },
    xaxis: {
      categories: points.map((point) => point.date),
      labels: { style: { colors: foreground } },
      axisBorder: { color: grid },
      axisTicks: { color: grid },
    },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: { style: { colors: foreground } },
    },
    legend: { show: false },
  };
}


function parsePayload(root) {
  const payload = root.querySelector('#initial-dashboard-analytics');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload.textContent || '{}');
    return trendHasData(parsed.trend) ? parsed.trend : null;
  } catch (_) {
    return null;
  }
}


export async function startDashboardCharts(root = document, environment = window) {
  const page = root.querySelector(PAGE_SELECTOR);
  if (!page || page.dataset.dashboardChartsStarted === 'true') return false;

  const target = page.querySelector('#dashboard-trend-chart');
  const status = page.querySelector('.analytics-chart__status');
  const points = parsePayload(page);
  if (!target || !points) {
    setChartFailure(status, 'Chart unavailable. The daily values remain available below.');
    return false;
  }

  page.dataset.dashboardChartsStarted = 'true';
  let chart = null;
  let renderQueue = Promise.resolve();
  const reducedMotion = environment.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.dataset.motion = reducedMotion ? 'reduced' : 'full';

  const render = () => {
    renderQueue = renderQueue.then(async () => {
      chart?.destroy?.();
      chart = null;
      target.replaceChildren();
      target.hidden = false;
      const theme = getEffectiveTheme(root.documentElement);
      chart = await enhanceChart({
        target,
        status,
        options: dashboardTrendOptions(points, { theme, reducedMotion }),
        ApexChartsClass: environment.ApexCharts,
      });
      target.hidden = !chart;
    });
    return renderQueue;
  };

  root.documentElement.addEventListener('nicotine-tracker:theme-change', render);
  await render();
  return true;
}


if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startDashboardCharts(); }, { once: true });
  } else {
    startDashboardCharts();
  }
}
