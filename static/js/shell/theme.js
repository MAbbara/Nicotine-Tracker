const VALID_THEMES = new Set(['light', 'dark', 'system']);
const THEME_COLORS = { light: '#F5F1E7', dark: '#111915' };
const controllerRegistry = new WeakMap();

export function resolveTheme(saved, prefersDark = false) {
  if (saved === 'light' || saved === 'dark') return saved;
  return prefersDark ? 'dark' : 'light';
}

export function createThemeController({
  root,
  storage = null,
  mediaQuery = null,
  themeColorMeta = null,
  persistTheme = async () => {},
  buttons = [],
  feedback = null,
  storageKey = 'nicotine-tracker-theme',
} = {}) {
  if (!root) throw new TypeError('A document root is required');

  const media = mediaQuery || { matches: false };
  let choice = VALID_THEMES.has(root.dataset?.savedTheme)
    ? root.dataset.savedTheme
    : 'system';
  let listening = false;

  try {
    const localChoice = storage?.getItem(storageKey);
    if (VALID_THEMES.has(localChoice)) choice = localChoice;
  } catch (_) {
    // Storage can be unavailable in private browsing. The server choice wins.
  }

  function updateButtons() {
    for (const button of buttons) {
      const selected = button.dataset?.themeChoice === choice;
      button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
    }
  }

  function apply() {
    const resolved = resolveTheme(choice, Boolean(media.matches));
    root.dataset.savedTheme = choice;
    root.dataset.theme = resolved;
    root.classList?.toggle('dark', resolved === 'dark');
    if (root.style) root.style.colorScheme = resolved;
    themeColorMeta?.setAttribute('content', THEME_COLORS[resolved]);
    updateButtons();
    root.dispatchEvent?.(new CustomEvent('nicotine-tracker:theme-change', {
      detail: { saved: choice, effective: resolved },
    }));
    return resolved;
  }

  function handleSystemChange() {
    if (choice === 'system') apply();
  }

  function listen() {
    if (listening || typeof media.addEventListener !== 'function') return;
    media.addEventListener('change', handleSystemChange);
    listening = true;
  }

  async function select(nextChoice) {
    if (!VALID_THEMES.has(nextChoice)) {
      throw new TypeError('Theme must be light, dark, or system');
    }
    choice = nextChoice;
    apply();
    try {
      storage?.setItem(storageKey, nextChoice);
    } catch (_) {
      // Applying the choice should still work when local storage is blocked.
    }

    if (feedback) feedback.textContent = 'Saving appearance…';
    try {
      await persistTheme(nextChoice);
      if (feedback) feedback.textContent = 'Appearance saved.';
    } catch (error) {
      if (feedback) feedback.textContent = 'Appearance changed here, but could not be saved yet.';
      throw error;
    }
    return nextChoice;
  }

  const buttonHandlers = new Map();
  function bindButtons() {
    for (const button of buttons) {
      if (buttonHandlers.has(button)) continue;
      const handler = () => select(button.dataset.themeChoice).catch(() => {});
      button.addEventListener?.('click', handler);
      buttonHandlers.set(button, handler);
    }
  }

  function cleanup() {
    if (listening && typeof media.removeEventListener === 'function') {
      media.removeEventListener('change', handleSystemChange);
    }
    listening = false;
    for (const [button, handler] of buttonHandlers) {
      button.removeEventListener?.('click', handler);
    }
    buttonHandlers.clear();
  }

  listen();
  bindButtons();
  apply();

  return { apply, select, cleanup, get choice() { return choice; } };
}

export function initThemeController(doc = globalThis.document, win = globalThis.window) {
  const root = doc?.documentElement;
  if (!root || !win) return null;
  const existing = controllerRegistry.get(root);
  if (existing) return existing;

  const csrfToken = doc.querySelector?.('meta[name="csrf-token"]')?.content || '';
  const persistTheme = async (theme) => {
    const response = await win.fetch('/api/preferences/theme', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ theme }),
    });
    if (!response.ok) throw new Error('Theme preference could not be saved');
  };

  const controller = createThemeController({
    root,
    storage: win.localStorage,
    mediaQuery: win.matchMedia?.('(prefers-color-scheme: dark)'),
    themeColorMeta: doc.querySelector?.('meta[name="theme-color"]') || null,
    persistTheme,
    buttons: doc.querySelectorAll?.('[data-theme-choice]') || [],
    feedback: doc.querySelector?.('[data-theme-feedback]') || null,
  });
  controllerRegistry.set(root, controller);
  return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initThemeController(document, window), { once: true });
  } else {
    initThemeController(document, window);
  }
}
