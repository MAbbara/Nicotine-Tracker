const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'cravings', 'page.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function formData(entries, symptoms = []) {
  return {
    *entries() { yield* entries; },
    getAll(name) { return name === 'physical_symptoms' ? symptoms : []; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.isConnected = true;
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  prepend(child) { this.children.unshift(child); }
  remove() { this.isConnected = false; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get childElementCount() { return this.children.length; }
}

function cravingsControllerFixture() {
  const activeDocument = { activeElement: null, visibilityState: 'visible' };
  const status = new FakeNode('p');
  const list = new FakeNode('div');
  const submit = new FakeNode('button');
  submit.disabled = false;
  submit.ownerDocument = activeDocument;
  submit.focusCalls = 0;
  submit.focus = () => {
    submit.focusCalls += 1;
    activeDocument.activeElement = submit;
  };
  const listeners = {};
  const form = new FakeNode('form');
  form.dataset.endpoint = '/cravings/api/cravings';
  form.reportValidity = () => true;
  form.resetCalls = 0;
  form.reset = () => { form.resetCalls += 1; };
  form.addEventListener = (type, listener) => { listeners[type] = listener; };
  form.removeEventListener = (type) => { delete listeners[type]; };
  form.querySelector = (selector) => (selector === 'button[type="submit"]' ? submit : null);
  const page = new FakeNode('main');
  page.dataset.timezone = 'UTC';
  page.querySelector = (selector) => ({
    '#craving-form': form,
    '#cravings-list': list,
    '[data-craving-form-status]': status,
  })[selector] || null;
  page.querySelectorAll = () => [];
  const root = {
    querySelector(selector) {
      if (selector === '[data-cravings-page]') return page;
      if (selector === 'meta[name="csrf-token"]') return { content: 'csrf-token' };
      return null;
    },
  };
  const fakeDocument = {
    activeElement: null,
    createDocumentFragment: () => new FakeNode('fragment'),
    createElement: (tagName) => new FakeNode(tagName),
    createTextNode: (text) => ({ textContent: text }),
  };
  return { activeDocument, fakeDocument, form, list, listeners, page, status, submit, root };
}

async function runHeldControllerCompletion({ arrange, postResponse }) {
  const fixture = cravingsControllerFixture();
  const pending = deferred();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) return pending.promise;
    return { ok: true, json: async () => [] };
  };
  const originalDocument = global.document;
  const OriginalFormData = global.FormData;
  global.document = fixture.fakeDocument;
  global.FormData = class {
    *entries() { yield ['intensity', '6']; }
    getAll() { return []; }
  };
  try {
    const { initCravingsPage } = await loadModule();
    initCravingsPage(fixture.root, fetchImpl);
    fixture.activeDocument.activeElement = fixture.submit;
    const completion = fixture.listeners.submit({ preventDefault() {} });
    assert.equal(fixture.submit.disabled, true);
    arrange?.(fixture);
    pending.resolve(postResponse);
    await completion;
    return fixture;
  } finally {
    global.document = originalDocument;
    global.FormData = OriginalFormData;
  }
}

test('minimal detailed craving payload contains only the required intensity', async () => {
  const { buildCravingPayload } = await loadModule();
  const payload = buildCravingPayload(formData([
    ['csrf_token', 'header-only-token'],
    ['intensity', '3'],
    ['trigger', ''],
    ['notes', '   '],
  ]));

  assert.deepEqual(payload, { intensity: 3 });
});

test('complete detailed craving payload normalizes numbers, text, and symptoms', async () => {
  const { buildCravingPayload } = await loadModule();
  const payload = buildCravingPayload(formData([
    ['intensity', '8'],
    ['trigger', 'stress'],
    ['mood_before', '4'],
    ['stress_level', '9'],
    ['duration_minutes', '0'],
    ['situation_context', '  After a meeting  '],
    ['outcome', 'used_alternative'],
    ['mood_after', '6'],
    ['notes', '  It eased  '],
    ['outcome_notes', '  Took a walk  '],
  ], ['restlessness', 'irritability']));

  assert.deepEqual(payload, {
    intensity: 8,
    trigger: 'stress',
    mood_before: 4,
    stress_level: 9,
    duration_minutes: 0,
    situation_context: 'After a meeting',
    outcome: 'used_alternative',
    mood_after: 6,
    notes: 'It eased',
    outcome_notes: 'Took a walk',
    physical_symptoms: ['restlessness', 'irritability'],
  });
});

test('history helpers parse legacy symptoms and format naive UTC in the account timezone', async () => {
  const { formatCravingTime, parseSymptoms } = await loadModule();

  assert.deepEqual(parseSymptoms('["restlessness","irritability"]'), [
    'restlessness', 'irritability',
  ]);
  assert.deepEqual(parseSymptoms('not json'), []);
  assert.match(
    formatCravingTime('2026-01-10T10:00:00', 'Asia/Riyadh'),
    /1:00\s*PM|13:00/i,
  );
});


for (const scenario of [
  ['moved focus', { activeElement: { id: 'next-control' }, visibilityState: 'visible' }, true],
  ['hidden document', { activeElement: null, visibilityState: 'hidden' }, true],
  ['disconnected submit', { activeElement: null, visibilityState: 'visible' }, false],
]) {
  const [name, documentState, connected] = scenario;
  test(`craving submit does not restore focus after ${name}`, async () => {
    const { shouldRestoreSubmitFocus } = await loadModule();
    const focusOwner = { id: 'disabled-focus-placeholder' };
    const submit = { isConnected: connected };
    const activeDocument = {
      ...documentState,
      activeElement: documentState.activeElement || focusOwner,
    };

    assert.equal(shouldRestoreSubmitFocus({
      initiatedWithFocus: true,
      activeDocument,
      focusAfterDisable: focusOwner,
      submit,
    }), false);
  });
}


test('craving submit restores focus while its visible connected initiator still owns it', async () => {
  const { shouldRestoreSubmitFocus } = await loadModule();
  const focusOwner = { id: 'disabled-focus-placeholder' };
  assert.equal(shouldRestoreSubmitFocus({
    initiatedWithFocus: true,
    activeDocument: { activeElement: focusOwner, visibilityState: 'visible' },
    focusAfterDisable: focusOwner,
    submit: { isConnected: true },
  }), true);
});


for (const [name, arrange] of [
  ['moved focus', (fixture) => { fixture.activeDocument.activeElement = new FakeNode('button'); }],
  ['hidden document', (fixture) => { fixture.activeDocument.visibilityState = 'hidden'; }],
  ['disconnected submit', (fixture) => { fixture.submit.isConnected = false; }],
]) {
  test(`real craving controller does not restore focus after ${name}`, async () => {
    const fixture = await runHeldControllerCompletion({
      arrange,
      postResponse: { ok: false, json: async () => ({ error: 'Held failure.' }) },
    });
    assert.equal(fixture.submit.focusCalls, 0);
    assert.equal(fixture.submit.disabled, false);
    assert.equal(fixture.status.textContent, 'Held failure.');
  });
}


for (const [name, postResponse, expectedStatus] of [
  [
    'success',
    { ok: true, json: async () => ({ id: 41, intensity: 6, craving_time: '2026-08-03T10:00:00' }) },
    'Craving recorded. Thank you for noticing the moment.',
  ],
  [
    'failure',
    { ok: false, json: async () => ({ error: 'Held failure.' }) },
    'Held failure.',
  ],
]) {
  test(`real craving controller restores focus after normal ${name}`, async () => {
    const fixture = await runHeldControllerCompletion({ postResponse });
    assert.equal(fixture.submit.focusCalls, 1);
    assert.equal(fixture.activeDocument.activeElement, fixture.submit);
    assert.equal(fixture.submit.disabled, false);
    assert.equal(fixture.status.textContent, expectedStatus);
  });
}
