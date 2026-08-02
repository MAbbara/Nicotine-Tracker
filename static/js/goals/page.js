function bindGoalDeleteConfirmations(root, confirmAction) {
  root.querySelectorAll('.goal-delete-form[data-confirm]').forEach((form) => {
    if (form.dataset.confirmBound === 'true') return;
    form.dataset.confirmBound = 'true';
    form.addEventListener('submit', (event) => {
      if (!confirmAction(form.dataset.confirm)) event.preventDefault();
    });
  });
}


function renderGoalAnalytics(region, analytics) {
  if (!region || !analytics) return false;
  const total = region.querySelector('[data-goals-total]');
  const active = region.querySelector('[data-goals-active]');
  if (!total || !active) return false;

  total.textContent = String(analytics.total_goals ?? 0);
  active.textContent = String(analytics.active_goals ?? 0);
  return true;
}


async function initGoalsPage(
  root = document,
  fetchImpl = fetch,
  confirmAction = () => true,
) {
  bindGoalDeleteConfirmations(root, confirmAction);

  const analyticsRegion = root.querySelector('[data-goals-analytics]');
  if (!analyticsRegion) return false;
  if (analyticsRegion.dataset.analyticsState) return false;

  analyticsRegion.dataset.analyticsState = 'loading';
  const response = await Promise.resolve()
    .then(() => fetchImpl(analyticsRegion.dataset.endpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }))
    .catch(() => null);
  if (!response) {
    analyticsRegion.dataset.analyticsState = 'error';
    return false;
  }
  if (!response.ok) {
    analyticsRegion.dataset.analyticsState = 'error';
    return false;
  }

  const payload = await response.json().catch(() => null);
  if (payload?.success !== true || !payload.analytics) {
    analyticsRegion.dataset.analyticsState = 'error';
    return false;
  }

  const rendered = renderGoalAnalytics(analyticsRegion, payload.analytics);
  analyticsRegion.dataset.analyticsState = rendered ? 'ready' : 'error';
  return rendered;
}


if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => {
    void initGoalsPage(
      document,
      window.fetch.bind(window),
      window.confirm.bind(window),
    );
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}


export { bindGoalDeleteConfirmations, initGoalsPage, renderGoalAnalytics };
