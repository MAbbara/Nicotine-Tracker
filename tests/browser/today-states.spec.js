const { test, expect } = require('@playwright/test');


function projectSuffix(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}


async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


function watchForProblems(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  return errors;
}


test('incomplete check-in cues once and reduced motion keeps the action static', async ({ page }, testInfo) => {
  const suffix = projectSuffix(testInfo);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page, `today-checkin-empty-${suffix}@example.com`);
  const action = page.locator('[data-check-in-action]');
  await expect(action).toBeVisible();
  const restingBox = await action.boundingBox();

  await action.scrollIntoViewIfNeeded();
  await expect(action).toHaveAttribute('data-attention-cue', 'active');
  const activeMotion = await action.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return {
      duration: style.animationDuration,
      iterations: style.animationIterationCount,
      pointerEvents: style.pointerEvents,
      position: style.position,
    };
  });
  expect(Number.parseFloat(activeMotion.duration)).toBeLessThanOrEqual(0.42);
  expect(activeMotion.iterations).toBe('1');
  expect(activeMotion.pointerEvents).toBe('none');
  expect(activeMotion.position).toBe('absolute');
  await expect(action).not.toHaveAttribute('data-attention-cue', 'active', { timeout: 700 });
  const settledBox = await action.boundingBox();
  expect(settledBox.width).toBe(restingBox.width);
  expect(settledBox.height).toBe(restingBox.height);

  await action.click();
  await expect(page.locator('[data-check-in-form]')).toBeVisible();
  await action.evaluate((element) => {
    const observation = { activations: 0 };
    observation.observer = new MutationObserver((records) => {
      observation.activations += records.filter(
        (record) => record.oldValue !== 'active',
      ).length;
    });
    observation.observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-attention-cue'],
      attributeOldValue: true,
    });
    window.__checkInRepeatCueObservation = observation;
  });
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(action).toBeVisible();
  await page.waitForTimeout(700);
  const repeatCueActivations = await page.evaluate(() => {
    const observation = window.__checkInRepeatCueObservation;
    observation.observer.disconnect();
    delete window.__checkInRepeatCueObservation;
    return observation.activations;
  });
  expect(repeatCueActivations).toBe(0);
  await expect(action).not.toHaveAttribute('data-attention-cue', 'active');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(action).toBeVisible();
  await action.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await expect(action).not.toHaveAttribute('data-attention-cue', 'active');
  await expect(action).toBeEnabled();
  await action.focus();
  await expect(action).toBeFocused();
});


test('optional empty reflection saves once, reconciles one row, and reopens canonical values', async ({ page }, testInfo) => {
  const requests = [];
  await page.route('**/api/check-ins', async (route) => {
    requests.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.continue();
  });
  const errors = watchForProblems(page);
  await login(page, `today-checkin-empty-${projectSuffix(testInfo)}@example.com`);

  await page.getByRole('button', { name: 'Take a short check-in' }).click();
  const form = page.locator('[data-check-in-form]');
  await expect(form).toBeVisible();
  await expect(form.getByRole('group', { name: 'Mood' })).toBeVisible();
  await expect(form.getByRole('group', { name: 'Confidence' })).toBeVisible();
  await expect(form.getByLabel('What helped or made today harder?')).toHaveAttribute('maxlength', '2000');
  await expect(form.getByLabel('Anything about the setting worth remembering?')).toHaveAttribute('maxlength', '2000');

  await form.getByLabel('What helped or made today harder?').fill('Unsaved and private');
  await form.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('[data-check-in-offer]')).toBeVisible();
  await page.getByRole('button', { name: 'Take a short check-in' }).click();
  await expect(form.getByLabel('What helped or made today harder?')).toHaveValue('');

  await form.evaluate((element) => {
    element.requestSubmit();
    element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-check-in-summary]')).toBeVisible();
  expect(requests).toEqual([{
    mood: null,
    confidence: null,
    reflection: null,
    context: null,
  }]);
  await expect(page.locator('[data-timeline-type="check_in"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Edit reflection' }).click();
  await form.getByRole('radio', { name: '3 — Mixed' }).check();
  await form.getByRole('radio', { name: '4 — High' }).check();
  await form.getByLabel('What helped or made today harder?').fill('  A slower afternoon helped.  ');
  await form.getByLabel('Anything about the setting worth remembering?').fill('  Outside  ');
  await form.getByRole('button', { name: 'Update reflection' }).click();
  await expect(page.locator('[data-check-in-summary]')).toContainText('Mood 3 of 5');
  await expect(page.locator('[data-check-in-summary]')).toContainText('Confidence 4 of 5');
  await expect(page.locator('[data-check-in-summary]')).toContainText('A slower afternoon helped.');
  await expect(page.locator('[data-timeline-type="check_in"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Edit reflection' }).click();
  await expect(form.getByRole('radio', { name: '3 — Mixed' })).toBeChecked();
  await expect(form.getByRole('radio', { name: '4 — High' })).toBeChecked();
  await expect(form.getByLabel('What helped or made today harder?'))
    .toHaveValue('A slower afternoon helped.');
  expect(requests).toHaveLength(2);
  expect(errors).toEqual([]);
});


test('saved reflection edit starts canonical and cancel discards a stale draft', async ({ page }, testInfo) => {
  await login(page, `today-checkin-saved-${projectSuffix(testInfo)}@example.com`);
  const summary = page.locator('[data-check-in-summary]');
  await expect(summary).toContainText('Mood 3 of 5');
  await expect(summary).toContainText('Confidence 4 of 5');
  await expect(summary).toContainText('The short walk helped.');
  await expect(summary).toContainText('After lunch');

  await page.getByRole('button', { name: 'Edit reflection' }).click();
  const reflection = page.getByLabel('What helped or made today harder?');
  await expect(reflection).toHaveValue('The short walk helped.');
  await page.getByRole('button', { name: 'Clear mood' }).click();
  await expect(page.locator('[name="mood"]:checked')).toHaveCount(0);
  await reflection.fill('Unsaved draft');
  await page.getByRole('button', { name: 'Keep saved reflection' }).click();
  await page.getByRole('button', { name: 'Edit reflection' }).click();
  await expect(reflection).toHaveValue('The short walk helped.');
  await expect(page.getByRole('radio', { name: '3 — Mixed' })).toBeChecked();
});


test('sanitized retry preserves the draft and Today-null success stays visibly saved', async ({ page }, testInfo) => {
  const suffix = projectSuffix(testInfo);
  const privateText = 'private reflection must stay server only';
  let attempts = 0;
  const payloads = [];
  await page.route('**/api/check-ins', async (route) => {
    attempts += 1;
    payloads.push(route.request().postDataJSON());
    if (attempts === 1) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'internal_error',
            message: '<script>private server detail</script>',
            field_errors: {},
            retryable: true,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        check_in: {
          id: 900,
          local_date: '2026-07-30',
          mood: 3,
          confidence: 4,
          reflection: privateText,
          context: 'After lunch',
        },
        today: null,
        warnings: [{ code: 'today_refresh_unavailable', retryable: true }],
      }),
    });
  });
  await login(page, `today-checkin-retry-${suffix}@example.com`);
  await page.getByRole('button', { name: 'Edit reflection' }).click();
  await page.getByLabel('What helped or made today harder?').fill(privateText);
  await page.getByRole('button', { name: 'Update reflection' }).click();

  const recovery = page.locator('[data-check-in-request-error]');
  await expect(recovery).toContainText('We could not save your reflection. Try again.');
  await expect(recovery).not.toContainText('script');
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.locator('[data-check-in-summary]')).toContainText(privateText);
  await expect(page.getByText('Your reflection is saved. Today can be refreshed later.')).toBeVisible();
  expect(payloads[1]).toEqual(payloads[0]);

  const persisted = await page.evaluate(async (needle) => {
    const storageValues = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    const databases = await indexedDB.databases();
    let records = [];
    if (databases.some((database) => database.name === 'nicotine-tracker')) {
      records = await new Promise((resolve, reject) => {
        const open = indexedDB.open('nicotine-tracker');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('pending_events')) {
            database.close();
            resolve([]);
            return;
          }
          const transaction = database.transaction('pending_events', 'readonly');
          const all = transaction.objectStore('pending_events').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            database.close();
            resolve(all.result);
          };
        };
      });
    }
    return {
      storage: storageValues.some((value) => String(value).includes(needle)),
      queue: JSON.stringify(records).includes(needle),
    };
  }, privateText);
  expect(persisted).toEqual({ storage: false, queue: false });
});


test('paused plan is explicit neutral tracking with honest totals and Journey agency', async ({ page }) => {
  await login(page, 'today-paused@example.com');
  const status = page.locator('[data-today-status]');
  await expect(status.getByRole('heading', { name: 'Plan paused', level: 2 })).toBeVisible();
  await expect(status).toContainText('3 pouches logged');
  await expect(status).toContainText('18.00 mg tracked');
  await expect(status).not.toContainText(/remaining/i);
  await expect(status).not.toContainText(/steady pace/i);
  await expect(status).not.toContainText(/plan day \d+/i);
  await expect(status.getByRole('link', { name: 'Review or resume in Journey' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No active plan' })).toHaveCount(0);
});


test('reaching the target through Quick Log immediately offers the canonical check-in', async ({ page }, testInfo) => {
  await login(page, `today-checkin-transition-${projectSuffix(testInfo)}@example.com`);
  await expect(page.getByRole('button', { name: 'Take a short check-in' })).toHaveCount(0);
  const initialLogCount = await page.locator('[data-timeline-type="log"]').count();

  await page.locator('#today-log-action').click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await dialog.getByRole('button', { name: 'Log one pouch' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-timeline-type="log"]')).toHaveCount(initialLogCount + 1);
  await expect(page.getByRole('heading', { name: 'Plan met', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take a short check-in' })).toBeVisible();
});


test('Quick Log crossing both guardrails immediately renders accurate recovery', async ({ page }, testInfo) => {
  await login(page, `today-recovery-transition-${projectSuffix(testInfo)}@example.com`);
  await expect(page.locator('[data-plan-recovery]')).toBeHidden();

  await page.locator('#today-log-action').click();
  const dialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await dialog.getByText('Change details', { exact: true }).click();
  await dialog.getByLabel('Quantity').fill('2');
  await dialog.getByRole('button', { name: 'Log 2 pouches' }).click();

  await expect(dialog).toBeHidden();
  const recovery = page.locator('[data-plan-recovery]');
  await expect(page.getByRole('heading', { name: 'Plan exceeded', level: 2 })).toBeVisible();
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('Pouch guardrail: 3 pouches logged; target 2.');
  await expect(recovery).toContainText('Nicotine guardrail: 18.00 mg logged; target 12.00 mg.');
  await expect(page.getByRole('button', { name: 'Take a short check-in' })).toBeVisible();
});


test('canonical Today reconciliation adopts another-session save and clears it next day', async ({ page }, testInfo) => {
  await login(page, `today-checkin-reconcile-${projectSuffix(testInfo)}@example.com`);
  await expect(page.getByRole('button', { name: 'Take a short check-in' })).toBeVisible();

  const canonical = await page.evaluate(async () => {
    const response = await fetch('/api/today');
    const { today } = await response.json();
    const saved = {
      id: 777,
      local_date: today.local_date,
      mood: 5,
      confidence: 2,
      reflection: 'Saved in another session',
      context: 'Evening',
    };
    today.check_in = saved;
    today.check_in_eligible = true;
    today.timeline = [...today.timeline, {
      type: 'check_in',
      id: saved.id,
      occurred_at_utc: today.generated_at,
      occurred_at_local: today.generated_at,
      state: 'completed',
      label: 'Daily check-in',
      data: saved,
    }];
    const module = await import('/static/js/today/timeline.js');
    const adapter = module.createTimelineDomAdapter(document.querySelector('[data-today-root]'));
    adapter.reconcileToday(today);
    adapter.reconcileToday(today);
    return saved;
  });

  await expect(page.locator('[data-check-in-summary]')).toContainText('Saved in another session');
  await expect(page.locator('[data-timeline-type="check_in"][data-timeline-id="777"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit reflection' }).click();
  await expect(page.getByRole('radio', { name: '5 — Good' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '2 — Low' })).toBeChecked();
  await expect(page.getByLabel('What helped or made today harder?'))
    .toHaveValue(canonical.reflection);
  await page.getByRole('button', { name: 'Keep saved reflection' }).click();

  await page.evaluate(async () => {
    const response = await fetch('/api/today');
    const { today } = await response.json();
    today.local_date = '2099-01-02';
    today.check_in = null;
    today.check_in_eligible = true;
    const module = await import('/static/js/today/timeline.js');
    module.createTimelineDomAdapter(document.querySelector('[data-today-root]'))
      .reconcileToday(today);
  });
  await expect(page.getByRole('button', { name: 'Take a short check-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Take a short check-in' }).click();
  await expect(page.locator('[name="mood"]:checked')).toHaveCount(0);
  await expect(page.getByLabel('What helped or made today harder?')).toHaveValue('');
});


test('both exceeded guardrails show accurate recovery, review suggestion, and no plan mutation', async ({ page }) => {
  await login(page, 'today-exceeded@example.com');
  const before = await page.evaluate(async () => (await fetch('/api/today')).json());
  const recovery = page.locator('[data-plan-recovery]');
  await expect(page.getByRole('heading', { name: 'Plan exceeded', level: 2 })).toBeVisible();
  await expect(recovery).toContainText('Pouch guardrail: 3 pouches logged; target 2.');
  await expect(recovery).toContainText('Nicotine guardrail: 18.00 mg logged; target 10.00 mg.');
  await expect(recovery).toContainText('One day does not erase your progress.');
  await expect(recovery.getByRole('link', { name: 'Keep logging' })).toBeVisible();
  await expect(recovery.getByRole('link', { name: 'Reflect on today' })).toBeVisible();
  await expect(recovery.getByRole('link', { name: 'Review the plan in Journey' })).toBeVisible();
  await expect(recovery.getByRole('link', { name: 'Pause or revise in Journey' })).toBeVisible();
  await expect(page.locator('[data-review-recommended]')).toContainText(
    'Recent days suggest the plan may deserve a review.',
  );
  const after = await page.evaluate(async () => (await fetch('/api/today')).json());
  expect(after.today.plan).toEqual(before.today.plan);
  await expect(page.locator('body')).not.toContainText(
    /failed|failure|broken streak|cheated|blew it|relapse/i,
  );
});


test('check-in remains usable at 320px, dark theme, 200% text, keyboard focus, and reduced motion', async ({ page }, testInfo) => {
  const suffix = projectSuffix(testInfo);
  await page.addInitScript(() => localStorage.setItem('nicotine-tracker-theme', 'dark'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  const errors = watchForProblems(page);
  await login(page, `today-checkin-responsive-${suffix}@example.com`);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const edit = page.getByRole('button', { name: 'Edit reflection' });
  await edit.focus();
  const focus = await edit.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    };
  });
  expect(focus.outline).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(44);
  expect(focus.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Enter');
  const form = page.locator('[data-check-in-form]');
  await expect(form).toBeVisible();

  const overflow = await page.evaluate(() => ({
    pageClient: document.documentElement.clientWidth,
    pageScroll: document.documentElement.scrollWidth,
    formClient: document.querySelector('[data-check-in-form]').clientWidth,
    formScroll: document.querySelector('[data-check-in-form]').scrollWidth,
  }));
  expect(overflow.pageScroll).toBeLessThanOrEqual(overflow.pageClient + 1);
  expect(overflow.formScroll).toBeLessThanOrEqual(overflow.formClient + 1);
  for (const control of [
    form.getByRole('radio', { name: '1 — Very difficult' }).locator('..'),
    form.getByRole('button', { name: 'Update reflection' }),
    form.getByRole('button', { name: 'Keep saved reflection' }),
  ]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});
