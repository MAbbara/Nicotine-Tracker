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
    children: [],
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
    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => (
        child === node || (typeof child.contains === 'function' && child.contains(node))
      ));
    },
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
  const closeAction = makeLoggingElement('close-button');
  const cancelAction = makeLoggingElement('cancel-button');
  dialog.children.push(closeAction, cancelAction);
  const documentRef = makeLoggingElement('document');
  documentRef.defaultView = fakeWindow;
  documentRef.querySelector = (selector) => {
    if (selector === '#addLogModal') return dialog;
    if (selector === '[data-logbook-add-action]') return addAction;
    return null;
  };
  documentRef.querySelectorAll = (selector) => {
    if (selector === '[data-hs-overlay="#addLogModal"]') {
      return [addAction, closeAction, cancelAction];
    }
    return [];
  };
  dialog.ownerDocument = documentRef;
  addAction.ownerDocument = documentRef;
  closeAction.ownerDocument = documentRef;
  cancelAction.ownerDocument = documentRef;
  return {
    documentRef, dialog, addAction, closeAction, cancelAction, fakeWindow,
  };
}

const DISMISSALS = Object.freeze({
  X({ closeAction }) {
    closeAction.click();
  },
  Cancel({ cancelAction }) {
    cancelAction.click();
  },
  Escape({ dialog }) {
    const event = {
      type: 'cancel',
      target: dialog,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    dialog.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'native cancel stays under shared control');
  },
  backdrop({ dialog }) {
    dialog.dispatchEvent({ type: 'pointerdown', target: dialog, pointerId: 1 });
    dialog.dispatchEvent({ type: 'pointerup', target: dialog, pointerId: 1 });
  },
});

for (const [name, dismiss] of Object.entries(DISMISSALS)) {
  test(`${name} removes only the transient add-log param exactly once`, async () => {
    const { initLoggingForms } = await loadLoggingForms();
    const fixture = makeLoggingDocument();
    const { documentRef, dialog, fakeWindow } = fixture;

    const cleanup = initLoggingForms(documentRef, () => true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dialog.open, true, 'auto-open trigger shows the dialog');

    dismiss(fixture);
    assert.equal(dialog.open, false, `${name} closes the native dialog`);
    assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
    assert.equal(fakeWindow.history.replaceCalls, 1);

    dismiss(fixture);
    assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
    assert.equal(fakeWindow.history.replaceCalls, 1, 'repeat dismissal does not replace twice');
    cleanup();
  });

  test(`${name} URL cleanup is a no-op when the transient param is absent`, async () => {
    const { initLoggingForms } = await loadLoggingForms();
    const fixture = makeLoggingDocument({
      autoOpen: false,
      href: '/log/view?q=mint#main-content',
    });
    const { documentRef, addAction, dialog, fakeWindow } = fixture;

    const cleanup = initLoggingForms(documentRef, () => true);
    addAction.click();
    assert.equal(dialog.open, true);

    dismiss(fixture);
    assert.equal(dialog.open, false, `${name} closes the native dialog`);
    assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
    assert.equal(fakeWindow.history.replaceCalls, 0);
    cleanup();
  });
}

test('delete confirmation delegates to forms inserted after initialization', async () => {
  const { initLoggingForms } = await loadLoggingForms();
  const root = makeLoggingElement('document');
  root.querySelector = () => null;
  root.querySelectorAll = () => [];
  const insertedForm = makeLoggingElement('inserted-delete-form');
  insertedForm.closest = (selector) => (
    selector === 'form[data-confirm-delete]' ? insertedForm : null
  );
  root.children.push(insertedForm);
  let confirmations = 0;
  const cleanup = initLoggingForms(root, () => {
    confirmations += 1;
    return false;
  });
  const event = {
    type: 'submit',
    target: insertedForm,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };

  root.dispatchEvent(event);

  assert.equal(confirmations, 1);
  assert.equal(event.defaultPrevented, true);
  cleanup();
});
