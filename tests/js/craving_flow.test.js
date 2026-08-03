const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadCravingFlow() {
  let source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'craving_flow.js'),
    'utf8',
  );
  if (source.includes("'./quick_log.js'")) {
    let quickLogSource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'today', 'quick_log.js'),
      'utf8',
    );
    for (const dependency of ['action_enhancement.js', 'timeline.js', 'offline_queue.js']) {
      const dependencySource = fs.readFileSync(
        path.join(projectRoot, 'static', 'js', 'today', dependency),
        'utf8',
      );
      const dependencyUrl = `data:text/javascript;base64,${Buffer.from(dependencySource).toString('base64')}`;
      quickLogSource = quickLogSource.replace(`'./${dependency}'`, `'${dependencyUrl}'`);
    }
    const dialogFocusSource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'shell', 'dialog_focus.js'),
      'utf8',
    );
    const dialogFocusUrl = `data:text/javascript;base64,${Buffer.from(dialogFocusSource).toString('base64')}`;
    quickLogSource = quickLogSource.replace("'../shell/dialog_focus.js'", `'${dialogFocusUrl}'`);
    const quickLogUrl = `data:text/javascript;base64,${Buffer.from(quickLogSource).toString('base64')}`;
    source = source.replace("'./quick_log.js'", `'${quickLogUrl}'`);
  }
  if (source.includes("'./timeline.js'")) {
    const timelineSource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'today', 'timeline.js'),
      'utf8',
    );
    const timelineUrl = `data:text/javascript;base64,${Buffer.from(timelineSource).toString('base64')}`;
    source = source.replace("'./timeline.js'", `'${timelineUrl}'`);
  }
  if (source.includes("'./action_enhancement.js'")) {
    const enhancementSource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'today', 'action_enhancement.js'),
      'utf8',
    );
    const enhancementUrl = `data:text/javascript;base64,${Buffer.from(enhancementSource).toString('base64')}`;
    source = source.replace("'./action_enhancement.js'", `'${enhancementUrl}'`);
  }
  if (source.includes("'../shell/dialog_focus.js'")) {
    const dialogFocusSource = fs.readFileSync(
      path.join(projectRoot, 'static', 'js', 'shell', 'dialog_focus.js'),
      'utf8',
    );
    const dialogFocusUrl = `data:text/javascript;base64,${Buffer.from(dialogFocusSource).toString('base64')}`;
    source = source.replace("'../shell/dialog_focus.js'", `'${dialogFocusUrl}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadTimeline() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'timeline.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function makeCheckedInState() {
  const { cravingFlowReducer } = await loadCravingFlow();
  const opened = cravingFlowReducer({ status: 'closed' }, {
    type: 'OPEN',
    clientEventId: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurredAtLocal: '2026-07-30T18:42',
  });
  return cravingFlowReducer(opened, {
    type: 'EDIT_CHECK_IN',
    changes: { intensity: 7, trigger: 'after lunch' },
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
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

function makeView() {
  return {
    handlers: null,
    opened: [],
    rendered: [],
    busy: [],
    failures: [],
    announcements: [],
    closed: 0,
    quickLogHandoffs: [],
    quickLogUnavailable: [],
    initialize(handlers) { this.handlers = handlers; },
    cleanup() {},
    open(state, trigger) { this.opened.push([state, trigger]); },
    render(state) { this.rendered.push(state); },
    setBusy(operation, value) { this.busy.push([operation, value]); },
    showFailure(error) { this.failures.push(error); },
    announce(message) { this.announcements.push(message); },
    close() { this.closed += 1; },
    showQuickLogHandoff(message) { this.quickLogHandoffs.push(message); },
    showQuickLogUnavailable(message) { this.quickLogUnavailable.push(message); },
    returnedFocus: 0,
    returnFocus() { this.returnedFocus += 1; },
  };
}

function makeTimeline() {
  return {
    pendingCravings: [],
    canonicalCravings: [],
    reconciled: [],
    reconciledTimelines: [],
    insertPendingCraving(state) { this.pendingCravings.push(state); },
    upsertCraving(craving) { this.canonicalCravings.push(craving); },
    failedCravings: [],
    markCravingFailed(clientEventId) { this.failedCravings.push(clientEventId); },
    removedCravings: [],
    removePendingCraving(clientEventId) { this.removedCravings.push(clientEventId); },
    reconcileToday(today) { this.reconciled.push(today); },
    reconcileTimeline(items) { this.reconciledTimelines.push(items); },
  };
}

test('OPEN starts one check-in draft with the supplied event identity and local minute', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const state = cravingFlowReducer({ status: 'closed' }, {
    type: 'OPEN',
    clientEventId: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurredAtLocal: '2026-07-30T18:42',
  });

  assert.deepEqual(state, {
    status: 'check_in',
    clientEventId: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurredAtLocal: '2026-07-30T18:42',
    intensity: null,
    trigger: '',
    canonicalCraving: null,
    selectedAction: null,
    pauseDeadline: null,
    remainingSeconds: null,
    outcome: null,
    details: {},
    operation: null,
    error: null,
    nicotineLinked: false,
    nicotinePending: false,
    nicotineLinkUnknown: false,
  });
});

test('EDIT_CHECK_IN keeps the original event identity while changing check-in fields', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const original = cravingFlowReducer({ status: 'closed' }, {
    type: 'OPEN',
    clientEventId: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurredAtLocal: '2026-07-30T18:42',
  });

  const state = cravingFlowReducer(original, {
    type: 'EDIT_CHECK_IN',
    changes: { intensity: 7, trigger: 'after lunch' },
  });

  assert.equal(state.clientEventId, original.clientEventId);
  assert.equal(state.occurredAtLocal, original.occurredAtLocal);
  assert.equal(state.intensity, 7);
  assert.equal(state.trigger, 'after lunch');
});

test('SUBMIT_CHECK_IN stays on the check-in step while the create operation is active', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const state = cravingFlowReducer(await makeCheckedInState(), {
    type: 'SUBMIT_CHECK_IN',
  });

  assert.equal(state.status, 'check_in');
  assert.equal(state.operation, 'create');
  assert.equal(state.error, null);
});

test('buildCravingCreatePayload emits the exact canonical create shape', async () => {
  const { buildCravingCreatePayload } = await loadCravingFlow();

  assert.deepEqual(buildCravingCreatePayload(await makeCheckedInState(), 'Asia/Riyadh'), {
    client_event_id: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    intensity: 7,
    trigger: 'after lunch',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    timezone: 'Asia/Riyadh',
  });
});

test('CREATE_OK advances to action choice with the canonical unresolved craving', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const submitting = cravingFlowReducer(await makeCheckedInState(), {
    type: 'SUBMIT_CHECK_IN',
  });
  const canonicalCraving = {
    id: 41,
    client_event_id: submitting.clientEventId,
    intensity: 7,
    trigger: 'after lunch',
    outcome: null,
    linked_log_id: null,
  };

  const state = cravingFlowReducer(submitting, {
    type: 'CREATE_OK', canonicalCraving,
  });

  assert.equal(state.status, 'action_choice');
  assert.equal(state.operation, null);
  assert.equal(state.canonicalCraving, canonicalCraving);
  assert.equal(state.error, null);
});

test('CHOOSE_ACTION starts the pause from one absolute three-minute deadline', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const submitting = cravingFlowReducer(await makeCheckedInState(), {
    type: 'SUBMIT_CHECK_IN',
  });
  const created = cravingFlowReducer(submitting, {
    type: 'CREATE_OK',
    canonicalCraving: { id: 41, outcome: null },
  });

  const state = cravingFlowReducer(created, {
    type: 'CHOOSE_ACTION', action: 'pause', now: 1_000,
  });

  assert.equal(state.status, 'pause');
  assert.equal(state.selectedAction, 'pause');
  assert.equal(state.pauseDeadline, 181_000);
  assert.equal(state.remainingSeconds, 180);
});

test('PAUSE_TICK recomputes from the deadline and waits for an explicit outcome at zero', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const pause = {
    ...(await makeCheckedInState()),
    status: 'pause',
    canonicalCraving: { id: 41, outcome: null },
    selectedAction: 'pause',
    pauseDeadline: 181_000,
    remainingSeconds: 180,
  };

  const resumed = cravingFlowReducer(pause, { type: 'PAUSE_TICK', now: 121_250 });
  const complete = cravingFlowReducer(resumed, { type: 'PAUSE_TICK', now: 190_000 });

  assert.equal(resumed.remainingSeconds, 60);
  assert.equal(complete.remainingSeconds, 0);
  assert.equal(complete.status, 'pause');
  assert.equal(complete.outcome, null);
});

test('SHOW_OUTCOME leaves the pause early without choosing an outcome for the user', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const pause = {
    ...(await makeCheckedInState()),
    status: 'pause',
    canonicalCraving: { id: 41, outcome: null },
    selectedAction: 'pause',
    pauseDeadline: 181_000,
    remainingSeconds: 137,
  };

  const state = cravingFlowReducer(pause, { type: 'SHOW_OUTCOME' });

  assert.equal(state.status, 'outcome');
  assert.equal(state.outcome, null);
  assert.equal(state.canonicalCraving.outcome, null);
});

test('SELECT_OUTCOME records only one allowed local choice before the server patch', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const outcome = {
    ...(await makeCheckedInState()),
    status: 'outcome',
    canonicalCraving: { id: 41, outcome: null },
  };

  const state = cravingFlowReducer(outcome, {
    type: 'SELECT_OUTCOME', outcome: 'used_alternative',
  });

  assert.equal(state.status, 'outcome');
  assert.equal(state.outcome, 'used_alternative');
  assert.equal(state.operation, null);
  assert.equal(state.canonicalCraving.outcome, null);
});

test('OUTCOME_OK advances to optional details only after canonical outcome success', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const selected = {
    ...(await makeCheckedInState()),
    status: 'outcome',
    canonicalCraving: { id: 41, outcome: null },
    outcome: 'resisted',
  };
  const submitting = cravingFlowReducer(selected, { type: 'SUBMIT_OUTCOME' });
  const canonicalCraving = { id: 41, outcome: 'resisted', linked_log_id: null };
  const state = cravingFlowReducer(submitting, {
    type: 'OUTCOME_OK', canonicalCraving,
  });

  assert.equal(submitting.status, 'outcome');
  assert.equal(submitting.operation, 'outcome');
  assert.equal(state.status, 'details');
  assert.equal(state.operation, null);
  assert.equal(state.canonicalCraving, canonicalCraving);
  assert.equal(state.outcome, 'resisted');
});

test('remaining reducer transitions retain recoverable data and close cleanly', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const checkedIn = await makeCheckedInState();
  const submitting = cravingFlowReducer(checkedIn, { type: 'SUBMIT_CHECK_IN' });
  const failed = cravingFlowReducer(submitting, {
    type: 'CREATE_FAILED', error: { message: 'Try again.', fieldErrors: {} },
  });
  const retrying = cravingFlowReducer(failed, { type: 'RETRY_CREATE' });
  const canonicalCraving = { id: 41, outcome: null, linked_log_id: null };
  const actionChoice = cravingFlowReducer(retrying, {
    type: 'CREATE_OK', canonicalCraving,
  });
  const outcome = cravingFlowReducer(actionChoice, {
    type: 'CHOOSE_ACTION', action: 'drink_water', now: 1_000,
  });
  const selected = cravingFlowReducer(outcome, {
    type: 'SELECT_OUTCOME', outcome: 'used_nicotine',
  });
  const outcomeSubmitting = cravingFlowReducer(selected, { type: 'SUBMIT_OUTCOME' });
  const details = cravingFlowReducer(outcomeSubmitting, {
    type: 'OUTCOME_OK',
    canonicalCraving: { ...canonicalCraving, outcome: 'used_nicotine' },
  });
  const complete = cravingFlowReducer(details, { type: 'SKIP_DETAILS' });
  const linked = cravingFlowReducer(complete, {
    type: 'QUICK_LOG_LINKED',
    cravingId: 41,
    log: { id: 31 },
    canonicalCraving: { ...canonicalCraving, outcome: 'used_nicotine', linked_log_id: 31 },
  });
  const unlinked = cravingFlowReducer(linked, {
    type: 'QUICK_LOG_DELETED', cravingId: 41,
    canonicalCraving: { ...canonicalCraving, outcome: 'used_nicotine', linked_log_id: null },
  });
  const closed = cravingFlowReducer(unlinked, { type: 'DONE' });

  assert.equal(failed.operation, null);
  assert.equal(failed.error.message, 'Try again.');
  assert.equal(retrying.operation, 'create');
  assert.equal(outcome.status, 'outcome');
  assert.equal(outcome.selectedAction, 'drink_water');
  assert.equal(complete.status, 'complete');
  assert.equal(complete.nicotinePending, true);
  assert.equal(linked.nicotineLinked, true);
  assert.equal(linked.canonicalCraving.linked_log_id, 31);
  assert.equal(unlinked.nicotineLinked, false);
  assert.equal(unlinked.canonicalCraving.linked_log_id, null);
  assert.deepEqual(closed, { status: 'closed' });
});

test('CLOSE before create discards the draft and the next OPEN receives a fresh identity', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const first = cravingFlowReducer({ status: 'closed' }, {
    type: 'OPEN', clientEventId: 'first-event', occurredAtLocal: '2026-07-30T18:42',
  });
  const closed = cravingFlowReducer(first, { type: 'CLOSE' });
  const next = cravingFlowReducer(closed, {
    type: 'OPEN', clientEventId: 'second-event', occurredAtLocal: '2026-07-30T18:45',
  });

  assert.deepEqual(closed, { status: 'closed' });
  assert.equal(next.status, 'check_in');
  assert.equal(next.clientEventId, 'second-event');
  assert.equal(next.occurredAtLocal, '2026-07-30T18:45');
});

test('CLOSE after canonical create preserves the current step and OPEN resumes it', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const created = {
    ...(await makeCheckedInState()),
    status: 'action_choice',
    canonicalCraving: { id: 41, outcome: null },
  };

  const closed = cravingFlowReducer(created, { type: 'CLOSE' });
  const reopened = cravingFlowReducer(closed, {
    type: 'OPEN',
    clientEventId: 'new-id-must-not-replace-existing',
    occurredAtLocal: '2026-07-30T19:00',
  });

  assert.equal(closed.status, 'closed');
  assert.equal(closed.resumeStatus, 'action_choice');
  assert.equal(reopened.status, 'action_choice');
  assert.equal(reopened.clientEventId, created.clientEventId);
  assert.equal(reopened.canonicalCraving, created.canonicalCraving);
});

test('buildCravingDetailsPayload sends only supplied fields with Task 6 normalization', async () => {
  const { buildCravingDetailsPayload } = await loadCravingFlow();

  assert.deepEqual(buildCravingDetailsPayload({
    duration_minutes: '3',
    mood_before: '4',
    physical_symptoms: [' Jaw   tense ', 'jaw tense', ' RESTLESS '],
    notes: '  useful context  ',
    outcome_notes: '   ',
  }), {
    duration_minutes: 3,
    mood_before: 4,
    physical_symptoms: ['Jaw tense', 'RESTLESS'],
    notes: 'useful context',
    outcome_notes: null,
  });
});

test('DETAILS_OK completes with the same stored outcome and canonical craving', async () => {
  const { cravingFlowReducer } = await loadCravingFlow();
  const details = {
    ...(await makeCheckedInState()),
    status: 'details',
    canonicalCraving: { id: 41, outcome: 'used_alternative' },
    outcome: 'used_alternative',
    details: {},
  };
  const edited = cravingFlowReducer(details, {
    type: 'EDIT_DETAILS', changes: { duration_minutes: '3' },
  });
  const submitting = cravingFlowReducer(edited, { type: 'SUBMIT_DETAILS' });
  const canonicalCraving = {
    id: 41, outcome: 'used_alternative', duration_minutes: 3,
  };
  const state = cravingFlowReducer(submitting, {
    type: 'DETAILS_OK', canonicalCraving,
  });

  assert.deepEqual(edited.details, { duration_minutes: '3' });
  assert.equal(submitting.operation, 'details');
  assert.equal(state.status, 'complete');
  assert.equal(state.operation, null);
  assert.equal(state.outcome, 'used_alternative');
  assert.equal(state.canonicalCraving, canonicalCraving);
});

test('controller generates one UUID and sends the exact create payload once', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  let uuidCalls = 0;
  const canonicalCraving = {
    id: 41,
    client_event_id: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: 'after lunch',
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => {
      uuidCalls += 1;
      return '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353';
    },
    timezone: () => 'Asia/Riyadh',
    csrfToken: 'csrf-token',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(201, {
        craving: canonicalCraving, today: { status: 'on_track' },
        created: true, warnings: [],
      });
    },
  });

  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7, trigger: 'after lunch' });
  await controller.submitCheckIn();

  assert.equal(uuidCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/cravings');
  assert.equal(requests[0][1].method, 'POST');
  assert.equal(requests[0][1].headers['X-CSRFToken'], 'csrf-token');
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    client_event_id: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    intensity: 7,
    trigger: 'after lunch',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    timezone: 'Asia/Riyadh',
  });
  assert.equal(timeline.pendingCravings.length, 1);
  assert.deepEqual(timeline.canonicalCravings, [canonicalCraving]);
  assert.equal(controller.getState().status, 'action_choice');
});

test('create retry reuses the same UUID and exact request payload', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const payloads = [];
  let attempt = 0;
  const canonicalCraving = {
    id: 41,
    client_event_id: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse(503, {
          error: {
            code: 'internal_error', message: 'Try again.',
            field_errors: {}, retryable: true,
          },
        });
      }
      return jsonResponse(200, {
        craving: canonicalCraving, today: null, created: false, warnings: [],
      });
    },
  });

  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  assert.equal(controller.getState().status, 'check_in');
  assert.equal(controller.getState().operation, null);
  assert.equal(view.failures.length, 1);

  await controller.retryCreate();

  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[1], payloads[0]);
  assert.equal(controller.getState().status, 'action_choice');
  assert.deepEqual(timeline.canonicalCravings, [canonicalCraving]);
});

test('cancelling a pre-canonical recovery removes only its temporary timeline row', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const clientEventId = 'event-cancel-recovery';
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => clientEventId,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async () => jsonResponse(503, {
      error: {
        code: 'internal_error', message: 'Try again.', field_errors: {}, retryable: true,
      },
    }),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();

  controller.close();

  assert.equal(controller.getState().status, 'closed');
  assert.deepEqual(timeline.removedCravings, [clientEventId]);
  assert.equal(view.returnedFocus, 1);
});

test('validateCravingCheckIn rejects out-of-range intensity and an oversized trigger', async () => {
  const { validateCravingCheckIn, CravingFlowValidationError } = await loadCravingFlow();

  assert.throws(
    () => validateCravingCheckIn({
      intensity: 11,
      trigger: 'x'.repeat(101),
      occurredAtLocal: '2026-07-30T18:42',
    }, new Date('2026-07-30T18:42:18+03:00')),
    (error) => {
      assert.equal(error instanceof CravingFlowValidationError, true);
      assert.deepEqual(error.fieldErrors, {
        intensity: ['Choose an intensity from 1 to 10.'],
        trigger: ['Enter up to 100 characters.'],
      });
      return true;
    },
  );
});

test('pause timer recomputes on visibility resume and cleanup clears the active timer', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  let now = new Date('2026-07-30T18:42:00+03:00');
  let timerCallback = null;
  const cleared = [];
  const visibilityHandlers = new Set();
  const visibility = {
    hidden: false,
    addEventListener(type, handler) {
      if (type === 'visibilitychange') visibilityHandlers.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') visibilityHandlers.delete(handler);
    },
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => now,
    uuid: () => '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
    timezone: () => 'Asia/Riyadh',
    visibility,
    setIntervalImpl: (callback) => { timerCallback = callback; return 91; },
    clearIntervalImpl: (timer) => cleared.push(timer),
    fetchImpl: async () => jsonResponse(201, {
      craving: {
        id: 41,
        client_event_id: '2ab514e1-63d5-4f4d-b065-5dbf3e6ec353',
        occurred_at_utc: '2026-07-30T15:42:00+00:00',
        occurred_at_local: '2026-07-30T18:42:00+03:00',
        intensity: 7,
        trigger: null,
        outcome: null,
        linked_log_id: null,
      },
      today: null, created: true, warnings: [],
    }),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();

  controller.chooseAction('pause');
  assert.equal(controller.getState().remainingSeconds, 180);
  assert.equal(typeof timerCallback, 'function');
  now = new Date(now.getTime() + 60_400);
  timerCallback();
  assert.equal(controller.getState().remainingSeconds, 120);
  now = new Date(now.getTime() + 130_000);
  for (const handler of visibilityHandlers) handler();
  assert.equal(controller.getState().remainingSeconds, 0);
  assert.equal(controller.getState().status, 'pause');

  controller.close();
  assert.deepEqual(cleared, [91]);
  assert.equal(view.returnedFocus, 1);
});

test('outcome submission PATCHes each exact canonical value before showing details', async (t) => {
  const { createCravingFlowController } = await loadCravingFlow();
  for (const outcome of ['resisted', 'used_nicotine', 'used_alternative']) {
    await t.test(outcome, async () => {
      const view = makeView();
      const timeline = makeTimeline();
      const requests = [];
      const unresolved = {
        id: 41,
        client_event_id: `event-${outcome}`,
        occurred_at_utc: '2026-07-30T15:42:00+00:00',
        occurred_at_local: '2026-07-30T18:42:00+03:00',
        intensity: 7,
        trigger: null,
        outcome: null,
        linked_log_id: null,
      };
      const resolved = { ...unresolved, outcome };
      const controller = createCravingFlowController({
        view,
        timeline,
        clock: () => new Date('2026-07-30T18:42:18+03:00'),
        uuid: () => `event-${outcome}`,
        timezone: () => 'Asia/Riyadh',
        fetchImpl: async (url, options) => {
          requests.push([url, options]);
          return options.method === 'POST'
            ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
            : jsonResponse(200, { craving: resolved, today: null, warnings: [] });
        },
      });
      controller.initialize();
      controller.open({ id: 'trigger' });
      controller.editCheckIn({ intensity: 7 });
      await controller.submitCheckIn();
      controller.chooseAction('drink_water');
      controller.selectOutcome(outcome);
      await controller.submitOutcome();

      assert.equal(requests[1][0], '/api/cravings/41');
      assert.equal(requests[1][1].method, 'PATCH');
      assert.deepEqual(JSON.parse(requests[1][1].body), { outcome });
      assert.equal(controller.getState().status, 'details');
      assert.equal(controller.getState().canonicalCraving.outcome, outcome);
      assert.deepEqual(timeline.canonicalCravings, [unresolved, resolved]);
    });
  }
});

test('active outcome and details requests suppress duplicate submissions', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const outcomeGate = deferred();
  const detailsGate = deferred();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-no-duplicates',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'resisted' };
  const controller = createCravingFlowController({
    view: makeView(),
    timeline: makeTimeline(),
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (options.method === 'POST') {
        return jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        });
      }
      const payload = JSON.parse(options.body);
      return Object.hasOwn(payload, 'outcome') ? outcomeGate.promise : detailsGate.promise;
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('drink_water');
  controller.selectOutcome('resisted');

  const firstOutcome = controller.submitOutcome();
  assert.equal(controller.submitOutcome(), false);
  assert.equal(requests.filter(([, options]) => options.method === 'PATCH').length, 1);
  outcomeGate.resolve(jsonResponse(200, {
    craving: resolved, today: null, warnings: [],
  }));
  await firstOutcome;
  controller.editDetails({ duration_minutes: '3' });

  const firstDetails = controller.saveDetails();
  assert.equal(controller.saveDetails(), false);
  assert.equal(requests.filter(([, options]) => options.method === 'PATCH').length, 2);
  detailsGate.resolve(jsonResponse(200, {
    craving: { ...resolved, duration_minutes: 3 }, today: null, warnings: [],
  }));
  await firstDetails;

  assert.equal(controller.getState().status, 'complete');
});

test('outcome conflict adopts only the matching canonical Today craving and never retries the overwrite', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-outcome-conflict',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const canonical = { ...unresolved, outcome: 'resisted' };
  const today = {
    status: 'on_track',
    timeline: [
      { type: 'craving', id: 99, data: { id: 99, outcome: 'used_alternative' } },
      { type: 'craving', id: 41, data: canonical },
    ],
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (options.method === 'POST') {
        return jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        });
      }
      if (options.method === 'PATCH') {
        return jsonResponse(409, {
          error: {
            code: 'craving_outcome_conflict',
            message: 'private existing outcome detail',
            field_errors: {},
          },
        });
      }
      return jsonResponse(200, { today });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_nicotine');

  await controller.submitOutcome();

  assert.deepEqual(requests.map(([url, options]) => [url, options.method]), [
    ['/api/cravings', 'POST'],
    ['/api/cravings/41', 'PATCH'],
    ['/api/today', 'GET'],
  ]);
  assert.equal(controller.getState().status, 'details');
  assert.equal(controller.getState().outcome, 'resisted');
  assert.deepEqual(controller.getState().canonicalCraving, canonical);
  assert.deepEqual(timeline.canonicalCravings, [unresolved, canonical]);
  assert.deepEqual(timeline.reconciled, [today]);
  assert.equal(controller.retryOutcome(), false);
  assert.equal(controller.submitOutcome(), false);
  assert.equal(requests.filter(([, options]) => options.method === 'PATCH').length, 1);
  assert.doesNotMatch(view.announcements.join(' '), /private existing outcome detail/i);
  assert.match(view.announcements.at(-1), /saved outcome/i);
});

test('outcome conflict without a matching Today craving shows neutral non-retry guidance', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-outcome-conflict-missing',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline: makeTimeline(),
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (options.method === 'POST') {
        return jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        });
      }
      if (options.method === 'PATCH') {
        return jsonResponse(409, {
          error: {
            code: 'craving_outcome_conflict',
            message: 'private existing outcome detail',
            field_errors: {},
          },
        });
      }
      return jsonResponse(200, {
        today: { timeline: [{ type: 'craving', id: 99, data: { id: 99, outcome: 'resisted' } }] },
      });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_nicotine');

  await controller.submitOutcome();

  assert.equal(controller.getState().status, 'outcome');
  assert.equal(controller.getState().operation, null);
  assert.equal(controller.getState().outcomeConflict, true);
  assert.equal(controller.getState().error.canRetry, false);
  assert.equal(controller.retryOutcome(), false);
  assert.equal(controller.selectOutcome('resisted'), false);
  assert.equal(controller.submitOutcome(), false);
  assert.equal(requests.filter(([, options]) => options.method === 'PATCH').length, 1);
  assert.doesNotMatch(view.failures.at(-1).message, /private existing outcome detail/i);
  assert.match(view.failures.at(-1).message, /already has an outcome/i);
});

test('submitting outcome without a choice shows an associated error and sends no PATCH', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-outcome-required',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(201, {
        craving: unresolved, today: null, created: true, warnings: [],
      });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('drink_water');

  const result = controller.submitOutcome();

  assert.equal(result, false);
  assert.equal(requests.length, 1);
  assert.deepEqual(view.failures.at(-1).fieldErrors, {
    outcome: ['Choose the outcome that fits.'],
  });
  assert.match(view.announcements.at(-1), /highlighted detail/i);
});

test('skip details completes without sending a details PATCH', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-skip',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'resisted' };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => 'event-skip',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return options.method === 'POST'
        ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
        : jsonResponse(200, { craving: resolved, today: null, warnings: [] });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('change_rooms');
  controller.selectOutcome('resisted');
  await controller.submitOutcome();

  controller.skipDetails();

  assert.equal(requests.length, 2);
  assert.equal(controller.getState().status, 'complete');
  assert.equal(controller.getState().canonicalCraving.outcome, 'resisted');
});

test('saving untouched optional details follows Skip and sends no empty PATCH', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-empty-details',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'resisted' };
  const controller = createCravingFlowController({
    view: makeView(),
    timeline: makeTimeline(),
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return options.method === 'POST'
        ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
        : jsonResponse(200, { craving: resolved, today: null, warnings: [] });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('change_rooms');
  controller.selectOutcome('resisted');
  await controller.submitOutcome();

  assert.equal(controller.saveDetails(), true);

  assert.equal(controller.getState().status, 'complete');
  assert.deepEqual(requests.map(([url, options]) => [url, options.method]), [
    ['/api/cravings', 'POST'],
    ['/api/cravings/41', 'PATCH'],
  ]);
});

test('save details PATCHes only the normalized supplied fields and keeps the outcome', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-details',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'used_alternative' };
  const detailed = {
    ...resolved,
    duration_minutes: 3,
    physical_symptoms: ['Jaw tense'],
    notes: null,
  };
  let patchCount = 0;
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => 'event-details',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (options.method === 'POST') {
        return jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] });
      }
      patchCount += 1;
      return jsonResponse(200, {
        craving: patchCount === 1 ? resolved : detailed,
        today: null,
        warnings: [],
      });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_alternative');
  await controller.submitOutcome();

  controller.editDetails({
    duration_minutes: '3',
    physical_symptoms: [' Jaw   tense ', 'jaw tense'],
    notes: '  ',
  });
  await controller.saveDetails();

  assert.equal(requests[2][0], '/api/cravings/41');
  assert.deepEqual(JSON.parse(requests[2][1].body), {
    duration_minutes: 3,
    physical_symptoms: ['Jaw tense'],
    notes: null,
  });
  assert.equal(controller.getState().status, 'complete');
  assert.equal(controller.getState().canonicalCraving.outcome, 'used_alternative');
  assert.equal(controller.getState().canonicalCraving.duration_minutes, 3);
});

test('typed timeline craving formatting never collides with a log sharing its IDs', async () => {
  const { formatTimelineCraving, upsertTimelineItems } = await loadTimeline();
  const log = {
    type: 'log',
    id: 41,
    clientEventId: 'shared-event',
    occurredAtUtc: '2026-07-30T15:40:00+00:00',
  };
  const craving = formatTimelineCraving({
    id: 41,
    client_event_id: 'shared-event',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    outcome: null,
    linked_log_id: null,
  });

  const items = upsertTimelineItems([log], craving);

  assert.equal(craving.type, 'craving');
  assert.equal(craving.label, 'Craving recorded');
  assert.equal(craving.detail, 'Intensity 7 · Outcome not recorded');
  assert.deepEqual(items, [log, craving]);
});

test('used-nicotine completion opens linked Quick Log and accepts only its matching completion', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const opens = [];
  let completionHandler = null;
  const quickLogController = {
    subscribeCompletion(handler) {
      completionHandler = handler;
      return () => { completionHandler = null; };
    },
    openLinkedCraving(smartDefault, cravingId, trigger) {
      opens.push([smartDefault, cravingId, trigger]);
      return true;
    },
  };
  const unresolved = {
    id: 41,
    client_event_id: 'event-link',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'used_nicotine' };
  const controller = createCravingFlowController({
    view,
    timeline,
    quickLogController,
    smartDefault: { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' },
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => 'event-link',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => (
      options.method === 'POST'
        ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
        : jsonResponse(200, { craving: resolved, today: null, warnings: [] })
    ),
  });
  controller.initialize();
  controller.open({ id: 'craving-trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_nicotine');
  await controller.submitOutcome();
  controller.skipDetails();

  assert.equal(opens.length, 1);
  assert.equal(opens[0][1], 41);
  assert.equal(controller.getState().status, 'complete');
  assert.equal(controller.getState().nicotinePending, true);
  completionHandler({
    type: 'linked_log_synced', cravingId: 99,
    log: { id: 30 }, today: { timeline: [] },
  });
  assert.equal(controller.getState().nicotineLinked, false);

  const todayTimeline = [{
    type: 'craving', id: 41,
    data: { ...resolved, linked_log_id: 31 },
  }];
  completionHandler({
    type: 'linked_log_synced', cravingId: 41,
    log: { id: 31, linked_craving_id: 41 },
    today: { timeline: todayTimeline },
  });

  assert.equal(controller.getState().nicotinePending, false);
  assert.equal(controller.getState().nicotineLinked, true);
  assert.deepEqual(timeline.reconciledTimelines, [todayTimeline]);
  assert.match(view.announcements.at(-1), /Nicotine use linked/);
});

test('only a matching terminal Quick Log handoff releases the craving retry', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const opens = [];
  let completionHandler = null;
  const quickLogController = {
    subscribeCompletion(handler) {
      completionHandler = handler;
      return () => { completionHandler = null; };
    },
    openLinkedCraving(smartDefault, cravingId, trigger) {
      opens.push([smartDefault, cravingId, trigger]);
      return true;
    },
  };
  const unresolved = {
    id: 41,
    client_event_id: 'event-link-terminal',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'used_nicotine' };
  const controller = createCravingFlowController({
    view,
    timeline: makeTimeline(),
    quickLogController,
    smartDefault: { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' },
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => (
      options.method === 'POST'
        ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
        : jsonResponse(200, { craving: resolved, today: null, warnings: [] })
    ),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_nicotine');
  await controller.submitOutcome();
  controller.skipDetails();

  completionHandler({
    type: 'linked_log_handoff_started',
    cravingId: 41,
    clientEventId: 'linked-reused-event',
    attemptId: 'attempt-one',
    operation: 'create',
  });

  completionHandler({
    type: 'linked_log_handoff_closed',
    cravingId: 99,
    clientEventId: 'other-event',
    attemptId: 'other-attempt',
    operation: 'create',
  });
  assert.equal(controller.getState().nicotinePending, true);

  completionHandler({
    type: 'linked_log_handoff_closed',
    cravingId: 41,
    clientEventId: 'linked-reused-event',
    attemptId: 'attempt-one',
    operation: 'create',
  });
  assert.equal(controller.getState().nicotinePending, false);
  assert.equal(controller.getState().nicotineLinked, false);
  assert.equal(controller.getState().nicotineLinkUnknown, false);
  assert.match(view.announcements.at(-1), /not finished/i);

  assert.equal(controller.retryQuickLog(), true);
  assert.equal(opens.length, 2);
  completionHandler({
    type: 'linked_log_handoff_started',
    cravingId: 41,
    clientEventId: 'linked-reused-event',
    attemptId: 'attempt-two',
    operation: 'create',
  });
  assert.equal(controller.getState().nicotinePending, true);
  completionHandler({
    type: 'linked_log_handoff_failed',
    cravingId: 41,
    clientEventId: 'linked-reused-event',
    attemptId: 'attempt-one',
    operation: 'create',
  });
  assert.equal(controller.getState().nicotinePending, true);
  completionHandler({
    type: 'linked_log_handoff_failed',
    cravingId: 41,
    clientEventId: 'linked-reused-event',
    attemptId: 'attempt-two',
    operation: 'create',
  });
  assert.equal(controller.getState().nicotinePending, false);
  assert.match(view.announcements.at(-1), /try again/i);
});

test('linked log success without canonical Today never invents a craving link', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  let completionHandler = null;
  const quickLogController = {
    subscribeCompletion(handler) {
      completionHandler = handler;
      return () => { completionHandler = null; };
    },
    openLinkedCraving() { return true; },
  };
  const unresolved = {
    id: 41,
    client_event_id: 'event-link-unconfirmed',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'used_nicotine' };
  const controller = createCravingFlowController({
    view,
    timeline,
    quickLogController,
    smartDefault: { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' },
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => (
      options.method === 'POST'
        ? jsonResponse(201, { craving: unresolved, today: null, created: true, warnings: [] })
        : jsonResponse(200, { craving: resolved, today: null, warnings: [] })
    ),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_nicotine');
  await controller.submitOutcome();
  controller.skipDetails();

  completionHandler({
    type: 'linked_log_synced',
    cravingId: 41,
    log: { id: 31, linked_craving_id: 41 },
    today: null,
  });

  assert.equal(controller.getState().canonicalCraving, resolved);
  assert.equal(controller.getState().canonicalCraving.linked_log_id, null);
  assert.equal(controller.getState().nicotineLinked, false);
  assert.equal(controller.getState().nicotinePending, false);
  assert.equal(controller.getState().nicotineLinkUnknown, true);
  assert.deepEqual(timeline.reconciledTimelines, []);
  assert.match(view.announcements.at(-1), /link status will refresh later/i);

  const canonicalToday = {
    timeline: [{
      type: 'craving', id: 41,
      data: { ...resolved, linked_log_id: 31 },
    }],
  };
  completionHandler({
    type: 'linked_log_synced',
    cravingId: 41,
    log: { id: 31, linked_craving_id: 41 },
    today: canonicalToday,
  });

  assert.equal(controller.getState().canonicalCraving.linked_log_id, 31);
  assert.equal(controller.getState().nicotineLinked, true);
  assert.equal(controller.getState().nicotineLinkUnknown, false);
  assert.deepEqual(timeline.reconciledTimelines, [canonicalToday.timeline]);

  const linkedCanonical = controller.getState().canonicalCraving;
  completionHandler({
    type: 'linked_log_deleted',
    cravingId: 41,
    deletedLogId: 31,
    today: null,
  });

  assert.equal(controller.getState().canonicalCraving, linkedCanonical);
  assert.equal(controller.getState().canonicalCraving.linked_log_id, 31);
  assert.equal(controller.getState().nicotineLinked, false);
  assert.equal(controller.getState().nicotineLinkUnknown, true);
  assert.match(view.announcements.at(-1), /refresh later/i);

  const canonicalUnlinkedToday = {
    timeline: [{
      type: 'craving', id: 41,
      data: { ...resolved, linked_log_id: null },
    }],
  };
  completionHandler({
    type: 'linked_log_deleted',
    cravingId: 41,
    deletedLogId: 31,
    today: canonicalUnlinkedToday,
  });

  assert.equal(controller.getState().canonicalCraving.linked_log_id, null);
  assert.equal(controller.getState().nicotineLinked, false);
  assert.equal(controller.getState().nicotineLinkUnknown, false);
  assert.deepEqual(timeline.reconciledTimelines, [
    canonicalToday.timeline,
    canonicalUnlinkedToday.timeline,
  ]);
});

test('cleanup invalidates a deferred create before its canonical response settles', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const responseGate = deferred();
  let aborts = 0;
  class FakeAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  const canonicalCraving = {
    id: 41,
    client_event_id: 'event-cleanup',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => 'event-cleanup',
    timezone: () => 'Asia/Riyadh',
    AbortControllerImpl: FakeAbortController,
    fetchImpl: () => responseGate.promise,
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  const submission = controller.submitCheckIn();
  controller.cleanup();
  responseGate.resolve(jsonResponse(201, {
    craving: canonicalCraving, today: null, created: true, warnings: [],
  }));

  await submission;

  assert.equal(aborts, 1);
  assert.deepEqual(timeline.canonicalCravings, []);
  assert.notEqual(controller.getState().status, 'action_choice');
});

test('Today refresh warning performs one guarded GET and never replays the successful craving POST', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const requests = [];
  const craving = {
    id: 41,
    client_event_id: 'event-today-refresh',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const refreshedToday = { status: 'approaching', actuals: { pouches: 5 } };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => craving.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === '/api/cravings') {
        return jsonResponse(201, {
          craving,
          today: null,
          created: true,
          warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
        });
      }
      return jsonResponse(200, { today: refreshedToday });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });

  await controller.submitCheckIn();

  assert.deepEqual(requests.map(([url]) => url), ['/api/cravings', '/api/today']);
  assert.equal(requests.filter(([url]) => url === '/api/cravings').length, 1);
  assert.equal(requests[1][1].method, 'GET');
  assert.equal(requests[1][1].credentials, 'same-origin');
  assert.deepEqual(timeline.reconciled, [refreshedToday]);
});

test('outcome failure retry keeps the same canonical ID and exact outcome payload', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const payloads = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-outcome-retry',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'resisted' };
  let patchAttempts = 0;
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        return jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        });
      }
      payloads.push(JSON.parse(options.body));
      patchAttempts += 1;
      if (patchAttempts === 1) {
        return jsonResponse(503, {
          error: {
            code: 'internal_error', message: 'Try again.', field_errors: {}, retryable: true,
          },
        });
      }
      return jsonResponse(200, { craving: resolved, today: null, warnings: [] });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('drink_water');
  controller.selectOutcome('resisted');

  await controller.submitOutcome();
  assert.equal(controller.getState().status, 'outcome');
  assert.equal(controller.getState().operation, null);
  await controller.retryOutcome();

  assert.deepEqual(payloads, [{ outcome: 'resisted' }, { outcome: 'resisted' }]);
  assert.equal(controller.getState().status, 'details');
  assert.equal(controller.getState().canonicalCraving, resolved);
});

test('details failure retry reuses the exact normalized payload without changing outcome', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const detailPayloads = [];
  const unresolved = {
    id: 41,
    client_event_id: 'event-detail-retry',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const resolved = { ...unresolved, outcome: 'used_alternative' };
  const detailed = { ...resolved, duration_minutes: 3, notes: 'useful context' };
  let patchAttempts = 0;
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        return jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        });
      }
      patchAttempts += 1;
      if (patchAttempts === 1) {
        return jsonResponse(200, { craving: resolved, today: null, warnings: [] });
      }
      detailPayloads.push(JSON.parse(options.body));
      if (patchAttempts === 2) {
        return jsonResponse(503, {
          error: {
            code: 'internal_error', message: 'Try again.', field_errors: {}, retryable: true,
          },
        });
      }
      return jsonResponse(200, { craving: detailed, today: null, warnings: [] });
    },
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('short_walk');
  controller.selectOutcome('used_alternative');
  await controller.submitOutcome();
  controller.editDetails({ duration_minutes: '3', notes: '  useful context  ' });

  await controller.saveDetails();
  assert.equal(controller.getState().status, 'details');
  assert.equal(controller.getState().operation, null);
  await controller.retryDetails();

  assert.deepEqual(detailPayloads, [
    { duration_minutes: 3, notes: 'useful context' },
    { duration_minutes: 3, notes: 'useful context' },
  ]);
  assert.equal(controller.getState().status, 'complete');
  assert.equal(controller.getState().outcome, 'used_alternative');
});

test('closing during an outcome request aborts it and ignores a late canonical response', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  const responseGate = deferred();
  let aborts = 0;
  class FakeAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  const unresolved = {
    id: 41,
    client_event_id: 'event-outcome-close',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    intensity: 7,
    trigger: null,
    outcome: null,
    linked_log_id: null,
  };
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:18+03:00'),
    uuid: () => unresolved.client_event_id,
    timezone: () => 'Asia/Riyadh',
    AbortControllerImpl: FakeAbortController,
    fetchImpl: (_url, options) => (
      options.method === 'POST'
        ? Promise.resolve(jsonResponse(201, {
          craving: unresolved, today: null, created: true, warnings: [],
        }))
        : responseGate.promise
    ),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('drink_water');
  controller.selectOutcome('resisted');
  const submission = controller.submitOutcome();

  controller.close();
  responseGate.resolve(jsonResponse(200, {
    craving: { ...unresolved, outcome: 'resisted' }, today: null, warnings: [],
  }));
  await submission;

  assert.equal(aborts, 1);
  assert.equal(controller.getState().status, 'closed');
  assert.deepEqual(timeline.canonicalCravings, [unresolved]);
});

test('pause announcements are limited to start, minute boundaries, final ten, and complete', async () => {
  const { createCravingFlowController } = await loadCravingFlow();
  const view = makeView();
  const timeline = makeTimeline();
  let now = new Date('2026-07-30T18:42:00+03:00');
  let tick = null;
  const controller = createCravingFlowController({
    view,
    timeline,
    clock: () => now,
    uuid: () => 'event-announcements',
    timezone: () => 'Asia/Riyadh',
    setIntervalImpl: (callback) => { tick = callback; return 17; },
    clearIntervalImpl: () => {},
    fetchImpl: async () => jsonResponse(201, {
      craving: {
        id: 41,
        client_event_id: 'event-announcements',
        occurred_at_utc: '2026-07-30T15:42:00+00:00',
        occurred_at_local: '2026-07-30T18:42:00+03:00',
        intensity: 7,
        trigger: null,
        outcome: null,
        linked_log_id: null,
      },
      today: null,
      created: true,
      warnings: [],
    }),
  });
  controller.initialize();
  controller.open({ id: 'trigger' });
  controller.editCheckIn({ intensity: 7 });
  await controller.submitCheckIn();
  controller.chooseAction('pause');
  assert.match(view.announcements.at(-1), /Three minutes remaining/);

  now = new Date(now.getTime() + 1_000);
  tick();
  assert.equal(view.announcements.length, 1);
  now = new Date(now.getTime() + 59_000);
  tick();
  assert.match(view.announcements.at(-1), /Two minutes remaining/);
  now = new Date(now.getTime() + 110_000);
  tick();
  assert.match(view.announcements.at(-1), /10 seconds remaining/);
  now = new Date(now.getTime() + 10_000);
  tick();
  assert.match(view.announcements.at(-1), /Pause complete/);
  assert.equal(view.announcements.length, 4);
});

function makeCravingBootstrapElement() {
  return {
    dataset: {},
    hidden: false,
    disabled: false,
    open: false,
    textContent: '',
    value: '',
    checked: false,
    ownerDocument: null,
    listeners: new Map(),
    selectors: new Map(),
    classList: { toggle() {} },
    querySelector(selector) {
      return this.selectors.has(selector) ? this.selectors.get(selector) : null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    dispatchEvent(event) {
      if (!event.currentTarget) event.currentTarget = this;
      for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
      return true;
    },
    listenerCount(type) { return (this.listeners.get(type) || []).length; },
    setAttribute() {},
    removeAttribute() {},
    append() {},
    replaceChildren() {},
    remove() {},
    reset() {},
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    contains() { return true; },
  };
}

function makeCravingBootstrapDocument({
  failFirstRootListener = false,
  failFirstReadiness = false,
} = {}) {
  const root = makeCravingBootstrapElement();
  if (failFirstRootListener) {
    const addRootListener = root.addEventListener.bind(root);
    let shouldFail = true;
    root.addEventListener = (...args) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('craving-listener-bind-failed');
      }
      addRootListener(...args);
    };
  }
  const dialog = makeCravingBootstrapElement();
  const checkInStep = makeCravingBootstrapElement();
  checkInStep.dataset.cravingStep = 'check_in';
  checkInStep.querySelector = () => makeCravingBootstrapElement();
  dialog.querySelector = (selector) => {
    if (selector === '[data-craving-step]:not([hidden])') {
      return checkInStep.hidden ? null : checkInStep;
    }
    if (!dialog.selectors.has(selector)) {
      dialog.selectors.set(selector, makeCravingBootstrapElement());
    }
    return dialog.selectors.get(selector);
  };
  dialog.querySelectorAll = (selector) => (
    selector === '[data-craving-step]' ? [checkInStep] : []
  );
  const section = makeCravingBootstrapElement();
  const slot = makeCravingBootstrapElement();
  const fallback = makeCravingBootstrapElement();
  const enhanced = makeCravingBootstrapElement();
  enhanced.hidden = true;
  if (failFirstReadiness) {
    const dataset = slot.dataset;
    let shouldFail = true;
    slot.dataset = new Proxy(dataset, {
      set(target, key, value) {
        if (key === 'controllerReady' && shouldFail) {
          shouldFail = false;
          throw new Error('craving-readiness-write-failed');
        }
        target[key] = value;
        return true;
      },
      deleteProperty(target, key) {
        delete target[key];
        return true;
      },
    });
  }
  slot.selectors.set('[data-action-fallback]', fallback);
  slot.selectors.set('[data-action-enhanced]', enhanced);
  root.selectors.set('[data-craving-flow-dialog]', dialog);
  root.selectors.set('[data-today-timeline-section]', section);
  root.selectors.set('[data-craving-action-slot]', slot);
  root.selectors.set('[data-craving-live]', makeCravingBootstrapElement());
  const documentRef = makeCravingBootstrapElement();
  documentRef.defaultView = undefined;
  documentRef.querySelector = (selector) => {
    if (selector === '[data-today-root]') return root;
    return null;
  };
  documentRef.createElement = () => makeCravingBootstrapElement();
  section.ownerDocument = documentRef;
  return {
    documentRef, root, dialog, slot, fallback, enhanced,
  };
}

test('Craving bootstrap reuses one controller and activation without duplicate listeners', async () => {
  const { bootstrapCravingFlow } = await loadCravingFlow();
  const {
    documentRef, root, dialog, slot, fallback, enhanced,
  } = makeCravingBootstrapDocument();

  const first = bootstrapCravingFlow(documentRef);
  const second = bootstrapCravingFlow(documentRef);

  assert.ok(first);
  assert.equal(second, first);
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal(fallback.hidden, true);
  assert.equal(enhanced.hidden, false);
  assert.equal(enhanced.listenerCount('click'), 1);
  assert.equal(root.listenerCount('click'), 1);
  assert.equal(documentRef.listenerCount('visibilitychange'), 1);

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(dialog.open, true);
  assert.equal(first.getState().status, 'check_in');
  const clientEventId = first.getState().clientEventId;
  assert.ok(clientEventId);

  first.close();
  enhanced.dispatchEvent({ type: 'click' });
  assert.notEqual(first.getState().clientEventId, clientEventId);
});

test('Craving bootstrap rolls back a partial initialization before a natural retry', async () => {
  const { bootstrapCravingFlow } = await loadCravingFlow();
  const {
    documentRef, root, slot, fallback, enhanced,
  } = makeCravingBootstrapDocument({ failFirstRootListener: true });
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => { reported.push(args); };
  let first;
  try {
    first = bootstrapCravingFlow(documentRef);
  } finally {
    console.error = originalError;
  }

  assert.equal(first, null);
  assert.equal(reported.length, 1);
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(enhanced.listenerCount('click'), 0);
  assert.equal(root.listenerCount('click'), 0);

  const second = bootstrapCravingFlow(documentRef);

  assert.ok(second);
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal(enhanced.listenerCount('click'), 1);
  for (const eventType of ['click', 'submit', 'input', 'change', 'cancel']) {
    assert.equal(root.listenerCount(eventType), 1, `${eventType} is rebound exactly once`);
  }
  assert.equal(documentRef.listenerCount('visibilitychange'), 1);
});

test('Craving bootstrap restores the fallback after a late activation failure before retry', async () => {
  const { bootstrapCravingFlow } = await loadCravingFlow();
  const {
    documentRef, root, slot, fallback, enhanced,
  } = makeCravingBootstrapDocument({ failFirstReadiness: true });
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => { reported.push(args); };
  let first;
  try {
    first = bootstrapCravingFlow(documentRef);
  } finally {
    console.error = originalError;
  }

  assert.equal(first, null);
  assert.equal(reported.length, 1);
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(enhanced.listenerCount('click'), 0);
  assert.equal(root.listenerCount('click'), 0);
  assert.equal(documentRef.listenerCount('visibilitychange'), 0);

  const second = bootstrapCravingFlow(documentRef);

  assert.ok(second);
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal(fallback.hidden, true);
  assert.equal(enhanced.hidden, false);
  assert.equal(enhanced.listenerCount('click'), 1);
  assert.equal(root.listenerCount('click'), 1);
  assert.equal(documentRef.listenerCount('visibilitychange'), 1);
});
