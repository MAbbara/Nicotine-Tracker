import { getOfflineQueueRuntime } from '../today/offline_queue.js';

const controllerRegistry = new WeakMap();

export function createOfflineStatusController({
  win,
  region,
  queueRuntime = null,
  doc = null,
  navigate = (href) => win.location.assign(href),
} = {}) {
  if (!win || !region) throw new TypeError('Window and live region are required');
  let initialized = false;
  let lastOnline = Boolean(win.navigator?.onLine ?? true);
  let queueUnsubscribe = null;
  const queuedIds = new Set();
  let deletionContinuing = false;

  function show(message) {
    region.textContent = message;
    region.hidden = false;
  }

  function handleOnline() {
    if (lastOnline) return;
    lastOnline = true;
    show('Back online. Your recent changes can sync now.');
    if (queueRuntime?.replay) queueRuntime.replay();
  }

  function handleQueueResult(result) {
    const eventId = result?.record?.client_event_id;
    if (result?.type === 'pending' && eventId) {
      queuedIds.add(eventId);
      const count = queuedIds.size;
      show(`${count} saved ${count === 1 ? 'log is' : 'logs are'} waiting for connection.`);
    } else if (result?.type === 'synced') {
      if (eventId) queuedIds.delete(eventId);
      show(queuedIds.size
        ? `${queuedIds.size} saved ${queuedIds.size === 1 ? 'log is' : 'logs are'} still waiting.`
        : 'Saved after reconnecting.');
    } else if (result?.type === 'needs_attention') {
      if (eventId) queuedIds.add(eventId);
      show('A saved log needs your attention before it can sync.');
    } else if (result?.type === 'auth_cleared') {
      queuedIds.clear();
      show('Saved browser logs were cleared to protect your privacy.');
    }
  }

  async function clearThen(continueAction) {
    try {
      if (queueRuntime?.clearAll) await queueRuntime.clearAll();
    } catch (_) {
      // Server Clear-Site-Data remains the privacy fallback. Never trap exit.
    }
    continueAction();
  }

  function handleDocumentClick(event) {
    const link = event.target?.closest?.('a[href]');
    if (!link || !String(link.href || '').match(/\/auth\/logout(?:[?#].*)?$/)) return;
    event.preventDefault();
    clearThen(() => navigate(link.href));
  }

  function handleDocumentSubmit(event) {
    if (deletionContinuing) return;
    const form = event.target;
    const action = form?.querySelector?.('input[name="action"]');
    if (!action || action.value !== 'delete_account') return;
    event.preventDefault();
    deletionContinuing = true;
    clearThen(() => form.submit());
  }

  function handleOffline() {
    if (!lastOnline) return;
    lastOnline = false;
    show('You’re offline. Keep going—available actions will reconnect when you do.');
  }

  function initialize() {
    if (initialized) return controller;
    win.addEventListener('online', handleOnline);
    win.addEventListener('offline', handleOffline);
    if (queueRuntime?.subscribe) queueUnsubscribe = queueRuntime.subscribe(handleQueueResult);
    if (queueRuntime?.start) queueRuntime.start();
    if (doc?.addEventListener) {
      doc.addEventListener('click', handleDocumentClick);
      doc.addEventListener('submit', handleDocumentSubmit);
    }
    initialized = true;
    if (!lastOnline) show('You’re offline. Keep going—available actions will reconnect when you do.');
    return controller;
  }

  function cleanup() {
    if (!initialized) return;
    win.removeEventListener('online', handleOnline);
    win.removeEventListener('offline', handleOffline);
    if (queueUnsubscribe) queueUnsubscribe();
    queueUnsubscribe = null;
    if (queueRuntime?.invalidateBufferedResults) queueRuntime.invalidateBufferedResults();
    queuedIds.clear();
    if (doc?.removeEventListener) {
      doc.removeEventListener('click', handleDocumentClick);
      doc.removeEventListener('submit', handleDocumentSubmit);
    }
    deletionContinuing = false;
    initialized = false;
  }

  const controller = { initialize, cleanup, handleOnline, handleOffline };
  return controller;
}

export function initOfflineStatus(doc = globalThis.document, win = globalThis.window) {
  const region = doc?.querySelector?.('#connection-status');
  if (!region || !win) return null;
  const existing = controllerRegistry.get(win);
  if (existing) return existing;
  const queueRuntime = getOfflineQueueRuntime({ doc, win });
  const controller = createOfflineStatusController({
    win, region, queueRuntime, doc,
  }).initialize();
  controllerRegistry.set(win, controller);
  return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initOfflineStatus(document, window), { once: true });
  } else {
    initOfflineStatus(document, window);
  }
}
