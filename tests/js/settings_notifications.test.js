const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'settings', 'notifications.js'),
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

function fixtures() {
  const attributes = new Map();
  const button = {
    disabled: false,
    textContent: 'Test connection',
    dataset: {},
  };
  const status = {
    hidden: true,
    textContent: '',
    dataset: {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
  return { button, status };
}

test('runNotificationAction exposes pending state and restores a successful action', async () => {
  const { runNotificationAction } = await loadModule();
  const { button, status } = fixtures();
  const request = deferred();
  let calls = 0;

  const result = runNotificationAction({
    button,
    status,
    pendingLabel: 'Testing…',
    request: () => {
      calls += 1;
      return request.promise;
    },
  });

  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Testing…');
  assert.equal(button.dataset.busy, 'true');
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.state, 'loading');
  assert.equal(status.getAttribute('aria-busy'), 'true');

  request.resolve({ success: true, message: 'Connection confirmed.' });
  assert.equal(await result, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Test connection');
  assert.equal(button.dataset.busy, undefined);
  assert.equal(status.textContent, 'Connection confirmed.');
  assert.equal(status.dataset.state, 'success');
  assert.equal(status.getAttribute('aria-busy'), 'false');
});

test('runNotificationAction reports API and network failures without hiding feedback', async () => {
  const { runNotificationAction } = await loadModule();

  const api = fixtures();
  assert.equal(await runNotificationAction({
    ...api,
    request: async () => ({ success: false, message: 'Webhook rejected.' }),
  }), false);
  assert.equal(api.status.hidden, false);
  assert.equal(api.status.dataset.state, 'error');
  assert.equal(api.status.textContent, 'Webhook rejected.');
  assert.equal(api.button.disabled, false);

  const network = fixtures();
  assert.equal(await runNotificationAction({
    ...network,
    failureMessage: 'Connection could not be tested.',
    request: async () => { throw new Error('offline'); },
  }), false);
  assert.equal(network.status.hidden, false);
  assert.equal(network.status.dataset.state, 'error');
  assert.equal(network.status.textContent, 'Connection could not be tested.');
  assert.equal(network.button.disabled, false);
});

test('runNotificationAction ignores a duplicate call while the button is busy', async () => {
  const { runNotificationAction } = await loadModule();
  const { button, status } = fixtures();
  const request = deferred();
  let calls = 0;
  const options = {
    button,
    status,
    request: () => {
      calls += 1;
      return request.promise;
    },
  };

  const first = runNotificationAction(options);
  assert.equal(await runNotificationAction(options), false);
  assert.equal(calls, 1);
  request.resolve({ success: true, message: 'Done.' });
  assert.equal(await first, true);
});
