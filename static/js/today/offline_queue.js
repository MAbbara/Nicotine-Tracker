const OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2}):(\d{2})$/;
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const runtimeRegistry = new WeakMap();
const DATABASE_NAME = 'nicotine-tracker';
const STORE_NAME = 'pending_events';

export function createIndexedDbStore(indexedDBImpl = globalThis.indexedDB) {
  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    if (!indexedDBImpl || typeof indexedDBImpl.open !== 'function') {
      return Promise.reject(new Error('indexeddb-unavailable'));
    }
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, {
            keyPath: ['offline_queue_id', 'client_event_id'],
          });
        }
      };
      request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
      request.onblocked = () => reject(new Error('indexeddb-open-blocked'));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function transact(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let result;
      let settled = false;
      let transaction;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        if (request) {
          request.onsuccess = () => { result = request.result; };
        }
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => {
        settled = true;
        resolve(result);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(transaction.error || new Error('indexeddb-transaction-failed'));
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  }

  async function remove(offlineQueueId, clientEventId) {
    const database = await openDatabase();
    const compoundKey = [offlineQueueId, clientEventId];
    return new Promise((resolve, reject) => {
      let existed = false;
      let settled = false;
      let transaction;
      try {
        transaction = database.transaction(STORE_NAME, 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        const lookup = objectStore.get(compoundKey);
        lookup.onsuccess = () => {
          if (lookup.result === undefined) return;
          existed = true;
          objectStore.delete(compoundKey);
        };
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => {
        settled = true;
        resolve(existed);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(transaction.error || new Error('indexeddb-transaction-failed'));
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  }

  return {
    put(record) { return transact('readwrite', (store) => store.put(record)); },
    async listAll() {
      const records = await transact('readonly', (store) => store.getAll());
      return Array.isArray(records) ? records : [];
    },
    remove,
    clearAll() { return transact('readwrite', (store) => store.clear()); },
  };
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch (_) {
    return false;
  }
}

function validOffsetTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(OFFSET_TIMESTAMP);
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionText = '',
    offsetSign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) return false;

  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const signedOffsetMinutes = (offsetSign === '+' ? 1 : -1)
    * ((offsetHour * 60) + offsetMinute);
  const wallTime = new Date(instant + (signedOffsetMinutes * 60_000));
  const millisecond = Number(fractionText.padEnd(3, '0').slice(0, 3) || 0);
  return wallTime.getUTCFullYear() === year
    && wallTime.getUTCMonth() + 1 === month
    && wallTime.getUTCDate() === day
    && wallTime.getUTCHours() === hour
    && wallTime.getUTCMinutes() === minute
    && wallTime.getUTCSeconds() === second
    && wallTime.getUTCMilliseconds() === millisecond;
}

export function sanitizeQueueRecord(payload, {
  enabled,
  offlineQueueId,
  queueOrder,
} = {}) {
  const reject = (reason) => ({ eligible: false, reason, record: null, notesOmitted: false });
  if (enabled !== true) return reject('disabled');
  if (typeof offlineQueueId !== 'string' || !offlineQueueId) return reject('identity_missing');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reject('invalid_payload');
  if (payload.custom_product !== null) return reject('custom_product');
  if (!EVENT_ID.test(payload.client_event_id || '')) return reject('client_event_id');
  if (!Number.isInteger(payload.pouch_id) || payload.pouch_id <= 0) return reject('pouch_id');
  if (!Number.isInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 100) {
    return reject('quantity');
  }
  if (!validOffsetTimestamp(payload.occurred_at_local)) {
    return reject('occurred_at_local');
  }
  if (!validTimezone(payload.timezone)) return reject('timezone');
  if (payload.craving_id !== null && (!Number.isInteger(payload.craving_id) || payload.craving_id <= 0)) {
    return reject('craving_id');
  }
  if (!Number.isSafeInteger(queueOrder) || queueOrder < 0) return reject('queue_order');

  return {
    eligible: true,
    notesOmitted: typeof payload.notes === 'string' && payload.notes.trim().length > 0,
    record: {
      offline_queue_id: offlineQueueId,
      client_event_id: payload.client_event_id,
      pouch_id: payload.pouch_id,
      quantity: payload.quantity,
      occurred_at_local: payload.occurred_at_local,
      timezone: payload.timezone,
      craving_id: payload.craving_id,
      queue_order: queueOrder,
    },
  };
}

export function createOfflineQueueRuntime({
  config = {},
  store,
  orderSource = () => Date.now(),
  fetchImpl = (...args) => fetch(...args),
  csrfToken = '',
  defer = (callback) => setTimeout(callback, 0),
  completionLimit = 12,
} = {}) {
  const enabled = config.enabled === true;
  const offlineQueueId = typeof config.offlineQueueId === 'string'
    ? config.offlineQueueId
    : '';
  let lastOrder = -1;
  let replayPromise = null;
  let startupPromise = null;
  let startupAllowsReplay = false;
  const subscribers = new Set();
  const attentionIds = new Set();
  const completionBuffer = [];
  let resultGeneration = 0;
  const boundedCompletionLimit = Number.isInteger(completionLimit) && completionLimit > 0
    ? completionLimit
    : 12;

  function publish(result, generation = resultGeneration) {
    if (generation !== resultGeneration) return;
    if (subscribers.size === 0) {
      completionBuffer.push(result);
      if (completionBuffer.length > boundedCompletionLimit) completionBuffer.shift();
      return;
    }
    for (const subscriber of subscribers) subscriber(result);
  }

  async function nextQueueOrder() {
    const records = await store.listAll();
    const storedMaximum = records.reduce((maximum, record) => (
      Number.isSafeInteger(record.queue_order)
        ? Math.max(maximum, record.queue_order)
        : maximum
    ), -1);
    const supplied = Number(orderSource());
    const safeSupplied = Number.isSafeInteger(supplied) && supplied >= 0
      ? supplied
      : 0;
    lastOrder = Math.max(lastOrder + 1, storedMaximum + 1, safeSupplied);
    if (!Number.isSafeInteger(lastOrder)) {
      throw new Error('offline-queue-order-unavailable');
    }
    return lastOrder;
  }

  async function enqueue(payload) {
    if (!store || typeof store.listAll !== 'function' || typeof store.put !== 'function') {
      return { queued: false, reason: 'storage_unavailable', notesOmitted: false };
    }
    try {
      const queueOrder = await nextQueueOrder();
      const sanitized = sanitizeQueueRecord(payload, {
        enabled,
        offlineQueueId,
        queueOrder,
      });
      if (!sanitized.eligible) {
        return {
          queued: false,
          reason: sanitized.reason,
          notesOmitted: false,
        };
      }
      await store.put(sanitized.record);
      attentionIds.delete(sanitized.record.client_event_id);
      return {
        queued: true,
        record: sanitized.record,
        notesOmitted: sanitized.notesOmitted,
      };
    } catch (_) {
      return { queued: false, reason: 'storage_unavailable', notesOmitted: false };
    }
  }

  async function list() {
    if (!store || typeof store.listAll !== 'function' || !offlineQueueId) return [];
    try {
      return (await store.listAll())
        .filter((record) => record.offline_queue_id === offlineQueueId)
        .sort((left, right) => left.queue_order - right.queue_order);
    } catch (_) {
      return [];
    }
  }

  async function remove(clientEventId) {
    if (!store || typeof store.remove !== 'function' || !offlineQueueId) {
      throw new Error('offline-queue-storage-unavailable');
    }
    const removed = await store.remove(offlineQueueId, clientEventId);
    if (removed) attentionIds.delete(clientEventId);
    return removed;
  }

  async function clearAll() {
    if (!store || typeof store.clearAll !== 'function') return false;
    try {
      await store.clearAll();
      attentionIds.clear();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function clearUnmatched() {
    if (!store || typeof store.listAll !== 'function' || typeof store.remove !== 'function') {
      return false;
    }
    try {
      const records = await store.listAll();
      for (const record of records) {
        if (record.offline_queue_id !== offlineQueueId) {
          await store.remove(record.offline_queue_id, record.client_event_id);
        }
      }
      const remaining = await store.listAll();
      return remaining.every((record) => record.offline_queue_id === offlineQueueId);
    } catch (_) {
      return false;
    }
  }

  async function clearCurrent() {
    if (!store || typeof store.listAll !== 'function' || typeof store.remove !== 'function') {
      return false;
    }
    try {
      const records = await store.listAll();
      for (const record of records) {
        if (record.offline_queue_id === offlineQueueId) {
          await store.remove(record.offline_queue_id, record.client_event_id);
          attentionIds.delete(record.client_event_id);
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function subscribe(subscriber) {
    if (typeof subscriber !== 'function') return () => {};
    subscribers.add(subscriber);
    const pending = completionBuffer.splice(0);
    for (const result of pending) subscriber(result);
    return () => subscribers.delete(subscriber);
  }

  async function replayPass(replayGeneration) {
    if (!enabled || !offlineQueueId || !startupAllowsReplay) return false;
    for (const record of await list()) {
      if (attentionIds.has(record.client_event_id)) return false;
      let response;
      try {
        response = await fetchImpl('/api/logs', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
          },
          body: JSON.stringify({
            client_event_id: record.client_event_id,
            pouch_id: record.pouch_id,
            custom_product: null,
            quantity: record.quantity,
            occurred_at_local: record.occurred_at_local,
            timezone: record.timezone,
            notes: null,
            craving_id: record.craving_id,
          }),
        });
      } catch (_) {
        publish({ type: 'retryable', record }, replayGeneration);
        return false;
      }
      let body = {};
      try {
        body = await response.json();
      } catch (_) {
        body = {};
      }
      const retryable = response.status === 408
        || response.status === 429
        || response.status >= 500
        || body?.error?.retryable === true;
      if (retryable) {
        publish({ type: 'retryable', record }, replayGeneration);
        return false;
      }
      if ([401, 403].includes(response.status)) {
        const cleared = await clearAll();
        if (cleared) {
          publish({ type: 'auth_cleared' }, replayGeneration);
        } else {
          attentionIds.add(record.client_event_id);
          publish({ type: 'needs_attention', record }, replayGeneration);
        }
        return false;
      }
      if (
        response.status >= 400
        && response.status < 500
        && ![401, 403].includes(response.status)
      ) {
        attentionIds.add(record.client_event_id);
        publish({ type: 'needs_attention', record }, replayGeneration);
        return false;
      }
      if (![200, 201].includes(response.status) || !body?.log) {
        attentionIds.add(record.client_event_id);
        publish({ type: 'needs_attention', record }, replayGeneration);
        return false;
      }
      try {
        await remove(record.client_event_id);
      } catch (_) {
        attentionIds.add(record.client_event_id);
        publish({ type: 'needs_attention', record }, replayGeneration);
        return false;
      }
      publish({
        type: 'synced',
        record,
        log: body.log,
        today: body.today || null,
        warnings: Array.isArray(body.warnings) ? body.warnings : [],
      }, replayGeneration);
    }
    return true;
  }

  function replayAfterStart() {
    if (replayPromise) return replayPromise;
    const replayGeneration = resultGeneration;
    const trackedReplay = Promise.resolve(startupPromise).then(
      () => replayPass(replayGeneration),
    ).finally(() => {
      if (replayPromise === trackedReplay) replayPromise = null;
    });
    replayPromise = trackedReplay;
    return replayPromise;
  }

  function replay() {
    ensureStartup();
    return replayAfterStart();
  }

  function ensureStartup({ publishPending = false, scheduleReplay = false } = {}) {
    if (startupPromise) return startupPromise;
    startupAllowsReplay = false;
    startupPromise = (async () => {
      if (!enabled || !offlineQueueId) {
        await clearAll();
        return [];
      }
      if (!await clearUnmatched()) return [];
      startupAllowsReplay = true;
      const records = await list();
      if (publishPending) {
        for (const record of records) publish({ type: 'pending', record });
      }
      if (scheduleReplay) defer(() => replayAfterStart());
      return records;
    })();
    return startupPromise;
  }

  function start() {
    return ensureStartup({ publishPending: true, scheduleReplay: true });
  }

  function invalidateBufferedResults() {
    completionBuffer.length = 0;
    resultGeneration += 1;
  }

  function cleanup() {
    invalidateBufferedResults();
    subscribers.clear();
    attentionIds.clear();
    startupPromise = null;
    startupAllowsReplay = false;
  }

  return {
    enqueue,
    list,
    remove,
    clearAll,
    clearCurrent,
    clearUnmatched,
    subscribe,
    replay,
    start,
    invalidateBufferedResults,
    cleanup,
  };
}

export function readOfflineQueueConfig(doc = globalThis.document) {
  const enabledValue = doc?.querySelector?.('meta[name="offline-queue-enabled"]')?.content;
  const identity = doc?.querySelector?.('meta[name="offline-queue-id"]')?.content || '';
  const enabled = enabledValue === 'true' && identity.length > 0;
  return {
    enabled,
    offlineQueueId: enabled || enabledValue === 'false' ? identity : '',
  };
}

export function getOfflineQueueRuntime({
  doc = globalThis.document,
  win = globalThis.window,
  store,
  indexedDBImpl,
  fetchImpl,
  orderSource,
  defer,
} = {}) {
  if (win && runtimeRegistry.has(win)) return runtimeRegistry.get(win);
  const runtime = createOfflineQueueRuntime({
    config: readOfflineQueueConfig(doc),
    store: store || createIndexedDbStore(indexedDBImpl || win?.indexedDB),
    fetchImpl: fetchImpl || (win?.fetch ? win.fetch.bind(win) : undefined),
    csrfToken: doc?.querySelector?.('meta[name="csrf-token"]')?.content || '',
    orderSource,
    defer,
  });
  if (win) runtimeRegistry.set(win, runtime);
  return runtime;
}
