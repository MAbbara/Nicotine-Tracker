const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadModule() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'goals', 'page.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}


test('initGoalsPage returns early without requesting analytics when its region is absent', async () => {
  const { initGoalsPage } = await loadModule();
  let requests = 0;
  const root = {
    querySelector(selector) {
      assert.equal(selector, '[data-goals-analytics]');
      return null;
    },
    querySelectorAll() { return []; },
  };

  assert.equal(await initGoalsPage(root, async () => { requests += 1; }), false);
  assert.equal(requests, 0);
});


test('initGoalsPage loads analytics once and queries values inside its local region', async () => {
  const { initGoalsPage } = await loadModule();
  const total = { textContent: '' };
  const active = { textContent: '' };
  const queries = [];
  const region = {
    dataset: { endpoint: '/goals/api/goals' },
    querySelector(selector) {
      queries.push(selector);
      return selector === '[data-goals-total]' ? total : active;
    },
  };
  const root = {
    querySelector(selector) {
      assert.equal(selector, '[data-goals-analytics]');
      return region;
    },
    querySelectorAll() { return []; },
  };
  let requests = 0;
  const request = async (endpoint) => {
    requests += 1;
    assert.equal(endpoint, '/goals/api/goals');
    return {
      ok: true,
      async json() {
        return { success: true, analytics: { total_goals: 4, active_goals: 2 } };
      },
    };
  };

  assert.equal(await initGoalsPage(root, request), true);
  assert.equal(await initGoalsPage(root, request), false);
  assert.equal(requests, 1);
  assert.deepEqual(queries, ['[data-goals-total]', '[data-goals-active]']);
  assert.equal(total.textContent, '4');
  assert.equal(active.textContent, '2');
});


test('initGoalsPage contains a rejected optional analytics request', async () => {
  const { initGoalsPage } = await loadModule();
  const region = {
    dataset: { endpoint: '/goals/api/goals' },
    querySelector() { throw new Error('analytics values must not be queried'); },
  };
  const root = {
    querySelector() { return region; },
    querySelectorAll() { return []; },
  };

  const result = await initGoalsPage(root, async () => {
    throw new Error('offline');
  });

  assert.equal(result, false);
  assert.equal(region.dataset.analyticsState, 'error');
});


test('goal delete confirmation binds once and preserves cancellation', async () => {
  const { bindGoalDeleteConfirmations } = await loadModule();
  let listener;
  const form = {
    dataset: { confirm: 'Delete this goal?' },
    addEventListener(type, callback) {
      assert.equal(type, 'submit');
      listener = callback;
    },
  };
  const root = { querySelectorAll: () => [form] };
  let confirmations = 0;
  let prevented = false;
  const confirmAction = () => {
    confirmations += 1;
    return false;
  };

  bindGoalDeleteConfirmations(root, confirmAction);
  bindGoalDeleteConfirmations(root, confirmAction);
  listener({ preventDefault() { prevented = true; } });

  assert.equal(confirmations, 1);
  assert.equal(prevented, true);
  assert.equal(form.dataset.confirmBound, 'true');
});


test('goal notifications are fetched once and rendered inside their scoped region', async () => {
  const { initGoalNotifications } = await loadModule();
  const created = [];
  const documentRef = {
    createElement(tagName) {
      const element = {
        tagName,
        children: [],
        append(...children) { this.children.push(...children); },
      };
      created.push(element);
      return element;
    },
  };
  const region = {
    dataset: { endpoint: '/goals/api/check_notifications' },
    hidden: true,
    ownerDocument: documentRef,
    replaceChildren(...children) { this.children = children; },
  };
  const root = {
    querySelector(selector) {
      assert.equal(selector, '[data-goals-notifications]');
      return region;
    },
  };
  let requests = 0;
  const request = async (endpoint) => {
    requests += 1;
    assert.equal(endpoint, '/goals/api/check_notifications');
    return {
      ok: true,
      async json() {
        return {
          success: true,
          notifications: [{ type: 'warning', message: 'Close to today’s guide.' }],
        };
      },
    };
  };

  assert.equal(await initGoalNotifications(root, request), true);
  assert.equal(await initGoalNotifications(root, request), false);
  assert.equal(requests, 1);
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.notificationsState, 'ready');
  assert.equal(region.children[0].children[0].textContent, 'Close to today’s guide.');
  assert.equal(created.some((element) => element.tagName === 'ul'), true);
});


test('goal notification polling contains network failures without retrying or throwing', async () => {
  const { initGoalNotifications } = await loadModule();
  const region = {
    dataset: { endpoint: '/goals/api/check_notifications' },
    hidden: true,
  };
  const root = { querySelector: () => region };
  let requests = 0;
  const request = async () => {
    requests += 1;
    throw new Error('offline');
  };

  assert.equal(await initGoalNotifications(root, request), false);
  assert.equal(await initGoalNotifications(root, request), false);
  assert.equal(requests, 1);
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.notificationsState, 'error');
});
