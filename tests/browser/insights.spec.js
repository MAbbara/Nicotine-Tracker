const { test, expect } = require('@playwright/test');

const { watchForProductProblems } = require('./helpers/product_guard');


async function login(page, email) {
  await page.context().clearCookies();
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}

async function setActualTwoHundredPercentZoom(page) {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect.poll(() => page.evaluate(() => (
    Number.parseFloat(getComputedStyle(document.documentElement).zoom)
  ))).toBe(2);
}

async function rangeGeometry(page) {
  return page.locator(
    '[data-insights-root]:not([data-insights-candidate]) [data-days]',
  ).evaluateAll((controls) => Object.fromEntries(
    controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return [control.dataset.days, {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      }];
    }),
  ));
}

function expectStableRangeGeometry(actual, expected) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const days of Object.keys(expected)) {
    for (const key of ['top', 'left', 'width', 'height']) {
      expect(Math.abs(actual[days][key] - expected[days][key])).toBeLessThanOrEqual(1);
    }
  }
}

async function fullInsightsSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-insights-root]:not([data-insights-candidate])');
    const attributes = (node, names) => Object.fromEntries(
      names.map((name) => [name, node?.getAttribute(name) ?? null]),
    );
    const described = (selector) => [...root.querySelectorAll(selector)].map((node) => ({
      selector: node.id || [...node.attributes]
        .find((attribute) => attribute.name.startsWith('data-'))?.name || node.tagName,
      text: node.textContent,
      hidden: node.hidden,
      attributes: attributes(node, [
        'aria-busy', 'aria-current', 'aria-hidden', 'aria-pressed',
        'aria-live', 'role', 'href', 'open', 'disabled',
      ]),
      classes: node.className?.baseVal ?? node.className ?? '',
    }));
    return {
      url: window.location.href,
      root: {
        state: root.dataset.insightsState,
        pendingDays: root.dataset.pendingDays || null,
        attributes: attributes(root, ['aria-busy']),
      },
      metrics: described('.insights-measures dt, .insights-measures dd'),
      narratives: described([
        '[data-insights-headline]', '[data-insights-interpretation]',
        '[data-insights-plan-context]', '[data-insights-time-copy]',
        '[data-insights-time-nicotine-copy]', '[data-insights-weekly-copy]',
        '[data-insights-product-copy]', '[data-insights-product-nicotine-copy]',
        '[data-insights-craving-copy]', '[data-insights-hourly-copy]',
      ].join(',')),
      nextStep: described('[data-insights-next-step]'),
      craving: described([
        '[data-craving-pattern]', '[data-craving-leading-trigger]',
        '[data-craving-resolved-pattern]', '[data-craving-non-nicotine-rate]',
      ].join(',')),
      tables: [...root.querySelectorAll('[data-analytics-key]')].map((body) => ({
        key: body.dataset.analyticsKey,
        rows: [...body.rows].map((row) => [...row.cells].map((cell) => cell.textContent)),
      })),
      charts: [...root.querySelectorAll('.analytics-chart')].map((node) => ({
        id: node.id,
        text: node.textContent,
        hidden: node.hidden,
        attributes: attributes(node, ['aria-label', 'aria-labelledby', 'role']),
        values: [...node.querySelectorAll('[val]')].map((item) => item.getAttribute('val')),
        titles: [...node.querySelectorAll('title')].map((title) => title.textContent),
      })),
      chartStatuses: described('.analytics-chart__status'),
      details: described('details'),
      trendControls: described('.trend-toggle'),
      rangeControls: described('[data-days]'),
      export: described('#export-data').map((item) => ({
        ...item,
        href: root.querySelector('#export-data')?.dataset.exportHref || null,
      })),
    };
  });
}

function committedSnapshot(snapshot) {
  return {
    ...snapshot,
    root: { ...snapshot.root, pendingDays: null, attributes: { 'aria-busy': null } },
    chartStatuses: snapshot.chartStatuses.map((status) => (
      status.selector === 'data-insights-load-status'
        ? { ...status, text: '', hidden: true }
        : status
    )),
    rangeControls: snapshot.rangeControls.map((control) => ({
      ...control,
      classes: control.classes.replace(/\bis-pending\b/g, '').replace(/\s+/g, ' ').trim(),
      attributes: { ...control.attributes, 'aria-busy': null },
    })),
  };
}

async function expectedCommittedSnapshotFromResponse(
  page, payload, days,
  { reducedMotion = false, trendType = 'daily', zoom = false } = {},
) {
  const oracle = await page.context().newPage();
  try {
    const viewport = page.viewportSize();
    if (viewport) await oracle.setViewportSize(viewport);
    if (reducedMotion) await oracle.emulateMedia({ reducedMotion: 'reduce' });
    await oracle.route(`**/insights/api/insights?days=${days}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
    const initialDays = Number(days) === 30 ? 7 : 30;
    await oracle.goto(`/insights/?days=${initialDays}`);
    if (zoom) await setActualTwoHundredPercentZoom(oracle);
    await oracle.getByRole('link', {
      name: Number(days) === 365 ? '1 year' : `${days} days`,
      exact: true,
    }).click();
    await expect(oracle).toHaveURL(new RegExp(`days=${days}`));
    if (trendType === 'weekly') {
      await oracle.getByRole('button', { name: 'Weekly' }).click();
      await expect(oracle.getByRole('button', { name: 'Weekly' })).toHaveAttribute(
        'aria-pressed', 'true',
      );
    }
    return committedSnapshot(await fullInsightsSnapshot(oracle));
  } finally {
    await oracle.close();
  }
}

test('Insights server fallback keeps neutral plan states neutral and reveals only sufficient cravings', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.route('**/static/js/insights.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  const states = [
    [
      'insights-no-plan@example.com', false, false,
      'Plan for Morning (6AM-12PM)', '/journey/',
    ],
    [
      'insights-observe@example.com', false, false,
      'Review your observations', '/journey/',
    ],
    [
      'insights-paused@example.com', false, false,
      'Review or resume your plan', '/journey/',
    ],
    [
      'insights-targeted@example.com', true, true,
      'Plan for Morning (6AM-12PM)', '/journey/',
    ],
  ];

  for (const [email, planVisible, cravingVisible, label, href] of states) {
    await login(page, email);
    await page.goto('/insights/?days=7');
    const periodCopy = await page.locator([
      '[data-insights-headline]',
      '[data-insights-interpretation]',
    ].join(',')).allTextContents();
    expect(periodCopy.join(' ')).not.toMatch(/your plan/i);
    await expect(page.locator('[data-insights-plan-context]'))
      [planVisible ? 'toBeVisible' : 'toBeHidden']();
    await expect(page.locator('[data-craving-pattern]'))
      [cravingVisible ? 'toBeVisible' : 'toBeHidden']();
    await expect(page.locator('[data-insights-next-step]')).toHaveText(label);
    await expect(page.locator('[data-insights-next-step]')).toHaveAttribute(
      'href', href,
    );
  }

  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Stress');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
  const payload = await page.evaluate(async () => (
    fetch('/insights/api/insights?days=7').then((response) => response.json())
  ));
  expect(payload.data_sufficiency.time_pattern).toBe(true);
  expect(payload.nicotine_by_time_of_day).toBeTruthy();
  expect(payload.nicotine_by_product).toBeTruthy();
  expect(payload.strength_coverage).toMatchObject({ complete: true, unknown_pouches: 0 });
  expect(payload.plan_context.actual_pouches).toBe(15);
  expect(payload.plan_context.target_pouches).toBe(18);
  const privateValues = [
    'Private browser fixture note',
    'Private browser situation context',
    'Private browser outcome note',
  ];
  const serializedPayload = JSON.stringify(payload);
  const renderedHtml = await page.content();
  for (const value of privateValues) {
    expect(serializedPayload).not.toContain(value);
    expect(renderedHtml).not.toContain(value);
  }
  guard.assertClean(expect, {
    stateName: 'Insights fallback plan and craving states',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});


test('Insights range refresh hides and restores plan and craving evidence from one contract', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await expect(page.locator('[data-insights-root]')).toHaveAttribute(
    'data-insights-started', 'true',
  );
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Routine');

  const sevenResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
      && new URL(response.url()).search === '?days=7'
  ));
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  const sevenResponse = await sevenResponsePromise;
  expect(sevenResponse.status()).toBe(200);
  const sevenPayload = await sevenResponse.json();
  expect(sevenPayload.log_count).toBe(0);
  expect(sevenPayload.data_sufficiency).toMatchObject({
    plan_adherence: false,
    craving_pattern: false,
  });
  expect(sevenPayload.plan_context).toMatchObject({
    state: 'active_targeted',
    adherence_available: false,
    compared_days: 0,
  });
  expect(sevenPayload.craving_pattern.available).toBe(false);
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'This range does not have a matched plan day yet.',
  );
  await expect(page.locator('[data-craving-pattern]')).toBeHidden();
  await expect(page.locator('[data-insights-next-step]')).toHaveText('Log today');
  await expect(page.locator('[data-insights-next-step]')).toHaveAttribute(
    'href', '/today/',
  );
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'No nicotine is available',
  );
  await expect(page.locator('[data-insights-interpretation]')).not.toContainText(/your plan/i);

  const thirtyResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
      && new URL(response.url()).search === '?days=30'
  ));
  await page.getByRole('link', { name: '30 days', exact: true }).click();
  const thirtyResponse = await thirtyResponsePromise;
  expect(thirtyResponse.status()).toBe(200);
  const thirtyPayload = await thirtyResponse.json();
  expect(thirtyPayload.plan_context).toMatchObject({
    state: 'active_targeted',
    adherence_available: true,
    compared_days: 3,
    actual_pouches: 15,
    target_pouches: 18,
    days_on_or_below_target: 2,
  });
  expect(thirtyPayload.craving_pattern).toMatchObject({
    available: true,
    leading_trigger: 'Routine',
    leading_trigger_count: 2,
    resolved_count: 3,
    non_nicotine_rate: 66.7,
  });
  await expect(page.locator('[data-insights-plan-context]')).toContainText(
    'Across 3 matched plan days, you logged 15 pouches against a target of 18.',
  );
  await expect(page.locator('[data-craving-pattern]')).toBeVisible();
  await expect(page.locator('[data-craving-leading-trigger]')).toHaveText('Routine');
  await expect(page.locator('[data-craving-resolved-pattern]')).toHaveText('2 of 3 resolved');
  await expect(page.locator('[data-craving-non-nicotine-rate]')).toHaveText('66.7%');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'one product category',
  );
  const serializedPayload = JSON.stringify(thirtyPayload);
  const renderedHtml = await page.content();
  for (const value of [
    'Private range fixture note',
    'Private range situation context',
    'Private range outcome note',
    'Private range plan note',
  ]) {
    expect(serializedPayload).not.toContain(value);
    expect(renderedHtml).not.toContain(value);
  }
  guard.assertClean(expect, {
    stateName: 'Insights plan and craving range refresh',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});

test('Insights range transaction retains geometry, content, focus, and atomic history', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  const actions = page.locator('.insights-actions');
  const seven = page.getByRole('link', { name: '7 days', exact: true });
  const headline = page.locator('[data-insights-headline]');
  const before = await actions.boundingBox();
  const controlGeometry = await rangeGeometry(page);
  const snapshot = await fullInsightsSnapshot(page);
  const expectedThirtyPayload = await page.evaluate(async () => (
    fetch('/insights/api/insights?days=30').then((response) => response.json())
  ));
  const expectedThirty = await expectedCommittedSnapshotFromResponse(
    page, expectedThirtyPayload, 30,
  );
  await page.evaluate(() => {
    window.__insightsLayoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__insightsLayoutShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources || []).map((source) => (
            source.node?.closest?.('.insights-actions') ? 'insights-actions' : 'other'
          )),
        });
      }
    }).observe({ type: 'layout-shift', buffered: false });
  });
  await seven.focus();

  let delayed = true;
  await page.route('**/insights/api/insights?days=7', async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"held"}' });
  });
  const failed = seven.click();
  await expect(page.locator('[data-insights-load-status]')).toContainText('Updating');
  const pending = await actions.boundingBox();
  expect(Math.abs(pending.y - before.y)).toBeLessThanOrEqual(1);
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(await headline.textContent()).toBe(snapshot.narratives[0].text);
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(snapshot),
  );
  await expect(seven).toBeFocused();
  await failed;
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(snapshot),
  );
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(await page.evaluate(() => window.__insightsLayoutShifts
    .filter((entry) => entry.sources.includes('insights-actions')))).toEqual([]);

  const sevenResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/insights/api/insights'
    && new URL(response.url()).search === '?days=7'
    && response.status() === 200
  ));
  await seven.click();
  const sevenPayload = await (await sevenResponsePromise).json();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-current', 'true');
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  const expectedSeven = await expectedCommittedSnapshotFromResponse(page, sevenPayload, 7);
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(expectedSeven);
  await page.goBack();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
  expectStableRangeGeometry(await rangeGeometry(page), controlGeometry);
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(expectedThirty);
});

test('latest range wins after abort and long snapshot labels stay contained at 320px 200%', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await setActualTwoHundredPercentZoom(page);
  const stalePayload = await page.evaluate(async () => (
    fetch('/insights/api/insights?days=7').then((response) => response.json())
  ));
  const longLabel = 'An intentionally long immutable nicotine product snapshot label';
  const spacedLabel = ' Exact snapshot ';
  let latestNinetyPayload;
  await page.route('**/insights/api/insights?days=7', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(stalePayload),
    });
  });
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.nicotine_by_product = {
      'Third product': 30,
      [spacedLabel]: 60,
      [longLabel]: 90,
      'Accessible zero category': 0,
    };
    payload.data_sufficiency.brand_pattern = true;
    latestNinetyPayload = payload;
    await route.fulfill({
      response, contentType: 'application/json', body: JSON.stringify(payload),
    });
  });

  const beforeTop = await page.locator('.insights-actions').evaluate((node) => (
    node.getBoundingClientRect().top + window.scrollY
  ));
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText(longLabel);
  await expect(page.locator('[data-analytics-key="brands"] th')).toHaveText([
    'Third product', spacedLabel, longLabel, 'Accessible zero category',
  ]);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Accessible zero category');
  const productLabels = page.locator('#brand-chart .apexcharts-yaxis-label');
  await expect(productLabels).toHaveCount(3);
  await expect(productLabels.locator('title')).toHaveText([
    longLabel, spacedLabel, 'Third product',
  ]);
  await expect(page.locator('#brand-chart .apexcharts-bar-area')).toHaveCount(3);
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-days="90"]')).toHaveAttribute('aria-current', 'true');
  const expectedNinety = await expectedCommittedSnapshotFromResponse(
    page, latestNinetyPayload, 90, { reducedMotion: true, zoom: true },
  );
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(expectedNinety);
  const afterTop = await page.locator('.insights-actions').evaluate((node) => (
    node.getBoundingClientRect().top + window.scrollY
  ));
  expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBe(0);
});

test('range request invalidates an already-running live presentation before pending begins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  const before = await fullInsightsSnapshot(page);
  const geometry = await rangeGeometry(page);
  let releaseRange;
  let raceNinetyPayload;
  const rangeHeld = new Promise((resolve) => { releaseRange = resolve; });
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    raceNinetyPayload = await response.json();
    await rangeHeld;
    await route.fulfill({
      response,
      contentType: 'application/json',
      body: JSON.stringify(raceNinetyPayload),
    });
  });
  await page.evaluate(() => {
    const original = window.ApexCharts.prototype.render;
    window.ApexCharts.prototype.render = function heldLiveRender(...args) {
      if (window.__heldLiveRenderOnce) return original.apply(this, args);
      window.__heldLiveRenderOnce = true;
      return new Promise((resolve) => {
        window.__releaseHeldLiveRender = async () => resolve(await original.apply(this, args));
      });
    };
  });

  await page.getByRole('button', { name: 'Weekly' }).click();
  await expect.poll(() => page.evaluate(() => (
    typeof window.__releaseHeldLiveRender
  ))).toBe('function');
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  const liveRoot = page.locator('[data-insights-root]:not([data-insights-candidate])');
  await expect(liveRoot).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.__releaseHeldLiveRender());
  await page.waitForTimeout(100);

  await expect(liveRoot).toHaveAttribute('aria-busy', 'true');
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(
    committedSnapshot(before),
  );
  expectStableRangeGeometry(await rangeGeometry(page), geometry);
  releaseRange();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-days="90"]')).toHaveAttribute('aria-current', 'true');
  const expectedNinety = await expectedCommittedSnapshotFromResponse(
    page, raceNinetyPayload, 90, { reducedMotion: true, trendType: 'weekly' },
  );
  expect(committedSnapshot(await fullInsightsSnapshot(page))).toEqual(expectedNinety);
  expectStableRangeGeometry(await rangeGeometry(page), geometry);
});

test('range response builds offscreen and chart delay or failure cannot partially commit live state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  const liveSnapshot = () => page.evaluate(() => {
    const root = document.querySelector('[data-insights-root]:not([data-insights-candidate])');
    return {
      metrics: [...root.querySelectorAll('.insights-measures dd')].map((node) => node.textContent),
      narratives: [...root.querySelectorAll('[data-insights-headline], [data-insights-interpretation], [data-insights-time-nicotine-copy], [data-insights-product-nicotine-copy]')].map((node) => node.textContent),
      tables: [...root.querySelectorAll('[data-analytics-key="timeOfDay"], [data-analytics-key="brands"]')].map((node) => node.textContent),
      chartText: [...root.querySelectorAll('#time-of-day-chart, #brand-chart')].map((node) => node.textContent),
      current: root.querySelector('[data-days][aria-current="true"]')?.dataset.days,
      exportHref: root.querySelector('#export-data')?.dataset.exportHref,
    };
  });
  const before = await liveSnapshot();
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.comparison.current_total = 99;
    payload.total_pouches = 99;
    payload.nicotine_by_product = { 'Candidate only': 321 };
    payload.data_sufficiency.brand_pattern = true;
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.evaluate(() => {
    const original = window.ApexCharts.prototype.render;
    window.__insightsOriginalRender = original;
    window.__holdInsightsChart = true;
    window.ApexCharts.prototype.render = function heldRender(...args) {
      if (!window.__holdInsightsChart) return original.apply(this, args);
      return new Promise((resolve, reject) => {
        window.__releaseInsightsChart = async ({ fail = false } = {}) => {
          window.__holdInsightsChart = false;
          if (fail) reject(new Error('forced candidate render failure'));
          else resolve(await original.apply(this, args));
        };
      });
    };
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(before);
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  await page.evaluate(() => window.__releaseInsightsChart());
  await page.waitForTimeout(100);
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-analytics-key="brands"]')).not.toContainText('Candidate only');

  await page.getByRole('link', { name: '30 days', exact: true }).click();
  await expect(page).toHaveURL(/days=30/);
  await page.evaluate(() => {
    window.__holdInsightsChart = true;
    delete window.__releaseInsightsChart;
  });
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(before);
  await page.evaluate(() => window.__releaseInsightsChart());
  await expect(page).toHaveURL(/days=90/);
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Candidate only');

  await page.getByRole('link', { name: '30 days', exact: true }).click();
  await expect(page).toHaveURL(/days=30/);
  const committed = await liveSnapshot();
  await page.evaluate(() => {
    window.__holdInsightsChart = true;
    delete window.__releaseInsightsChart;
  });
  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseInsightsChart)).toBe('function');
  expect(await liveSnapshot()).toEqual(committed);
  await page.evaluate(() => window.__releaseInsightsChart({ fail: true }));
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=30/);
  expect(await liveSnapshot()).toEqual(committed);
});

test('failed popstate returns to committed entry without overwriting the destination history entry', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  let failThirty = true;
  await page.route('**/insights/api/insights?days=30', async (route) => {
    if (!failThirty) return route.continue();
    failThirty = false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"held"}' });
  });

  await page.goBack();
  await expect(page.locator('[data-insights-load-status]')).toContainText('could not refresh');
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-current', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-current', 'true');
});

test('known-zero and unknown-only nicotine states stay truthful with authoritative tables', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.route('**/insights/api/insights?days=*', async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    if (![90, 365].includes(days)) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.data_sufficiency.time_pattern = true;
    payload.data_sufficiency.brand_pattern = true;
    if (days === 90) {
      payload.nicotine_by_time_of_day = { Morning: 0 };
      payload.nicotine_by_product = { 'Known zero product': 0 };
      payload.strength_coverage = {
        known_pouches: 2, unknown_pouches: 1, total_pouches: 3,
        known_percent: 66.7, complete: false,
      };
    } else {
      payload.nicotine_by_time_of_day = {};
      payload.nicotine_by_product = {};
      payload.strength_coverage = {
        known_pouches: 0, unknown_pouches: 2, total_pouches: 2,
        known_percent: 0, complete: false,
      };
    }
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('add up to 0 mg');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText('Known zero product0');
  await expect(page.locator('#brand-chart')).toBeHidden();

  await page.getByRole('link', { name: '1 year', exact: true }).click();
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText(
    'every logged pouch is missing a saved strength',
  );
  await expect(page.locator('[data-analytics-key="brands"]')).toContainText(
    'No known-strength product data',
  );
  await expect(page.locator('#brand-chart')).toBeHidden();
});

test('client refresh keeps mixed unknown-strength coverage visible for a single positive bar', async ({ page }) => {
  await login(page, 'insights-range@example.com');
  await page.goto('/insights/?days=30');
  await page.route('**/insights/api/insights?days=90', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data_sufficiency.time_pattern = true;
    payload.data_sufficiency.brand_pattern = true;
    payload.nicotine_by_time_of_day = { Morning: 8, Evening: 0 };
    payload.nicotine_by_product = { 'Only positive product': 8, 'Known zero': 0 };
    payload.strength_coverage = {
      known_pouches: 2, unknown_pouches: 1, total_pouches: 3,
      known_percent: 66.7, complete: false,
    };
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.getByRole('link', { name: '90 days', exact: true }).click();

  await expect(page.locator('[data-insights-time-nicotine-copy]')).toContainText('one time category');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('one product category');
  await expect(page.locator('[data-insights-time-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('[data-insights-product-nicotine-copy]')).toContainText('incomplete');
  await expect(page.locator('#brand-chart .apexcharts-yaxis-label title')).toHaveText(
    'Only positive product',
  );
  await expect(page.locator('#brand-chart .apexcharts-yaxis-label title')).not.toContainText(
    'Known zero',
  );
});


test('Insights plan and craving facts remain readable in dark 320px 200% reduced-motion mode', async ({ page }) => {
  const guard = watchForProductProblems(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, 'insights-targeted@example.com');
  await page.goto('/you/');
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.goto('/insights/?days=7');
  await setActualTwoHundredPercentZoom(page);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-insights-plan-context]')).toBeVisible();
  const cravingFacts = page.locator('dl[aria-label="Craving response pattern"]');
  await expect(cravingFacts).toBeVisible();
  await expect(cravingFacts.locator('dt')).toHaveText([
    'Leading trigger', 'Pattern frequency', 'Non-nicotine response',
  ]);
  await page.locator('[aria-label="Insights date range"]').focus();
  await expect(page.locator('[aria-label="Insights date range"]')).toBeFocused();
  expect(await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))).toEqual({ overflow: 0, reduced: true });
  guard.assertClean(expect, {
    stateName: 'Insights dark narrow enlarged reduced-motion facts',
    expectedStatus: 200,
    expectedPath: '/insights/',
    allowAnalytics: true,
  });
});
