const { SUPPORTING_ACTION_BASELINES } = require('./supporting_action_baseline');


const STATE_SCENARIOS = Object.freeze({
  'anonymous-not-found': Object.freeze({ path: /^\/__release_missing_page__$/, identity: null, marker: 'Page not found' }),
  'bad-request': Object.freeze({ path: /^\/__test__\/error\/400$/, identity: null, marker: 'Refresh and try again' }),
  'server-error': Object.freeze({ path: /^\/__test__\/error\/500$/, identity: null, marker: 'Something went wrong on our end' }),
  profile: Object.freeze({ path: /^\/settings\/profile$/, identity: 'release-settings@example.com', marker: 'Profile' }),
  account: Object.freeze({ path: /^\/settings\/account$/, identity: 'release-settings@example.com', marker: 'Account' }),
  preferences: Object.freeze({ path: /^\/settings\/preferences$/, identity: 'release-settings@example.com', marker: 'Preferences' }),
  reminders: Object.freeze({ path: /^\/settings\/notifications$/, identity: 'release-settings@example.com', marker: 'Reminders' }),
  data: Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-settings|data-[\w-]+)@example\.com$/, marker: 'Data & privacy' }),
  statistics: Object.freeze({ path: /^\/settings\/statistics$/, identity: 'release-settings@example.com', marker: 'Statistics' }),
  logbook: Object.freeze({ path: /^\/log\/view$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: 'Logbook' }),
  'log-add': Object.freeze({ path: /^\/log\/(?:add|view)$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: /^(?:Add a log|Logbook)$/ }),
  'log-bulk': Object.freeze({ path: /^\/log\/bulk$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: 'Bulk add logs' }),
  catalog: Object.freeze({ path: /^\/catalog\/$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Your pouches' }),
  'catalog-add': Object.freeze({ path: /^\/catalog\/add$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Add a pouch' }),
  cravings: Object.freeze({ path: /^\/cravings\/cravings$/, identity: /^(?:release-inventory|cravings-page-\d+)@example\.com$/, marker: 'Craving history' }),
  goals: Object.freeze({ path: /^\/goals\/$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Goals' }),
  'goal-create': Object.freeze({ path: /^\/goals\/create$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Create a goal' }),
  dashboard: Object.freeze({ path: /^\/dashboard\/$/, identity: 'release-analytics-ready@example.com', marker: 'Dashboard' }),
  'not-found': Object.freeze({ path: /^\/__release_missing_page__$/, identity: 'release-inventory@example.com', marker: 'Page not found' }),
  'dashboard-empty': Object.freeze({ path: /^\/dashboard\/$/, identity: 'release-analytics-empty@example.com', marker: 'Dashboard' }),
  'dashboard-sparse': Object.freeze({ path: /^\/dashboard\/$/, identity: 'release-analytics-sparse@example.com', marker: 'Dashboard' }),
  'data-offline-enabled': Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-offline-enabled|data-[\w-]+)@example\.com$/, marker: 'Data & privacy' }),
  'data-offline-disabled': Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-offline-disabled|data-[\w-]+)@example\.com$/, marker: 'Data & privacy' }),
  'data-settings-action': Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-settings|data-[\w-]+)@example\.com$/, marker: 'Data & privacy' }),
  'account-destructive': Object.freeze({ path: /^\/settings\/account$/, identity: /^(?:release-destructive|account(?:-updated)?-(?:chromium|webkit)-(?:desktop|mobile))@example\.com$/, marker: 'Account' }),
  'goal-progress': Object.freeze({ path: /^\/goals\/progress$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Goal progress' }),
  'goal-edit': Object.freeze({ path: /^\/goals\/edit\/\d+$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Adjust goal' }),
  'log-edit': Object.freeze({ path: /^\/log\/edit\/\d+$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: 'Edit log' }),
  'catalog-search': Object.freeze({ path: /^\/catalog\/search$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Search pouches' }),
  'catalog-edit': Object.freeze({ path: /^\/catalog\/edit\/\d+$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Edit pouch' }),
});


function exactActionButton(page, action) {
  return page.getByRole('button', { name: action, exact: true });
}


function exactPath(path) {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}


async function firstExisting(locators) {
  for (const locator of locators) {
    if (await locator.count()) return locator;
  }
  throw new Error('catalog could not resolve an authoritative action control');
}


async function navigationControl(page, state, action, profile) {
  if (profile === 'primaryNavigation' && ['Today', 'Journey', 'Insights', 'You'].includes(action)) {
    return page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: action, exact: true });
  }
  if (action === 'Nicotine Tracker home') {
    return page.getByRole('banner').getByRole('link', { name: action, exact: true });
  }
  if (action.startsWith('Open your space for ')) {
    return page.getByRole('banner').getByRole('link', { name: action, exact: true });
  }
  if (['Profile', 'Account', 'Preferences', 'Reminders', 'Data & privacy', 'Statistics']
    .includes(action)) {
    return page.getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: action, exact: true });
  }
  const main = page.locator('#main-content');
  return firstExisting([
    main.getByRole('link', { name: action, exact: true }),
    main.getByRole('button', { name: action, exact: true }),
    page.getByRole('link', { name: action, exact: true }),
    page.getByRole('button', { name: action, exact: true }),
  ]);
}


async function navigationRequest(page, control) {
  const values = await control.evaluate((element) => {
    if (element.tagName === 'A') {
      const url = new URL(element.href, element.ownerDocument.location.href);
      return { method: 'GET', path: url.pathname, search: url.search };
    }
    const form = element.form || element.closest('form');
    if (!form) throw new Error('catalog navigation control has no link or form');
    const method = (form.method || 'GET').toUpperCase();
    const url = new URL(
      form.getAttribute('action') || element.ownerDocument.location.href,
      element.ownerDocument.location.href,
    );
    if (method === 'GET') {
      const payload = new FormData(form);
      if (element.name) payload.set(element.name, element.value);
      url.search = new URLSearchParams(payload).toString();
    }
    return { method, path: url.pathname, search: url.search };
  });
  return {
    method: values.method,
    path: exactPath(values.path),
    search: values.search,
    status: 200,
  };
}


function navigationScenario(page, state, action, profile) {
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown navigation branch: ${branch}`);
      const control = await navigationControl(page, state, action, profile);
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: await navigationRequest(page, control),
        },
      };
    },
  });
}


function skipScenario(page, action) {
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown skip branch: ${branch}`);
      return {
        control: page.getByRole('link', { name: action, exact: true }),
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          focus: { mode: 'moved', locator: page.locator('#main-content') },
        },
      };
    },
  });
}


function draftToggleScenario(page, action) {
  return Object.freeze({
    branches: Object.freeze(['toggle']),
    async resolve(branch) {
      if (branch !== 'toggle') throw new Error(`unknown draft-toggle branch: ${branch}`);
      const control = page.getByRole('checkbox', { name: action, exact: true });
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Space' },
          outcome: { kind: 'checked', locator: control, checked: !await control.isChecked() },
          focus: { mode: 'retained' },
        },
      };
    },
  });
}


function localControlScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['toggle']),
    async resolve(branch) {
      if (branch !== 'toggle') throw new Error(`unknown local-control branch: ${branch}`);
      const dialog = page.getByRole('dialog', { name: 'Add a log' });
      const trigger = page.getByRole('button', { name: 'Add log', exact: true });
      if (action === 'Add log') {
        return {
          control: trigger,
          descriptor: {
            activation: { kind: 'keyboard', key: 'Enter' },
            outcome: { kind: 'visible', locator: dialog },
            focus: {
              mode: 'moved', locator: page.locator('#addLogModal [name="log_date"]'),
            },
          },
        };
      }
      if (state === 'log-add' && ['Cancel', 'Close add log dialog'].includes(action)) {
        const control = dialog.getByRole('button', { name: action, exact: true });
        return {
          control,
          descriptor: {
            activation: { kind: 'keyboard', key: 'Enter' },
            outcome: { kind: 'hidden', locator: dialog },
            focus: { mode: 'moved', locator: trigger },
          },
        };
      }
      throw new Error(`local control is not cataloged: ${state} › ${action}`);
    },
  });
}


function disclosureScenario(page, action) {
  return Object.freeze({
    branches: Object.freeze(['close']),
    async resolve(branch) {
      if (branch !== 'close') throw new Error(`unknown disclosure branch: ${branch}`);
      const control = page.locator('summary').filter({ hasText: action });
      const details = control.locator('..');
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          outcome: { kind: 'attribute', locator: details, name: 'open', value: null },
          focus: { mode: 'retained' },
        },
      };
    },
  });
}


function rangeNavigationScenario(page, action) {
  const days = Object.freeze({ '7 days': 7, '30 days': 30, '90 days': 90, '1 year': 365 });
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown range branch: ${branch}`);
      const after = String(days[action]);
      const marker = page.locator('[data-dashboard-range-days]');
      const before = await marker.getAttribute('data-dashboard-range-days');
      return {
        control: page.getByRole('link', { name: action, exact: true }),
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: {
            method: 'GET', path: /^\/dashboard\/$/, search: `?days=${after}`, status: 200,
          },
          persistence: {
            kind: 'locator', locator: marker, property: 'attribute',
            name: 'data-dashboard-range-days', expectedBefore: before, expectedAfter: after,
          },
        },
      };
    },
  });
}


async function accountSnapshot(page) {
  const response = await page.request.get('/__test__/account-snapshot');
  if (response.status() !== 200) {
    throw new Error(`scenario account snapshot returned ${response.status()}`);
  }
  return response.json();
}


async function formRequest(control, status = 302) {
  const values = await control.evaluate((element) => {
    const form = element.form || element.closest('form');
    if (!form) throw new Error('catalog mutation control has no form');
    const exact = {};
    for (const [name, value] of new FormData(form).entries()) {
      if (name === 'csrf_token') continue;
      if (Object.hasOwn(exact, name)) {
        exact[name] = Array.isArray(exact[name]) ? [...exact[name], value] : [exact[name], value];
      } else exact[name] = value;
    }
    const url = new URL(
      form.getAttribute('action') || element.ownerDocument.location.href,
      element.ownerDocument.location.href,
    );
    return { method: (form.method || 'GET').toUpperCase(), path: url.pathname, exact };
  });
  return {
    method: values.method,
    path: exactPath(values.path),
    status,
    payload: { kind: 'form', exact: values.exact },
    dynamicFields: { csrf_token: 'non-empty' },
  };
}


function flashFeedback(page, text) {
  return {
    locator: page.locator('#flash-messages [role="status"]'),
    text,
    ownership: { kind: 'container', locator: page.locator('#flash-messages') },
  };
}


function nativeValidation(field, message) {
  return {
    locator: field,
    validationMessage: message,
    ownership: { kind: 'field' },
  };
}


async function validatedMutationPlan(page, state, action, branch) {
  if (state === 'profile' && action === 'Save profile') {
    const control = exactActionButton(page, action);
    const age = page.getByLabel('Age');
    if (branch === 'invalid') {
      await age.fill('17');
      const validation = nativeValidation(age, 'Value must be greater than or equal to 18.');
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: age }, error: validation, feedback: validation,
      } };
    }
    const snapshot = await accountSnapshot(page);
    const targetAge = snapshot.profile.age === 36 ? 37 : 36;
    await age.fill(String(targetAge));
    await page.getByLabel('Gender').selectOption('other');
    await page.getByLabel('Weight').fill('81.4');
    return { control, descriptor: {
      activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control),
      feedback: flashFeedback(page, 'Profile updated successfully!'),
      persistence: { kind: 'json', url: '/__test__/account-snapshot', path: 'profile.age',
        expectedBefore: snapshot.profile.age, expectedAfter: targetAge },
    } };
  }

  if (state === 'catalog-add' && action === 'Add pouch') {
    const control = exactActionButton(page, action);
    const brand = page.getByLabel('Brand');
    if (branch === 'invalid') {
      await brand.fill('');
      const validation = nativeValidation(brand, 'Please fill out this field.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: brand }, error: validation, feedback: validation } };
    }
    await brand.fill('Calm Orchard');
    await page.getByLabel('Nicotine strength').fill('2.75');
    const row = page.locator('.catalog-row', { hasText: 'Calm Orchard' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control),
      feedback: flashFeedback(page, 'Successfully added Calm Orchard (2.75mg) to your catalog!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'catalog-edit' && action === 'Save changes') {
    const control = exactActionButton(page, action);
    const strength = page.getByLabel('Nicotine strength');
    if (branch === 'invalid') {
      await strength.fill('');
      const validation = nativeValidation(strength, 'Please fill out this field.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: strength }, error: validation, feedback: validation } };
    }
    await page.getByLabel('Brand').fill('Calm Cedar');
    await strength.fill('3.25');
    const row = page.locator('.catalog-row', { hasText: 'Calm Cedar' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control),
      feedback: flashFeedback(page, 'Successfully updated Calm Cedar (3.25mg)!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'goal-create' && action === 'Create goal') {
    const control = exactActionButton(page, action);
    const goalType = page.getByLabel('Goal type');
    if (branch === 'invalid') {
      await goalType.selectOption('');
      const validation = nativeValidation(goalType, 'Please select an item in the list.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: goalType }, error: validation, feedback: validation } };
    }
    await goalType.selectOption('daily_pouches');
    await page.getByLabel('Target value').fill('7');
    await page.getByLabel('Notification threshold').fill('75');
    const notifications = page.getByLabel('Notify me as I approach this goal');
    if (await notifications.isChecked()) await notifications.uncheck();
    const row = page.locator('article.goal-row[data-goal-state="active"]', {
      hasText: 'Daily pouch ceiling',
    });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control),
      feedback: flashFeedback(page, 'Goal created successfully! Target: 7 daily pouches'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'goal-edit' && action === 'Save changes') {
    const control = exactActionButton(page, action);
    const target = page.getByLabel('Target value');
    if (branch === 'invalid') {
      await target.fill('');
      const validation = nativeValidation(target, 'Please fill out this field.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: target }, error: validation, feedback: validation } };
    }
    await target.fill('6');
    const active = page.getByLabel('Keep this goal active');
    if (!await active.isChecked()) await active.check();
    const notifications = page.getByLabel('Notify me as I approach this goal');
    if (!await notifications.isChecked()) await notifications.check();
    await page.getByLabel('Notification threshold').fill('75');
    const row = page.locator('article.goal-row[data-goal-state="active"]');
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control), feedback: flashFeedback(page, 'Goal updated successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'log-add' && action === 'Add entry') {
    const dialog = page.getByRole('dialog', { name: 'Add a log' });
    const control = dialog.getByRole('button', { name: action, exact: true });
    const product = dialog.getByLabel('Product');
    if (branch === 'invalid') {
      await product.selectOption('');
      const validation = nativeValidation(product, 'Please select an item in the list.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: product }, error: validation, feedback: validation } };
    }
    await dialog.getByLabel('Date').fill('2026-01-11');
    await dialog.getByLabel('Time').fill('09:15');
    await product.selectOption({ index: 1 });
    await dialog.getByLabel('Quantity').fill('2');
    await dialog.getByLabel('Notes').fill('supporting add entry');
    const row = page.locator('.logbook-row', { hasText: 'supporting add entry' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control), feedback: flashFeedback(page, 'Log entry added successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'log-bulk' && action === 'Add entries') {
    const control = exactActionButton(page, action);
    const entries = page.getByLabel('Entries', { exact: true });
    if (branch === 'invalid') {
      await entries.fill('');
      const validation = nativeValidation(entries, 'Please fill out this field.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: entries }, error: validation, feedback: validation } };
    }
    await page.getByLabel('Date for these entries').fill('2026-01-12');
    await entries.fill('1 Bulk Evidence 4mg at 13:00');
    const row = page.locator('.logbook-row', { hasText: 'Bulk Evidence' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control),
      feedback: flashFeedback(page, 'Successfully added 1 log entries!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  if (state === 'log-edit' && action === 'Save changes') {
    const control = exactActionButton(page, action);
    const quantity = page.getByLabel('Quantity');
    if (branch === 'invalid') {
      await quantity.fill('');
      const validation = nativeValidation(quantity, 'Please fill out this field.');
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        focus: { mode: 'moved', locator: quantity }, error: validation, feedback: validation } };
    }
    await quantity.fill('3');
    await page.getByLabel('Notes').fill('supporting edit saved');
    const row = page.locator('.logbook-row', { hasText: 'supporting edit saved' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await formRequest(control), feedback: flashFeedback(page, 'Log entry updated successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: await row.count(), expectedAfter: 1 } } };
  }

  throw new Error(`validated mutation is not cataloged: ${state} › ${action}`);
}


function validatedMutationScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['invalid', 'success']),
    resolve(branch) {
      if (!['invalid', 'success'].includes(branch)) {
        throw new Error(`unknown validated-mutation branch: ${branch}`);
      }
      return validatedMutationPlan(page, state, action, branch);
    },
  });
}


function formMutationScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown form-mutation branch: ${branch}`);
      if (state === 'preferences' && action === 'Save preferences') {
        const snapshot = await accountSnapshot(page);
        const before = snapshot.preferences.units_preference;
        const after = before === 'mg' ? 'percentage' : 'mg';
        await page.getByLabel('Units', { exact: true }).selectOption(after);
        await page.getByLabel('Time zone').selectOption('Asia/Riyadh');
        await page.getByLabel('Daily reset time').fill('04:30');
        const brand = page.getByRole('checkbox', { name: 'Steady Mint' });
        if (!await brand.isChecked()) await brand.check();
        const control = exactActionButton(page, action);
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control),
          feedback: flashFeedback(page, 'Preferences updated successfully!'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.units_preference', expectedBefore: before, expectedAfter: after },
        } };
      }
      if (state === 'reminders' && action === 'Save reminders') {
        const snapshot = await accountSnapshot(page);
        const before = Boolean(snapshot.preferences.weekly_reports);
        for (const name of [
          'Email', 'Discord', 'Goal progress', 'Milestones',
          'Daily logging reminder', 'Weekly progress report',
        ]) {
          const toggle = page.getByRole('checkbox', { name });
          if (!await toggle.isChecked()) await toggle.check();
        }
        await page.getByLabel('Discord webhook URL')
          .fill('https://discord.com/api/webhooks/example/token');
        await page.getByLabel('Daily reminder time').fill('09:10');
        await page.getByLabel('Quiet hours start').fill('21:30');
        await page.getByLabel('Quiet hours end').fill('06:15');
        await page.getByLabel('Delivery frequency').selectOption('weekly');
        const control = exactActionButton(page, action);
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control),
          feedback: flashFeedback(page, 'Notification settings updated successfully!'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.weekly_reports', expectedBefore: before, expectedAfter: true },
        } };
      }
      if (state === 'goals' && action === 'Pause goal') {
        const active = page.locator('article.goal-row[data-goal-state="active"]');
        const control = active.getByRole('button', { name: action, exact: true });
        const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', {
          hasText: 'Daily pouch ceiling',
        });
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control),
          feedback: flashFeedback(page, 'Goal deactivated successfully.'),
          persistence: { kind: 'locator', locator: inactive, property: 'count',
            expectedBefore: await inactive.count(), expectedAfter: 1 },
        } };
      }
      if (action === 'Recalculate' && state.startsWith('data')) {
        const snapshot = await accountSnapshot(page);
        const before = snapshot.goals[0]?.current_streak;
        if (before === undefined) throw new Error(`${state} has no goal to recalculate`);
        const control = exactActionButton(page, action);
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control),
          feedback: flashFeedback(page, 'Recalculated streaks for 1 goals.'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'goals.0.current_streak', expectedBefore: before, expectedAfter: 0 },
        } };
      }
      throw new Error(`form mutation is not cataloged: ${state} › ${action}`);
    },
  });
}


function rowDeleteScenario(page, state, action) {
  const rowSpecs = Object.freeze({
    'catalog-search': Object.freeze({
      locator: () => page.locator('.catalog-row', { hasText: 'Calm Cedar' }),
      feedback: 'Successfully deleted Calm Cedar (3.25mg) from your catalog.',
    }),
    catalog: Object.freeze({
      locator: () => page.locator('.catalog-row', { hasText: 'Catalog Delete Fixture' }),
      feedback: 'Successfully deleted Catalog Delete Fixture (1.50mg) from your catalog.',
    }),
    goals: Object.freeze({
      locator: () => page.locator('article.goal-row', { hasText: 'Daily pouch ceiling' }),
      feedback: 'Goal deleted successfully.',
    }),
    logbook: Object.freeze({
      locator: () => page.locator('.logbook-row', { hasText: 'delete logbook evidence' }),
      feedback: 'Log entry deleted successfully!',
    }),
    'log-add': Object.freeze({
      locator: () => page.locator('.logbook-row', { hasText: 'delete log-add evidence' }),
      feedback: 'Log entry deleted successfully!',
    }),
  });
  return Object.freeze({
    branches: Object.freeze(['dismiss', 'accept']),
    async resolve(branch) {
      if (!['dismiss', 'accept'].includes(branch)) {
        throw new Error(`unknown row-delete branch: ${branch}`);
      }
      const spec = rowSpecs[state];
      if (!spec) throw new Error(`row delete is not cataloged: ${state} › ${action}`);
      const row = spec.locator();
      const control = row.getByRole('button', { name: action, exact: true });
      if (branch === 'dismiss') {
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, dialog: 'dismiss',
          outcome: { kind: 'visible', locator: row },
          error: { kind: 'dismissed-dialog', locator: row, count: await row.count() },
        } };
      }
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, dialog: 'accept',
        request: await formRequest(control), feedback: flashFeedback(page, spec.feedback),
        persistence: { kind: 'locator', locator: row, property: 'count',
          expectedBefore: await row.count(), expectedAfter: 0 },
      } };
    },
  });
}


function cravingRecordScenario(page, state, action) {
  const shared = { requests: 0, releaseFailure: null, routed: false };
  return Object.freeze({
    branches: Object.freeze(['invalid', 'failure', 'success']),
    async resolve(branch) {
      const form = page.locator('#craving-form');
      const intensity = form.getByLabel('Intensity');
      const control = form.getByRole('button', { name: action, exact: true });
      const status = form.locator('[data-craving-form-status]');
      const ownership = { kind: 'container', locator: form };
      if (branch === 'invalid') {
        await intensity.fill('');
        const validation = nativeValidation(intensity, 'Please fill out this field.');
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          focus: { mode: 'moved', locator: intensity }, error: validation, feedback: validation } };
      }
      if (branch === 'failure') {
        await intensity.fill('6');
        let releaseFailure;
        const heldFailure = new Promise((resolve) => { releaseFailure = resolve; });
        shared.releaseFailure = releaseFailure;
        await page.route('**/cravings/api/cravings', async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          shared.requests += 1;
          await heldFailure;
          await route.fulfill({
            status: 503, contentType: 'application/json',
            body: JSON.stringify({ error: 'Temporary test failure.' }),
          });
        });
        shared.routed = true;
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: { method: 'POST', path: /^\/cravings\/api\/cravings$/, status: 503,
            payload: { kind: 'json', exact: { intensity: 6 } } },
          loading: { disabled: true, status: { locator: status, text: 'Saving your craving…' } },
          error: { locator: status, text: 'Temporary test failure.', state: 'error', ownership },
          feedback: { locator: status, text: 'Temporary test failure.', ownership },
          focus: { mode: 'retained' },
          async whilePending() {
            await control.evaluate((element) => {
              element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            if (shared.requests !== 1) {
              throw new Error('craving record accepted a duplicate pending request');
            }
            shared.releaseFailure();
          },
        } };
      }
      if (branch !== 'success') throw new Error(`unknown craving-record branch: ${branch}`);
      if (shared.routed) await page.unroute('**/cravings/api/cravings');
      await intensity.fill('6');
      const rows = page.locator('.craving-row');
      const before = await rows.count();
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' },
        request: { method: 'POST', path: /^\/cravings\/api\/cravings$/, status: 201,
          payload: { kind: 'json', exact: { intensity: 6 } } },
        feedback: { locator: status,
          text: 'Craving recorded. Thank you for noticing the moment.', ownership },
        persistence: { kind: 'locator', locator: rows, property: 'count',
          expectedBefore: before, expectedAfter: before + 1 },
      } };
    },
  });
}


function downloadScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown download branch: ${branch}`);
      const control = exactActionButton(page, action);
      const downloadPending = page.waitForEvent('download');
      const request = await formRequest(control, 200);
      request.settleNavigation = false;
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, request,
        async after() {
          const download = await downloadPending;
          if (!/^nicotine_tracker_data_\d{4}-\d{2}-\d{2}\.json$/
            .test(download.suggestedFilename())) {
            throw new Error(`${state} download filename is not authoritative`);
          }
        },
      } };
    },
  });
}


function offlineToggleScenario(page, state, action) {
  const shared = { routeInstalled: false, requests: 0, releaseFailure: null };
  return Object.freeze({
    branches: Object.freeze(['success', 'failure']),
    async resolve(branch) {
      const control = page.getByRole('checkbox', { name: action, exact: true });
      const status = page.locator('#offline-queue-status');
      const ownership = { kind: 'container', locator: page.locator('.data-section', {
        has: control,
      }) };
      const snapshot = await accountSnapshot(page);
      const before = Boolean(snapshot.preferences.offline_queue_enabled);
      if (await control.isChecked() !== before) {
        throw new Error('offline toggle DOM state differs from its authoritative persisted state');
      }
      const requested = !before;
      if (branch === 'success') {
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Space' },
          request: { method: 'PATCH', path: /^\/settings\/privacy\/offline-queue$/,
            status: 200, payload: { kind: 'json', exact: { enabled: requested } } },
          feedback: { locator: status,
            text: requested ? 'Offline saving is on.' : 'Offline saving is off.', ownership },
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.offline_queue_enabled', expectedBefore: before,
            expectedAfter: requested },
        } };
      }
      if (branch !== 'failure') throw new Error(`unknown offline-toggle branch: ${branch}`);
      let releaseFailure;
      const heldFailure = new Promise((resolve) => { releaseFailure = resolve; });
      shared.releaseFailure = releaseFailure;
      const failureStatus = state === 'data' ? 500 : 503;
      await page.route('**/settings/privacy/offline-queue', async (route) => {
        shared.requests += 1;
        await heldFailure;
        await route.fulfill({
          status: failureStatus, contentType: 'application/json',
          body: JSON.stringify({ success: false }),
        });
      });
      shared.routeInstalled = true;
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Space' },
        request: { method: 'PATCH', path: /^\/settings\/privacy\/offline-queue$/,
          status: failureStatus, payload: { kind: 'json', exact: { enabled: requested } } },
        loading: { disabled: true,
          status: { locator: status, text: 'Saving offline preference…' } },
        error: { locator: status,
          text: 'Offline preference could not be saved. Please try again.',
          state: 'error', ownership },
        feedback: { locator: status,
          text: 'Offline preference could not be saved. Please try again.', ownership },
        focus: { mode: 'retained' },
        outcome: { kind: 'checked', locator: control, checked: before },
        async whilePending() {
          await control.evaluate((element) => {
            element.dispatchEvent(new Event('change', { bubbles: true }));
          });
          if (shared.requests !== 1) throw new Error('offline toggle accepted a duplicate request');
          shared.releaseFailure();
        },
        async after() {
          if (shared.routeInstalled) await page.unroute('**/settings/privacy/offline-queue');
        },
      } };
    },
  });
}


function asyncActionScenario(page, state, action) {
  const isDiscord = action === 'Test Discord connection';
  const routePattern = isDiscord
    ? '**/settings/test-discord-webhook' : '**/settings/notifications/trigger-weekly';
  const path = isDiscord
    ? /^\/settings\/test-discord-webhook$/ : /^\/settings\/notifications\/trigger-weekly$/;
  const control = isDiscord
    ? page.locator('#test-discord-webhook') : page.locator('#trigger-weekly-report');
  const status = isDiscord
    ? page.locator('#discord-test-status') : page.locator('#weekly-report-status');
  const successText = isDiscord ? 'Discord connection confirmed.' : 'Weekly report queued.';
  const failureText = isDiscord
    ? 'Discord rejected the test.' : 'Weekly report could not be queued.';
  const pendingText = isDiscord ? 'Testing…' : 'Sending…';
  const successButtonText = pendingText;
  const ownership = { kind: 'container', locator: page.locator('.settings-content__body') };
  const shared = { calls: 0, releaseSuccess: null, routeInstalled: false };
  return Object.freeze({
    branches: Object.freeze(['success', 'failure']),
    async resolve(branch) {
      if (!['success', 'failure'].includes(branch)) {
        throw new Error(`unknown async-action branch: ${branch}`);
      }
      if (!shared.routeInstalled) {
        let releaseSuccess;
        const heldSuccess = new Promise((resolve) => { releaseSuccess = resolve; });
        shared.releaseSuccess = releaseSuccess;
        await page.route(routePattern, async (route) => {
          shared.calls += 1;
          const success = shared.calls === 1;
          if (success) await heldSuccess;
          await route.fulfill({
            status: success ? 200 : 503,
            contentType: 'application/json',
            body: JSON.stringify({
              success,
              message: success ? successText : failureText,
            }),
          });
        });
        shared.routeInstalled = true;
      }
      if (isDiscord) {
        await page.getByLabel('Discord webhook URL')
          .fill('https://discord.com/api/webhooks/example/token');
        const channel = page.getByRole('checkbox', { name: 'Discord' });
        if (!await channel.isChecked()) await channel.check();
      } else {
        const weekly = page.getByRole('checkbox', { name: 'Weekly progress report' });
        if (!await weekly.isChecked()) await weekly.check();
      }
      const payload = isDiscord
        ? { webhook_url: 'https://discord.com/api/webhooks/example/token' } : {};
      const descriptor = {
        activation: { kind: 'keyboard', key: 'Enter' },
        request: { method: 'POST', path, status: branch === 'success' ? 200 : 503,
          payload: { kind: 'json', exact: payload } },
        focus: { mode: 'retained' },
      };
      if (branch === 'success') {
        descriptor.loading = { disabled: true, text: successButtonText,
          status: isDiscord ? { locator: status, text: pendingText } : undefined };
        descriptor.feedback = { locator: status, text: successText, ownership };
        descriptor.whilePending = async () => {
          await control.evaluate((element) => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          });
          if (shared.calls !== 1) throw new Error(`${action} accepted a duplicate request`);
          shared.releaseSuccess();
        };
      } else {
        descriptor.error = { locator: status, text: failureText, state: 'error', ownership };
        descriptor.feedback = { locator: status, text: failureText, ownership };
        descriptor.after = async () => page.unroute(routePattern);
      }
      return { control, descriptor };
    },
  });
}


function destructiveDataScenario(page, state, action) {
  const specs = Object.freeze({
    Cleanup: Object.freeze({
      label: 'Type CLEANUP to confirm', confirmation: 'CLEANUP',
      feedback: 'Removed 1 duplicate log entries.', path: 'logs.length', transform: (value) => value - 1,
    }),
    Merge: Object.freeze({
      label: 'Type MERGE to confirm', confirmation: 'MERGE',
      feedback: 'Merged 1 similar pouch entries.', path: 'pouches.length',
      transform: (value) => value - 1,
    }),
    'Anonymize Data': Object.freeze({
      label: 'Type ANONYMIZE to confirm', confirmation: 'ANONYMIZE',
      feedback: 'Your personal data has been anonymized successfully.', path: 'profile.age',
      transform: () => null,
    }),
    'Delete Logs': Object.freeze({
      label: 'Type DELETE LOGS to confirm', confirmation: 'DELETE LOGS',
      feedback: 'Successfully deleted 2 old log entries.', path: 'logs.length', transform: () => 0,
    }),
  });
  return Object.freeze({
    branches: Object.freeze(['invalid', 'success']),
    async resolve(branch) {
      const spec = specs[action];
      if (!spec) throw new Error(`destructive data action is not cataloged: ${state} › ${action}`);
      const field = page.getByLabel(spec.label);
      const control = exactActionButton(page, action);
      if (branch === 'invalid') {
        await field.fill('WRONG');
        const validation = nativeValidation(field, 'Please match the requested format.');
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          focus: { mode: 'moved', locator: field }, error: validation, feedback: validation } };
      }
      if (branch !== 'success') throw new Error(`unknown destructive-data branch: ${branch}`);
      await field.fill(spec.confirmation);
      if (action === 'Delete Logs') await page.getByLabel('Days to keep').fill('30');
      const snapshot = await accountSnapshot(page);
      const before = spec.path.split('.').reduce((value, key) => value?.[key], snapshot);
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control),
        feedback: flashFeedback(page, spec.feedback),
        persistence: { kind: 'json', url: '/__test__/account-snapshot', path: spec.path,
          expectedBefore: before, expectedAfter: spec.transform(before) },
      } };
    },
  });
}


function validationOnlyScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['rejected']),
    async resolve(branch) {
      if (branch !== 'rejected') throw new Error(`unknown validation-only branch: ${branch}`);
      const form = page.locator('form', {
        has: page.locator(`input[value="${{
          'Update email': 'update_email',
          'Change password': 'change_password',
          'Delete account': 'delete_account',
        }[action]}"]`),
      });
      const control = form.getByRole('button', { name: action, exact: true });
      let error;
      let focus;
      if (action === 'Update email') {
        await form.getByLabel('New email address').fill('browser-changed@example.com');
        focus = form.getByLabel('Current password');
        await focus.fill('wrong-password');
        error = page.locator('#password-error');
      } else if (action === 'Change password') {
        focus = form.getByLabel('Current password');
        await focus.fill('wrong-password');
        await form.locator('#new_password').fill('replacement-password');
        await form.locator('#confirm_password').fill('replacement-password');
        error = page.locator('#current_password-error');
      } else if (action === 'Delete account') {
        focus = form.getByLabel('Password');
        await focus.fill('wrong-password');
        await form.getByLabel(/delete my account/i).fill('not the confirmation');
        error = page.locator('#delete_password-error');
      } else throw new Error(`validation-only action is not cataloged: ${state} › ${action}`);
      const message = 'Current password is incorrect.';
      const text = action === 'Delete account' ? 'Password is incorrect.' : message;
      const ownership = { kind: 'container', locator: form };
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, request: await formRequest(control, 200),
        error: { locator: error, text, ownership },
        feedback: { locator: error, text, ownership },
        focus: { mode: 'moved', locator: focus },
      } };
    },
  });
}


function disposableAccountMutationScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['invalid', 'success']),
    async resolve(branch) {
      const actionValue = {
        'Update email': 'update_email',
        'Change password': 'change_password',
        'Delete account': 'delete_account',
      }[action];
      const form = page.locator('form', { has: page.locator(`input[value="${actionValue}"]`) });
      const control = form.getByRole('button', { name: action, exact: true });
      const snapshot = await accountSnapshot(page);
      const currentEmail = snapshot.profile.email;
      const suffix = currentEmail.match(/(?:account(?:-updated)?-)(.+)@example\.com$/)?.[1];
      const updatedEmail = `account-updated-${suffix}@example.com`;
      if (action === 'Update email') {
        const email = form.getByLabel('New email address');
        await form.getByLabel('Current password').fill('account-password');
        if (branch === 'invalid') {
          await email.fill('not-an-email');
          const validation = nativeValidation(
            email,
            "Please include an '@' in the email address. 'not-an-email' is missing an '@'.",
          );
          return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
            focus: { mode: 'moved', locator: email }, error: validation, feedback: validation } };
        }
        await email.fill(updatedEmail);
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          request: await formRequest(control),
          feedback: flashFeedback(page,
            'Email updated successfully! Please verify your new email address.'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot', path: 'profile.email',
            expectedBefore: currentEmail, expectedAfter: updatedEmail } } };
      }
      if (action === 'Change password') {
        const current = form.getByLabel('Current password');
        await form.locator('#new_password').fill('updated-account-password');
        await form.locator('#confirm_password').fill('updated-account-password');
        if (branch === 'invalid') {
          await current.fill('wrong-password');
          const error = page.locator('#current_password-error');
          const ownership = { kind: 'container', locator: form };
          return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
            request: await formRequest(control, 200),
            error: { locator: error, text: 'Current password is incorrect.', ownership },
            feedback: { locator: error, text: 'Current password is incorrect.', ownership },
            focus: { mode: 'moved', locator: current } } };
        }
        await current.fill('account-password');
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          request: await formRequest(control),
          feedback: flashFeedback(page, 'Password changed successfully!'),
          persistence: { kind: 'json',
            url: '/__test__/password-match?password=updated-account-password', path: 'matches',
            expectedBefore: false, expectedAfter: true } } };
      }
      throw new Error(`validated disposable action is not cataloged: ${state} › ${action}`);
    },
  });
}


function disposableAccountDeleteScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['invalid', 'success']),
    async resolve(branch) {
      const form = page.locator('form', { has: page.locator('input[value="delete_account"]') });
      const control = form.getByRole('button', { name: action, exact: true });
      const confirmation = form.getByLabel(/delete my account/i);
      await form.getByLabel('Password').fill('updated-account-password');
      if (branch === 'invalid') {
        await confirmation.fill('keep my account');
        const error = page.locator('#confirmation-error');
        const ownership = { kind: 'container', locator: form };
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          request: await formRequest(control, 200),
          error: { locator: error, text: 'Please type "delete my account" to confirm.', ownership },
          feedback: { locator: error,
            text: 'Please type "delete my account" to confirm.', ownership },
          focus: { mode: 'moved', locator: confirmation } } };
      }
      if (branch !== 'success') throw new Error(`unknown account-delete branch: ${branch}`);
      await confirmation.fill('delete my account');
      const snapshot = await accountSnapshot(page);
      const brand = snapshot.pouches[0]?.brand;
      const url = `/__test__/owned-artifact-snapshot?user_id=${snapshot.profile.id}`
        + `&brand=${encodeURIComponent(brand)}`;
      const beforeResponse = await page.request.get(url);
      const before = await beforeResponse.json();
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        request: await formRequest(control),
        feedback: flashFeedback(page, 'Your account has been deleted.'),
        persistence: { kind: 'json', url, expectedBefore: before,
          expectedAfter: { users: 0, logs: 0, goals: 0, cravings: 0, owned_pouches: 0,
            named_pouches: 0, orphan_named_pouches: 0 } } } };
    },
  });
}


function quickMutationScenario(page, state, action) {
  const shared = {
    requests: 0,
    releaseFailure: null,
    routeInstalled: false,
  };
  const routePattern = '**/log/api/quick_add';
  return Object.freeze({
    branches: Object.freeze(['failure', 'success']),
    async resolve(branch) {
      const control = exactActionButton(page, action);
      const pouchId = await control.getAttribute('data-pouch-id');
      if (!pouchId) throw new Error(`${state} › ${action} has no catalog-owned pouch id`);
      if (branch === 'failure') {
        let releaseFailure;
        const heldFailure = new Promise((resolve) => { releaseFailure = resolve; });
        shared.releaseFailure = releaseFailure;
        await page.route(routePattern, async (route) => {
          shared.requests += 1;
          if (shared.requests === 1) {
            await heldFailure;
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                success: false,
                error: 'Quick add is temporarily unavailable.',
              }),
            });
            return;
          }
          await route.continue();
        });
        shared.routeInstalled = true;
        return {
          control,
          descriptor: {
            activation: { kind: 'keyboard', key: 'Enter' },
            request: {
              method: 'POST', path: /^\/log\/api\/quick_add$/, status: 503,
              payload: { kind: 'json', exact: { pouch_id: pouchId, quantity: 1 } },
            },
            loading: { disabled: true, text: 'Adding...' },
            error: {
              locator: page.locator('[data-notification-type="error"] [data-notification-message]'),
              text: 'Quick add is temporarily unavailable.',
              ownership: { kind: 'quick-notification', type: 'error' },
            },
            feedback: {
              locator: page.locator('[data-notification-type="error"] [data-notification-message]'),
              text: 'Quick add is temporarily unavailable.',
              ownership: { kind: 'quick-notification', type: 'error' },
            },
            focus: { mode: 'retained' },
            async whilePending() {
              await control.evaluate((element) => {
                element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              });
              if (shared.requests !== 1) {
                throw new Error('quick mutation accepted a duplicate pending request');
              }
              shared.releaseFailure();
            },
          },
        };
      }
      if (branch !== 'success') throw new Error(`unknown quick mutation branch: ${branch}`);
      const brand = await control.getAttribute('data-pouch-brand');
      const strength = await control.getAttribute('data-pouch-strength');
      const before = (await accountSnapshot(page)).logs.length;
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: {
            method: 'POST', path: /^\/log\/api\/quick_add$/, status: 200,
            payload: { kind: 'json', exact: { pouch_id: pouchId, quantity: 1 } },
          },
          feedback: {
            locator: page.locator('[data-notification-type="success"] [data-notification-message]'),
            text: `Added 1 ${brand} (${strength}mg)`,
            ownership: { kind: 'quick-notification', type: 'success' },
          },
          persistence: {
            kind: 'json', url: '/__test__/account-snapshot', path: 'logs.length',
            expectedBefore: before, expectedAfter: before + 1,
          },
          async after() {
            if (shared.routeInstalled) await page.unroute(routePattern);
          },
        },
      };
    },
  });
}


function supportingScenarioFor(page, state, action) {
  const baseline = SUPPORTING_ACTION_BASELINES.find((entry) => (
    entry.state === state && entry.action === action
  ));
  if (!baseline) throw new Error(`unknown supporting scenario: ${state} › ${action}`);
  if (['navigation', 'primaryNavigation'].includes(baseline.profile)) {
    return navigationScenario(page, state, action, baseline.profile);
  }
  if (baseline.profile === 'skip') return skipScenario(page, action);
  if (baseline.profile === 'draftToggle') return draftToggleScenario(page, action);
  if (baseline.profile === 'localControl') return localControlScenario(page, state, action);
  if (baseline.profile === 'disclosure') return disclosureScenario(page, action);
  if (baseline.profile === 'rangeNavigation') return rangeNavigationScenario(page, action);
  if (state === 'account-destructive' && baseline.profile === 'validatedMutation') {
    return disposableAccountMutationScenario(page, state, action);
  }
  if (baseline.profile === 'validatedMutation') {
    return validatedMutationScenario(page, state, action);
  }
  if (baseline.profile === 'formMutation') return formMutationScenario(page, state, action);
  if (baseline.profile === 'rowDelete') return rowDeleteScenario(page, state, action);
  if (baseline.profile === 'cravingRecord') return cravingRecordScenario(page, state, action);
  if (baseline.profile === 'download') return downloadScenario(page, state, action);
  if (baseline.profile === 'offlineToggle') return offlineToggleScenario(page, state, action);
  if (baseline.profile === 'asyncAction') return asyncActionScenario(page, state, action);
  if (baseline.profile === 'destructiveMutation' && state.startsWith('data')) {
    return destructiveDataScenario(page, state, action);
  }
  if (baseline.profile === 'validationOnly') return validationOnlyScenario(page, state, action);
  if (state === 'account-destructive' && action === 'Delete account') {
    return disposableAccountDeleteScenario(page, state, action);
  }
  if (baseline.profile === 'quickMutation') return quickMutationScenario(page, state, action);
  throw new Error(`supporting scenario is not cataloged yet: ${state} › ${action}`);
}


module.exports = {
  STATE_SCENARIOS,
  supportingScenarioFor,
};
