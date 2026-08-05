const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadLoggingForms() {
  let source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'logging', 'forms.js'),
    'utf8',
  );
  for (const dependency of ['dialog_focus.js', 'dialog_lifecycle.js']) {
    const marker = `'../shell/${dependency}'`;
    if (!source.includes(marker)) continue;
    const dependencySource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'shell', dependency),
      'utf8',
    );
    const dependencyUrl = `data:text/javascript;base64,${Buffer.from(dependencySource).toString('base64')}`;
    source = source.replace(marker, `'${dependencyUrl}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function makeLoggingElement(name) {
  return {
    name,
    dataset: {},
    attributes: {},
    listeners: new Map(),
    open: false,
    ownerDocument: null,
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    listenerCount(type) {
      return (this.listeners.get(type) || []).length;
    },
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
      return true;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    focus() {},
    showModal() { this.open = true; },
    close() {
      this.open = false;
      this.dispatchEvent({ type: 'close', target: this });
    },
    click() {
      this.dispatchEvent({
        type: 'click',
        target: this,
        preventDefault() { this.defaultPrevented = true; },
      });
    },
  };
}

function makeLoggingDocument({
  autoOpen = true,
  href = '/log/view?open_add_modal=1&q=mint#main-content',
} = {}) {
  const fakeWindow = {
    location: { href, origin: 'https://tracker.test' },
    history: {
      state: null,
      replaceCalls: 0,
      replaceState(state, _unused, url) {
        this.state = state;
        this.replaceCalls += 1;
        fakeWindow.location.href = url;
      },
    },
  };
  const dialog = makeLoggingElement('dialog');
  dialog.dataset.autoOpen = autoOpen ? 'true' : 'false';
  const addAction = makeLoggingElement('button');
  const documentRef = makeLoggingElement('document');
  documentRef.defaultView = fakeWindow;
  documentRef.querySelector = (selector) => {
    if (selector === '#addLogModal') return dialog;
    if (selector === '[data-logbook-add-action]') return addAction;
    return null;
  };
  documentRef.querySelectorAll = (selector) => {
    if (selector === '[data-hs-overlay="#addLogModal"]') return [addAction];
    return [];
  };
  dialog.ownerDocument = documentRef;
  addAction.ownerDocument = documentRef;
  return { documentRef, dialog, addAction, fakeWindow };
}

test('auto-open dialog dismissal removes the transient param and preserves the rest of the URL', async () => {
  const { initLoggingForms } = await loadLoggingForms();
  const {
    documentRef, dialog, fakeWindow,
  } = makeLoggingDocument();

  const cleanup = initLoggingForms(documentRef, () => true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(dialog.open, true, 'auto-open trigger shows the dialog');
  assert.equal(dialog.listenerCount('pointerdown'), 1);
  assert.equal(dialog.listenerCount('pointerup'), 1);
  assert.equal(dialog.listenerCount('cancel'), 1);

  const cancelEvent = {
    type: 'cancel',
    target: dialog,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  dialog.dispatchEvent(cancelEvent);

  assert.equal(cancelEvent.defaultPrevented, true, 'native cancel stays under shared control');
  assert.equal(dialog.open, false, 'dismissal closes the native dialog');
  assert.equal(fakeWindow.history.replaceCalls, 1);
  assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
  cleanup();
});

test('backdrop dismissal of an auto-open dialog also strips the transient param', async () => {
  const { initLoggingForms } = await loadLoggingForms();
  const {
    documentRef, dialog, fakeWindow,
  } = makeLoggingDocument();

  const cleanup = initLoggingForms(documentRef, () => true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(dialog.open, true);

  dialog.dispatchEvent({ type: 'pointerdown', target: dialog, pointerId: 1 });
  dialog.dispatchEvent({ type: 'pointerup', target: dialog, pointerId: 1 });

  assert.equal(dialog.open, false, 'backdrop activation closes the native dialog');
  assert.equal(fakeWindow.history.replaceCalls, 1);
  assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
  cleanup();
});

test('dismissal leaves the URL untouched when the transient param is absent', async () => {
  const { initLoggingForms } = await loadLoggingForms();
  const {
    documentRef, dialog, fakeWindow,
  } = makeLoggingDocument({ autoOpen: false, href: '/log/view?q=mint#main-content' });

  const cleanup = initLoggingForms(documentRef, () => true);
  const addAction = documentRef.querySelector('[data-logbook-add-action]');
  addAction.click();
  assert.equal(dialog.open, true);

  const cancelEvent = {
    type: 'cancel',
    target: dialog,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  dialog.dispatchEvent(cancelEvent);

  assert.equal(dialog.open, false);
  assert.equal(fakeWindow.history.replaceCalls, 0);
  assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
  cleanup();
});
