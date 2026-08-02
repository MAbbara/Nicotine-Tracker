const { test, expect } = require('@playwright/test');

const {
  EXPECTED_ACTIONS,
  RELEASE_PAGES,
  RELEASE_STATES,
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


async function visibleActionNames(page) {
  const controls = page.locator('a[href], button');
  const names = [];
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible()) continue;
    await expect(control).toHaveAccessibleName(/\S/);
    const snapshot = await control.ariaSnapshot();
    const match = snapshot.match(/^- (?:link|button) "([^"]+)"/);
    expect(match, `Unable to read action name from ARIA snapshot: ${snapshot}`).not.toBeNull();
    names.push(match[1]);
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
});


test('product guard records every release-blocking browser signal', async ({ page }) => {
  await page.route('**/__test__/release/failed-request', (route) => route.abort('failed'));
  const guard = watchForProductProblems(page);
  await page.goto('/');
  await page.evaluate(() => {
    console.error('release guard console fixture');
    setTimeout(() => { throw new Error('release guard page fixture'); }, 0);
    fetch('/__test__/release/failed-request').catch(() => {});
    fetch('/static/js/analytics/runtime.js').catch(() => {});
  });
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
