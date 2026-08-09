function detailFor(button) {
  return [
    button?.dataset?.dateLabel,
    button?.dataset?.ceilingLabel,
    button?.dataset?.changeLabel,
  ].filter(Boolean).join(' · ');
}

export function createJourneyProgressController({ root } = {}) {
  const buttons = [...(root?.querySelectorAll?.('[data-journey-day]') || [])];
  const detail = root?.querySelector?.('[data-journey-day-detail]') || null;
  let selected = buttons.find((button) => button.getAttribute('aria-pressed') === 'true') || buttons[0] || null;
  let focused = null;
  let hovered = null;
  let listeners = null;

  function show(button) {
    if (!detail || !button) return;
    detail.textContent = detailFor(button);
  }

  function showCurrentPreview() {
    show(focused || hovered || selected);
  }

  function commit(button) {
    selected = button;
    buttons.forEach((day) => {
      day.setAttribute('aria-pressed', String(day === button));
    });
    show(button);
  }

  function initialize() {
    if (listeners || buttons.length === 0) return;
    listeners = new AbortController();
    const { signal } = listeners;

    commit(selected || buttons[0]);
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => commit(button), { signal });
      button.addEventListener('pointerenter', () => {
        hovered = button;
        show(button);
      }, { signal });
      button.addEventListener('pointerleave', () => {
        if (hovered === button) hovered = null;
        showCurrentPreview();
      }, { signal });
      button.addEventListener('focus', () => {
        focused = button;
        show(button);
      }, { signal });
      button.addEventListener('focusout', () => {
        if (focused === button) focused = null;
        showCurrentPreview();
      }, { signal });
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        buttons[(index + delta + buttons.length) % buttons.length].focus();
      }, { signal });
    });
  }

  function cleanup() {
    listeners?.abort();
    listeners = null;
    focused = null;
    hovered = null;
  }

  return { initialize, cleanup };
}

const controllerRegistry = new WeakMap();

export function bootstrapJourneyProgress(root = document) {
  const trajectory = root?.querySelector?.('[data-journey-trajectory]');
  const buttons = root?.querySelectorAll?.('[data-journey-day]') || [];
  if (!trajectory || buttons.length === 0 || controllerRegistry.has(trajectory)) return;
  const controller = createJourneyProgressController({ root });
  controller.initialize();
  controllerRegistry.set(trajectory, controller);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrapJourneyProgress(document), { once: true });
  } else {
    bootstrapJourneyProgress(document);
  }
}
