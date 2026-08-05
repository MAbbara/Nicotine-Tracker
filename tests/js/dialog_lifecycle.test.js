const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadDialogLifecycle() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'shell', 'dialog_lifecycle.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function makeFakeElement(name) {
  return {
    name,
    children: [],
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    listenerCount(type) { return (this.listeners.get(type) || []).length; },
    contains(node) {
      if (node === this) return true;
      return this.children.includes(node);
    },
    dispatchEvent(event) {
      for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
      return true;
    },
  };
}

function dialogFixture() {
  const dialog = makeFakeElement('dialog');
  const panel = makeFakeElement('panel');
  dialog.children.push(panel);
  const dispatch = (target, type, init = {}) => {
    const event = {
      type,
      target,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    dialog.dispatchEvent(event);
    return event;
  };
  const events = {
    pointerdown: (target, init) => dispatch(target, 'pointerdown', init),
    pointerup: (target, init) => dispatch(target, 'pointerup', init),
    pointercancel: (target, init) => dispatch(target, 'pointercancel', init),
    cancel: (target) => dispatch(target, 'cancel'),
  };
  return { dialog, panel, events };
}

function historyFixture(href) {
  const location = { href, origin: 'https://tracker.test' };
  const history = {
    state: null,
    replaceCalls: 0,
    replaceState(state, _unused, url) {
      this.state = state;
      this.replaceCalls += 1;
      location.href = url;
    },
  };
  return { location, history };
}

test('dialog dismissal requires a complete outside pointer activation', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  const cleanup = installDialogDismissal(dialog, {
    panel,
    dismiss: (reason) => reasons.push(reason),
  });

  events.pointerdown(dialog, { pointerId: 4 });
  events.pointerup(dialog, { pointerId: 4 });
  assert.deepEqual(reasons, ['backdrop']);

  events.pointerdown(panel, { pointerId: 5 });
  events.pointerup(dialog, { pointerId: 5 });
  assert.deepEqual(reasons, ['backdrop']);
  cleanup();
});

test('dialog cancel is prevented and delegated once', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });
  const event = events.cancel(dialog);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(reasons, ['escape']);
});

test('transient modal state is removed with replaceState', async () => {
  const { removeTransientSearchParam } = await loadDialogLifecycle();
  const fakeWindow = historyFixture('/log/view?open_add_modal=1&q=mint#main-content');
  assert.equal(removeTransientSearchParam(fakeWindow, 'open_add_modal'), true);
  assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
  assert.equal(fakeWindow.history.replaceCalls, 1);
});

test('inside pointer activation never dismisses', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });

  events.pointerdown(panel, { pointerId: 7 });
  events.pointerup(panel, { pointerId: 7 });
  assert.deepEqual(reasons, []);

  const child = makeFakeElement('child');
  panel.children.push(child);
  events.pointerdown(child, { pointerId: 8 });
  events.pointerup(child, { pointerId: 8 });
  assert.deepEqual(reasons, []);
});

test('an outside press released inside does not dismiss', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });

  events.pointerdown(dialog, { pointerId: 9 });
  events.pointerup(panel, { pointerId: 9 });
  assert.deepEqual(reasons, []);
});

test('pointer cancellation resets a pending outside activation', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });

  events.pointerdown(dialog, { pointerId: 11 });
  events.pointercancel(dialog, { pointerId: 11 });
  events.pointerup(dialog, { pointerId: 11 });
  assert.deepEqual(reasons, []);
});

test('mismatched pointer ids never complete an outside activation', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });

  events.pointerdown(dialog, { pointerId: 1 });
  events.pointerup(dialog, { pointerId: 2 });
  assert.deepEqual(reasons, []);
});

test('cancel events from nested targets are ignored', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  installDialogDismissal(dialog, { panel, dismiss: (reason) => reasons.push(reason) });

  const event = events.cancel(panel);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(reasons, []);
});

test('cleanup removes every listener and stops dismissal', async () => {
  const { installDialogDismissal } = await loadDialogLifecycle();
  const { dialog, panel, events } = dialogFixture();
  const reasons = [];
  const cleanup = installDialogDismissal(dialog, {
    panel,
    dismiss: (reason) => reasons.push(reason),
  });

  cleanup();

  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'cancel']) {
    assert.equal(dialog.listenerCount(type), 0, `${type} listener is removed`);
  }
  events.pointerdown(dialog, { pointerId: 3 });
  events.pointerup(dialog, { pointerId: 3 });
  const event = events.cancel(dialog);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(reasons, []);
});

test('transient search param removal is a no-op when the param is absent', async () => {
  const { removeTransientSearchParam } = await loadDialogLifecycle();
  const fakeWindow = historyFixture('/log/view?q=mint#main-content');
  assert.equal(removeTransientSearchParam(fakeWindow, 'open_add_modal'), false);
  assert.equal(fakeWindow.location.href, '/log/view?q=mint#main-content');
  assert.equal(fakeWindow.history.replaceCalls, 0);
});
