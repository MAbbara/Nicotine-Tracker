const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'catalog', 'page.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function fixtures() {
  let listener;
  const form = {
    dataset: {
      confirm: 'Delete this pouch?',
    },
    addEventListener(type, callback) {
      assert.equal(type, 'submit');
      listener = callback;
    },
  };
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, '.catalog-delete-form[data-confirm]');
      return [form];
    },
  };
  return {
    form,
    root,
    submit(event) { listener(event); },
  };
}

test('delete confirmation prevents submission when the user cancels', async () => {
  const { bindDeleteConfirmation } = await loadModule();
  const fixture = fixtures();
  let prevented = false;
  let prompt;

  bindDeleteConfirmation(fixture.root, (message) => {
    prompt = message;
    return false;
  });
  fixture.submit({ preventDefault() { prevented = true; } });

  assert.equal(prompt, 'Delete this pouch?');
  assert.equal(prevented, true);
});

test('delete confirmation allows submission and binds each form once', async () => {
  const { bindDeleteConfirmation } = await loadModule();
  const fixture = fixtures();
  let confirms = 0;
  let prevented = false;
  const confirmAction = () => {
    confirms += 1;
    return true;
  };

  bindDeleteConfirmation(fixture.root, confirmAction);
  bindDeleteConfirmation(fixture.root, confirmAction);
  fixture.submit({ preventDefault() { prevented = true; } });

  assert.equal(confirms, 1);
  assert.equal(prevented, false);
  assert.equal(fixture.form.dataset.confirmBound, 'true');
});
