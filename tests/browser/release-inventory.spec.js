const { test, expect } = require('@playwright/test');

const {
  CORE_ACTION_STATES,
  CORE_BEHAVIOR_OBLIGATIONS,
  EXPECTED_ACTIONS,
  RELEASE_PAGES,
  RELEASE_STATES,
  SUPPORTING_ACTION_RECEIPTS,
  TRANSITION_ONLY_BEHAVIOR_ACTIONS,
  loginAs,
  resolveReleaseState,
} = require('./helpers/release_manifest');
const { watchForProductProblems } = require('./helpers/product_guard');


const REQUIRED_RELEASE_PAGES = [
  ['today', '/today/'], ['journey', '/journey/'],
  ['journey-onboarding', '/journey/onboarding'], ['insights', '/insights/'],
  ['you', '/you/'], ['profile', '/settings/profile'],
  ['account', '/settings/account'], ['preferences', '/settings/preferences'],
  ['reminders', '/settings/notifications'], ['data', '/settings/data'],
  ['statistics', '/settings/statistics'], ['logbook', '/log/view'],
  ['log-add', '/log/add'], ['log-bulk', '/log/bulk'],
  ['catalog', '/catalog/'], ['catalog-add', '/catalog/add'],
  ['cravings', '/cravings/cravings'], ['goals', '/goals/'],
  ['goal-create', '/goals/create'], ['dashboard', '/dashboard/'],
  ['not-found', '/__release_missing_page__'],
];
const REQUIRED_INSIGHTS_STATES = {
  insights: 'ready',
  'insights-empty': 'empty',
  'insights-sparse': 'sparse',
};
const REQUIRED_OFFLINE_STATES = {
  'data-offline-enabled': true,
  'data-offline-disabled': false,
};


async function visibleActionNames(page) {
  const controls = page.locator([
    'a[href]',
    'button',
    'summary',
    'input[type="checkbox"]',
    'input[type="radio"]',
    'input[type="submit"]',
    '[role="button"]',
    '[role="link"]',
  ].join(', '));
  const names = [];
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible()) continue;
    await expect(control).toHaveAccessibleName(/\S/);
    const snapshot = await control.ariaSnapshot();
    const match = snapshot.match(/^- [^\"]+ "([^\"]+)"/);
    const name = match?.[1] || (
      await control.evaluate((element) => (
        element.tagName === 'SUMMARY' ? element.innerText.trim() : ''
      ))
    );
    expect(name, `Unable to read action name from ARIA snapshot: ${snapshot}`).toMatch(/\S/);
    names.push(name);
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}


test('release page list matches the approved authenticated inventory exactly', () => {
  expect(RELEASE_PAGES).toEqual(REQUIRED_RELEASE_PAGES);
  expect(Object.keys(EXPECTED_ACTIONS).sort()).toEqual(
    RELEASE_STATES.map(({ name }) => name).sort(),
  );
  for (const [stateName, actions] of Object.entries(EXPECTED_ACTIONS)) {
    expect(Array.isArray(actions), `${stateName} expected actions are concrete`).toBe(true);
    expect(actions.every((action) => /\S/.test(action)), `${stateName} action names`).toBe(true);
  }
  expect(Object.fromEntries(
    RELEASE_STATES
      .filter(({ insightsState }) => insightsState)
      .map(({ name, insightsState }) => [name, insightsState]),
  )).toEqual(REQUIRED_INSIGHTS_STATES);
  expect(Object.fromEntries(
    RELEASE_STATES
      .filter(({ offlineQueueEnabled }) => typeof offlineQueueEnabled === 'boolean')
      .map(({ name, offlineQueueEnabled }) => [name, offlineQueueEnabled]),
  )).toEqual(REQUIRED_OFFLINE_STATES);
});


test('functional ownership reconciles the exact post-Task-4 release inventory', () => {
  const occurrences = Object.values(EXPECTED_ACTIONS).flat();
  expect(RELEASE_PAGES).toHaveLength(21);
  expect(RELEASE_STATES).toHaveLength(45);
  expect(occurrences).toHaveLength(602);
  expect(new Set(occurrences).size).toBe(149);
  expect(CORE_BEHAVIOR_OBLIGATIONS).toHaveLength(190);
  expect(SUPPORTING_ACTION_RECEIPTS).toHaveLength(415);
  expect(TRANSITION_ONLY_BEHAVIOR_ACTIONS).toEqual([
    { state: 'journey', action: 'Archive plan' },
    { state: 'journey', action: 'Mark complete' },
    { state: 'journey', action: 'Pause plan' },
  ]);
  expect(
    CORE_BEHAVIOR_OBLIGATIONS.length
      - TRANSITION_ONLY_BEHAVIOR_ACTIONS.length
      + SUPPORTING_ACTION_RECEIPTS.length,
  )
    .toBe(occurrences.length);

  for (const [stateName, actions] of Object.entries(EXPECTED_ACTIONS)) {
    expect(
      Object.keys(actions.coveredBy || {}).sort((left, right) => left.localeCompare(right)),
      `${stateName} functional owner keys`,
    ).toEqual([...actions].sort((left, right) => left.localeCompare(right)));
    for (const action of actions) {
      const coverage = actions.coveredBy[action];
      expect(coverage.state).toBe(stateName);
      expect(coverage.action).toBe(action);
      expect(coverage.test).toMatch(/\.spec\.js › /);
      const exactDimensions = [
        'error', 'focus', 'keyboard', 'loading', 'persistence', 'request',
      ];
      if (!CORE_ACTION_STATES.includes(stateName)) exactDimensions.push('feedback');
      expect(Object.keys(coverage.dimensions).sort()).toEqual(exactDimensions.sort());
    }
  }
});


test('installability metadata and every declared icon are valid first-party assets', async ({ page }) => {
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]'))
    .toHaveAttribute('sizes', '180x180');
  await expect(page.locator('meta[name="application-name"]'))
    .toHaveAttribute('content', 'Nicotine Tracker');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
    .toHaveAttribute('content', 'yes');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Nicotine Tracker',
    short_name: 'Nicotine Tracker',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F1E7',
    theme_color: '#F5F1E7',
  });
  expect(manifest.icons).toEqual([
    {
      src: '/static/icons/pwa/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/static/icons/pwa/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ]);

  for (const { src, sizes } of [
    ...manifest.icons,
    { src: '/static/icons/pwa/icon-180.png', sizes: '180x180' },
  ]) {
    const response = await page.request.get(src);
    expect(response.status(), src).toBe(200);
    expect(response.headers()['content-type'], src).toContain('image/png');
    const body = await response.body();
    expect([...body.subarray(0, 8)], `${src} PNG signature`).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const [expectedWidth, expectedHeight] = sizes.split('x').map(Number);
    expect(body.readUInt32BE(16), `${src} width`).toBe(expectedWidth);
    expect(body.readUInt32BE(20), `${src} height`).toBe(expectedHeight);
  }
});


test('product guard records every release-blocking browser signal', async ({ page }) => {
  await page.route('**/__test__/release/failed-request', (route) => route.abort('failed'));
  const guard = watchForProductProblems(page);
  await page.goto('/');
  await page.evaluate(async () => {
    console.error('release guard console fixture');
    setTimeout(() => { throw new Error('release guard page fixture'); }, 0);
    await Promise.allSettled([
      fetch('/__test__/release/failed-request'),
      fetch('/static/js/analytics/runtime.js'),
    ]);
  });
  await expect.poll(() => guard.problems().map((problem) => problem.kind)).toEqual(
    expect.arrayContaining(['console-error', 'page-error', 'request-failed', 'analytics-bundle']),
  );
  await page.goto('/__test__/error/500');
  await expect.poll(() => guard.problems().map((problem) => problem.kind)).toEqual(
    expect.arrayContaining([
      'console-error',
      'page-error',
      'request-failed',
      'http-5xx',
      'analytics-bundle',
    ]),
  );
  expect(() => guard.assertClean(expect, {
    stateName: 'synthetic dirty state',
    expectedStatus: 500,
    expectedPath: '/__test__/error/500',
    allowAnalytics: true,
  })).toThrow(/synthetic dirty state product guard findings/);
});


for (const state of RELEASE_STATES) {
  test(`release inventory: ${state.name}`, async ({ page }, testInfo) => {
    const resolved = resolveReleaseState(state, testInfo.project.name);
    const guard = watchForProductProblems(page);
    if (resolved.email) await loginAs(page, resolved.email);

    const response = await page.goto(resolved.path);
    await page.waitForLoadState('networkidle');

    expect(response.status(), `${state.name} response`).toBe(resolved.status);
    await expect(page.locator('h1'), `${state.name} H1 count`).toHaveCount(1);
    if (resolved.insightsState) {
      await expect(
        page.locator('[data-insights-root]'),
        `${state.name} rendered Insights state`,
      ).toHaveAttribute('data-insights-state', resolved.insightsState);
    }
    if (typeof resolved.offlineQueueEnabled === 'boolean') {
      const offlineQueue = page.getByRole('checkbox', {
        name: 'Save actions for offline use',
      });
      if (resolved.offlineQueueEnabled) {
        await expect(offlineQueue, `${state.name} offline queue state`).toBeChecked();
      } else {
        await expect(offlineQueue, `${state.name} offline queue state`).not.toBeChecked();
      }
    }
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )), `${state.name} horizontal overflow`).toBeLessThanOrEqual(0);
    expect(
      await visibleActionNames(page),
      `${state.name} visible action inventory`,
    ).toEqual(EXPECTED_ACTIONS[state.name]);
    guard.assertClean(expect, {
      stateName: state.name,
      expectedStatus: resolved.status,
      expectedPath: new URL(page.url()).pathname,
      allowAnalytics: resolved.allowAnalytics,
    });
  });
}
