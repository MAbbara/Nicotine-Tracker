const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');


function loadMainScript() {
  const listeners = {};
  let timers = 0;
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    addEventListener() {},
    location: { reload() {} },
  };
  const source = fs.readFileSync(path.join(projectRoot, 'static', 'js', 'main.js'), 'utf8');
  vm.runInNewContext(source, {
    console,
    document,
    fetch: async () => ({ json: async () => ({}) }),
    FormData: class {},
    setTimeout() { timers += 1; },
    clearTimeout() {},
    window,
  });
  return { listeners, timerCount: () => timers };
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
