const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadOnboarding() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'journey', 'onboarding.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const suggestion = Object.freeze({
  available: true,
  loggedDaysUsed: 5,
  baselinePouches: '8.40',
  baselineMg: '50.40',
  baselineMgPerPouch: '6.00',
});

const support = Object.freeze({
  difficult_times: ['morning', 'after_meals'],
  common_triggers: ['stress', 'routine'],
  preferred_pouch_ids: ['17', '4'],
  reminder_window: 'evening',
});

test('context rules require only controls relevant to the selected path', async () => {
  const { deriveContext } = await loadOnboarding();

  assert.deepEqual(deriveContext({ intention: 'reduce', baseline_source: 'manual' }), {
    showBaselineChoices: true,
    showManualBaseline: true,
    showPace: true,
    showEndTarget: true,
    showTargetDate: false,
    required: [
      'intention', 'baseline_source', 'baseline_pouches',
      'baseline_mg_per_pouch', 'pace', 'end_target_pouches', 'start_date',
    ],
  });
  assert.deepEqual(deriveContext({ intention: 'quit_by_date', baseline_source: 'recent_logs' }), {
    showBaselineChoices: true,
    showManualBaseline: false,
    showPace: true,
    showEndTarget: false,
    showTargetDate: true,
    required: ['intention', 'baseline_source', 'pace', 'target_date', 'start_date'],
  });
  assert.deepEqual(deriveContext({ intention: 'observe', baseline_source: 'manual' }), {
    showBaselineChoices: false,
    showManualBaseline: false,
    showPace: false,
    showEndTarget: false,
    showTargetDate: false,
    required: ['intention', 'start_date'],
  });
});

test('plan summary turns current answers into clear live margin copy', async () => {
  const { summarizePlan } = await loadOnboarding();

  assert.deepEqual(summarizePlan({
    intention: 'reduce',
    baseline_source: 'manual',
    pace: 'steady',
    start_date: '2026-08-01',
  }), {
    intention: 'Reduce steadily',
    baseline: 'Manual entry',
    pace: 'Steady · 49 days',
    start: '2026-08-01',
  });
  assert.deepEqual(summarizePlan({
    intention: 'observe',
    baseline_source: 'observe',
    pace: '',
    start_date: '',
  }), {
    intention: 'Understand my baseline first',
    baseline: 'Seven-day observation',
    pace: 'Observation only',
    start: 'Not chosen yet',
  });
});

test('manual reduce serialization preserves exact arrays and canonical JSON types', async () => {
  const { serializeDraft, serializePlan } = await loadOnboarding();
  const answers = {
    intention: 'reduce',
    baseline_source: 'manual',
    baseline_pouches: '8.4',
    baseline_mg_per_pouch: '6',
    pace: 'steady',
    end_target_pouches: '2',
    target_date: '',
    start_date: '2026-08-01',
    ...support,
  };

  assert.deepEqual(serializeDraft(answers, suggestion), {
    intention: 'reduce',
    baseline_source: 'manual',
    baseline_pouches: '8.40',
    baseline_mg: '50.40',
    baseline_mg_per_pouch: '6.00',
    pace: 'steady',
    start_date: '2026-08-01',
    duration_days: 49,
    end_target_pouches: 2,
    difficult_times: ['morning', 'after_meals'],
    common_triggers: ['stress', 'routine'],
    preferred_pouch_ids: [17, 4],
    reminder_window: 'evening',
  });
  assert.deepEqual(serializePlan(answers, suggestion), {
    mode: 'reduce',
    baseline_source: 'manual',
    baseline_pouches: '8.40',
    baseline_mg: '50.40',
    baseline_mg_per_pouch: '6.00',
    pace: 'steady',
    start_date: '2026-08-01',
    target_date: null,
    duration_days: 49,
    end_target_pouches: 2,
    stage_targets: null,
  });
});

test('recent-log quit serialization uses the authoritative suggestion and a zero target', async () => {
  const { serializeDraft, serializePlan } = await loadOnboarding();
  const answers = {
    intention: 'quit_by_date',
    baseline_source: 'recent_logs',
    baseline_pouches: '99',
    baseline_mg_per_pouch: '99',
    pace: 'focused',
    target_date: '2026-08-29',
    end_target_pouches: '7',
    start_date: '2026-08-01',
    ...support,
  };

  assert.deepEqual(serializeDraft(answers, suggestion), {
    intention: 'quit_by_date',
    baseline_source: 'recent_logs',
    baseline_pouches: '8.40',
    baseline_mg: '50.40',
    baseline_mg_per_pouch: '6.00',
    pace: 'focused',
    start_date: '2026-08-01',
    target_date: '2026-08-29',
    duration_days: 28,
    end_target_pouches: 0,
    difficult_times: ['morning', 'after_meals'],
    common_triggers: ['stress', 'routine'],
    preferred_pouch_ids: [17, 4],
    reminder_window: 'evening',
  });
  assert.deepEqual(serializePlan(answers, suggestion), {
    mode: 'quit_by_date',
    baseline_source: 'recent_logs',
    baseline_pouches: '8.40',
    baseline_mg: '50.40',
    baseline_mg_per_pouch: '6.00',
    pace: 'focused',
    start_date: '2026-08-01',
    target_date: '2026-08-29',
    duration_days: null,
    end_target_pouches: 0,
    stage_targets: null,
  });
});

test('observe serialization cannot leak prior targeted-plan answers', async () => {
  const { serializeDraft, serializePlan } = await loadOnboarding();
  const answers = {
    intention: 'observe',
    baseline_source: 'manual',
    baseline_pouches: '8.4',
    baseline_mg_per_pouch: '6',
    pace: 'gentle',
    end_target_pouches: '2',
    target_date: '2026-10-01',
    start_date: '2026-08-01',
    ...support,
  };

  assert.deepEqual(serializeDraft(answers, suggestion), {
    intention: 'observe',
    baseline_source: 'observe',
    start_date: '2026-08-01',
    duration_days: 7,
    difficult_times: ['morning', 'after_meals'],
    common_triggers: ['stress', 'routine'],
    preferred_pouch_ids: [17, 4],
    reminder_window: 'evening',
  });
  assert.deepEqual(serializePlan(answers, suggestion), {
    mode: 'observe',
    baseline_source: 'observe',
    baseline_pouches: null,
    baseline_mg: null,
    baseline_mg_per_pouch: null,
    pace: null,
    start_date: '2026-08-01',
    target_date: null,
    duration_days: 7,
    end_target_pouches: null,
    stage_targets: null,
  });
});

test('an early-step draft omits unanswered future fields rejected by the strict API', async () => {
  const { serializeDraft } = await loadOnboarding();
  assert.deepEqual(serializeDraft({
    intention: 'reduce',
    baseline_source: '',
    baseline_pouches: '',
    baseline_mg_per_pouch: '',
    pace: '',
    end_target_pouches: '',
    target_date: '',
    start_date: '2026-08-01',
    difficult_times: [],
    common_triggers: [],
    preferred_pouch_ids: [],
    reminder_window: 'none',
  }, suggestion), {
    intention: 'reduce',
    start_date: '2026-08-01',
    difficult_times: [],
    common_triggers: [],
    preferred_pouch_ids: [],
    reminder_window: 'none',
  });
});

test('field-error normalization points nested API paths at the nearest form control', async () => {
  const { normalizeFieldErrors } = await loadOnboarding();
  assert.deepEqual(normalizeFieldErrors({
    'structured_payload.baseline_mg': ['Recalculate the nicotine total.'],
    'structured_payload.preferred_pouch_ids[1]': ['That pouch is unavailable.'],
    'stage_targets[0].end_date': ['The stage is not contiguous.'],
    target_date: ['Choose a later date.'],
  }), {
    baseline_mg_per_pouch: ['Recalculate the nicotine total.'],
    preferred_pouch_ids: ['That pouch is unavailable.'],
    pace: ['The stage is not contiguous.'],
    target_date: ['Choose a later date.'],
  });
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function makeView(initialAnswers, { digest = '' } = {}) {
  const events = [];
  const view = {
    answers: { ...initialAnswers },
    digest,
    step: null,
    busy: false,
    listeners: null,
    initializeCount: 0,
    cleanupCount: 0,
    rendered: [],
    errors: [],
    focusCount: 0,
    announcements: [],
    initialize(listeners) {
      this.initializeCount += 1;
      this.listeners = listeners;
    },
    cleanup() { this.cleanupCount += 1; },
    readAnswers() { return { ...this.answers }; },
    readDigest() { return this.digest; },
    setDigest(value) { this.digest = value; },
    setStep(value) { this.step = value; events.push(['step', value]); },
    applyContext(value) { this.context = value; },
    validateStep() { return true; },
    setBusy(value) { this.busy = value; events.push(['busy', value]); },
    announce(message) { this.announcements.push(message); },
    renderPreview(preview) { this.rendered.push(preview); },
    clearPreview() { this.digest = ''; events.push(['clear-preview']); },
    mapFieldErrors(errors) {
      this.errors.push(errors);
      return {
        step: errors.target_date ? 'pace' : 'baseline',
        focus: () => { this.focusCount += 1; },
      };
    },
  };
  return { view, events };
}

const baseAnswers = Object.freeze({
  intention: 'reduce',
  baseline_source: 'manual',
  baseline_pouches: '8.4',
  baseline_mg_per_pouch: '6',
  pace: 'steady',
  end_target_pouches: '2',
  target_date: '',
  start_date: '2026-08-01',
  ...support,
});

const preview = Object.freeze({
  preview_digest: 'a'.repeat(64),
  normalized_input: {
    mode: 'reduce', baseline_source: 'manual', baseline_pouches: '8.40',
    baseline_mg: '50.40', baseline_mg_per_pouch: '6.00', pace: 'steady',
    start_date: '2026-08-01', target_date: '2026-09-18', duration_days: 49,
    end_target_pouches: 2, stage_targets: null,
  },
  stages: [{
    start_date: '2026-08-01', end_date: '2026-08-07', target_pouches: 9,
    nicotine_ceiling_mg: '54.00',
  }],
  days: [{
    local_date: '2026-08-01', target_pouches: 9, nicotine_ceiling_mg: '54.00',
  }],
});

test('five-step controller saves valid forward transitions and preserves answers across Back', async () => {
  const { createOnboardingController } = await loadOnboarding();
  const { view } = makeView(baseAnswers);
  const requests = [];
  const controller = createOnboardingController({
    view,
    suggestion,
    csrfToken: 'csrf-value',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(200, { saved: true });
    },
    location: { assign() { throw new Error('must not redirect'); } },
  });

  controller.initialize();
  controller.initialize();
  assert.equal(view.initializeCount, 1);
  assert.equal(view.step, 'intention');

  await controller.continue();
  assert.equal(view.step, 'baseline');
  view.answers.baseline_pouches = '10.25';
  await controller.continue();
  assert.equal(view.step, 'pace');
  controller.back();
  assert.equal(view.step, 'baseline');
  assert.equal(view.answers.baseline_pouches, '10.25');

  assert.equal(requests.length, 2);
  assert.equal(requests[0][0], '/api/onboarding-draft');
  assert.equal(requests[0][1].method, 'PUT');
  assert.equal(requests[0][1].headers['X-CSRFToken'], 'csrf-value');
  assert.equal(JSON.parse(requests[0][1].body).current_step, 'baseline');
  assert.equal(JSON.parse(requests[1][1].body).current_step, 'pace');

  controller.cleanup();
  controller.cleanup();
  assert.equal(view.cleanupCount, 1);
});

test('a failed draft save retains answers and keeps the user on the current step', async () => {
  const { createOnboardingController } = await loadOnboarding();
  const { view } = makeView(baseAnswers);
  const controller = createOnboardingController({
    view,
    suggestion,
    csrfToken: 'csrf-value',
    fetchImpl: async () => jsonResponse(500, {
      error: { code: 'internal_error', message: 'Try again.', field_errors: {}, retryable: true },
    }),
    location: { assign() {} },
  });

  controller.initialize();
  await controller.continue();
  assert.equal(view.step, 'intention');
  assert.equal(view.answers.baseline_pouches, '8.4');
  assert.match(view.announcements.at(-1), /could not save|try again/i);
});

test('plan-affecting changes invalidate a digest while support-only changes do not', async () => {
  const { createOnboardingController } = await loadOnboarding();
  const { view, events } = makeView(baseAnswers, { digest: 'a'.repeat(64) });
  const controller = createOnboardingController({
    view,
    suggestion,
    csrfToken: 'csrf-value',
    fetchImpl: async () => jsonResponse(200, { saved: true }),
    location: { assign() {} },
  });
  controller.initialize();
  assert.equal(view.step, 'review');

  controller.answerChanged('common_triggers');
  assert.equal(view.digest, 'a'.repeat(64));
  controller.answerChanged('pace');
  assert.equal(view.digest, '');
  assert.deepEqual(events.filter(([name]) => name === 'clear-preview'), [['clear-preview']]);
});

test('preview validation maps API errors and focuses the step containing the first field', async () => {
  const { createOnboardingController } = await loadOnboarding();
  const { view } = makeView(baseAnswers);
  let requestCount = 0;
  const controller = createOnboardingController({
    view,
    suggestion,
    csrfToken: 'csrf-value',
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) return jsonResponse(200, { saved: true });
      return jsonResponse(422, {
        error: {
          code: 'validation_error', message: 'Check the highlighted fields.',
          field_errors: { target_date: ['Choose a later date.'] }, retryable: false,
        },
      });
    },
    location: { assign() {} },
  });
  controller.initialize();
  await controller.goTo('support');
  await controller.continue();

  assert.equal(view.step, 'pace');
  assert.deepEqual(view.errors, [{ target_date: ['Choose a later date.'] }]);
  assert.equal(view.focusCount, 1);
});

test('preview_stale refreshes the review but requires a second explicit confirmation', async () => {
  const { createOnboardingController } = await loadOnboarding();
  const staleDigest = 'b'.repeat(64);
  const { view, events } = makeView(baseAnswers, { digest: staleDigest });
  const requests = [];
  const redirects = [];
  const controller = createOnboardingController({
    view,
    suggestion,
    csrfToken: 'csrf-value',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === '/api/plans' && requests.filter(([item]) => item === '/api/plans').length === 1) {
        return jsonResponse(409, {
          error: { code: 'preview_stale', message: 'Stale.', field_errors: {}, retryable: false },
        });
      }
      if (url === '/api/plans/preview') return jsonResponse(200, preview);
      return jsonResponse(201, { plan: { id: 41 }, created: true });
    },
    location: { assign(url) { redirects.push(url); } },
  });
  controller.initialize();

  await Promise.all([controller.confirm(), controller.confirm()]);
  assert.equal(requests.filter(([url]) => url === '/api/plans').length, 1);
  assert.equal(requests.filter(([url]) => url === '/api/plans/preview').length, 1);
  assert.equal(view.digest, preview.preview_digest);
  assert.deepEqual(view.rendered, [preview]);
  assert.deepEqual(redirects, []);
  assert.equal(events.at(-1)[1], false, 'confirmation control is re-enabled after stale recovery');
  assert.match(view.announcements.at(-1), /fresh|review|confirm again/i);

  await controller.confirm();
  const createRequests = requests.filter(([url]) => url === '/api/plans');
  assert.equal(createRequests.length, 2);
  const secondPayload = JSON.parse(createRequests[1][1].body);
  assert.equal(secondPayload.preview_digest, preview.preview_digest);
  assert.equal(secondPayload.activation, 'activate');
  for (const [, options] of requests) {
    assert.equal(options.headers['X-CSRFToken'], 'csrf-value');
  }
  assert.deepEqual(redirects, ['/today']);
});
