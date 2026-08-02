const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadActionEnhancement() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'action_enhancement.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

class FakeElement {
  constructor(tagName, log) {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    let hidden = false;
    Object.defineProperty(this, 'hidden', {
      get() { return hidden; },
      set(next) {
        hidden = Boolean(next);
        if (log) log.push(`${tagName}:hidden=${hidden}`);
      },
    });
  }
  append(...nodes) { this.children.push(...nodes); }
  querySelector(selector) {
    const marker = {
      '[data-action-fallback]': 'actionFallback',
      '[data-action-enhanced]': 'actionEnhanced',
    }[selector];
    if (!marker) return null;
    return this.children.find((child) => Object.hasOwn(child.dataset, marker)) || null;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }
  dispatchEvent(event) {
    for (const handler of [...(this.listeners.get(event.type) || [])]) {
      handler(event);
    }
    return true;
  }
}

function makeSlot() {
  const log = [];
  const slot = new FakeElement('div');
  const fallback = new FakeElement('a', log);
  const enhanced = new FakeElement('button', log);
  fallback.dataset.actionFallback = '';
  enhanced.dataset.actionEnhanced = '';
  enhanced.hidden = true;
  slot.append(fallback, enhanced);
  const readiness = [];
  slot.dataset = new Proxy({}, {
    set(target, key, value) {
      target[key] = value;
      readiness.push(`${String(key)}=${value}`);
      return true;
    },
    deleteProperty(target, key) {
      delete target[key];
      readiness.push(`delete:${String(key)}`);
      log.push(`delete:${String(key)}`);
      return true;
    },
  });
  const attachLog = [];
  const originalAdd = enhanced.addEventListener.bind(enhanced);
  const originalRemove = enhanced.removeEventListener.bind(enhanced);
  enhanced.addEventListener = (type, handler) => {
    attachLog.push({
      type,
      fallbackHidden: fallback.hidden,
      enhancedHidden: enhanced.hidden,
      ready: slot.dataset.controllerReady ?? null,
    });
    log.push('attach');
    originalAdd(type, handler);
  };
  enhanced.removeEventListener = (type, handler) => {
    log.push('detach');
    originalRemove(type, handler);
  };
  log.length = 0;
  return { slot, fallback, enhanced, log, attachLog, readiness };
}

test('activation attaches the listener before the visibility swap and readiness marker', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, fallback, enhanced, log, attachLog, readiness } = makeSlot();
  const calls = [];
  const cleanup = activateActionEnhancement(slot, (event) => calls.push(event));

  assert.equal(typeof cleanup, 'function');
  assert.deepEqual(attachLog, [{
    type: 'click',
    fallbackHidden: false,
    enhancedHidden: true,
    ready: null,
  }]);
  assert.deepEqual(log, ['attach', 'button:hidden=false', 'a:hidden=true']);
  assert.deepEqual(readiness, ['controllerReady=true']);
  assert.equal(enhanced.hidden, false);
  assert.equal(fallback.hidden, true);
  assert.equal(slot.dataset.controllerReady, 'true');

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'click');

  cleanup();
  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 1);
});

test('a late readiness failure restores the fallback and permits one clean retry', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, fallback, enhanced } = makeSlot();
  const dataset = slot.dataset;
  let failReadinessOnce = true;
  slot.dataset = new Proxy(dataset, {
    set(target, key, value) {
      if (key === 'controllerReady' && failReadinessOnce) {
        failReadinessOnce = false;
        throw new Error('readiness-write-failed');
      }
      target[key] = value;
      return true;
    },
    deleteProperty(target, key) {
      delete target[key];
      return true;
    },
  });
  let calls = 0;

  assert.throws(
    () => activateActionEnhancement(slot, () => { calls += 1; }),
    /readiness-write-failed/,
  );
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal((enhanced.listeners.get('click') || []).length, 0);

  const cleanup = activateActionEnhancement(slot, () => { calls += 1; });
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal((enhanced.listeners.get('click') || []).length, 1);
  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls, 1);
  cleanup();
});

test('missing root returns a no-op cleanup and never throws', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();

  for (const root of [null, undefined]) {
    let cleanup;
    assert.doesNotThrow(() => { cleanup = activateActionEnhancement(root, () => {}); });
    assert.equal(typeof cleanup, 'function');
    assert.doesNotThrow(() => cleanup());
  }
});

test('missing fallback or enhanced control is a no-op and never marks readiness', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();

  const fallbackOnly = makeSlot();
  fallbackOnly.enhanced.dataset = {};
  let calls = 0;
  const cleanupFallbackOnly = activateActionEnhancement(fallbackOnly.slot, () => { calls += 1; });
  assert.equal(typeof cleanupFallbackOnly, 'function');
  assert.equal(fallbackOnly.slot.dataset.controllerReady, undefined);
  assert.equal(fallbackOnly.fallback.hidden, false);
  assert.deepEqual(fallbackOnly.attachLog, []);
  assert.doesNotThrow(() => cleanupFallbackOnly());

  const enhancedOnly = makeSlot();
  enhancedOnly.fallback.dataset = {};
  const cleanupEnhancedOnly = activateActionEnhancement(enhancedOnly.slot, () => { calls += 1; });
  assert.equal(typeof cleanupEnhancedOnly, 'function');
  assert.equal(enhancedOnly.slot.dataset.controllerReady, undefined);
  assert.equal(enhancedOnly.enhanced.hidden, true);
  assert.deepEqual(enhancedOnly.attachLog, []);
  assert.doesNotThrow(() => cleanupEnhancedOnly());
  assert.equal(calls, 0);
});

test('non-function callback is a no-op and mutates nothing', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();

  for (const callback of [null, undefined, 'open', 42, {}]) {
    const { slot, fallback, enhanced, attachLog } = makeSlot();
    let cleanup;
    assert.doesNotThrow(() => { cleanup = activateActionEnhancement(slot, callback); });
    assert.equal(typeof cleanup, 'function');
    assert.equal(fallback.hidden, false);
    assert.equal(enhanced.hidden, true);
    assert.equal(slot.dataset.controllerReady, undefined);
    assert.deepEqual(attachLog, []);
    assert.doesNotThrow(() => cleanup());
  }
});

test('repeated activation is idempotent and cleanup is safe to call twice', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, enhanced, attachLog } = makeSlot();
  let calls = 0;
  const first = activateActionEnhancement(slot, () => { calls += 1; });
  const second = activateActionEnhancement(slot, () => { calls += 10; });

  assert.equal(attachLog.length, 1);
  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls, 1);

  assert.equal(second, first);
  assert.doesNotThrow(() => { first(); first(); });
  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls, 1);
});

test('a slot can be re-activated after cleanup', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, enhanced } = makeSlot();
  const calls = [];
  const first = activateActionEnhancement(slot, () => calls.push('first'));
  first();

  const second = activateActionEnhancement(slot, () => calls.push('second'));
  enhanced.dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, ['second']);
  second();
});

test('cleanup restores the safe server-rendered state in a safe synchronous order', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, fallback, enhanced, log } = makeSlot();
  const calls = [];
  const cleanup = activateActionEnhancement(slot, (event) => calls.push(event));
  log.length = 0;

  cleanup();

  // Teardown must never leave a visible enhanced control without its
  // handler or a stale readiness marker. Readiness is removed first,
  // the fallback is restored before the enhanced control is hidden (so
  // the slot is never empty), and the listener is removed last, so at
  // no intermediate point is a visible control missing its handler.
  assert.deepEqual(log, [
    'delete:controllerReady',
    'a:hidden=false',
    'button:hidden=true',
    'detach',
  ]);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(Object.hasOwn(slot.dataset, 'controllerReady'), false);

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 0);
});

test('double cleanup keeps the restored server state and stays a no-op', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, fallback, enhanced, log } = makeSlot();
  let calls = 0;
  const cleanup = activateActionEnhancement(slot, () => { calls += 1; });

  cleanup();
  const logAfterFirst = [...log];
  assert.doesNotThrow(() => cleanup());

  assert.deepEqual(log, logAfterFirst);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(slot.dataset.controllerReady, undefined);
  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(calls, 0);
});

test('re-activation after cleanup re-enhances the slot and teardown restores it again', async () => {
  const { activateActionEnhancement } = await loadActionEnhancement();
  const { slot, fallback, enhanced } = makeSlot();
  const calls = [];

  const first = activateActionEnhancement(slot, () => calls.push('first'));
  first();
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(slot.dataset.controllerReady, undefined);

  const second = activateActionEnhancement(slot, () => calls.push('second'));
  assert.notEqual(second, first);
  assert.equal(fallback.hidden, true);
  assert.equal(enhanced.hidden, false);
  assert.equal(slot.dataset.controllerReady, 'true');

  enhanced.dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, ['second']);

  second();
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(slot.dataset.controllerReady, undefined);
  enhanced.dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, ['second']);
});
