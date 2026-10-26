import { createIndexedDbStore, createOfflineQueueRuntime } from '../today/offline_queue.js';

const status = document.querySelector('#offline-status');
const form = document.querySelector('#offline-log');
const products = document.querySelector('#offline-product');
const pending = document.querySelector('#offline-pending');
let saving = false;
let reconnecting = false;
let reconnectRequested = false;

async function reconnect() {
  if (saving || reconnecting) {
    reconnectRequested = true;
    return;
  }
  reconnecting = true;
  try {
    // Fetch fresh authentication before opening the page that owns replay and CSRF.
    const loggingOut = location.pathname === '/auth/logout';
    const response = await fetch(loggingOut ? '/auth/logout' : '/api/offline-context', { cache: 'no-store' });
    if (response.ok || response.status === 401) {
      location.replace(loggingOut ? '/auth/login' : '/today/');
    }
  } catch (_) {
    // navigator.onLine does not prove the server is reachable.
  } finally {
    reconnecting = false;
    if (reconnectRequested) {
      reconnectRequested = false;
      void reconnect();
    }
  }
}

async function initialize() {
  if (location.pathname === '/auth/logout') {
    document.querySelectorAll('a[href="/today/"]').forEach((link) => { link.href = '/auth/logout'; });
  }
  const cache = await caches.open('nicotine-offline-context-v1');
  const saved = await cache.match('/api/offline-context');
  if (!saved) {
    status.textContent = location.pathname === '/auth/logout'
      ? 'Local offline data cleared. Reconnect to finish signing out of your account.'
      : 'Connect and open Today once to prepare offline logging. Offline saving must be enabled in Settings.';
    return;
  }
  const context = await saved.json();
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: context.offline_queue_id },
    store: createIndexedDbStore(),
    // This screen only queues. A fresh authenticated page owns all replay.
    fetchImpl: async () => { throw new TypeError('Offline screen does not replay'); },
  });
  await runtime.start();
  for (const pouch of context.pouches) {
    products.add(new Option(`${pouch.brand} · ${pouch.nicotine_mg} mg`, pouch.id));
  }
  async function renderPending() {
    const records = await runtime.list();
    pending.replaceChildren();
    for (const record of records) {
      const item = document.createElement('li');
      const product = context.pouches.find((pouch) => pouch.id === record.pouch_id);
      item.textContent = `${product?.brand || 'Saved product'} · ${record.quantity} pouch${record.quantity === 1 ? '' : 'es'} · ${new Date(record.occurred_at_local).toLocaleString()} — waiting to sync`;
      pending.append(item);
    }
    if (!records.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No logs waiting on this device.';
      pending.append(empty);
    }
  }
  await renderPending();
  form.hidden = context.pouches.length === 0;
  status.textContent = form.hidden
    ? 'Connect to add a product before logging offline.'
    : 'Your saved products are ready. Logs will wait here until you reconnect.';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      // Revocation by another tab must prevent this older screen saving new logs.
      const current = await (await caches.open('nicotine-offline-context-v1')).match('/api/offline-context');
      if (!current || (await current.json()).offline_queue_id !== context.offline_queue_id) {
        form.hidden = true;
        status.textContent = 'Your offline session changed. Reconnect to continue.';
        return;
      }
      const now = new Date();
      const result = await runtime.enqueue({
        client_event_id: crypto.randomUUID(),
        pouch_id: Number(products.value),
        quantity: Number(document.querySelector('#offline-quantity').value),
        custom_product: null,
        occurred_at_local: (() => {
          const offset = -now.getTimezoneOffset();
          const local = new Date(now.getTime() + offset * 60000).toISOString().slice(0, 19);
          const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
          const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
          return `${local}${offset >= 0 ? '+' : '-'}${hours}:${minutes}`;
        })(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        craving_id: null,
        notes: null,
      });
      status.textContent = result.queued
        ? 'Saved on this device. Waiting to sync.'
        : 'Could not save on this device. Keep these details and try again.';
      await renderPending();
    } catch (_) {
      status.textContent = 'Could not save on this device. Keep these details and try again.';
    } finally {
      saving = false;
      button.disabled = false;
      if (reconnectRequested) {
        reconnectRequested = false;
        void reconnect();
      }
    }
  });
}

initialize().catch(() => {
  status.textContent = 'Offline storage is unavailable. Reconnect to log your use.';
});
window.addEventListener('online', reconnect);
window.addEventListener('pageshow', () => { if (navigator.onLine) reconnect(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && navigator.onLine) reconnect();
});
