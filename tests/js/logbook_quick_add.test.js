const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '..', '..');
const quickAddSource = fs.readFileSync(
  path.join(projectRoot, 'static', 'js', 'logbook', 'quick_add.js'),
  'utf8',
);

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function makeFixture() {
  const page = await browser.newPage();
  await page.setContent(`
    <meta name="csrf-token" content="csrf-token">
    <main data-logbook-page>
      <button id="quick-add" data-quick-add data-pouch-id="12" data-quantity="1">
        <span>Steady Mint</span><span>+1</span>
      </button>
      <section data-logbook-history data-fragment-version="logbook-history-v1">
        <form aria-label="Filter log history" data-logbook-filters>
          <input name="q" value="mint">
          <input name="from_date" type="date" value="2026-01-01">
          <input name="to_date" type="date" value="2026-01-31">
        </form>
        <article data-log-id="7">Existing row</article>
      </section>
    </main>
    <div style="height: 2400px"></div>
  `);
  await page.evaluate(async (source) => {
    const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    window.__quickAddModule = await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
  }, quickAddSource);
  await page.evaluate(() => {
    let releaseRequest;
    window.__requestGate = new Promise((resolve) => { releaseRequest = resolve; });
    window.__requests = [];
    window.__uuidCalls = 0;
    window.__timerDelays = [];
    window.__activationResult = 'pending';
    window.__releaseRequest = (status, body, headers = {}) => {
      releaseRequest(new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }));
    };
    window.__controller = window.__quickAddModule.createLogbookQuickAddController({
      documentRef: document,
      windowRef: window,
      fetchImpl: (...args) => {
        window.__requests.push(args);
        return window.__requestGate;
      },
      uuid: () => {
        window.__uuidCalls += 1;
        return '018f3f5c-68af-7e4d-bf5d-0123456789ab';
      },
      setTimeoutImpl: (_callback, delay) => {
        window.__timerDelays.push(delay);
        return 1;
      },
    });
  });
  return page;
}

async function activate(page) {
  await page.evaluate(() => {
    const button = document.querySelector('#quick-add');
    const first = window.__controller.activate(button);
    const second = window.__controller.activate(button);
    window.__sameActivationPromise = first === second;
    first.then((result) => { window.__activationResult = result; });
  });
}

async function waitForActivation(page) {
  await page.waitForFunction(() => window.__activationResult !== 'pending');
  return page.evaluate(() => window.__activationResult);
}

test('real DOM transaction is single, authoritative, highlighted, and injection-safe', async (t) => {
  const page = await makeFixture();
  t.after(() => page.close());
  await page.goto('about:blank#main-content');
  await page.setContent(`
    <meta name="csrf-token" content="csrf-token">
    <main data-logbook-page>
      <button id="quick-add" data-quick-add data-pouch-id="12" data-quantity="1"><span>Steady Mint</span><span>+1</span></button>
      <section data-logbook-history data-fragment-version="logbook-history-v1"><article data-log-id="7">Existing row</article></section>
    </main>
  `);
  await page.evaluate(async (source) => {
    const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    window.__quickAddModule = await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    let releaseRequest;
    const gate = new Promise((resolve) => { releaseRequest = resolve; });
    window.__requests = [];
    window.__uuidCalls = 0;
    window.__timerDelays = [];
    window.__activationResult = 'pending';
    window.__releaseRequest = (status, body) => releaseRequest(new Response(
      JSON.stringify(body),
      { status, headers: { 'Content-Type': 'application/json' } },
    ));
    window.__controller = window.__quickAddModule.createLogbookQuickAddController({
      fetchImpl: (...args) => { window.__requests.push(args); return gate; },
      uuid: () => { window.__uuidCalls += 1; return '018f3f5c-68af-7e4d-bf5d-0123456789ab'; },
      setTimeoutImpl: (_callback, delay) => { window.__timerDelays.push(delay); return 1; },
    });
  }, quickAddSource);
  await page.locator('#quick-add').focus();
  await activate(page);

  const pending = await page.evaluate(() => ({
    requests: window.__requests.length,
    uuidCalls: window.__uuidCalls,
    samePromise: window.__sameActivationPromise,
    body: JSON.parse(window.__requests[0][1].body),
    disabled: document.querySelector('#quick-add').disabled,
    text: document.querySelector('#quick-add').textContent,
  }));
  assert.equal(pending.requests, 1);
  assert.equal(pending.uuidCalls, 1);
  assert.equal(pending.samePromise, true);
  assert.equal(pending.disabled, true);
  assert.equal(pending.text, 'Adding…');
  assert.deepEqual(pending.body, {
    pouch_id: 12,
    quantity: 1,
    client_event_id: '018f3f5c-68af-7e4d-bf5d-0123456789ab',
    view: { page: 1, q: '', from_date: '', to_date: '' },
  });

  await page.evaluate(() => window.__releaseRequest(201, {
    success: true,
    message: '<img src=x onerror=alert(1)>',
    new_log_id: 42,
    created: true,
    history_html: '<section data-logbook-history data-fragment-version="logbook-history-v1"><article data-log-id="42"></article></section>',
    fragment_version: 'logbook-history-v1',
    visible: true,
  }));
  assert.equal(await waitForActivation(page), true);

  const completed = await page.evaluate(() => ({
    rowHighlighted: document.querySelector('[data-log-id="42"]').classList.contains('logbook-row--new'),
    timerDelays: window.__timerDelays,
    message: document.querySelector('[data-notification-message]').textContent,
    injectedImageCount: document.querySelectorAll('[data-logbook-quick-notification] img').length,
    buttonFocused: document.activeElement === document.querySelector('#quick-add'),
    buttonEnabled: !document.querySelector('#quick-add').disabled,
  }));
  assert.equal(completed.rowHighlighted, true);
  assert.deepEqual(completed.timerDelays, [700]);
  assert.equal(completed.message, '<img src=x onerror=alert(1)>');
  assert.equal(completed.injectedImageCount, 0);
  assert.equal(completed.buttonFocused, true);
  assert.equal(completed.buttonEnabled, true);
});

test('pending live filter values, focus, selection, and user scroll survive replacement', async (t) => {
  const page = await makeFixture();
  t.after(() => page.close());
  await page.locator('#quick-add').focus();
  await activate(page);
  await page.locator('[name="q"]').click();
  await page.locator('[name="q"]').fill('edited while pending');
  await page.locator('[name="from_date"]').fill('2026-02-01');
  await page.locator('[name="to_date"]').fill('2026-02-28');
  await page.locator('[name="q"]').focus();
  await page.locator('[name="q"]').evaluate((control) => control.setSelectionRange(3, 9));
  await page.evaluate(() => window.scrollTo(0, 900));
  const pendingScroll = await page.evaluate(() => window.scrollY);
  assert.ok(pendingScroll > 0);

  await page.evaluate(() => window.__releaseRequest(201, {
    success: true,
    message: 'Log saved.',
    new_log_id: 42,
    created: true,
    history_html: `
      <section data-logbook-history data-fragment-version="logbook-history-v1">
        <form aria-label="Filter log history" data-logbook-filters>
          <input name="q" value="mint">
          <input name="from_date" type="date" value="2026-01-01">
          <input name="to_date" type="date" value="2026-01-31">
        </form>
        <article data-log-id="42">New row</article>
      </section>
    `,
    fragment_version: 'logbook-history-v1',
    visible: true,
  }));
  assert.equal(await waitForActivation(page), true);

  const state = await page.evaluate(() => {
    const query = document.querySelector('[name="q"]');
    return {
      values: Object.fromEntries(
        [...document.querySelectorAll('[data-logbook-history] [name]')]
          .map((control) => [control.name, control.value]),
      ),
      focusedName: document.activeElement?.name,
      selection: [query.selectionStart, query.selectionEnd],
      scrollY: window.scrollY,
    };
  });
  assert.deepEqual(state.values, {
    q: 'edited while pending',
    from_date: '2026-02-01',
    to_date: '2026-02-28',
  });
  assert.equal(state.focusedName, 'q');
  assert.deepEqual(state.selection, [3, 9]);
  assert.equal(state.scrollY, pendingScroll);
});

for (const [name, historyHtml] of [
  [
    'missing canonical history marker',
    '<section data-fragment-version="logbook-history-v1"><article data-log-id="42"></article></section>',
  ],
  [
    'extra root',
    '<section data-logbook-history data-fragment-version="logbook-history-v1"></section><aside>unexpected</aside>',
  ],
]) {
  test(`same-version fragment with ${name} leaves canonical DOM untouched`, async (t) => {
    const page = await makeFixture();
    t.after(() => page.close());
    const original = await page.locator('[data-logbook-history]').evaluate((node) => node.outerHTML);
    await activate(page);
    await page.evaluate(({ historyHtml: html }) => window.__releaseRequest(201, {
      success: true,
      message: 'Log saved.',
      new_log_id: 42,
      created: true,
      history_html: html,
      fragment_version: 'logbook-history-v1',
      visible: true,
    }), { historyHtml });

    assert.equal(await waitForActivation(page), false);
    assert.equal(
      await page.locator('[data-logbook-history]').evaluate((node) => node.outerHTML),
      original,
    );
    assert.equal(
      await page.locator('[data-notification-message]').textContent(),
      'The log was saved, but history could not refresh. Reload when convenient.',
    );
  });
}
