const ANALYTICS_BUNDLES = [
  '/static/js/analytics/',
  '/static/js/insights',
  '/static/js/dashboard-charts.js',
  '/static/js/apexcharts.min.js',
];


function requestPath(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return null;
  }
}


function watchForProductProblems(page) {
  const findings = [];
  let firstPartyOrigin = null;

  function isSameOrigin(rawUrl) {
    try {
      const target = new URL(rawUrl);
      if (!firstPartyOrigin && /^https?:$/.test(target.protocol)) {
        firstPartyOrigin = target.origin;
      }
      return target.origin === firstPartyOrigin;
    } catch {
      return false;
    }
  }

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    findings.push({
      kind: 'console-error',
      text: message.text(),
      url: message.location().url || page.url(),
    });
  });
  page.on('pageerror', (error) => {
    findings.push({
      kind: 'page-error',
      text: error.stack || error.message,
      url: page.url(),
    });
  });
  page.on('requestfailed', (request) => {
    if (!isSameOrigin(request.url())) return;
    findings.push({
      kind: 'request-failed',
      text: request.failure()?.errorText || 'unknown request failure',
      url: request.url(),
      navigation: request.isNavigationRequest(),
    });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!isSameOrigin(url)) return;
    if (response.status() >= 500) {
      findings.push({
        kind: 'http-5xx',
        text: `HTTP ${response.status()}`,
        status: response.status(),
        url,
      });
    }
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!isSameOrigin(url)) return;
    const pathname = requestPath(url);
    if (!ANALYTICS_BUNDLES.some((prefix) => pathname?.startsWith(prefix))) {
      return;
    }
    findings.push({
      kind: 'analytics-bundle',
      text: pathname,
      url,
    });
  });

  function unexpectedProblems(options = {}) {
    const expectedPath = options.expectedPath || null;
    const expectedStatus = options.expectedStatus || null;
    const allowedCanceledNavigationPaths = new Set(
      options.allowedCanceledNavigationPaths || [],
    );
    return findings.filter((finding) => {
      if (finding.kind === 'analytics-bundle' && options.allowAnalytics) {
        return false;
      }
      if (
        finding.kind === 'request-failed'
        && finding.navigation
        && finding.text.includes('ERR_ABORTED')
        && allowedCanceledNavigationPaths.has(requestPath(finding.url))
      ) {
        return false;
      }
      const pathMatches = expectedPath && requestPath(finding.url) === expectedPath;
      if (
        finding.kind === 'http-5xx'
        && expectedStatus >= 500
        && finding.status === expectedStatus
        && pathMatches
      ) {
        return false;
      }
      if (
        finding.kind === 'console-error'
        && expectedStatus >= 400
        && finding.text.includes(`status of ${expectedStatus}`)
        && pathMatches
      ) {
        return false;
      }
      return true;
    });
  }

  return {
    assertClean(expectApi, options = {}) {
      expectApi(
        unexpectedProblems(options),
        `${options.stateName || 'release state'} product guard findings`,
      ).toEqual([]);
    },
    problems() {
      return findings.map((finding) => ({ ...finding }));
    },
  };
}


module.exports = { watchForProductProblems };
