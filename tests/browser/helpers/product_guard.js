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


function requestTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}


function watchForProductProblems(page) {
  const findings = [];
  let firstPartyOrigin = null;
  let active = true;

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
    if (!active) return;
    if (message.type() !== 'error') return;
    findings.push({
      kind: 'console-error',
      text: message.text(),
      url: message.location().url || page.url(),
    });
  });
  page.on('pageerror', (error) => {
    if (!active) return;
    findings.push({
      kind: 'page-error',
      text: error.stack || error.message,
      url: page.url(),
    });
  });
  page.on('requestfailed', (request) => {
    if (!active) return;
    if (!isSameOrigin(request.url())) return;
    findings.push({
      kind: 'request-failed',
      text: request.failure()?.errorText || 'unknown request failure',
      url: request.url(),
      navigation: request.isNavigationRequest(),
    });
  });
  page.on('response', (response) => {
    if (!active) return;
    const url = response.url();
    if (!isSameOrigin(url)) return;
    if (response.status() >= 500) {
      findings.push({
        kind: 'http-5xx',
        text: `HTTP ${response.status()}`,
        status: response.status(),
        method: response.request().method(),
        url,
      });
    }
  });
  page.on('request', (request) => {
    if (!active) return;
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
    const expectedHttpErrors = (options.expectedHttpErrors || []).map((entry) => ({
      ...entry,
      count: entry.count || 1,
      seen: 0,
    }));
    const unexpected = findings.filter((finding) => {
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
      const expectedFailure = expectedHttpErrors.find((entry) => (
        entry.status === finding.status
        && entry.path === requestTarget(finding.url)
        && (
          finding.kind === 'console-error'
          || entry.method === finding.method
        )
      ));
      if (expectedFailure && finding.kind === 'http-5xx') {
        expectedFailure.seen += 1;
        return expectedFailure.seen > expectedFailure.count;
      }
      if (
        finding.kind === 'console-error'
        && expectedHttpErrors.some((entry) => (
          finding.text.includes(`status of ${entry.status}`)
          && entry.path === requestTarget(finding.url)
        ))
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
    for (const entry of expectedHttpErrors) {
      if (entry.seen !== entry.count) {
        unexpected.push({
          kind: 'missing-expected-http-error',
          text: `Expected ${entry.count} ${entry.method} ${entry.path} HTTP ${entry.status}; saw ${entry.seen}`,
        });
      }
    }
    return unexpected;
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
    stop() {
      active = false;
    },
  };
}


module.exports = { watchForProductProblems };
