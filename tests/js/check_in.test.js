const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadCheckIn() {
  let source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'check_in.js'),
    'utf8',
  );
  const timelineSource = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'timeline.js'),
    'utf8',
  );
  const timelineUrl = `data:text/javascript;base64,${Buffer.from(timelineSource).toString('base64')}`;
  source = source.replace("'./timeline.js'", `'${timelineUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function canonical(overrides = {}) {
  return {
    id: 9,
    local_date: '2026-07-30',
    mood: 3,
    confidence: 4,
    reflection: 'A pause helped.',
    context: 'Workday',
    ...overrides,
  };
}

function makeView() {
  return {
    handlers: null,
    initialized: 0,
    cleaned: 0,
    editing: [],
    busy: [],
    summaries: [],
    failures: [],
    fieldErrors: [],
    announcements: [],
    refreshUnavailable: [],
    offers: 0,
    initialize(handlers) { this.handlers = handlers; this.initialized += 1; },
    cleanup() { this.cleaned += 1; },
    showEditing(draft, action) { this.editing.push([draft, action]); },
    setBusy(value) { this.busy.push(value); },
    showSummary(value) { this.summaries.push(value); },
    showOffer() { this.offers += 1; },
    showFailure(error) { this.failures.push(error); },
    showFieldErrors(errors) { this.fieldErrors.push(errors); },
    announce(message) { this.announcements.push(message); },
    showRefreshUnavailable(value) { this.refreshUnavailable.push(value); },
  };
}

function makeTimeline() {
  return {
    reconciledToday: [],
    reconciledTimeline: [],
    reconcileToday(today) {
      this.reconciledToday.push(today);
      this.reconcileTimeline(today.timeline || []);
    },
    reconcileTimeline(items) { this.reconciledTimeline.push(items); },
  };
}

test('check-in attention cues an incomplete action once and never under reduced motion', async () => {
  const { maybeCueCheckIn } = await loadCheckIn();
  const offer = { hidden: false };
  const action = {
    dataset: {},
    disabled: false,
    closest(selector) {
      return selector === '[data-check-in-offer]' ? offer : null;
    },
  };
  const root = {
    querySelector(selector) {
      return selector === '[data-check-in-action]' ? action : null;
    },
  };
  const storage = { shown: false };

  assert.equal(maybeCueCheckIn(root, { reducedMotion: true, storage }), false);
  assert.equal(action.dataset.attentionCue, undefined);
  assert.equal(storage.shown, false);

  assert.equal(maybeCueCheckIn(root, { reducedMotion: false, storage }), true);
  assert.equal(action.dataset.attentionCue, 'active');
  assert.equal(storage.shown, true);

  delete action.dataset.attentionCue;
  assert.equal(maybeCueCheckIn(root, { reducedMotion: false, storage }), false);
  assert.equal(action.dataset.attentionCue, undefined);

  offer.hidden = true;
  assert.equal(
    maybeCueCheckIn(root, { reducedMotion: false, storage: { shown: false } }),
    false,
  );
});

test('payload contains exactly four normalized optional fields', async () => {
  const { buildCheckInPayload } = await loadCheckIn();

  assert.deepEqual(buildCheckInPayload({
    mood: '',
    confidence: '5',
    reflection: '  The afternoon was easier.  ',
    context: ' \n ',
  }), {
    mood: null,
    confidence: 5,
    reflection: 'The afternoon was easier.',
    context: null,
  });
  assert.deepEqual(buildCheckInPayload({}), {
    mood: null,
    confidence: null,
    reflection: null,
    context: null,
  });
});

test('client validation reports ratings and trimmed text limits by field', async () => {
  const { validateCheckInDraft, CheckInValidationError } = await loadCheckIn();

  assert.throws(() => validateCheckInDraft({
    mood: '6',
    confidence: '3.5',
    reflection: `  ${'x'.repeat(2001)}  `,
    context: 'ok',
  }), (error) => {
    assert.equal(error instanceof CheckInValidationError, true);
    assert.deepEqual(Object.keys(error.fieldErrors).sort(), [
      'confidence', 'mood', 'reflection',
    ]);
    return true;
  });
});

test('reopening after save uses canonical values rather than the stale draft', async () => {
  const { checkInReducer } = await loadCheckIn();
  const saved = canonical({ mood: 5, reflection: 'Canonical save' });
  let state = checkInReducer({ status: 'offered', canonical: null }, { type: 'OPEN' });
  state = checkInReducer(state, {
    type: 'CHANGE',
    changes: { mood: '2', reflection: 'Stale draft' },
  });
  state = checkInReducer(state, { type: 'SUBMIT' });
  state = checkInReducer(state, { type: 'SAVE_OK', canonical: saved });
  state = checkInReducer(state, { type: 'OPEN' });

  assert.equal(state.status, 'editing');
  assert.deepEqual(state.draft, {
    mood: '5',
    confidence: '4',
    reflection: 'Canonical save',
    context: 'Workday',
  });
});

test('one in-flight submission suppresses a double submit', async () => {
  const { createCheckInController } = await loadCheckIn();
  const request = deferred();
  let fetchCount = 0;
  const view = makeView();
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    csrfToken: 'csrf',
    fetchImpl: async () => {
      fetchCount += 1;
      return request.promise;
    },
  });
  controller.initialize();
  controller.open();
  controller.change({ mood: '3' });

  const first = controller.submit();
  const second = controller.submit();
  assert.equal(fetchCount, 1);
  request.resolve(jsonResponse(200, {
    check_in: canonical(),
    today: { timeline: [] },
    warnings: [],
  }));
  await Promise.all([first, second]);
  assert.equal(fetchCount, 1);
  assert.equal(view.summaries.length, 1);
});

test('Today-null success keeps canonical summary and shows refresh-later state', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const timeline = makeTimeline();
  const saved = canonical({ reflection: 'Still saved' });
  const controller = createCheckInController({
    view,
    timeline,
    fetchImpl: async () => jsonResponse(200, {
      check_in: saved,
      today: null,
      warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
    }),
  });
  controller.initialize();
  controller.open();
  controller.change({ reflection: 'Still saved' });
  await controller.submit();

  assert.deepEqual(view.summaries, [saved]);
  assert.deepEqual(view.refreshUnavailable, [true]);
  assert.deepEqual(timeline.reconciledToday, []);
  assert.deepEqual(timeline.reconciledTimeline, []);
});

test('canonical Today success reconciles its typed timeline without duplicates', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const timeline = makeTimeline();
  const saved = canonical();
  const typedTimeline = [{
    type: 'check_in',
    id: saved.id,
    occurred_at_utc: '2026-07-30T20:00:00+00:00',
    occurred_at_local: '2026-07-30T20:00:00+00:00',
    state: 'completed',
    label: 'Daily check-in',
    data: saved,
  }];
  const today = { timeline: typedTimeline };
  const controller = createCheckInController({
    view,
    timeline,
    fetchImpl: async () => jsonResponse(200, {
      check_in: saved,
      today,
      warnings: [],
    }),
  });
  controller.initialize();
  controller.open();
  await controller.submit();

  assert.deepEqual(timeline.reconciledToday, [today]);
  assert.deepEqual(timeline.reconciledTimeline, [typedTimeline]);
});

test('committed save survives optional Today reconciliation failure without retry', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const timeline = makeTimeline();
  timeline.reconcileToday = () => {
    throw new Error('synthetic optional DOM reconciliation failure');
  };
  const saved = canonical({ reflection: 'Committed value' });
  let requestCount = 0;
  const controller = createCheckInController({
    view,
    timeline,
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse(200, {
        check_in: saved,
        today: { timeline: [] },
        warnings: [],
      });
    },
  });
  controller.initialize();
  controller.open();

  const result = await controller.submit();

  assert.equal(result, true);
  assert.equal(requestCount, 1);
  assert.equal(controller.getState().status, 'saved');
  assert.deepEqual(view.summaries, [saved]);
  assert.deepEqual(view.failures, []);
  assert.deepEqual(view.refreshUnavailable, [true]);
});

test('canonical Today adoption replaces an empty offer before opening the form', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const savedElsewhere = canonical({
    mood: 5,
    confidence: 2,
    reflection: 'Saved in another session',
    context: 'Evening',
  });
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    initialCanonical: null,
  });
  controller.initialize();

  controller.adoptCanonicalToday({
    local_date: savedElsewhere.local_date,
    check_in: savedElsewhere,
    check_in_eligible: true,
  });
  controller.open();

  assert.deepEqual(view.summaries, [savedElsewhere]);
  assert.deepEqual(view.editing.at(-1), [{
    mood: '5',
    confidence: '2',
    reflection: 'Saved in another session',
    context: 'Evening',
  }, 'Update reflection']);
  assert.deepEqual(controller.getState().canonical, savedElsewhere);
});

test('canonical absent next day clears old values instead of retaining them', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    initialCanonical: canonical({ reflection: 'Yesterday only' }),
  });
  controller.initialize();

  controller.adoptCanonicalToday({
    local_date: '2026-07-31',
    check_in: null,
    check_in_eligible: true,
  });
  controller.open();

  assert.equal(controller.getState().canonical, null);
  assert.equal(view.offers, 1);
  assert.deepEqual(view.editing.at(-1), [{
    mood: '',
    confidence: '',
    reflection: '',
    context: '',
  }, 'Save reflection']);
});

test('external canonical adoption preserves an in-progress private edit until cancel', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const original = canonical({ reflection: 'Original canonical' });
  const newer = canonical({ reflection: 'Newer canonical', mood: 4 });
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    initialCanonical: original,
  });
  controller.initialize();
  controller.open();
  controller.change({ reflection: 'Private in-progress draft', mood: '2' });

  controller.adoptCanonicalToday({
    local_date: newer.local_date,
    check_in: newer,
    check_in_eligible: true,
  });

  assert.equal(controller.getState().status, 'editing');
  assert.equal(controller.getState().draft.reflection, 'Private in-progress draft');
  assert.equal(controller.getState().draft.mood, '2');
  controller.cancel();
  assert.deepEqual(view.summaries.at(-1), newer);
  controller.open();
  assert.deepEqual(view.editing.at(-1), [{
    mood: '4',
    confidence: '4',
    reflection: 'Newer canonical',
    context: 'Workday',
  }, 'Update reflection']);
});

test('cleanup resets stale-snapshot ordering before a fresh initialization', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const newerClock = canonical({ reflection: 'First lifecycle' });
  const correctedClock = canonical({ reflection: 'Fresh lifecycle after clock correction' });
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
  });
  controller.initialize();
  assert.equal(controller.adoptCanonicalToday({
    local_date: newerClock.local_date,
    check_in: newerClock,
    check_in_eligible: true,
    generated_at: '2026-07-30T22:00:00+00:00',
  }), true);

  controller.cleanup();
  controller.initialize();
  assert.equal(controller.adoptCanonicalToday({
    local_date: correctedClock.local_date,
    check_in: correctedClock,
    check_in_eligible: true,
    generated_at: '2026-07-30T21:00:00+00:00',
  }), true);

  assert.deepEqual(controller.getState().canonical, correctedClock);
  assert.deepEqual(view.summaries.at(-1), correctedClock);
});

test('external canonical adoption defers during save and active POST success wins', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const request = deferred();
  const original = canonical({ reflection: 'Original canonical' });
  const external = canonical({ reflection: 'External while saving', mood: 1 });
  const ownSuccess = canonical({ reflection: 'Own committed response', mood: 5 });
  let requestSignal;
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    initialCanonical: original,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return request.promise;
    },
  });
  controller.initialize();
  controller.open();
  controller.change({ reflection: 'Private submitted draft', mood: '5' });
  const saving = controller.submit();

  controller.adoptCanonicalToday({
    local_date: external.local_date,
    check_in: external,
    check_in_eligible: true,
  });
  assert.equal(controller.getState().status, 'saving');
  assert.equal(controller.getState().draft.reflection, 'Private submitted draft');
  assert.equal(requestSignal.aborted, false);

  request.resolve(jsonResponse(200, {
    check_in: ownSuccess,
    today: null,
    warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
  }));
  await saving;

  assert.equal(controller.getState().status, 'saved');
  assert.deepEqual(controller.getState().canonical, ownSuccess);
  assert.deepEqual(view.summaries.at(-1), ownSuccess);
  assert.equal(view.summaries.includes(external), false);
});

test('server failures are sanitized and retry reuses the same exact payload', async () => {
  const { createCheckInController } = await loadCheckIn();
  const view = makeView();
  const payloads = [];
  let attempt = 0;
  const controller = createCheckInController({
    view,
    timeline: makeTimeline(),
    fetchImpl: async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse(500, {
          error: {
            code: 'internal_error',
            message: '<script>raw internal detail</script>',
            field_errors: {},
            retryable: true,
          },
        });
      }
      return jsonResponse(200, {
        check_in: canonical(),
        today: { timeline: [] },
        warnings: [],
      });
    },
  });
  controller.initialize();
  controller.open();
  controller.change({ mood: '3', reflection: 'Keep this' });
  await controller.submit();

  assert.equal(view.failures.length, 1);
  assert.equal(view.failures[0].message, 'We could not save your reflection. Try again.');
  assert.equal(view.failures[0].message.includes('<script>'), false);
  await controller.retry();
  assert.deepEqual(payloads[1], payloads[0]);
  assert.equal(view.summaries.length, 1);
});
