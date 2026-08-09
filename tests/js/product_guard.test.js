const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { watchForProductProblems } = require('../browser/helpers/product_guard');


function createPage() {
  const page = new EventEmitter();
  page.url = () => 'http://127.0.0.1:5000/insights/';
  return page;
}


function request(url, method = 'GET', { navigation = false } = {}) {
  return {
    url: () => url,
    method: () => method,
    failure: () => ({ errorText: 'net::ERR_ABORTED' }),
    isNavigationRequest: () => navigation,
  };
}


function response(requestObject, status = 503) {
  return {
    url: () => requestObject.url(),
    status: () => status,
    request: () => requestObject,
  };
}


function expectDeep(actual) {
  return { toEqual: (expected) => assert.deepEqual(actual, expected) };
}


test('expected HTTP errors account for one exact associated non-navigation abort', () => {
  const page = createPage();
  const guard = watchForProductProblems(page);
  const url = 'http://127.0.0.1:5000/insights/api/insights?days=90';
  const exactRequest = request(url);
  page.emit('response', response(exactRequest));
  page.emit('requestfailed', exactRequest);

  guard.assertClean(expectDeep, {
    expectedHttpErrors: [{
      method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
    }],
  });
});


test('a distinct request with the same method and URL is not associated', () => {
  const expected = 'http://127.0.0.1:5000/insights/api/insights?days=90';
  const responseRequest = request(expected);
  const abortedRequest = request(expected);
  const page = createPage();
  const guard = watchForProductProblems(page);
  page.emit('response', response(responseRequest));
  page.emit('requestfailed', abortedRequest);

  assert.throws(() => guard.assertClean(expectDeep, {
    expectedHttpErrors: [{
      method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
    }],
  }));
  assert.equal(Object.hasOwn(guard.problems()[0], 'request'), false);
});


test('wrong order, method, URL, navigation, excess, and missing responses still fail', () => {
  const expected = 'http://127.0.0.1:5000/insights/api/insights?days=90';
  const expectedHttpErrors = [{
    method: 'GET', path: '/insights/api/insights?days=90', status: 503, count: 1,
  }];

  for (const emitFindings of [
    (page) => {
      const exact = request(expected);
      page.emit('requestfailed', exact);
      page.emit('response', response(exact));
    },
    (page) => {
      const wrongMethod = request(expected, 'POST');
      page.emit('response', response(wrongMethod));
      page.emit('requestfailed', wrongMethod);
    },
    (page) => {
      const wrongStatus = request(expected);
      page.emit('response', response(wrongStatus, 500));
      page.emit('requestfailed', wrongStatus);
    },
    (page) => {
      const responseRequest = request(expected);
      page.emit('response', response(responseRequest));
      page.emit('requestfailed', request(
        'http://127.0.0.1:5000/insights/api/insights?days=365',
      ));
    },
    (page) => {
      const navigation = request(expected, 'GET', { navigation: true });
      page.emit('response', response(navigation));
      page.emit('requestfailed', navigation);
    },
    (page) => {
      const exact = request(expected);
      page.emit('response', response(exact));
      page.emit('requestfailed', exact);
      page.emit('requestfailed', exact);
    },
    () => {},
  ]) {
    const page = createPage();
    const guard = watchForProductProblems(page);
    emitFindings(page);
    assert.throws(() => guard.assertClean(expectDeep, { expectedHttpErrors }));
  }
});
