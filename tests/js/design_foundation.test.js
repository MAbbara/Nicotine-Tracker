const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('Journey compact visual system remains source-authored and accessible', () => {
  const css = fs.readFileSync('static/css/tailwind.css', 'utf8');

  assert.match(css, /--color-journey-control-border:\s*#[0-9A-Fa-f]{6}/);
  assert.match(css, /\.journey-progress-readout__primary dd\s*{[^}]*font-size:\s*clamp\(2\.5rem,\s*5vw,\s*4rem\)/s);
  assert.match(css, /\[data-journey-trajectory\]\s*{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\[data-journey-day\]\s*{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/s);
  assert.match(css, /\[data-journey-day\]\[aria-pressed="true"\]\s*{[^}]*box-shadow:\s*inset 0 -\.1875rem 0 currentColor/s);
  assert.match(css, /\[data-journey-day\]\[data-journey-level\]::after\s*\{[^}]*--journey-level-offset/s);
  assert.doesNotMatch(css, /\[data-journey-day\]:nth-child\([^)]*\)\s*\{[^}]*--journey-(?:slope|level)/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.journey-page \*,[\s\S]*\.journey-page \*::before,[\s\S]*\.journey-page \*::after/s);
});
