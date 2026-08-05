const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadQuickAdd() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'logbook', 'quick_add.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.parentNode = null;
    this.isConnected = true;
    this._innerHTML = '';
    this._textContent = '';
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = String(value).replace(/<[^>]*>/g, '');
  }
  get textContent() { return this._textContent; }
  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = '';
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    this.isConnected = false;
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
}

class FakeHistoryRoot extends FakeElement {
  constructor(ownerDocument, html) {
    super('section', ownerDocument);
    this.html = html;
    this.dataset.fragmentVersion = (
      html.match(/data-fragment-version="([^"]+)"/)?.[1] || ''
    );
    this.logIds = [...html.matchAll(/data-log-id="(\d+)"/g)].map((match) => match[1]);
    this.rows = new Map(this.logIds.map((id) => [id, new FakeElement('article', ownerDocument)]));
  }
  replaceWith(nextRoot) {
    this.isConnected = false;
    this.ownerDocument.historyRoot = nextRoot;
  }
  querySelector(selector) {
    const match = selector.match(/^\[data-log-id="(\d+)"\]$/);
    return match ? this.rows.get(match[1]) || null : null;
  }
}

function makeFixture({
  href = 'https://tracker.test/log/view?page=2&q=mint&from_date=2026-01-01&to_date=2026-01-31#main-content',
} = {}) {
  const listeners = new Map();
  const body = new FakeElement('body', null);
  const documentRef = {
    activeElement: null,
    visibilityState: 'visible',
    historyRoot: null,
    body,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    createElement(tagName) {
      if (tagName === 'template') {
        const template = { content: { firstElementChild: null } };
        Object.defineProperty(template, 'innerHTML', {
          set(html) {
            template.content.firstElementChild = new FakeHistoryRoot(documentRef, html.trim());
          },
        });
        return template;
      }
      return new FakeElement(tagName, documentRef);
    },
    querySelector(selector) {
      if (selector === '[data-logbook-history]') return this.historyRoot;
      if (selector === 'meta[name="csrf-token"]') return { content: 'csrf-token' };
      return null;
    },
  };
  body.ownerDocument = documentRef;
  documentRef.historyRoot = new FakeHistoryRoot(
    documentRef,
    '<section data-logbook-history data-fragment-version="logbook-history-v1"><article data-log-id="7"></article></section>',
  );
  const windowRef = {
    location: {
      href,
      assignCalls: 0,
      reloadCalls: 0,
      assign() { this.assignCalls += 1; },
      reload() { this.reloadCalls += 1; },
    },
    scrollX: 12,
    scrollY: 480,
    scrollCalls: [],
    scrollTo(x, y) {
      this.scrollX = x;
      this.scrollY = y;
      this.scrollCalls.push([x, y]);
    },
  };
  const button = new FakeElement('button', documentRef);
  button.dataset.pouchId = '12';
  button.dataset.quantity = '1';
  button.innerHTML = '<span>Steady Mint</span><span>+1</span>';
  button.disabled = false;
  button.focusCalls = 0;
  button.focus = function focus() {
    this.focusCalls += 1;
    documentRef.activeElement = this;
  };
  documentRef.activeElement = button;
  return { documentRef, windowRef, button, listeners };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] ?? null; } },
    async json() { return body; },
  };
}

function latestNotification(documentRef) {
  return documentRef.body.children.at(-1);
}

test('one activation performs one authoritative fragment transaction without navigation or drift', async () => {
  const { createLogbookQuickAddController } = await loadQuickAdd();
  const fixture = makeFixture();
  const requestGate = deferred();
  const requests = [];
  const timers = [];
  let uuidCalls = 0;
  const initialUrl = fixture.windowRef.location.href;
  const controller = createLogbookQuickAddController({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    fetchImpl: (...args) => { requests.push(args); return requestGate.promise; },
    uuid: () => { uuidCalls += 1; return '018f3f5c-68af-7e4d-bf5d-0123456789ab'; },
    setTimeoutImpl: (callback, delay) => { timers.push([callback, delay]); return 1; },
  });

  const mutation = controller.activate(fixture.button);
  const duplicate = controller.activate(fixture.button);

  assert.equal(mutation, duplicate);
  assert.equal(requests.length, 1);
  assert.equal(uuidCalls, 1);
  assert.equal(fixture.button.disabled, true);
  assert.equal(fixture.button.textContent, 'Adding…');
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    pouch_id: 12,
    quantity: 1,
    client_event_id: '018f3f5c-68af-7e4d-bf5d-0123456789ab',
    view: { page: 2, q: 'mint', from_date: '2026-01-01', to_date: '2026-01-31' },
  });
  requestGate.resolve(jsonResponse(201, {
    success: true,
    message: '<img src=x onerror=alert(1)>',
    new_log_id: 42,
    created: true,
    history_html: '<section data-logbook-history data-fragment-version="logbook-history-v1"><article data-log-id="42"></article></section>',
    fragment_version: 'logbook-history-v1',
    visible: true,
  }));
  assert.equal(await mutation, true);

  assert.equal(fixture.documentRef.historyRoot.logIds.includes('42'), true);
  assert.equal(fixture.documentRef.historyRoot.rows.get('42').classList.contains('logbook-row--new'), true);
  assert.deepEqual(timers.map(([, delay]) => delay), [700]);
  const notification = latestNotification(fixture.documentRef);
  const messageNode = notification.children[0];
  assert.equal(messageNode.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(messageNode.innerHTML, '');
  assert.equal(fixture.windowRef.location.href, initialUrl);
  assert.equal(fixture.windowRef.location.assignCalls, 0);
  assert.equal(fixture.windowRef.location.reloadCalls, 0);
  assert.deepEqual([fixture.windowRef.scrollX, fixture.windowRef.scrollY], [12, 480]);
  assert.equal(fixture.documentRef.activeElement, fixture.button);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.button.innerHTML, '<span>Steady Mint</span><span>+1</span>');
});

test('a filtered-out success replaces history but does not invent or highlight a row', async () => {
  const { createLogbookQuickAddController } = await loadQuickAdd();
  const fixture = makeFixture();
  const controller = createLogbookQuickAddController({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    fetchImpl: async () => jsonResponse(201, {
      success: true,
      message: 'Log saved. It is outside the current view.',
      new_log_id: 42,
      created: true,
      history_html: '<section data-logbook-history data-fragment-version="logbook-history-v1"><div class="logbook-empty"></div></section>',
      fragment_version: 'logbook-history-v1',
      visible: false,
    }),
    uuid: () => '118f3f5c-68af-7e4d-bf5d-0123456789ab',
  });

  assert.equal(await controller.activate(fixture.button), true);

  assert.equal(fixture.documentRef.historyRoot.querySelector('[data-log-id="42"]'), null);
  assert.equal(
    latestNotification(fixture.documentRef).children[0].textContent,
    'Log saved. It is outside the current view.',
  );
});

test('canonical failure and transport failure preserve the last successful history DOM', async (t) => {
  const { createLogbookQuickAddController } = await loadQuickAdd();
  for (const [name, fetchImpl, expected] of [
    [
      'canonical',
      async () => jsonResponse(503, {
        error: {
          code: 'internal_error',
          message: 'Quick add is temporarily unavailable.',
          field_errors: {},
          retryable: true,
        },
      }),
      'Quick add is temporarily unavailable.',
    ],
    ['transport', async () => { throw new Error('offline'); }, 'Could not save this log. Check your connection and try again.'],
  ]) {
    await t.test(name, async () => {
      const fixture = makeFixture();
      const initialHistory = fixture.documentRef.historyRoot;
      const controller = createLogbookQuickAddController({
        documentRef: fixture.documentRef,
        windowRef: fixture.windowRef,
        fetchImpl,
        uuid: () => '218f3f5c-68af-7e4d-bf5d-0123456789ab',
      });

      assert.equal(await controller.activate(fixture.button), false);

      assert.equal(fixture.documentRef.historyRoot, initialHistory);
      assert.equal(latestNotification(fixture.documentRef).children[0].textContent, expected);
      assert.equal(fixture.button.disabled, false);
      assert.equal(fixture.documentRef.activeElement, fixture.button);
      assert.deepEqual([fixture.windowRef.scrollX, fixture.windowRef.scrollY], [12, 480]);
    });
  }
});

test('429 feedback uses Retry-After and leaves history unchanged', async () => {
  const { createLogbookQuickAddController } = await loadQuickAdd();
  const fixture = makeFixture();
  const initialHistory = fixture.documentRef.historyRoot;
  const controller = createLogbookQuickAddController({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    fetchImpl: async () => jsonResponse(429, {
      error: {
        code: 'rate_limited',
        message: 'Too many requests.',
        field_errors: {},
        retryable: true,
      },
    }, { 'retry-after': '12' }),
    uuid: () => '318f3f5c-68af-7e4d-bf5d-0123456789ab',
  });

  assert.equal(await controller.activate(fixture.button), false);

  assert.equal(fixture.documentRef.historyRoot, initialHistory);
  assert.equal(
    latestNotification(fixture.documentRef).children[0].textContent,
    'You’re adding logs quickly. Try again in 12 seconds.',
  );
});
