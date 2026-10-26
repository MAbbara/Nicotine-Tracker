const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker() {
  const stores = new Map();
  const listeners = {};
  let clears = 0;
  const context = vm.createContext({
    Response, URL, console,
    self: { location: { origin: 'https://tracker.test' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    fetch: async () => { throw new TypeError('offline'); },
    createIndexedDbStore: () => ({ clearAll: async () => { clears++; } }),
    caches: {
      delete: async name => stores.delete(name),
      open: async name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return {
          match: async key => store.get(key)?.clone(),
          put: async (key, value) => { store.set(key, value.clone()); },
        };
      },
    },
  });
  vm.runInContext(fs.readFileSync('static/service-worker.js', 'utf8').replace(/^import .*;\n/, ''), context);
  return {
    clears: () => clears,
    async request(path, reply) {
      context.fetch = reply;
      let response;
      listeners.fetch({ request: { url: `https://tracker.test${path}`, method: 'GET', mode: 'navigate' }, respondWith: promise => { response = promise; } });
      return response;
    },
    async saved() {
      const cache = await context.caches.open('nicotine-offline-context-v1');
      return (await cache.match('/api/offline-context'))?.json();
    },
  };
}
const response = id => new Response(JSON.stringify({ offline_queue_id: id, pouches: [] }), { headers: { 'X-Offline-Queue-ID': id } });
const offline = async () => { throw new TypeError('offline'); };

test('late context cannot restore a revoked account or clear the replacement account', async () => {
  const w = worker();
  await w.request('/api/offline-context', async () => response('account-a'));
  let release;
  let started;
  const inFlight = new Promise(resolve => { started = resolve; });
  const delayed = w.request('/api/offline-context', () => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  await inFlight;
  await w.request('/auth/logout', offline);
  await w.request('/api/offline-context', async () => response('account-b'));
  const before = w.clears();
  release(response('account-a'));
  await delayed;
  assert.equal((await w.saved()).offline_queue_id, 'account-b');
  assert.equal(w.clears(), before);
});

test('direct offline logout revokes local context before navigation fallback', async () => {
  const w = worker();
  await w.request('/api/offline-context', async () => response('account-a'));
  await w.request('/auth/logout', offline);
  assert.equal(await w.saved(), undefined);
  assert.ok(w.clears() > 0);
});

test('first authenticated preparation preserves existing queued logs', async () => {
  const w = worker();
  await w.request('/api/offline-context', async () => response('account-a'));
  assert.equal(w.clears(), 0);
});

test('successful logout also revokes context requested while logout was in flight', async () => {
  const w = worker();
  await w.request('/api/offline-context', async () => response('account-a'));
  let release;
  let started;
  const inFlight = new Promise(resolve => { started = resolve; });
  const logout = w.request('/auth/logout', () => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  await inFlight;
  await w.request('/api/offline-context', async () => response('account-a'));
  release(response('disabled'));
  await logout;
  assert.equal(await w.saved(), undefined);
});
