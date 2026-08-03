const RANGE_FORM_SELECTOR = '[data-dashboard-range-form]';


export function startDashboardRange(root = document) {
  const form = root.querySelector(RANGE_FORM_SELECTOR);
  const select = form?.querySelector('[data-dashboard-range-select]');
  if (!form || !select || form.dataset.rangeReady === 'true') return false;

  const submitRange = () => form.requestSubmit();
  select.addEventListener('change', submitRange);
  form.dataset.rangeReady = 'true';
  return true;
}


if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startDashboardRange(), { once: true });
  } else {
    startDashboardRange();
  }
}
