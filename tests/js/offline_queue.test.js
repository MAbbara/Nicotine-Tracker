const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function importOfflineQueue() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static/js/today/offline_queue.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function eligiblePayload(overrides = {}) {
  return {
    client_event_id: '00000000-0000-4000-8000-000000000002',
    pouch_id: 7,
    custom_product: null,
    quantity: 2,
    occurred_at_local: '2026-07-31T09:15:00+03:00',
    timezone: 'Asia/Riyadh',
    notes: 'Private reflection',
    craving_id: 11,
    context: 'private context',
    outcome_notes: 'private outcome',
    ...overrides,
  };
}

function storedRecord({
  offlineQueueId = 'opaque-account-scope',
  clientEventId = '00000000-0000-4000-8000-000000000002',
  queueOrder = 1,
} = {}) {
  return {
    offline_queue_id: offlineQueueId,
    client_event_id: clientEventId,
    pouch_id: 7,
    quantity: 2,
    occurred_at_local: '2026-07-31T09:15:00+03:00',
    timezone: 'Asia/Riyadh',
    craving_id: null,
    queue_order: queueOrder,
  };
}

function createMemoryStore(seed = []) {
  let records = seed.map((record) => ({ ...record }));
  const key = (record) => `${record.offline_queue_id}\u0000${record.client_event_id}`;
  return {
    async put(record) {
      records = records.filter((existing) => key(existing) !== key(record));
      records.push({ ...record });
    },
    async listAll() { return records.map((record) => ({ ...record })); },
    async remove(offlineQueueId, clientEventId) {
      const before = records.length;
      records = records.filter((record) => (
        record.offline_queue_id !== offlineQueueId
        || record.client_event_id !== clientEventId
      ));
      return records.length !== before;
    },
    async clearAll() { records = []; },
    snapshot() { return records.map((record) => ({ ...record })); },
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    async json() { return body; },
  };
}

function fakeReplayClock(start) {
  let current = start;
  let sequence = 0;
  const timers = new Map();
  const cleared = [];
  return {
    now: () => current,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, deadline: current + delay });
      return id;
    },
    clearTimeout(id) {
      if (timers.delete(id)) cleared.push(id);
    },
    pending() {
      return [...timers.values()].map(({ deadline }) => deadline).sort((a, b) => a - b);
    },
    cleared,
    async advance(milliseconds) {
      current += milliseconds;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.deadline <= current)
        .sort((left, right) => left[1].deadline - right[1].deadline);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('queue sanitizer persists only the approved structured replay keys', async () => {
  const { sanitizeQueueRecord } = await importOfflineQueue();

  const result = sanitizeQueueRecord(eligiblePayload(), {
    enabled: true,
    offlineQueueId: 'opaque-account-scope',
    queueOrder: 41,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.notesOmitted, true);
  assert.deepEqual(result.record, {
    offline_queue_id: 'opaque-account-scope',
    client_event_id: '00000000-0000-4000-8000-000000000002',
    pouch_id: 7,
    quantity: 2,
    occurred_at_local: '2026-07-31T09:15:00+03:00',
    timezone: 'Asia/Riyadh',
    craving_id: 11,
    queue_order: 41,
  });
  assert.deepEqual(Object.keys(result.record).sort(), [
    'client_event_id',
    'craving_id',
    'occurred_at_local',
    'offline_queue_id',
    'pouch_id',
    'quantity',
    'queue_order',
    'timezone',
  ]);
});

test('queue sanitizer rejects disabled, identity-less, custom, and invalid structured intents', async () => {
  const { sanitizeQueueRecord } = await importOfflineQueue();
  const config = {
    enabled: true,
    offlineQueueId: 'opaque-account-scope',
    queueOrder: 1,
  };

  assert.equal(sanitizeQueueRecord(eligiblePayload(), { ...config, enabled: false }).eligible, false);
  assert.equal(sanitizeQueueRecord(eligiblePayload(), { ...config, offlineQueueId: '' }).eligible, false);
  assert.equal(sanitizeQueueRecord(eligiblePayload({ custom_product: { brand: 'Free text' } }), config).eligible, false);
  assert.equal(sanitizeQueueRecord(eligiblePayload({ pouch_id: null }), config).eligible, false);
  assert.equal(sanitizeQueueRecord(eligiblePayload({ quantity: 0 }), config).eligible, false);
  assert.equal(sanitizeQueueRecord(eligiblePayload({ craving_id: 0 }), config).eligible, false);
});

test('queue sanitizer rejects normalized calendar dates without rewriting valid offset input', async () => {
  const { sanitizeQueueRecord } = await importOfflineQueue();
  const config = {
    enabled: true,
    offlineQueueId: 'opaque-account-scope',
    queueOrder: 1,
  };

  const impossible = sanitizeQueueRecord(eligiblePayload({
    occurred_at_local: '2026-02-30T09:15:00+03:00',
  }), config);
  assert.equal(impossible.eligible, false);
  assert.equal(impossible.reason, 'occurred_at_local');

  const validTimestamp = '2024-02-29T23:59:59.123456-03:30';
  const valid = sanitizeQueueRecord(eligiblePayload({
    occurred_at_local: validTimestamp,
    not_before: 0,
  }), config);
  assert.equal(valid.eligible, true);
  assert.equal(valid.record.occurred_at_local, validTimestamp);
  assert.equal(Object.hasOwn(valid.record, 'not_before'), false);
});

test('queue runtime uses compound identity and lists true insertion order', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const suppliedOrders = [100, 100];
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: () => suppliedOrders.shift(),
  });

  const laterSortingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const earlierSortingId = '00000000-0000-4000-8000-000000000001';
  await runtime.enqueue(eligiblePayload({ client_event_id: laterSortingId }));
  await runtime.enqueue(eligiblePayload({ client_event_id: earlierSortingId }));

  assert.deepEqual(
    (await runtime.list()).map((record) => record.client_event_id),
    [laterSortingId, earlierSortingId],
  );
  assert.deepEqual(
    store.snapshot().map((record) => record.queue_order).sort((a, b) => a - b),
    [100, 101],
  );

  await runtime.enqueue(eligiblePayload({
    client_event_id: earlierSortingId,
    quantity: 4,
  }));
  assert.equal(store.snapshot().length, 2, 'the compound key replaces the same account/event');
  assert.equal((await runtime.list())[1].quantity, 4);
});

test('201 replay sends the original UUID with forced null free text then clears the record', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const requests = [];
  const results = [];
  const canonical = {
    id: 91,
    client_event_id: '00000000-0000-4000-8000-000000000002',
  };
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: () => 1,
    csrfToken: 'csrf-value',
    fetchImpl: async (url, options) => {
      requests.push([url, options]);
      return jsonResponse(201, { log: canonical, today: { status: 'on_track' }, warnings: [] });
    },
  });
  runtime.subscribe((result) => results.push(result));
  await runtime.enqueue(eligiblePayload());

  await runtime.replay();

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/logs');
  assert.equal(requests[0][1].method, 'POST');
  assert.equal(requests[0][1].credentials, 'same-origin');
  assert.equal(requests[0][1].headers['X-CSRFToken'], 'csrf-value');
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    client_event_id: '00000000-0000-4000-8000-000000000002',
    pouch_id: 7,
    custom_product: null,
    quantity: 2,
    occurred_at_local: '2026-07-31T09:15:00+03:00',
    timezone: 'Asia/Riyadh',
    notes: null,
    craving_id: 11,
  });
  assert.deepEqual(await runtime.list(), []);
  assert.equal(results.at(-1).type, 'synced');
  assert.equal(results.at(-1).log, canonical);
});

test('duplicate 200 acknowledgement clears the idempotent replay record', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const canonical = {
    id: 92,
    client_event_id: '00000000-0000-4000-8000-000000000002',
  };
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: () => 1,
    fetchImpl: async () => jsonResponse(200, {
      created: false,
      log: canonical,
      today: null,
      warnings: [{ code: 'today_refresh_unavailable' }],
    }),
  });
  await runtime.enqueue(eligiblePayload());

  assert.equal(await runtime.replay(), true);
  assert.deepEqual(await runtime.list(), []);
});

test('canonical replay stays synced when a concurrent action already removed the exact record', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();

  for (const status of [201, 200]) {
    const record = storedRecord();
    const store = createMemoryStore([record]);
    const results = [];
    let requestStarted;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    let settleResponse;
    const runtime = createOfflineQueueRuntime({
      config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
      store,
      fetchImpl: async () => {
        requestStarted();
        return new Promise((resolve) => { settleResponse = resolve; });
      },
    });
    runtime.subscribe((result) => results.push(result));

    const replay = runtime.replay();
    await started;
    assert.equal(await runtime.remove(record.client_event_id), true);
    assert.deepEqual(store.snapshot(), []);

    const canonical = { id: status, client_event_id: record.client_event_id };
    settleResponse(jsonResponse(status, {
      created: status === 201,
      log: canonical,
      today: { status: 'on_track' },
      warnings: [],
    }));

    assert.equal(await replay, true);
    assert.deepEqual(store.snapshot(), []);
    assert.deepEqual(results, [{
      type: 'synced',
      record,
      log: canonical,
      today: { status: 'on_track' },
      warnings: [],
    }]);
  }
});

test('canonical response with rejected persistent deletion never publishes synced', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const record = storedRecord();
  const store = createMemoryStore([record]);
  store.remove = async () => {
    throw new Error('browser storage failure');
  };
  const results = [];
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(201, {
        log: { id: 96, client_event_id: record.client_event_id },
        today: { status: 'on_track' },
        warnings: [],
      });
    },
  });
  runtime.subscribe((result) => results.push(result));

  assert.equal(await runtime.replay(), false);
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);
  assert.deepEqual(store.snapshot(), [record]);
  assert.deepEqual(results, [{ type: 'needs_attention', record }]);
  await assert.rejects(runtime.remove(record.client_event_id), /browser storage failure/);
});

test('network failure retains the first record and stops the replay pass', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const calls = [];
  const results = [];
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: (() => {
      let value = 0;
      return () => ++value;
    })(),
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body).client_event_id);
      throw new Error('private transport detail');
    },
  });
  runtime.subscribe((result) => results.push(result));
  await runtime.enqueue(eligiblePayload());
  await runtime.enqueue(eligiblePayload({
    client_event_id: '00000000-0000-4000-8000-000000000003',
  }));

  assert.equal(await runtime.replay(), false);
  assert.equal(calls.length, 1);
  assert.equal((await runtime.list()).length, 2);
  assert.deepEqual(results.at(-1), {
    type: 'retryable',
    record: (await runtime.list())[0],
  });
  assert.doesNotMatch(JSON.stringify(results), /private transport detail/);
});

test('408, 429, 5xx, and retryable envelopes retain and classify the record', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const cases = [
    [408, { error: { retryable: false } }],
    [429, { error: { retryable: false } }],
    [503, { error: { retryable: false } }],
    [409, { error: { retryable: true } }],
  ];

  for (const [status, body] of cases) {
    const store = createMemoryStore();
    const results = [];
    const runtime = createOfflineQueueRuntime({
      config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
      store,
      orderSource: () => 1,
      fetchImpl: async () => jsonResponse(status, body),
    });
    runtime.subscribe((result) => results.push(result));
    await runtime.enqueue(eligiblePayload());

    assert.equal(await runtime.replay(), false, `status ${status}`);
    assert.equal((await runtime.list()).length, 1, `status ${status}`);
    assert.equal(results.at(-1)?.type, 'retryable', `status ${status}`);
  }
});

test('permanent 422 retains one attention item and does not replay-loop it', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const results = [];
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: () => 1,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(422, {
        error: {
          code: 'validation_error',
          message: 'private server detail',
          field_errors: { notes: ['private'] },
          retryable: false,
        },
      });
    },
  });
  runtime.subscribe((result) => results.push(result));
  await runtime.enqueue(eligiblePayload());

  assert.equal(await runtime.replay(), false);
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);
  assert.equal((await runtime.list()).length, 1);
  assert.deepEqual(results, [{
    type: 'needs_attention',
    record: (await runtime.list())[0],
  }]);
  assert.doesNotMatch(JSON.stringify(results), /private/);
});

test('successful corrected enqueue unblocks the same attention UUID for replay', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore();
  const results = [];
  let fetchCount = 0;
  const eventId = '00000000-0000-4000-8000-000000000002';
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    orderSource: (() => {
      let value = 0;
      return () => ++value;
    })(),
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse(422, {
          error: {
            code: 'validation_error',
            message: 'private validation detail',
            field_errors: {},
            retryable: false,
          },
        });
      }
      return jsonResponse(201, {
        log: { id: 93, client_event_id: eventId },
        today: { status: 'on_track' },
        warnings: [],
      });
    },
  });
  runtime.subscribe((result) => results.push(result));
  await runtime.enqueue(eligiblePayload());
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);

  const corrected = await runtime.enqueue(eligiblePayload({ quantity: 3 }));
  assert.equal(corrected.queued, true);
  assert.equal((await runtime.list())[0].quantity, 3);

  assert.equal(await runtime.replay(), true);
  assert.equal(fetchCount, 2);
  assert.deepEqual(await runtime.list(), []);
  assert.equal(results.at(-1).type, 'synced');
});

test('401 and 403 clear every queued identity and publish neutral auth clearing', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();

  for (const status of [401, 403]) {
    const store = createMemoryStore([
      storedRecord(),
      storedRecord({
        offlineQueueId: 'different-opaque-scope',
        clientEventId: '00000000-0000-4000-8000-000000000004',
      }),
    ]);
    const results = [];
    const runtime = createOfflineQueueRuntime({
      config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
      store,
      fetchImpl: async () => jsonResponse(status, {
        error: { code: 'authentication_required', retryable: false },
      }),
    });
    runtime.subscribe((result) => results.push(result));

    assert.equal(await runtime.replay(), false);
    assert.deepEqual(store.snapshot(), []);
    assert.deepEqual(results, [{ type: 'auth_cleared' }]);
    assert.doesNotMatch(JSON.stringify(results), /opaque/);
  }
});

test('auth response does not claim browser clearing when persistence rejects it', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const record = storedRecord();
  const store = createMemoryStore([record]);
  store.clearAll = async () => {
    throw new Error('private storage failure');
  };
  const results = [];
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(401, {
        error: { code: 'authentication_required', private_detail: 'must not escape' },
      });
    },
  });
  runtime.subscribe((result) => results.push(result));

  assert.equal(await runtime.replay(), false);
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);
  assert.deepEqual(store.snapshot(), [record]);
  assert.deepEqual(results, [{ type: 'needs_attention', record }]);
  assert.doesNotMatch(JSON.stringify(results), /private_detail|must not escape/);
});

test('startup clears disabled or unmatched identities before any replay request', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();

  for (const config of [
    { enabled: false, offlineQueueId: 'opaque-account-scope' },
    { enabled: true, offlineQueueId: '' },
  ]) {
    const store = createMemoryStore([storedRecord()]);
    let fetchCount = 0;
    const runtime = createOfflineQueueRuntime({
      config,
      store,
      fetchImpl: async () => {
        fetchCount += 1;
        return jsonResponse(201, { log: { id: 1 }, today: null, warnings: [] });
      },
    });
    await runtime.start();
    assert.deepEqual(store.snapshot(), []);
    assert.equal(fetchCount, 0);
  }

  const current = storedRecord();
  const store = createMemoryStore([
    storedRecord({
      offlineQueueId: 'old-opaque-scope',
      clientEventId: '00000000-0000-4000-8000-000000000004',
    }),
    current,
  ]);
  const results = [];
  const requests = [];
  const deferred = [];
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    defer: (callback) => deferred.push(callback),
    fetchImpl: async (url, options) => {
      requests.push(JSON.parse(options.body).client_event_id);
      return jsonResponse(201, {
        log: { id: 8, client_event_id: current.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  runtime.subscribe((result) => results.push(result));

  await runtime.start();
  assert.deepEqual(store.snapshot(), [current]);
  assert.equal(requests.length, 0);
  assert.deepEqual(results, [{ type: 'pending', record: current }]);
  assert.equal(deferred.length, 0, 'startup does not auto-replay records without a deadline');
  await runtime.replay();
  assert.deepEqual(requests, [current.client_event_id]);
  assert.deepEqual(store.snapshot(), []);
});

test('public replay performs unmatched identity cleanup before its first request', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const current = storedRecord();
  const unmatched = storedRecord({
    offlineQueueId: 'old-opaque-scope',
    clientEventId: '00000000-0000-4000-8000-000000000011',
  });
  const store = createMemoryStore([unmatched, current]);
  const remove = store.remove.bind(store);
  let cleanupStarted = false;
  let releaseCleanup;
  store.remove = async (offlineQueueId, clientEventId) => {
    if (offlineQueueId === unmatched.offline_queue_id) {
      cleanupStarted = true;
      await new Promise((resolve) => { releaseCleanup = resolve; });
    }
    return remove(offlineQueueId, clientEventId);
  };
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    defer: () => {},
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(201, {
        log: { id: 101, client_event_id: current.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  const replay = runtime.replay();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cleanupStarted, true);
  assert.equal(fetchCount, 0);
  assert.deepEqual(store.snapshot(), [unmatched, current]);

  releaseCleanup();
  assert.equal(await replay, true);
  assert.equal(fetchCount, 1);
  assert.deepEqual(store.snapshot(), []);
});

test('replay waits for disabled startup clearing before any fetch', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore([storedRecord()]);
  const clearAll = store.clearAll.bind(store);
  let releaseClear;
  store.clearAll = async () => {
    await new Promise((resolve) => { releaseClear = resolve; });
    await clearAll();
  };
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: false, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(201, {
        log: { id: 94, client_event_id: storedRecord().client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  const startup = runtime.start();
  const replay = runtime.replay();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetchCount, 0);
  releaseClear();
  await startup;
  assert.equal(await replay, false);
  assert.equal(fetchCount, 0);
  assert.deepEqual(store.snapshot(), []);
});

test('disabled runtime never fetches when browser clearing fails', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore([storedRecord()]);
  store.clearAll = async () => {
    throw new Error('private storage failure');
  };
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: false, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(201, {
        log: { id: 98, client_event_id: storedRecord().client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  await runtime.start();
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 0);
  assert.deepEqual(store.snapshot(), [storedRecord()]);
});

test('startup blocks replay when an unmatched identity cannot be removed', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const current = storedRecord();
  const unmatched = storedRecord({
    offlineQueueId: 'old-opaque-scope',
    clientEventId: '00000000-0000-4000-8000-000000000010',
  });
  const store = createMemoryStore([unmatched, current]);
  const remove = store.remove.bind(store);
  store.remove = async (offlineQueueId, clientEventId) => {
    if (offlineQueueId === unmatched.offline_queue_id) return false;
    return remove(offlineQueueId, clientEventId);
  };
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    defer: () => {},
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(201, {
        log: { id: 99, client_event_id: current.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  assert.deepEqual(await runtime.start(), []);
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 0);
  assert.deepEqual(store.snapshot(), [unmatched, current]);
});

test('overlapping replay signals join one in-flight promise and one POST', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore([storedRecord()]);
  let releaseFetch;
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      await new Promise((resolve) => { releaseFetch = resolve; });
      return jsonResponse(201, {
        log: { id: 9, client_event_id: storedRecord().client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  const first = runtime.replay();
  const second = runtime.replay();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);
  releaseFetch();
  await first;
});

test('late subscribers consume a bounded page-memory completion buffer once', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const ids = [
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007',
  ];
  const store = createMemoryStore(ids.map((clientEventId, index) => storedRecord({
    clientEventId,
    queueOrder: index + 1,
  })));
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    completionLimit: 2,
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      return jsonResponse(201, {
        log: { id: payload.client_event_id.at(-1), client_event_id: payload.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  await runtime.replay();

  const firstLateResults = [];
  runtime.subscribe((result) => firstLateResults.push(result));
  assert.deepEqual(
    firstLateResults.map((result) => result.record.client_event_id),
    ids.slice(1),
  );

  const secondLateResults = [];
  runtime.subscribe((result) => secondLateResults.push(result));
  assert.deepEqual(secondLateResults, []);
});

test('shell configuration parses only enabled and opaque ID into one per-window runtime', async () => {
  const { readOfflineQueueConfig, getOfflineQueueRuntime } = await importOfflineQueue();
  const values = new Map([
    ['offline-queue-enabled', 'true'],
    ['offline-queue-id', 'opaque-account-scope'],
    ['csrf-token', 'csrf-value'],
  ]);
  const doc = {
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      return values.has(name) ? { content: values.get(name) } : null;
    },
  };
  const win = { indexedDB: null };
  const store = createMemoryStore();

  assert.deepEqual(readOfflineQueueConfig(doc), {
    enabled: true,
    offlineQueueId: 'opaque-account-scope',
  });
  const first = getOfflineQueueRuntime({ doc, win, store, defer: () => {} });
  const second = getOfflineQueueRuntime({ doc, win, store: createMemoryStore() });
  assert.equal(first, second);

  values.delete('offline-queue-id');
  assert.deepEqual(readOfflineQueueConfig(doc), {
    enabled: false,
    offlineQueueId: '',
  });
});

test('queue code never reads or writes CacheStorage', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  let cacheCalls = 0;
  const caches = new Proxy({}, {
    get() {
      cacheCalls += 1;
      throw new Error('CacheStorage must stay unused');
    },
  });
  const store = createMemoryStore([storedRecord()]);
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    caches,
    fetchImpl: async () => jsonResponse(201, {
      log: { id: 1, client_event_id: storedRecord().client_event_id },
      today: null,
      warnings: [],
    }),
  });
  await runtime.replay();
  assert.equal(cacheCalls, 0);
});

test('runtime cleanup clears buffered results and subscribers without touching records', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore([storedRecord()]);
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => jsonResponse(201, {
      log: { id: 2, client_event_id: storedRecord().client_event_id },
      today: null,
      warnings: [],
    }),
  });
  await runtime.replay();
  runtime.cleanup();

  const late = [];
  runtime.subscribe((result) => late.push(result));
  assert.deepEqual(late, []);
  assert.deepEqual(store.snapshot(), []);
});

test('clearCurrent removes only the active opaque identity', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const unmatched = storedRecord({
    offlineQueueId: 'another-opaque-scope',
    clientEventId: '00000000-0000-4000-8000-000000000008',
  });
  const store = createMemoryStore([storedRecord(), unmatched]);
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
  });

  assert.equal(await runtime.clearCurrent(), true);
  assert.deepEqual(store.snapshot(), [unmatched]);
});

test('retryable and auth statuses classify safely even when JSON parsing fails', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  for (const [status, expectedType, remaining] of [
    [503, 'retryable', 1],
    [401, 'auth_cleared', 0],
  ]) {
    const store = createMemoryStore([storedRecord()]);
    const results = [];
    const runtime = createOfflineQueueRuntime({
      config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
      store,
      fetchImpl: async () => ({
        status,
        ok: false,
        async json() { throw new SyntaxError('private invalid response'); },
      }),
    });
    runtime.subscribe((result) => results.push(result));

    assert.equal(await runtime.replay(), false);
    assert.equal(store.snapshot().length, remaining);
    assert.equal(results.at(-1).type, expectedType);
    assert.doesNotMatch(JSON.stringify(results), /private/);
  }
});

test('Retry-After persists a not_before boundary and replay waits until it expires', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  let now = Date.parse('2026-07-31T06:00:00Z');
  let fetchCount = 0;
  const store = createMemoryStore([storedRecord()]);
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: () => now,
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse(429, {
          error: { code: 'rate_limited', retryable: true, retry_after_seconds: 90 },
        }, { 'Retry-After': '60' });
      }
      return jsonResponse(201, {
        log: { id: 9, client_event_id: storedRecord().client_event_id },
        today: null,
        warnings: [],
      });
    },
  });

  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);
  assert.equal(store.snapshot()[0].not_before, now + 60_000);

  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1, 'the persisted boundary prevents an early replay request');

  now += 60_001;
  assert.equal(await runtime.replay(), true);
  assert.equal(fetchCount, 2);
  assert.deepEqual(store.snapshot(), []);
});

test('one owned timer auto-replays due records, reschedules earlier deadlines, and cleanup cancels it', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const startedAt = Date.parse('2026-07-31T06:00:00Z');
  const clock = fakeReplayClock(startedAt);
  const store = createMemoryStore();
  const requests = [];
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    defer: () => {},
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload.client_event_id);
      return jsonResponse(201, {
        log: { id: requests.length, client_event_id: payload.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  await runtime.start();

  const later = eligiblePayload({ client_event_id: '00000000-0000-4000-8000-000000000021' });
  const earlier = eligiblePayload({ client_event_id: '00000000-0000-4000-8000-000000000022' });
  await runtime.enqueue(later, { notBefore: startedAt + 1_000 });
  assert.deepEqual(clock.pending(), [startedAt + 1_000]);
  await runtime.enqueue(earlier, { notBefore: startedAt + 500 });
  assert.deepEqual(clock.pending(), [startedAt + 500]);
  assert.equal(clock.cleared.length, 1, 'the earlier deadline replaces the owned timer');

  assert.equal(await runtime.replay(), false);
  assert.deepEqual(requests, [], 'manual or online replay cannot bypass not_before');
  await clock.advance(499);
  assert.deepEqual(requests, []);
  await clock.advance(1);
  assert.deepEqual(requests, [earlier.client_event_id]);
  assert.deepEqual(clock.pending(), [startedAt + 1_000]);
  await clock.advance(500);
  assert.deepEqual(requests, [earlier.client_event_id, later.client_event_id]);
  assert.deepEqual(store.snapshot(), []);

  await runtime.enqueue(eligiblePayload({
    client_event_id: '00000000-0000-4000-8000-000000000023',
  }), { notBefore: startedAt + 2_000 });
  assert.equal(clock.pending().length, 1);
  runtime.cleanup();
  assert.deepEqual(clock.pending(), []);
});

test('a queued record without a deadline waits for manual or online replay', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const startedAt = Date.parse('2026-07-31T06:00:00Z');
  const clock = fakeReplayClock(startedAt);
  const store = createMemoryStore();
  let requests = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    defer: () => {},
    fetchImpl: async (_url, options) => {
      requests += 1;
      const payload = JSON.parse(options.body);
      return jsonResponse(201, {
        log: { id: 90, client_event_id: payload.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  await runtime.start();

  const queued = await runtime.enqueue(eligiblePayload());
  assert.equal(Object.hasOwn(queued.record, 'not_before'), false);
  assert.deepEqual(clock.pending(), []);
  await clock.advance(0);
  assert.equal(requests, 0);
  assert.equal(await runtime.replay(), true);
  assert.equal(requests, 1);
  assert.deepEqual(store.snapshot(), []);
});

test('an enqueue whose deadline is already due stays available for one manual replay', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const startedAt = Date.parse('2026-07-31T06:00:00Z');
  const clock = fakeReplayClock(startedAt);
  const store = createMemoryStore();
  let requests = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    defer: () => {},
    fetchImpl: async (_url, options) => {
      requests += 1;
      const payload = JSON.parse(options.body);
      return jsonResponse(201, {
        log: { id: 91, client_event_id: payload.client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  await runtime.start();

  await runtime.enqueue(eligiblePayload(), { notBefore: startedAt });
  assert.deepEqual(clock.pending(), []);
  assert.equal(requests, 0);
  await clock.advance(0);
  assert.equal(requests, 0);
  assert.equal(await runtime.replay(), true);
  assert.equal(requests, 1);
  assert.deepEqual(store.snapshot(), []);
});

test('long replay deadlines use bounded timer slices and re-evaluate storage', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const startedAt = Date.parse('2026-07-31T06:00:00Z');
  const clock = fakeReplayClock(startedAt);
  const store = createMemoryStore();
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    defer: () => {},
  });
  await runtime.start();
  const deadline = startedAt + (40 * 24 * 60 * 60 * 1000);
  await runtime.enqueue(eligiblePayload(), { notBefore: deadline });

  const firstSlice = clock.pending()[0] - startedAt;
  assert.ok(firstSlice > 0 && firstSlice <= 2_147_483_647);
  const persisted = store.snapshot()[0];
  await store.put({ ...persisted, not_before: startedAt + firstSlice + 500 });
  await clock.advance(firstSlice);
  assert.equal(store.snapshot().length, 1);
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0], startedAt + firstSlice + 500);
  runtime.cleanup();
  assert.deepEqual(clock.pending(), []);
});

test('a non-JSON 429 reads Retry-After before parsing and automatically retries at expiry', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const startedAt = Date.parse('2026-07-31T06:00:00Z');
  const clock = fakeReplayClock(startedAt);
  const store = createMemoryStore([storedRecord()]);
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    defer: () => {},
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          status: 429,
          ok: false,
          headers: { get: () => '2' },
          async json() { throw new SyntaxError('private proxy body'); },
        };
      }
      return jsonResponse(201, {
        log: { id: 9, client_event_id: storedRecord().client_event_id },
        today: null,
        warnings: [],
      });
    },
  });
  await runtime.start();

  assert.equal(await runtime.replay(), false);
  assert.equal(store.snapshot()[0].not_before, startedAt + 2_000);
  assert.deepEqual(clock.pending(), [startedAt + 2_000]);
  await clock.advance(1_999);
  assert.equal(fetchCount, 1);
  await clock.advance(1);
  assert.equal(fetchCount, 2);
  assert.deepEqual(store.snapshot(), []);
});

test('response without a canonical log becomes one sanitized attention result', async () => {
  const { createOfflineQueueRuntime } = await importOfflineQueue();
  const store = createMemoryStore([storedRecord()]);
  const results = [];
  let fetchCount = 0;
  const runtime = createOfflineQueueRuntime({
    config: { enabled: true, offlineQueueId: 'opaque-account-scope' },
    store,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(204, {
        private_response_detail: 'must not escape',
      });
    },
  });
  runtime.subscribe((result) => results.push(result));

  assert.equal(await runtime.replay(), false);
  assert.equal(await runtime.replay(), false);
  assert.equal(fetchCount, 1);
  assert.deepEqual(store.snapshot(), [storedRecord()]);
  assert.deepEqual(results, [{
    type: 'needs_attention',
    record: storedRecord(),
  }]);
  assert.doesNotMatch(JSON.stringify(results), /private_response_detail|must not escape/);
});
