const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadEditor() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'journey', 'plan_editor.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const revisionValues = Object.freeze({
  effective_date: '2099-02-01',
  pace: 'steady',
  duration_days: '49',
  end_target_mg: '12.5',
});

const revisionPreview = Object.freeze({
  preview_digest: digestA,
  effective_date: '2099-02-01',
  stages: [
    { start_date: '2099-02-01', end_date: '2099-02-07', target_pouches: 7, nicotine_ceiling_mg: '42.00' },
    { start_date: '2099-02-08', end_date: '2099-02-14', target_pouches: 6, nicotine_ceiling_mg: '36.00' },
  ],
  days: [
    { local_date: '2099-02-01', target_pouches: 7, nicotine_ceiling_mg: '42.00' },
    { local_date: '2099-02-02', target_pouches: 7, nicotine_ceiling_mg: '42.00' },
  ],
});

test('revision bodies include only supported nonblank canonical changes', async () => {
  const { revisionPreviewBody, revisionApplyBody } = await loadEditor();

  assert.deepEqual(revisionPreviewBody({
    effective_date: '2099-02-01',
    pace: ' steady ',
    duration_days: '49',
    end_target_mg: '',
  }), {
    effective_date: '2099-02-01',
    changes: { pace: 'steady', duration_days: 49 },
  });
  assert.deepEqual(revisionApplyBody(revisionValues, digestA), {
    effective_date: '2099-02-01',
    changes: {
      pace: 'steady', duration_days: 49,
      target_basis: 'nicotine_mg', end_target_mg: '12.50',
    },
    preview_digest: digestA,
    reason: 'user_edit',
    note: null,
  });
});

test('client validation rejects unsupported keys, booleans, invalid decimals, and empty changes', async () => {
  const { revisionPreviewBody, resumePreviewBody } = await loadEditor();

  for (const [values, field] of [
    [{ effective_date: '2099-02-01', pace: '', duration_days: '', end_target_mg: '' }, 'changes'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: true, end_target_mg: '' }, 'duration_days'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: '4.5', end_target_mg: '' }, 'duration_days'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: '', end_target_mg: false }, 'end_target_mg'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: '', end_target_mg: '-0.01' }, 'end_target_mg'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: '', end_target_mg: '1000000.00' }, 'end_target_mg'],
    [{ effective_date: '2099-02-01', pace: '', duration_days: '', end_target_mg: '', target_date: '2099-03-01' }, 'target_date'],
  ]) {
    assert.throws(() => revisionPreviewBody(values), (error) => Boolean(error.fieldErrors?.[field]));
  }
  assert.throws(
    () => resumePreviewBody({ resume_date: '2099-02-01', unknown: 1 }),
    (error) => Boolean(error.fieldErrors?.unknown),
  );
});

test('resume bodies remain minimal and apply adds only the displayed digest', async () => {
  const { resumePreviewBody, resumeApplyBody } = await loadEditor();
  assert.deepEqual(resumePreviewBody({ resume_date: '2099-02-01' }), {
    resume_date: '2099-02-01',
  });
  assert.deepEqual(resumeApplyBody({ resume_date: '2099-02-01' }, digestA), {
    resume_date: '2099-02-01', preview_digest: digestA,
  });
});

test('enhanced preview keeps nicotine primary and null pouch targets historical', async () => {
  const { previewTable } = await loadEditor();
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.textContent = '';
      this.innerHTML = '';
    }
    append(...children) { this.children.push(...children); }
  }
  const documentObject = {
    createElement(tagName) { return new Element(tagName); },
  };

  const wrapper = previewTable(documentObject, 'Future days', [{
    local_date: '2099-02-01',
    target_pouches: null,
    nicotine_ceiling_mg: '12.50',
  }], 'day');
  const table = wrapper.children[0];
  const head = table.children[1];
  const row = table.children[2].children[0];

  assert.equal(
    head.innerHTML,
    '<tr><th scope="col">Date</th><th scope="col">Nicotine ceiling</th><th scope="col">Historical pouch guide</th></tr>',
  );
  assert.deepEqual(
    row.children.map((cell) => cell.textContent),
    ['2099-02-01', '12.50 mg', 'Not used'],
  );
});

function makeView(kind, values) {
  return {
    kind,
    values: { ...values },
    digest: '',
    initialized: 0,
    cleaned: 0,
    busy: [],
    previews: [],
    announcements: [],
    errors: [],
    focusCount: 0,
    initialize(listeners) { this.initialized += 1; this.listeners = listeners; },
    cleanup() { this.cleaned += 1; },
    readValues() { return { ...this.values }; },
    readDigest() { return this.digest; },
    setDigest(value) { this.digest = value; },
    clearPreview() { this.previews.push(null); this.digest = ''; },
    renderPreview(value) { this.previews.push(value); },
    setBusy(value) { this.busy.push(value); },
    announce(value) { this.announcements.push(value); },
    mapFieldErrors(value) {
      this.errors.push(value);
      return { focus: () => { this.focusCount += 1; } };
    },
    applied() { this.appliedCount = (this.appliedCount || 0) + 1; },
  };
}

test('field changes send nothing, clear preview state, and require another preview', async () => {
  const { createPlanEditorController } = await loadEditor();
  const view = makeView('revision', revisionValues);
  view.digest = digestA;
  const requests = [];
  const controller = createPlanEditorController({
    kind: 'revision', planId: 7, view, csrfToken: 'csrf',
    fetchImpl: async (...args) => { requests.push(args); return jsonResponse(200, {}); },
  });

  controller.initialize();
  controller.initialize();
  controller.changed('pace');
  assert.equal(requests.length, 0);
  assert.equal(view.digest, '');
  assert.equal(view.previews.at(-1), null);
  assert.match(view.announcements.at(-1), /another preview|required/i);
  assert.equal(view.initialized, 1);
  controller.cleanup();
  controller.cleanup();
  assert.equal(view.cleaned, 1);
});

test('preview renders every returned stage and day and stores only the returned digest', async () => {
  const { createPlanEditorController } = await loadEditor();
  const view = makeView('revision', revisionValues);
  const requests = [];
  const controller = createPlanEditorController({
    kind: 'revision', planId: 7, view, csrfToken: 'csrf-value',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(200, revisionPreview);
    },
  });

  await controller.preview();
  assert.equal(requests[0][0], '/api/plans/7/revisions/preview');
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    effective_date: '2099-02-01',
    changes: {
      pace: 'steady', duration_days: 49,
      target_basis: 'nicotine_mg', end_target_mg: '12.50',
    },
  });
  assert.equal(requests[0][1].headers['X-CSRFToken'], 'csrf-value');
  assert.equal(view.digest, digestA);
  assert.deepEqual(view.previews, [revisionPreview]);
  assert.match(view.announcements.at(-1), /2099-02-01.*persisted plan is unchanged/i);
});

test('confirmation posts exact normalized inputs plus displayed digest and prevents duplicates', async () => {
  const { createPlanEditorController } = await loadEditor();
  const view = makeView('revision', revisionValues);
  view.digest = digestA;
  let resolveRequest;
  const requests = [];
  const controller = createPlanEditorController({
    kind: 'revision', planId: 7, view, csrfToken: 'csrf',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });

  const first = controller.confirm();
  const duplicate = controller.confirm();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    effective_date: '2099-02-01',
    changes: {
      pace: 'steady', duration_days: 49,
      target_basis: 'nicotine_mg', end_target_mg: '12.50',
    },
    preview_digest: digestA,
    reason: 'user_edit',
    note: null,
  });
  assert.equal(view.busy.at(-1), true);
  resolveRequest(jsonResponse(200, { updated: true }));
  await Promise.all([first, duplicate]);
  assert.equal(view.appliedCount, 1);
  assert.equal(view.busy.at(-1), false);
});

test('stale confirmation refreshes preview but never confirms again automatically', async () => {
  const { createPlanEditorController } = await loadEditor();
  const view = makeView('revision', revisionValues);
  view.digest = digestA;
  const requests = [];
  const fresh = { ...revisionPreview, preview_digest: digestB };
  const responses = [
    jsonResponse(409, { error: { code: 'preview_stale', message: 'Stale.', field_errors: {} } }),
    jsonResponse(200, fresh),
  ];
  const controller = createPlanEditorController({
    kind: 'revision', planId: 7, view, csrfToken: 'csrf',
    fetchImpl: async (url, options) => { requests.push([url, options]); return responses.shift(); },
  });

  await controller.confirm();
  assert.deepEqual(requests.map(([url]) => url), [
    '/api/plans/7/revisions', '/api/plans/7/revisions/preview',
  ]);
  assert.equal(view.digest, digestB);
  assert.equal(view.appliedCount || 0, 0);
  assert.match(view.announcements.at(-1), /fresh preview.*confirm again/i);
});

test('field errors preserve inputs, map nested changes, and focus the first visible control', async () => {
  const { createPlanEditorController } = await loadEditor();
  const view = makeView('revision', revisionValues);
  const controller = createPlanEditorController({
    kind: 'revision', planId: 7, view, csrfToken: 'csrf',
    fetchImpl: async () => jsonResponse(422, {
      error: {
        code: 'validation_error', message: 'Check the fields.',
        field_errors: { 'changes.duration_days': ['Enter a whole number.'] },
      },
    }),
  });

  await controller.preview();
  assert.deepEqual(view.values, revisionValues);
  assert.deepEqual(view.errors[0], { duration_days: ['Enter a whole number.'] });
  assert.equal(view.focusCount, 1);
  assert.match(view.announcements.at(-1), /check the fields/i);
});

test('conflicts, invalid state, and network failures retain candid recovery copy', async () => {
  const { createPlanEditorController } = await loadEditor();
  for (const response of [
    jsonResponse(409, { error: { code: 'active_plan_conflict', message: 'Conflict.', field_errors: {} } }),
    jsonResponse(409, { error: { code: 'invalid_plan_state', message: 'State.', field_errors: {} } }),
    new TypeError('network down'),
  ]) {
    const view = makeView('resume', { resume_date: '2099-02-01' });
    const controller = createPlanEditorController({
      kind: 'resume', planId: 9, view, csrfToken: 'csrf',
      fetchImpl: async () => { if (response instanceof Error) throw response; return response; },
    });
    await controller.preview();
    assert.deepEqual(view.values, { resume_date: '2099-02-01' });
    assert.match(view.announcements.at(-1), /still here|nothing changed|try again/i);
  }
});
