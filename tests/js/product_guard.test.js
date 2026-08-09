const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { watchForProductProblems } = require('../browser/helpers/product_guard');


function createPage() {
  const page = new EventEmitter();
  page.url = () => 'http://127.0.0.1:5000/insights/';
  return page;
}


function response(url, status = 503, method = 'GET') {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ method: () => method }),
  };
}


function abortedRequest(url, method = 'GET') {
  return {
    url: () => url,
    method: () => method,
    failure: () => ({ errorText: 'net::ERR_ABORTED' }),
    isNavigationRequest: () => false,
  };
}


function expectDeep(actual) {
  return { toEqual: (expected) => assert.deepEqual(actual, expected) };
}


test('expected HTTP errors account for one exact associated non-navigation abort', () => {
  const page = createPage();
  const guard = watchForProductProblems(page);
  const url = 'http://127.0.0.1:5000/insights/api/insights?days=90';
  page.emit('response', response(url));
  page.emit('requestfailed', abortedRequest(url));

  guard.assertClean(expectDeep, {
    expectedHttpErrors: [{
      method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
    }],
  });
});


test('unlisted and excess aborts remain product-guard findings', () => {
  const expected = 'http://127.0.0.1:5000/insights/api/insights?days=90';
  const expectedHttpErrors = [{
    method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
  }];

  for (const findings of [
    [response(expected), abortedRequest(
      'http://127.0.0.1:5000/insights/api/insights?days=365',
    )],
    [response(expected), abortedRequest(expected), abortedRequest(expected)],
  ]) {
    const page = createPage();
    const guard = watchForProductProblems(page);
    page.emit('response', findings[0]);
    findings.slice(1).forEach((finding) => page.emit('requestfailed', finding));
    assert.throws(() => guard.assertClean(expectDeep, { expectedHttpErrors }));
  }
});
