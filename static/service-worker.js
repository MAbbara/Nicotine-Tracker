import { createIndexedDbStore } from './static/js/today/offline_queue.js';

const SHELL = 'nicotine-offline-shell-v2';
const PRIVATE = 'nicotine-offline-context-v1';
const CONTEXT = '/api/offline-context';
const ASSETS = [
  '/offline',
  '/static/brand/nicotine-tracker-two-point-n-symbol.png',
  '/static/icons/lucide/sprite.svg',
  '/static/css/style.css',
  '/static/fonts/newsreader-variable.woff2',
  '/static/fonts/dm-sans-variable.woff2',
  '/static/js/shell/offline_page.js',
  '/static/js/today/offline_queue.js',
  '/static/js/shell/theme_bootstrap.js',
];
let privateWork = Promise.resolve();
let identityGeneration = 0;
let currentIdentity = null;

function serializePrivate(operation) {
  const result = privateWork.then(operation);
  privateWork = result.catch(() => {});
  return result;
}

async function clearPrivate() {
  await caches.delete(PRIVATE);
  await createIndexedDbStore().clearAll();
}

async function revokePrivate() {
  identityGeneration += 1;
  currentIdentity = 'disabled';
  await clearPrivate();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('nicotine-offline-shell-') && name !== SHELL) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function observeIdentity(response, pathname, generation) {
  const identity = response.headers.get('X-Offline-Queue-ID');
  if (!identity) return;
  await serializePrivate(async () => {
    if (generation !== identityGeneration) return;
    const cache = await caches.open(PRIVATE);
    const prior = await cache.match(CONTEXT);
    const previous = prior ? await prior.json() : null;
    currentIdentity ??= previous?.offline_queue_id || null;
    if (identity !== currentIdentity) {
      identityGeneration += 1;
      if (identity === 'disabled' || (currentIdentity && currentIdentity !== 'disabled')) {
        await clearPrivate();
      }
      currentIdentity = identity;
    }
    if (pathname === CONTEXT && response.ok && identity !== 'disabled') {
      const data = await response.clone().json();
      if (data.offline_queue_id === identity) {
        await (await caches.open(PRIVATE)).put(CONTEXT, response.clone());
      }
    }
  });
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode !== 'navigate' && !ASSETS.includes(url.pathname)
      && url.pathname !== CONTEXT && url.pathname !== '/settings/privacy/offline-queue') return;
  event.respondWith((async () => {
    if (url.pathname === '/auth/logout') await serializePrivate(revokePrivate);
    await privateWork;
    const generation = identityGeneration;
    try {
      const response = await fetch(event.request);
      // Logout completion is authoritative even if another tab requested context during logout.
      if (url.pathname === '/auth/logout' && response.headers.get('X-Offline-Queue-ID') === 'disabled') {
        await serializePrivate(revokePrivate);
      } else {
        await observeIdentity(response.clone(), url.pathname, generation).catch(() => {});
      }
      // Only explicitly public shell assets may be cached. Never cache page HTML or APIs.
      if (event.request.method === 'GET' && response.ok && ASSETS.includes(url.pathname)) {
        await (await caches.open(SHELL)).put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      if (event.request.method !== 'GET') throw error;
      if (event.request.mode === 'navigate') {
        return await (await caches.open(SHELL)).match('/offline') || Response.error();
      }
      if (ASSETS.includes(url.pathname)) {
        return await (await caches.open(SHELL)).match(url.pathname) || Response.error();
      }
      throw error;
    }
  })());
});
