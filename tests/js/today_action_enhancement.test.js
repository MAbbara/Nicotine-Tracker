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
  });
  const attachLog = [];
  const originalAdd = enhanced.addEventListener.bind(enhanced);
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
