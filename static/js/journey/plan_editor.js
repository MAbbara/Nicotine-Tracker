const REVISION_KEYS = new Set([
  'effective_date', 'target_basis', 'pace', 'duration_days', 'end_target_mg',
]);
const RESUME_KEYS = new Set(['resume_date']);
const PACES = new Set(['gentle', 'steady', 'focused']);
const INTEGER_PATTERN = /^\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export class ClientValidationError extends Error {
  constructor(fieldErrors, message = 'Check the highlighted fields and try again.') {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

function rejectUnknown(values, allowed, errors) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ClientValidationError({ body: ['Use the visible editor fields.'] });
  }
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) errors[key] = ['This field is not supported.'];
  }
}

function dateValue(value, field, errors) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    errors[field] = ['Use the YYYY-MM-DD date format.'];
    return '';
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors[field] = ['Enter a real calendar date.'];
    return '';
  }
  return value;
}

function optionalInteger(value, field, minimum, maximum, errors) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') {
    errors[field] = ['Enter a whole number.'];
    return undefined;
  }
  const source = typeof value === 'number' ? String(value) : value;
  if (typeof source !== 'string' || !INTEGER_PATTERN.test(source.trim())) {
    errors[field] = ['Enter a whole number.'];
    return undefined;
  }
  const parsed = Number(source.trim());
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors[field] = [`Enter a whole number from ${minimum} to ${maximum}.`];
    return undefined;
  }
  return parsed;
}

function optionalDecimal(value, field, maximumCents, errors) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') {
    errors[field] = ['Enter a nicotine amount in mg.'];
    return undefined;
  }
  const source = typeof value === 'number' ? String(value) : value;
  const match = typeof source === 'string'
    ? /^(\d+)(?:\.(\d+))?$/.exec(source.trim())
    : null;
  if (!match) {
    errors[field] = ['Enter a nicotine amount in mg.'];
    return undefined;
  }
  const fraction = match[2] || '';
  let cents = BigInt(match[1]) * 100n
    + BigInt((fraction.slice(0, 2) || '').padEnd(2, '0'));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  if (cents > maximumCents) {
    errors[field] = ['Enter an amount from 0.00 to 999999.99 mg.'];
    return undefined;
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function throwErrors(errors) {
  if (Object.keys(errors).length) throw new ClientValidationError(errors);
}

export function revisionPreviewBody(values) {
  const errors = {};
  rejectUnknown(values, REVISION_KEYS, errors);
  const effectiveDate = dateValue(values.effective_date, 'effective_date', errors);
  if (
    Object.prototype.hasOwnProperty.call(values, 'target_basis')
    && values.target_basis !== 'nicotine_mg'
  ) {
    errors.target_basis = ['Only nicotine-based revisions are supported.'];
  }
  const changes = {};
  if (values.pace !== '' && values.pace !== null && values.pace !== undefined) {
    if (typeof values.pace !== 'string' || !PACES.has(values.pace.trim())) {
      errors.pace = ['Choose gentle, steady, or focused.'];
    } else {
      changes.pace = values.pace.trim();
    }
  }
  const duration = optionalInteger(values.duration_days, 'duration_days', 1, 365, errors);
  const target = optionalDecimal(
    values.end_target_mg, 'end_target_mg', 99999999n, errors,
  );
  if (duration !== undefined) changes.duration_days = duration;
  if (target !== undefined) changes.end_target_mg = target;
  if (!Object.keys(changes).length) errors.changes = ['Choose at least one change.'];
  else changes.target_basis = 'nicotine_mg';
  throwErrors(errors);
  return { effective_date: effectiveDate, changes };
}

function validateDigest(digest) {
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
    throw new ClientValidationError({
      preview_digest: ['Preview the current inputs before confirming.'],
    });
  }
  return digest;
}

export function revisionApplyBody(values, digest) {
  return {
    ...revisionPreviewBody(values),
    preview_digest: validateDigest(digest),
    reason: 'user_edit',
    note: null,
  };
}

export function resumePreviewBody(values) {
  const errors = {};
  rejectUnknown(values, RESUME_KEYS, errors);
  const resumeDate = dateValue(values.resume_date, 'resume_date', errors);
  throwErrors(errors);
  return { resume_date: resumeDate };
}

export function resumeApplyBody(values, digest) {
  return {
    ...resumePreviewBody(values),
    preview_digest: validateDigest(digest),
  };
}

export function normalizeFieldErrors(fieldErrors = {}) {
  const normalized = {};
  for (const [path, messages] of Object.entries(fieldErrors)) {
    const field = path.replace(/^changes\./, '').replace(/\[\d+\].*$/, '');
    const values = Array.isArray(messages) ? messages : [messages];
    normalized[field] = [...(normalized[field] || []), ...values];
  }
  return normalized;
}

class RequestError extends Error {
  constructor(response, payload) {
    const envelope = payload?.error || {};
    super(envelope.message || 'We could not finish that request.');
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

export function createPlanEditorController({
  kind,
  planId,
  view,
  fetchImpl = globalThis.fetch,
  csrfToken = '',
}) {
  if (!['revision', 'resume'].includes(kind)) throw new Error('Unknown plan editor kind.');
  let initialized = false;
  let cleaned = false;
  let inFlight = false;
  let completed = false;
  const previewUrl = kind === 'revision'
    ? `/api/plans/${planId}/revisions/preview`
    : `/api/plans/${planId}/resume/preview`;
  const applyUrl = kind === 'revision'
    ? `/api/plans/${planId}/revisions`
    : `/api/plans/${planId}/resume`;
  const previewBody = kind === 'revision' ? revisionPreviewBody : resumePreviewBody;
  const applyBody = kind === 'revision' ? revisionApplyBody : resumeApplyBody;

  async function request(url, body) {
    const response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify(body),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new RequestError(response, payload);
    return payload;
  }

  function showError(error) {
    const fieldErrors = normalizeFieldErrors(error.fieldErrors || {});
    if (Object.keys(fieldErrors).length) {
      const mapped = view.mapFieldErrors(fieldErrors) || {};
      if (mapped.focus) mapped.focus();
    }
    if (error.code === 'active_plan_conflict') {
      view.announce('Another plan is active. Your date is still here; resolve that plan and try again.');
    } else if (error.code === 'invalid_plan_state') {
      view.announce('This plan changed state. Your inputs are still here and nothing changed.');
    } else if (error instanceof TypeError) {
      view.announce('The network did not respond. Your inputs are still here; try again.');
    } else {
      view.announce(`${error.message || 'We could not finish that request.'} Your inputs are still here.`);
    }
  }

  async function preview({ stale = false } = {}) {
    if (inFlight || completed) return;
    inFlight = true;
    view.setBusy(true);
    try {
      const values = view.readValues();
      const payload = await request(previewUrl, previewBody(values));
      view.renderPreview(payload);
      view.setDigest(payload.preview_digest || '');
      const namedDate = payload.effective_date || payload.resume_date;
      view.announce(stale
        ? `We made a fresh preview for ${namedDate}. Review it and confirm again.`
        : `Preview for ${namedDate} is ready. The persisted plan is unchanged.`);
      return payload;
    } catch (error) {
      showError(error);
      return undefined;
    } finally {
      inFlight = false;
      view.setBusy(false);
    }
  }

  async function confirm() {
    if (inFlight || completed || !view.readDigest()) return;
    inFlight = true;
    view.setBusy(true);
    try {
      const body = applyBody(view.readValues(), view.readDigest());
      await request(applyUrl, body);
      completed = true;
      view.applied();
    } catch (error) {
      if (error instanceof RequestError && error.code === 'preview_stale') {
        inFlight = false;
        view.setBusy(false);
        view.clearPreview();
        await preview({ stale: true });
        return;
      }
      showError(error);
    } finally {
      inFlight = false;
      view.setBusy(false);
    }
  }

  function changed() {
    if (view.readDigest()) {
      view.clearPreview();
      view.setDigest('');
      view.announce('Your plan inputs changed. Another preview is required before confirmation.');
    }
  }

  function initialize() {
    if (initialized && !cleaned) return;
    initialized = true;
    cleaned = false;
    view.initialize({ preview, confirm, changed });
  }

  function cleanup() {
    if (!initialized || cleaned) return;
    cleaned = true;
    view.cleanup();
  }

  return { initialize, cleanup, preview, confirm, changed };
}

function text(value) {
  return value === null || value === undefined ? 'Unknown' : String(value);
}

export function previewTable(documentObject, caption, rows, dateKey) {
  const wrapper = documentObject.createElement('div');
  wrapper.className = 'journey-table-scroll';
  const table = documentObject.createElement('table');
  const tableCaption = documentObject.createElement('caption');
  tableCaption.textContent = caption;
  const head = documentObject.createElement('thead');
  head.innerHTML = '<tr><th scope="col">Date</th><th scope="col">Nicotine ceiling</th><th scope="col">Historical pouch guide</th></tr>';
  const body = documentObject.createElement('tbody');
  for (const row of rows || []) {
    const tr = documentObject.createElement('tr');
    const date = dateKey === 'stage'
      ? `${text(row.start_date)} to ${text(row.end_date)}`
      : text(row.local_date);
    const th = documentObject.createElement('th');
    th.scope = 'row';
    th.textContent = date;
    const ceiling = documentObject.createElement('td');
    ceiling.textContent = row.nicotine_ceiling_mg == null
      ? 'Not scheduled'
      : `${row.nicotine_ceiling_mg} mg`;
    const target = documentObject.createElement('td');
    target.textContent = row.target_pouches == null
      ? 'Not used'
      : String(row.target_pouches);
    tr.append(th, ceiling, target);
    body.append(tr);
  }
  table.append(tableCaption, head, body);
  wrapper.append(table);
  return wrapper;
}

export function createDomPlanEditorView(root, { documentObject = document } = {}) {
  const form = root.querySelector('[data-plan-editor-form]');
  const host = root.querySelector('[data-plan-editor-preview]');
  const status = root.querySelector('[data-plan-editor-status]');
  const digest = root.querySelector('[data-plan-editor-digest]');
  const confirmButton = root.querySelector('[data-plan-editor-confirm]');
  const previewButton = root.querySelector('[data-plan-editor-preview-button]');
  const listeners = [];

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  }

  function clearErrors() {
    root.querySelectorAll('[data-client-field-error]').forEach((item) => item.remove());
    root.querySelectorAll('[aria-invalid="true"]').forEach((item) => {
      item.removeAttribute('aria-invalid');
      item.removeAttribute('aria-errormessage');
    });
  }

  return {
    initialize(actions) {
      on(form, 'submit', (event) => {
        event.preventDefault();
        actions.preview();
      });
      on(form, 'input', () => actions.changed());
      on(form, 'change', () => actions.changed());
      on(confirmButton, 'click', () => actions.confirm());
    },
    cleanup() {
      for (const [target, type, handler] of listeners.splice(0)) {
        target.removeEventListener(type, handler);
      }
    },
    readValues() {
      const data = new FormData(form);
      if (root.dataset.planEditor === 'resume') return { resume_date: data.get('resume_date') || '' };
      return {
        effective_date: data.get('effective_date') || '',
        pace: data.get('pace') || '',
        duration_days: data.get('duration_days') || '',
        end_target_mg: data.get('end_target_mg') || '',
      };
    },
    readDigest() { return digest.value; },
    setDigest(value) { digest.value = value; },
    clearPreview() {
      host.replaceChildren();
      host.hidden = true;
      confirmButton.hidden = true;
      digest.value = '';
    },
    renderPreview(payload) {
      clearErrors();
      const heading = documentObject.createElement('h4');
      const namedDate = payload.effective_date || payload.resume_date;
      heading.textContent = `Future schedule from ${namedDate}`;
      host.replaceChildren(
        heading,
        previewTable(documentObject, 'Every future stage in this preview', payload.stages, 'stage'),
        previewTable(documentObject, 'All future day differences in this preview', payload.days, 'day'),
      );
      host.hidden = false;
      confirmButton.hidden = false;
    },
    setBusy(value) {
      previewButton.disabled = value;
      confirmButton.disabled = value;
      root.setAttribute('aria-busy', String(value));
    },
    announce(value) { status.textContent = value; },
    mapFieldErrors(errors) {
      clearErrors();
      let first = null;
      for (const [field, messages] of Object.entries(errors)) {
        const control = form.elements.namedItem(field === 'changes' ? 'pace' : field);
        if (!control || !control.parentNode) continue;
        const error = documentObject.createElement('p');
        error.className = 'field-error';
        error.dataset.clientFieldError = '';
        error.id = `${control.id}-client-error`;
        error.textContent = messages.join(' ');
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-errormessage', error.id);
        control.insertAdjacentElement('afterend', error);
        if (!first) first = control;
      }
      return { focus: first ? () => first.focus() : null };
    },
    applied() { globalThis.location.assign('/journey/'); },
  };
}

export function initializePlanEditors(documentObject = document) {
  const controllers = [];
  const csrfToken = documentObject.querySelector('meta[name="csrf-token"]')?.content || '';
  for (const root of documentObject.querySelectorAll('[data-plan-editor]')) {
    const controller = createPlanEditorController({
      kind: root.dataset.planEditor,
      planId: root.dataset.planId,
      view: createDomPlanEditorView(root, { documentObject }),
      csrfToken,
    });
    controller.initialize();
    controllers.push(controller);
  }
  return () => controllers.forEach((controller) => controller.cleanup());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializePlanEditors(document), { once: true });
  } else {
    initializePlanEditors(document);
  }
}
