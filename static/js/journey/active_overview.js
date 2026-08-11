import { createPathChart } from './path_chart.js';

const initializedRoots = new WeakMap();

export function initializeActiveOverview(documentObject = document) {
  const root = documentObject.querySelector('[data-journey-deep-overview]');
  if (!root) return () => {};
  if (initializedRoots.has(root)) return initializedRoots.get(root);

  const cleanups = [];
  const island = root.querySelector('[data-path-data]');
  const figure = root.querySelector('.path-figure');
  let chart = null;
  if (island && figure) {
    try {
      chart = createPathChart(figure, JSON.parse(island.textContent));
    } catch (_) {
      root.dataset.chartState = 'fallback';
    }
  }

  const revisionEditor = documentObject.querySelector('[data-plan-editor="revision"]');
  if (chart && revisionEditor) {
    const showPreview = (event) => chart.setPreview(event.detail?.stages || null);
    const clearPreview = () => chart.setPreview(null);
    revisionEditor.addEventListener('journey:plan-preview', showPreview);
    revisionEditor.addEventListener('journey:plan-preview-clear', clearPreview);
    cleanups.push(() => {
      revisionEditor.removeEventListener('journey:plan-preview', showPreview);
      revisionEditor.removeEventListener('journey:plan-preview-clear', clearPreview);
    });
  }

  documentObject.querySelectorAll('details[data-accordion]').forEach((details) => {
    const summary = details.querySelector('summary');
    const body = details.querySelector('[data-accordion-collapse]');
    if (!summary || !body) return;
    const onToggle = () => body.classList.toggle('is-open', details.open);
    details.addEventListener('toggle', onToggle);
    onToggle();
    cleanups.push(() => details.removeEventListener('toggle', onToggle));
  });

  root.dataset.chartState = chart ? 'ready' : 'fallback';
  const cleanup = () => {
    cleanups.splice(0).forEach((dispose) => dispose());
    chart?.destroy();
    delete root.dataset.chartState;
    initializedRoots.delete(root);
  };
  initializedRoots.set(root, cleanup);
  return cleanup;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeActiveOverview(document), { once: true });
  } else {
    initializeActiveOverview(document);
  }
}
