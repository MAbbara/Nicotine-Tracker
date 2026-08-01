const FAILURE_MESSAGE = 'Chart unavailable. The data table remains available below.';

export function getEffectiveTheme(root) {
  return root?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

export function setChartFailure(status, message = FAILURE_MESSAGE) {
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
}

export async function enhanceChart({ target, status, options, ApexChartsClass }) {
  if (!target || typeof ApexChartsClass !== 'function') {
    setChartFailure(status);
    return null;
  }

  try {
    const chart = new ApexChartsClass(target, options);
    await chart.render();
    if (status) {
      status.textContent = '';
      status.hidden = true;
    }
    return chart;
  } catch (_) {
    setChartFailure(status);
    return null;
  }
}
