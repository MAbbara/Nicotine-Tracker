import {
  createTimelineDomAdapter,
  TODAY_CANONICAL_CHECK_IN_EVENT,
} from './timeline.js';


const PUBLIC_FIELDS = ['mood', 'confidence', 'reflection', 'context'];
const CANONICAL_FIELDS = ['id', 'local_date', ...PUBLIC_FIELDS];


export function maybeCueCheckIn(root, { reducedMotion = false, storage = {} } = {}) {
  const action = root?.matches?.('[data-check-in-action]')
    ? root
    : root?.querySelector?.('[data-check-in-action]');
  const offer = action?.closest?.('[data-check-in-offer]');
  if (
    !action
    || reducedMotion
    || storage.shown
    || action.disabled
    || offer?.hidden
  ) {
    return false;
  }
  storage.shown = true;
  action.dataset.attentionCue = 'active';
  return true;
}


function setupCheckInAttentionCue(section) {
  const action = section.querySelector('[data-check-in-action]');
  const offer = action?.closest?.('[data-check-in-offer]');
  const windowRef = section.ownerDocument?.defaultView;
  const reducedMotionQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const Observer = windowRef?.IntersectionObserver;
  if (!action || offer?.hidden || reducedMotionQuery?.matches || typeof Observer !== 'function') {
    return () => {};
  }

  const storage = { shown: false };
  const setTimeoutImpl = windowRef.setTimeout.bind(windowRef);
  const clearTimeoutImpl = windowRef.clearTimeout.bind(windowRef);
  let clearTimer = null;
  let observer = null;

  function clearCue(event) {
    if (event?.target && event.target !== action) return;
    if (event?.animationName && event.animationName !== 'check-in-attention') return;
    delete action.dataset.attentionCue;
    action.removeEventListener('animationend', clearCue);
    action.removeEventListener('animationcancel', clearCue);
    if (clearTimer !== null) clearTimeoutImpl(clearTimer);
    clearTimer = null;
  }

  observer = new Observer((entries) => {
    if (!entries.some((entry) => entry.target === action && entry.isIntersecting)) return;
    action.addEventListener('animationend', clearCue);
    action.addEventListener('animationcancel', clearCue);
    if (!maybeCueCheckIn(section, {
      reducedMotion: Boolean(reducedMotionQuery?.matches),
      storage,
    })) {
      action.removeEventListener('animationend', clearCue);
      action.removeEventListener('animationcancel', clearCue);
      return;
    }
    observer.disconnect();
    clearTimer = setTimeoutImpl(clearCue, 600);
  });
  observer.observe(action);

  return () => {
    observer?.disconnect();
    clearCue();
  };
}


export class CheckInValidationError extends Error {
  constructor(fieldErrors) {
    super('Check the highlighted details.');
    this.name = 'CheckInValidationError';
    this.fieldErrors = fieldErrors;
  }
}


function normalizedRating(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}


function normalizedText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}


export function buildCheckInPayload(draft = {}) {
  return {
    mood: normalizedRating(draft.mood),
    confidence: normalizedRating(draft.confidence),
    reflection: normalizedText(draft.reflection),
    context: normalizedText(draft.context),
  };
}


export function validateCheckInDraft(draft = {}) {
  const payload = buildCheckInPayload(draft);
  const fieldErrors = {};
  for (const field of ['mood', 'confidence']) {
    const value = payload[field];
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) {
      fieldErrors[field] = ['Choose a rating from 1 to 5, or leave it blank.'];
    }
  }
  for (const field of ['reflection', 'context']) {
    if (payload[field] !== null && payload[field].length > 2000) {
      fieldErrors[field] = ['Enter up to 2,000 characters, or leave it blank.'];
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CheckInValidationError(fieldErrors);
  }
  return payload;
}


function draftFromCanonical(value) {
  return {
    mood: value?.mood == null ? '' : String(value.mood),
    confidence: value?.confidence == null ? '' : String(value.confidence),
    reflection: value?.reflection || '',
    context: value?.context || '',
  };
}


export function checkInReducer(state, action) {
  if (action.type === 'OPEN' && ['offered', 'saved'].includes(state.status)) {
    return {
      ...state,
      status: 'editing',
      draft: draftFromCanonical(state.canonical),
      error: null,
    };
  }
  if (action.type === 'CHANGE' && ['editing', 'failed'].includes(state.status)) {
    return {
      ...state,
      status: 'editing',
      draft: { ...state.draft, ...action.changes },
      error: null,
    };
  }
  if (action.type === 'SUBMIT' && ['editing', 'failed'].includes(state.status)) {
    return { ...state, status: 'saving', error: null };
  }
  if (action.type === 'SAVE_OK' && state.status === 'saving') {
    return {
      status: 'saved',
      canonical: action.canonical,
      localDate: action.canonical.local_date,
      draft: null,
      error: null,
    };
  }
  if (action.type === 'SAVE_FAILED' && state.status === 'saving') {
    return { ...state, status: 'failed', error: action.error };
  }
  if (action.type === 'RETRY' && state.status === 'failed') {
    return { ...state, status: 'editing', error: null };
  }
  if (action.type === 'CANCEL' && ['editing', 'failed'].includes(state.status)) {
    return {
      ...state,
      status: state.canonical ? 'saved' : 'offered',
      draft: null,
      error: null,
    };
  }
  return state;
}


function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}


function canonicalCheckIn(value) {
  if (!exactKeys(value, CANONICAL_FIELDS)) throw new Error('invalid check-in response');
  if (!Number.isInteger(value.id) || value.id <= 0) throw new Error('invalid check-in response');
  if (typeof value.local_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.local_date)) {
    throw new Error('invalid check-in response');
  }
  for (const field of ['mood', 'confidence']) {
    if (
      value[field] !== null
      && (!Number.isInteger(value[field]) || value[field] < 1 || value[field] > 5)
    ) {
      throw new Error('invalid check-in response');
    }
  }
  for (const field of ['reflection', 'context']) {
    if (value[field] !== null && (typeof value[field] !== 'string' || value[field].length > 2000)) {
      throw new Error('invalid check-in response');
    }
  }
  return { ...value };
}


function successfulEnvelope(value) {
  if (!exactKeys(value, ['check_in', 'today', 'warnings'])) {
    throw new Error('invalid check-in response');
  }
  if (value.today !== null && (!value.today || typeof value.today !== 'object')) {
    throw new Error('invalid check-in response');
  }
  if (!Array.isArray(value.warnings)) throw new Error('invalid check-in response');
  return {
    checkIn: canonicalCheckIn(value.check_in),
    today: value.today,
    warnings: value.warnings,
  };
}


function normalizedFailure(body) {
  const source = body?.error?.field_errors;
  const fieldErrors = {};
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const field of PUBLIC_FIELDS) {
      if (!Array.isArray(source[field])) continue;
      fieldErrors[field] = source[field]
        .filter((message) => typeof message === 'string')
        .slice(0, 3);
    }
  }
  return {
    message: 'We could not save your reflection. Try again.',
    fieldErrors,
  };
}


export function createCheckInController({
  view,
  timeline,
  initialCanonical = null,
  initialLocalDate = initialCanonical?.local_date || null,
  csrfToken = '',
  fetchImpl = (...args) => fetch(...args),
  AbortControllerImpl = AbortController,
}) {
  let state = {
    status: initialCanonical ? 'saved' : 'offered',
    canonical: initialCanonical,
    localDate: initialLocalDate,
    draft: null,
    error: null,
  };
  let initialized = false;
  let requestPromise = null;
  let activeAbort = null;
  let lifecycleGeneration = 0;
  let deferredCanonicalToday = null;
  let latestTodayGeneratedAt = null;

  function sameCanonical(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return CANONICAL_FIELDS.every((field) => left[field] === right[field]);
  }

  function normalizedCanonicalToday(today) {
    if (!today || typeof today !== 'object' || Array.isArray(today)) return null;
    if (typeof today.local_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today.local_date)) {
      return null;
    }
    if (typeof today.check_in_eligible !== 'boolean') return null;
    let checkIn = null;
    try {
      checkIn = today.check_in === null ? null : canonicalCheckIn(today.check_in);
    } catch (_) {
      return null;
    }
    if (checkIn && checkIn.local_date !== today.local_date) return null;
    let generatedAt = null;
    if (typeof today.generated_at === 'string') {
      const instant = Date.parse(today.generated_at);
      if (!Number.isNaN(instant)) generatedAt = instant;
    }
    return {
      localDate: today.local_date,
      checkIn,
      eligible: today.check_in_eligible,
      generatedAt,
    };
  }

  function applyCanonicalToday(adoption) {
    const preservingDraft = ['editing', 'failed'].includes(state.status);
    const previousCanonical = state.canonical;
    if (preservingDraft) {
      state = {
        ...state,
        canonical: adoption.checkIn,
        localDate: adoption.localDate,
      };
      return true;
    }
    state = {
      status: adoption.checkIn ? 'saved' : 'offered',
      canonical: adoption.checkIn,
      localDate: adoption.localDate,
      draft: null,
      error: null,
    };
    if (adoption.checkIn) {
      if (!sameCanonical(previousCanonical, adoption.checkIn)) {
        view.showSummary(adoption.checkIn);
      }
    } else if (previousCanonical || state.status === 'offered') {
      view.showOffer();
    }
    view.showRefreshUnavailable(false);
    return true;
  }

  function adoptCanonicalToday(today) {
    const adoption = normalizedCanonicalToday(today);
    if (!adoption) return false;
    if (
      adoption.generatedAt !== null
      && latestTodayGeneratedAt !== null
      && adoption.generatedAt < latestTodayGeneratedAt
    ) {
      return false;
    }
    if (adoption.generatedAt !== null) latestTodayGeneratedAt = adoption.generatedAt;
    if (state.status === 'saving') {
      deferredCanonicalToday = adoption;
      return true;
    }
    return applyCanonicalToday(adoption);
  }

  function open() {
    state = checkInReducer(state, { type: 'OPEN' });
    if (state.status === 'editing') {
      view.showEditing(
        state.draft,
        state.canonical ? 'Update reflection' : 'Save reflection',
      );
    }
    return state;
  }

  function change(changes) {
    state = checkInReducer(state, { type: 'CHANGE', changes });
    return state;
  }

  function cancel() {
    state = checkInReducer(state, { type: 'CANCEL' });
    if (state.canonical) view.showSummary(state.canonical);
    else view.showOffer();
    return state;
  }

  function submit() {
    if (requestPromise) return requestPromise;
    if (!['editing', 'failed'].includes(state.status)) return Promise.resolve(false);
    let payload;
    try {
      payload = validateCheckInDraft(state.draft);
    } catch (error) {
      if (error instanceof CheckInValidationError) {
        view.showFieldErrors(error.fieldErrors);
        return Promise.resolve(false);
      }
      throw error;
    }

    state = checkInReducer(state, { type: 'SUBMIT' });
    view.setBusy(true);
    const generation = lifecycleGeneration;
    activeAbort = new AbortControllerImpl();
    requestPromise = (async () => {
      try {
        const response = await fetchImpl('/api/check-ins', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
          },
          body: JSON.stringify(payload),
          signal: activeAbort.signal,
        });
        let body;
        try {
          body = await response.json();
        } catch (_) {
          body = null;
        }
        if (!response.ok) throw normalizedFailure(body);
        const envelope = successfulEnvelope(body);
        if (generation !== lifecycleGeneration) return false;
        state = checkInReducer(state, {
          type: 'SAVE_OK',
          canonical: envelope.checkIn,
        });
        deferredCanonicalToday = null;
        view.setBusy(false);
        view.showSummary(envelope.checkIn);
        let refreshUnavailable = envelope.today === null
          && envelope.warnings.some(
            (warning) => warning?.code === 'today_refresh_unavailable'
              && warning.retryable === true,
          );
        if (envelope.today) {
          try {
            timeline.reconcileToday(envelope.today);
          } catch (_) {
            refreshUnavailable = true;
          }
        }
        view.showRefreshUnavailable(refreshUnavailable);
        view.announce('Reflection saved.');
        return true;
      } catch (failure) {
        if (generation !== lifecycleGeneration || failure?.name === 'AbortError') {
          return false;
        }
        const error = failure?.message === 'We could not save your reflection. Try again.'
          ? failure
          : normalizedFailure(null);
        state = checkInReducer(state, { type: 'SAVE_FAILED', error });
        if (deferredCanonicalToday) {
          const adoption = deferredCanonicalToday;
          deferredCanonicalToday = null;
          applyCanonicalToday(adoption);
        }
        view.setBusy(false);
        if (Object.keys(error.fieldErrors || {}).length > 0) {
          view.showFieldErrors(error.fieldErrors);
        }
        view.showFailure(error);
        return false;
      } finally {
        if (generation === lifecycleGeneration) {
          requestPromise = null;
          activeAbort = null;
        }
      }
    })();
    return requestPromise;
  }

  function retry() {
    if (state.status !== 'failed') return Promise.resolve(false);
    state = checkInReducer(state, { type: 'RETRY' });
    return submit();
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    view.initialize({
      open, change, cancel, submit, retry, adoptCanonicalToday,
    });
  }

  function cleanup() {
    lifecycleGeneration += 1;
    activeAbort?.abort();
    activeAbort = null;
    requestPromise = null;
    deferredCanonicalToday = null;
    latestTodayGeneratedAt = null;
    view.cleanup();
    initialized = false;
  }

  return {
    initialize,
    cleanup,
    open,
    change,
    cancel,
    submit,
    retry,
    adoptCanonicalToday,
    getState: () => state,
  };
}


function readInitialCanonical(section) {
  const script = section.querySelector('[data-check-in-canonical]');
  if (!script) return null;
  try {
    const value = JSON.parse(script.textContent || 'null');
    return value === null ? null : canonicalCheckIn(value);
  } catch (_) {
    return null;
  }
}


export function createCheckInDomView(section) {
  const form = section.querySelector('[data-check-in-form]');
  const summary = section.querySelector('[data-check-in-summary]');
  const offer = section.querySelector('[data-check-in-offer]');
  const status = section.querySelector('[data-check-in-status]');
  const requestError = section.querySelector('[data-check-in-request-error]');
  const retryButton = section.querySelector('[data-check-in-retry]');
  const submitButton = section.querySelector('[data-check-in-submit]');
  const cancelButton = section.querySelector('[data-check-in-cancel]');
  const refreshMessage = section.querySelector('[data-check-in-refresh-unavailable]');
  const listeners = [];
  let attentionCleanup = () => {};

  function listen(element, event, handler) {
    if (!element) return;
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }

  function clearErrors() {
    requestError.hidden = true;
    retryButton.hidden = true;
    for (const field of PUBLIC_FIELDS) {
      const control = form.elements[field];
      const error = section.querySelector(`[data-check-in-field-error="${field}"]`);
      if (error) {
        error.hidden = true;
        error.textContent = '';
      }
      if (control instanceof RadioNodeList) {
        for (const input of control) input.removeAttribute('aria-invalid');
      } else {
        control?.removeAttribute('aria-invalid');
      }
    }
  }

  function draftFromForm() {
    return {
      mood: form.elements.mood.value,
      confidence: form.elements.confidence.value,
      reflection: form.elements.reflection.value,
      context: form.elements.context.value,
    };
  }

  function setRating(name, value) {
    for (const input of form.querySelectorAll(`[name="${name}"]`)) {
      input.checked = value !== '' && input.value === value;
    }
  }

  function showEditing(draft, actionLabel) {
    clearErrors();
    summary.hidden = true;
    offer.hidden = true;
    form.hidden = false;
    setRating('mood', draft.mood);
    setRating('confidence', draft.confidence);
    form.elements.reflection.value = draft.reflection;
    form.elements.context.value = draft.context;
    submitButton.textContent = actionLabel;
    cancelButton.textContent = actionLabel === 'Update reflection'
      ? 'Keep saved reflection'
      : 'Not now';
    const first = form.querySelector('[name="mood"]:checked, [name="mood"]');
    first?.focus();
  }

  function showOffer() {
    clearErrors();
    form.hidden = true;
    summary.hidden = true;
    offer.hidden = false;
    cancelButton.textContent = 'Not now';
  }

  function showSummary(value) {
    clearErrors();
    form.hidden = true;
    offer.hidden = true;
    summary.hidden = false;
    cancelButton.textContent = 'Keep saved reflection';
    section.querySelector('[data-check-in-summary-mood]').textContent = value.mood == null
      ? 'Mood not recorded'
      : `Mood ${value.mood} of 5`;
    section.querySelector('[data-check-in-summary-confidence]').textContent = value.confidence == null
      ? 'Confidence not recorded'
      : `Confidence ${value.confidence} of 5`;
    const reflection = section.querySelector('[data-check-in-summary-reflection]');
    reflection.hidden = value.reflection === null;
    reflection.textContent = value.reflection || '';
    const context = section.querySelector('[data-check-in-summary-context]');
    context.hidden = value.context === null;
    context.textContent = value.context ? `Context: ${value.context}` : '';
    const empty = section.querySelector('[data-check-in-summary-empty]');
    empty.hidden = Boolean(value.reflection || value.context);
  }

  function setBusy(busy) {
    for (const control of form.elements) control.disabled = busy;
    status.textContent = busy ? 'Saving reflection…' : '';
    section.dataset.checkInBusy = busy ? 'true' : 'false';
  }

  function showFieldErrors(fieldErrors) {
    clearErrors();
    for (const [field, messages] of Object.entries(fieldErrors)) {
      const control = form.elements[field];
      const error = section.querySelector(`[data-check-in-field-error="${field}"]`);
      if (!control || !error) continue;
      error.textContent = messages[0] || 'Check this field.';
      error.hidden = false;
      if (control instanceof RadioNodeList) {
        for (const input of control) input.setAttribute('aria-invalid', 'true');
      } else {
        control.setAttribute('aria-invalid', 'true');
      }
    }
  }

  function showFailure(error) {
    requestError.textContent = error.message;
    requestError.hidden = false;
    retryButton.hidden = false;
    form.hidden = false;
    status.textContent = error.message;
  }

  function showRefreshUnavailable(value) {
    refreshMessage.hidden = !value;
  }

  return {
    initialize(handlers) {
      listen(section.querySelector('[data-check-in-open]'), 'click', handlers.open);
      listen(section.querySelector('[data-check-in-edit]'), 'click', handlers.open);
      listen(section.querySelector('[data-check-in-cancel]'), 'click', handlers.cancel);
      listen(retryButton, 'click', handlers.retry);
      listen(
        section.closest('[data-today-root]'),
        TODAY_CANONICAL_CHECK_IN_EVENT,
        (event) => handlers.adoptCanonicalToday(event.detail),
      );
      for (const button of section.querySelectorAll('[data-check-in-clear-rating]')) {
        listen(button, 'click', () => {
          const name = button.dataset.checkInClearRating;
          if (!['mood', 'confidence'].includes(name)) return;
          for (const input of form.querySelectorAll(`[name="${name}"]`)) {
            input.checked = false;
          }
          handlers.change(draftFromForm());
        });
      }
      listen(form, 'input', () => handlers.change(draftFromForm()));
      listen(form, 'change', () => handlers.change(draftFromForm()));
      listen(form, 'submit', (event) => {
        event.preventDefault();
        handlers.submit();
      });
      attentionCleanup = setupCheckInAttentionCue(section);
    },
    cleanup() {
      attentionCleanup();
      attentionCleanup = () => {};
      while (listeners.length > 0) listeners.pop()();
    },
    showEditing,
    showOffer,
    showSummary,
    setBusy,
    showFieldErrors,
    showFailure,
    showRefreshUnavailable,
    announce(message) { status.textContent = message; },
  };
}


export function bootstrapCheckIn(root = document) {
  const section = root.querySelector('[data-check-in-root]');
  if (!section) return null;
  const todayRoot = section.closest('[data-today-root]') || root;
  const timeline = createTimelineDomAdapter(todayRoot);
  if (!timeline) return null;
  const controller = createCheckInController({
    view: createCheckInDomView(section),
    timeline,
    initialCanonical: readInitialCanonical(section),
    initialLocalDate: section.dataset.checkInLocalDate || null,
    csrfToken: root.querySelector('meta[name="csrf-token"]')?.content || '',
  });
  controller.initialize();
  return controller;
}


if (typeof document !== 'undefined') {
  const start = () => bootstrapCheckIn(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
