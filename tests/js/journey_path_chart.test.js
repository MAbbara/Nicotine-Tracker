import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  milestonePresentation,
  normalizeStages,
  resolveChartDomain,
} from '../../static/js/journey/path_chart.js';

test('deep Journey chart accepts nicotine-only stages and omits pouch authority', () => {
  const stages = normalizeStages([
    { start: '2026-08-01', end: '2026-08-07', mg: '24.00', pouches: null },
    { start_date: '2026-08-08', end_date: '2026-08-14', nicotine_ceiling_mg: '18.50' },
    { start: '2026-08-15', end: '2026-08-21', mg: null, pouches: 4 },
  ]);

  assert.deepEqual(stages, [
    { start: '2026-08-01', end: '2026-08-07', mg: 24 },
    { start: '2026-08-08', end: '2026-08-14', mg: 18.5 },
  ]);
  assert.equal(stages.some((stage) => Object.hasOwn(stage, 'pouches')), false);
});

test('active overview observes the existing editor without creating a second controller', async () => {
  const source = await readFile(
    new URL('../../static/js/journey/active_overview.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /journey:plan-preview/);
  assert.doesNotMatch(source, /createPlanEditorController/);
  assert.doesNotMatch(source, /data-path-editor/);
});

test('chart domain omits an out-of-range Today and expands for a longer preview', () => {
  const payload = {
    start: '2026-08-10',
    end: '2026-08-31',
    today: '2026-08-08',
  };
  const preview = [{ start: '2026-08-12', end: '2026-09-20', mg: 12 }];

  assert.deepEqual(resolveChartDomain(payload, preview), {
    start: '2026-08-10',
    end: '2026-09-20',
    todayInRange: false,
  });
});

test('equal nicotine stages are announced as continuity rather than change', () => {
  assert.deepEqual(milestonePresentation(
    { start: '2026-08-01', end: '2026-08-07', mg: 36 },
    { start: '2026-08-08', end: '2026-08-14', mg: 36 },
  ), {
    tip: '8 Aug · ceiling continues at 36.00 mg',
    accessibleName: '8 August: nicotine ceiling continues at 36.00 mg',
    changed: false,
  });
});
