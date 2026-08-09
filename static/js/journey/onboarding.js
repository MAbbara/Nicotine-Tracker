const STEPS = Object.freeze(['intention', 'baseline', 'pace', 'support', 'review']);
const DURATIONS = Object.freeze({ gentle: 77, steady: 49, focused: 28 });
const INTENTION_LABELS = Object.freeze({
  reduce: 'Reduce steadily',
  quit_by_date: 'Quit by a date',
  observe: 'Understand my baseline first',
});
const BASELINE_LABELS = Object.freeze({
  manual: 'Manual entry',
  recent_logs: 'Recent logs',
  observe: 'Seven-day observation',
});
const PLAN_FIELDS = new Set([
  'intention', 'baseline_source', 'baseline_mg',
  'baseline_mg_per_pouch', 'pace', 'end_target_mg',
  'target_date', 'start_date',
]);

function canonicalDecimal(value) {
  const source = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(source);
  if (!match) return source;
  const fraction = match[2] || '';
  let centsValue = BigInt(match[1]) * 100n
    + BigInt((fraction.slice(0, 2) || '').padEnd(2, '0'));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) centsValue += 1n;
  const whole = centsValue / 100n;
  const cents = String(centsValue % 100n).padStart(2, '0');
  return `${whole}.${cents}`;
}

function integerOrValue(value) {
  const source = String(value ?? '').trim();
  return /^\d+$/.test(source) ? Number(source) : source;
}

function supportPayload(answers) {
  const pouchIds = Array.from(answers.preferred_pouch_ids || [])
    .map(integerOrValue);
  return {
    difficult_times: Array.from(answers.difficult_times || []),
    common_triggers: Array.from(answers.common_triggers || []),
    preferred_pouch_ids: pouchIds,
    reminder_window: answers.reminder_window || 'none',
  };
}

export function deriveContext(answers) {
  const intention = answers.intention || '';
  const targeted = intention === 'reduce' || intention === 'quit_by_date';
  const manual = targeted && answers.baseline_source === 'manual';
  const required = ['intention'];
  if (targeted) required.push('baseline_source');
  if (manual) required.push('baseline_mg');
  if (targeted) required.push('pace');
  if (intention === 'reduce') required.push('end_target_mg');
  if (intention === 'quit_by_date') required.push('target_date');
  required.push('start_date');
  return {
    showBaselineChoices: targeted,
    showManualBaseline: manual,
    showPace: targeted,
    showEndTarget: intention === 'reduce',
    showTargetDate: intention === 'quit_by_date',
    required,
  };
}

export function summarizePlan(answers) {
  const pace = answers.pace || '';
  return {
    intention: INTENTION_LABELS[answers.intention] || 'Not chosen yet',
    baseline: BASELINE_LABELS[answers.baseline_source] || 'Not chosen yet',
    pace: answers.intention === 'observe'
      ? 'Observation only'
      : (pace in DURATIONS
        ? `${pace.charAt(0).toUpperCase()}${pace.slice(1)} · ${DURATIONS[pace]} days`
        : 'Not chosen yet'),
    start: answers.start_date || 'Not chosen yet',
  };
}

export function serializeDraft(answers, suggestion = {}) {
  const intention = answers.intention || '';
  const common = {
    intention,
    start_date: answers.start_date || '',
    ...supportPayload(answers),
  };
  if (intention === 'observe') {
    return {
      intention: 'observe',
      target_basis: 'observe',
      baseline_source: 'observe',
      start_date: common.start_date,
      duration_days: 7,
      difficult_times: common.difficult_times,
      common_triggers: common.common_triggers,
      preferred_pouch_ids: common.preferred_pouch_ids,
      reminder_window: common.reminder_window,
    };
  }

  const source = answers.baseline_source || '';
  const recent = source === 'recent_logs';
  const baselinePouches = recent ? canonicalDecimal(suggestion.baselinePouches) : '';
  const baselineStrength = canonicalDecimal(
    recent ? suggestion.baselineMgPerPouch : answers.baseline_mg_per_pouch,
  );
  const baselineMg = recent
    ? canonicalDecimal(suggestion.baselineMg)
    : canonicalDecimal(answers.baseline_mg);
  const pace = answers.pace || '';
  const payload = {
    intention,
    target_basis: 'nicotine_mg',
    start_date: answers.start_date || '',
  };
  if (source) payload.baseline_source = source;
  if (baselinePouches) payload.baseline_pouches = baselinePouches;
  if (baselineMg) payload.baseline_mg = baselineMg;
  if (baselineStrength) payload.baseline_mg_per_pouch = baselineStrength;
  if (pace) payload.pace = pace;
  if (intention === 'quit_by_date' && answers.target_date) {
    payload.target_date = answers.target_date || '';
  }
  if (pace in DURATIONS) payload.duration_days = DURATIONS[pace];
  if (intention === 'quit_by_date') payload.end_target_mg = '0.00';
  if (intention === 'reduce' && String(answers.end_target_mg ?? '').trim()) {
    payload.end_target_mg = canonicalDecimal(answers.end_target_mg);
  }
  return { ...payload, ...supportPayload(answers) };
}

export function serializePlan(answers, suggestion = {}) {
  const draft = serializeDraft(answers, suggestion);
  const observe = draft.intention === 'observe';
  return {
    mode: draft.intention,
    target_basis: draft.target_basis,
    baseline_source: draft.baseline_source,
    baseline_pouches: observe ? null : (draft.baseline_pouches ?? null),
    baseline_mg: observe ? null : draft.baseline_mg,
    baseline_mg_per_pouch: observe ? null : (draft.baseline_mg_per_pouch ?? null),
    pace: observe ? null : draft.pace,
    start_date: draft.start_date,
    target_date: observe ? null : (draft.target_date || null),
    duration_days: observe ? 7 : (
      draft.intention === 'quit_by_date' ? null : (draft.duration_days ?? null)
    ),
    end_target_mg: observe ? null : draft.end_target_mg,
    stage_targets: null,
  };
}

export function normalizeFieldErrors(fieldErrors = {}) {
  const normalized = {};
  for (const [path, messages] of Object.entries(fieldErrors)) {
    let field = path.replace(/^structured_payload\./, '').replace(/\[\d+\].*$/, '');
    if (field === 'stage_targets') field = 'pace';
    const values = Array.isArray(messages) ? messages : [messages];
    normalized[field] = [...(normalized[field] || []), ...values];
  }
  return normalized;
}

class RequestError extends Error {
  constructor(response, payload) {
    const envelope = payload?.error || {};
    super(envelope.message || 'We could not finish that request. Try again.');
    this.status = response.status;
    this.code = envelope.code || 'request_failed';
    this.fieldErrors = normalizeFieldErrors(envelope.field_errors || {});
  }
}

async function responsePayload(response) {
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

export function createOnboardingController({
  view,
  suggestion = {},
  fetchImpl = globalThis.fetch,
  csrfToken = '',
  location = globalThis.location,
}) {
  let currentStep = 'intention';
  let initialized = false;
  let cleaned = false;
  let inFlight = false;
  let completed = false;

  function answers() {
    return view.readAnswers();
  }

  function applyContext() {
    view.applyContext(deriveContext(answers()), suggestion);
  }

  function setStep(step) {
    if (!STEPS.includes(step)) return;
    currentStep = step;
    applyContext();
    view.setStep(step);
  }

  async function request(url, method, body) {
    const response = await fetchImpl(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify(body),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new RequestError(response, payload);
    return { response, payload };
  }

  function showRequestError(error) {
    if (error.fieldErrors && Object.keys(error.fieldErrors).length) {
      const mapped = view.mapFieldErrors(error.fieldErrors) || {};
      if (mapped.step) setStep(mapped.step);
      if (mapped.focus) mapped.focus();
    }
    view.announce(error.message || 'We could not finish that request. Try again.');
  }

  async function saveDraft(nextStep) {
    return request('/api/onboarding-draft', 'PUT', {
      current_step: nextStep,
      structured_payload: serializeDraft(answers(), suggestion),
    });
  }

  async function fetchPreview({ save = false } = {}) {
    if (save) await saveDraft('review');
    const { payload } = await request(
      '/api/plans/preview', 'POST', serializePlan(answers(), suggestion),
    );
    view.renderPreview(payload, answers(), suggestion);
    view.setDigest(payload.preview_digest || '');
    setStep('review');
    return payload;
  }

  async function continueForward() {
    if (inFlight || completed) return;
    if (currentStep === 'review') {
      if (view.readDigest()) return confirm();
      inFlight = true;
      view.setBusy(true);
      try {
        await fetchPreview({ save: true });
        view.announce('Your preview is ready. Review it before confirming.');
      } catch (error) {
        showRequestError(error);
      } finally {
        inFlight = false;
        view.setBusy(false);
      }
      return;
    }
    if (!view.validateStep(currentStep)) return;
    const nextStep = STEPS[STEPS.indexOf(currentStep) + 1];
    inFlight = true;
    view.setBusy(true);
    try {
      await saveDraft(nextStep);
      if (nextStep === 'review') {
        await fetchPreview();
        view.announce('Your preview is ready. Review every assumption before confirming.');
      } else {
        setStep(nextStep);
        view.announce('Progress saved.');
      }
    } catch (error) {
      if (!(error instanceof RequestError)) {
        error = new Error('We could not save your progress. Your answers are still here; try again.');
      }
      if (!error.fieldErrors || !Object.keys(error.fieldErrors).length) {
        error.message = 'We could not save your progress. Your answers are still here; try again.';
      }
      showRequestError(error);
    } finally {
      inFlight = false;
      view.setBusy(false);
    }
  }

  function back() {
    if (inFlight || completed) return;
    const index = STEPS.indexOf(currentStep);
    if (index > 0) setStep(STEPS[index - 1]);
  }

  function answerChanged(name) {
    applyContext();
    if (PLAN_FIELDS.has(name) && view.readDigest()) {
      view.clearPreview();
      view.setDigest('');
      view.announce('Your plan answers changed. Refresh the preview before confirming.');
    }
  }

  async function confirm() {
    if (inFlight || completed || !view.readDigest()) return;
    inFlight = true;
    view.setBusy(true);
    try {
      const body = {
        ...serializePlan(answers(), suggestion),
        preview_digest: view.readDigest(),
        activation: 'activate',
      };
      const { response } = await request('/api/plans', 'POST', body);
      if (response.status !== 201) {
        throw new Error('The plan was not created. Please try again.');
      }
      completed = true;
      location.assign('/today');
    } catch (error) {
      if (error instanceof RequestError && error.code === 'preview_stale') {
        try {
          await fetchPreview();
          view.announce('We made a fresh preview. Review it and confirm again.');
        } catch (refreshError) {
          showRequestError(refreshError);
        }
      } else {
        showRequestError(error);
      }
    } finally {
      inFlight = false;
      view.setBusy(false);
    }
  }

  function initialize() {
    if (initialized && !cleaned) return;
    initialized = true;
    cleaned = false;
    view.initialize({ back, continue: continueForward, confirm, answerChanged });
    const digest = view.readDigest();
    setStep(digest ? 'review' : 'intention');
  }

  function cleanup() {
    if (!initialized || cleaned) return;
    cleaned = true;
    view.cleanup();
  }

  return {
    initialize,
    cleanup,
    back,
    continue: continueForward,
    confirm,
    answerChanged,
    goTo: async (step) => setStep(step),
  };
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  element.setAttribute('aria-hidden', String(hidden));
  for (const control of element.querySelectorAll('input, select, textarea, button')) {
    control.disabled = hidden;
  }
}

function elementForField(form, name) {
  return form.querySelector(`#field-${name}`) || form.querySelector(`[name="${name}"]`);
}

function appendDefinition(documentRef, list, term, description) {
  const row = documentRef.createElement('div');
  const dt = documentRef.createElement('dt');
  const dd = documentRef.createElement('dd');
  dt.textContent = term;
  dd.textContent = description;
  row.append(dt, dd);
  list.append(row);
}

function createDomView(form, documentRef) {
  const sections = new Map(
    Array.from(form.querySelectorAll('[data-onboarding-step]'))
      .map((section) => [section.dataset.onboardingStep, section]),
  );
  const fallbackActions = form.querySelector('.onboarding-actions');
  const serverConfirm = form.querySelector('button[name="form_action"][value="confirm"]');
  const status = form.querySelector('.onboarding-status');
  const previewHost = form.querySelector('[data-onboarding-preview]');
  const original = new Map();
  let digestInput = form.querySelector('input[name="preview_digest"]');
  let enhancedActions;
  let backButton;
  let primaryButton;
  let listeners;
  let initialized = false;
  let currentStep = 'intention';

  for (const control of form.querySelectorAll('input, select, textarea, button')) {
    original.set(control, { disabled: control.disabled, required: control.required });
  }

  function readOne(name) {
    const checked = form.querySelector(`[name="${name}"]:checked`);
    if (checked) return checked.value;
    return form.querySelector(`[name="${name}"]`)?.value || '';
  }

  function readMany(name) {
    return Array.from(form.querySelectorAll(`[name="${name}"]:checked`))
      .map((control) => control.value);
  }

  function readAnswers() {
    return {
      intention: readOne('intention'),
      baseline_source: readOne('baseline_source'),
      baseline_mg: readOne('baseline_mg'),
      baseline_mg_per_pouch: readOne('baseline_mg_per_pouch'),
      pace: readOne('pace'),
      end_target_mg: readOne('end_target_mg'),
      target_date: readOne('target_date'),
      start_date: readOne('start_date'),
      difficult_times: readMany('difficult_times'),
      common_triggers: readMany('common_triggers'),
      preferred_pouch_ids: readMany('preferred_pouch_ids'),
      reminder_window: readOne('reminder_window') || 'none',
    };
  }

  function setRequired(name, required) {
    for (const control of form.querySelectorAll(`[name="${name}"]`)) {
      control.required = required;
    }
  }

  function applyContext(context, suggestion) {
    const baselineChoices = form.querySelector('#field-baseline_source');
    const manualFields = form.querySelector('[data-manual-baseline-fields]');
    const paceFields = form.querySelector('#field-pace');
    const endTarget = form.querySelector('[data-end-target-fields]');
    const targetDate = form.querySelector('[data-target-date-fields]');
    const planTargets = form.querySelector('[data-plan-target-fields]');
    setHidden(baselineChoices, !context.showBaselineChoices);
    setHidden(manualFields, !context.showManualBaseline);
    setHidden(paceFields, !context.showPace);
    setHidden(planTargets, !context.showEndTarget && !context.showTargetDate);
    setHidden(endTarget, !context.showEndTarget);
    setHidden(targetDate, !context.showTargetDate);
    for (const name of [
      'intention', 'baseline_source', 'baseline_mg',
      'baseline_mg_per_pouch', 'pace', 'end_target_mg',
      'target_date', 'start_date',
    ]) {
      setRequired(name, context.required.includes(name));
    }
    const recent = form.querySelector('[name="baseline_source"][value="recent_logs"]');
    if (recent && !suggestion.available) recent.disabled = true;
    const summary = summarizePlan(readAnswers());
    for (const [name, value] of Object.entries(summary)) {
      const target = documentRef.querySelector(`[data-plan-summary="${name}"]`);
      if (target) target.textContent = value;
    }
  }

  function updatePrimary() {
    if (!primaryButton) return;
    if (currentStep === 'review') {
      primaryButton.textContent = digestInput?.value
        ? 'Activate this reviewed plan'
        : 'Refresh my preview';
    } else {
      primaryButton.textContent = 'Continue';
    }
    backButton.hidden = currentStep === 'intention';
  }

  function setStep(step) {
    currentStep = step;
    for (const [name, section] of sections) {
      section.hidden = name !== step;
      section.setAttribute('aria-hidden', String(name !== step));
    }
    updatePrimary();
    sections.get(step)?.querySelector('h2')?.focus();
  }

  function validateStep(step) {
    const section = sections.get(step);
    if (!section) return true;
    for (const control of section.querySelectorAll('input, select, textarea')) {
      if (!control.disabled && !control.checkValidity()) {
        control.reportValidity();
        control.focus();
        return false;
      }
    }
    return true;
  }

  function setBusy(busy) {
    if (primaryButton) {
      primaryButton.disabled = busy;
      primaryButton.setAttribute('aria-busy', String(busy));
    }
    if (backButton) backButton.disabled = busy;
  }

  function announce(message) {
    if (status) status.textContent = message;
  }

  function ensureDigestInput() {
    if (!digestInput) {
      digestInput = documentRef.createElement('input');
      digestInput.type = 'hidden';
      digestInput.name = 'preview_digest';
    }
    if (digestInput.parentElement !== form) form.prepend(digestInput);
    return digestInput;
  }

  function setDigest(value) {
    ensureDigestInput().value = value || '';
    updatePrimary();
  }

  function selectedLabels(name) {
    return Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map((control) => {
      const text = control.closest('label')?.textContent || control.value;
      return text.replace(/\s+/g, ' ').trim();
    });
  }

  function renderPreview(preview, currentAnswers, suggestion) {
    if (!previewHost) return;
    previewHost.replaceChildren();
    const plan = preview.normalized_input;
    const decisions = documentRef.createElement('dl');
    decisions.className = 'review-decisions';
    appendDefinition(documentRef, decisions, 'Intention', plan.mode.replaceAll('_', ' '));
    const baselineDays = plan.baseline_source === 'recent_logs' && suggestion.loggedDaysUsed
      ? ` · ${suggestion.loggedDaysUsed} logged days` : '';
    appendDefinition(documentRef, decisions, 'Baseline source', `${plan.baseline_source.replaceAll('_', ' ')}${baselineDays}`);
    appendDefinition(documentRef, decisions, 'Starting nicotine', plan.baseline_mg == null ? 'Unknown during observation' : `${plan.baseline_mg} mg per day`);
    appendDefinition(documentRef, decisions, 'Usual pouch strength', plan.baseline_mg_per_pouch == null ? 'Not provided' : `${plan.baseline_mg_per_pouch} mg per pouch`);
    if (plan.baseline_pouches != null) {
      appendDefinition(documentRef, decisions, 'Historical pouch context', plan.baseline_pouches);
    }
    appendDefinition(documentRef, decisions, 'Pace and duration', plan.pace ? `${plan.pace} · ${plan.duration_days} days` : `No reduction pace · ${plan.duration_days} observation days`);
    appendDefinition(documentRef, decisions, 'Dates', `${plan.start_date} to ${plan.target_date}`);
    appendDefinition(documentRef, decisions, 'End target nicotine', plan.end_target_mg == null ? 'No target during observation' : `${plan.end_target_mg} mg per day`);
    appendDefinition(documentRef, decisions, 'Difficult times', selectedLabels('difficult_times').join(', ') || 'None selected');
    appendDefinition(documentRef, decisions, 'Triggers', selectedLabels('common_triggers').join(', ') || 'None selected');
    appendDefinition(documentRef, decisions, 'Pouches', selectedLabels('preferred_pouch_ids').join(', ') || 'None selected');
    appendDefinition(documentRef, decisions, 'Reminder', selectedLabels('reminder_window').join(', ') || currentAnswers.reminder_window || 'No reminder');
    previewHost.append(decisions);

    const stageSection = documentRef.createElement('section');
    const stageTitle = documentRef.createElement('h3');
    stageTitle.textContent = 'Contiguous stages';
    stageSection.append(stageTitle);
    if (preview.stages.length) {
      const stages = documentRef.createElement('ol');
      stages.className = 'review-stages';
      for (const stage of preview.stages) {
        const item = documentRef.createElement('li');
        const ceiling = stage.nicotine_ceiling_mg == null
          ? 'Observation — no ceiling'
          : `${stage.nicotine_ceiling_mg} mg ceiling`;
        const historical = stage.target_pouches == null
          ? '' : ` · historical pouch guide ${stage.target_pouches}`;
        item.textContent = `${stage.start_date} to ${stage.end_date} · ${ceiling}${historical}`;
        stages.append(item);
      }
      stageSection.append(stages);
    } else {
      const empty = documentRef.createElement('p');
      empty.textContent = 'Observation has no reduction stages.';
      stageSection.append(empty);
    }
    previewHost.append(stageSection);

    const daySection = documentRef.createElement('section');
    const dayTitle = documentRef.createElement('h3');
    dayTitle.textContent = 'Complete daily schedule';
    const table = documentRef.createElement('table');
    const thead = documentRef.createElement('thead');
    const header = documentRef.createElement('tr');
    const showHistoricalPouches = preview.days.some((day) => day.target_pouches != null);
    for (const label of [
      'Date', 'Nicotine ceiling',
      ...(showHistoricalPouches ? ['Historical pouch guide'] : []),
    ]) {
      const cell = documentRef.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      header.append(cell);
    }
    thead.append(header);
    const tbody = documentRef.createElement('tbody');
    for (const day of preview.days) {
      const row = documentRef.createElement('tr');
      const date = documentRef.createElement('th');
      date.scope = 'row';
      date.textContent = day.local_date;
      const ceiling = documentRef.createElement('td');
      ceiling.textContent = day.nicotine_ceiling_mg == null
        ? 'Observation — no ceiling' : `${day.nicotine_ceiling_mg} mg`;
      row.append(date, ceiling);
      if (showHistoricalPouches) {
        const target = documentRef.createElement('td');
        target.textContent = day.target_pouches ?? '—';
        row.append(target);
      }
      tbody.append(row);
    }
    table.append(thead, tbody);
    daySection.append(dayTitle, table);
    previewHost.append(daySection);
    const disclaimer = documentRef.createElement('p');
    disclaimer.textContent = 'This schedule is a behavioral tracking aid, not medical advice. If reducing nicotine affects your health or wellbeing, talk with a qualified clinician.';
    previewHost.append(disclaimer);
  }

  function clearPreview() {
    setDigest('');
    if (previewHost) {
      const message = documentRef.createElement('p');
      message.textContent = 'Your answers changed. Refresh the normalized schedule before activating it.';
      previewHost.replaceChildren(message);
    }
  }

  function clearClientErrors() {
    for (const error of form.querySelectorAll('[data-client-error]')) error.remove();
    for (const target of form.querySelectorAll('[aria-invalid="true"]')) {
      if (!target.dataset.serverInvalid) target.removeAttribute('aria-invalid');
    }
  }

  function mapFieldErrors(errors) {
    clearClientErrors();
    let firstTarget = null;
    let firstStep = null;
    let count = 0;
    for (const [name, messages] of Object.entries(errors)) {
      const field = elementForField(form, name);
      if (!field) continue;
      const target = field.matches('input, select, textarea')
        ? field
        : field.querySelector('input, select, textarea');
      const error = documentRef.createElement('p');
      const errorId = `client-error-${name}-${count++}`;
      error.id = errorId;
      error.className = 'field-error';
      error.dataset.clientError = 'true';
      error.textContent = messages.join(' ');
      field.insertAdjacentElement('afterend', error);
      field.setAttribute('aria-describedby', `${field.getAttribute('aria-describedby') || ''} ${errorId}`.trim());
      if (target) target.setAttribute('aria-invalid', 'true');
      if (!firstTarget) {
        firstTarget = target || field;
        firstStep = field.closest('[data-onboarding-step]')?.dataset.onboardingStep;
      }
    }
    return {
      step: firstStep,
      focus: () => firstTarget?.focus(),
    };
  }

  function initialize(callbacks) {
    if (initialized) return;
    initialized = true;
    listeners = {
      change: (event) => {
        if (event.target?.name) callbacks.answerChanged(event.target.name);
      },
      submit: (event) => {
        event.preventDefault();
        if (event.submitter?.value === 'confirm') callbacks.confirm();
        else callbacks.continue();
      },
      back: () => callbacks.back(),
      primary: () => callbacks.continue(),
    };
    enhancedActions = documentRef.createElement('div');
    enhancedActions.className = 'onboarding-actions onboarding-actions--enhanced';
    enhancedActions.dataset.onboardingEnhancedActions = 'true';
    backButton = documentRef.createElement('button');
    backButton.type = 'button';
    backButton.className = 'c-button c-button--secondary';
    backButton.textContent = 'Back';
    primaryButton = documentRef.createElement('button');
    primaryButton.type = 'button';
    primaryButton.className = 'c-button c-button--primary';
    enhancedActions.append(backButton, primaryButton);
    fallbackActions?.insertAdjacentElement('beforebegin', enhancedActions);
    if (fallbackActions) fallbackActions.hidden = true;
    if (serverConfirm) serverConfirm.hidden = true;
    ensureDigestInput();
    form.addEventListener('change', listeners.change);
    form.addEventListener('submit', listeners.submit);
    backButton.addEventListener('click', listeners.back);
    primaryButton.addEventListener('click', listeners.primary);
  }

  function cleanup() {
    if (!initialized) return;
    initialized = false;
    form.removeEventListener('change', listeners.change);
    form.removeEventListener('submit', listeners.submit);
    backButton?.removeEventListener('click', listeners.back);
    primaryButton?.removeEventListener('click', listeners.primary);
    enhancedActions?.remove();
    if (fallbackActions) fallbackActions.hidden = false;
    if (serverConfirm) serverConfirm.hidden = false;
    for (const section of sections.values()) {
      section.hidden = false;
      section.removeAttribute('aria-hidden');
    }
    for (const [control, state] of original) {
      control.disabled = state.disabled;
      control.required = state.required;
    }
  }

  return {
    initialize,
    cleanup,
    readAnswers,
    readDigest: () => digestInput?.value || '',
    setDigest,
    setStep,
    applyContext,
    validateStep,
    setBusy,
    announce,
    renderPreview,
    clearPreview,
    mapFieldErrors,
  };
}

const controllerRegistry = new WeakMap();

export function initializeOnboarding(root = document, dependencies = {}) {
  const form = root.querySelector?.('[data-onboarding-form]');
  if (!form) return null;
  const existing = controllerRegistry.get(form);
  if (existing) return existing;
  const suggestion = {
    available: form.dataset.baselineAvailable === 'true',
    loggedDaysUsed: Number(form.dataset.baselineLoggedDays || 0),
    baselinePouches: form.dataset.baselinePouches || '',
    baselineMg: form.dataset.baselineMg || '',
    baselineMgPerPouch: form.dataset.baselineMgPerPouch || '',
  };
  const documentRef = form.ownerDocument || root;
  const controller = createOnboardingController({
    view: createDomView(form, documentRef),
    suggestion,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    csrfToken: documentRef.querySelector('meta[name="csrf-token"]')?.content || '',
    location: dependencies.location || globalThis.location,
  });
  controllerRegistry.set(form, controller);
  controller.initialize();
  return controller;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeOnboarding(document), { once: true });
  } else {
    initializeOnboarding(document);
  }
}
