import { bootstrapQuickLog, formatOffsetIso, toDateTimeLocal } from './quick_log.js';
import { createTimelineDomAdapter } from './timeline.js';
import { activateActionEnhancement } from './action_enhancement.js';
import { installDialogFocusTrap, restoreDialogFocus } from '../shell/dialog_focus.js';

const OUTCOMES = new Set(['resisted', 'used_nicotine', 'used_alternative']);
const CRAVING_FLOW_CONTROLLERS = new WeakMap();

function ensureCravingFlowController(root, factory) {
  const existing = CRAVING_FLOW_CONTROLLERS.get(root);
  if (existing) return existing;
  const controller = factory();
  CRAVING_FLOW_CONTROLLERS.set(root, controller);
  return controller;
}

function rollbackCravingFlowController(root, controller) {
  if (!controller || CRAVING_FLOW_CONTROLLERS.get(root) !== controller) return;
  try {
    controller.cleanup();
  } catch {
    // Cleanup is best-effort; eviction still prevents reuse of a partial controller.
  }
  if (CRAVING_FLOW_CONTROLLERS.get(root) === controller) {
    CRAVING_FLOW_CONTROLLERS.delete(root);
  }
}

export class CravingFlowValidationError extends Error {
  constructor(fieldErrors) {
    super('Check the highlighted details.');
    this.name = 'CravingFlowValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export function validateCravingCheckIn(state, now = new Date()) {
  const fieldErrors = {};
  const intensity = Number(state.intensity);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    fieldErrors.intensity = ['Choose an intensity from 1 to 10.'];
  }
  if (typeof state.trigger !== 'string' || state.trigger.length > 100) {
    fieldErrors.trigger = ['Enter up to 100 characters.'];
  }
  const occurredAt = new Date(state.occurredAtLocal);
  const minimum = now.getTime() - (30 * 24 * 60 * 60 * 1000);
  const maximum = now.getTime() + (5 * 60 * 1000);
  if (
    Number.isNaN(occurredAt.getTime())
    || occurredAt.getTime() < minimum
    || occurredAt.getTime() > maximum
  ) {
    fieldErrors.occurredAtLocal = [
      'Choose a time no more than 30 days ago or 5 minutes ahead.',
    ];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CravingFlowValidationError(fieldErrors);
  }
  return state;
}

export function buildCravingCreatePayload(state, timezone) {
  const trigger = typeof state.trigger === 'string' ? state.trigger.trim() : '';
  return {
    client_event_id: state.clientEventId,
    intensity: Number(state.intensity),
    trigger: trigger || null,
    occurred_at_local: formatOffsetIso(state.occurredAtLocal),
    timezone,
  };
}

const DETAIL_NUMBER_FIELDS = new Set([
  'duration_minutes', 'mood_before', 'mood_after', 'stress_level',
]);
const DETAIL_TEXT_FIELDS = new Set(['situation_context', 'notes', 'outcome_notes']);

export function buildCravingDetailsPayload(details) {
  const payload = {};
  for (const [name, rawValue] of Object.entries(details || {})) {
    if (DETAIL_NUMBER_FIELDS.has(name)) {
      payload[name] = rawValue === '' || rawValue === null ? null : Number(rawValue);
      continue;
    }
    if (DETAIL_TEXT_FIELDS.has(name)) {
      const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
      payload[name] = normalized || null;
      continue;
    }
    if (name === 'physical_symptoms') {
      const seen = new Set();
      payload[name] = (Array.isArray(rawValue) ? rawValue : []).reduce((items, symptom) => {
        if (typeof symptom !== 'string') return items;
        const normalized = symptom.trim().replace(/\s+/g, ' ');
        const identity = normalized.toLocaleLowerCase();
        if (!normalized || seen.has(identity)) return items;
        seen.add(identity);
        items.push(normalized);
        return items;
      }, []);
    }
  }
  return payload;
}

export function validateCravingDetailsPayload(payload) {
  const fieldErrors = {};
  if (
    Object.hasOwn(payload, 'duration_minutes')
    && payload.duration_minutes !== null
    && (!Number.isInteger(payload.duration_minutes)
      || payload.duration_minutes < 0
      || payload.duration_minutes > 1440)
  ) {
    fieldErrors.duration_minutes = ['Enter a whole number from 0 to 1,440, or leave it blank.'];
  }
  for (const field of ['mood_before', 'mood_after', 'stress_level']) {
    if (
      Object.hasOwn(payload, field)
      && payload[field] !== null
      && (!Number.isInteger(payload[field]) || payload[field] < 1 || payload[field] > 10)
    ) {
      fieldErrors[field] = ['Enter a whole number from 1 to 10, or leave it blank.'];
    }
  }
  for (const field of DETAIL_TEXT_FIELDS) {
    if (typeof payload[field] === 'string' && payload[field].length > 2000) {
      fieldErrors[field] = ['Enter up to 2,000 characters.'];
    }
  }
  if (
    Array.isArray(payload.physical_symptoms)
    && (payload.physical_symptoms.length > 20
      || payload.physical_symptoms.some((value) => value.length > 80))
  ) {
    fieldErrors.physical_symptoms = [
      'Choose up to 20 items of no more than 80 characters each.',
    ];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CravingFlowValidationError(fieldErrors);
  }
  return payload;
}

export function cravingFlowReducer(state, action) {
  if (action.type === 'OPEN' && state.status === 'closed') {
    if (state.canonicalCraving && state.resumeStatus) {
      return { ...state, status: state.resumeStatus, resumeStatus: null };
    }
    return {
      status: 'check_in',
      clientEventId: action.clientEventId,
      occurredAtLocal: action.occurredAtLocal,
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
    };
  }
  if (action.type === 'EDIT_CHECK_IN' && state.status === 'check_in' && !state.operation) {
    return {
      ...state,
      ...action.changes,
      error: null,
    };
  }
  if (action.type === 'SUBMIT_CHECK_IN' && state.status === 'check_in' && !state.operation) {
    return { ...state, operation: 'create', error: null };
  }
  if (
    action.type === 'CREATE_OK'
    && state.status === 'check_in'
    && state.operation === 'create'
  ) {
    return {
      ...state,
      status: 'action_choice',
      canonicalCraving: action.canonicalCraving,
      operation: null,
      error: null,
    };
  }
  if (
    action.type === 'CREATE_FAILED'
    && state.status === 'check_in'
    && state.operation === 'create'
  ) {
    return { ...state, operation: null, error: action.error };
  }
  if (
    action.type === 'RETRY_CREATE'
    && state.status === 'check_in'
    && !state.operation
    && state.error
  ) {
    return { ...state, operation: 'create', error: null };
  }
  if (action.type === 'CHOOSE_ACTION' && state.status === 'action_choice') {
    if (action.action === 'pause') {
      return {
        ...state,
        status: 'pause',
        selectedAction: 'pause',
        pauseDeadline: action.now + 180_000,
        remainingSeconds: 180,
        error: null,
      };
    }
    return {
      ...state,
      status: 'outcome',
      selectedAction: action.action,
      error: null,
    };
  }
  if (action.type === 'PAUSE_TICK' && state.status === 'pause') {
    return {
      ...state,
      remainingSeconds: Math.max(
        0,
        Math.ceil((state.pauseDeadline - action.now) / 1000),
      ),
    };
  }
  if (action.type === 'SHOW_OUTCOME' && state.status === 'pause') {
    return { ...state, status: 'outcome', error: null };
  }
  if (
    action.type === 'SELECT_OUTCOME'
    && state.status === 'outcome'
    && !state.operation
    && !state.outcomeConflict
    && OUTCOMES.has(action.outcome)
  ) {
    return { ...state, outcome: action.outcome, error: null };
  }
  if (
    action.type === 'SUBMIT_OUTCOME'
    && state.status === 'outcome'
    && !state.operation
    && OUTCOMES.has(state.outcome)
  ) {
    return { ...state, operation: 'outcome', error: null };
  }
  if (
    action.type === 'OUTCOME_OK'
    && state.status === 'outcome'
    && state.operation === 'outcome'
  ) {
    return {
      ...state,
      status: 'details',
      canonicalCraving: action.canonicalCraving,
      outcome: action.canonicalCraving.outcome,
      operation: null,
      error: null,
      outcomeConflict: false,
    };
  }
  if (action.type === 'EDIT_DETAILS' && state.status === 'details' && !state.operation) {
    return {
      ...state,
      details: { ...state.details, ...action.changes },
      error: null,
    };
  }
  if (action.type === 'SUBMIT_DETAILS' && state.status === 'details' && !state.operation) {
    return { ...state, operation: 'details', error: null };
  }
  if (
    action.type === 'DETAILS_OK'
    && state.status === 'details'
    && state.operation === 'details'
  ) {
    return {
      ...state,
      status: 'complete',
      canonicalCraving: action.canonicalCraving,
      outcome: action.canonicalCraving.outcome,
      operation: null,
      error: null,
      nicotinePending: action.canonicalCraving.outcome === 'used_nicotine',
      nicotineLinked: Boolean(action.canonicalCraving.linked_log_id),
      nicotineLinkUnknown: false,
    };
  }
  if (action.type === 'SKIP_DETAILS' && state.status === 'details' && !state.operation) {
    return {
      ...state,
      status: 'complete',
      operation: null,
      error: null,
      nicotinePending: state.outcome === 'used_nicotine',
      nicotineLinked: Boolean(state.canonicalCraving?.linked_log_id),
      nicotineLinkUnknown: false,
    };
  }
  if (
    action.type === 'QUICK_LOG_LINKED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
    && Number(action.canonicalCraving?.linked_log_id) > 0
  ) {
    return {
      ...state,
      canonicalCraving: action.canonicalCraving,
      nicotinePending: false,
      nicotineLinked: true,
      nicotineLinkUnknown: false,
      operation: null,
      error: null,
    };
  }
  if (
    action.type === 'QUICK_LOG_LINK_UNCONFIRMED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
  ) {
    return {
      ...state,
      nicotinePending: false,
      nicotineLinked: false,
      nicotineLinkUnknown: true,
      operation: null,
      error: null,
    };
  }
  if (
    action.type === 'QUICK_LOG_DELETED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
    && action.canonicalCraving?.id === state.canonicalCraving?.id
    && action.canonicalCraving.linked_log_id === null
  ) {
    return {
      ...state,
      canonicalCraving: action.canonicalCraving,
      nicotinePending: false,
      nicotineLinked: false,
      nicotineLinkUnknown: false,
    };
  }
  if (
    action.type === 'QUICK_LOG_UNLINK_UNCONFIRMED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
  ) {
    return {
      ...state,
      nicotinePending: false,
      nicotineLinked: false,
      nicotineLinkUnknown: true,
    };
  }
  if (
    action.type === 'QUICK_LOG_HANDOFF_STARTED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
  ) {
    return {
      ...state,
      nicotinePending: true,
      nicotineLinked: false,
      nicotineLinkUnknown: false,
    };
  }
  if (
    action.type === 'QUICK_LOG_HANDOFF_STOPPED'
    && state.status === 'complete'
    && action.cravingId === state.canonicalCraving?.id
  ) {
    return {
      ...state,
      nicotinePending: false,
      nicotineLinked: false,
      nicotineLinkUnknown: false,
    };
  }
  if (action.type === 'DONE' && state.status === 'complete') {
    return { status: 'closed' };
  }
  if (action.type === 'CLOSE' && state.status !== 'closed') {
    if (!state.canonicalCraving) return { status: 'closed' };
    return {
      ...state,
      status: 'closed',
      resumeStatus: state.status,
      operation: null,
    };
  }
  return state;
}

export function createCravingFlowController({
  view,
  timeline,
  clock = () => new Date(),
  uuid = () => crypto.randomUUID(),
  timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  csrfToken = '',
  fetchImpl = (...args) => fetch(...args),
  AbortControllerImpl = AbortController,
  quickLogController = null,
  smartDefault = null,
  visibility = typeof document !== 'undefined' ? document : null,
  setIntervalImpl = (callback, delay) => setInterval(callback, delay),
  clearIntervalImpl = (timer) => clearInterval(timer),
}) {
  let state = { status: 'closed' };
  let initialized = false;
  let createPayload = null;
  let outcomePayload = null;
  let detailsPayload = null;
  let pauseTimer = null;
  let quickLogUnsubscribe = null;
  let activeQuickLogAttemptId = null;
  let sourceTrigger = null;
  let requestGeneration = 0;
  let activeAbort = null;
  let lastPauseAnnouncement = null;

  function invalidateRequest() {
    requestGeneration += 1;
    const abortController = activeAbort;
    activeAbort = null;
    abortController?.abort();
  }

  function beginRequest() {
    invalidateRequest();
    const generation = requestGeneration;
    const abortController = new AbortControllerImpl();
    activeAbort = abortController;
    return { generation, abortController };
  }

  function requestIsCurrent(generation) {
    return initialized && generation === requestGeneration;
  }

  async function reconcileMutationToday(body, generation) {
    if (!requestIsCurrent(generation)) return false;
    if (body.today) {
      timeline.reconcileToday(body.today);
      return true;
    }
    const refreshUnavailable = Array.isArray(body.warnings) && body.warnings.some(
      (warning) => warning?.code === 'today_refresh_unavailable',
    );
    if (!refreshUnavailable) return false;
    try {
      const response = await fetchImpl('/api/today', {
        method: 'GET',
        credentials: 'same-origin',
        signal: activeAbort?.signal,
      });
      if (!requestIsCurrent(generation)) return false;
      const refreshed = await response.json();
      if (!requestIsCurrent(generation) || !response.ok || !refreshed.today) return false;
      timeline.reconcileToday(refreshed.today);
      return true;
    } catch (_) {
      return false;
    }
  }

  function stopPauseTimer() {
    if (pauseTimer === null) return;
    clearIntervalImpl(pauseTimer);
    pauseTimer = null;
  }

  function announcePause(remainingSeconds, start = false) {
    const remaining = Math.max(0, Number(remainingSeconds) || 0);
    if (remaining === lastPauseAnnouncement) return;
    let message = null;
    if (start && remaining === 180) message = 'Pause started. Three minutes remaining.';
    else if (remaining === 120) message = 'Two minutes remaining.';
    else if (remaining === 60) message = 'One minute remaining.';
    else if (remaining > 1 && remaining <= 10) message = `${remaining} seconds remaining.`;
    else if (remaining === 1) message = '1 second remaining.';
    else if (remaining === 0) message = 'Pause complete. Choose the outcome that fits.';
    if (!message) return;
    lastPauseAnnouncement = remaining;
    view.announce(message);
  }

  function tickPause() {
    if (state.status !== 'pause') return;
    state = cravingFlowReducer(state, { type: 'PAUSE_TICK', now: clock().getTime() });
    view.render(state);
    announcePause(state.remainingSeconds);
  }

  function onVisibilityChange() {
    if (!visibility?.hidden) tickPause();
  }

  function open(trigger) {
    if (state.status === 'complete') {
      sourceTrigger = trigger;
      view.open(state, trigger);
      view.render(state);
      return true;
    }
    if (state.status !== 'closed') return false;
    const resumeExisting = Boolean(state.canonicalCraving && state.resumeStatus);
    state = cravingFlowReducer(state, {
      type: 'OPEN',
      clientEventId: resumeExisting ? state.clientEventId : uuid(),
      occurredAtLocal: resumeExisting ? state.occurredAtLocal : toDateTimeLocal(clock()),
    });
    sourceTrigger = trigger;
    view.open(state, trigger, { fresh: !resumeExisting });
    view.render(state);
    if (state.error) view.showFailure(state.error);
    if (state.status === 'pause') {
      tickPause();
      pauseTimer = setIntervalImpl(tickPause, 1000);
    }
    return true;
  }

  function editCheckIn(changes) {
    state = cravingFlowReducer(state, { type: 'EDIT_CHECK_IN', changes });
    view.render(state);
    return state;
  }

  async function sendCreate(payload) {
    const { generation, abortController } = beginRequest();
    view.setBusy('create', true);
    try {
      const response = await fetchImpl('/api/cravings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
      if (!requestIsCurrent(generation)) return false;
      const body = await response.json();
      if (!requestIsCurrent(generation)) return false;
      if (!response.ok) throw body;
      state = cravingFlowReducer(state, {
        type: 'CREATE_OK', canonicalCraving: body.craving,
      });
      timeline.upsertCraving(body.craving);
      view.render(state);
      await reconcileMutationToday(body, generation);
      if (!requestIsCurrent(generation)) return false;
      return body;
    } catch (failure) {
      if (!requestIsCurrent(generation)) return false;
      const envelope = failure?.error;
      const error = {
        message: typeof envelope?.message === 'string'
          ? envelope.message
          : 'The craving was not saved yet. Your check-in is still here.',
        fieldErrors: envelope?.field_errors || {},
      };
      state = cravingFlowReducer(state, { type: 'CREATE_FAILED', error });
      timeline.markCravingFailed(state.clientEventId);
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    } finally {
      if (!requestIsCurrent(generation)) return;
      activeAbort = null;
      view.setBusy('create', false);
    }
  }

  async function submitCheckIn() {
    if (state.status !== 'check_in' || state.operation) return false;
    try {
      validateCravingCheckIn(state, clock());
    } catch (failure) {
      const error = { message: failure.message, fieldErrors: failure.fieldErrors };
      state = { ...state, error };
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    }
    state = cravingFlowReducer(state, { type: 'SUBMIT_CHECK_IN' });
    createPayload = buildCravingCreatePayload(state, timezone());
    timeline.insertPendingCraving(state, createPayload);
    return sendCreate(createPayload);
  }

  function retryCreate() {
    if (state.status !== 'check_in' || state.operation || !state.error || !createPayload) {
      return false;
    }
    state = cravingFlowReducer(state, { type: 'RETRY_CREATE' });
    timeline.insertPendingCraving(state, createPayload);
    return sendCreate(createPayload);
  }

  function chooseAction(action) {
    if (state.status !== 'action_choice') return false;
    state = cravingFlowReducer(state, {
      type: 'CHOOSE_ACTION', action, now: clock().getTime(),
    });
    if (state.status === 'pause') {
      stopPauseTimer();
      lastPauseAnnouncement = null;
      pauseTimer = setIntervalImpl(tickPause, 1000);
      announcePause(state.remainingSeconds, true);
    }
    view.render(state);
    return true;
  }

  function showOutcome() {
    if (state.status !== 'pause') return false;
    stopPauseTimer();
    state = cravingFlowReducer(state, { type: 'SHOW_OUTCOME' });
    view.render(state);
    return true;
  }

  function selectOutcome(outcome) {
    if (state.status !== 'outcome' || state.operation) return false;
    const next = cravingFlowReducer(state, { type: 'SELECT_OUTCOME', outcome });
    if (next === state) return false;
    state = next;
    view.render(state);
    return true;
  }

  async function sendOutcome(payload) {
    const cravingId = state.canonicalCraving.id;
    const { generation, abortController } = beginRequest();
    view.setBusy('outcome', true);
    try {
      const response = await fetchImpl(`/api/cravings/${cravingId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
      if (!requestIsCurrent(generation)) return false;
      const body = await response.json();
      if (!requestIsCurrent(generation)) return false;
      if (!response.ok) {
        if (
          response.status === 409
          && body?.error?.code === 'craving_outcome_conflict'
        ) {
          return await recoverOutcomeConflict(cravingId, generation);
        }
        throw body;
      }
      state = cravingFlowReducer(state, {
        type: 'OUTCOME_OK', canonicalCraving: body.craving,
      });
      timeline.upsertCraving(body.craving);
      view.render(state);
      await reconcileMutationToday(body, generation);
      if (!requestIsCurrent(generation)) return false;
      return body;
    } catch (failure) {
      if (!requestIsCurrent(generation)) return false;
      const envelope = failure?.error;
      const error = {
        message: typeof envelope?.message === 'string'
          ? envelope.message
          : 'The outcome was not saved yet. Your choice is still here.',
        fieldErrors: envelope?.field_errors || {},
      };
      state = { ...state, operation: null, error, outcomeConflict: false };
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    } finally {
      if (!requestIsCurrent(generation)) return;
      activeAbort = null;
      view.setBusy('outcome', false);
    }
  }

  function submitOutcome() {
    if (state.status !== 'outcome' || state.operation || state.outcomeConflict) return false;
    if (!OUTCOMES.has(state.outcome)) {
      const error = {
        message: 'Check the highlighted detail.',
        fieldErrors: { outcome: ['Choose the outcome that fits.'] },
      };
      state = { ...state, error };
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    }
    state = cravingFlowReducer(state, { type: 'SUBMIT_OUTCOME' });
    outcomePayload = { outcome: state.outcome };
    return sendOutcome(outcomePayload);
  }

  function retryOutcome() {
    if (
      state.status !== 'outcome'
      || state.operation
      || !state.error
      || state.error.canRetry === false
      || !outcomePayload
    ) {
      return false;
    }
    state = { ...state, operation: 'outcome', error: null };
    view.render(state);
    return sendOutcome(outcomePayload);
  }

  function skipDetails() {
    if (state.status !== 'details' || state.operation) return false;
    state = cravingFlowReducer(state, { type: 'SKIP_DETAILS' });
    view.render(state);
    if (state.outcome === 'used_nicotine') beginQuickLogHandoff();
    return true;
  }

  function cravingFromToday(today, cravingId) {
    const item = today?.timeline?.find(
      (candidate) => (
        candidate?.type === 'craving'
        && Number(candidate.id) === Number(cravingId)
        && Number(candidate.data?.id) === Number(cravingId)
      ),
    );
    return item?.data || null;
  }

  async function recoverOutcomeConflict(cravingId, generation) {
    const error = {
      message: 'This craving already has an outcome. Check Today for the saved result.',
      fieldErrors: {},
      canRetry: false,
    };
    outcomePayload = null;
    try {
      const response = await fetchImpl('/api/today', {
        method: 'GET',
        credentials: 'same-origin',
        signal: activeAbort?.signal,
      });
      if (!requestIsCurrent(generation)) return false;
      const body = await response.json();
      if (!requestIsCurrent(generation)) return false;
      const canonicalCraving = response.ok
        ? cravingFromToday(body.today, cravingId)
        : null;
      if (canonicalCraving && OUTCOMES.has(canonicalCraving.outcome)) {
        state = cravingFlowReducer(state, {
          type: 'OUTCOME_OK', canonicalCraving,
        });
        timeline.upsertCraving(canonicalCraving);
        timeline.reconcileToday(body.today);
        view.render(state);
        view.announce('This craving already had an outcome. Today’s saved outcome is shown.');
        return body;
      }
    } catch (_) {
      // The fixed guidance below is sufficient when canonical Today is unavailable.
    }
    if (!requestIsCurrent(generation)) return false;
    state = {
      ...state,
      operation: null,
      error,
      outcomeConflict: true,
    };
    view.showFailure(error);
    view.announce(error.message);
    view.render(state);
    return false;
  }

  function handleQuickLogCompletion(event) {
    if (
      !event
      || Number(event.cravingId) !== Number(state.canonicalCraving?.id)
      || state.status !== 'complete'
    ) {
      return false;
    }
    const canonicalCraving = cravingFromToday(event.today, event.cravingId);
    if (event.type === 'linked_log_handoff_started') {
      if (
        event.operation !== 'create'
        || typeof event.attemptId !== 'string'
        || !event.attemptId
      ) {
        return false;
      }
      activeQuickLogAttemptId = event.attemptId;
      state = cravingFlowReducer(state, {
        type: 'QUICK_LOG_HANDOFF_STARTED',
        cravingId: Number(event.cravingId),
      });
      view.render(state);
      return true;
    }
    if (event.type === 'linked_log_synced') {
      activeQuickLogAttemptId = null;
      if (Number(canonicalCraving?.linked_log_id) > 0) {
        state = cravingFlowReducer(state, {
          type: 'QUICK_LOG_LINKED',
          cravingId: Number(event.cravingId),
          canonicalCraving,
          log: event.log,
        });
        if (event.today?.timeline) timeline.reconcileTimeline(event.today.timeline);
        view.render(state);
        view.announce('Nicotine use linked');
        return true;
      }
      state = cravingFlowReducer(state, {
        type: 'QUICK_LOG_LINK_UNCONFIRMED',
        cravingId: Number(event.cravingId),
      });
      if (event.today?.timeline) timeline.reconcileTimeline(event.today.timeline);
      view.render(state);
      view.announce('Nicotine log saved. Link status will refresh later.');
      return true;
    }
    if (event.type === 'linked_log_deleted') {
      if (canonicalCraving?.linked_log_id === null) {
        state = cravingFlowReducer(state, {
          type: 'QUICK_LOG_DELETED',
          cravingId: Number(event.cravingId),
          canonicalCraving,
        });
      } else {
        state = cravingFlowReducer(state, {
          type: 'QUICK_LOG_UNLINK_UNCONFIRMED',
          cravingId: Number(event.cravingId),
        });
      }
      if (event.today?.timeline) timeline.reconcileTimeline(event.today.timeline);
      view.render(state);
      view.announce(
        canonicalCraving?.linked_log_id === null
          ? 'Nicotine log removed. The craving is still recorded.'
          : 'Nicotine log removed. Link status will refresh later.',
      );
      return true;
    }
    if (
      event.type === 'linked_log_handoff_closed'
      || event.type === 'linked_log_handoff_failed'
    ) {
      if (
        event.operation !== 'create'
        || typeof event.attemptId !== 'string'
        || event.attemptId !== activeQuickLogAttemptId
      ) {
        return false;
      }
      activeQuickLogAttemptId = null;
      state = cravingFlowReducer(state, {
        type: 'QUICK_LOG_HANDOFF_STOPPED',
        cravingId: Number(event.cravingId),
      });
      view.render(state);
      view.announce(
        event.type === 'linked_log_handoff_closed'
          ? 'Nicotine log not finished. You can try again when you’re ready.'
          : 'Nicotine log needs attention. Fix it there or try again.',
      );
      return true;
    }
    return false;
  }

  function beginQuickLogHandoff() {
    if (state.status !== 'complete' || state.outcome !== 'used_nicotine') return false;
    if (!quickLogController || !smartDefault) {
      state = { ...state, nicotinePending: false };
      view.showQuickLogUnavailable(
        'The craving is saved. Use the detailed nicotine log to link what happened.',
      );
      view.render(state);
      return false;
    }
    const opened = quickLogController.openLinkedCraving(
      smartDefault,
      state.canonicalCraving.id,
      sourceTrigger,
    );
    if (!opened) {
      activeQuickLogAttemptId = null;
      state = { ...state, nicotinePending: false };
      view.showQuickLogUnavailable(
        'Finish or discard the open nicotine draft, then try logging nicotine again.',
      );
      view.render(state);
      return false;
    }
    state = cravingFlowReducer(state, {
      type: 'QUICK_LOG_HANDOFF_STARTED',
      cravingId: state.canonicalCraving.id,
    });
    view.render(state);
    view.close();
    view.showQuickLogHandoff('Finish the nicotine log to link it to this craving.');
    return true;
  }

  function retryQuickLog() {
    return beginQuickLogHandoff();
  }

  function editDetails(changes) {
    if (state.status !== 'details' || state.operation) return false;
    state = cravingFlowReducer(state, { type: 'EDIT_DETAILS', changes });
    view.render(state);
    return true;
  }

  async function sendDetails(payload) {
    const cravingId = state.canonicalCraving.id;
    const { generation, abortController } = beginRequest();
    view.setBusy('details', true);
    try {
      const response = await fetchImpl(`/api/cravings/${cravingId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
      if (!requestIsCurrent(generation)) return false;
      const body = await response.json();
      if (!requestIsCurrent(generation)) return false;
      if (!response.ok) throw body;
      state = cravingFlowReducer(state, {
        type: 'DETAILS_OK', canonicalCraving: body.craving,
      });
      timeline.upsertCraving(body.craving);
      view.render(state);
      await reconcileMutationToday(body, generation);
      if (!requestIsCurrent(generation)) return false;
      if (state.outcome === 'used_nicotine') beginQuickLogHandoff();
      return body;
    } catch (failure) {
      if (!requestIsCurrent(generation)) return false;
      const envelope = failure?.error;
      const error = {
        message: typeof envelope?.message === 'string'
          ? envelope.message
          : 'The optional details were not saved yet. They are still here.',
        fieldErrors: envelope?.field_errors || {},
      };
      state = { ...state, operation: null, error };
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    } finally {
      if (!requestIsCurrent(generation)) return;
      activeAbort = null;
      view.setBusy('details', false);
    }
  }

  function saveDetails() {
    if (state.status !== 'details' || state.operation) return false;
    detailsPayload = buildCravingDetailsPayload(state.details);
    try {
      validateCravingDetailsPayload(detailsPayload);
    } catch (failure) {
      const error = { message: failure.message, fieldErrors: failure.fieldErrors };
      state = { ...state, error };
      view.showFailure(error);
      view.announce(error.message);
      view.render(state);
      return false;
    }
    if (Object.keys(detailsPayload).length === 0) return skipDetails();
    state = cravingFlowReducer(state, { type: 'SUBMIT_DETAILS' });
    return sendDetails(detailsPayload);
  }

  function retryDetails() {
    if (state.status !== 'details' || state.operation || !state.error || !detailsPayload) {
      return false;
    }
    state = { ...state, operation: 'details', error: null };
    view.render(state);
    return sendDetails(detailsPayload);
  }

  function done() {
    if (state.status !== 'complete') return false;
    state = cravingFlowReducer(state, { type: 'DONE' });
    view.close();
    view.returnFocus();
    return true;
  }

  function close() {
    if (state.status === 'closed') return false;
    const discardedClientEventId = state.canonicalCraving ? null : state.clientEventId;
    stopPauseTimer();
    invalidateRequest();
    view.setBusy('create', false);
    view.setBusy('outcome', false);
    view.setBusy('details', false);
    state = cravingFlowReducer(state, { type: 'CLOSE' });
    if (discardedClientEventId) timeline.removePendingCraving(discardedClientEventId);
    view.close();
    view.returnFocus();
    return true;
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    view.initialize({
      open, editCheckIn, submitCheckIn, retryCreate, chooseAction, showOutcome,
      selectOutcome, submitOutcome, retryOutcome, editDetails, saveDetails,
      retryDetails, skipDetails, retryQuickLog, close, done,
    });
    if (quickLogController?.subscribeCompletion) {
      quickLogUnsubscribe = quickLogController.subscribeCompletion(handleQuickLogCompletion);
    }
    visibility?.addEventListener?.('visibilitychange', onVisibilityChange);
  }

  function cleanup() {
    if (!initialized) return;
    initialized = false;
    stopPauseTimer();
    visibility?.removeEventListener?.('visibilitychange', onVisibilityChange);
    if (quickLogUnsubscribe) quickLogUnsubscribe();
    quickLogUnsubscribe = null;
    activeQuickLogAttemptId = null;
    invalidateRequest();
    view.cleanup();
  }

  return {
    initialize,
    cleanup,
    open,
    editCheckIn,
    submitCheckIn,
    retryCreate,
    chooseAction,
    showOutcome,
    selectOutcome,
    submitOutcome,
    retryOutcome,
    editDetails,
    saveDetails,
    retryDetails,
    skipDetails,
    retryQuickLog,
    done,
    close,
    getState: () => state,
  };
}

export function createCravingFlowDomView(root, dialog) {
  const liveRegion = root.querySelector('[data-craving-live]');
  const checkInForm = dialog.querySelector('[data-craving-check-in-form]');
  const outcomeForm = dialog.querySelector('[data-craving-outcome-form]');
  const detailsForm = dialog.querySelector('[data-craving-details-form]');
  const timer = dialog.querySelector('[data-craving-time]');
  const timerCopy = dialog.querySelector('[data-craving-timer-copy]');
  const linkStatus = dialog.querySelector('[data-craving-link-status]');
  const retryQuickLog = dialog.querySelector('[data-craving-retry-quick-log]');
  const detailedLog = dialog.querySelector('[data-craving-detailed-log]');
  let handlers = null;
  let sourceTrigger = null;
  let bound = false;
  let lastStatus = null;
  let removeFocusTrap = null;

  function activeStep() {
    return dialog.querySelector('[data-craving-step]:not([hidden])');
  }

  function clearErrors() {
    for (const region of dialog.querySelectorAll('[data-craving-error]')) {
      region.hidden = true;
      region.textContent = '';
    }
    for (const region of dialog.querySelectorAll('[data-craving-request-error]')) {
      region.hidden = true;
      region.textContent = '';
    }
    for (const control of dialog.querySelectorAll('[data-craving-field], [data-craving-detail-field]')) {
      control.removeAttribute('aria-invalid');
    }
  }

  function focusStep(step) {
    const target = step?.querySelector('[data-craving-step-focus]');
    target?.focus();
  }

  function render(state) {
    if (state.status === 'closed') return;
    if (!state.error) clearErrors();
    const statusChanged = lastStatus !== state.status;
    lastStatus = state.status;
    for (const step of dialog.querySelectorAll('[data-craving-step]')) {
      step.hidden = step.dataset.cravingStep !== state.status;
    }
    const step = activeStep();

    if (state.status === 'check_in') {
      const checked = dialog.querySelector(`[name="intensity"][value="${state.intensity}"]`);
      if (checked) checked.checked = true;
      const trigger = dialog.querySelector('[data-craving-field="trigger"]');
      if (trigger && trigger.value !== state.trigger) trigger.value = state.trigger || '';
      const create = dialog.querySelector('[data-craving-create]');
      const retry = dialog.querySelector('[data-craving-retry-create]');
      const recoverable = Boolean(state.error);
      create.hidden = recoverable;
      retry.hidden = !recoverable;
    }

    if (state.status === 'pause') {
      const remaining = Math.max(0, Number(state.remainingSeconds) || 0);
      const minutes = Math.floor(remaining / 60);
      const seconds = String(remaining % 60).padStart(2, '0');
      timer.textContent = `${minutes}:${seconds}`;
      timer.dateTime = `PT${remaining}S`;
      timerCopy.textContent = remaining === 0 ? 'Pause complete' : 'Pause in progress';
      dialog.querySelector('[data-craving-timer]')?.classList.toggle(
        'craving-flow__timer--complete',
        remaining === 0,
      );
    }

    if (state.status === 'outcome') {
      const checked = dialog.querySelector(`[name="outcome"][value="${state.outcome}"]`);
      if (checked) checked.checked = true;
      for (const control of dialog.querySelectorAll('[name="outcome"]')) {
        control.disabled = Boolean(state.outcomeConflict);
      }
      dialog.querySelector('[data-craving-save-outcome]').hidden = Boolean(state.error);
      dialog.querySelector('[data-craving-retry-outcome]').hidden = (
        !state.error || state.error.canRetry === false
      );
    }

    if (state.status === 'details') {
      dialog.querySelector('[data-craving-save-details]').hidden = Boolean(state.error);
      dialog.querySelector('[data-craving-retry-details]').hidden = !state.error;
    }

    if (state.status === 'complete') {
      const title = dialog.querySelector('[data-craving-complete-title]');
      const copy = dialog.querySelector('[data-craving-complete-copy]');
      const outcomeCopy = {
        resisted: 'You recorded that you resisted it.',
        used_alternative: 'You recorded that you used an alternative.',
        used_nicotine: 'The craving is recorded. Link the nicotine log when it is ready.',
      };
      title.textContent = 'Your craving is saved';
      copy.textContent = outcomeCopy[state.outcome] || 'You can return to Today whenever you are ready.';
      const needsNicotine = state.outcome === 'used_nicotine' && !state.nicotineLinked;
      const linkUnknown = Boolean(state.nicotineLinkUnknown);
      retryQuickLog.hidden = !needsNicotine || state.nicotinePending || linkUnknown;
      detailedLog.hidden = !needsNicotine || linkUnknown;
      linkStatus.hidden = !state.nicotineLinked && !state.nicotinePending && !linkUnknown;
      linkStatus.textContent = state.nicotineLinked
        ? 'Nicotine use linked'
        : state.nicotinePending
          ? 'Finish the nicotine log to link it.'
          : linkUnknown ? 'Nicotine log saved. Link status will refresh later.' : '';
    }

    if (statusChanged && dialog.open) focusStep(step);
  }

  function resetFreshControls() {
    checkInForm?.reset();
    outcomeForm?.reset();
    detailsForm?.reset();
    dialog.querySelector('[data-craving-details]')?.removeAttribute('open');
    linkStatus.hidden = true;
    linkStatus.textContent = '';
    retryQuickLog.hidden = true;
    detailedLog.hidden = true;
    lastStatus = null;
  }

  function open(state, trigger, { fresh = false } = {}) {
    sourceTrigger = trigger || sourceTrigger;
    if (fresh) resetFreshControls();
    clearErrors();
    if (!dialog.open) dialog.showModal();
    render(state);
    focusStep(activeStep());
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function returnFocus() {
    const trigger = sourceTrigger;
    sourceTrigger = null;
    return restoreDialogFocus(dialog, trigger);
  }

  function setBusy(operation, value) {
    const form = operation === 'create'
      ? checkInForm
      : operation === 'outcome' ? outcomeForm : detailsForm;
    form?.setAttribute('aria-busy', value ? 'true' : 'false');
    for (const button of form?.querySelectorAll('button') || []) button.disabled = value;
  }

  function announce(message) {
    liveRegion.textContent = '';
    liveRegion.textContent = message;
  }

  function showFailure(error) {
    clearErrors();
    const step = activeStep();
    const requestError = step?.querySelector('[data-craving-request-error]');
    if (requestError) {
      requestError.hidden = false;
      requestError.textContent = error.message;
    }
    let firstInvalid = null;
    for (const [name, messages] of Object.entries(error.fieldErrors || {})) {
      const region = step?.querySelector(`[data-craving-error="${name}"]`);
      const control = step?.querySelector(`[name="${name}"]`);
      if (!region) continue;
      region.textContent = Array.isArray(messages) ? messages.join(' ') : String(messages);
      region.hidden = false;
      if (control) {
        control.setAttribute('aria-invalid', 'true');
        if (!firstInvalid) firstInvalid = control;
      }
    }
    (firstInvalid || requestError)?.focus?.();
  }

  function showQuickLogHandoff(message) {
    linkStatus.hidden = false;
    linkStatus.textContent = message;
  }

  function showQuickLogUnavailable(message) {
    linkStatus.hidden = false;
    linkStatus.textContent = message;
    retryQuickLog.hidden = false;
    detailedLog.hidden = false;
  }

  function detailChangeFor(control) {
    if (control.name === 'physical_symptoms') {
      return {
        physical_symptoms: [...detailsForm.querySelectorAll(
          '[name="physical_symptoms"]:checked',
        )].map((item) => item.value),
      };
    }
    return { [control.name]: control.value };
  }

  function onClick(event) {
    const trigger = event.target.closest('[data-today-action="craving"]');
    if (trigger && root.contains(trigger)) {
      event.preventDefault();
      handlers.open(trigger);
      return;
    }
    if (event.target.closest('[data-craving-close]')) handlers.close();
    else if (event.target.closest('[data-craving-cancel-check-in]')) handlers.close();
    else if (event.target.closest('[data-craving-retry-create]')) handlers.retryCreate();
    else if (event.target.closest('[data-craving-show-outcome]')) handlers.showOutcome();
    else if (event.target.closest('[data-craving-retry-outcome]')) handlers.retryOutcome();
    else if (event.target.closest('[data-craving-retry-details]')) handlers.retryDetails();
    else if (event.target.closest('[data-craving-skip-details]')) handlers.skipDetails();
    else if (event.target.closest('[data-craving-retry-quick-log]')) handlers.retryQuickLog();
    else if (event.target.closest('[data-craving-done]')) handlers.done();
    else {
      const choice = event.target.closest('[data-craving-action-choice]');
      if (choice) handlers.chooseAction(choice.dataset.cravingActionChoice);
    }
  }

  function onSubmit(event) {
    if (event.target === checkInForm) {
      event.preventDefault();
      handlers.submitCheckIn();
    } else if (event.target === outcomeForm) {
      event.preventDefault();
      handlers.submitOutcome();
    } else if (event.target === detailsForm) {
      event.preventDefault();
      handlers.saveDetails();
    }
  }

  function onInput(event) {
    const control = event.target;
    if (control.matches('[data-craving-field="trigger"]')) {
      handlers.editCheckIn({ trigger: control.value });
    } else if (control.matches('[data-craving-detail-field]')) {
      handlers.editDetails(detailChangeFor(control));
    }
  }

  function onChange(event) {
    const control = event.target;
    if (control.matches('[data-craving-field="intensity"]')) {
      handlers.editCheckIn({ intensity: Number(control.value) });
    } else if (control.matches('[data-craving-field="outcome"]')) {
      handlers.selectOutcome(control.value);
    } else if (control.matches('[data-craving-detail-field]')) {
      handlers.editDetails(detailChangeFor(control));
    }
  }

  function onCancel(event) {
    if (event.target !== dialog) return;
    event.preventDefault();
    handlers.close();
  }

  function initialize(nextHandlers) {
    if (bound) return;
    bound = true;
    handlers = nextHandlers;
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('cancel', onCancel, true);
    removeFocusTrap = installDialogFocusTrap(dialog);
  }

  function cleanup() {
    if (!bound) return;
    bound = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('cancel', onCancel, true);
    removeFocusTrap?.();
    removeFocusTrap = null;
  }

  return {
    initialize,
    cleanup,
    open,
    close,
    returnFocus,
    render,
    setBusy,
    announce,
    showFailure,
    showQuickLogHandoff,
    showQuickLogUnavailable,
  };
}

export function bootstrapCravingFlow(documentRef = document) {
  const root = documentRef.querySelector('[data-today-root]');
  const dialog = root?.querySelector('[data-craving-flow-dialog]');
  if (!root || !dialog) return null;
  let controller = null;
  try {
    controller = ensureCravingFlowController(root, () => {
      const timeline = createTimelineDomAdapter(root);
      if (!timeline) return null;
      const logTrigger = root.querySelector('[data-today-action="log-nicotine"]');
      const pouchId = Number(logTrigger?.dataset.smartDefaultPouchId);
      const smartDefault = Number.isInteger(pouchId) && pouchId > 0
        ? {
          pouchId,
          brand: logTrigger.dataset.smartDefaultBrand,
          nicotineMg: logTrigger.dataset.smartDefaultStrength,
        }
        : null;
      const view = createCravingFlowDomView(root, dialog);
      const quickLogController = bootstrapQuickLog(documentRef);
      const csrfToken = documentRef.querySelector('meta[name="csrf-token"]')?.content || '';
      return createCravingFlowController({
        view,
        timeline,
        quickLogController,
        smartDefault,
        csrfToken,
        visibility: documentRef,
      });
    });
    if (!controller) return null;
    controller.initialize();
    const slot = root.querySelector('[data-craving-action-slot]');
    activateActionEnhancement(
      slot,
      (event) => controller.open(event.currentTarget),
    );
    return controller;
  } catch (error) {
    rollbackCravingFlowController(root, controller);
    console.error(
      'Craving support enhancement is unavailable; the standard craving link remains active.',
      error,
    );
    return null;
  }
}

if (typeof document !== 'undefined') bootstrapCravingFlow(document);
