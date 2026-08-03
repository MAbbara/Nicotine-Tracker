export async function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav?.serviceWorker?.register) return null;
  return nav.serviceWorker.register('/service-worker.js', {
    scope: '/',
    updateViaCache: 'none',
  });
}


if (typeof navigator !== 'undefined') {
  registerServiceWorker(navigator).catch(() => {
    // Queueing remains page-owned. A failed install must not interrupt logging.
  });
}
