const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'cravings', 'page.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function formData(entries, symptoms = []) {
  return {
    *entries() { yield* entries; },
    getAll(name) { return name === 'physical_symptoms' ? symptoms : []; },
  };
}

test('minimal detailed craving payload contains only the required intensity', async () => {
  const { buildCravingPayload } = await loadModule();
  const payload = buildCravingPayload(formData([
    ['csrf_token', 'header-only-token'],
    ['intensity', '3'],
    ['trigger', ''],
    ['notes', '   '],
  ]));

  assert.deepEqual(payload, { intensity: 3 });
});

test('complete detailed craving payload normalizes numbers, text, and symptoms', async () => {
  const { buildCravingPayload } = await loadModule();
  const payload = buildCravingPayload(formData([
    ['intensity', '8'],
    ['trigger', 'stress'],
    ['mood_before', '4'],
    ['stress_level', '9'],
    ['duration_minutes', '0'],
    ['situation_context', '  After a meeting  '],
    ['outcome', 'used_alternative'],
    ['mood_after', '6'],
    ['notes', '  It eased  '],
    ['outcome_notes', '  Took a walk  '],
  ], ['restlessness', 'irritability']));

  assert.deepEqual(payload, {
    intensity: 8,
    trigger: 'stress',
    mood_before: 4,
    stress_level: 9,
    duration_minutes: 0,
    situation_context: 'After a meeting',
    outcome: 'used_alternative',
    mood_after: 6,
    notes: 'It eased',
    outcome_notes: 'Took a walk',
    physical_symptoms: ['restlessness', 'irritability'],
  });
});

test('history helpers parse legacy symptoms and format naive UTC in the account timezone', async () => {
  const { formatCravingTime, parseSymptoms } = await loadModule();

  assert.deepEqual(parseSymptoms('["restlessness","irritability"]'), [
    'restlessness', 'irritability',
  ]);
  assert.deepEqual(parseSymptoms('not json'), []);
  assert.match(
    formatCravingTime('2026-01-10T10:00:00', 'Asia/Riyadh'),
    /1:00\s*PM|13:00/i,
  );
});
