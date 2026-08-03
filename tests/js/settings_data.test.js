const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'settings', 'data.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function controls(checked) {
  const attributes = new Map();
  const documentObject = { activeElement: null, visibilityState: 'visible' };
  const checkbox = {
    checked,
    dataset: {},
    ownerDocument: documentObject,
    isConnected: true,
    focus() { documentObject.activeElement = this; },
  };
  let disabled = false;
  Object.defineProperty(checkbox, 'disabled', {
    get() { return disabled; },
    set(value) {
      disabled = value;
      if (value && documentObject.activeElement === checkbox) documentObject.activeElement = null;
    },
  });
  return {
    checkbox,
    documentObject,
    status: {
      hidden: true,
      textContent: '',
      dataset: {},
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
    },
  };
}

test('updateOfflineQueue persists the chosen state with pending and success feedback', async () => {
  const { updateOfflineQueue } = await loadModule();
  const { checkbox, status } = controls(false);
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  let requested;

  const result = updateOfflineQueue({
    checkbox,
    status,
    request: async (enabled) => {
      requested = enabled;
      return request;
    },
  });
  assert.equal(requested, false);
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.dataset.busy, 'true');
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.state, 'loading');
  assert.equal(status.getAttribute('aria-busy'), 'true');

  resolveRequest({ success: true, enabled: false, message: 'Offline saving is off.' });
  assert.equal(await result, true);
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.dataset.busy, undefined);
  assert.equal(status.textContent, 'Offline saving is off.');
  assert.equal(status.dataset.state, 'success');
  assert.equal(status.getAttribute('aria-busy'), 'false');
});

test('updateOfflineQueue restores keyboard focus after disabling the initiating checkbox', async () => {
  const { updateOfflineQueue } = await loadModule();
  const { checkbox, status, documentObject } = controls(false);
  documentObject.activeElement = checkbox;
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });

  const result = updateOfflineQueue({ checkbox, status, request: () => pending });
  documentObject.activeElement = null;
  resolveRequest({ success: true, enabled: false });

  assert.equal(await result, true);
  assert.equal(documentObject.activeElement, checkbox);
});

test('updateOfflineQueue restores the previous value when persistence fails', async () => {
  const { updateOfflineQueue } = await loadModule();
  const { checkbox, status } = controls(false);

  assert.equal(await updateOfflineQueue({
    checkbox,
    status,
    request: async () => { throw new Error('offline'); },
  }), false);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.disabled, false);
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.state, 'error');
  assert.match(status.textContent, /could not be saved/i);
});

test('updateOfflineQueue rejects duplicate submissions while one request is pending', async () => {
  const { updateOfflineQueue } = await loadModule();
  const { checkbox, status } = controls(false);
  let resolveRequest;
  const requestResult = new Promise((resolve) => { resolveRequest = resolve; });
  let requestCount = 0;
  const request = async () => {
    requestCount += 1;
    return requestResult;
  };

  const first = updateOfflineQueue({ checkbox, status, request });
  const duplicate = await updateOfflineQueue({ checkbox, status, request });

  assert.equal(duplicate, false);
  assert.equal(requestCount, 1);
  resolveRequest({ success: true, enabled: false });
  assert.equal(await first, true);
});

test('updateOfflineQueue restores the previous value when the server rejects the payload', async () => {
  const { updateOfflineQueue } = await loadModule();
  const { checkbox, status } = controls(false);

  assert.equal(await updateOfflineQueue({
    checkbox,
    status,
    request: async () => ({ success: false }),
  }), false);
  assert.equal(checkbox.checked, true);
  assert.equal(status.dataset.state, 'error');
});


test('updateOfflineQueue restores focus only while the initiating interaction still owns it', async () => {
  const { updateOfflineQueue } = await loadModule();

  for (const mode of ['normal', 'moved', 'hidden', 'disconnected']) {
    const current = controls(false);
    let focusCalls = 0;
    const originalFocus = current.checkbox.focus;
    current.checkbox.focus = function focus(options) {
      focusCalls += 1;
      return originalFocus.call(this, options);
    };
    current.documentObject.activeElement = current.checkbox;
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const result = updateOfflineQueue({
      checkbox: current.checkbox,
      status: current.status,
      request: () => pending,
    });
    if (mode === 'moved') current.documentObject.activeElement = { id: 'next-control' };
    if (mode === 'hidden') current.documentObject.visibilityState = 'hidden';
    if (mode === 'disconnected') current.checkbox.isConnected = false;
    resolveRequest({ success: true, enabled: false });
    assert.equal(await result, true);
    assert.equal(focusCalls, mode === 'normal' ? 1 : 0, mode);
  }
});
