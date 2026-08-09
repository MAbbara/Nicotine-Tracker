const dayButtons = (root) => [...root.querySelectorAll('[data-day]')];

function dayDetail(button) {
  return `${button.dataset.date} · ${button.dataset.ceiling} mg ceiling · ${button.dataset.change}`;
}

function showDayDetail(button, root) {
  root.querySelector('[data-day-detail]').textContent = dayDetail(button);
}

function restoreSelectedDay(root) {
  const selected = root.querySelector('[data-day][aria-pressed="true"]');
  if (selected) showDayDetail(selected, root);
}

function setStatus(root, shapeText, message) {
  const status = root.querySelector('[data-plan-status]');
  const shape = status.querySelector('[aria-hidden="true"]');
  shape.textContent = shapeText;
  status.replaceChildren(shape, root.createTextNode(` ${message}`));
}

export function selectDay(button, root = document) {
  const buttons = dayButtons(root);
  buttons.forEach((day) => {
    day.setAttribute('aria-pressed', String(day === button));
  });
  showDayDetail(button, root);
}

export function setTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const toggle = document.querySelector('[data-theme-toggle]');
  if (toggle) {
    toggle.textContent = nextTheme === 'light' ? 'Use dark theme' : 'Use light theme';
  }
}

export function setFixtureState(state, root = document) {
  const unknown = state === 'unknown';
  const loggedMetric = root.querySelector('[data-logged-mg]');
  loggedMetric.previousElementSibling.textContent = unknown ? 'Known nicotine' : 'Logged';
  loggedMetric.textContent = unknown ? '31.25 mg' : '37.25 mg';
  root.querySelector('[data-difference-mg]').textContent = unknown
    ? 'Total incomplete'
    : '+4.06 mg';
  setStatus(
    root,
    unknown ? '■' : '●',
    unknown ? 'Nicotine total incomplete' : 'Above today’s ceiling',
  );

  const toggle = root.querySelector('[data-state-toggle]');
  toggle.setAttribute('aria-pressed', String(unknown));
  toggle.textContent = unknown
    ? 'Show complete-strength state'
    : 'Show incomplete-strength state';
}

export function init(root = document) {
  const buttons = dayButtons(root);
  buttons.forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index === 0));
    button.addEventListener('click', () => selectDay(button, root));
    button.addEventListener('pointerenter', () => showDayDetail(button, root));
    button.addEventListener('pointerleave', () => {
      if (root.activeElement !== button) restoreSelectedDay(root);
    });
    button.addEventListener('focus', () => showDayDetail(button, root));
    button.addEventListener('blur', () => {
      if (!button.matches(':hover')) restoreSelectedDay(root);
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      buttons[(index + delta + buttons.length) % buttons.length].focus();
    });
  });

  const themeToggle = root.querySelector('[data-theme-toggle]');
  themeToggle.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  const stateToggle = root.querySelector('[data-state-toggle]');
  stateToggle.addEventListener('click', () => {
    setFixtureState(stateToggle.getAttribute('aria-pressed') === 'true' ? 'known' : 'unknown', root);
  });

  setTheme(document.documentElement.dataset.theme || 'light');
  setFixtureState('known', root);
}

init();
