const NUMBER_FIELDS = new Set([
  'intensity', 'duration_minutes', 'mood_before', 'mood_after', 'stress_level',
]);

const OUTCOME_LABELS = {
  resisted: 'Did not use nicotine',
  used_nicotine: 'Used nicotine',
  used_alternative: 'Used an alternative',
};

function buildCravingPayload(formData) {
  const payload = {};
  for (const [name, rawValue] of formData.entries()) {
    if (name === 'csrf_token' || name === 'physical_symptoms') continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (value === '') continue;
    payload[name] = NUMBER_FIELDS.has(name) ? Number(value) : value;
  }
  const symptoms = formData.getAll('physical_symptoms')
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (symptoms.length) payload.physical_symptoms = symptoms;
  return payload;
}

function normalizedUtcDate(value) {
  if (!value) return null;
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

function formatCravingTime(value, timezone) {
  const instant = normalizedUtcDate(value);
  if (!instant || Number.isNaN(instant.getTime())) return 'Time not available';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone || 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}

function parseSymptoms(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function appendFact(list, label, value) {
  if (value === null || value === undefined || value === '') return;
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  list.append(wrapper);
}

function appendNote(container, label, value) {
  if (!value) return;
  const paragraph = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = label;
  paragraph.append(strong, document.createTextNode(` ${value}`));
  container.append(paragraph);
}

function createCravingRow(craving, timezone) {
  const article = document.createElement('article');
  article.className = 'craving-row';
  article.setAttribute('role', 'listitem');
  article.dataset.cravingId = String(craving.id);

  const lead = document.createElement('div');
  lead.className = 'craving-row__lead';
  const intensity = document.createElement('p');
  intensity.className = 'craving-row__intensity';
  intensity.textContent = `Intensity ${craving.intensity} of 10`;
  const time = document.createElement('time');
  time.dataset.cravingTime = '';
  const instant = normalizedUtcDate(craving.craving_time);
  time.dateTime = instant && !Number.isNaN(instant.getTime())
    ? instant.toISOString()
    : '';
  time.textContent = formatCravingTime(craving.craving_time, timezone);
  lead.append(intensity, time);

  const facts = document.createElement('dl');
  facts.className = 'craving-row__facts';
  const trigger = craving.trigger
    ? String(craving.trigger).replaceAll('_', ' ')
    : '';
  appendFact(
    facts,
    'Trigger',
    trigger ? `${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}` : 'Not recorded',
  );
  appendFact(facts, 'Outcome', OUTCOME_LABELS[craving.outcome] || 'Not recorded');
  if (craving.duration_minutes !== null && craving.duration_minutes !== undefined) {
    appendFact(
      facts,
      'Duration',
      `${craving.duration_minutes} ${craving.duration_minutes === 1 ? 'minute' : 'minutes'}`,
    );
  }
  const symptoms = parseSymptoms(craving.physical_symptoms);
  if (symptoms.length) {
    appendFact(
      facts,
      'Physical signs',
      symptoms.map((value) => String(value).replaceAll('_', ' ')).join(', '),
    );
  }

  const notes = document.createElement('div');
  notes.className = 'craving-row__notes';
  appendNote(notes, 'Context', craving.situation_context);
  appendNote(notes, 'Notes', craving.notes);
  appendNote(notes, 'What helped', craving.outcome_notes);

  article.append(lead, facts);
  if (notes.childElementCount) article.append(notes);
  return article;
}

function renderCravings(list, cravings, timezone) {
  const fragment = document.createDocumentFragment();
  if (!cravings.length) {
    const empty = document.createElement('div');
    empty.className = 'cravings-empty';
    empty.setAttribute('role', 'listitem');
    empty.dataset.cravingsEmpty = '';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'No detailed entries yet';
    const heading = document.createElement('h3');
    heading.textContent = 'Your history can start with one honest moment';
    const copy = document.createElement('p');
    copy.textContent = 'Record only what feels useful. An intensity rating is enough.';
    empty.append(eyebrow, heading, copy);
    fragment.append(empty);
  } else {
    cravings.forEach((craving) => fragment.append(createCravingRow(craving, timezone)));
  }
  list.replaceChildren(fragment);
}

function localizeServerTimes(root, timezone) {
  root.querySelectorAll('time[data-craving-time]').forEach((element) => {
    element.textContent = formatCravingTime(element.dateTime, timezone);
  });
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

function setStatus(status, message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

async function loadCravings({ endpoint, list, timezone, fetchImpl }) {
  list.setAttribute('aria-busy', 'true');
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: 'application/json' },
    });
    const data = await responseJson(response);
    if (!response.ok || !Array.isArray(data)) throw new Error('history');
    renderCravings(list, data.slice(0, 20), timezone);
    return true;
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

function initCravingsPage(root = document, fetchImpl = window.fetch.bind(window)) {
  const page = root.querySelector('[data-cravings-page]');
  if (!page || page.dataset.controllerReady === 'true') return () => {};
  const form = page.querySelector('#craving-form');
  const list = page.querySelector('#cravings-list');
  const status = page.querySelector('[data-craving-form-status]');
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !list || !status || !submit) return () => {};

  page.dataset.controllerReady = 'true';
  const timezone = page.dataset.timezone || 'UTC';
  localizeServerTimes(page, timezone);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || submit.disabled) return;
    const activeDocument = submit.ownerDocument;
    const initiatedWithFocus = activeDocument?.activeElement === submit;
    submit.disabled = true;
    submit.setAttribute('aria-disabled', 'true');
    const focusAfterDisable = activeDocument?.activeElement;
    setStatus(status, 'Saving your craving…', 'loading');
    try {
      const response = await fetchImpl(form.dataset.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRFToken': root.querySelector('meta[name="csrf-token"]')?.content || '',
        },
        body: JSON.stringify(buildCravingPayload(new FormData(form))),
      });
      const result = await responseJson(response);
      if (!response.ok || result.error) {
        setStatus(
          status,
          result.error || 'The craving could not be recorded. Your details are still here.',
          'error',
        );
        return;
      }
      form.reset();
      setStatus(status, 'Craving recorded. Thank you for noticing the moment.', 'success');
      try {
        await loadCravings({
          endpoint: form.dataset.endpoint,
          list,
          timezone,
          fetchImpl,
        });
      } catch (_) {
        list.prepend(createCravingRow(result, timezone));
        page.querySelector('[data-cravings-empty]')?.remove();
      }
    } catch (_) {
      setStatus(
        status,
        'The craving could not be recorded. Check your connection and try again.',
        'error',
      );
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-disabled');
      if (
        initiatedWithFocus
        && activeDocument?.activeElement === focusAfterDisable
        && submit.isConnected
        && activeDocument?.visibilityState !== 'hidden'
      ) submit.focus({ preventScroll: true });
    }
  };

  form.addEventListener('submit', handleSubmit);
  return () => {
    form.removeEventListener('submit', handleSubmit);
    delete page.dataset.controllerReady;
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => initCravingsPage(document, window.fetch.bind(window));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

export {
  buildCravingPayload,
  createCravingRow,
  formatCravingTime,
  initCravingsPage,
  loadCravings,
  parseSymptoms,
  renderCravings,
};
