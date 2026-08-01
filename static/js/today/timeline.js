function quantityLabel(quantity) {
  return `${quantity} ${quantity === 1 ? 'pouch' : 'pouches'}`;
}

export const TODAY_CANONICAL_CHECK_IN_EVENT = 'nicotine-tracker:canonical-check-in';

export function resolvePendingTimelineTime({
  draftLocal,
  payloadLocal,
  fallbackNow = new Date(),
}) {
  const local = payloadLocal || draftLocal || '';
  const instant = new Date(local);
  if (local && !Number.isNaN(instant.getTime())) {
    return {
      occurredAtUtc: instant.toISOString(),
      occurredAtLocal: local,
      timeLabel: local.slice(11, 16),
    };
  }
  return {
    occurredAtUtc: fallbackNow.toISOString(),
    occurredAtLocal: '',
    timeLabel: 'Check time',
  };
}

export function formatTimelineLog(log, state = 'confirmed') {
  const nicotine = log.total_nicotine_mg === null || log.total_nicotine_mg === undefined
    ? 'Strength unknown'
    : `${log.total_nicotine_mg} mg`;
  return {
    type: 'log',
    key: log.id === null || log.id === undefined
      ? `pending:${log.client_event_id}`
      : `log:${log.id}`,
    id: log.id ?? null,
    clientEventId: log.client_event_id,
    state,
    occurredAtUtc: log.occurred_at_utc,
    occurredAtLocal: log.occurred_at_local,
    timeLabel: log.time_label || log.occurred_at_local.slice(11, 16),
    label: state === 'pending' ? 'Syncing' : 'Nicotine logged',
    product: log.product_brand || 'Product not recorded',
    detail: `${quantityLabel(log.quantity)} · ${nicotine}`,
  };
}

const CRAVING_OUTCOME_LABELS = {
  resisted: 'Resisted',
  used_nicotine: 'Used nicotine',
  used_alternative: 'Used an alternative',
};

export function formatTimelineCraving(craving, state = 'confirmed') {
  const resolved = Boolean(CRAVING_OUTCOME_LABELS[craving.outcome]);
  return {
    type: 'craving',
    key: craving.id === null || craving.id === undefined
      ? `pending-craving:${craving.client_event_id}`
      : `craving:${craving.id}`,
    id: craving.id ?? null,
    clientEventId: craving.client_event_id,
    state,
    occurredAtUtc: craving.occurred_at_utc,
    occurredAtLocal: craving.occurred_at_local,
    timeLabel: craving.time_label || craving.occurred_at_local.slice(11, 16),
    label: state === 'pending'
      ? 'Saving craving'
      : resolved ? 'Craving updated' : 'Craving recorded',
    product: null,
    detail: `Intensity ${craving.intensity} · ${
      resolved ? CRAVING_OUTCOME_LABELS[craving.outcome] : 'Outcome not recorded'
    }`,
    linkedLogId: craving.linked_log_id ?? null,
  };
}

export function formatTimelineCheckIn(item) {
  const checkIn = item.data || item;
  const mood = checkIn.mood === null || checkIn.mood === undefined
    ? 'Mood not recorded'
    : `Mood ${checkIn.mood} of 5`;
  const confidence = checkIn.confidence === null || checkIn.confidence === undefined
    ? 'Confidence not recorded'
    : `Confidence ${checkIn.confidence} of 5`;
  return {
    type: 'check_in',
    key: `check_in:${checkIn.id}`,
    id: checkIn.id,
    clientEventId: null,
    state: 'confirmed',
    occurredAtUtc: item.occurred_at_utc,
    occurredAtLocal: item.occurred_at_local,
    timeLabel: item.time_label || item.occurred_at_local.slice(11, 16),
    label: item.label || 'Daily check-in',
    product: null,
    detail: `${mood} · ${confidence}`,
  };
}

function matchesTimelineItem(existing, next) {
  if (existing.type !== next.type) return false;
  if (next.clientEventId && existing.clientEventId === next.clientEventId) return true;
  return next.id !== null && next.id !== undefined && existing.id === next.id;
}

export function upsertTimelineItems(items, next) {
  const withoutMatch = items.filter((item) => !matchesTimelineItem(item, next));
  const nextInstant = new Date(next.occurredAtUtc).getTime();
  const insertionIndex = withoutMatch.findIndex(
    (item) => new Date(item.occurredAtUtc).getTime() > nextInstant,
  );
  if (insertionIndex === -1) return [...withoutMatch, next];
  return [
    ...withoutMatch.slice(0, insertionIndex),
    next,
    ...withoutMatch.slice(insertionIndex),
  ];
}

const STATUS_LABELS = {
  neutral: 'Tracking',
  unknown: 'Nicotine unknown',
  on_track: 'On track',
  approaching: 'Approaching plan',
  met: 'Plan met',
  exceeded: 'Plan exceeded',
};

export function todayStatusPatch(today) {
  const checkInVisible = Boolean(today.check_in || today.check_in_eligible);
  const noRecovery = {
    visible: false,
    pouch: null,
    nicotine: null,
    reviewRecommended: false,
  };
  if (!today.plan) {
    return {
      status: today.status,
      statusLabel: 'No active plan',
      pouchMeasure: null,
      remaining: null,
      nicotineMeasure: null,
      meter: null,
      checkInVisible,
      recovery: noRecovery,
    };
  }
  const neutralNicotine = today.actuals.nicotine_mg === null
    ? `Unknown — ${today.actuals.known_nicotine_mg} mg known subtotal is partial`
    : `${today.actuals.nicotine_mg} mg tracked`;
  if (today.plan.status === 'paused') {
    return {
      status: 'neutral',
      statusLabel: 'Plan paused',
      pouchMeasure: null,
      remaining: null,
      nicotineMeasure: null,
      neutralPouches: `${today.actuals.pouches} ${today.actuals.pouches === 1 ? 'pouch' : 'pouches'} logged`,
      neutralNicotine,
      meter: null,
      checkInVisible,
      recovery: noRecovery,
    };
  }
  if (
    today.plan.mode === 'observe'
    || today.plan.target_pouches === null
    || today.plan.nicotine_ceiling_mg === null
  ) {
    return {
      status: 'neutral',
      statusLabel: 'Tracking',
      pouchMeasure: null,
      remaining: null,
      nicotineMeasure: null,
      neutralPouches: `${today.actuals.pouches} ${today.actuals.pouches === 1 ? 'pouch' : 'pouches'} logged`,
      neutralNicotine,
      meter: null,
      checkInVisible,
      recovery: noRecovery,
    };
  }
  const actualPouches = today.actuals.pouches;
  const targetPouches = today.plan.target_pouches;
  const remainingPouches = today.remaining.pouches;
  const nicotineMeasure = today.actuals.nicotine_mg === null
    ? `Unknown — ${today.actuals.known_nicotine_mg} mg known subtotal is partial`
    : `${today.actuals.nicotine_mg} of ${today.plan.nicotine_ceiling_mg} mg`;
  const pouchRecovery = today.pouch_status === 'exceeded'
    ? `Pouch guardrail: ${actualPouches} pouches logged; target ${targetPouches}.`
    : null;
  let nicotineRecovery = null;
  if (today.nicotine_state === 'exceeded') {
    const actualNicotine = today.actuals.nicotine_mg === null
      ? `at least ${today.actuals.known_nicotine_mg}`
      : today.actuals.nicotine_mg;
    nicotineRecovery = `Nicotine guardrail: ${actualNicotine} mg logged; target ${today.plan.nicotine_ceiling_mg} mg.`;
  }
  return {
    status: today.status,
    statusLabel: STATUS_LABELS[today.status] || 'Tracking',
    pouchMeasure: `${actualPouches} of ${targetPouches} pouches`,
    remaining: `${remainingPouches} ${remainingPouches === 1 ? 'pouch' : 'pouches'} remaining`,
    nicotineMeasure,
    meter: targetPouches > 0 ? { value: actualPouches, max: targetPouches } : null,
    checkInVisible,
    recovery: {
      visible: today.status === 'exceeded',
      pouch: pouchRecovery,
      nicotine: nicotineRecovery,
      reviewRecommended: Boolean(today.review_recommended),
    },
  };
}

function itemInstant(element) {
  const value = element.dataset.occurredAtUtc
    || element.querySelector('time')?.dataset.occurredAtUtc;
  return new Date(value).getTime();
}

function matchesElement(element, viewModel) {
  if (element.dataset.timelineType !== viewModel.type) return false;
  if (
    viewModel.clientEventId
    && element.dataset.clientEventId === viewModel.clientEventId
  ) return true;
  return viewModel.id !== null
    && viewModel.id !== undefined
    && element.dataset.timelineId === String(viewModel.id);
}

export function createTimelineDomAdapter(root) {
  const section = root.querySelector('[data-today-timeline-section]');
  if (!section) return null;
  const documentRef = section.ownerDocument;

  function ensureList() {
    let list = section.querySelector('[data-today-timeline]');
    if (list) return list;
    section.querySelector('[data-today-empty]')?.remove();
    list = documentRef.createElement('ol');
    list.className = 'today-timeline__list';
    list.dataset.todayTimeline = '';
    section.append(list);
    return list;
  }

  function restoreEmptyState() {
    const list = section.querySelector('[data-today-timeline]');
    if (!list || list.children.length > 0) return;
    list.remove();
    const empty = documentRef.createElement('div');
    empty.className = 'today-timeline__empty';
    empty.dataset.todayEmpty = 'logs';
    const heading = documentRef.createElement('h3');
    heading.textContent = 'Nothing logged yet';
    const copy = documentRef.createElement('p');
    copy.textContent = 'Your first log will make timing, pouch totals, and nicotine exposure visible here.';
    const link = documentRef.createElement('a');
    link.className = 'text-link';
    link.href = section.dataset.detailedLogUrl;
    link.textContent = 'Log your first nicotine use';
    empty.append(heading, copy, link);
    section.append(empty);
  }

  function createElement(viewModel) {
    const item = documentRef.createElement('li');
    item.className = `today-timeline__item today-timeline__item--${viewModel.type} today-timeline__item--${viewModel.state}`;
    item.dataset.timelineType = viewModel.type;
    item.dataset.timelineState = viewModel.state;
    item.dataset.occurredAtUtc = viewModel.occurredAtUtc;
    if (viewModel.id !== null && viewModel.id !== undefined) {
      item.dataset.timelineId = String(viewModel.id);
    }
    if (viewModel.clientEventId) item.dataset.clientEventId = viewModel.clientEventId;
    if (viewModel.type === 'craving' && viewModel.linkedLogId !== null) {
      item.dataset.linkedLogId = String(viewModel.linkedLogId);
    }

    const time = documentRef.createElement('time');
    time.dateTime = viewModel.occurredAtLocal;
    time.dataset.occurredAtUtc = viewModel.occurredAtUtc;
    time.textContent = viewModel.timeLabel;
    const marker = documentRef.createElement('span');
    marker.className = 'today-timeline__marker';
    marker.setAttribute('aria-hidden', 'true');
    const copy = documentRef.createElement('span');
    copy.className = 'today-timeline__copy';
    const label = documentRef.createElement('strong');
    label.textContent = viewModel.label;
    const detail = documentRef.createElement('small');
    detail.textContent = viewModel.type === 'log'
      ? `${viewModel.product} · ${viewModel.detail}`
      : viewModel.detail;
    copy.append(label, detail);
    item.append(time, marker, copy);
    return item;
  }

  function upsert(viewModel) {
    const list = ensureList();
    for (const existing of [...list.children]) {
      if (matchesElement(existing, viewModel)) existing.remove();
    }
    const item = createElement(viewModel);
    const next = [...list.children].find(
      (existing) => itemInstant(existing) > new Date(viewModel.occurredAtUtc).getTime(),
    );
    if (next) list.insertBefore(item, next);
    else list.append(item);
    return item;
  }

  function insertPending(draft, payload) {
    const strength = Number.parseFloat(draft.nicotineMg);
    const total = Number.isFinite(strength)
      ? (strength * Number(draft.quantity)).toFixed(2)
      : null;
    const pendingTime = resolvePendingTimelineTime({
      draftLocal: draft.occurredAtLocal,
      payloadLocal: payload?.occurred_at_local,
    });
    return upsert(formatTimelineLog({
      id: null,
      client_event_id: draft.clientEventId,
      occurred_at_utc: pendingTime.occurredAtUtc,
      occurred_at_local: pendingTime.occurredAtLocal,
      time_label: pendingTime.timeLabel,
      product_brand: draft.brand,
      quantity: Number(draft.quantity),
      total_nicotine_mg: total,
    }, 'pending'));
  }

  function insertPendingCraving(state, payload) {
    const local = payload?.occurred_at_local || state.occurredAtLocal;
    const instant = new Date(local);
    return upsert(formatTimelineCraving({
      id: null,
      client_event_id: state.clientEventId,
      occurred_at_utc: Number.isNaN(instant.getTime())
        ? new Date().toISOString()
        : instant.toISOString(),
      occurred_at_local: local,
      intensity: Number(state.intensity),
      outcome: null,
      linked_log_id: null,
    }, 'pending'));
  }

  function insertQueued(record) {
    const pendingTime = resolvePendingTimelineTime({
      payloadLocal: record.occurred_at_local,
    });
    return upsert({
      key: `pending:${record.client_event_id}`,
      id: null,
      clientEventId: record.client_event_id,
      state: 'queued',
      occurredAtUtc: pendingTime.occurredAtUtc,
      occurredAtLocal: pendingTime.occurredAtLocal,
      timeLabel: pendingTime.timeLabel,
      label: 'Waiting for connection',
      product: 'Saved pouch',
      detail: quantityLabel(Number(record.quantity)),
    });
  }

  function upsertCanonical(log) {
    return upsert(formatTimelineLog(log));
  }

  function upsertCraving(craving) {
    return upsert(formatTimelineCraving(craving));
  }

  function upsertCheckIn(item) {
    return upsert(formatTimelineCheckIn(item));
  }

  function findLog(identity) {
    return [...section.querySelectorAll('[data-timeline-type="log"]')].find(
      (element) => matchesElement(element, {
        type: 'log',
        id: identity.id ?? null,
        clientEventId: identity.client_event_id || identity.clientEventId,
      }),
    );
  }

  function findCraving(identity) {
    return [...section.querySelectorAll('[data-timeline-type="craving"]')].find(
      (element) => matchesElement(element, {
        type: 'craving',
        id: identity.id ?? null,
        clientEventId: identity.client_event_id || identity.clientEventId,
      }),
    );
  }

  function markFailed(clientEventId) {
    const element = findLog({ clientEventId });
    if (!element) return;
    element.dataset.timelineState = 'failed';
    element.classList.remove('today-timeline__item--pending');
    element.classList.add('today-timeline__item--failed');
    const label = element.querySelector('.today-timeline__copy strong');
    if (label) label.textContent = 'Not synced';
  }

  function markQueued(clientEventId) {
    const element = findLog({ clientEventId });
    if (!element) return;
    element.dataset.timelineState = 'queued';
    element.classList.remove('today-timeline__item--pending', 'today-timeline__item--failed');
    element.classList.add('today-timeline__item--queued');
    const label = element.querySelector('.today-timeline__copy strong');
    if (label) label.textContent = 'Waiting for connection';
  }

  function markCravingFailed(clientEventId) {
    const element = findCraving({ clientEventId });
    if (!element) return;
    element.dataset.timelineState = 'failed';
    element.classList.remove('today-timeline__item--pending');
    element.classList.add('today-timeline__item--failed');
    const label = element.querySelector('.today-timeline__copy strong');
    if (label) label.textContent = 'Not saved yet';
  }

  function markAttention(clientEventId) {
    const element = findLog({ clientEventId });
    if (!element) return;
    element.dataset.timelineState = 'attention';
    element.classList.remove('today-timeline__item--pending', 'today-timeline__item--queued');
    element.classList.add('today-timeline__item--attention');
    const copy = element.querySelector('.today-timeline__copy');
    const label = copy?.querySelector('strong');
    if (label) label.textContent = 'Needs attention';
    if (!copy || copy.querySelector('[data-saved-log-actions]')) return;
    const actions = documentRef.createElement('span');
    actions.className = 'today-timeline__saved-actions';
    actions.dataset.savedLogActions = '';
    const edit = documentRef.createElement('button');
    edit.type = 'button';
    edit.className = 'text-link today-timeline__saved-action';
    edit.dataset.savedLogEdit = clientEventId;
    edit.textContent = 'Edit saved log';
    const discard = documentRef.createElement('button');
    discard.type = 'button';
    discard.className = 'text-link today-timeline__saved-action';
    discard.dataset.savedLogDiscard = clientEventId;
    discard.textContent = 'Discard saved log';
    actions.append(edit, discard);
    copy.append(actions);
  }

  function removePending(clientEventId) {
    findLog({ clientEventId })?.remove();
    restoreEmptyState();
  }

  function removePendingCraving(clientEventId) {
    findCraving({ clientEventId })?.remove();
    restoreEmptyState();
  }

  function reconcileTimeline(items) {
    for (const item of items || []) {
      if (item?.type === 'log' && item.data) upsertCanonical(item.data);
      if (item?.type === 'craving' && item.data) upsertCraving(item.data);
      if (item?.type === 'check_in' && item.data) upsertCheckIn(item);
    }
  }

  function removeCanonical(log) {
    findLog(log)?.remove();
    restoreEmptyState();
    return { log };
  }

  function restore(snapshot) {
    if (snapshot?.log) upsertCanonical(snapshot.log);
  }

  function reconcileToday(today) {
    reconcileTimeline(today.timeline || []);
    const patch = todayStatusPatch(today);
    const status = root.querySelector('.today-status');
    if (status) status.dataset.todayStatus = patch.status;
    const label = root.querySelector('[data-today-status-label]');
    if (label && patch.statusLabel) label.textContent = patch.statusLabel;
    const pouchMeasure = root.querySelector('[data-today-pouch-measure] strong');
    if (pouchMeasure && patch.pouchMeasure) pouchMeasure.textContent = patch.pouchMeasure;
    const remaining = root.querySelector('[data-today-remaining]');
    if (remaining && patch.remaining) remaining.textContent = patch.remaining;
    const nicotine = root.querySelector('[data-today-nicotine]');
    if (nicotine && patch.nicotineMeasure) nicotine.textContent = patch.nicotineMeasure;
    const neutralPouches = root.querySelector('[data-today-neutral-pouches]');
    if (neutralPouches && patch.neutralPouches) {
      neutralPouches.textContent = patch.neutralPouches;
    }
    const neutralNicotine = root.querySelector('[data-today-neutral-nicotine]');
    if (neutralNicotine && patch.neutralNicotine) {
      neutralNicotine.textContent = patch.neutralNicotine;
    }
    const meter = root.querySelector('[data-today-meter]');
    if (meter && patch.meter) {
      meter.max = patch.meter.max;
      meter.value = patch.meter.value;
      meter.textContent = `${patch.meter.value} of ${patch.meter.max}`;
    }
    const checkIn = root.querySelector('[data-check-in-root]');
    if (checkIn) checkIn.hidden = !patch.checkInVisible;
    const recovery = root.querySelector('[data-plan-recovery]');
    if (recovery) {
      recovery.hidden = !patch.recovery.visible;
      const pouch = recovery.querySelector('[data-plan-recovery-pouch]');
      if (pouch) {
        pouch.hidden = patch.recovery.pouch === null;
        if (patch.recovery.pouch !== null) pouch.textContent = patch.recovery.pouch;
      }
      const nicotineRecovery = recovery.querySelector('[data-plan-recovery-nicotine]');
      if (nicotineRecovery) {
        nicotineRecovery.hidden = patch.recovery.nicotine === null;
        if (patch.recovery.nicotine !== null) {
          nicotineRecovery.textContent = patch.recovery.nicotine;
        }
      }
    }
    const review = root.querySelector('[data-review-recommended]');
    if (review) review.hidden = !patch.recovery.reviewRecommended;
    const EventConstructor = documentRef.defaultView?.CustomEvent;
    if (typeof root.dispatchEvent === 'function' && typeof EventConstructor === 'function') {
      root.dispatchEvent(new EventConstructor(TODAY_CANONICAL_CHECK_IN_EVENT, {
        detail: {
          local_date: today.local_date,
          check_in: today.check_in ?? null,
          check_in_eligible: Boolean(today.check_in_eligible),
          generated_at: today.generated_at ?? null,
        },
      }));
    }
  }

  return {
    insertPending,
    insertPendingCraving,
    insertQueued,
    upsertCanonical,
    upsertCraving,
    upsertCheckIn,
    markFailed,
    markCravingFailed,
    markQueued,
    markAttention,
    removePending,
    removePendingCraving,
    removeCanonical,
    restore,
    reconcileToday,
    reconcileTimeline,
  };
}
