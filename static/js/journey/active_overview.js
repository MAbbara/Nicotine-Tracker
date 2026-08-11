/* Active-plan overview glue: path chart, entrance motion, collapse/accordion
   controllers, and the revision editor view adapter on the tested
   plan_editor.js controller contract. */

import { createPathChart, fmtDayShort, fmtDayLong, parseISODay } from './path_chart.js';
import { createPlanEditorController } from './plan_editor.js';

const DAY_MS = 86400000;
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);

function expandStages(stages) {
  const map = new Map();
  for (const st of stages) {
    for (let d = parseISODay(st.start); d <= parseISODay(st.end); d += DAY_MS) {
      map.set(toISODate(d), st.pouches ?? null);
    }
  }
  return map;
}

/* Candid preview summary: how many current stages change, and the first
   future day where the preview differs (including days a shorter preview
   removes). */
function summarizePreview(currentStages, preview) {
  const before = expandStages(currentStages);
  const previewDays = new Set((preview.days || []).map((d) => d.local_date));
  let firstDifference = null;
  const touched = new Set();
  const mark = (iso) => {
    firstDifference = firstDifference || iso;
    const st = currentStages.find((s) => s.start <= iso && iso <= s.end);
    if (st) touched.add(st.start);
  };
  for (const day of preview.days || []) {
    const after = day.target_pouches ?? null;
    if (before.get(day.local_date) !== after) mark(day.local_date);
  }
  for (const iso of before.keys()) {
    if (iso >= preview.effective_date && !previewDays.has(iso)) mark(iso);
  }
  return { firstDifference, changedStages: touched.size };
}

/* View adapter implementing the exact contract createPlanEditorController
   drives (see static/js/journey/plan_editor.js). */
function createPathEditorView(root, { chart, payload }) {
  const form = root.querySelector('[data-adjust-form]');
  const region = root.querySelector('[data-preview-region]');
  const summaryEl = root.querySelector('[data-preview-summary]');
  const diffEl = root.querySelector('[data-preview-diff]');
  const confirmBtn = root.querySelector('[data-adjust-confirm]');
  const discardBtn = root.querySelector('[data-adjust-discard]');
  const previewBtn = root.querySelector('[data-adjust-preview]');
  const statusEl = root.querySelector('[data-adjust-status]');
  const digestInput = root.querySelector('[data-editor-digest]');
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  const announce = (value) => {
    statusEl.textContent = value;
    statusEl.hidden = false;
  };
  const clearErrors = () => {
    root.querySelectorAll('[data-client-field-error]').forEach((item) => item.remove());
    root.querySelectorAll('[aria-invalid="true"]').forEach((item) => {
      item.removeAttribute('aria-invalid');
      item.removeAttribute('aria-errormessage');
    });
  };
  return {
    initialize(actions) {
      on(form, 'submit', (event) => { event.preventDefault(); actions.preview(); });
      on(form, 'input', () => actions.changed());
      on(form, 'change', () => actions.changed());
      on(confirmBtn, 'click', () => actions.confirm());
      on(discardBtn, 'click', () => {
        chart.setPreview(null);
        region.hidden = true;
        confirmBtn.hidden = true;
        digestInput.value = '';
        announce('Preview discarded. Nothing changed.');
      });
    },
    cleanup() {
      for (const [target, type, handler] of listeners.splice(0)) {
        target.removeEventListener(type, handler);
      }
    },
    readValues() {
      const data = new FormData(form);
      return {
        effective_date: data.get('effective_date') || '',
        pace: data.get('pace') || '',
        duration_days: data.get('duration_days') || '',
        end_target_pouches: data.get('end_target_pouches') || '',
      };
    },
    readDigest() { return digestInput.value; },
    setDigest(value) { digestInput.value = value; },
    clearPreview() {
      chart.setPreview(null);
      region.hidden = true;
      confirmBtn.hidden = true;
      digestInput.value = '';
    },
    renderPreview(preview) {
      clearErrors();
      chart.setPreview(preview.stages);
      const { firstDifference, changedStages } = summarizePreview(payload.stages, preview);
      diffEl.textContent = '';
      if (!firstDifference) {
        summaryEl.textContent = 'This matches your current schedule — nothing to change.';
        confirmBtn.hidden = true;
      } else {
        summaryEl.textContent = `${changedStages} stage${changedStages === 1 ? '' : 's'} change · first difference ${fmtDayLong(firstDifference)}`;
        for (const st of preview.stages || []) {
          const li = document.createElement('li');
          const mg = st.nicotine_ceiling_mg == null ? 'Unknown' : `${st.nicotine_ceiling_mg} mg ceiling`;
          li.textContent = `${fmtDayShort(st.start_date)} – ${fmtDayShort(st.end_date)}: ${st.target_pouches} pouches a day · ${mg}`;
          diffEl.appendChild(li);
        }
        confirmBtn.hidden = false;
      }
      region.hidden = false;
    },
    setBusy(value) {
      previewBtn.disabled = value;
      confirmBtn.disabled = value;
      root.setAttribute('aria-busy', String(value));
    },
    announce,
    mapFieldErrors(errors) {
      clearErrors();
      let first = null;
      for (const [field, messages] of Object.entries(errors)) {
        const control = form.elements.namedItem(field === 'changes' ? 'pace' : field);
        if (!control || !control.parentNode) continue;
        const error = document.createElement('p');
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

const overview = document.querySelector('.journey-overview');

if (overview) {
  document.documentElement.classList.add('journey-js');

  // The path chart, from the server-rendered JSON island.
  const island = overview.querySelector('[data-path-data]');
  let chart = null;
  let payload = null;
  if (island) {
    payload = JSON.parse(island.textContent);
    chart = createPathChart(overview.querySelector('.path-figure'), payload);
    window.JOURNEY_OVERVIEW = { chart, payload };
  }

  // Entrance: reveal .rise sections as they enter view.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  overview.querySelectorAll('.rise').forEach((el) => io.observe(el));

  // Adjust section collapse (grid-rows animation).
  const adjustToggle = overview.querySelector('[data-adjust-toggle]');
  const adjustBody = document.getElementById('adjust-body');
  if (adjustToggle && adjustBody) {
    adjustToggle.addEventListener('click', () => {
      const open = adjustToggle.getAttribute('aria-expanded') === 'true';
      adjustToggle.setAttribute('aria-expanded', String(!open));
      adjustBody.classList.toggle('is-open', !open);
    });
  }

  // Animated accordions: details[data-accordion] unfold via grid-rows.
  // The open attribute is kept during the close transition so the content
  // stays visible while collapsing; reduced motion keeps native toggling.
  const reducedMotionNow = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  overview.querySelectorAll('details[data-accordion]').forEach((details) => {
    const summary = details.querySelector('summary');
    const collapse = details.querySelector('[data-accordion-collapse]');
    if (!summary || !collapse) return;
    let animating = false;
    const afterTransition = (fn) => {
      let done = false;
      const wrap = (event) => {
        if (event && event.propertyName && event.propertyName !== 'grid-template-rows') return;
        if (done) return;
        done = true;
        collapse.removeEventListener('transitionend', wrap);
        animating = false;
        fn();
      };
      collapse.addEventListener('transitionend', wrap);
      setTimeout(wrap, 350); // safety: transition duration + margin
    };
    summary.addEventListener('click', (event) => {
      if (animating) {
        event.preventDefault();
        return;
      }
      if (reducedMotionNow()) return; // native instant toggle
      event.preventDefault();
      animating = true;
      if (!details.open) {
        details.open = true; // children render (UA unhides)
        void collapse.offsetHeight; // flush the 0fr state so the transition has a start
        collapse.classList.add('is-open'); // 0fr -> 1fr
        afterTransition(() => {});
      } else {
        collapse.classList.remove('is-open'); // 1fr -> 0fr
        afterTransition(() => {
          details.open = false; // UA re-hides the collapsed content
        });
      }
    });
  });

  // Revision editor: the tested controller, driven by the path view adapter.
  const editorRoot = overview.querySelector('[data-path-editor]');
  if (editorRoot && chart && payload) {
    const controller = createPlanEditorController({
      kind: 'revision',
      planId: editorRoot.dataset.planId,
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content || '',
      view: createPathEditorView(editorRoot, { chart, payload }),
    });
    controller.initialize();
  }
}

export {};
