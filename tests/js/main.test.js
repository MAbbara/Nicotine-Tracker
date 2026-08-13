const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');


function loadMainScript({ fetchImpl = async () => ({ json: async () => ({}) }) } = {}) {
  const listeners = {};
  const windowListeners = {};
  let timers = 0;
  const body = { appendChild(element) { element.parentNode = body; } };
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    addEventListener(type, listener) { listeners[type] = listener; },
    body,
    createElement() {
      return {
        className: '',
        innerHTML: '',
        parentNode: null,
        remove() { this.parentNode = null; },
      };
    },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    addEventListener(type, listener) { windowListeners[type] = listener; },
    location: { reload() {} },
  };
  const source = fs.readFileSync(path.join(projectRoot, 'static', 'js', 'main.js'), 'utf8');
  const context = {
    console,
    document,
    fetch: fetchImpl,
    FormData: class {},
    setTimeout() { timers += 1; },
    clearTimeout() {},
    window,
  };
  vm.runInNewContext(source, context);
  return { context, document, listeners, windowListeners, timerCount: () => timers };
}


function deferred() {
  let resolve;
  const promise = new Promise((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}


function quickAddButton(documentObject) {
  const attributes = new Map([
    ['data-pouch-id', '41'],
    ['data-quantity', '2'],
  ]);
  return {
    dataset: {},
    disabled: false,
    isConnected: true,
    ownerDocument: documentObject,
    textContent: 'Log one',
    focusCalls: 0,
    focus() {
      this.focusCalls += 1;
      documentObject.activeElement = this;
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
  };
}


test('global loading state ignores a submission canceled by an earlier handler', () => {
  const fixture = loadMainScript();
  const button = { disabled: false, textContent: 'Delete goal' };
  const form = {
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return button;
    },
  };

  fixture.listeners.submit({
    defaultPrevented: true,
    target: form,
  });

  assert.equal(button.textContent, 'Delete goal');
  assert.equal(button.disabled, false);
  assert.equal(fixture.timerCount(), 0);
});


test('unrelated promise rejections never become application error notifications', () => {
  const fixture = loadMainScript();

  assert.equal(fixture.windowListeners.unhandledrejection, undefined);
});


test('quick add does not steal focus after the user moves it during a held request', async () => {
  const pending = deferred();
  const fixture = loadMainScript({ fetchImpl: () => pending.promise });
  const button = quickAddButton(fixture.document);
  const nextControl = { id: 'next-control' };
  fixture.document.activeElement = button;

  fixture.context.handleQuickAdd({ currentTarget: button });
  assert.equal(button.disabled, true);
  fixture.listeners.pointerdown({ target: nextControl });
  fixture.document.activeElement = nextControl;
  pending.resolve({ json: async () => ({ success: true, message: 'Added.' }) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.document.activeElement, nextControl);
  assert.equal(button.focusCalls, 0);
});


for (const [name, arrange] of [
  ['hidden document', ({ documentObject }) => { documentObject.visibilityState = 'hidden'; }],
  ['disconnected control', ({ button }) => { button.isConnected = false; }],
]) {
  test(`quick add does not restore focus for a ${name}`, async () => {
    const pending = deferred();
    const fixture = loadMainScript({ fetchImpl: () => pending.promise });
    const button = quickAddButton(fixture.document);
    fixture.document.activeElement = button;

    fixture.context.handleQuickAdd({ currentTarget: button });
    arrange({ button, documentObject: fixture.document });
    pending.resolve({ json: async () => ({ success: true, message: 'Added.' }) });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(button.focusCalls, 0);
  });
}
