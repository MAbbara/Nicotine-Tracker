const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadProgress() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'journey', 'progress.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

class FakeElement {
  constructor({ dataset = {}, attributes = {}, root = null } = {}) {
    this.dataset = { ...dataset };
    this.attributes = new Map(Object.entries(attributes));
    this.root = root;
    this.focused = false;
    this.listeners = new Map();
    this.attributeWrites = [];
  }

  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    options.signal?.addEventListener('abort', () => {
      this.listeners.get(type)?.delete(listener);
    }, { once: true });
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    this.attributeWrites.push([name, normalized]);
  }

  dispatch(type, overrides = {}) {
    if (type === 'focus') {
      this.root.activeElement = this;
      this.focused = true;
    }
    if (type === 'focusout') {
      if (this.root.activeElement === this) this.root.activeElement = null;
      this.focused = false;
    }
    const event = {
      type,
      target: this,
      currentTarget: this,
      key: undefined,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }

  focus() {
    const previous = this.root.activeElement;
    if (previous === this) return;
    if (previous) previous.dispatch('focusout', { relatedTarget: this });
    this.dispatch('focus', { relatedTarget: previous });
  }

  blur() {
    this.dispatch('focusout', { relatedTarget: null });
  }
}

class FakeDetail extends FakeElement {
  constructor(root) {
    super({ root });
    this._textContent = '';
    this.writes = 0;
  }

  get textContent() { return this._textContent; }

  set textContent(value) {
    this._textContent = value;
    this.writes += 1;
  }
}

function journeyFixture({ detail = true, trajectory = true } = {}) {
  const root = {
    activeElement: null,
    querySelectorAll(selector) {
      return selector === '[data-journey-day]' ? this.days : [];
    },
    querySelector(selector) {
      if (selector === '[data-journey-trajectory]') return trajectory ? this.trajectory : null;
      if (selector === '[data-journey-day-detail]') return detail ? this.detail : null;
      return null;
    },
  };
  const values = [
    ['Today', '33.19 mg ceiling', 'Current ceiling'],
    ['Tomorrow', '32.62 mg ceiling', '0.57 mg lower'],
    ['Tuesday', '32.06 mg ceiling', '0.56 mg lower'],
    ['Wednesday', '31.50 mg ceiling', '0.56 mg lower'],
    ['Thursday', '30.94 mg ceiling', '0.56 mg lower'],
    ['Friday', '30.38 mg ceiling', '0.56 mg lower'],
    ['Saturday', '29.81 mg ceiling', '0.57 mg lower'],
  ];
  root.days = values.map(([dateLabel, ceilingLabel, changeLabel], index) => new FakeElement({
    root,
    dataset: { dateLabel, ceilingLabel, changeLabel },
    attributes: { 'aria-pressed': index === 0 ? 'true' : 'false' },
  }));
  root.detail = new FakeDetail(root);
  root.trajectory = new FakeElement({ root });
  return {
    root,
    detail: root.detail,
    trajectory: root.trajectory,
    days: root.days,
    today: root.days[0],
    tomorrow: root.days[1],
    tuesday: root.days[2],
    wednesday: root.days[3],
    friday: root.days[5],
    saturday: root.days[6],
  };
}

function selectedDays(fixture) {
  return fixture.days.filter((day) => day.getAttribute('aria-pressed') === 'true');
}

test('focus and hover preview without changing the committed day', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const fixture = journeyFixture();
  const controller = createJourneyProgressController({ root: fixture.root });
  controller.initialize();

  fixture.tuesday.dispatch('focus');
  assert.equal(fixture.detail.textContent, 'Tuesday · 32.06 mg ceiling · 0.56 mg lower');
  assert.equal(fixture.today.getAttribute('aria-pressed'), 'true');
  assert.equal(fixture.tuesday.getAttribute('aria-pressed'), 'false');

  fixture.friday.dispatch('pointerenter');
  assert.equal(fixture.detail.textContent, 'Friday · 30.38 mg ceiling · 0.56 mg lower');
  assert.deepEqual(selectedDays(fixture), [fixture.today]);
});

test('activation owns one selected day and arrows wrap focus in both directions', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const fixture = journeyFixture();
  const controller = createJourneyProgressController({ root: fixture.root });
  controller.initialize();

  fixture.tuesday.dispatch('click');
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);
  assert.equal(fixture.detail.textContent, 'Tuesday · 32.06 mg ceiling · 0.56 mg lower');

  const right = fixture.saturday.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(right.defaultPrevented, true);
  assert.equal(fixture.today.focused, true);
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);

  const left = fixture.today.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(left.defaultPrevented, true);
  assert.equal(fixture.saturday.focused, true);
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);

  fixture.tuesday.focus();
  fixture.tuesday.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(fixture.wednesday.focused, true);
  fixture.wednesday.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(fixture.tuesday.focused, true);
});

test('native Enter and Space clicks activate exactly once', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const fixture = journeyFixture();
  const controller = createJourneyProgressController({ root: fixture.root });
  controller.initialize();

  fixture.detail.writes = 0;
  const enter = fixture.tuesday.dispatch('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, false);
  assert.deepEqual(selectedDays(fixture), [fixture.today]);
  assert.equal(fixture.detail.writes, 0);
  fixture.tuesday.dispatch('click');
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);
  assert.equal(fixture.detail.writes, 1);

  fixture.detail.writes = 0;
  const space = fixture.friday.dispatch('keydown', { key: ' ' });
  assert.equal(space.defaultPrevented, false);
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);
  assert.equal(fixture.detail.writes, 0);
  fixture.friday.dispatch('click');
  assert.deepEqual(selectedDays(fixture), [fixture.friday]);
  assert.equal(fixture.detail.writes, 1);
});

test('pointer leave and focusout restore only after overlapping preview ends', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const fixture = journeyFixture();
  const controller = createJourneyProgressController({ root: fixture.root });
  controller.initialize();

  fixture.tuesday.dispatch('pointerenter');
  fixture.tuesday.dispatch('focus');
  fixture.tuesday.dispatch('pointerleave');
  assert.equal(fixture.detail.textContent, 'Tuesday · 32.06 mg ceiling · 0.56 mg lower');
  fixture.tuesday.dispatch('focusout');
  assert.equal(fixture.detail.textContent, 'Today · 33.19 mg ceiling · Current ceiling');

  fixture.friday.dispatch('pointerenter');
  fixture.friday.dispatch('focus');
  fixture.friday.dispatch('focusout');
  assert.equal(fixture.detail.textContent, 'Friday · 30.38 mg ceiling · 0.56 mg lower');
  fixture.friday.dispatch('pointerleave');
  assert.equal(fixture.detail.textContent, 'Today · 33.19 mg ceiling · Current ceiling');
});

test('partial markup is inert and incomplete labels remain truthful', async () => {
  const { createJourneyProgressController, bootstrapJourneyProgress } = await loadProgress();
  assert.doesNotThrow(() => {
    const controller = createJourneyProgressController({ root: null });
    controller.initialize();
    controller.cleanup();
    bootstrapJourneyProgress(null);
  });

  const fixture = journeyFixture({ detail: false });
  fixture.tuesday.dataset.changeLabel = '';
  const controller = createJourneyProgressController({ root: fixture.root });
  controller.initialize();
  assert.doesNotThrow(() => fixture.tuesday.dispatch('click'));
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);

  const incomplete = journeyFixture();
  incomplete.tuesday.dataset.changeLabel = '';
  const incompleteController = createJourneyProgressController({ root: incomplete.root });
  incompleteController.initialize();
  incomplete.tuesday.dispatch('focus');
  assert.equal(incomplete.detail.textContent, 'Tuesday · 32.06 mg ceiling');
});

test('initialize is repeat-safe, cleanup removes ownership, and reinitialize works', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const fixture = journeyFixture();
  const controller = createJourneyProgressController({ root: fixture.root });

  controller.initialize();
  controller.initialize();
  assert.equal(fixture.tuesday.listenerCount('click'), 1);
  assert.equal(fixture.tuesday.listenerCount('keydown'), 1);
  assert.equal(fixture.tuesday.listenerCount('pointerenter'), 1);

  controller.cleanup();
  assert.equal(fixture.tuesday.listenerCount('click'), 0);
  fixture.tuesday.dispatch('click');
  assert.deepEqual(selectedDays(fixture), [fixture.today]);

  controller.initialize();
  assert.equal(fixture.tuesday.listenerCount('click'), 1);
  fixture.tuesday.dispatch('click');
  assert.deepEqual(selectedDays(fixture), [fixture.tuesday]);
});

test('initialization repairs missing or duplicate committed selection', async () => {
  const { createJourneyProgressController } = await loadProgress();
  const missing = journeyFixture();
  missing.days.forEach((day) => day.setAttribute('aria-pressed', 'false'));
  const missingController = createJourneyProgressController({ root: missing.root });
  missingController.initialize();
  assert.deepEqual(selectedDays(missing), [missing.today]);

  const duplicate = journeyFixture();
  duplicate.tuesday.setAttribute('aria-pressed', 'true');
  const controller = createJourneyProgressController({ root: duplicate.root });
  controller.initialize();
  assert.deepEqual(selectedDays(duplicate), [duplicate.today]);
});

test('bootstrap is idempotent and ignores roots without a trajectory', async () => {
  const { bootstrapJourneyProgress } = await loadProgress();
  const fixture = journeyFixture();
  bootstrapJourneyProgress(fixture.root);
  bootstrapJourneyProgress(fixture.root);
  assert.equal(fixture.today.listenerCount('click'), 1);
  assert.equal(fixture.saturday.listenerCount('keydown'), 1);

  const partial = journeyFixture({ trajectory: false });
  assert.doesNotThrow(() => bootstrapJourneyProgress(partial.root));
  assert.equal(partial.today.listenerCount('click'), 0);

  const late = journeyFixture();
  const lateDays = late.days;
  late.root.days = [];
  bootstrapJourneyProgress(late.root);
  late.root.days = lateDays;
  bootstrapJourneyProgress(late.root);
  assert.equal(late.today.listenerCount('click'), 1);
});
