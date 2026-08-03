const fs = require('node:fs/promises');
const path = require('node:path');

const { expect } = require('@playwright/test');

const {
  RELEASE_STATES,
  loginAs,
  resolveReleaseState,
} = require('../../browser/helpers/release_manifest');
const { watchForProductProblems } = require('../../browser/helpers/product_guard');


const OUTPUT_ROOT = path.resolve(process.cwd(), 'output/playwright/release-visual');
const STATIC_SCREENSHOT_STYLE = [
  '*, *::before, *::after { caret-color: transparent !important; }',
  'html[data-release-text-scale="2"] { font-size: 200% !important; }',
].join('\n');


function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}


function relativeToOutput(filePath) {
  return path.relative(OUTPUT_ROOT, filePath).split(path.sep).join('/');
}


function stateNamed(name) {
  const state = RELEASE_STATES.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`Unknown release visual state: ${name}`);
  return state;
}


async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}


async function installFixedBrowserConditions(page, {
  theme,
  reducedMotion,
  viewport,
}) {
  if (viewport) await page.setViewportSize(viewport);
  const clockResponse = await page.request.get('/__test__/release-clock');
  expect(clockResponse.status(), 'release clock fixture response').toBe(200);
  const { fixed_now: fixedNow } = await clockResponse.json();
  await page.clock.setFixedTime(new Date(fixedNow));
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript((savedTheme) => {
    localStorage.setItem('nicotine-tracker-theme', savedTheme);
  }, theme);
  return fixedNow;
}


async function waitForStablePage(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  const controllerSlots = page.locator('[data-log-action-slot], [data-craving-action-slot]');
  if (await controllerSlots.count()) {
    await expect(page.locator([
      '[data-log-action-slot]:not([data-controller-ready="true"])',
      '[data-craving-action-slot]:not([data-controller-ready="true"])',
    ].join(', '))).toHaveCount(0);
  }
  const visibleCharts = page.locator('.analytics-chart:not([hidden])');
  if (await visibleCharts.count()) {
    await expect(visibleCharts.first().locator('.apexcharts-canvas')).toBeVisible();
  }
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}


async function openReleaseState({
  page,
  testInfo,
  state,
  theme = 'light',
  reducedMotion = 'no-preference',
  viewport,
  textScale = 1,
}) {
  const resolved = resolveReleaseState(state, testInfo.project.name);
  const guard = watchForProductProblems(page);
  const fixedNow = await installFixedBrowserConditions(page, {
    theme,
    reducedMotion,
    viewport,
  });
  if (resolved.email) await loginAs(page, resolved.email);

  const response = await page.goto(resolved.path);
  expect(response, `${state.name} navigation response`).not.toBeNull();
  expect(response.status(), `${state.name} response status`).toBe(resolved.status);
  await waitForStablePage(page);
  await expect(page.locator('h1'), `${state.name} H1 count`).toHaveCount(1);
  const themeBeforeHarness = await page.locator('html').getAttribute('data-theme');
  const themeAppliedByHarness = themeBeforeHarness !== theme;
  if (themeAppliedByHarness) {
    await page.locator('html').evaluate((element, requestedTheme) => {
      element.dataset.theme = requestedTheme;
      element.dataset.savedTheme = requestedTheme;
      element.classList.toggle('dark', requestedTheme === 'dark');
      element.style.colorScheme = requestedTheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        'content',
        requestedTheme === 'dark' ? '#111915' : '#F5F1E7',
      );
    }, theme);
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.locator('html').evaluate((element, scale) => {
    element.dataset.releaseTextScale = String(scale);
  }, textScale);
  await page.addStyleTag({ content: STATIC_SCREENSHOT_STYLE });
  if (resolved.insightsState) {
    await expect(page.locator('[data-insights-root]'))
      .toHaveAttribute('data-insights-state', resolved.insightsState);
  }

  return {
    fixedNow,
    guard,
    resolved,
    state,
    textScale,
    theme,
    themeAppliedByHarness,
    themeBeforeHarness,
    reducedMotion,
  };
}


async function collectGeometry(page, session) {
  return page.evaluate(({
    fixedNow,
    requestedTheme,
    textScale,
    themeAppliedByHarness,
    themeBeforeHarness,
  }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Number(rect.top.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    };
    const clippedCandidates = [...document.querySelectorAll(
      'h1, h2, h3, h4, p, a, button, summary, label, input, select, textarea, th, td',
    )].filter(visible).filter((element) => (
      element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1
    )).map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      text: (element.innerText || element.value || element.getAttribute('aria-label') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 120),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    const fixedOrSticky = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((element) => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: typeof element.className === 'string'
          ? element.className.trim().replace(/\s+/g, ' ').slice(0, 160)
          : '',
        position: getComputedStyle(element).position,
        rect: rectOf(element),
      }));
    const openDialogs = [...document.querySelectorAll('dialog[open]')].map((dialog) => ({
      id: dialog.id || null,
      label: dialog.getAttribute('aria-label')
        || document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent.trim()
        || null,
      rect: rectOf(dialog),
      clientWidth: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      clientHeight: dialog.clientHeight,
      scrollHeight: dialog.scrollHeight,
    }));
    const main = document.querySelector('main');
    const bottomNav = document.querySelector('.primary-nav');
    const mainStyle = main ? getComputedStyle(main) : null;
    return {
      fixedNow,
      url: location.href,
      title: document.title,
      theme: document.documentElement.dataset.theme || null,
      requestedTheme,
      themeAppliedByHarness,
      themeBeforeHarness,
      textScale,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        horizontalOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      },
      main: main ? {
        rect: rectOf(main),
        paddingBottom: Number.parseFloat(mainStyle.paddingBottom) || 0,
      } : null,
      bottomNavigation: bottomNav && visible(bottomNav) ? rectOf(bottomNav) : null,
      openDialogs,
      fixedOrSticky,
      clippedCandidates,
      visibleCheckIn: Boolean(document.querySelector('[data-check-in-form]:not([hidden])')),
      visibleJourneyPreview: Boolean(document.querySelector(
        '[data-plan-editor="revision"] [data-plan-editor-preview]:not([hidden])',
      )),
    };
  }, {
    fixedNow: session.fixedNow,
    requestedTheme: session.theme,
    textScale: session.textScale,
    themeAppliedByHarness: session.themeAppliedByHarness,
    themeBeforeHarness: session.themeBeforeHarness,
  });
}


async function writeCapture({
  page,
  testInfo,
  captureName,
  group,
  session,
  fullPage,
}) {
  const projectName = safeName(testInfo.project.name);
  const baseName = safeName(captureName);
  const pngPath = path.join(OUTPUT_ROOT, group, projectName, `${baseName}.png`);
  const geometryPath = path.join(
    OUTPUT_ROOT,
    'geometry',
    group,
    projectName,
    `${baseName}.json`,
  );
  await ensureDirectory(pngPath);
  await ensureDirectory(geometryPath);
  await page.screenshot({
    path: pngPath,
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
  const geometry = await collectGeometry(page, session);
  const record = {
    capture: baseName,
    group,
    project: testInfo.project.name,
    png: relativeToOutput(pngPath),
    geometry,
  };
  await fs.writeFile(geometryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const stats = await fs.stat(pngPath);
  return {
    bytes: stats.size,
    geometry,
    geometryPath,
    path: pngPath,
  };
}


function assertCleanSession(session, page) {
  session.guard.assertClean(expect, {
    stateName: session.state.name,
    expectedStatus: session.resolved.status,
    expectedPath: new URL(page.url()).pathname,
    allowAnalytics: session.resolved.allowAnalytics,
  });
}


async function runPageCapture(options) {
  const session = await openReleaseState(options);
  const result = await writeCapture({
    ...options,
    session,
    fullPage: true,
  });
  assertCleanSession(session, options.page);
  return result;
}


async function runWorkflowCapture({
  page,
  context,
  testInfo,
  stateName,
  state,
  captureName,
  group,
  theme = 'light',
  reducedMotion = 'no-preference',
  viewport,
  textScale = 1,
  open,
}) {
  const tracePath = path.join(
    OUTPUT_ROOT,
    'traces',
    safeName(testInfo.project.name),
    `${safeName(captureName)}.zip`,
  );
  await ensureDirectory(tracePath);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  let session;
  let operationError = null;
  try {
    session = await openReleaseState({
      page,
      testInfo,
      state: state || stateNamed(stateName),
      theme,
      reducedMotion,
      viewport,
      textScale,
    });
    await open(page);
    await waitForStablePage(page);
    const result = await writeCapture({
      page,
      testInfo,
      captureName,
      group,
      session,
      fullPage: false,
    });
    assertCleanSession(session, page);
    return result;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await context.tracing.stop({ path: tracePath });
    } catch (traceError) {
      if (!operationError) throw traceError;
    }
  }
}


async function walkFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else files.push(target);
  }
  return files;
}


async function buildContactSheet({ browser, projectName, pngFiles }) {
  if (!pngFiles.length) return null;
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.route('http://release-visual.local/**', async (route) => {
    const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const target = path.resolve(OUTPUT_ROOT, relativePath);
    if (!target.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
      await route.abort('accessdenied');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: await fs.readFile(target),
    });
  });
  const page = await context.newPage();
  const cards = pngFiles.map((filePath) => {
    const relativePath = relativeToOutput(filePath);
    const url = `http://release-visual.local/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
    return `<figure><img src="${url}" alt=""><figcaption>${relativePath}</figcaption></figure>`;
  }).join('');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #eee8dc; color: #1f2a23;
      font: 14px/1.4 system-ui, sans-serif; }
    h1 { margin: 0 0 18px; font-size: 28px; }
    main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
    figure { margin: 0; padding: 10px; background: white; border: 1px solid #cfc6b8;
      border-radius: 10px; break-inside: avoid; }
    img { display: block; width: 100%; height: 230px; object-fit: contain;
      object-position: top center; background: #f8f5ee; }
    figcaption { margin-top: 8px; overflow-wrap: anywhere; }
  </style><h1>Release visual captures — ${projectName}</h1><main>${cards}</main>`);
  await page.locator('img').evaluateAll((images) => Promise.all(
    images.map((image) => image.decode()),
  ));
  const outputPath = path.join(
    OUTPUT_ROOT,
    'contact-sheets',
    `${safeName(projectName)}.png`,
  );
  await ensureDirectory(outputPath);
  await page.screenshot({
    path: outputPath,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  await context.close();
  return outputPath;
}


async function rebuildArtifactIndex() {
  const files = (await walkFiles(OUTPUT_ROOT)).sort();
  const artifacts = await Promise.all(files
    .filter((filePath) => !['index.html', 'index.json'].includes(path.basename(filePath)))
    .map(async (filePath) => ({
      path: relativeToOutput(filePath),
      bytes: (await fs.stat(filePath)).size,
      type: path.extname(filePath).slice(1),
    })));
  const geometryRecords = await Promise.all(files
    .filter((filePath) => (
      filePath.endsWith('.json')
      && filePath.includes(`${path.sep}geometry${path.sep}`)
    ))
    .map(async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'))));
  const themeActivationMismatches = geometryRecords
    .filter(({ geometry }) => geometry.themeAppliedByHarness)
    .map((record) => ({
      capture: record.capture,
      project: record.project,
      png: record.png,
      requestedTheme: record.geometry.requestedTheme,
      renderedThemeBeforeHarness: record.geometry.themeBeforeHarness,
      reviewOnly: true,
    }));
  const geometrySummary = {
    records: geometryRecords.length,
    documentOverflowCandidates: geometryRecords
      .filter(({ geometry }) => geometry.document.horizontalOverflow > 0)
      .map((record) => ({
        capture: record.capture,
        project: record.project,
        png: record.png,
        horizontalOverflow: record.geometry.document.horizontalOverflow,
      })),
    dialogOverflowCandidates: geometryRecords.flatMap((record) => (
      record.geometry.openDialogs
        .filter((dialog) => dialog.scrollWidth > dialog.clientWidth + 1)
        .map((dialog) => ({
          capture: record.capture,
          project: record.project,
          png: record.png,
          dialog: dialog.label || dialog.id,
          clientWidth: dialog.clientWidth,
          scrollWidth: dialog.scrollWidth,
        }))
    )),
    clippedCandidateCaptures: geometryRecords.filter(
      ({ geometry }) => geometry.clippedCandidates.length,
    ).length,
    clippedCandidateElements: geometryRecords.reduce(
      (count, { geometry }) => count + geometry.clippedCandidates.length,
      0,
    ),
    openDialogCaptures: geometryRecords.filter(
      ({ geometry }) => geometry.openDialogs.length,
    ).length,
    visibleCheckInCaptures: geometryRecords.filter(
      ({ geometry }) => geometry.visibleCheckIn,
    ).length,
    visibleJourneyPreviewCaptures: geometryRecords.filter(
      ({ geometry }) => geometry.visibleJourneyPreview,
    ).length,
  };
  const index = {
    fixedNow: '2026-08-03T12:00:00Z',
    evidenceRoot: 'output/playwright/release-visual/',
    counts: artifacts.reduce((counts, artifact) => {
      counts[artifact.type] = (counts[artifact.type] || 0) + 1;
      return counts;
    }, {}),
    geometrySummary,
    themeActivationMismatches,
    artifacts,
  };
  await fs.writeFile(
    path.join(OUTPUT_ROOT, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
  const imageCards = artifacts.filter(({ type }) => type === 'png').map((artifact) => (
    `<figure><a href="./${artifact.path}"><img src="./${artifact.path}" alt=""></a>`
    + `<figcaption>${artifact.path}</figcaption></figure>`
  )).join('\n');
  const artifactLinks = artifacts.filter(({ type }) => type !== 'png').map((artifact) => (
    `<li><a href="./${artifact.path}">${artifact.path}</a> (${artifact.bytes} bytes)</li>`
  )).join('\n');
  const mismatchItems = themeActivationMismatches.map((mismatch) => (
    `<li><a href="./${mismatch.png}">${mismatch.project}: ${mismatch.capture}</a> — requested `
    + `${mismatch.requestedTheme}, rendered ${mismatch.renderedThemeBeforeHarness}; forced asset is review-only.</li>`
  )).join('\n');
  const overflowItems = geometrySummary.documentOverflowCandidates.map((candidate) => (
    `<li><a href="./${candidate.png}">${candidate.project}: ${candidate.capture}</a> — `
    + `${candidate.horizontalOverflow}px document overflow.</li>`
  )).join('\n');
  await fs.writeFile(path.join(OUTPUT_ROOT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nicotine Tracker release visual evidence</title><style>
body{margin:0;padding:24px;background:#f5f0e6;color:#243128;font:16px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:auto}h1{font-size:2rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
figure{margin:0;padding:10px;background:white;border:1px solid #d7cdbd;border-radius:12px}img{display:block;width:100%;height:260px;object-fit:contain;object-position:top;background:#faf8f2}figcaption{margin-top:8px;overflow-wrap:anywhere}a{color:#245c3b}
</style></head><body><main><h1>Nicotine Tracker release visual evidence</h1>
<p>Automated capture only. Human visual inspection is still required.</p>
<p><a href="./index.json">Machine-readable artifact index</a></p>
<h2>Open theme-activation mismatch</h2><p>The following forced dark assets are review-only and do not prove the product theme path works.</p><ul>${mismatchItems}</ul>
<h2>Automated geometry candidates</h2><p>These are measurements for human classification, not visual PASS/FAIL decisions.</p><ul>${overflowItems}</ul>
<h2>Images and contact sheets</h2><div class="grid">${imageCards}</div>
<h2>Geometry and traces</h2><ul>${artifactLinks}</ul></main></body></html>`, 'utf8');
  return index;
}


async function rebuildArtifactCatalog({ browser, projectName }) {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const beforeSheet = await walkFiles(OUTPUT_ROOT);
  const pngFiles = beforeSheet.filter((filePath) => (
    filePath.endsWith('.png')
    && !filePath.includes(`${path.sep}contact-sheets${path.sep}`)
    && filePath.includes(`${path.sep}${safeName(projectName)}${path.sep}`)
  )).sort();
  await buildContactSheet({ browser, projectName, pngFiles });
  return rebuildArtifactIndex();
}


module.exports = {
  OUTPUT_ROOT,
  rebuildArtifactCatalog,
  rebuildArtifactIndex,
  runPageCapture,
  runWorkflowCapture,
};
