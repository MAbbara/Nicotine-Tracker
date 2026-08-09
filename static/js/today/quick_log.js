import { activateActionEnhancement } from './action_enhancement.js';
import { createTimelineDomAdapter } from './timeline.js';
import { getOfflineQueueRuntime, retryNotBeforeFromResponse } from './offline_queue.js';
import { installDialogFocusTrap, restoreDialogFocus } from '../shell/dialog_focus.js';
import {
  installDialogDismissal,
  requestDialogClose,
  showDialog,
} from '../shell/dialog_lifecycle.js';

const QUICK_LOG_CONTROLLERS = new WeakMap();

export function ensureQuickLogController(root, factory) {
  const existing = QUICK_LOG_CONTROLLERS.get(root);
  if (existing) return existing;
  const controller = factory();
  QUICK_LOG_CONTROLLERS.set(root, controller);
  return controller;
}

function rollbackQuickLogController(root, controller) {
  if (!controller || QUICK_LOG_CONTROLLERS.get(root) !== controller) return;
  try {
    controller.cleanup();
  } catch {
    // Cleanup is best-effort; eviction still prevents reuse of a partial controller.
  }
  if (QUICK_LOG_CONTROLLERS.get(root) === controller) {
    QUICK_LOG_CONTROLLERS.delete(root);
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateTimeLocal(value) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
    + `T${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

export function createQuickLogDraft({
  pouchId, brand, nicotineMg, now, timezone, uuid, cravingId = null,
}) {
  return {
    clientEventId: uuid(),
    pouchId: Number(pouchId),
    brand,
    nicotineMg,
    quantity: 1,
    occurredAtLocal: toDateTimeLocal(now),
    timezone,
    notes: '',
    cravingId: cravingId === null ? null : Number(cravingId),
  };
}

export function formatOffsetIso(localValue) {
  const value = new Date(localValue);
  const offset = -value.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offset);
  const localDateTime = localValue.length === 16
    ? `${localValue}:00`
    : localValue.slice(0, 19);
  return `${localDateTime}${sign}${pad2(Math.floor(absoluteOffset / 60))}:${pad2(absoluteOffset % 60)}`;
}

export function buildCreatePayload(draft) {
  const notes = typeof draft.notes === 'string' ? draft.notes.trim() : '';
  return {
    client_event_id: draft.clientEventId,
    pouch_id: Number(draft.pouchId),
    custom_product: null,
    quantity: Number(draft.quantity),
    occurred_at_local: formatOffsetIso(draft.occurredAtLocal),
    timezone: draft.timezone,
    notes: notes || null,
    craving_id: draft.cravingId === null ? null : Number(draft.cravingId),
  };
}

export class QuickLogValidationError extends Error {
  constructor(fieldErrors) {
    super('Check the highlighted details.');
    this.name = 'QuickLogValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export function validateQuickLogDraft(draft, now = new Date()) {
  const quantity = Number(draft.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new QuickLogValidationError({
      quantity: ['Enter a whole number from 1 to 100.'],
    });
  }
  const occurredAt = new Date(draft.occurredAtLocal);
  const minimum = now.getTime() - (30 * 24 * 60 * 60 * 1000);
  const maximum = now.getTime() + (5 * 60 * 1000);
  if (
    Number.isNaN(occurredAt.getTime())
    || occurredAt.getTime() < minimum
    || occurredAt.getTime() > maximum
  ) {
    throw new QuickLogValidationError({
      occurredAtLocal: ['Choose a time no more than 30 days ago or 5 minutes ahead.'],
    });
  }
  if (typeof draft.notes !== 'string' || draft.notes.length > 2000) {
    throw new QuickLogValidationError({
      notes: ['Enter up to 2,000 characters.'],
    });
  }
  return draft;
}

const SERVER_FIELD_NAMES = {
  client_event_id: 'clientEventId',
  pouch_id: 'pouchId',
  product: 'pouchId',
  occurred_at_local: 'occurredAtLocal',
  craving_id: 'cravingId',
};

function normalizeFailure(value) {
  if (value instanceof QuickLogValidationError) {
    return { message: value.message, fieldErrors: value.fieldErrors };
  }
  const failure = value?.responseBody || value;
  const envelope = failure && typeof failure === 'object' ? failure.error : null;
  const sourceFields = envelope && typeof envelope.field_errors === 'object'
    ? envelope.field_errors
    : {};
  const fieldErrors = {};
  for (const [name, messages] of Object.entries(sourceFields)) {
    fieldErrors[SERVER_FIELD_NAMES[name] || name] = messages;
  }
  return {
    message: envelope && typeof envelope.message === 'string'
      ? envelope.message
      : 'Could not sync this log. Your draft is still here.',
    fieldErrors,
  };
}

function isRetryableDeliveryFailure(failure) {
  if (failure instanceof TypeError) return true;
  const status = Number(failure?.httpStatus);
  if (status === 408 || status === 429 || status >= 500) return true;
  return failure?.responseBody?.error?.retryable === true;
}

export function quickLogReducer(state, action) {
  if (action.type === 'OPEN' && state.status === 'closed') {
    const draft = state.draft || action.draft;
    return {
      status: 'editing',
      operation: 'create',
      draft,
      canonicalLog: null,
      pendingKey: draft.clientEventId,
      error: null,
      undoDeadline: null,
    };
  }

  if (action.type === 'CHANGE' && ['editing', 'failed'].includes(state.status)) {
    return {
      ...state,
      status: 'editing',
      operation: 'create',
      draft: { ...state.draft, ...action.changes },
      error: null,
    };
  }

  if (action.type === 'SUBMIT' && ['editing', 'failed'].includes(state.status)) {
    return { ...state, status: 'submitting', operation: 'create', error: null };
  }

  if (
    action.type === 'CREATE_OK'
    && state.status === 'submitting'
    && state.operation === 'create'
  ) {
    return {
      ...state,
      status: 'synced',
      canonicalLog: action.canonicalLog,
      error: null,
      undoDeadline: action.undoDeadline,
    };
  }

  if (action.type === 'REPLAY_OK') {
    const currentPendingKey = state.pendingKey || state.draft?.clientEventId || null;
    const canAdoptEmptyState = (
      state.status === 'closed'
      && currentPendingKey === null
      && state.canonicalLog === null
    );
    const canAdoptMatchingPending = (
      currentPendingKey === action.pendingKey
      && state.operation === 'create'
      && ['closed', 'editing', 'failed', 'submitting'].includes(state.status)
    );
    if (canAdoptEmptyState || canAdoptMatchingPending) {
      return {
        status: 'synced',
        operation: 'create',
        draft: action.draft,
        canonicalLog: action.canonicalLog,
        pendingKey: action.pendingKey,
        error: null,
        undoDeadline: action.undoDeadline,
      };
    }
  }

  if (
    action.type === 'CREATE_FAILED'
    && state.status === 'submitting'
    && state.operation === 'create'
  ) {
    return { ...state, status: 'failed', error: action.error };
  }

  if (
    action.type === 'RETRY'
    && state.status === 'failed'
    && state.operation === 'create'
  ) {
    return { ...state, status: 'submitting', error: null };
  }

  if (action.type === 'DISCARD' && ['editing', 'failed'].includes(state.status)) {
    return {
      status: 'closed', operation: null, draft: null, pendingKey: null,
      canonicalLog: null, error: null, undoDeadline: null,
    };
  }

  if (
    action.type === 'UNDO'
    && state.status === 'synced'
    && action.now < state.undoDeadline
  ) {
    return { ...state, status: 'submitting', operation: 'delete', error: null };
  }

  if (
    action.type === 'DELETE_OK'
    && state.status === 'submitting'
    && state.operation === 'delete'
  ) {
    return {
      status: 'closed', operation: null, draft: null, pendingKey: null,
      canonicalLog: null, error: null, undoDeadline: null,
    };
  }

  if (
    action.type === 'DELETE_FAILED'
    && state.status === 'submitting'
    && state.operation === 'delete'
  ) {
    return {
      ...state,
      status: 'synced',
      operation: 'create',
      error: action.error,
    };
  }

  if (action.type === 'UNDO_EXPIRED' && state.status === 'synced') {
    return { ...state, undoDeadline: null };
  }

  if (action.type === 'CLOSE' && ['editing', 'failed'].includes(state.status)) {
    return { ...state, status: 'closed' };
  }

  return state;
}

export function createQuickLogController({
  view,
  timeline,
  clock = () => new Date(),
  uuid = () => crypto.randomUUID(),
  timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  csrfToken = '',
  fetchImpl = (...args) => fetch(...args),
  AbortControllerImpl = AbortController,
  setTimeoutImpl = (callback, delay) => setTimeout(callback, delay),
  clearTimeoutImpl = (timer) => clearTimeout(timer),
  queueRuntime = null,
}) {
  let state = {
    status: 'closed', operation: null, draft: null, pendingKey: null,
    canonicalLog: null, error: null, undoDeadline: null,
  };
  let rateLimitNotBefore = null;
  let requestPromise = null;
  let activeAbort = null;
  let requestGeneration = 0;
  let undoTimer = null;
  let initialized = false;
  let lifecycleGeneration = 0;
  let queueUnsubscribe = null;
  let initializationPromise = null;
  let pouchesLoaded = false;
  let pouchesPromise = null;
  const queuedEventIds = new Set();
  const queuedRecords = new Map();
  const completedEventIds = new Set();
  const completionSubscribers = new Set();
  let handoffAttemptSequence = 0;
  let activeHandoffAttempt = null;

  function refreshRateLimitNotBefore(extraDeadline = null) {
    const currentTime = clock().getTime();
    const deadlines = [...queuedRecords.values()]
      .map((record) => Number(record?.not_before))
      .filter((deadline) => Number.isSafeInteger(deadline) && deadline > currentTime);
    const extra = Number(extraDeadline);
    if (Number.isSafeInteger(extra) && extra > currentTime) deadlines.push(extra);
    rateLimitNotBefore = deadlines.length ? Math.max(...deadlines) : null;
    return rateLimitNotBefore;
  }

  function publishCompletion(event) {
    for (const subscriber of completionSubscribers) subscriber(event);
  }

  function subscribeCompletion(handler) {
    completionSubscribers.add(handler);
    return () => completionSubscribers.delete(handler);
  }

  function startLinkedHandoffAttempt(draft) {
    const cravingId = Number(draft?.cravingId);
    const clientEventId = draft?.clientEventId;
    if (
      !Number.isInteger(cravingId)
      || cravingId <= 0
      || !clientEventId
    ) {
      return false;
    }
    if (
      activeHandoffAttempt
      && !activeHandoffAttempt.terminal
      && activeHandoffAttempt.clientEventId === clientEventId
      && activeHandoffAttempt.cravingId === cravingId
    ) {
      return activeHandoffAttempt;
    }
    const attempt = {
      attemptId: `quick-log-handoff-${++handoffAttemptSequence}`,
      cravingId,
      clientEventId,
      operation: 'create',
      terminal: false,
    };
    activeHandoffAttempt = attempt;
    publishCompletion({
      type: 'linked_log_handoff_started',
      cravingId,
      clientEventId,
      attemptId: attempt.attemptId,
      operation: attempt.operation,
    });
    return attempt;
  }

  function publishTerminalHandoff(type, draft) {
    const cravingId = Number(draft?.cravingId);
    const clientEventId = draft?.clientEventId;
    const attempt = activeHandoffAttempt;
    if (
      !attempt
      || attempt.terminal
      || attempt.operation !== 'create'
      || attempt.cravingId !== cravingId
      || attempt.clientEventId !== clientEventId
    ) {
      return false;
    }
    attempt.terminal = true;
    publishCompletion({
      type,
      cravingId,
      clientEventId,
      attemptId: attempt.attemptId,
      operation: attempt.operation,
    });
    return true;
  }

  function invalidateActiveRequest() {
    requestGeneration += 1;
    const requestAbort = activeAbort;
    activeAbort = null;
    requestPromise = null;
    if (requestAbort) requestAbort.abort();
  }

  async function reconcileMutationToday(body, isCurrent = () => true) {
    if (body.today) {
      if (!isCurrent()) return false;
      timeline.reconcileToday(body.today);
      return true;
    }
    const refreshUnavailable = Array.isArray(body.warnings) && body.warnings.some(
      (warning) => warning && warning.code === 'today_refresh_unavailable',
    );
    if (!refreshUnavailable) return false;
    try {
      const response = await fetchImpl('/api/today', {
        method: 'GET',
        credentials: 'same-origin',
        signal: activeAbort ? activeAbort.signal : undefined,
      });
      const refreshed = await response.json();
      if (!isCurrent() || !response.ok || !refreshed.today) return false;
      timeline.reconcileToday(refreshed.today);
      return true;
    } catch (_) {
      return false;
    }
  }

  function queuedRecordDraft(record) {
    return {
      clientEventId: record.client_event_id,
      pouchId: Number(record.pouch_id),
      brand: '',
      nicotineMg: null,
      quantity: Number(record.quantity),
      occurredAtLocal: String(record.occurred_at_local || '').slice(0, 16),
      timezone: record.timezone,
      notes: '',
      cravingId: record.craving_id === null || record.craving_id === undefined
        ? null
        : Number(record.craving_id),
    };
  }

  function showUndoWindow(log, deadline = state.undoDeadline) {
    view.showUndo(log);
    if (undoTimer !== null) clearTimeoutImpl(undoTimer);
    const delay = Math.max(0, Number(deadline) - clock().getTime());
    undoTimer = setTimeoutImpl(() => {
      state = quickLogReducer(state, { type: 'UNDO_EXPIRED' });
      view.hideUndo();
      undoTimer = null;
    }, delay);
  }

  async function acceptCanonicalSuccess({
    body,
    log,
    pendingKey,
    draft,
    linkedCravingId,
    source,
    isCurrent,
  }) {
    if (!isCurrent() || completedEventIds.has(pendingKey)) return false;

    const undoDeadline = clock().getTime() + 10_000;
    const nextState = source === 'replay'
      ? quickLogReducer(state, {
        type: 'REPLAY_OK',
        pendingKey,
        draft,
        canonicalLog: log,
        undoDeadline,
      })
      : quickLogReducer(state, {
        type: 'CREATE_OK', canonicalLog: log, undoDeadline,
      });
    const claimedQuickLogState = nextState !== state;
    if (source !== 'replay' && !claimedQuickLogState) return false;

    completedEventIds.add(pendingKey);
    refreshRateLimitNotBefore();
    state = nextState;
    timeline.upsertCanonical(log);
    const totalsCurrent = await reconcileMutationToday(body, isCurrent);
    if (!isCurrent()) return false;

    if (source === 'replay') {
      if (view.clearRecovery) view.clearRecovery(pendingKey);
      view.announce(
        totalsCurrent
          ? 'Saved after reconnecting'
          : 'Saved after reconnecting. Today’s totals will refresh later.',
      );
    } else {
      view.close({ reason: 'saved' });
      view.announce(totalsCurrent ? 'Log saved' : 'Log saved. Today’s totals will refresh later.');
    }

    if (claimedQuickLogState) showUndoWindow(log);
    if (Number.isInteger(Number(linkedCravingId)) && Number(linkedCravingId) > 0) {
      publishCompletion({
        type: 'linked_log_synced',
        cravingId: Number(linkedCravingId),
        log,
        today: body.today || null,
      });
      if (
        activeHandoffAttempt?.clientEventId === pendingKey
        && activeHandoffAttempt.cravingId === Number(linkedCravingId)
      ) {
        activeHandoffAttempt = null;
      }
    }
    return true;
  }

  async function handleQueueResult(result, generation) {
    if (!initialized || generation !== lifecycleGeneration || !result) return false;
    if (result.type === 'pending' && result.record) {
      queuedEventIds.add(result.record.client_event_id);
      queuedRecords.set(result.record.client_event_id, result.record);
      refreshRateLimitNotBefore();
      timeline.insertQueued(result.record);
      return true;
    }
    if (result.type === 'synced' && result.record && result.log) {
      const pendingKey = result.record.client_event_id;
      if (
        state.status === 'submitting'
        && state.operation === 'create'
        && state.pendingKey === pendingKey
      ) {
        invalidateActiveRequest();
        view.setBusy(false);
      }
      queuedEventIds.delete(result.record.client_event_id);
      queuedRecords.delete(result.record.client_event_id);
      refreshRateLimitNotBefore();
      return acceptCanonicalSuccess({
        body: result,
        log: result.log,
        pendingKey,
        draft: queuedRecordDraft(result.record),
        linkedCravingId: result.record.craving_id,
        source: 'replay',
        isCurrent: () => initialized && generation === lifecycleGeneration,
      });
    }
    if (result.type === 'retryable' && result.record) {
      queuedEventIds.add(result.record.client_event_id);
      queuedRecords.set(result.record.client_event_id, result.record);
      const deadline = Number(result.record.not_before);
      const now = clock().getTime();
      refreshRateLimitNotBefore();
      if (state.pendingKey === result.record.client_event_id) {
        const waitSeconds = rateLimitNotBefore === null
          ? null
          : Math.ceil((rateLimitNotBefore - now) / 1000);
        const message = waitSeconds === null
          ? 'Still saved for sync. You can retry when your connection is ready.'
          : `Saved for sync. The server asked us to wait ${waitSeconds} seconds; we’ll try again automatically.`;
        view.showQueued(message, {
          retryDisabled: waitSeconds !== null,
          notBefore: rateLimitNotBefore,
        });
        view.announce(message);
      }
      return true;
    }
    if (result.type === 'needs_attention' && result.record) {
      queuedEventIds.add(result.record.client_event_id);
      queuedRecords.set(result.record.client_event_id, result.record);
      refreshRateLimitNotBefore();
      timeline.markAttention(result.record.client_event_id);
      publishTerminalHandoff(
        'linked_log_handoff_failed',
        queuedRecordDraft(result.record),
      );
      if (
        state.pendingKey === result.record.client_event_id
        && ['editing', 'failed'].includes(state.status)
      ) {
        state = {
          status: 'closed', operation: null, draft: null, pendingKey: null,
          canonicalLog: null, error: null, undoDeadline: null,
        };
      }
      if (view.showSavedAttention) view.showSavedAttention(result.record);
      view.announce('A saved log needs your attention before it can sync.');
      return true;
    }
    return false;
  }

  async function editSaved(clientEventId) {
    if (state.status !== 'closed') return false;
    const record = queuedRecords.get(clientEventId);
    if (!record) return false;
    try {
      const response = await fetchImpl('/api/pouches', {
        method: 'GET',
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (!response.ok || body.success !== true || !Array.isArray(body.pouches)) {
        return false;
      }
      const pouch = body.pouches.find((candidate) => Number(candidate.id) === record.pouch_id);
      if (!pouch) return false;
      const draft = {
        clientEventId: record.client_event_id,
        pouchId: record.pouch_id,
        brand: pouch.brand,
        nicotineMg: pouch.nicotine_mg,
        quantity: record.quantity,
        occurredAtLocal: record.occurred_at_local.slice(0, 16),
        timezone: record.timezone,
        notes: '',
        cravingId: record.craving_id,
      };
      state = quickLogReducer(state, { type: 'OPEN', draft });
      if (state.status !== 'editing') return false;
      view.open(state.draft, null);
      startLinkedHandoffAttempt(state.draft);
      return true;
    } catch (_) {
      view.announce('This saved log could not be opened yet. Try again later.');
      return false;
    }
  }

  async function discardSaved(clientEventId) {
    const record = queuedRecords.get(clientEventId);
    if (!record || !queueRuntime?.remove) return false;
    try {
      await queueRuntime.remove(clientEventId);
      queuedEventIds.delete(clientEventId);
      queuedRecords.delete(clientEventId);
      refreshRateLimitNotBefore();
      timeline.removePending(clientEventId);
      if (view.clearRecovery) view.clearRecovery(clientEventId);
      publishTerminalHandoff('linked_log_handoff_closed', queuedRecordDraft(record));
      view.announce('Saved log discarded.');
      return true;
    } catch (_) {
      view.announce('This saved log could not be discarded yet. Try again when storage is available.');
      return false;
    }
  }

  function open(smartDefault, trigger) {
    const draft = state.draft || createQuickLogDraft({
      ...smartDefault,
      now: clock(),
      timezone: timezone(),
      uuid,
    });
    const openedState = quickLogReducer(state, { type: 'OPEN', draft });
    if (openedState === state || openedState.status !== 'editing') return false;
    state = openedState;
    view.open(state.draft, trigger);
    startLinkedHandoffAttempt(state.draft);
    return true;
  }

  function openLinkedCraving(smartDefault, cravingId, trigger) {
    const parsedCravingId = Number(cravingId);
    if (
      state.status !== 'closed'
      || state.draft
      || !Number.isInteger(parsedCravingId)
      || parsedCravingId <= 0
    ) {
      if (state.draft) {
        view.announce('Finish or discard the open nicotine draft before linking this craving.');
      }
      return false;
    }
    return open({ ...smartDefault, cravingId: parsedCravingId }, trigger);
  }

  function sendCreate() {
    const generation = ++requestGeneration;
    const payload = buildCreatePayload(state.draft);
    timeline.insertPending(state.draft, payload);
    view.setBusy(true);
    const abortController = new AbortControllerImpl();
    activeAbort = abortController;
    const responsePromise = fetchImpl('/api/logs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
    requestPromise = Promise.resolve(responsePromise).then(async (response) => {
      if (generation !== requestGeneration) return false;
      const responseTime = clock().getTime();
      const headerRetryNotBefore = retryNotBeforeFromResponse(response, {}, responseTime);
      let body;
      try {
        body = await response.json();
      } catch (parseFailure) {
        if (response.ok) throw parseFailure;
        body = response.status === 429 ? {
          error: {
            code: 'rate_limited',
            message: 'The server asked us to wait before trying again.',
            field_errors: {},
            retryable: true,
          },
        } : {};
      }
      if (generation !== requestGeneration) return false;
      if (!response.ok) throw {
        httpStatus: response.status,
        responseBody: body,
        retryNotBefore: headerRetryNotBefore
          ?? retryNotBeforeFromResponse(response, body, responseTime),
      };
      if (
        queuedEventIds.has(payload.client_event_id)
        && queueRuntime
        && typeof queueRuntime.remove === 'function'
      ) {
        const queuedRecord = queuedRecords.get(payload.client_event_id);
        let removalFailed = false;
        try {
          await queueRuntime.remove(payload.client_event_id);
        } catch (_) {
          removalFailed = true;
        }
        if (generation !== requestGeneration) return false;
        if (removalFailed) {
          const message = 'Log saved, but its saved browser copy could not be cleared yet. Review it before retrying.';
          timeline.markAttention(payload.client_event_id);
          if (queuedRecord && view.showSavedAttention) {
            state = {
              status: 'closed', operation: null, draft: null, pendingKey: null,
              canonicalLog: null, error: null, undoDeadline: null,
            };
            view.showSavedAttention(queuedRecord);
          } else {
            const error = { message, fieldErrors: {} };
            state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
            view.showFailure(error);
          }
          view.announce(message);
          return false;
        }
        queuedEventIds.delete(payload.client_event_id);
        queuedRecords.delete(payload.client_event_id);
        refreshRateLimitNotBefore();
      }
      if (generation !== requestGeneration) return false;
      const accepted = await acceptCanonicalSuccess({
        body,
        log: body.log,
        pendingKey: payload.client_event_id,
        draft: state.draft,
        linkedCravingId: payload.craving_id,
        source: 'direct',
        isCurrent: () => generation === requestGeneration,
      });
      return accepted ? body : false;
    }).catch(async (failure) => {
      if (generation !== requestGeneration) return false;
      if (
        queueRuntime
        && typeof queueRuntime.enqueue === 'function'
        && isRetryableDeliveryFailure(failure)
      ) {
        let queued = null;
        try {
          const queueOptions = Number.isSafeInteger(failure?.retryNotBefore)
            ? { notBefore: failure.retryNotBefore }
            : undefined;
          queued = await queueRuntime.enqueue(payload, queueOptions);
        } catch (_) {
          queued = null;
        }
        if (generation !== requestGeneration) return false;
        if (queued?.queued) {
          const retryDeadline = Number(failure?.retryNotBefore);
          queuedEventIds.add(payload.client_event_id);
          if (queued.record) queuedRecords.set(payload.client_event_id, queued.record);
          refreshRateLimitNotBefore(retryDeadline);
          const waitSeconds = rateLimitNotBefore === null
            ? null
            : Math.max(1, Math.ceil((rateLimitNotBefore - clock().getTime()) / 1000));
          const message = waitSeconds !== null
            ? `Saved for sync. The server asked us to wait ${waitSeconds} seconds; we’ll try again automatically.`
            : Number.isSafeInteger(retryDeadline)
              ? 'Still saved for sync. You can retry when your connection is ready.'
            : queued.notesOmitted
              ? 'Waiting for connection. Saved for sync without notes. Notes stay only on this screen.'
              : 'Waiting for connection.';
          const error = { message, fieldErrors: {} };
          state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
          timeline.markQueued(state.pendingKey);
          view.showQueued(message, {
            retryDisabled: waitSeconds !== null,
            notBefore: rateLimitNotBefore,
          });
          view.announce(message);
          return false;
        }
      }
      const error = normalizeFailure(failure);
      if (state.status === 'submitting' && state.operation === 'create') {
        state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
        timeline.markFailed(state.pendingKey);
        view.showFailure(error);
        view.announce(error.message);
        publishTerminalHandoff('linked_log_handoff_failed', state.draft);
      }
      return false;
    }).finally(() => {
      if (generation !== requestGeneration) return;
      view.setBusy(false);
      activeAbort = null;
      requestPromise = null;
    });
    return requestPromise;
  }

  function submit() {
    if (state.status === 'submitting') return requestPromise;
    if (!['editing', 'failed'].includes(state.status) || state.operation !== 'create') {
      return null;
    }
    if (Number.isSafeInteger(rateLimitNotBefore) && clock().getTime() < rateLimitNotBefore) {
      queueRuntime?.replay?.();
      return Promise.resolve(false);
    }
    startLinkedHandoffAttempt(state.draft);
    try {
      validateQuickLogDraft(state.draft, clock());
    } catch (failure) {
      const error = normalizeFailure(failure);
      state = quickLogReducer(state, { type: 'SUBMIT' });
      timeline.insertPending(state.draft, null);
      state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
      timeline.markFailed(state.pendingKey);
      view.showFailure(error);
      view.announce(error.message);
      publishTerminalHandoff('linked_log_handoff_failed', state.draft);
      return Promise.resolve(false);
    }
    state = quickLogReducer(state, { type: 'SUBMIT' });
    return sendCreate();
  }

  function retry() {
    if (state.status !== 'failed' || state.operation !== 'create') return null;
    if (Number.isSafeInteger(rateLimitNotBefore) && clock().getTime() < rateLimitNotBefore) {
      queueRuntime?.replay?.();
      return Promise.resolve(false);
    }
    rateLimitNotBefore = null;
    startLinkedHandoffAttempt(state.draft);
    try {
      validateQuickLogDraft(state.draft, clock());
    } catch (failure) {
      const error = normalizeFailure(failure);
      state = quickLogReducer(state, { type: 'RETRY' });
      state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
      timeline.markFailed(state.pendingKey);
      view.showFailure(error);
      view.announce(error.message);
      publishTerminalHandoff('linked_log_handoff_failed', state.draft);
      return Promise.resolve(false);
    }
    state = quickLogReducer(state, { type: 'RETRY' });
    return sendCreate();
  }

  function change(changes) {
    if (!['editing', 'failed'].includes(state.status) || state.operation !== 'create') {
      return false;
    }
    const wasFailed = state.status === 'failed';
    state = quickLogReducer(state, { type: 'CHANGE', changes });
    if (wasFailed && view.restoreEditing) view.restoreEditing();
    if (view.renderDraft) view.renderDraft(state.draft);
    return true;
  }

  function loadPouches() {
    if (pouchesLoaded) return Promise.resolve(true);
    if (pouchesPromise) return pouchesPromise;
    pouchesPromise = Promise.resolve(fetchImpl('/api/pouches', {
      method: 'GET',
      credentials: 'same-origin',
    })).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body.success !== true || !Array.isArray(body.pouches)) {
        throw new Error('pouch-list-unavailable');
      }
      view.populatePouches(body.pouches, state.draft?.pouchId);
      pouchesLoaded = true;
      return true;
    }).catch(() => {
      view.showPouchLoadFailure();
      return false;
    }).finally(() => {
      pouchesPromise = null;
    });
    return pouchesPromise;
  }

  function undo() {
    if (state.status === 'submitting' && state.operation === 'delete') {
      return requestPromise;
    }
    if (state.status !== 'synced') return null;
    const previous = state;
    const linkedCravingId = state.draft?.cravingId ?? null;
    const deletedLogId = state.canonicalLog?.id ?? null;
    state = quickLogReducer(state, { type: 'UNDO', now: clock().getTime() });
    if (state === previous) return null;
    if (undoTimer !== null) clearTimeoutImpl(undoTimer);
    undoTimer = null;
    const snapshot = timeline.removeCanonical(state.canonicalLog);
    const generation = ++requestGeneration;
    activeAbort = new AbortControllerImpl();
    const responsePromise = fetchImpl(`/api/logs/${state.canonicalLog.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': csrfToken },
      signal: activeAbort.signal,
    });
    requestPromise = Promise.resolve(responsePromise).then(async (response) => {
      if (generation !== requestGeneration) return false;
      const body = await response.json();
      if (generation !== requestGeneration) return false;
      if (!response.ok) throw body;
      const totalsCurrent = await reconcileMutationToday(
        body,
        () => generation === requestGeneration,
      );
      if (generation !== requestGeneration) return false;
      if (linkedCravingId !== null) {
        publishCompletion({
          type: 'linked_log_deleted',
          cravingId: Number(linkedCravingId),
          deletedLogId,
          today: body.today || null,
        });
      }
      state = quickLogReducer(state, { type: 'DELETE_OK' });
      view.hideUndo();
      view.announce(totalsCurrent ? 'Log removed' : 'Log removed. Today’s totals will refresh later.');
      return true;
    }).catch(() => {
      if (generation !== requestGeneration) return false;
      timeline.restore(snapshot);
      const error = {
        message: 'The log is still saved. You can try removing it again later.',
        fieldErrors: {},
      };
      if (state.status === 'submitting' && state.operation === 'delete') {
        state = quickLogReducer(state, { type: 'DELETE_FAILED', error });
      }
      view.hideUndo();
      if (state.undoDeadline !== null && clock().getTime() < state.undoDeadline) {
        showUndoWindow(state.canonicalLog, state.undoDeadline);
      } else {
        state = quickLogReducer(state, { type: 'UNDO_EXPIRED' });
      }
      view.announce(error.message);
      return false;
    }).finally(() => {
      if (generation !== requestGeneration) return;
      activeAbort = null;
      requestPromise = null;
    });
    return requestPromise;
  }

  function close(reason = 'dismiss') {
    const closingDraft = state.draft;
    const closingPendingKey = state.pendingKey;
    const closable = ['editing', 'failed'].includes(state.status)
      || (state.status === 'submitting' && state.operation === 'create');
    if (!closable) return Promise.resolve(false);
    if (state.status === 'submitting' && state.operation === 'create') {
      invalidateActiveRequest();
    }
    const beforeNativeClose = () => {
      if (state.status === 'submitting' && state.operation === 'create') {
        const error = {
          message: 'Sync paused. Your draft is still here.',
          fieldErrors: {},
        };
        state = quickLogReducer(state, { type: 'CREATE_FAILED', error });
        timeline.markFailed(state.pendingKey);
      }
      if (!['editing', 'failed'].includes(state.status)) return;
      if (
        state.operation === 'create'
        && !state.canonicalLog
        && !queuedEventIds.has(closingPendingKey)
      ) {
        publishTerminalHandoff('linked_log_handoff_closed', closingDraft);
      }
      state = quickLogReducer(state, { type: 'CLOSE' });
    };
    return Promise.resolve(view.close({ reason, beforeNativeClose }));
  }

  function discard() {
    if (!['editing', 'failed'].includes(state.status) || state.operation !== 'create') {
      return false;
    }
    const pendingKey = state.pendingKey;
    const discardedDraft = state.draft;
    const finishDiscard = () => {
      const beforeNativeClose = () => {
        queuedEventIds.delete(pendingKey);
        queuedRecords.delete(pendingKey);
        refreshRateLimitNotBefore();
        timeline.removePending(pendingKey);
        state = quickLogReducer(state, { type: 'DISCARD' });
        publishTerminalHandoff('linked_log_handoff_closed', discardedDraft);
      };
      return Promise.resolve(view.close({ reason: 'discard', beforeNativeClose }));
    };
    if (
      queuedEventIds.has(pendingKey)
      && queueRuntime
      && typeof queueRuntime.remove === 'function'
    ) {
      return Promise.resolve(queueRuntime.remove(pendingKey)).then(
        () => finishDiscard(),
      ).catch(() => {
        view.announce('This saved log could not be discarded yet. Try again when storage is available.');
        return false;
      });
    }
    return finishDiscard();
  }

  function initialize() {
    if (initialized) return initializationPromise;
    initialized = true;
    const generation = ++lifecycleGeneration;
    const bindView = () => {
      if (!initialized || generation !== lifecycleGeneration) return false;
      view.initialize({
        open, change, submit, retry, discard, undo, close, loadPouches,
        editSaved, discardSaved,
      });
      if (queueRuntime && typeof queueRuntime.subscribe === 'function') {
        queueUnsubscribe = queueRuntime.subscribe(
          (result) => handleQueueResult(result, generation),
        );
      }
      return true;
    };
    if (!queueRuntime) {
      bindView();
      initializationPromise = Promise.resolve(true);
      return initializationPromise;
    }
    initializationPromise = (
      typeof queueRuntime.list === 'function'
        ? Promise.resolve(queueRuntime.list())
        : Promise.resolve([])
    ).then((records) => {
        if (!initialized || generation !== lifecycleGeneration) return false;
        for (const record of records || []) {
          queuedEventIds.add(record.client_event_id);
          queuedRecords.set(record.client_event_id, record);
          timeline.insertQueued(record);
        }
        refreshRateLimitNotBefore();
        return bindView();
      });
    return initializationPromise;
  }

  function cleanup() {
    if (!initialized) return;
    initialized = false;
    lifecycleGeneration += 1;
    if (queueUnsubscribe) queueUnsubscribe();
    queueUnsubscribe = null;
    if (queueRuntime?.invalidateBufferedResults) queueRuntime.invalidateBufferedResults();
    initializationPromise = null;
    queuedEventIds.clear();
    queuedRecords.clear();
    completedEventIds.clear();
    activeHandoffAttempt = null;
    rateLimitNotBefore = null;
    completionSubscribers.clear();
    invalidateActiveRequest();
    if (undoTimer !== null) clearTimeoutImpl(undoTimer);
    undoTimer = null;
    view.cleanup();
  }

  return {
    initialize,
    cleanup,
    open,
    openLinkedCraving,
    subscribeCompletion,
    submit,
    retry,
    undo,
    close,
    discard,
    change,
    loadPouches,
    editSaved,
    discardSaved,
    getState: () => state,
  };
}

export function createQuickLogDomView(root, dialog) {
  const form = dialog.querySelector('[data-quick-log-form]');
  const confirm = dialog.querySelector('[data-quick-log-confirm]');
  const retry = dialog.querySelector('[data-quick-log-retry]');
  const discard = dialog.querySelector('[data-quick-log-discard]');
  const recovery = dialog.querySelector('[data-quick-log-recovery]');
  const requestError = dialog.querySelector('[data-quick-log-request-error]');
  const details = dialog.querySelector('[data-quick-log-details]');
  const pouchSelect = dialog.querySelector('[data-quick-log-field="pouchId"]');
  const pouchLoadError = dialog.querySelector('[data-quick-log-pouch-error]');
  const summaryBrand = dialog.querySelector('[data-quick-log-summary-brand]');
  const summaryDetail = dialog.querySelector('[data-quick-log-summary-detail]');
  const undoNotice = root.querySelector('[data-quick-log-undo]');
  const undoButton = root.querySelector('[data-quick-log-undo-action]');
  const liveRegion = root.querySelector('[data-quick-log-live]');
  let handlers = null;
  let trigger = null;
  let bound = false;
  let removeFocusTrap = null;
  let removeDialogDismissal = null;
  let activeClientEventId = null;
  let retryBlocked = false;

  function confirmLabel() {
    const quantity = Number.parseInt(field('quantity')?.value, 10) || 1;
    return quantity === 1 ? 'Log one pouch' : `Log ${quantity} pouches`;
  }

  function field(name) {
    return dialog.querySelector(`[data-quick-log-field="${name}"]`);
  }

  function clearErrors() {
    requestError.hidden = true;
    requestError.textContent = '';
    delete requestError.dataset.tone;
    for (const region of dialog.querySelectorAll('[data-quick-log-error]')) {
      region.hidden = true;
      region.textContent = '';
    }
    for (const control of dialog.querySelectorAll('[data-quick-log-field]')) {
      control.removeAttribute('aria-invalid');
    }
  }

  function renderDraft(draft) {
    activeClientEventId = draft.clientEventId;
    const selected = [...pouchSelect.options].find(
      (option) => Number(option.value) === Number(draft.pouchId),
    );
    if (selected) pouchSelect.value = String(draft.pouchId);
    field('quantity').value = String(draft.quantity);
    field('occurredAtLocal').value = draft.occurredAtLocal;
    field('notes').value = draft.notes || '';
    if (!confirm.disabled) confirm.textContent = confirmLabel();
    summaryBrand.textContent = draft.brand;
    const time = draft.occurredAtLocal?.slice(11, 16) || 'now';
    summaryDetail.textContent = `${draft.nicotineMg} mg · ${draft.quantity} ${Number(draft.quantity) === 1 ? 'pouch' : 'pouches'} · ${time}`;
  }

  function open(draft, sourceTrigger) {
    trigger = sourceTrigger;
    clearErrors();
    retryBlocked = false;
    recovery.hidden = true;
    confirm.hidden = false;
    confirm.disabled = false;
    details.open = false;
    renderDraft(draft);
    showDialog(dialog);
    confirm.focus();
  }

  function close({
    reason = 'dismiss', restoreFocus = true, beforeNativeClose = null,
  } = {}) {
    const sourceTrigger = restoreFocus ? trigger : false;
    return requestDialogClose(dialog, {
      reason,
      restoreFocusTo: sourceTrigger,
      beforeNativeClose,
    }).then((closed) => {
      if (closed && trigger === sourceTrigger) trigger = null;
      if (closed && !restoreFocus) trigger = null;
      return closed;
    });
  }

  function returnFocus() {
    if (dialog.open) return false;
    const sourceTrigger = trigger;
    trigger = null;
    return restoreDialogFocus(dialog, sourceTrigger);
  }

  function setBusy(value) {
    confirm.disabled = value;
    retry.disabled = value || retryBlocked;
    discard.disabled = value;
    form.setAttribute('aria-busy', value ? 'true' : 'false');
    if (!confirm.hidden) confirm.textContent = value ? 'Saving…' : confirmLabel();
  }

  function announce(message) {
    liveRegion.textContent = '';
    liveRegion.textContent = message;
  }

  function showFailure(error) {
    clearErrors();
    retryBlocked = false;
    requestError.hidden = false;
    requestError.textContent = error.message;
    let firstInvalid = null;
    for (const [name, messages] of Object.entries(error.fieldErrors || {})) {
      const control = field(name);
      const region = dialog.querySelector(`[data-quick-log-error="${name}"]`);
      if (!control || !region) continue;
      details.open = true;
      control.setAttribute('aria-invalid', 'true');
      region.textContent = Array.isArray(messages) ? messages.join(' ') : String(messages);
      region.hidden = false;
      if (!firstInvalid) firstInvalid = control;
    }
    confirm.hidden = true;
    recovery.hidden = false;
    (firstInvalid || retry).focus();
  }

  function showQueued(message, { retryDisabled = false, notBefore = null } = {}) {
    clearErrors();
    retryBlocked = retryDisabled;
    requestError.hidden = false;
    requestError.textContent = message;
    requestError.dataset.tone = 'queued';
    confirm.hidden = true;
    recovery.hidden = false;
    retry.disabled = retryBlocked;
    if (Number.isSafeInteger(notBefore)) {
      retry.dataset.notBefore = String(notBefore);
    } else {
      delete retry.dataset.notBefore;
    }
    discard.disabled = false;
    (retryBlocked ? discard : retry).focus();
  }

  function showSavedAttention() {
    clearErrors();
    recovery.hidden = true;
    close({ reason: 'saved' });
    returnFocus();
  }

  function clearRecovery(clientEventId) {
    if (activeClientEventId !== clientEventId) return;
    clearErrors();
    recovery.hidden = true;
    close({ reason: 'synced', restoreFocus: false });
  }

  function restoreEditing() {
    clearErrors();
    recovery.hidden = true;
    confirm.hidden = false;
    confirm.disabled = false;
    confirm.textContent = confirmLabel();
  }

  function showUndo(log) {
    undoNotice.dataset.logId = String(log.id);
    undoNotice.hidden = false;
    undoButton.disabled = false;
    const rule = undoNotice.querySelector('.quick-log-undo__rule');
    if (rule) {
      rule.classList.remove('quick-log-undo__rule--running');
      void rule.offsetWidth;
      rule.classList.add('quick-log-undo__rule--running');
    }
  }

  function hideUndo() {
    undoButton.disabled = true;
    undoNotice.hidden = true;
  }

  function populatePouches(pouches, currentId) {
    const current = [...pouchSelect.options].find(
      (option) => Number(option.value) === Number(currentId),
    );
    const values = pouches.map((pouch) => ({
      id: Number(pouch.id),
      brand: pouch.brand,
      strength: Number(pouch.nicotine_mg).toFixed(2),
    }));
    if (current && !values.some((pouch) => pouch.id === Number(currentId))) {
      values.unshift({
        id: Number(current.value),
        brand: current.dataset.brand,
        strength: current.dataset.strength,
      });
    }
    pouchSelect.replaceChildren();
    for (const pouch of values) {
      const option = pouchSelect.ownerDocument.createElement('option');
      option.value = String(pouch.id);
      option.dataset.brand = pouch.brand;
      option.dataset.strength = pouch.strength;
      option.textContent = `${pouch.brand} · ${pouch.strength} mg`;
      pouchSelect.append(option);
    }
    pouchSelect.value = String(currentId);
    pouchLoadError.hidden = true;
  }

  function showPouchLoadFailure() {
    pouchLoadError.hidden = false;
  }

  function onClick(event) {
    const editSaved = event.target.closest('[data-saved-log-edit]');
    if (editSaved && root.contains(editSaved)) {
      handlers.editSaved(editSaved.dataset.savedLogEdit);
      return;
    }
    const discardSaved = event.target.closest('[data-saved-log-discard]');
    if (discardSaved && root.contains(discardSaved)) {
      handlers.discardSaved(discardSaved.dataset.savedLogDiscard);
      return;
    }
    const openTrigger = event.target.closest('[data-today-action="log-nicotine"]');
    if (openTrigger && root.contains(openTrigger)) {
      const pouchId = Number(openTrigger.dataset.smartDefaultPouchId);
      if (Number.isInteger(pouchId) && pouchId > 0) {
        event.preventDefault();
        handlers.open({
          pouchId,
          brand: openTrigger.dataset.smartDefaultBrand,
          nicotineMg: openTrigger.dataset.smartDefaultStrength,
        }, openTrigger);
      }
      return;
    }
    if (event.target.closest('[data-quick-log-close]')) handlers.close('close-button');
    else if (event.target.closest('[data-quick-log-retry]')) handlers.retry();
    else if (event.target.closest('[data-quick-log-discard]')) handlers.discard();
    else if (event.target.closest('[data-quick-log-undo-action]')) handlers.undo();
  }

  function onSubmit(event) {
    if (event.target !== form) return;
    event.preventDefault();
    handlers.submit();
  }

  function onChange(event) {
    const control = event.target.closest('[data-quick-log-field]');
    if (!control || !dialog.contains(control)) return;
    if (control === pouchSelect) {
      const selected = pouchSelect.selectedOptions[0];
      handlers.change({
        pouchId: Number(pouchSelect.value),
        brand: selected.dataset.brand,
        nicotineMg: selected.dataset.strength,
      });
      return;
    }
    if (control.name === 'quantity') {
      const value = Math.min(100, Math.max(1, Number.parseInt(control.value, 10) || 1));
      control.value = String(value);
      handlers.change({ quantity: value });
      return;
    }
    handlers.change({ [control.name]: control.value });
  }

  function onInput(event) {
    const control = event.target.closest('[data-quick-log-field]');
    if (!control || !dialog.contains(control)) return;
    if (control.name === 'notes') {
      handlers.change({ notes: control.value });
      return;
    }
    if (control.name === 'quantity') {
      const value = Number.parseInt(control.value, 10);
      if (Number.isInteger(value) && value >= 1 && value <= 100) {
        handlers.change({ quantity: value });
      }
    }
  }

  function onToggle(event) {
    if (event.target === details && details.open) handlers.loadPouches();
  }

  function initialize(nextHandlers) {
    if (bound) return;
    handlers = nextHandlers;
    bound = true;
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('toggle', onToggle, true);
    removeDialogDismissal = installDialogDismissal(dialog, {
      panel: dialog.querySelector('[data-dialog-panel]'),
      dismiss: (reason) => handlers.close(reason),
    });
    removeFocusTrap = installDialogFocusTrap(dialog);
  }

  function cleanup() {
    if (!bound) return;
    bound = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('toggle', onToggle, true);
    removeDialogDismissal?.();
    removeDialogDismissal = null;
    removeFocusTrap?.();
    removeFocusTrap = null;
  }

  return {
    initialize,
    cleanup,
    open,
    close,
    returnFocus,
    renderDraft,
    setBusy,
    announce,
    showFailure,
    showQueued,
    showSavedAttention,
    clearRecovery,
    restoreEditing,
    showUndo,
    hideUndo,
    populatePouches,
    showPouchLoadFailure,
  };
}

export function bootstrapQuickLog(documentRef = document, {
  queueRuntimeFactory = getOfflineQueueRuntime,
  controllerOptions = {},
  controllerFactory = createQuickLogController,
  timelineFactory = createTimelineDomAdapter,
  viewFactory = createQuickLogDomView,
} = {}) {
  const root = documentRef.querySelector('[data-today-root]');
  const dialog = root?.querySelector('[data-quick-log-dialog]');
  if (!root || !dialog) return null;
  let controller = null;
  try {
    controller = ensureQuickLogController(root, () => {
      const timeline = timelineFactory(root);
      if (!timeline) return null;
      const view = viewFactory(root, dialog);
      const csrfToken = documentRef.querySelector('meta[name="csrf-token"]')?.content || '';
      const queueRuntime = queueRuntimeFactory({
        doc: documentRef,
        win: documentRef.defaultView || globalThis.window,
      });
      return controllerFactory({
        ...controllerOptions,
        view, timeline, csrfToken, queueRuntime,
      });
    });
    if (!controller) return null;
    const slot = root.querySelector('[data-log-action-slot]');
    Promise.resolve(controller.initialize()).then((ready) => {
      if (!ready || QUICK_LOG_CONTROLLERS.get(root) !== controller) return;
      // Activation is the last bootstrap step, after persisted queue state
      // has hydrated and the controller's interaction handlers are bound.
      activateActionEnhancement(
        slot, () => openQuickLogFromEnhancedTrigger(controller, slot),
      );
    }).catch((error) => {
      rollbackQuickLogController(root, controller);
      console.error(
        'Quick Log enhancement is unavailable; the standard logging link remains active.',
        error instanceof Error ? error.name : 'InitializationError',
      );
    });
    return controller;
  } catch (error) {
    rollbackQuickLogController(root, controller);
    // Recoverable: the server-rendered fallback link stays visible and
    // keeps its plain navigation behavior, so the action still works.
    console.error(
      'Quick Log enhancement is unavailable; the standard logging link remains active.',
      error,
    );
    return null;
  }
}

function openQuickLogFromEnhancedTrigger(controller, slot) {
  const trigger = slot?.querySelector('[data-action-enhanced]');
  const pouchId = Number(trigger?.dataset.smartDefaultPouchId);
  if (!trigger || !Number.isInteger(pouchId) || pouchId <= 0) return false;
  return controller.open({
    pouchId,
    brand: trigger.dataset.smartDefaultBrand,
    nicotineMg: trigger.dataset.smartDefaultStrength,
  }, trigger);
}

if (typeof document !== 'undefined') bootstrapQuickLog(document);
