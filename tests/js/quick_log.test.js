const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadQuickLog() {
  let source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'quick_log.js'),
    'utf8',
  );
  const actionEnhancementPath = path.join(projectRoot, 'static', 'js', 'today', 'action_enhancement.js');
  if (source.includes("'./action_enhancement.js'")) {
    const actionEnhancementSource = fs.readFileSync(actionEnhancementPath, 'utf8');
    const actionEnhancementUrl = `data:text/javascript;base64,${Buffer.from(actionEnhancementSource).toString('base64')}`;
    source = source.replace("'./action_enhancement.js'", `'${actionEnhancementUrl}'`);
  }
  const timelinePath = path.join(projectRoot, 'static', 'js', 'today', 'timeline.js');
  if (source.includes("'./timeline.js'")) {
    const timelineSource = fs.readFileSync(timelinePath, 'utf8');
    const timelineUrl = `data:text/javascript;base64,${Buffer.from(timelineSource).toString('base64')}`;
    source = source.replace("'./timeline.js'", `'${timelineUrl}'`);
  }
  const offlineQueuePath = path.join(projectRoot, 'static', 'js', 'today', 'offline_queue.js');
  if (source.includes("'./offline_queue.js'")) {
    const offlineQueueSource = fs.readFileSync(offlineQueuePath, 'utf8');
    const offlineQueueUrl = `data:text/javascript;base64,${Buffer.from(offlineQueueSource).toString('base64')}`;
    source = source.replace("'./offline_queue.js'", `'${offlineQueueUrl}'`);
  }
  const dialogFocusPath = path.join(projectRoot, 'static', 'js', 'shell', 'dialog_focus.js');
  if (source.includes("'../shell/dialog_focus.js'")) {
    const dialogFocusSource = fs.readFileSync(dialogFocusPath, 'utf8');
    const dialogFocusUrl = `data:text/javascript;base64,${Buffer.from(dialogFocusSource).toString('base64')}`;
    source = source.replace("'../shell/dialog_focus.js'", `'${dialogFocusUrl}'`);
  }
  const dialogLifecyclePath = path.join(projectRoot, 'static', 'js', 'shell', 'dialog_lifecycle.js');
  if (source.includes("'../shell/dialog_lifecycle.js'")) {
    const dialogLifecycleSource = fs.readFileSync(dialogLifecyclePath, 'utf8');
    const dialogLifecycleUrl = `data:text/javascript;base64,${Buffer.from(dialogLifecycleSource).toString('base64')}`;
    source = source.replace("'../shell/dialog_lifecycle.js'", `'${dialogLifecycleUrl}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadDialogFocus() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'shell', 'dialog_focus.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function makeFocusDocument({ hidden = false } = {}) {
  const documentRef = {
    hidden,
    visibilityState: hidden ? 'hidden' : 'visible',
    activeElement: null,
    defaultView: {
      getComputedStyle(element) { return element.computedStyle; },
    },
    querySelector() { return null; },
  };
  const makeElement = ({ connected = true } = {}) => ({
    ownerDocument: documentRef,
    isConnected: connected,
    hidden: false,
    disabled: false,
    computedStyle: { display: 'block', visibility: 'visible' },
    focusCalls: 0,
    closest() { return null; },
    matches() { return true; },
    getAttribute() { return null; },
    getClientRects() { return [{}]; },
    focus() { this.focusCalls += 1; documentRef.activeElement = this; },
  });
  documentRef.body = makeElement();
  documentRef.documentElement = makeElement();
  return { documentRef, makeElement };
}

async function loadTimeline() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'timeline.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadOfflineQueue() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'today', 'offline_queue.js'),
    'utf8',
  );
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function makeControllerView() {
  return {
    opened: [], announcements: [], failures: [], busy: [],
    closed: 0, undo: [], hiddenUndo: 0, returnedFocus: 0,
    populatedPouches: [], pouchLoadFailures: 0,
    mode: 'editing', requestError: null,
    initialized: 0, cleaned: 0, handlers: null,
    queued: [], attention: [], clearedRecovery: 0,
    initialize(handlers) { this.initialized += 1; this.handlers = handlers; },
    cleanup() { this.cleaned += 1; },
    open(draft, trigger) { this.opened.push([draft, trigger]); this.mode = 'editing'; },
    close(options = {}) {
      this.closed += 1;
      options.beforeNativeClose?.();
      return Promise.resolve(true);
    },
    returnFocus() { this.returnedFocus += 1; },
    setBusy(value) { this.busy.push(value); },
    announce(message) { this.announcements.push(message); },
    showFailure(error) {
      this.failures.push(error);
      this.mode = 'recovery';
      this.requestError = error.message;
    },
    showQueued(message) { this.queued.push(message); this.mode = 'queued'; },
    showSavedAttention(record) { this.attention.push(record); this.mode = 'attention'; },
    clearRecovery() { this.clearedRecovery += 1; this.mode = 'editing'; },
    restoreEditing() { this.mode = 'editing'; this.requestError = null; },
    showUndo(log) { this.undo.push(log); },
    hideUndo() { this.hiddenUndo += 1; },
    populatePouches(pouches, currentId) { this.populatedPouches.push([pouches, currentId]); },
    showPouchLoadFailure() { this.pouchLoadFailures += 1; },
  };
}

function makeControllerTimeline() {
  return {
    pending: [], canonical: [], failed: [], reconciled: [], removed: [], restored: [],
    queued: [], attention: [],
    insertPending(draft, payload) { this.pending.push([draft, payload]); },
    upsertCanonical(log) { this.canonical.push(log); },
    markFailed(key) { this.failed.push(key); },
    markQueued(key) { this.queued.push(key); },
    insertQueued(record) { this.queued.push(record); },
    markAttention(key) { this.attention.push(key); },
    reconcileToday(today) { this.reconciled.push(today); },
    removeCanonical(log) { this.removed.push(log); return { log }; },
    removePending(key) { this.removed.push(key); },
    restore(snapshot) { this.restored.push(snapshot); },
  };
}

function makeQueueRuntime(overrides = {}) {
  const subscribers = new Set();
  return {
    enqueued: [], removed: [], listed: [], replayed: 0,
    async enqueue(payload) {
      this.enqueued.push(payload);
      return { queued: true, notesOmitted: false, record: null };
    },
    async remove(clientEventId) { this.removed.push(clientEventId); return true; },
    async list() { return this.listed; },
    replay() { this.replayed += 1; return Promise.resolve(true); },
    subscribe(handler) { subscribers.add(handler); return () => subscribers.delete(handler); },
    publish(result) { for (const handler of subscribers) handler(result); },
    ...overrides,
  };
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

test('dialog focus restoration is inert while the document is hidden', async () => {
  const { restoreDialogFocus } = await loadDialogFocus();
  const { documentRef, makeElement } = makeFocusDocument({ hidden: true });
  const dialog = makeElement();
  dialog.contains = () => false;
  const opener = makeElement();
  documentRef.activeElement = documentRef.body;

  assert.equal(restoreDialogFocus(dialog, opener), false);
  assert.equal(opener.focusCalls, 0);
  assert.equal(documentRef.activeElement, documentRef.body);
});

test('dialog focus restoration preserves a connected visible outside target', async () => {
  const { restoreDialogFocus } = await loadDialogFocus();
  const { documentRef, makeElement } = makeFocusDocument();
  const dialog = makeElement();
  dialog.contains = () => false;
  const opener = makeElement();
  const intentionalTarget = makeElement();
  documentRef.activeElement = intentionalTarget;

  assert.equal(restoreDialogFocus(dialog, opener), false);
  assert.equal(opener.focusCalls, 0);
  assert.equal(documentRef.activeElement, intentionalTarget);
});

test('OPEN creates one structured editing draft from the smart default', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const state = quickLogReducer({ status: 'closed' }, {
    type: 'OPEN',
    draft: {
      clientEventId: 'event-one',
      pouchId: 12,
      brand: 'Steady Mint',
      nicotineMg: '6.00',
      quantity: 1,
      occurredAtLocal: '2026-07-30T18:42',
      timezone: 'Asia/Riyadh',
      notes: '',
      cravingId: null,
    },
  });

  assert.deepEqual(state, {
    status: 'editing',
    operation: 'create',
    draft: {
      clientEventId: 'event-one',
      pouchId: 12,
      brand: 'Steady Mint',
      nicotineMg: '6.00',
      quantity: 1,
      occurredAtLocal: '2026-07-30T18:42',
      timezone: 'Asia/Riyadh',
      notes: '',
      cravingId: null,
    },
    canonicalLog: null,
    pendingKey: 'event-one',
    error: null,
    undoDeadline: null,
  });
});

test('CHANGE edits fields without replacing the draft event ID', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const original = {
    status: 'editing', operation: 'create', pendingKey: 'event-one',
    canonicalLog: null, error: null, undoDeadline: null,
    draft: { clientEventId: 'event-one', pouchId: 12, quantity: 1, notes: '' },
  };

  const state = quickLogReducer(original, {
    type: 'CHANGE', changes: { quantity: 3, notes: 'After lunch' },
  });

  assert.equal(state.status, 'editing');
  assert.equal(state.draft.clientEventId, 'event-one');
  assert.equal(state.pendingKey, 'event-one');
  assert.equal(state.draft.quantity, 3);
  assert.equal(state.draft.notes, 'After lunch');
});

test('SUBMIT moves an editable draft into one create operation', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const draft = { clientEventId: 'event-one', pouchId: 12, quantity: 1 };
  const state = quickLogReducer({
    status: 'editing', operation: 'create', draft, pendingKey: 'event-one',
    canonicalLog: null, error: null, undoDeadline: null,
  }, { type: 'SUBMIT' });

  assert.equal(state.status, 'submitting');
  assert.equal(state.operation, 'create');
  assert.equal(state.draft, draft);
});

test('CREATE_OK stores the canonical log and a ten-second undo deadline', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const canonicalLog = { id: 31, client_event_id: 'event-one' };
  const state = quickLogReducer({
    status: 'submitting', operation: 'create',
    draft: { clientEventId: 'event-one' }, pendingKey: 'event-one',
    canonicalLog: null, error: null, undoDeadline: null,
  }, { type: 'CREATE_OK', canonicalLog, undoDeadline: 11_000 });

  assert.equal(state.status, 'synced');
  assert.equal(state.operation, 'create');
  assert.equal(state.canonicalLog, canonicalLog);
  assert.equal(state.undoDeadline, 11_000);
});

test('CREATE_FAILED keeps the exact submitted draft available for recovery', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const draft = { clientEventId: 'event-one', pouchId: 12, notes: 'Keep me' };
  const error = { message: 'Try again.', fieldErrors: {} };
  const state = quickLogReducer({
    status: 'submitting', operation: 'create', draft, pendingKey: 'event-one',
    canonicalLog: null, error: null, undoDeadline: null,
  }, { type: 'CREATE_FAILED', error });

  assert.equal(state.status, 'failed');
  assert.equal(state.draft, draft);
  assert.equal(state.pendingKey, 'event-one');
  assert.equal(state.error, error);
});

test('RETRY resubmits a failed create with the same event ID and draft object', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const draft = { clientEventId: 'event-one', pouchId: 12, quantity: 2 };
  const state = quickLogReducer({
    status: 'failed', operation: 'create', draft, pendingKey: 'event-one',
    canonicalLog: null, error: { message: 'Try again.' }, undoDeadline: null,
  }, { type: 'RETRY' });

  assert.equal(state.status, 'submitting');
  assert.equal(state.operation, 'create');
  assert.equal(state.draft, draft);
  assert.equal(state.draft.clientEventId, 'event-one');
  assert.equal(state.error, null);
});

test('DISCARD closes a failed draft and erases only its pending data', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const state = quickLogReducer({
    status: 'failed', operation: 'create',
    draft: { clientEventId: 'event-one' }, pendingKey: 'event-one',
    canonicalLog: null, error: { message: 'Try again.' }, undoDeadline: null,
  }, { type: 'DISCARD' });

  assert.deepEqual(state, {
    status: 'closed', operation: null, draft: null, pendingKey: null,
    canonicalLog: null, error: null, undoDeadline: null,
  });
});

test('UNDO before expiry starts a delete operation for the canonical log', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const canonicalLog = { id: 31, client_event_id: 'event-one' };
  const state = quickLogReducer({
    status: 'synced', operation: 'create', draft: { clientEventId: 'event-one' },
    pendingKey: 'event-one', canonicalLog, error: null, undoDeadline: 11_000,
  }, { type: 'UNDO', now: 5_000 });

  assert.equal(state.status, 'submitting');
  assert.equal(state.operation, 'delete');
  assert.equal(state.canonicalLog, canonicalLog);
});

test('DELETE_OK closes the interaction after the server removes the log', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const state = quickLogReducer({
    status: 'submitting', operation: 'delete', draft: { clientEventId: 'event-one' },
    pendingKey: 'event-one', canonicalLog: { id: 31 }, error: null, undoDeadline: 11_000,
  }, { type: 'DELETE_OK' });

  assert.deepEqual(state, {
    status: 'closed', operation: null, draft: null, pendingKey: null,
    canonicalLog: null, error: null, undoDeadline: null,
  });
});

test('DELETE_FAILED keeps the confirmed canonical item for restoration', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const canonicalLog = { id: 31, client_event_id: 'event-one' };
  const error = { message: 'The log is still saved.' };
  const state = quickLogReducer({
    status: 'submitting', operation: 'delete', draft: { clientEventId: 'event-one' },
    pendingKey: 'event-one', canonicalLog, error: null, undoDeadline: 11_000,
  }, { type: 'DELETE_FAILED', error });

  assert.equal(state.status, 'synced');
  assert.equal(state.operation, 'create');
  assert.equal(state.canonicalLog, canonicalLog);
  assert.equal(state.error, error);
});

test('UNDO_EXPIRED keeps a synced log but removes undo availability', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const state = quickLogReducer({
    status: 'synced', operation: 'create', draft: { clientEventId: 'event-one' },
    pendingKey: 'event-one', canonicalLog: { id: 31 }, error: null, undoDeadline: 11_000,
  }, { type: 'UNDO_EXPIRED' });

  assert.equal(state.status, 'synced');
  assert.equal(state.canonicalLog.id, 31);
  assert.equal(state.undoDeadline, null);
});

test('CLOSE retains a failed draft so reopening keeps its original event ID', async () => {
  const { quickLogReducer } = await loadQuickLog();
  const draft = { clientEventId: 'event-one', pouchId: 12, notes: 'Still here' };
  const closed = quickLogReducer({
    status: 'failed', operation: 'create', draft, pendingKey: 'event-one',
    canonicalLog: null, error: { message: 'Try again.' }, undoDeadline: null,
  }, { type: 'CLOSE' });

  assert.equal(closed.status, 'closed');
  assert.equal(closed.draft, draft);
  const reopened = quickLogReducer(closed, {
    type: 'OPEN', draft: { clientEventId: 'event-two', pouchId: 99 },
  });
  assert.equal(reopened.status, 'editing');
  assert.equal(reopened.draft, draft);
  assert.equal(reopened.pendingKey, 'event-one');
});

test('createQuickLogDraft uses the smart default, quantity one, local minute, and one UUID', async () => {
  const { createQuickLogDraft } = await loadQuickLog();
  let uuidCalls = 0;
  const draft = createQuickLogDraft({
    pouchId: 12,
    brand: 'Steady Mint',
    nicotineMg: '6.00',
    now: new Date(2026, 6, 30, 18, 42, 59),
    timezone: 'Asia/Riyadh',
    uuid: () => { uuidCalls += 1; return 'event-one'; },
  });

  assert.deepEqual(draft, {
    clientEventId: 'event-one', pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
    quantity: 1, occurredAtLocal: '2026-07-30T18:42', timezone: 'Asia/Riyadh',
    notes: '', cravingId: null,
  });
  assert.equal(uuidCalls, 1);
});

test('buildCreatePayload emits the exact Task 3 shape with the local UTC offset', async () => {
  const { buildCreatePayload } = await loadQuickLog();
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Riyadh';
  try {
    assert.deepEqual(buildCreatePayload({
      clientEventId: '550e8400-e29b-41d4-a716-446655440000',
      pouchId: 12,
      quantity: 1,
      occurredAtLocal: '2026-07-30T18:42',
      timezone: 'Asia/Riyadh',
      notes: '   ',
      cravingId: null,
    }), {
      client_event_id: '550e8400-e29b-41d4-a716-446655440000',
      pouch_id: 12,
      custom_product: null,
      quantity: 1,
      occurred_at_local: '2026-07-30T18:42:00+03:00',
      timezone: 'Asia/Riyadh',
      notes: null,
      craving_id: null,
    });
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('formatOffsetIso preserves a nonexistent DST wall time for server validation', async () => {
  const { formatOffsetIso } = await loadQuickLog();
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(
      formatOffsetIso('2026-03-08T02:30'),
      '2026-03-08T02:30:00-04:00',
    );
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('validateQuickLogDraft rejects quantity outside one through one hundred', async () => {
  const { validateQuickLogDraft } = await loadQuickLog();
  assert.throws(
    () => validateQuickLogDraft({
      pouchId: 12, quantity: 101, occurredAtLocal: '2026-07-30T18:42', notes: '',
    }, new Date(2026, 6, 30, 18, 42)),
    (error) => {
      assert.deepEqual(error.fieldErrors, {
        quantity: ['Enter a whole number from 1 to 100.'],
      });
      return true;
    },
  );
});

test('validateQuickLogDraft rejects local times outside the thirty-day and five-minute window', async () => {
  const { validateQuickLogDraft } = await loadQuickLog();
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const now = new Date('2026-07-30T18:42:00Z');
    for (const occurredAtLocal of ['2026-06-30T18:41', '2026-07-30T18:48']) {
      assert.throws(
        () => validateQuickLogDraft({
          pouchId: 12, quantity: 1, occurredAtLocal, notes: '',
        }, now),
        (error) => Boolean(error.fieldErrors?.occurredAtLocal),
      );
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('validateQuickLogDraft rejects notes beyond two thousand characters', async () => {
  const { validateQuickLogDraft } = await loadQuickLog();
  assert.throws(
    () => validateQuickLogDraft({
      pouchId: 12, quantity: 1, occurredAtLocal: '2026-07-30T18:42',
      notes: 'n'.repeat(2001),
    }, new Date(2026, 6, 30, 18, 42)),
    (error) => {
      assert.deepEqual(error.fieldErrors, { notes: ['Enter up to 2,000 characters.'] });
      return true;
    },
  );
});

test('formatTimelineLog preserves canonical time metadata and unknown strength copy', async () => {
  const { formatTimelineLog } = await loadTimeline();
  assert.deepEqual(formatTimelineLog({
    id: 31,
    client_event_id: 'event-one',
    occurred_at_utc: '2026-07-30T15:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    product_brand: 'Steady Mint',
    quantity: 2,
    total_nicotine_mg: null,
  }), {
    type: 'log', key: 'log:31', id: 31, clientEventId: 'event-one', state: 'confirmed',
    occurredAtUtc: '2026-07-30T15:42:00+00:00',
    occurredAtLocal: '2026-07-30T18:42:00+03:00',
    timeLabel: '18:42', label: 'Nicotine logged', product: 'Steady Mint',
    detail: '2 pouches · Strength unknown',
  });
});

test('resolvePendingTimelineTime gives a cleared draft an honest sortable fallback', async () => {
  const { resolvePendingTimelineTime } = await loadTimeline();

  assert.deepEqual(resolvePendingTimelineTime({
    draftLocal: '',
    payloadLocal: null,
    fallbackNow: new Date('2026-07-30T18:42:00Z'),
  }), {
    occurredAtUtc: '2026-07-30T18:42:00.000Z',
    occurredAtLocal: '',
    timeLabel: 'Check time',
  });
});

test('upsertTimelineItems replaces a matching pending event on create and replay', async () => {
  const { upsertTimelineItems } = await loadTimeline();
  const craving = { key: 'craving:2', type: 'craving', occurredAtUtc: '2026-07-30T15:00:00Z' };
  const pending = {
    key: 'pending:event-one', type: 'log', id: null, clientEventId: 'event-one',
    occurredAtUtc: '2026-07-30T15:42:00Z', state: 'pending',
  };
  const canonical = {
    key: 'log:31', type: 'log', id: 31, clientEventId: 'event-one',
    occurredAtUtc: '2026-07-30T15:42:00Z', state: 'confirmed',
  };

  const created = upsertTimelineItems([craving, pending], canonical);
  assert.deepEqual(created, [craving, canonical]);
  assert.deepEqual(upsertTimelineItems(created, canonical), [craving, canonical]);
});

test('controller open builds one smart-default draft and presents it to the view', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  let uuidCalls = 0;
  const trigger = { id: 'today-log-action' };
  const controller = createQuickLogController({
    view,
    timeline: {},
    clock: () => new Date(2026, 6, 30, 18, 42),
    uuid: () => { uuidCalls += 1; return 'event-one'; },
    timezone: () => 'Asia/Riyadh',
  });

  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, trigger);

  assert.equal(controller.getState().status, 'editing');
  assert.equal(controller.getState().draft.clientEventId, 'event-one');
  assert.equal(controller.getState().draft.quantity, 1);
  assert.equal(uuidCalls, 1);
  assert.deepEqual(view.opened, [[controller.getState().draft, trigger]]);

  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  assert.equal(view.opened.length, 1);
});

test('controller confirm inserts one pending row and sends one exact Task 3 request', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  const never = new Promise(() => {});
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Riyadh';
  try {
    const controller = createQuickLogController({
      view,
      timeline,
      clock: () => new Date(2026, 6, 30, 18, 42),
      uuid: () => '550e8400-e29b-41d4-a716-446655440000',
      timezone: () => 'Asia/Riyadh',
      csrfToken: 'csrf-value',
      fetchImpl: (...args) => { requests.push(args); return never; },
    });
    controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

    const first = controller.submit();
    const duplicate = controller.submit();

    assert.equal(first, duplicate);
    assert.equal(requests.length, 1);
    assert.equal(timeline.pending.length, 1);
    assert.deepEqual(timeline.pending[0][1], {
      client_event_id: '550e8400-e29b-41d4-a716-446655440000',
      pouch_id: 12, custom_product: null, quantity: 1,
      occurred_at_local: '2026-07-30T18:42:00+03:00',
      timezone: 'Asia/Riyadh', notes: null, craving_id: null,
    });
    assert.equal(requests[0][0], '/api/logs');
    assert.deepEqual(JSON.parse(requests[0][1].body), timeline.pending[0][1]);
    assert.equal(requests[0][1].credentials, 'same-origin');
    assert.equal(requests[0][1].headers['Content-Type'], 'application/json');
    assert.equal(requests[0][1].headers['X-CSRFToken'], 'csrf-value');
    assert.ok(requests[0][1].signal);
    assert.equal(controller.getState().status, 'submitting');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('controller treats a duplicate 200 as canonical success and starts one undo timer', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const timers = [];
  const canonicalLog = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const today = { status: 'on_track', actuals: { pouches: 3 } };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'UTC',
    csrfToken: 'csrf',
    fetchImpl: async () => jsonResponse(200, {
      created: false, log: canonicalLog, today, warnings: [],
    }),
    setTimeoutImpl: (callback, delay) => { timers.push([callback, delay]); return 7; },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  await controller.submit();

  assert.equal(controller.getState().status, 'synced');
  assert.equal(controller.getState().canonicalLog, canonicalLog);
  assert.equal(controller.getState().undoDeadline, Date.parse('2026-07-30T18:42:10Z'));
  assert.deepEqual(timeline.canonical, [canonicalLog]);
  assert.deepEqual(timeline.reconciled, [today]);
  assert.equal(view.closed, 1);
  assert.deepEqual(view.undo, [canonicalLog]);
  assert.match(view.announcements.at(-1), /saved/i);
  assert.deepEqual(timers.map(([, delay]) => delay), [10_000]);
  assert.equal(view.busy.at(-1), false);
});

test('OPEN rejected during the synced Undo window does not present a dead dialog', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const canonicalLog = {
    id: 31,
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z',
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: async () => jsonResponse(201, {
      created: true, log: canonicalLog, today: { status: 'on_track' }, warnings: [],
    }),
    setTimeoutImpl: () => 7,
  });
  const smartDefault = { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' };
  controller.open(smartDefault, {});
  await controller.submit();
  assert.equal(controller.getState().status, 'synced');
  assert.equal(view.opened.length, 1);

  controller.open(smartDefault, {});

  assert.equal(controller.getState().status, 'synced');
  assert.equal(view.opened.length, 1);
});

test('server validation failure retains the exact draft and marks its pending row failed', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    csrfToken: 'csrf',
    fetchImpl: async () => jsonResponse(422, {
      error: {
        code: 'validation_error', message: 'Check the fields.',
        field_errors: { quantity: ['Enter a whole number from 1 to 100.'] },
      },
    }),
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  const draft = controller.getState().draft;

  const result = await controller.submit();

  assert.equal(result, false);
  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().draft, draft);
  assert.equal(controller.getState().draft.clientEventId, '550e8400-e29b-41d4-a716-446655440000');
  assert.deepEqual(timeline.failed, ['550e8400-e29b-41d4-a716-446655440000']);
  assert.deepEqual(view.failures, [{
    message: 'Check the fields.',
    fieldErrors: { quantity: ['Enter a whole number from 1 to 100.'] },
  }]);
});

test('controller Retry sends the retained draft with the same event ID', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const bodies = [];
  let uuidCalls = 0;
  const canonicalLog = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z', occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const responses = [
    jsonResponse(500, { error: { code: 'internal_error', message: 'Try again.', field_errors: {} } }),
    jsonResponse(201, { created: true, log: canonicalLog, today: { status: 'on_track' }, warnings: [] }),
  ];
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => { uuidCalls += 1; return canonicalLog.client_event_id; },
    timezone: () => 'UTC',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return responses.shift();
    },
    setTimeoutImpl: () => 1,
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  await controller.retry();

  assert.equal(uuidCalls, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].client_event_id, canonicalLog.client_event_id);
  assert.equal(bodies[1].client_event_id, canonicalLog.client_event_id);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(controller.getState().status, 'synced');
});

test('editing a failed draft exits recovery and restores its confirm action', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const canonicalLog = {
    id: 31,
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z',
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  const responses = [
    jsonResponse(503, {
      error: { code: 'internal_error', message: 'Try again.', field_errors: {} },
    }),
    jsonResponse(201, {
      created: true, log: canonicalLog, today: { status: 'on_track' }, warnings: [],
    }),
  ];
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: async () => responses.shift(),
    setTimeoutImpl: () => 7,
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();
  assert.equal(view.mode, 'recovery');

  controller.change({ notes: 'Edited after the failure' });

  assert.equal(controller.getState().status, 'editing');
  assert.equal(view.mode, 'editing');
  assert.equal(view.requestError, null);
  await controller.submit();
  assert.equal(controller.getState().status, 'synced');
});

test('today refresh warning performs one GET and never replays the successful POST', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  const log = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z', occurred_at_local: '2026-07-30T18:42:00Z',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const refreshedToday = { status: 'approaching', actuals: { pouches: 5 } };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === '/api/logs') {
        return jsonResponse(201, {
          created: true, log, today: null,
          warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
        });
      }
      return jsonResponse(200, { today: refreshedToday });
    },
    setTimeoutImpl: () => 1,
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  await controller.submit();

  assert.deepEqual(requests.map(([url]) => url), ['/api/logs', '/api/today']);
  assert.equal(requests.filter(([url]) => url === '/api/logs').length, 1);
  assert.equal(requests[1][1].credentials, 'same-origin');
  assert.deepEqual(timeline.canonical, [log]);
  assert.deepEqual(timeline.reconciled, [refreshedToday]);
});

test('Undo optimistically removes the log and sends one ownership-scoped DELETE', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  const log = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z', occurred_at_local: '2026-07-30T18:42:00Z',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const deletedToday = { status: 'on_track', actuals: { pouches: 2 } };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    csrfToken: 'csrf-value',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      if (url === '/api/logs') {
        return jsonResponse(201, { created: true, log, today: { status: 'on_track' }, warnings: [] });
      }
      return jsonResponse(200, { deleted_log_id: 31, today: deletedToday, warnings: [] });
    },
    setTimeoutImpl: () => 7,
    clearTimeoutImpl: () => {},
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  await controller.undo();

  assert.deepEqual(timeline.removed, [log]);
  assert.equal(requests[1][0], '/api/logs/31');
  assert.equal(requests[1][1].method, 'DELETE');
  assert.equal(requests[1][1].credentials, 'same-origin');
  assert.equal(requests[1][1].headers['X-CSRFToken'], 'csrf-value');
  assert.ok(requests[1][1].signal);
  assert.deepEqual(timeline.reconciled.at(-1), deletedToday);
  assert.equal(controller.getState().status, 'closed');
  assert.match(view.announcements.at(-1), /Log removed/i);
});

test('failed DELETE restores the confirmed log in place with neutral recovery guidance', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const log = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z', occurred_at_local: '2026-07-30T18:42:00Z',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: async (url) => (url === '/api/logs'
      ? jsonResponse(201, { created: true, log, today: { status: 'on_track' }, warnings: [] })
      : jsonResponse(503, { error: { code: 'internal_error', message: 'Internal detail', field_errors: {} } })),
    setTimeoutImpl: () => 7,
    clearTimeoutImpl: () => {},
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  const result = await controller.undo();

  assert.equal(result, false);
  assert.equal(controller.getState().status, 'synced');
  assert.equal(controller.getState().operation, 'create');
  assert.equal(controller.getState().canonicalLog, log);
  assert.deepEqual(timeline.restored, [{ log }]);
  assert.deepEqual(view.undo, [log, log]);
  assert.match(view.announcements.at(-1), /still saved.*try.*later/i);
  assert.doesNotMatch(view.announcements.at(-1), /Internal detail/i);
});

test('the ten-second timer expires Undo while retaining the synced log', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  let expireUndo;
  const log = {
    id: 31, client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z', occurred_at_local: '2026-07-30T18:42:00Z',
    product_brand: 'Steady Mint', quantity: 1, total_nicotine_mg: '6.00',
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: async () => jsonResponse(201, {
      created: true, log, today: { status: 'on_track' }, warnings: [],
    }),
    setTimeoutImpl: (callback) => { expireUndo = callback; return 7; },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  expireUndo();

  assert.equal(controller.getState().status, 'synced');
  assert.equal(controller.getState().canonicalLog, log);
  assert.equal(controller.getState().undoDeadline, null);
  assert.equal(view.hiddenUndo, 1);
});

test('controller initialization binds the Today-root view once and cleanup is idempotent', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const controller = createQuickLogController({ view, timeline: makeControllerTimeline() });

  controller.initialize();
  controller.initialize();
  assert.equal(view.initialized, 1);
  assert.equal(typeof view.handlers.open, 'function');
  assert.equal(typeof view.handlers.submit, 'function');
  assert.equal(typeof view.handlers.close, 'function');

  controller.cleanup();
  controller.cleanup();
  assert.equal(view.cleaned, 1);
});

test('startup renders queued intent and canonical replay reconciles it from server Today', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const record = {
    offline_queue_id: 'opaque',
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({ listed: [record] });
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    setTimeoutImpl: () => 1,
  });

  await controller.initialize();
  assert.deepEqual(timeline.queued, [record]);

  const canonical = {
    id: 81,
    client_event_id: record.client_event_id,
    occurred_at_utc: '2026-07-30T18:42:00Z',
    occurred_at_local: record.occurred_at_local,
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  queueRuntime.publish({
    type: 'synced',
    record,
    log: canonical,
    today: { status: 'on_track' },
    warnings: [],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(timeline.canonical, [canonical]);
  assert.deepEqual(timeline.reconciled, [{ status: 'on_track' }]);
  assert.equal(view.announcements.at(-1), 'Saved after reconnecting');
});

test('permanent replay attention stays inline and Edit hydrates the same UUID from owned pouches', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const record = {
    offline_queue_id: 'opaque',
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 3,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({ listed: [record] });
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    fetchImpl: async (url) => {
      assert.equal(url, '/api/pouches');
      return jsonResponse(200, {
        success: true,
        pouches: [{ id: 12, brand: 'Steady Mint', nicotine_mg: 6 }],
      });
    },
  });
  await controller.initialize();

  queueRuntime.publish({ type: 'needs_attention', record });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timeline.attention, [record.client_event_id]);
  assert.deepEqual(view.attention, [record]);
  assert.equal(view.opened.length, 0, 'attention must not automatically open the dialog');

  assert.equal(await controller.editSaved(record.client_event_id), true);
  assert.equal(controller.getState().status, 'editing');
  assert.deepEqual(controller.getState().draft, {
    clientEventId: record.client_event_id,
    pouchId: 12,
    brand: 'Steady Mint',
    nicotineMg: 6,
    quantity: 3,
    occurredAtLocal: '2026-07-30T18:42',
    timezone: 'UTC',
    notes: '',
    cravingId: null,
  });
  assert.equal(view.opened.length, 1);
});

test('permanent replay Discard removes only the selected saved item', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const record = {
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({ listed: [record] });
  const controller = createQuickLogController({ view, timeline, queueRuntime });
  await controller.initialize();
  queueRuntime.publish({ type: 'needs_attention', record });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await controller.discardSaved(record.client_event_id), true);
  assert.deepEqual(queueRuntime.removed, [record.client_event_id]);
  assert.deepEqual(timeline.removed, [record.client_event_id]);
  assert.equal(view.clearedRecovery, 1);
  assert.match(view.announcements.at(-1), /discarded/i);
});

test('cleanup generation prevents a late replay Today refresh from mutating the controller', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const record = {
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({ listed: [record] });
  let resolveRefresh;
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    fetchImpl: () => new Promise((resolve) => { resolveRefresh = resolve; }),
  });
  await controller.initialize();
  queueRuntime.publish({
    type: 'synced',
    record,
    log: { id: 90, client_event_id: record.client_event_id },
    today: null,
    warnings: [{ code: 'today_refresh_unavailable' }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.cleanup();

  resolveRefresh(jsonResponse(200, { today: { status: 'on_track' } }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(timeline.reconciled, []);
  assert.deepEqual(view.announcements, []);
});

test('cleanup during a direct create Today refresh blocks late UI, Today, Undo, and completion work', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const refreshGate = deferred();
  const completions = [];
  const timers = [];
  let aborts = 0;
  class TestAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  const log = {
    id: 31,
    client_event_id: 'linked-refresh-cleanup',
    linked_craving_id: 41,
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    AbortControllerImpl: TestAbortController,
    setTimeoutImpl: (callback, delay) => { timers.push([callback, delay]); return 9; },
    clearTimeoutImpl: () => {},
    fetchImpl: async (url) => {
      if (url === '/api/logs') {
        return jsonResponse(201, {
          log,
          today: null,
          created: true,
          warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
        });
      }
      return refreshGate.promise;
    },
  });
  await controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'trigger' });
  completions.length = 0;
  const submission = controller.submit();
  await new Promise((resolve) => setImmediate(resolve));
  const beforeCleanup = {
    reconciled: timeline.reconciled.length,
    closed: view.closed,
    announcements: view.announcements.length,
    undo: view.undo.length,
  };

  controller.cleanup();
  refreshGate.resolve(jsonResponse(200, { today: { status: 'on_track' } }));
  await submission;

  assert.equal(aborts, 1);
  assert.equal(timeline.reconciled.length, beforeCleanup.reconciled);
  assert.equal(view.closed, beforeCleanup.closed);
  assert.equal(view.announcements.length, beforeCleanup.announcements);
  assert.equal(view.undo.length, beforeCleanup.undo);
  assert.deepEqual(completions, []);
  assert.deepEqual(timers, []);
});

test('cleanup during Undo DELETE ignores its late response and canonical Today payload', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const deleteGate = deferred();
  const completions = [];
  let aborts = 0;
  class TestAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  const log = {
    id: 31,
    client_event_id: 'linked-delete-cleanup',
    linked_craving_id: 41,
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => log.client_event_id,
    timezone: () => 'UTC',
    AbortControllerImpl: TestAbortController,
    setTimeoutImpl: () => 9,
    clearTimeoutImpl: () => {},
    fetchImpl: async (_url, options) => (
      options.method === 'POST'
        ? jsonResponse(201, {
          log, today: { status: 'on_track' }, created: true, warnings: [],
        })
        : deleteGate.promise
    ),
  });
  await controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'trigger' });
  await controller.submit();
  completions.length = 0;
  const deletion = controller.undo();
  const afterOptimisticDelete = {
    reconciled: timeline.reconciled.length,
    restored: timeline.restored.length,
    hiddenUndo: view.hiddenUndo,
    announcements: view.announcements.length,
  };

  controller.cleanup();
  deleteGate.resolve(jsonResponse(200, {
    deleted_log_id: 31,
    today: {
      status: 'on_track',
      timeline: [{
        type: 'craving', id: 41,
        data: { id: 41, outcome: 'used_nicotine', linked_log_id: null },
      }],
    },
    warnings: [],
  }));
  await deletion;

  assert.equal(aborts, 1);
  assert.equal(timeline.reconciled.length, afterOptimisticDelete.reconciled);
  assert.equal(timeline.restored.length, afterOptimisticDelete.restored);
  assert.equal(view.hiddenUndo, afterOptimisticDelete.hiddenUndo);
  assert.equal(view.announcements.length, afterOptimisticDelete.announcements);
  assert.deepEqual(completions, []);
  assert.equal(controller.getState().status, 'submitting');
  assert.equal(controller.getState().operation, 'delete');
});

test('cleanup keeps a late replay completion out of a new Today controller generation', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const { createOfflineQueueRuntime } = await loadOfflineQueue();
  const record = {
    offline_queue_id: 'opaque-account-scope',
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  let records = [{ ...record }];
  const store = {
    async put(next) { records = [{ ...next }]; },
    async listAll() { return records.map((item) => ({ ...item })); },
    async remove(offlineQueueId, clientEventId) {
      const existed = records.some((item) => (
        item.offline_queue_id === offlineQueueId
        && item.client_event_id === clientEventId
      ));
      records = records.filter((item) => (
        item.offline_queue_id !== offlineQueueId
        || item.client_event_id !== clientEventId
      ));
      return existed;
    },
    async clearAll() { records = []; },
  };
  let settleReplay;
  const canonical = {
    id: 95,
    client_event_id: record.client_event_id,
    occurred_at_utc: '2026-07-30T18:42:00Z',
    occurred_at_local: record.occurred_at_local,
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  const queueRuntime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: () => new Promise((resolve) => {
      settleReplay = () => resolve(jsonResponse(201, {
        log: canonical,
        today: { status: 'on_track' },
        warnings: [],
      }));
    }),
  });
  const oldController = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    queueRuntime,
  });
  await oldController.initialize();
  const replay = queueRuntime.replay();
  await new Promise((resolve) => setImmediate(resolve));
  oldController.cleanup();

  settleReplay();
  await replay;

  const nextView = makeControllerView();
  const nextTimeline = makeControllerTimeline();
  const nextController = createQuickLogController({
    view: nextView,
    timeline: nextTimeline,
    queueRuntime,
  });
  await nextController.initialize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(nextTimeline.canonical, []);
  assert.deepEqual(nextTimeline.reconciled, []);
  assert.deepEqual(nextView.announcements, []);
});

test('cleanup generation rejects an old replay that settles after a new controller initializes', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const { createOfflineQueueRuntime } = await loadOfflineQueue();
  const record = {
    offline_queue_id: 'opaque-account-scope',
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  let records = [{ ...record }];
  const store = {
    async put(next) { records = [{ ...next }]; },
    async listAll() { return records.map((item) => ({ ...item })); },
    async remove(offlineQueueId, clientEventId) {
      const existed = records.some((item) => (
        item.offline_queue_id === offlineQueueId
        && item.client_event_id === clientEventId
      ));
      records = records.filter((item) => (
        item.offline_queue_id !== offlineQueueId
        || item.client_event_id !== clientEventId
      ));
      return existed;
    },
    async clearAll() { records = []; },
  };
  let settleReplay;
  const queueRuntime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: () => new Promise((resolve) => {
      settleReplay = () => resolve(jsonResponse(201, {
        log: {
          id: 96,
          client_event_id: record.client_event_id,
          occurred_at_utc: '2026-07-30T18:42:00Z',
          occurred_at_local: record.occurred_at_local,
          product_brand: 'Steady Mint',
          quantity: 1,
          total_nicotine_mg: '6.00',
        },
        today: { status: 'on_track' },
        warnings: [],
      }));
    }),
  });
  const oldController = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    queueRuntime,
  });
  await oldController.initialize();
  const replay = queueRuntime.replay();
  await new Promise((resolve) => setImmediate(resolve));
  oldController.cleanup();

  const nextView = makeControllerView();
  const nextTimeline = makeControllerTimeline();
  const nextController = createQuickLogController({
    view: nextView,
    timeline: nextTimeline,
    queueRuntime,
  });
  await nextController.initialize();

  settleReplay();
  await replay;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(nextTimeline.canonical, []);
  assert.deepEqual(nextTimeline.reconciled, []);
  assert.deepEqual(nextView.announcements, []);
});

test('closing an active create aborts the client wait and retains the failed draft for reopening', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  let abortCount = 0;
  class TestAbortController {
    constructor() { this.signal = {}; }
    abort() { abortCount += 1; }
  }
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: () => new Promise(() => {}),
    AbortControllerImpl: TestAbortController,
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  const draft = controller.getState().draft;
  controller.submit();

  controller.close();

  assert.equal(abortCount, 1);
  assert.equal(controller.getState().status, 'closed');
  assert.equal(controller.getState().draft, draft);
  assert.equal(controller.getState().pendingKey, draft.clientEventId);
  assert.deepEqual(timeline.failed, [draft.clientEventId]);
  assert.equal(view.closed, 1);
  assert.equal(view.returnedFocus, 0);
});

test('close defers controller cleanup until the shared native-close boundary', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const closeGate = deferred();
  let closeOptions = null;
  view.close = (options) => {
    view.closed += 1;
    closeOptions = options;
    return closeGate.promise;
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  const closing = controller.close('escape');

  assert.equal(controller.getState().status, 'editing');
  assert.equal(typeof closeOptions.beforeNativeClose, 'function');
  closeOptions.beforeNativeClose();
  assert.equal(controller.getState().status, 'closed');
  closeGate.resolve(true);
  assert.equal(await closing, true);
  assert.equal(view.returnedFocus, 0);
});

test('close immediately quarantines an in-flight create while deferring controller cleanup', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const responseGate = deferred();
  const closeGate = deferred();
  let closeOptions = null;
  let aborts = 0;
  class FakeAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  view.close = (options) => {
    view.closed += 1;
    closeOptions = options;
    return closeGate.promise;
  };
  const canonicalLog = {
    id: 31,
    client_event_id: 'event-close-quarantine',
    occurred_at_utc: '2026-07-30T18:42:00+00:00',
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: () => responseGate.promise,
    AbortControllerImpl: FakeAbortController,
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  const submission = controller.submit();

  const closing = controller.close('escape');

  assert.equal(aborts, 1, 'the request is quarantined when close begins');
  assert.equal(controller.getState().status, 'submitting');
  assert.deepEqual(timeline.failed, []);
  responseGate.resolve(jsonResponse(201, {
    created: true, log: canonicalLog, today: { status: 'on_track' }, warnings: [],
  }));
  assert.equal(await submission, false);
  assert.deepEqual(timeline.canonical, []);
  assert.equal(controller.getState().canonicalLog, null);
  assert.equal(controller.getState().status, 'submitting');

  closeOptions.beforeNativeClose();
  assert.equal(controller.getState().status, 'closed');
  assert.deepEqual(timeline.failed, [canonicalLog.client_event_id]);
  closeGate.resolve(true);
  assert.equal(await closing, true);
});

test('closing invalidates an abandoned create before the retained draft reopens', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  let settleCreate;
  const canonicalLog = {
    id: 31,
    client_event_id: '550e8400-e29b-41d4-a716-446655440000',
    occurred_at_utc: '2026-07-30T18:42:00Z',
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    product_brand: 'Steady Mint',
    quantity: 1,
    total_nicotine_mg: '6.00',
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'UTC',
    fetchImpl: () => new Promise((resolve) => { settleCreate = resolve; }),
    setTimeoutImpl: () => 7,
  });
  const smartDefault = { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' };
  controller.open(smartDefault, {});
  const abandonedRequest = controller.submit();
  controller.close();
  controller.open(smartDefault, {});

  settleCreate(jsonResponse(201, {
    created: true,
    log: canonicalLog,
    today: { status: 'on_track' },
    warnings: [],
  }));
  await abandonedRequest;

  assert.equal(controller.getState().status, 'editing');
  assert.equal(view.closed, 1);
  assert.deepEqual(timeline.canonical, []);
  assert.deepEqual(view.undo, []);
});

test('a stale aborted create cannot fail or release a newer retry', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  class TestAbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    AbortControllerImpl: TestAbortController,
    fetchImpl: (_url, options) => new Promise((resolve, reject) => {
      requests.push({ resolve, reject, signal: options.signal });
    }),
  });
  const smartDefault = { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' };
  controller.open(smartDefault, {});
  const firstRequest = controller.submit();
  controller.close();
  controller.open(smartDefault, {});
  const retryRequest = controller.submit();

  requests[0].reject(new Error('aborted request settled late'));
  await firstRequest;

  assert.equal(controller.getState().status, 'submitting');
  assert.equal(requests[1].signal.aborted, false);
  controller.close();
  assert.equal(requests[1].signal.aborted, true);
  requests[1].reject(new Error('second request aborted by close'));
  await retryRequest;
});

test('Discard removes only the failed pending draft and closes the dialog', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const eventId = '550e8400-e29b-41d4-a716-446655440000';
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => eventId,
    timezone: () => 'UTC',
    fetchImpl: async () => jsonResponse(503, {
      error: { code: 'internal_error', message: 'Try again.', field_errors: {} },
    }),
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  controller.discard();

  assert.deepEqual(timeline.removed, [eventId]);
  assert.deepEqual(controller.getState(), {
    status: 'closed', operation: null, draft: null, pendingKey: null,
    canonicalLog: null, error: null, undoDeadline: null,
  });
  assert.equal(view.closed, 1);
  assert.equal(view.returnedFocus, 0);
});

test('todayStatusPatch derives every visible total only from the canonical server summary', async () => {
  const { todayStatusPatch } = await loadTimeline();
  assert.deepEqual(todayStatusPatch({
    status: 'approaching',
    plan: { target_pouches: 6, nicotine_ceiling_mg: '36.00' },
    actuals: { pouches: 5, nicotine_mg: '30.00', known_nicotine_mg: '30.00' },
    remaining: { pouches: 1, nicotine_mg: '6.00' },
  }), {
    status: 'approaching',
    statusLabel: 'Approaching plan',
    pouchMeasure: '5 of 6 pouches',
    remaining: '1 pouch remaining',
    nicotineMeasure: '30.00 of 36.00 mg',
    meter: { value: 5, max: 6 },
    checkInVisible: false,
    recovery: {
      visible: false,
      pouch: null,
      nicotine: null,
      reviewRecommended: false,
    },
  });
});

test('todayStatusPatch carries canonical guardrail recovery and review visibility', async () => {
  const { todayStatusPatch } = await loadTimeline();
  const patch = todayStatusPatch({
    status: 'exceeded',
    pouch_status: 'exceeded',
    nicotine_state: 'unknown',
    review_recommended: true,
    check_in_eligible: true,
    check_in: null,
    plan: {
      status: 'active', mode: 'reduce',
      target_pouches: 6, nicotine_ceiling_mg: '36.00',
    },
    actuals: {
      pouches: 7, nicotine_mg: null,
      known_nicotine_mg: '30.00', unknown_strength_events: 1,
    },
    remaining: { pouches: 0, nicotine_mg: null },
  });

  assert.deepEqual(patch.recovery, {
    visible: true,
    pouch: 'Pouch guardrail: 7 pouches logged; target 6.',
    nicotine: null,
    reviewRecommended: true,
  });
  assert.equal(patch.checkInVisible, true);
});

test('timeline adapter reconcileToday adopts one typed check-in row and dispatches summary', async () => {
  const { createTimelineDomAdapter, TODAY_CANONICAL_CHECK_IN_EVENT } = await loadTimeline();

  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = ownerDocument;
      this.dataset = {};
      this.children = [];
      this.parentNode = null;
      this.attributes = {};
      this.className = '';
      this.textContent = '';
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentNode = this;
        this.children.push(node);
      }
    }
    insertBefore(node, next) {
      node.parentNode = this;
      const index = this.children.indexOf(next);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
      this.parentNode = null;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    querySelector(selector) {
      if (selector === '[data-today-timeline]') {
        return this.children.find((child) => Object.hasOwn(child.dataset, 'todayTimeline')) || null;
      }
      if (selector === '[data-today-empty]') return null;
      if (selector === 'time') {
        return this.children.find((child) => child.tagName === 'TIME') || null;
      }
      return null;
    }
  }

  const events = [];
  const documentRef = {
    defaultView: {
      CustomEvent: class {
        constructor(type, options) { this.type = type; this.detail = options.detail; }
      },
    },
    createElement(tagName) { return new FakeElement(tagName, this); },
  };
  const section = new FakeElement('section', documentRef);
  const list = new FakeElement('ol', documentRef);
  list.dataset.todayTimeline = '';
  section.append(list);
  const root = {
    querySelector(selector) {
      if (selector === '[data-today-timeline-section]') return section;
      return null;
    },
    dispatchEvent(event) { events.push(event); return true; },
  };
  const checkIn = {
    id: 77,
    local_date: '2026-07-30',
    mood: 5,
    confidence: 2,
    reflection: 'Saved elsewhere',
    context: 'Evening',
  };
  const checkInItem = {
    type: 'check_in',
    id: 77,
    occurred_at_utc: '2026-07-30T20:00:00+00:00',
    occurred_at_local: '2026-07-30T20:00:00+00:00',
    state: 'completed',
    label: 'Daily check-in',
    data: checkIn,
  };
  const today = {
    local_date: '2026-07-30',
    generated_at: '2026-07-30T20:00:01+00:00',
    status: 'met',
    pouch_status: 'met',
    nicotine_state: 'met',
    plan: {
      status: 'active', mode: 'reduce',
      target_pouches: 2, nicotine_ceiling_mg: '12.00',
    },
    actuals: {
      pouches: 2, nicotine_mg: '12.00', known_nicotine_mg: '12.00',
      unknown_strength_events: 0,
    },
    remaining: { pouches: 0, nicotine_mg: '0.00' },
    check_in: checkIn,
    check_in_eligible: true,
    review_recommended: false,
    timeline: [checkInItem],
  };
  const adapter = createTimelineDomAdapter(root);

  adapter.reconcileToday(today);
  adapter.reconcileToday(today);

  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.timelineType, 'check_in');
  assert.equal(list.children[0].dataset.timelineId, '77');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, TODAY_CANONICAL_CHECK_IN_EVENT);
  assert.deepEqual(events[0].detail.check_in, checkIn);
});

test('client validation marks one pending draft failed and sends no request', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  const eventId = '550e8400-e29b-41d4-a716-446655440000';
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => eventId,
    timezone: () => 'UTC',
    fetchImpl: async (...args) => { requests.push(args); return jsonResponse(500, {}); },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  controller.change({ quantity: 101 });
  const draft = controller.getState().draft;

  const result = await controller.submit();

  assert.equal(result, false);
  assert.equal(requests.length, 0);
  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().draft, draft);
  assert.deepEqual(timeline.pending, [[draft, null]]);
  assert.deepEqual(timeline.failed, [eventId]);
  assert.deepEqual(view.failures.at(-1).fieldErrors, {
    quantity: ['Enter a whole number from 1 to 100.'],
  });
});

test('a cleared local time retains the failed pending lifecycle without a request', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  let optimisticInsertions = 0;
  timeline.insertPending = (draft, payload) => {
    optimisticInsertions += 1;
    timeline.pending.push([draft, payload]);
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: async (...args) => { requests.push(args); return jsonResponse(500, {}); },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  controller.change({ occurredAtLocal: '' });

  const result = await controller.submit();

  assert.equal(result, false);
  assert.equal(optimisticInsertions, 1);
  assert.equal(requests.length, 0);
  assert.equal(controller.getState().status, 'failed');
  assert.deepEqual(timeline.failed, ['550e8400-e29b-41d4-a716-446655440000']);
  assert.deepEqual(view.failures.at(-1).fieldErrors, {
    occurredAtLocal: ['Choose a time no more than 30 days ago or 5 minutes ahead.'],
  });
});

test('network failure keeps the exact draft and never exposes the exception', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: async () => { throw new TypeError('private transport detail'); },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  const draft = controller.getState().draft;

  const result = await controller.submit();

  assert.equal(result, false);
  assert.equal(controller.getState().draft, draft);
  assert.equal(controller.getState().status, 'failed');
  assert.match(view.failures.at(-1).message, /draft is still here/i);
  assert.doesNotMatch(view.failures.at(-1).message, /private transport detail/i);
});

test('retryable delivery enqueues structured intent and discloses that notes stay on screen', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const queueRuntime = makeQueueRuntime({
    async enqueue(payload) {
      this.enqueued.push(payload);
      return {
        queued: true,
        notesOmitted: true,
        record: { client_event_id: payload.client_event_id },
      };
    },
  });
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: async () => { throw new TypeError('private transport detail'); },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  controller.change({ notes: 'Keep this private note on screen' });
  const draft = controller.getState().draft;

  assert.equal(await controller.submit(), false);
  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().draft, draft);
  assert.equal(queueRuntime.enqueued.length, 1);
  assert.equal(queueRuntime.enqueued[0].client_event_id, draft.clientEventId);
  assert.equal(queueRuntime.enqueued[0].notes, 'Keep this private note on screen');
  assert.deepEqual(timeline.queued, [draft.clientEventId]);
  assert.deepEqual(view.queued, [
    'Waiting for connection. Saved for sync without notes. Notes stay only on this screen.',
  ]);
  assert.equal(view.failures.length, 0);
});

test('retryable HTTP status enqueues while permanent validation stays ordinary recovery', async () => {
  const { createQuickLogController } = await loadQuickLog();

  async function submitStatus(status, body) {
    const view = makeControllerView();
    const timeline = makeControllerTimeline();
    const queueRuntime = makeQueueRuntime();
    const controller = createQuickLogController({
      view,
      timeline,
      queueRuntime,
      clock: () => new Date('2026-07-30T18:42:00Z'),
      uuid: () => '550e8400-e29b-41d4-a716-446655440000',
      timezone: () => 'UTC',
      fetchImpl: async () => jsonResponse(status, body),
    });
    controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
    await controller.submit();
    return { view, timeline, queueRuntime };
  }

  const retryable = await submitStatus(503, {
    error: { code: 'internal_error', message: 'Try later.', field_errors: {}, retryable: false },
  });
  assert.equal(retryable.queueRuntime.enqueued.length, 1);
  assert.deepEqual(retryable.timeline.queued, ['550e8400-e29b-41d4-a716-446655440000']);

  const permanent = await submitStatus(422, {
    error: {
      code: 'validation_error', message: 'Check this log.',
      field_errors: { quantity: ['Choose another quantity.'] }, retryable: false,
    },
  });
  assert.equal(permanent.queueRuntime.enqueued.length, 0);
  assert.deepEqual(permanent.timeline.failed, ['550e8400-e29b-41d4-a716-446655440000']);
  assert.equal(permanent.view.failures.at(-1).message, 'Check this log.');
});

test('queue adapter failure falls back to the ordinary retained failed draft', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const queueRuntime = makeQueueRuntime({
    async enqueue() { throw new Error('private IndexedDB failure'); },
  });
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  assert.equal(await controller.submit(), false);
  assert.equal(controller.getState().status, 'failed');
  assert.deepEqual(timeline.failed, ['550e8400-e29b-41d4-a716-446655440000']);
  assert.match(view.failures.at(-1).message, /draft is still here/i);
  assert.doesNotMatch(view.failures.at(-1).message, /IndexedDB/i);
});

test('queued Retry reuses one UUID and removes the queued record after canonical success', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const queueRuntime = makeQueueRuntime();
  const postedIds = [];
  let attempt = 0;
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
    fetchImpl: async (url, options) => {
      if (url === '/api/today') return jsonResponse(200, { today: { status: 'on_track' } });
      const payload = JSON.parse(options.body);
      postedIds.push(payload.client_event_id);
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return jsonResponse(201, {
        log: { id: 71, client_event_id: payload.client_event_id },
        today: { status: 'on_track' },
        warnings: [],
      });
    },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  await controller.submit();
  await controller.retry();

  assert.deepEqual(postedIds, [
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440000',
  ]);
  assert.deepEqual(queueRuntime.removed, ['550e8400-e29b-41d4-a716-446655440000']);
  assert.equal(controller.getState().status, 'synced');
});

test('queued Retry treats an already-absent browser record as cleared after canonical success', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const eventId = '550e8400-e29b-41d4-a716-446655440000';
  const queuedRecord = {
    offline_queue_id: 'opaque-account-scope',
    client_event_id: eventId,
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({
    async enqueue(payload) {
      this.enqueued.push(payload);
      return { queued: true, notesOmitted: false, record: queuedRecord };
    },
    async remove(clientEventId) {
      this.removed.push(clientEventId);
      return false;
    },
  });
  const canonical = { id: 97, client_event_id: eventId };
  let attempt = 0;
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => eventId,
    timezone: () => 'UTC',
    setTimeoutImpl: () => 1,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return jsonResponse(201, {
        created: true,
        log: canonical,
        today: { status: 'on_track' },
        warnings: [],
      });
    },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  const result = await controller.retry();
  assert.equal(result.log, canonical);
  assert.equal(controller.getState().status, 'synced');
  assert.deepEqual(timeline.canonical, [canonical]);
  assert.deepEqual(timeline.attention, []);
  assert.deepEqual(view.attention, []);
  assert.doesNotMatch(view.announcements.at(-1), /saved browser copy could not be cleared/i);
});

test('queued Retry retains attention when browser removal rejects after canonical success', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const eventId = '550e8400-e29b-41d4-a716-446655440000';
  const queuedRecord = {
    offline_queue_id: 'opaque-account-scope',
    client_event_id: eventId,
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+00:00',
    timezone: 'UTC',
    craving_id: null,
    queue_order: 1,
  };
  const queueRuntime = makeQueueRuntime({
    async enqueue(payload) {
      this.enqueued.push(payload);
      return { queued: true, notesOmitted: false, record: queuedRecord };
    },
    async remove(clientEventId) {
      this.removed.push(clientEventId);
      throw new Error('private browser storage failure');
    },
  });
  let attempt = 0;
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => eventId,
    timezone: () => 'UTC',
    setTimeoutImpl: () => 1,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('offline');
      return jsonResponse(201, {
        created: true,
        log: { id: 98, client_event_id: eventId },
        today: { status: 'on_track' },
        warnings: [],
      });
    },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
  await controller.submit();

  assert.equal(await controller.retry(), false);
  assert.equal(controller.getState().status, 'closed');
  assert.deepEqual(timeline.canonical, []);
  assert.deepEqual(timeline.attention, [eventId]);
  assert.deepEqual(view.attention, [queuedRecord]);
  assert.match(view.announcements.at(-1), /saved browser copy could not be cleared/i);
  assert.doesNotMatch(view.announcements.at(-1), /private browser storage failure/i);
});

test('queued Discard accepts an already-absent record but retains recovery when storage rejects', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const eventId = '550e8400-e29b-41d4-a716-446655440000';

  async function queuedController(remove) {
    const view = makeControllerView();
    const timeline = makeControllerTimeline();
    const queueRuntime = makeQueueRuntime({ remove });
    const controller = createQuickLogController({
      view,
      timeline,
      queueRuntime,
      clock: () => new Date('2026-07-30T18:42:00Z'),
      uuid: () => eventId,
      timezone: () => 'UTC',
      fetchImpl: async () => { throw new TypeError('offline'); },
    });
    controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});
    await controller.submit();
    return { controller, timeline, view };
  }

  let releaseRemoval;
  const successful = await queuedController(() => new Promise((resolve) => {
    releaseRemoval = resolve;
  }));
  const discardPromise = successful.controller.discard();
  assert.deepEqual(successful.timeline.removed, []);
  assert.equal(successful.controller.getState().status, 'failed');
  releaseRemoval(true);
  assert.equal(await discardPromise, true);
  assert.deepEqual(successful.timeline.removed, [eventId]);
  assert.equal(successful.controller.getState().status, 'closed');

  const alreadyAbsent = await queuedController(async () => false);
  assert.equal(await alreadyAbsent.controller.discard(), true);
  assert.deepEqual(alreadyAbsent.timeline.removed, [eventId]);
  assert.equal(alreadyAbsent.controller.getState().status, 'closed');

  const failed = await queuedController(async () => {
    throw new Error('browser storage failure');
  });
  assert.equal(await failed.controller.discard(), false);
  assert.deepEqual(failed.timeline.removed, []);
  assert.equal(failed.controller.getState().status, 'failed');
  assert.match(failed.view.announcements.at(-1), /could not be discarded yet/i);
});

test('advanced pouch loading runs once and preserves the selected draft pouch', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const requests = [];
  const pouches = [
    { id: 12, brand: 'Steady Mint', nicotine_mg: 6 },
    { id: 14, brand: 'Targeted Own', nicotine_mg: 4 },
  ];
  const controller = createQuickLogController({
    view,
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => '550e8400-e29b-41d4-a716-446655440000',
    timezone: () => 'UTC',
    fetchImpl: async (...args) => {
      requests.push(args);
      return jsonResponse(200, { success: true, pouches });
    },
  });
  controller.open({ pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' }, {});

  await Promise.all([controller.loadPouches(), controller.loadPouches()]);
  await controller.loadPouches();

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/pouches');
  assert.equal(requests[0][1].credentials, 'same-origin');
  assert.deepEqual(view.populatedPouches, [[pouches, 12]]);
  assert.equal(controller.getState().draft.pouchId, 12);
});

test('linked craving handoff opens a fresh draft and publishes one matching canonical completion', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const requests = [];
  const completions = [];
  const canonicalLog = {
    id: 31,
    client_event_id: 'linked-log-event',
    linked_craving_id: 41,
  };
  const controller = createQuickLogController({
    view,
    timeline,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'linked-log-event',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(201, {
        log: canonicalLog,
        today: { status: 'on_track', timeline: [] },
        created: true,
        warnings: [],
      });
    },
    setTimeoutImpl: () => 1,
  });
  controller.initialize();
  const unsubscribe = controller.subscribeCompletion((event) => completions.push(event));

  assert.equal(controller.openLinkedCraving({
    pouchId: 12,
    brand: 'Steady Mint',
    nicotineMg: '6.00',
  }, 41, { id: 'craving-trigger' }), true);
  await controller.submit();

  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0][1].body).craving_id, 41);
  assert.deepEqual(completions.filter((event) => event.type === 'linked_log_synced'), [{
    type: 'linked_log_synced',
    cravingId: 41,
    log: canonicalLog,
    today: { status: 'on_track', timeline: [] },
  }]);
  unsubscribe();
});

test('closing a fresh linked handoff publishes one terminal lifecycle event', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const completions = [];
  const controller = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'linked-close-event',
    timezone: () => 'Asia/Riyadh',
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'craving-trigger' });

  controller.close();
  controller.close();

  assert.deepEqual(completions.filter((event) => event.type === 'linked_log_handoff_closed'), [{
    type: 'linked_log_handoff_closed',
    cravingId: 41,
    clientEventId: 'linked-close-event',
    attemptId: completions.find((event) => event.type === 'linked_log_handoff_started').attemptId,
    operation: 'create',
  }]);
});

test('linked handoff publishes terminal failure but keeps queued work pending through close', async () => {
  const { createQuickLogController } = await loadQuickLog();

  async function attempt({ eventId, fetchImpl, queueRuntime = null }) {
    const completions = [];
    const controller = createQuickLogController({
      view: makeControllerView(),
      timeline: makeControllerTimeline(),
      queueRuntime,
      clock: () => new Date('2026-07-30T18:42:00Z'),
      uuid: () => eventId,
      timezone: () => 'Asia/Riyadh',
      fetchImpl,
    });
    controller.initialize();
    controller.subscribeCompletion((event) => completions.push(event));
    controller.openLinkedCraving({
      pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
    }, 41, { id: 'craving-trigger' });
    await controller.submit();
    return { controller, completions };
  }

  const terminal = await attempt({
    eventId: 'linked-terminal-event',
    fetchImpl: async () => jsonResponse(422, {
      error: {
        code: 'validation_error', message: 'Check this log.',
        field_errors: { quantity: ['Choose another quantity.'] }, retryable: false,
      },
    }),
  });
  const terminalStart = terminal.completions.find(
    (event) => event.type === 'linked_log_handoff_started',
  );
  assert.deepEqual(terminal.completions.filter(
    (event) => event.type === 'linked_log_handoff_failed',
  ), [{
    type: 'linked_log_handoff_failed',
    cravingId: 41,
    clientEventId: 'linked-terminal-event',
    attemptId: terminalStart.attemptId,
    operation: 'create',
  }]);

  const queuedRuntime = makeQueueRuntime();
  const queued = await attempt({
    eventId: 'linked-queued-event',
    queueRuntime: queuedRuntime,
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  queued.controller.close();
  assert.equal(queuedRuntime.enqueued.length, 1);
  assert.deepEqual(
    queued.completions.filter((event) => event.type !== 'linked_log_handoff_started'),
    [],
  );
});

test('linked queued replay needs-attention emits one current-attempt terminal failure', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const completions = [];
  const queueRuntime = makeQueueRuntime();
  const record = {
    client_event_id: 'linked-attention-event',
    craving_id: 41,
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    timezone: 'Asia/Riyadh',
  };
  queueRuntime.enqueue = async function enqueue(payload) {
    this.enqueued.push(payload);
    return { queued: true, notesOmitted: false, record };
  };
  const controller = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => record.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'trigger' });
  await controller.submit();
  const started = completions.find((event) => event.type === 'linked_log_handoff_started');

  queueRuntime.publish({ type: 'needs_attention', record });
  queueRuntime.publish({ type: 'needs_attention', record });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(completions.filter(
    (event) => event.type === 'linked_log_handoff_failed',
  ), [{
    type: 'linked_log_handoff_failed',
    cravingId: 41,
    clientEventId: record.client_event_id,
    attemptId: started.attemptId,
    operation: 'create',
  }]);
  assert.equal(controller.getState().status, 'closed');
  assert.equal(controller.getState().draft, null);
});

test('failed linked Undo can close without publishing a create-handoff terminal event', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const completions = [];
  const canonicalLog = {
    id: 31,
    client_event_id: 'linked-delete-failure-event',
    linked_craving_id: 41,
  };
  const controller = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => canonicalLog.client_event_id,
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (url) => (
      url === '/api/logs'
        ? jsonResponse(201, {
          log: canonicalLog,
          today: {
            timeline: [{
              type: 'craving', id: 41,
              data: { id: 41, outcome: 'used_nicotine', linked_log_id: 31 },
            }],
          },
          created: true,
          warnings: [],
        })
        : jsonResponse(503, {
          error: { code: 'internal_error', message: 'Private detail', field_errors: {} },
        })
    ),
    setTimeoutImpl: () => 7,
    clearTimeoutImpl: () => {},
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'trigger' });
  await controller.submit();
  completions.length = 0;

  await controller.undo();
  controller.close();

  assert.equal(controller.getState().status, 'synced');
  assert.equal(controller.getState().canonicalLog, canonicalLog);
  assert.deepEqual(
    completions.filter((event) => event.type.startsWith('linked_log_handoff_')),
    [],
  );
});

test('repeated linked attempts reuse the draft UUID but each publish one distinct terminal event', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const completions = [];
  const controller = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'linked-repeated-event',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async () => jsonResponse(422, {
      error: {
        code: 'validation_error', message: 'Check this log.',
        field_errors: { quantity: ['Choose another quantity.'] }, retryable: false,
      },
    }),
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'craving-trigger' });

  await controller.submit();
  await controller.retry();

  const starts = completions.filter((event) => event.type === 'linked_log_handoff_started');
  const failures = completions.filter((event) => event.type === 'linked_log_handoff_failed');
  assert.equal(starts.length, 2);
  assert.equal(failures.length, 2);
  assert.equal(starts[0].clientEventId, 'linked-repeated-event');
  assert.equal(starts[1].clientEventId, 'linked-repeated-event');
  assert.notEqual(starts[0].attemptId, starts[1].attemptId);
  assert.equal(failures[0].attemptId, starts[0].attemptId);
  assert.equal(failures[1].attemptId, starts[1].attemptId);

  controller.close();
  assert.equal(
    completions.filter((event) => event.type.startsWith('linked_log_handoff_')).length,
    4,
  );
});

test('reopening and closing the same retained linked draft emits one close per attempt token', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const completions = [];
  const smartDefault = { pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00' };
  const controller = createQuickLogController({
    view: makeControllerView(),
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'linked-repeated-close-event',
    timezone: () => 'Asia/Riyadh',
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));

  controller.openLinkedCraving(smartDefault, 41, { id: 'craving-trigger' });
  controller.close();
  controller.open(smartDefault, { id: 'ordinary-trigger' });
  controller.close();

  const starts = completions.filter((event) => event.type === 'linked_log_handoff_started');
  const closes = completions.filter((event) => event.type === 'linked_log_handoff_closed');
  assert.equal(starts.length, 2);
  assert.equal(closes.length, 2);
  assert.notEqual(starts[0].attemptId, starts[1].attemptId);
  assert.equal(closes[0].attemptId, starts[0].attemptId);
  assert.equal(closes[1].attemptId, starts[1].attemptId);
});

test('linked craving handoff refuses to overwrite a retained Quick Log draft', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const controller = createQuickLogController({
    view,
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'existing-log-event',
    timezone: () => 'Asia/Riyadh',
  });
  controller.initialize();
  controller.open({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, { id: 'ordinary-trigger' });
  controller.close();

  const opened = controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'craving-trigger' });

  assert.equal(opened, false);
  assert.equal(controller.getState().draft.clientEventId, 'existing-log-event');
  assert.equal(controller.getState().draft.cravingId, null);
  assert.match(view.announcements.at(-1), /finish or discard/i);
});

test('offline linked replay reaches synced, exposes one Undo, and Undo deletes and unlinks once', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const queueRuntime = makeQueueRuntime();
  const view = makeControllerView();
  const timeline = makeControllerTimeline();
  const completions = [];
  const requests = [];
  const timers = [];
  const record = {
    client_event_id: 'linked-offline-event',
    craving_id: 41,
    pouch_id: 12,
    quantity: 1,
    occurred_at_local: '2026-07-30T18:42:00+03:00',
    timezone: 'Asia/Riyadh',
  };
  const log = {
    id: 31,
    client_event_id: 'linked-offline-event',
    linked_craving_id: 41,
  };
  const today = { status: 'on_track', timeline: [] };
  const controller = createQuickLogController({
    view,
    timeline,
    queueRuntime,
    clock: () => new Date('2026-07-30T18:42:00Z'),
    setTimeoutImpl: (callback, delay) => { timers.push([callback, delay]); return 7; },
    clearTimeoutImpl: () => {},
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(200, {
        deleted_log_id: 31,
        today: {
          status: 'on_track',
          timeline: [{
            type: 'craving', id: 41,
            data: { id: 41, outcome: 'used_nicotine', linked_log_id: null },
          }],
        },
        warnings: [],
      });
    },
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));

  queueRuntime.publish({ type: 'synced', record, log, today, warnings: [] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getState().status, 'synced');
  assert.equal(controller.getState().canonicalLog, log);
  assert.equal(controller.getState().undoDeadline, new Date('2026-07-30T18:42:00Z').getTime() + 10_000);
  assert.deepEqual(view.undo, [log]);
  assert.equal(timers.length, 1);
  assert.deepEqual(timeline.canonical, [log]);
  assert.deepEqual(completions, [{
    type: 'linked_log_synced',
    cravingId: 41,
    log,
    today,
  }]);

  await controller.undo();

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/logs/31');
  assert.equal(requests[0][1].method, 'DELETE');
  assert.equal(controller.getState().status, 'closed');
  assert.deepEqual(timeline.canonical, [log]);
  assert.deepEqual(timeline.removed, [log]);
  assert.deepEqual(completions.at(-1), {
    type: 'linked_log_deleted',
    cravingId: 41,
    deletedLogId: 31,
    today: {
      status: 'on_track',
      timeline: [{
        type: 'craving', id: 41,
        data: { id: 41, outcome: 'used_nicotine', linked_log_id: null },
      }],
    },
  });
});

test('Quick Log registry creates one controller per shared Today root', async () => {
  const { ensureQuickLogController } = await loadQuickLog();
  const root = {};
  let factoryCalls = 0;
  const first = ensureQuickLogController(root, () => {
    factoryCalls += 1;
    return { id: 'controller-one' };
  });
  const second = ensureQuickLogController(root, () => {
    factoryCalls += 1;
    return { id: 'controller-two' };
  });

  assert.equal(first, second);
  assert.equal(first.id, 'controller-one');
  assert.equal(factoryCalls, 1);
});

test('Undo publishes that only the linked log was removed while the craving remains resolved', async () => {
  const { createQuickLogController } = await loadQuickLog();
  const view = makeControllerView();
  const completions = [];
  const canonicalLog = {
    id: 31,
    client_event_id: 'linked-undo-event',
    linked_craving_id: 41,
  };
  const unlinkedToday = {
    status: 'on_track',
    timeline: [{
      type: 'craving', id: 41,
      data: { id: 41, outcome: 'used_nicotine', linked_log_id: null },
    }],
  };
  const controller = createQuickLogController({
    view,
    timeline: makeControllerTimeline(),
    clock: () => new Date('2026-07-30T18:42:00Z'),
    uuid: () => 'linked-undo-event',
    timezone: () => 'Asia/Riyadh',
    fetchImpl: async (_url, options) => (
      options.method === 'POST'
        ? jsonResponse(201, {
          log: canonicalLog, today: { status: 'on_track', timeline: [] },
          created: true, warnings: [],
        })
        : jsonResponse(200, {
          deleted_log_id: 31, today: unlinkedToday, warnings: [],
        })
    ),
    setTimeoutImpl: () => 1,
  });
  controller.initialize();
  controller.subscribeCompletion((event) => completions.push(event));
  controller.openLinkedCraving({
    pouchId: 12, brand: 'Steady Mint', nicotineMg: '6.00',
  }, 41, { id: 'craving-trigger' });
  await controller.submit();

  await controller.undo();

  assert.deepEqual(completions.at(-1), {
    type: 'linked_log_deleted',
    cravingId: 41,
    deletedLogId: 31,
    today: unlinkedToday,
  });
});

function makeBootstrapElement() {
  return {
    dataset: {},
    hidden: false,
    disabled: false,
    open: false,
    textContent: '',
    value: '',
    options: [],
    selectedOptions: [],
    ownerDocument: null,
    listeners: new Map(),
    selectors: new Map(),
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
      for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
      return true;
    },
    listenerCount(type) { return (this.listeners.get(type) || []).length; },
    setAttribute() {},
    removeAttribute() {},
    append() {},
    replaceChildren() {},
    remove() {},
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    contains() { return false; },
  };
}

function makeBootstrapDocument({
  withTimeline = true,
  throwOnMeta = false,
  failFirstRootListener = false,
} = {}) {
  const root = makeBootstrapElement();
  if (failFirstRootListener) {
    const addRootListener = root.addEventListener.bind(root);
    let shouldFail = true;
    root.addEventListener = (...args) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('listener-bind-failed');
      }
      addRootListener(...args);
    };
  }
  const dialog = makeBootstrapElement();
  // The dialog view lazily resolves every field it needs; auto-vivify one
  // fake element per selector so open/render code paths have real targets.
  dialog.querySelector = (selector) => {
    if (!dialog.selectors.has(selector)) dialog.selectors.set(selector, makeBootstrapElement());
    return dialog.selectors.get(selector);
  };
  const section = makeBootstrapElement();
  const slot = makeBootstrapElement();
  const fallback = makeBootstrapElement();
  const enhanced = makeBootstrapElement();
  enhanced.hidden = true;
  enhanced.dataset.smartDefaultPouchId = '12';
  enhanced.dataset.smartDefaultBrand = 'Steady Mint';
  enhanced.dataset.smartDefaultStrength = '6.00';
  slot.selectors.set('[data-action-fallback]', fallback);
  slot.selectors.set('[data-action-enhanced]', enhanced);
  root.selectors.set('[data-quick-log-dialog]', dialog);
  if (withTimeline) root.selectors.set('[data-today-timeline-section]', section);
  root.selectors.set('[data-log-action-slot]', slot);
  const documentRef = {
    defaultView: undefined,
    querySelector(selector) {
      if (selector === '[data-today-root]') return root;
      if (throwOnMeta && selector.startsWith('meta[')) {
        throw new Error('meta-lookup-failed');
      }
      return null;
    },
  };
  section.ownerDocument = documentRef;
  return {
    documentRef, root, dialog, section, slot, fallback, enhanced,
  };
}

test('Quick Log bootstrap marks the slot ready only after construction and opens through the enhanced control', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const { documentRef, slot, fallback, enhanced } = makeBootstrapDocument();

  const controller = bootstrapQuickLog(documentRef);

  assert.ok(controller);
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal(fallback.hidden, true);
  assert.equal(enhanced.hidden, false);
  assert.equal(enhanced.listenerCount('click'), 1);

  enhanced.dispatchEvent({ type: 'click' });

  assert.equal(controller.getState().status, 'editing');
  assert.equal(controller.getState().draft.pouchId, 12);
  assert.equal(controller.getState().draft.brand, 'Steady Mint');
  assert.equal(controller.getState().draft.nicotineMg, '6.00');
  await new Promise((resolve) => setImmediate(resolve));
});

test('Quick Log bootstrap reuses the WeakMap controller and never duplicates activation listeners', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const { documentRef, root, slot, enhanced } = makeBootstrapDocument();

  const first = bootstrapQuickLog(documentRef);
  const second = bootstrapQuickLog(documentRef);

  assert.equal(first, second);
  assert.equal(enhanced.listenerCount('click'), 1);
  assert.equal(root.listenerCount('click'), 1);
  assert.equal(slot.dataset.controllerReady, 'true');

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(first.getState().status, 'editing');
  await new Promise((resolve) => setImmediate(resolve));
});

test('Quick Log bootstrap keeps the fallback usable when the timeline adapter is missing', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const { documentRef, slot, fallback, enhanced } = makeBootstrapDocument({ withTimeline: false });

  const controller = bootstrapQuickLog(documentRef);

  assert.equal(controller, null);
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(enhanced.listenerCount('click'), 0);
});

test('Quick Log bootstrap reports a recoverable error and preserves the fallback when construction throws', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const { documentRef, slot, fallback, enhanced } = makeBootstrapDocument({ throwOnMeta: true });
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => { reported.push(args); };
  let controller;
  try {
    controller = bootstrapQuickLog(documentRef);
  } finally {
    console.error = originalError;
  }

  assert.equal(controller, null);
  assert.equal(reported.length, 1);
  assert.match(String(reported[0][0]), /Quick Log enhancement/);
  assert.equal(slot.dataset.controllerReady, undefined);
  assert.equal(fallback.hidden, false);
  assert.equal(enhanced.hidden, true);
  assert.equal(enhanced.listenerCount('click'), 0);
});

test('Quick Log bootstrap rolls back a partially initialized controller before a natural retry', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const {
    documentRef, root, dialog, slot, fallback, enhanced,
  } = makeBootstrapDocument({ failFirstRootListener: true });
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => { reported.push(args); };
  let first;
  try {
    first = bootstrapQuickLog(documentRef);
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

  const second = bootstrapQuickLog(documentRef);

  assert.ok(second);
  assert.equal(slot.dataset.controllerReady, 'true');
  assert.equal(fallback.hidden, true);
  assert.equal(enhanced.hidden, false);
  assert.equal(enhanced.listenerCount('click'), 1);
  for (const eventType of ['click', 'submit', 'input', 'change', 'toggle']) {
    assert.equal(root.listenerCount(eventType), 1, `${eventType} is rebound exactly once`);
  }
  assert.equal(root.listenerCount('cancel'), 0, 'shared utility owns native cancel');
  for (const eventType of ['pointerdown', 'pointerup', 'pointercancel', 'cancel']) {
    assert.equal(dialog.listenerCount(eventType), 1, `dialog ${eventType} is rebound exactly once`);
  }

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(second.getState().status, 'editing');
  assert.equal(second.getState().draft.pouchId, 12);
  await new Promise((resolve) => setImmediate(resolve));
});

test('Quick Log delegates native cancel and backdrop dismissal to the shared lifecycle', async () => {
  const { bootstrapQuickLog } = await loadQuickLog();
  const {
    documentRef, root, dialog, enhanced,
  } = makeBootstrapDocument();

  const controller = bootstrapQuickLog(documentRef);

  assert.ok(controller);
  assert.equal(root.listenerCount('cancel'), 0, 'shared utility owns native cancel');
  assert.equal(dialog.listenerCount('pointerdown'), 1);
  assert.equal(dialog.listenerCount('pointerup'), 1);
  assert.equal(dialog.listenerCount('cancel'), 1);

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(controller.getState().status, 'editing');

  dialog.dispatchEvent({ type: 'pointerdown', target: dialog, pointerId: 1 });
  dialog.dispatchEvent({ type: 'pointerup', target: dialog, pointerId: 1 });
  assert.equal(controller.getState().status, 'editing', 'cleanup waits for the exit boundary');
  dialog.querySelector('[data-dialog-panel]').dispatchEvent({
    type: 'transitionend',
    target: dialog.querySelector('[data-dialog-panel]'),
    propertyName: 'opacity',
  });
  assert.equal(controller.getState().status, 'closed', 'backdrop activation routes to handlers.close');

  enhanced.dispatchEvent({ type: 'click' });
  assert.equal(controller.getState().status, 'editing');
  const cancelEvent = {
    type: 'cancel',
    target: dialog,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  dialog.dispatchEvent(cancelEvent);
  assert.equal(cancelEvent.defaultPrevented, true);
  assert.equal(controller.getState().status, 'editing', 'Escape cleanup waits for the exit boundary');
  dialog.querySelector('[data-dialog-panel]').dispatchEvent({
    type: 'transitionend',
    target: dialog.querySelector('[data-dialog-panel]'),
    propertyName: 'transform',
  });
  assert.equal(controller.getState().status, 'closed', 'Escape routes to handlers.close');
  await new Promise((resolve) => setImmediate(resolve));
});
