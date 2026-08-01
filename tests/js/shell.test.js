// Toolchain contract tests run by the real Node test runner (`npm test`).
// They protect the CSS build boundary that every page depends on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
}

const projectRoot = path.resolve(__dirname, '..', '..');
const tailwindBin = path.join(projectRoot, 'node_modules', '.bin', 'tailwindcss');
const tailwindSource = path.join(projectRoot, 'static', 'css', 'tailwind.css');

async function importBrowserModule(relativePath) {
  let source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  if (source.includes("'../today/offline_queue.js'")) {
    const queueSource = fs.readFileSync(
      path.join(projectRoot, 'static/js/today/offline_queue.js'),
      'utf8',
    );
    const queueUrl = `data:text/javascript;base64,${Buffer.from(queueSource).toString('base64')}`;
    source = source.replace("'../today/offline_queue.js'", `'${queueUrl}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('tailwindcss compiles the real source into a usable stylesheet', { timeout: 60000 }, () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-css-'));
  const outFile = path.join(outDir, 'style.css');
  try {
    const result = spawnSync(
      tailwindBin,
      ['-i', tailwindSource, '-o', outFile, '--minify'],
      { encoding: 'utf8' }
    );
    assert.equal(
      result.status,
      0,
      `tailwindcss exited ${result.status}: ${result.stderr || result.error}`
    );
    const css = fs.readFileSync(outFile, 'utf8');
    assert.match(css, /tailwindcss v4/, 'compiled output is missing the Tailwind banner');
    assert.ok(css.length > 10000, `compiled output suspiciously small (${css.length} bytes)`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('package.json exposes the documented script contract', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  for (const script of ['build', 'build:css', 'watch:css', 'test', 'test:e2e', 'test:e2e:update']) {
    assert.ok(pkg.scripts?.[script], `missing npm script "${script}"`);
  }
  assert.match(pkg.scripts['build:css'], /tailwindcss -i \.\/static\/css\/tailwind\.css/);
  assert.ok(pkg.devDependencies?.['@playwright/test'], 'missing @playwright/test devDependency');
  assert.ok(pkg.devDependencies?.['@axe-core/playwright'], 'missing @axe-core/playwright devDependency');
  assert.ok(pkg.devDependencies?.['@tailwindcss/forms'], 'missing @tailwindcss/forms devDependency');
});

test('theme resolution accepts the three choices and otherwise follows the system', async () => {
  const { resolveTheme } = await importBrowserModule('static/js/shell/theme.js');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme(undefined, false), 'light');
});

test('theme controller publishes saved and effective System state as the device changes', async () => {
  const { createThemeController } = await importBrowserModule('static/js/shell/theme.js');
  const classes = new Set();
  const events = [];
  const root = {
    dataset: { savedTheme: 'system' },
    classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name) },
    style: {},
    dispatchEvent: (event) => events.push({ type: event.type, detail: event.detail }),
  };
  const themeColor = {
    content: '#F5F1E7',
    setAttribute(name, value) { this[name] = value; },
  };
  const saved = [];
  const storage = {
    getItem: () => null,
    setItem: (key, value) => saved.push([key, value]),
  };
  const mediaListeners = new Set();
  const media = {
    matches: true,
    addEventListener: (type, handler) => mediaListeners.add(handler),
    removeEventListener: (type, handler) => mediaListeners.delete(handler),
  };
  const controller = createThemeController({
    root,
    storage,
    mediaQuery: media,
    themeColorMeta: themeColor,
  });

  assert.equal(root.dataset.savedTheme, 'system');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(classes.has('dark'), true);
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(themeColor.content, '#111915');
  assert.deepEqual(events, [{
    type: 'nicotine-tracker:theme-change',
    detail: { saved: 'system', effective: 'dark' },
  }]);
  assert.equal(mediaListeners.size, 1);

  media.matches = false;
  for (const handler of mediaListeners) handler();
  assert.equal(root.dataset.savedTheme, 'system');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(classes.has('dark'), false);
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(themeColor.content, '#F5F1E7');
  assert.deepEqual(events.at(-1), {
    type: 'nicotine-tracker:theme-change',
    detail: { saved: 'system', effective: 'light' },
  });
  assert.equal(events.length, 2);

  controller.cleanup();
  assert.equal(mediaListeners.size, 0);
});

test('explicit theme selections publish saved state and ignore later device changes', async () => {
  const { createThemeController } = await importBrowserModule('static/js/shell/theme.js');
  const classes = new Set();
  const events = [];
  const root = {
    dataset: { savedTheme: 'system' },
    classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name) },
    style: {},
    dispatchEvent: (event) => events.push(event.detail),
  };
  const themeColor = {
    content: '#F5F1E7',
    setAttribute(name, value) { this[name] = value; },
  };
  const saved = [];
  const persisted = [];
  const storage = {
    getItem: () => null,
    setItem: (key, value) => saved.push([key, value]),
  };
  const mediaListeners = new Set();
  const media = {
    matches: false,
    addEventListener: (type, handler) => mediaListeners.add(handler),
    removeEventListener: (type, handler) => mediaListeners.delete(handler),
  };
  const controller = createThemeController({
    root,
    storage,
    mediaQuery: media,
    themeColorMeta: themeColor,
    persistTheme: async (theme) => persisted.push(theme),
  });

  await controller.select('dark');
  assert.equal(root.dataset.savedTheme, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(classes.has('dark'), true);
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(themeColor.content, '#111915');
  assert.deepEqual(saved, [['nicotine-tracker-theme', 'dark']]);
  assert.deepEqual(persisted, ['dark']);
  assert.deepEqual(events.at(-1), { saved: 'dark', effective: 'dark' });

  const eventCount = events.length;
  media.matches = true;
  for (const handler of mediaListeners) handler();
  assert.equal(root.dataset.savedTheme, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(events.length, eventCount);

  await controller.select('light');
  assert.equal(root.dataset.savedTheme, 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(classes.has('dark'), false);
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(themeColor.content, '#F5F1E7');
  assert.deepEqual(events.at(-1), { saved: 'light', effective: 'light' });
});

test('navigation chooses exactly one current destination and hides none', async () => {
  const { activateNavigation } = await importBrowserModule('static/js/shell/navigation.js');
  const labels = ['Today', 'Journey', 'Insights', 'You'];
  const links = labels.map((textContent) => ({
    textContent,
    hidden: false,
    attributes: new Map([['aria-current', 'page']]),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  }));
  const nav = { querySelectorAll: () => links };

  assert.equal(activateNavigation(nav, { pathname: '/goals/2/edit' }), 'journey');
  assert.deepEqual(
    links.filter((link) => link.attributes.get('aria-current') === 'page').map((link) => link.textContent),
    ['Journey'],
  );
  assert.ok(links.every((link) => link.hidden === false));
});

test('offline controller announces transitions, avoids duplicates, and cleans up', async () => {
  const { createOfflineStatusController } = await importBrowserModule('static/js/shell/offline_status.js');
  const listeners = { online: new Set(), offline: new Set() };
  const win = {
    navigator: { onLine: true },
    addEventListener: (type, handler) => listeners[type].add(handler),
    removeEventListener: (type, handler) => listeners[type].delete(handler),
  };
  const region = { textContent: '', hidden: true };
  const controller = createOfflineStatusController({ win, region });
  controller.initialize();
  controller.initialize();
  assert.equal(listeners.online.size, 1);
  assert.equal(listeners.offline.size, 1);

  for (const handler of listeners.offline) handler();
  assert.equal(region.hidden, false);
  assert.match(region.textContent, /offline/i);
  for (const handler of listeners.online) handler();
  assert.match(region.textContent, /Back online/i);

  controller.cleanup();
  assert.equal(listeners.online.size, 0);
  assert.equal(listeners.offline.size, 0);
});

test('offline shell initializes one queue runtime and online joins replay', async () => {
  const { createOfflineStatusController } = await importBrowserModule('static/js/shell/offline_status.js');
  const listeners = { online: new Set(), offline: new Set() };
  const win = {
    navigator: { onLine: true },
    addEventListener: (type, handler) => listeners[type].add(handler),
    removeEventListener: (type, handler) => listeners[type].delete(handler),
  };
  const region = { textContent: '', hidden: true };
  let startCount = 0;
  let replayCount = 0;
  let invalidationCount = 0;
  let subscriber;
  const queueRuntime = {
    start() { startCount += 1; return Promise.resolve([]); },
    replay() { replayCount += 1; return Promise.resolve(true); },
    invalidateBufferedResults() { invalidationCount += 1; },
    subscribe(handler) { subscriber = handler; return () => { subscriber = null; }; },
  };
  const controller = createOfflineStatusController({ win, region, queueRuntime });

  controller.initialize();
  controller.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(startCount, 1);

  subscriber({ type: 'pending', record: { client_event_id: 'event-one' } });
  assert.match(region.textContent, /1 saved log.*waiting/i);
  for (const handler of listeners.offline) handler();
  for (const handler of listeners.online) handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replayCount, 1);

  controller.cleanup();
  assert.equal(subscriber, null);
  assert.equal(invalidationCount, 1);
});

test('logout and account deletion clear once but continue when browser clearing fails', async () => {
  const { createOfflineStatusController } = await importBrowserModule('static/js/shell/offline_status.js');
  const winListeners = { online: new Set(), offline: new Set() };
  const docListeners = { click: new Set(), submit: new Set() };
  const win = {
    navigator: { onLine: true },
    addEventListener: (type, handler) => winListeners[type].add(handler),
    removeEventListener: (type, handler) => winListeners[type].delete(handler),
  };
  const doc = {
    addEventListener: (type, handler) => docListeners[type].add(handler),
    removeEventListener: (type, handler) => docListeners[type].delete(handler),
  };
  const navigated = [];
  let clearCount = 0;
  const queueRuntime = {
    subscribe: () => () => {},
    start: () => Promise.resolve([]),
    async clearAll() {
      clearCount += 1;
      if (clearCount === 1) throw new Error('private storage failure');
      return true;
    },
  };
  const controller = createOfflineStatusController({
    win,
    doc,
    region: { textContent: '', hidden: true },
    queueRuntime,
    navigate: (href) => navigated.push(href),
  }).initialize();

  let clickPrevented = false;
  const logoutLink = { href: '/auth/logout', matches: () => true };
  for (const handler of docListeners.click) {
    handler({
      target: { closest: () => logoutLink },
      preventDefault: () => { clickPrevented = true; },
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clickPrevented, true);
  assert.deepEqual(navigated, ['/auth/logout']);

  let submitCount = 0;
  let submitPrevented = false;
  const deletionForm = {
    matches: () => true,
    querySelector: () => ({ value: 'delete_account' }),
    submit: () => { submitCount += 1; },
  };
  for (const handler of docListeners.submit) {
    handler({
      target: deletionForm,
      preventDefault: () => { submitPrevented = true; },
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submitPrevented, true);
  assert.equal(submitCount, 1);
  assert.equal(clearCount, 2);

  controller.cleanup();
  assert.equal(docListeners.click.size, 0);
  assert.equal(docListeners.submit.size, 0);
});
