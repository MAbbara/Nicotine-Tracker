export async function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav?.serviceWorker?.register) return null;
  const registration = await nav.serviceWorker.register('/service-worker.js', {
    scope: '/',
    type: 'module',
    updateViaCache: 'none',
  });
  // ready may still refer to the previous, network-only worker during an upgrade.
  const worker = registration.installing || registration.waiting;
  if (worker && worker.state !== 'activated') {
    await new Promise((resolve, reject) => {
      const changed = () => {
        if (!['activated', 'redundant'].includes(worker.state)) return;
        worker.removeEventListener('statechange', changed);
        if (worker.state === 'activated') resolve();
        else reject(new Error('Offline installation did not complete'));
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  return registration;
}


if (typeof navigator !== 'undefined') {
  registerServiceWorker(navigator).then(async (registration) => {
    if (!registration) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
    if (document.querySelector('meta[name="offline-queue-enabled"]')?.content === 'true') {
      await fetch('/api/offline-context', { cache: 'no-store' });
    }
  }).catch(() => {
    // Queueing remains page-owned. A failed install must not interrupt logging.
  });
}
