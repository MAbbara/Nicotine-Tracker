const assert = require('node:assert/strict');
const { test } = require('node:test');

const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

test('Tailwind tooling stays synchronized without DaisyUI', () => {
  assert.equal(pkg.dependencies.tailwindcss, '4.3.1');
  assert.equal(pkg.dependencies['@tailwindcss/cli'], '4.3.1');
  assert.equal(lock.packages['node_modules/tailwindcss'].version, '4.3.1');
  assert.equal(lock.packages['node_modules/@tailwindcss/cli'].version, '4.3.1');
  assert.equal(pkg.dependencies?.daisyui, undefined);
  assert.equal(pkg.devDependencies?.daisyui, undefined);
});
