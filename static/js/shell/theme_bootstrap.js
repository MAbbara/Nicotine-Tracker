(() => {
  const root = document.documentElement;
  const allowed = new Set(['light', 'dark', 'system']);
  let saved = allowed.has(root.dataset.savedTheme) ? root.dataset.savedTheme : 'system';

  try {
    const local = window.localStorage.getItem('nicotine-tracker-theme');
    if (local !== null) saved = allowed.has(local) ? local : 'system';
  } catch (_) {
    // The rendered choice remains available when storage is blocked.
  }

  const prefersDark = Boolean(
    window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  const effective = saved === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : saved;

  root.dataset.savedTheme = saved;
  root.dataset.theme = effective;
  root.classList.toggle('dark', effective === 'dark');
  root.style.colorScheme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    effective === 'dark' ? '#111915' : '#F5F1E7',
  );
})();
