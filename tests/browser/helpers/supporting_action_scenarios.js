const { SUPPORTING_ACTION_BASELINES } = require('./supporting_action_baseline');


const NAVIGATION_DESTINATIONS = Object.freeze({
  Today: '/today/', Journey: '/journey/', Insights: '/insights/', You: '/you/',
  Profile: '/settings/profile', Account: '/settings/account',
  Preferences: '/settings/preferences', Reminders: '/settings/notifications',
  'Data & privacy': '/settings/data', Statistics: '/settings/statistics',
  'Review account deletion': '/settings/account',
  'Apply filters': '/log/view', 'Bulk add': '/log/bulk',
  'Add a pouch': '/catalog/add', Search: '/catalog/search',
  '← Back to all pouches': '/catalog/', '← Your pouches': '/catalog/',
  Cancel: null, 'Create a goal': '/goals/create', 'Back to goals': '/goals/',
  'Go to Today': '/today/', 'Open Insights': '/insights/',
  'Review Journey': '/journey/', 'Start with Today': '/today/',
  'Explore patterns in Insights': '/insights/',
  'Get immediate support on Today': '/today/',
  'Back to the start page': '/', 'Return safely': '/',
});


const CONTROL_SCOPES = Object.freeze({
  banner: Object.freeze({ selector: 'header.app-topbar, header.marketing-header, header.auth-brand' }),
  primary: Object.freeze({ selector: 'nav[aria-label="Primary"]' }),
  settings: Object.freeze({ selector: 'nav[aria-label="Settings"]' }),
  main: Object.freeze({ selector: '#main-content' }),
});


function navigationAuthority(state, action, profile) {
  if (profile === 'primaryNavigation' && ['Today', 'Journey', 'Insights', 'You'].includes(action)) {
    return Object.freeze({
      scope: CONTROL_SCOPES.primary, role: 'link', name: action,
      selector: `a[href="${NAVIGATION_DESTINATIONS[action]}#main-content"]`,
      attributes: Object.freeze({ href: `${NAVIGATION_DESTINATIONS[action]}#main-content` }),
      request: Object.freeze({ method: 'GET', path: NAVIGATION_DESTINATIONS[action], search: '', status: 200 }),
    });
  }
  if (action === 'Nicotine Tracker home') {
    const destination = ['anonymous-not-found', 'bad-request', 'server-error'].includes(state)
      ? '/' : '/today/';
    return Object.freeze({
      scope: CONTROL_SCOPES.banner, role: 'link', name: action,
      selector: `a[href="${destination}"]`,
      attributes: Object.freeze({ href: destination }),
      request: Object.freeze({ method: 'GET', path: destination, search: '', status: 200 }),
    });
  }
  if (action.startsWith('Open your space for ')) {
    return Object.freeze({
      scope: CONTROL_SCOPES.banner, role: 'link', name: action,
      selector: 'a[href="/you/"]',
      attributes: Object.freeze({ href: '/you/' }),
      request: Object.freeze({ method: 'GET', path: '/you/', search: '', status: 200 }),
    });
  }
  if (['Profile', 'Account', 'Preferences', 'Reminders', 'Data & privacy', 'Statistics']
    .includes(action)) {
    const destination = NAVIGATION_DESTINATIONS[action];
    return Object.freeze({
      scope: CONTROL_SCOPES.settings, role: 'link', name: action,
      selector: `a[href="${destination}"]`,
      attributes: Object.freeze({ href: destination }),
      request: Object.freeze({ method: 'GET', path: destination, search: '', status: 200 }),
    });
  }
  const destination = action === 'Cancel'
    ? (state === 'log-bulk' || state === 'log-edit' ? '/log/view'
      : state.startsWith('catalog-') ? '/catalog/' : '/goals/')
    : NAVIGATION_DESTINATIONS[action];
  const stateActionDestinations = Object.freeze({
    'logbook\u0000Edit': 'fixture:log-edit', 'log-add\u0000Edit': 'fixture:log-edit',
    'catalog\u0000Edit': 'fixture:catalog-edit', 'catalog-search\u0000Edit': 'fixture:catalog-edit',
    'goals\u0000Adjust goal': 'fixture:goal-edit',
  });
  const resolved = destination || stateActionDestinations[`${state}\u0000${action}`];
  if (!resolved) throw new Error(`navigation catalog has no destination for ${state} › ${action}`);
  const search = action === 'Apply filters'
    ? '?q=supporting+add+entry&from_date=&to_date='
    : action === 'Search' ? '?q=Calm+Cedar' : '';
  const href = action === 'Review account deletion'
    ? '/settings/account#account-delete-title'
    : (resolved.startsWith('fixture:') ? resolved : `${resolved}${search}`);
  const role = action === 'Apply filters' || action === 'Search' ? 'button' : 'link';
  const fixtureSelectors = Object.freeze({
    'fixture:log-edit': 'a[href^="/log/edit/"]',
    'fixture:catalog-edit': 'a[href^="/catalog/edit/"]',
    'fixture:goal-edit': 'a[href^="/goals/edit/"]',
  });
  const exactNavigationSelectors = Object.freeze({
    'catalog-add\u0000← Your pouches': 'a.catalog-back-link[href="/catalog/"]',
    'catalog-add\u0000Cancel': '.catalog-form__actions a.c-button--secondary[href="/catalog/"]',
    'catalog-edit\u0000← Your pouches': 'a.catalog-back-link[href="/catalog/"]',
    'catalog-edit\u0000Cancel': '.catalog-form__actions a.c-button--secondary[href="/catalog/"]',
    'goal-create\u0000Back to goals': 'a.goal-form-page__back[href="/goals/"]',
    'goal-create\u0000Cancel': '.goal-form__actions a.c-button--secondary[href="/goals/"]',
    'goal-progress\u0000Back to goals': '.goals-intro a.c-button--secondary[href="/goals/"]',
    'goal-edit\u0000Back to goals': 'a.goal-form-page__back[href="/goals/"]',
    'goal-edit\u0000Cancel': '.goal-form__actions a.c-button--secondary[href="/goals/"]',
  });
  const selector = exactNavigationSelectors[`${state}\u0000${action}`] || (role === 'button'
    ? `button.c-button--${action === 'Apply filters' ? 'primary' : 'secondary'}[type="submit"]`
    : resolved.startsWith('fixture:')
      ? fixtureSelectors[resolved]
      : `a[href="${href}"]`);
  const scope = role === 'button'
    ? Object.freeze({ selector: action === 'Apply filters'
      ? 'form.logbook-filters[action="/log/view"]'
      : 'form.catalog-search[action="/catalog/search"]' })
    : CONTROL_SCOPES.main;
  return Object.freeze({
    scope, role, selector,
    name: action,
    attributes: Object.freeze(role === 'link' ? { href } : { type: 'submit' }),
    ...(role === 'button' ? { form: Object.freeze({
      method: 'get', action: resolved, fields: Object.freeze({}),
    }) } : {}),
    request: Object.freeze({ method: 'GET', path: resolved, search, status: 200 }),
  });
}


function scopeLocator(page, scope) {
  return page.locator(scope.selector, scope.hasText ? { hasText: scope.hasText } : undefined);
}


function controlFromAuthority(page, authority) {
  return scopeLocator(page, authority.scope)
    .getByRole(authority.role, { name: authority.name, exact: true });
}


function controlAuthority(scope, role, name, selector, options = {}) {
  const scopeContract = typeof scope === 'string'
    ? Object.freeze({ selector: scope }) : Object.freeze(scope);
  return Object.freeze({
    scope: scopeContract,
    role,
    name,
    selector,
    attributes: Object.freeze(options.attributes || {}),
    ...(options.form ? { form: Object.freeze({
      ...options.form,
      fields: Object.freeze(options.form.fields || {}),
    }) } : {}),
    ...(options.request ? { request: Object.freeze(options.request) } : {}),
  });
}


function postForm(action, fields = {}) {
  return { method: 'post', action, fields };
}


function supportingControlAuthority(state, action, profile) {
  if (['navigation', 'primaryNavigation'].includes(profile)) {
    return navigationAuthority(state, action, profile);
  }
  if (profile === 'skip') {
    return controlAuthority('body', 'link', action, 'a.skip-link[href="#main-content"]', {
      attributes: { href: '#main-content' },
    });
  }
  if (state === 'profile' && action === 'Save profile') {
    return controlAuthority(
      '.profile-section form[action="/settings/profile"] .settings-save-row',
      'button', action, 'button.c-button--primary[type="submit"]', {
        attributes: { type: 'submit' }, form: postForm('/settings/profile'),
      },
    );
  }
  if (state === 'preferences' && action === 'Save preferences') {
    return controlAuthority(
      'form[action="/settings/preferences"] .settings-save-row',
      'button', action, 'button.c-button--primary[type="submit"]', {
        attributes: { type: 'submit' }, form: postForm('/settings/preferences'),
      },
    );
  }
  if (state === 'reminders' && action === 'Save reminders') {
    return controlAuthority(
      'form[action="/settings/notifications"] .settings-save-row',
      'button', action, 'button.c-button--primary[type="submit"]', {
        attributes: { type: 'submit' }, form: postForm('/settings/notifications'),
      },
    );
  }
  if (['data', 'data-offline-enabled', 'data-offline-disabled', 'data-settings-action']
    .includes(state)) {
    const dataActions = Object.freeze({
      'Download Data': ['export_data', 'secondary'],
      Cleanup: ['cleanup_duplicates', 'danger'],
      Merge: ['merge_custom_pouches', 'danger'],
      Recalculate: ['recalculate_goals', 'secondary'],
      'Anonymize Data': ['anonymize_data', 'danger'],
      'Delete Logs': ['delete_old_logs', 'danger'],
    });
    if (dataActions[action]) {
      const [value, variant] = dataActions[action];
      const scope = `form[action="/settings/data"]:has(input[name="action"][value="${value}"])`;
      return controlAuthority(scope, 'button', action,
        `button.c-button--${variant}[type="submit"]`, {
          attributes: { type: 'submit' },
          form: postForm('/settings/data', { action: value }),
        });
    }
    if (action === 'Save actions for offline use') {
      return controlAuthority(
        'section[aria-labelledby="data-offline-title"]', 'checkbox', action,
        'input#offline_queue_enabled[name="offline_queue_enabled"]', {
          attributes: {
            id: 'offline_queue_enabled', name: 'offline_queue_enabled', type: 'checkbox',
            'data-endpoint': '/settings/privacy/offline-queue',
          },
        },
      );
    }
  }
  if (['account', 'account-destructive'].includes(state)
    && ['Update email', 'Change password', 'Delete account'].includes(action)) {
    const actionValue = {
      'Update email': 'update_email', 'Change password': 'change_password',
      'Delete account': 'delete_account',
    }[action];
    return controlAuthority(
      `form[action="/settings/account"]:has(input[name="action"][value="${actionValue}"]) .settings-save-row`,
      'button', action, `button.c-button--${action === 'Delete account' ? 'danger' : 'primary'}[type="submit"]`, {
        attributes: { type: 'submit' },
        form: postForm('/settings/account', { action: actionValue }),
      },
    );
  }
  if (profile === 'rangeNavigation') {
    const days = { '7 days': '7', '30 days': '30', '90 days': '90', '1 year': '365' }[action];
    return Object.freeze({
      scope: CONTROL_SCOPES.main, role: 'link', name: action,
      selector: `a[href="/dashboard/?days=${days}"]`,
      attributes: Object.freeze({ href: `/dashboard/?days=${days}` }),
    });
  }
  if (profile === 'rowDelete') {
    const scope = {
      'catalog-search': { selector: '.catalog-row', hasText: 'Calm Cedar' },
      catalog: { selector: '.catalog-row', hasText: 'Catalog Delete Fixture' },
      goals: { selector: 'article.goal-row', hasText: 'Daily pouch ceiling' },
      logbook: { selector: '.logbook-row', hasText: 'delete logbook evidence' },
      'log-add': { selector: '.logbook-row', hasText: 'delete log-add evidence' },
    }[state];
    const deleteForms = {
      'catalog-search': ['form.catalog-delete-form', 'button.catalog-action--danger', 'fixture:catalog-delete-search'],
      catalog: ['form.catalog-delete-form', 'button.catalog-action--danger', 'fixture:catalog-delete'],
      goals: ['form.goal-delete-form', 'button.goal-action--danger', 'fixture:goal-delete'],
      logbook: ['form[data-confirm-delete]', 'button.c-button--danger', 'fixture:log-delete-logbook'],
      'log-add': ['form[data-confirm-delete]', 'button.c-button--danger', 'fixture:log-delete-log-add'],
    }[state];
    return controlAuthority(
      { ...scope, selector: `${scope.selector}:has(${deleteForms[0]})` },
      'button', action, `${deleteForms[0]} ${deleteForms[1]}[type="submit"]`, {
        attributes: { type: 'submit' }, form: postForm(deleteForms[2]),
      },
    );
  }

  if (profile === 'draftToggle') {
    const draftControls = Object.freeze({
      'preferences\u0000Steady Mint': ['form[action="/settings/preferences"]', 'input[name="preferred_brands"][value="Steady Mint"]'],
      'reminders\u0000Email': ['form[action="/settings/notifications"]', 'input#notification_channel_email'],
      'reminders\u0000Discord': ['form[action="/settings/notifications"]', 'input#notification_channel_discord'],
      'reminders\u0000Goal progress': ['form[action="/settings/notifications"]', 'input#goal_notifications'],
      'reminders\u0000Milestones': ['form[action="/settings/notifications"]', 'input#achievement_notifications'],
      'reminders\u0000Daily logging reminder': ['form[action="/settings/notifications"]', 'input#daily_reminders'],
      'reminders\u0000Weekly progress report': ['form[action="/settings/notifications"]', 'input#weekly_reports'],
      'cravings\u0000Restlessness': ['form#craving-form', 'input[name="physical_symptoms"][value="restlessness"]'],
      'cravings\u0000Irritability': ['form#craving-form', 'input[name="physical_symptoms"][value="irritability"]'],
      'cravings\u0000Difficulty concentrating': ['form#craving-form', 'input[name="physical_symptoms"][value="difficulty_concentrating"]'],
      'cravings\u0000Increased appetite': ['form#craving-form', 'input[name="physical_symptoms"][value="increased_appetite"]'],
      'goal-create\u0000Notify me as I approach this goal': ['form.goal-form[action="/goals/create"]', 'input#enable_notifications'],
      'goal-edit\u0000Keep this goal active': ['form.goal-form', 'input#is_active'],
      'goal-edit\u0000Notify me as I approach this goal': ['form.goal-form', 'input#enable_notifications'],
    })[`${state}\u0000${action}`];
    if (draftControls) {
      return controlAuthority(draftControls[0], 'checkbox', action, draftControls[1], {
        attributes: { type: 'checkbox' },
      });
    }
  }

  if (profile === 'asyncAction') {
    const asyncControls = {
      'Test Discord connection': ['test-discord-webhook', '/settings/test-discord-webhook'],
      'Send weekly report': [
        'trigger-weekly-report', '/settings/notifications/trigger-weekly',
      ],
    }[action];
    return controlAuthority(
      `.reminders-action:has(button#${asyncControls[0]})`, 'button', action,
      `button#${asyncControls[0]}[data-endpoint="${asyncControls[1]}"]`, {
        attributes: { id: asyncControls[0], type: 'button', 'data-endpoint': asyncControls[1] },
      },
    );
  }

  if (profile === 'localControl') {
    if (action === 'Add log') {
      return controlAuthority(
        '.logbook-intro__actions', 'button', action,
        'button[data-logbook-add-action][aria-controls="addLogModal"]', {
          attributes: { type: 'button', 'aria-controls': 'addLogModal' },
        },
      );
    }
    const close = action === 'Close add log dialog';
    return controlAuthority(
      'dialog#addLogModal form#add-log-form', 'button', action,
      close
        ? 'button.log-dialog__close[data-hs-overlay="#addLogModal"]'
        : 'footer.log-dialog__actions button.c-button--secondary[data-hs-overlay="#addLogModal"]',
      { attributes: { type: 'button', 'data-hs-overlay': '#addLogModal' } },
    );
  }

  if (profile === 'quickMutation') {
    const fixture = {
      'Log one Release Fixture, 3.5 milligrams': ['Release Fixture', '3.5'],
      'Log one Steady Mint, 6 milligrams': ['Steady Mint', '6'],
    }[action];
    return controlAuthority(
      '.logbook-quick__list', 'button', action,
      `button[data-quick-add][data-pouch-brand="${fixture[0]}"][data-pouch-strength="${fixture[1]}"]`, {
        attributes: {
          type: 'button', 'data-pouch-brand': fixture[0],
          'data-pouch-strength': fixture[1], 'data-quantity': '1',
        },
      },
    );
  }

  if (profile === 'cravingRecord') {
    return controlAuthority(
      'form#craving-form .craving-form-actions', 'button', action,
      'button.c-button--primary[type="submit"]', { attributes: { type: 'submit' } },
    );
  }

  if (profile === 'disclosure') {
    return controlAuthority(
      'figure[data-dashboard-trend] details.analytics-figure__table',
      'summary', action, 'summary',
    );
  }

  const mutationControls = Object.freeze({
    'log-add\u0000Add entry': ['form#add-log-form .log-dialog__actions', 'button.c-button--primary[type="submit"]', '/log/add'],
    'log-bulk\u0000Add entries': ['form.logging-form--page[action="/log/bulk"] .logging-form__actions', 'button.c-button--primary[type="submit"]', '/log/bulk'],
    'log-edit\u0000Save changes': ['form.logging-form--page .logging-form__actions', 'button.c-button--primary[type="submit"]', 'fixture:log-edit'],
    'catalog-add\u0000Add pouch': ['form.catalog-form[action="/catalog/add"] .catalog-form__actions', 'button.c-button--primary[type="submit"]', '/catalog/add'],
    'catalog-edit\u0000Save changes': ['form.catalog-form .catalog-form__actions', 'button.c-button--primary[type="submit"]', 'fixture:catalog-edit'],
    'goal-create\u0000Create goal': ['form.goal-form[action="/goals/create"] .goal-form__actions', 'button.c-button--primary[type="submit"]', '/goals/create'],
    'goal-edit\u0000Save changes': ['form.goal-form .goal-form__actions', 'button.c-button--primary[type="submit"]', 'fixture:goal-edit'],
    'goals\u0000Pause goal': ['article.goal-row[data-goal-state="active"] form[action^="/goals/toggle/"]', 'button.c-button--secondary[type="submit"]', 'fixture:goal-toggle'],
  });
  const mutationControl = mutationControls[`${state}\u0000${action}`];
  if (mutationControl) {
    return controlAuthority(
      mutationControl[0], 'button', action, mutationControl[1], {
        attributes: { type: 'submit' }, form: postForm(mutationControl[2]),
      },
    );
  }

  throw new Error(`control catalog has no exact authority for ${state} › ${action} (${profile})`);
}


async function resolvedSupportingControlAuthority(page, state, action, profile) {
  const authority = supportingControlAuthority(state, action, profile);
  const fixture = authority.form?.action;
  if (!String(fixture || '').startsWith('fixture:')) return authority;
  const snapshot = await accountSnapshot(page);
  let resolved;
  if (fixture === 'fixture:log-edit') {
    const item = snapshot.logs.find((entry) => entry.notes === 'supporting add entry');
    if (!item) throw new Error('log edit authority fixture is missing');
    resolved = `/log/edit/${item.id}`;
  } else if (fixture === 'fixture:catalog-edit') {
    const item = snapshot.pouches.find((entry) => ['Calm Cedar', 'Calm Orchard'].includes(entry.brand));
    if (!item) throw new Error('catalog edit authority fixture is missing');
    resolved = `/catalog/edit/${item.id}`;
  } else if (fixture === 'fixture:goal-edit') {
    if (!snapshot.goals[0]) throw new Error('goal edit authority fixture is missing');
    resolved = `/goals/edit/${snapshot.goals[0].id}`;
  } else if (fixture === 'fixture:goal-toggle') {
    if (!snapshot.goals[0]) throw new Error('goal toggle authority fixture is missing');
    resolved = `/goals/toggle/${snapshot.goals[0].id}`;
  } else if (fixture === 'fixture:goal-delete') {
    if (!snapshot.goals[0]) throw new Error('goal delete authority fixture is missing');
    resolved = `/goals/delete/${snapshot.goals[0].id}`;
  } else if (fixture.startsWith('fixture:catalog-delete')) {
    const brand = fixture.endsWith('-search') ? 'Calm Cedar' : 'Catalog Delete Fixture';
    const item = snapshot.pouches.find((entry) => entry.brand === brand);
    if (!item) throw new Error(`catalog delete authority fixture ${brand} is missing`);
    resolved = `/catalog/delete/${item.id}`;
  } else if (fixture.startsWith('fixture:log-delete')) {
    const notes = fixture.endsWith('logbook')
      ? 'delete logbook evidence' : 'delete log-add evidence';
    const item = snapshot.logs.find((entry) => entry.notes === notes);
    if (!item) throw new Error(`log delete authority fixture ${notes} is missing`);
    resolved = `/log/delete/${item.id}`;
  } else {
    throw new Error(`unknown form authority fixture: ${fixture}`);
  }
  return Object.freeze({
    ...authority,
    form: Object.freeze({ ...authority.form, action: resolved }),
  });
}


const STATE_SCENARIO_BASE = Object.freeze({
  'anonymous-not-found': Object.freeze({ path: /^\/__release_missing_page__$/, identity: null, marker: 'Page not found' }),
  'bad-request': Object.freeze({ path: /^\/__test__\/error\/400$/, identity: null, marker: 'Refresh and try again' }),
  'server-error': Object.freeze({ path: /^\/__test__\/error\/500$/, identity: null, marker: 'Something went wrong on our end' }),
  profile: Object.freeze({ path: /^\/settings\/profile$/, identity: 'release-settings@example.com', marker: 'Profile' }),
  account: Object.freeze({ path: /^\/settings\/account$/, identity: 'release-settings@example.com', marker: 'Account' }),
  preferences: Object.freeze({ path: /^\/settings\/preferences$/, identity: 'release-settings@example.com', marker: 'Preferences' }),
  reminders: Object.freeze({ path: /^\/settings\/notifications$/, identity: 'release-settings@example.com', marker: 'Reminders' }),
  data: Object.freeze({ path: /^\/settings\/data$/, pathText: '/settings/data', search: '?supporting_state=data', status: 200, identity: /^(?:release-settings|data-data-(?:chromium-desktop|chromium-mobile)-\d+)@example\.com$/, marker: 'Data & privacy', runtime: Object.freeze({ offlineQueueEnabled: false }) }),
  statistics: Object.freeze({ path: /^\/settings\/statistics$/, identity: 'release-settings@example.com', marker: 'Statistics' }),
  logbook: Object.freeze({ path: /^\/log\/view$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: 'Logbook' }),
  'log-add': Object.freeze({
    path: /^\/log\/view$/, search: '?open_add_modal=1',
    identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/,
    marker: 'Logbook',
  }),
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
  'data-offline-enabled': Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-offline-enabled|data-data-offline-enabled-(?:chromium-desktop|chromium-mobile)-\d+)@example\.com$/, marker: 'Data & privacy', runtime: Object.freeze({ offlineQueueEnabled: true }) }),
  'data-offline-disabled': Object.freeze({ path: /^\/settings\/data$/, identity: /^(?:release-offline-disabled|data-data-offline-disabled-(?:chromium-desktop|chromium-mobile)-\d+)@example\.com$/, marker: 'Data & privacy', runtime: Object.freeze({ offlineQueueEnabled: false }) }),
  'data-settings-action': Object.freeze({ path: /^\/settings\/data$/, pathText: '/settings/data', search: '?supporting_state=data-settings-action', status: 200, identity: /^(?:release-settings|data-data-settings-action-(?:chromium-desktop|chromium-mobile)-\d+)@example\.com$/, marker: 'Data & privacy', runtime: Object.freeze({ offlineQueueEnabled: false }) }),
  'account-destructive': Object.freeze({ path: /^\/settings\/account$/, identity: /^(?:release-destructive(?:-updated)?|account(?:-updated)?-(?:chromium-desktop|chromium-mobile))@example\.com$/, marker: 'Account' }),
  'goal-progress': Object.freeze({ path: /^\/goals\/progress$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Goal progress' }),
  'goal-edit': Object.freeze({ path: /^\/goals\/edit\/\d+$/, identity: /^(?:journey-review-desktop|goals-[\w-]+)@example\.com$/, marker: 'Adjust goal' }),
  'log-edit': Object.freeze({ path: /^\/log\/edit\/\d+$/, identity: /^(?:release-inventory|logbook-\d+|logging-gaps-[\w-]+)@example\.com$/, marker: 'Edit log' }),
  'catalog-search': Object.freeze({ path: /^\/catalog\/search$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Search pouches' }),
  'catalog-edit': Object.freeze({ path: /^\/catalog\/edit\/\d+$/, identity: /^(?:release-inventory|catalog-\d+)@example\.com$/, marker: 'Edit pouch' }),
});


const STATE_VISITS = Object.freeze({
  'anonymous-not-found': ['/__release_missing_page__', '', 404],
  'bad-request': ['/__test__/error/400', '', 400],
  'server-error': ['/__test__/error/500', '', 500],
  profile: ['/settings/profile', '', 200], account: ['/settings/account', '', 200],
  preferences: ['/settings/preferences', '', 200],
  reminders: ['/settings/notifications', '', 200],
  data: ['/settings/data', '?supporting_state=data', 200],
  statistics: ['/settings/statistics', '', 200], logbook: ['/log/view', '', 200],
  'log-add': ['/log/add', '', 200], 'log-bulk': ['/log/bulk', '', 200],
  catalog: ['/catalog/', '', 200], 'catalog-add': ['/catalog/add', '', 200],
  cravings: ['/cravings/cravings', '', 200], goals: ['/goals/', '', 200],
  'goal-create': ['/goals/create', '', 200], dashboard: ['/dashboard/', '', 200],
  'not-found': ['/__release_missing_page__', '', 404],
  'dashboard-empty': ['/dashboard/', '', 200],
  'dashboard-sparse': ['/dashboard/', '', 200],
  'data-offline-enabled': ['/settings/data', '', 200],
  'data-offline-disabled': ['/settings/data', '', 200],
  'data-settings-action': ['/settings/data', '?supporting_state=data-settings-action', 200],
  'account-destructive': ['/settings/account', '', 200],
  'goal-progress': ['/goals/progress', '', 200],
  'goal-edit': ['/__test__/release/goal-edit', '', 200],
  'log-edit': ['/__test__/release/log-edit', '', 200],
  'catalog-search': ['/catalog/search', '?q=Release', 200],
  'catalog-edit': ['/__test__/release/catalog-edit', '', 200],
});


const STATE_RUNTIME_QUERIES = Object.freeze({
  dashboard: Object.freeze(['', '?days=7', '?days=30', '?days=90', '?days=365']),
  'dashboard-empty': Object.freeze(['', '?days=7', '?days=30', '?days=90', '?days=365']),
  'dashboard-sparse': Object.freeze(['', '?days=7', '?days=30', '?days=90', '?days=365']),
  'catalog-search': Object.freeze(['?q=Release', '?q=Calm+Cedar']),
});


const STATE_SCENARIOS = Object.freeze(Object.fromEntries(
  Object.entries(STATE_SCENARIO_BASE).map(([name, scenario]) => {
    const [visitPath, visitQuery, status] = STATE_VISITS[name];
    const exactSearch = scenario.search === undefined ? visitQuery : scenario.search;
    return [name, Object.freeze({
      ...scenario,
      search: exactSearch,
      queries: STATE_RUNTIME_QUERIES[name] || Object.freeze([exactSearch]),
      visit: Object.freeze({ path: visitPath, query: visitQuery, status }),
      invariant: `supporting-state:${name}`,
      precondition: Object.freeze({
        markerRole: 'heading', markerLevel: 1, markerName: scenario.marker,
        principal: scenario.identity,
        identityStatus: scenario.identity === null ? 302 : 200,
        runtime: scenario.runtime || Object.freeze({}),
      }),
    })];
  }),
));


function exactActionButton(page, action) {
  return page.getByRole('button', { name: action, exact: true });
}


const ACCOUNT_EMAIL_VARIANTS = Object.freeze([
  Object.freeze({
    before: 'release-destructive@example.com',
    after: 'release-destructive-updated@example.com',
    brand: 'Disposable Cedar release-destructive',
  }),
  Object.freeze({
    before: 'account-chromium-desktop@example.com',
    after: 'account-updated-chromium-desktop@example.com',
    brand: 'Disposable Cedar chromium-desktop',
  }),
  Object.freeze({
    before: 'account-chromium-mobile@example.com',
    after: 'account-updated-chromium-mobile@example.com',
    brand: 'Disposable Cedar chromium-mobile',
  }),
]);


function exactPath(path) {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}


async function prepareShellActionState(page, state) {
  if (state !== 'log-add') return;
  const dialog = page.locator('dialog#addLogModal[open]');
  if (!await dialog.count()) return;
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}


function navigationScenario(page, state, action, profile) {
  const authority = navigationAuthority(state, action, profile);
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown navigation branch: ${branch}`);
      await prepareShellActionState(page, state);
      if (action === 'Apply filters') await page.getByLabel('Search logs').fill('supporting add entry');
      if (action === 'Search') await page.getByLabel('Search pouches').fill('Calm Cedar');
      const control = controlFromAuthority(page, authority);
      let requestPath = authority.request.path;
      if (requestPath === 'fixture:log-edit') {
        const snapshot = await accountSnapshot(page);
        const row = snapshot.logs.find((entry) => entry.notes === 'supporting add entry');
        if (!row) throw new Error(`${state} catalog fixture has no supporting add entry`);
        requestPath = `/log/edit/${row.id}`;
      } else if (requestPath === 'fixture:catalog-edit') {
        const snapshot = await accountSnapshot(page);
        const pouch = snapshot.pouches.find((entry) => entry.brand === 'Calm Cedar')
          || snapshot.pouches.find((entry) => entry.brand === 'Calm Orchard');
        if (!pouch) throw new Error(`${state} catalog fixture has no editable pouch`);
        requestPath = `/catalog/edit/${pouch.id}`;
      } else if (requestPath === 'fixture:goal-edit') {
        const snapshot = await accountSnapshot(page);
        if (!snapshot.goals[0]) throw new Error(`${state} catalog fixture has no editable goal`);
        requestPath = `/goals/edit/${snapshot.goals[0].id}`;
      }
      const resolvedAuthority = authority.request.path.startsWith('fixture:')
        ? Object.freeze({
          ...authority,
          attributes: Object.freeze({ href: `${requestPath}${authority.request.search}` }),
        }) : authority;
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: {
            method: authority.request.method, path: exactPath(requestPath),
            search: authority.request.search, status: authority.request.status,
          },
          authority: resolvedAuthority,
        },
      };
    },
  });
}


function skipScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown skip branch: ${branch}`);
      await prepareShellActionState(page, state);
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


const DRAFT_TRANSITIONS = Object.freeze({
  'preferences\u0000Steady Mint': Object.freeze({ before: false, after: true }),
  'reminders\u0000Email': Object.freeze({ before: false, after: true }),
  'reminders\u0000Discord': Object.freeze({ before: false, after: true }),
  'reminders\u0000Goal progress': Object.freeze({ before: false, after: true }),
  'reminders\u0000Milestones': Object.freeze({ before: false, after: true }),
  'reminders\u0000Daily logging reminder': Object.freeze({ before: false, after: true }),
  'reminders\u0000Weekly progress report': Object.freeze({ before: false, after: true }),
  'cravings\u0000Restlessness': Object.freeze({ before: false, after: true }),
  'cravings\u0000Irritability': Object.freeze({ before: false, after: true }),
  'cravings\u0000Difficulty concentrating': Object.freeze({ before: false, after: true }),
  'cravings\u0000Increased appetite': Object.freeze({ before: false, after: true }),
  'goal-create\u0000Notify me as I approach this goal': Object.freeze({ before: true, after: false }),
  'goal-edit\u0000Keep this goal active': Object.freeze({ before: true, after: false }),
  'goal-edit\u0000Notify me as I approach this goal': Object.freeze({ before: false, after: true }),
});


function draftToggleScenario(page, state, action) {
  return Object.freeze({
    branches: Object.freeze(['toggle']),
    async resolve(branch) {
      if (branch !== 'toggle') throw new Error(`unknown draft-toggle branch: ${branch}`);
      const control = page.getByRole('checkbox', { name: action, exact: true });
      const transition = DRAFT_TRANSITIONS[`${state}\u0000${action}`];
      if (!transition) throw new Error(`${state} › ${action} has no literal draft transition`);
      if (await control.isChecked() !== transition.before) {
        throw new Error(`${state} › ${action} catalog draft precondition differs`);
      }
      return {
        control,
        descriptor: {
          activation: { kind: 'keyboard', key: 'Space' },
          outcome: { kind: 'checked', locator: control, checked: transition.after },
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
  const beforeDays = Object.freeze({ '7 days': '30', '30 days': '7', '90 days': '30', '1 year': '90' });
  return Object.freeze({
    branches: Object.freeze(['success']),
    async resolve(branch) {
      if (branch !== 'success') throw new Error(`unknown range branch: ${branch}`);
      const after = String(days[action]);
      const marker = page.locator('[data-dashboard-range-days]');
      return {
        control: page.getByRole('link', { name: action, exact: true }),
        descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' },
          request: {
            method: 'GET', path: /^\/dashboard\/$/, search: `?days=${after}`, status: 200,
          },
          persistence: {
            kind: 'locator', locator: marker, property: 'attribute',
            name: 'data-dashboard-range-days', expectedBefore: beforeDays[action], expectedAfter: after,
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


async function catalogFormRequest(page, state, action, status = 302) {
  let path;
  let exact;
  const snapshotFor = async () => accountSnapshot(page);
  if (state === 'profile' && action === 'Save profile') {
    const snapshot = await snapshotFor();
    const variant = [
      { before: null, after: '36' }, { before: 36, after: '37' }, { before: 37, after: '36' },
    ].find((candidate) => candidate.before === snapshot.profile.age);
    if (!variant) throw new Error('profile catalog payload precondition is not a literal variant');
    path = '/settings/profile';
    exact = { age: variant.after, gender: 'other', weight: '81.4' };
  } else if (state === 'catalog-add' && action === 'Add pouch') {
    path = '/catalog/add';
    exact = { brand: 'Calm Orchard', nicotine_mg: '2.75' };
  } else if (state === 'catalog-edit' && action === 'Save changes') {
    const snapshot = await snapshotFor();
    const pouch = snapshot.pouches.find((item) => ['Calm Orchard', 'Calm Cedar'].includes(item.brand));
    if (!pouch) throw new Error('catalog-edit immutable pouch fixture is missing');
    path = `/catalog/edit/${pouch.id}`;
    exact = { brand: 'Calm Cedar', nicotine_mg: '3.25' };
  } else if (state === 'goal-create' && action === 'Create goal') {
    path = '/goals/create';
    exact = {
      goal_type: 'daily_pouches', target_value: '7', end_date: '',
      notification_threshold: '75',
    };
  } else if (state === 'goal-edit' && action === 'Save changes') {
    const snapshot = await snapshotFor();
    if (!snapshot.goals[0]) throw new Error('goal-edit immutable goal fixture is missing');
    path = `/goals/edit/${snapshot.goals[0].id}`;
    exact = {
      target_value: '6', end_date: '', enable_notifications: 'on',
      notification_threshold: '75', is_active: 'on',
    };
  } else if (state === 'log-add' && action === 'Add entry') {
    const snapshot = await snapshotFor();
    const pouch = snapshot.pouches.find((item) => item.brand === 'Release Fixture');
    if (!pouch) throw new Error('log-add immutable Release Fixture pouch is missing');
    path = '/log/add';
    exact = {
      user_timezone: 'UTC', log_date: '2026-01-11', log_time: '09:15',
      pouch_id: String(pouch.id), quantity: '2', notes: 'supporting add entry',
      custom_brand: '', custom_nicotine_mg: '',
    };
  } else if (state === 'log-bulk' && action === 'Add entries') {
    path = '/log/bulk';
    exact = { log_date: '2026-01-12', bulk_text: '1 Bulk Evidence 4mg at 13:00' };
  } else if (state === 'log-edit' && action === 'Save changes') {
    const snapshot = await snapshotFor();
    const log = snapshot.logs.find((item) => item.notes === 'supporting add entry');
    if (!log) throw new Error('log-edit immutable supporting entry fixture is missing');
    path = `/log/edit/${log.id}`;
    exact = {
      log_date: '2026-01-11', log_time: '09:15',
      quantity: '3', notes: 'supporting edit saved',
    };
  } else if (state === 'preferences' && action === 'Save preferences') {
    const snapshot = await snapshotFor();
    const variant = [
      { before: 'mg', after: 'percentage' }, { before: 'percentage', after: 'mg' },
    ].find((candidate) => candidate.before === snapshot.preferences.units_preference);
    if (!variant) throw new Error('preferences catalog payload precondition is not a literal variant');
    path = '/settings/preferences';
    exact = {
      daily_reset_time: '04:30', preferred_brands: 'Steady Mint',
      timezone: 'Asia/Riyadh', units_preference: variant.after,
    };
  } else if (state === 'reminders' && action === 'Save reminders') {
    path = '/settings/notifications';
    exact = {
      notification_channel: ['email', 'discord'],
      discord_webhook: 'https://discord.com/api/webhooks/example/token',
      goal_notifications: 'on', achievement_notifications: 'on', daily_reminders: 'on',
      weekly_reports: 'on', reminder_time: '09:10', quiet_hours_start: '21:30',
      quiet_hours_end: '06:15', notification_frequency: 'weekly',
    };
  } else if (state === 'goals' && action === 'Pause goal') {
    const snapshot = await snapshotFor();
    if (!snapshot.goals[0]) throw new Error('goals immutable pause fixture is missing');
    path = `/goals/toggle/${snapshot.goals[0].id}`;
    exact = {};
  } else if (state.startsWith('data') && action === 'Recalculate') {
    path = '/settings/data'; exact = { action: 'recalculate_goals' };
  } else if (state.startsWith('data') && action === 'Download Data') {
    path = '/settings/data'; exact = { action: 'export_data' };
  } else if (state.startsWith('data') && ['Cleanup', 'Merge', 'Anonymize Data', 'Delete Logs'].includes(action)) {
    path = '/settings/data';
    exact = {
      Cleanup: { action: 'cleanup_duplicates', confirm_cleanup_duplicates: 'CLEANUP' },
      Merge: { action: 'merge_custom_pouches', confirm_merge_pouches: 'MERGE' },
      'Anonymize Data': { action: 'anonymize_data', confirm_anonymize: 'ANONYMIZE' },
      'Delete Logs': {
        action: 'delete_old_logs', days_to_keep: '30', confirm_delete_logs: 'DELETE LOGS',
      },
    }[action];
  } else if (action === 'Delete' || action === 'Delete goal') {
    const snapshot = await snapshotFor();
    if (state === 'catalog-search' || state === 'catalog') {
      const brand = state === 'catalog-search' ? 'Calm Cedar' : 'Catalog Delete Fixture';
      const pouch = snapshot.pouches.find((item) => item.brand === brand);
      if (!pouch) throw new Error(`${state} immutable ${brand} delete fixture is missing`);
      path = `/catalog/delete/${pouch.id}`;
    } else if (state === 'goals') {
      if (!snapshot.goals[0]) throw new Error('goals immutable delete fixture is missing');
      path = `/goals/delete/${snapshot.goals[0].id}`;
    } else {
      const notes = state === 'logbook' ? 'delete logbook evidence' : 'delete log-add evidence';
      const log = snapshot.logs.find((item) => item.notes === notes);
      if (!log) throw new Error(`${state} immutable delete log fixture is missing`);
      path = `/log/delete/${log.id}`;
    }
    exact = {};
  } else if (state === 'account-destructive' && action === 'Update email') {
    const snapshot = await snapshotFor();
    const variant = ACCOUNT_EMAIL_VARIANTS.find((item) => (
      item.before === snapshot.profile.email
    ));
    if (!variant) throw new Error('account update immutable principal variant differs');
    path = '/settings/account';
    exact = {
      action: 'update_email', new_email: variant.after,
      password: 'account-password',
    };
  } else if (state === 'account-destructive' && action === 'Change password') {
    path = '/settings/account';
    exact = {
      action: 'change_password',
      current_password: status === 200 ? 'wrong-password' : 'account-password',
      new_password: 'updated-account-password', confirm_password: 'updated-account-password',
    };
  } else if (state === 'account-destructive' && action === 'Delete account') {
    path = '/settings/account';
    exact = {
      action: 'delete_account', password: 'updated-account-password',
      confirmation: status === 200 ? 'keep my account' : 'delete my account',
    };
  } else {
    throw new Error(`catalog form request is not literal for ${state} › ${action}`);
  }
  return {
    method: 'POST', path: exactPath(path), status,
    payload: { kind: 'form', exact }, dynamicFields: { csrf_token: 'non-empty' },
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
    const variant = [
      { before: null, after: 36 }, { before: 36, after: 37 }, { before: 37, after: 36 },
    ]
      .find((candidate) => candidate.before === snapshot.profile.age);
    if (!variant) throw new Error('profile catalog precondition is not an immutable age variant');
    const targetAge = variant.after;
    await age.fill(String(targetAge));
    await page.getByLabel('Gender').selectOption('other');
    await page.getByLabel('Weight').fill('81.4');
    return { control, descriptor: {
      activation: { kind: 'keyboard', key: 'Enter' },
      request: await catalogFormRequest(page, state, action),
      feedback: flashFeedback(page, 'Profile updated successfully!'),
      persistence: { kind: 'json', url: '/__test__/account-snapshot', path: 'profile.age',
        expectedBefore: variant.before, expectedAfter: variant.after },
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
      request: await catalogFormRequest(page, state, action),
      feedback: flashFeedback(page, 'Successfully added Calm Orchard (2.75mg) to your catalog!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
      request: await catalogFormRequest(page, state, action),
      feedback: flashFeedback(page, 'Successfully updated Calm Cedar (3.25mg)!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
      request: await catalogFormRequest(page, state, action),
      feedback: flashFeedback(page, 'Goal created successfully! Target: 7 daily pouches'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
      request: await catalogFormRequest(page, state, action), feedback: flashFeedback(page, 'Goal updated successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
    const releaseFixture = await product.locator('option', { hasText: 'Release Fixture' })
      .getAttribute('value');
    if (!releaseFixture) throw new Error('log-add catalog precondition has no Release Fixture option');
    await product.selectOption(releaseFixture);
    await dialog.getByLabel('Quantity').fill('2');
    await dialog.getByLabel('Notes').fill('supporting add entry');
    const row = page.locator('.logbook-row', { hasText: 'supporting add entry' });
    return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
      request: await catalogFormRequest(page, state, action), feedback: flashFeedback(page, 'Log entry added successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
      request: await catalogFormRequest(page, state, action),
      feedback: flashFeedback(page, 'Successfully added 1 log entries!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
      request: await catalogFormRequest(page, state, action), feedback: flashFeedback(page, 'Log entry updated successfully!'),
      persistence: { kind: 'locator', locator: row, property: 'count',
        expectedBefore: 0, expectedAfter: 1 } } };
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
        const variant = [
          { before: 'mg', after: 'percentage' },
          { before: 'percentage', after: 'mg' },
        ].find((candidate) => candidate.before === snapshot.preferences.units_preference);
        if (!variant) throw new Error('preferences catalog precondition is not a literal units variant');
        const after = variant.after;
        await page.getByLabel('Units', { exact: true }).selectOption(after);
        await page.getByLabel('Time zone').selectOption('Asia/Riyadh');
        await page.getByLabel('Daily reset time').fill('04:30');
        const brand = page.getByRole('checkbox', { name: 'Steady Mint' });
        if (!await brand.isChecked()) await brand.check();
        const control = exactActionButton(page, action);
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await catalogFormRequest(page, state, action),
          feedback: flashFeedback(page, 'Preferences updated successfully!'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.units_preference', expectedBefore: variant.before, expectedAfter: variant.after },
        } };
      }
      if (state === 'reminders' && action === 'Save reminders') {
        const snapshot = await accountSnapshot(page);
        if (Boolean(snapshot.preferences.weekly_reports) !== false) {
          throw new Error('reminders catalog precondition expected weekly reports off');
        }
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
          activation: { kind: 'keyboard', key: 'Enter' }, request: await catalogFormRequest(page, state, action),
          feedback: flashFeedback(page, 'Notification settings updated successfully!'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.weekly_reports', expectedBefore: false, expectedAfter: true },
        } };
      }
      if (state === 'goals' && action === 'Pause goal') {
        const active = page.locator('article.goal-row[data-goal-state="active"]');
        const control = active.getByRole('button', { name: action, exact: true });
        const inactive = page.locator('article.goal-row[data-goal-state="inactive"]', {
          hasText: 'Daily pouch ceiling',
        });
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await catalogFormRequest(page, state, action),
          feedback: flashFeedback(page, 'Goal deactivated successfully.'),
          persistence: { kind: 'locator', locator: inactive, property: 'count',
            expectedBefore: 0, expectedAfter: 1 },
        } };
      }
      if (action === 'Recalculate' && state.startsWith('data')) {
        const snapshot = await accountSnapshot(page);
        if (snapshot.goals[0]?.current_streak !== 9) {
          throw new Error(`${state} catalog precondition expected goal streak 9`);
        }
        const control = exactActionButton(page, action);
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Enter' }, request: await catalogFormRequest(page, state, action),
          feedback: flashFeedback(page, 'Recalculated streaks for 1 goals.'),
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'goals.0.current_streak', expectedBefore: 9, expectedAfter: 0 },
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
          error: { kind: 'dismissed-dialog', locator: row, count: 1 },
        } };
      }
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, dialog: 'accept',
        request: await catalogFormRequest(page, state, action), feedback: flashFeedback(page, spec.feedback),
        persistence: { kind: 'locator', locator: row, property: 'count',
          expectedBefore: 1, expectedAfter: 0 },
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
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' },
        request: { method: 'POST', path: /^\/cravings\/api\/cravings$/, status: 201,
          payload: { kind: 'json', exact: { intensity: 6 } } },
        feedback: { locator: status,
          text: 'Craving recorded. Thank you for noticing the moment.', ownership },
        persistence: { kind: 'locator', locator: rows, property: 'count',
          expectedBefore: 0, expectedAfter: 1 },
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
      const request = await catalogFormRequest(page, state, action, 200);
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


const OFFLINE_TRANSITIONS = Object.freeze({
  data: Object.freeze({ before: false, after: true }),
  'data-offline-enabled': Object.freeze({ before: true, after: false }),
  'data-offline-disabled': Object.freeze({ before: false, after: true }),
  'data-settings-action': Object.freeze({ before: false, after: true }),
});


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
      const transition = OFFLINE_TRANSITIONS[state];
      if (!transition) throw new Error(`${state} has no literal offline transition`);
      const expectedCurrent = branch === 'success' ? transition.before : transition.after;
      if (snapshot.preferences.offline_queue_enabled !== expectedCurrent) {
        throw new Error(
          `${state} catalog precondition expected ${expectedCurrent}; received ${snapshot.preferences.offline_queue_enabled}`,
        );
      }
      if (await control.isChecked() !== expectedCurrent) {
        throw new Error('offline toggle DOM state differs from its authoritative persisted state');
      }
      const requested = branch === 'success' ? transition.after : transition.before;
      if (branch === 'success') {
        return { control, descriptor: {
          activation: { kind: 'keyboard', key: 'Space' },
          request: { method: 'PATCH', path: /^\/settings\/privacy\/offline-queue$/,
            status: 200, payload: { kind: 'json', exact: { enabled: requested } } },
          feedback: { locator: status,
            text: requested ? 'Offline saving is on.' : 'Offline saving is off.', ownership },
          persistence: { kind: 'json', url: '/__test__/account-snapshot',
            path: 'preferences.offline_queue_enabled', expectedBefore: transition.before,
            expectedAfter: transition.after },
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
        outcome: { kind: 'checked', locator: control, checked: transition.after },
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
      feedback: 'Removed 1 duplicate log entries.', path: 'logs.length', before: 3, after: 2,
    }),
    Merge: Object.freeze({
      label: 'Type MERGE to confirm', confirmation: 'MERGE',
      feedback: 'Merged 1 similar pouch entries.', path: 'pouches.length',
      before: 2, after: 1,
    }),
    'Anonymize Data': Object.freeze({
      label: 'Type ANONYMIZE to confirm', confirmation: 'ANONYMIZE',
      feedback: 'Your personal data has been anonymized successfully.', path: 'profile.age',
      before: 39, after: null,
    }),
    'Delete Logs': Object.freeze({
      label: 'Type DELETE LOGS to confirm', confirmation: 'DELETE LOGS',
      feedback: 'Successfully deleted 2 old log entries.', path: 'logs.length', before: 2, after: 0,
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
      const actualBefore = spec.path.split('.').reduce((value, key) => value?.[key], snapshot);
      if (actualBefore !== spec.before) {
        throw new Error(`${state} › ${action} catalog precondition expected ${spec.before}; received ${actualBefore}`);
      }
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' }, request: await catalogFormRequest(page, state, action),
        feedback: flashFeedback(page, spec.feedback),
        persistence: { kind: 'json', url: '/__test__/account-snapshot', path: spec.path,
          expectedBefore: spec.before, expectedAfter: spec.after },
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
      const exactPayload = {
        'Update email': {
          action: 'update_email', password: 'wrong-password',
          new_email: 'browser-changed@example.com',
        },
        'Change password': {
          action: 'change_password', current_password: 'wrong-password',
          new_password: 'replacement-password', confirm_password: 'replacement-password',
        },
        'Delete account': {
          action: 'delete_account', password: 'wrong-password',
          confirmation: 'not the confirmation',
        },
      }[action];
      return { control, descriptor: {
        activation: { kind: 'keyboard', key: 'Enter' },
        request: {
          method: 'POST', path: /^\/settings\/account$/, status: 200,
          payload: { kind: 'form', exact: exactPayload },
          dynamicFields: { csrf_token: 'non-empty' },
          responseInvariant: `account:${exactPayload.action}:rejected`,
        },
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
      if (action === 'Update email') {
        const snapshot = await accountSnapshot(page);
        const currentEmail = snapshot.profile.email;
        const emailVariant = ACCOUNT_EMAIL_VARIANTS.find((item) => item.before === currentEmail);
        if (!emailVariant) {
          throw new Error('account catalog principal is outside its finite email variants');
        }
        const updatedEmail = emailVariant.after;
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
          request: await catalogFormRequest(page, state, action),
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
            request: await catalogFormRequest(page, state, action, 200),
            error: { locator: error, text: 'Current password is incorrect.', ownership },
            feedback: { locator: error, text: 'Current password is incorrect.', ownership },
            focus: { mode: 'moved', locator: current } } };
        }
        await current.fill('account-password');
        return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
          request: await catalogFormRequest(page, state, action),
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
          request: await catalogFormRequest(page, state, action, 200),
          error: { locator: error, text: 'Please type "delete my account" to confirm.', ownership },
          feedback: { locator: error,
            text: 'Please type "delete my account" to confirm.', ownership },
          focus: { mode: 'moved', locator: confirmation } } };
      }
      if (branch !== 'success') throw new Error(`unknown account-delete branch: ${branch}`);
      await confirmation.fill('delete my account');
      const snapshot = await accountSnapshot(page);
      const emailVariant = ACCOUNT_EMAIL_VARIANTS.find((item) => (
        item.after === snapshot.profile.email
      ));
      if (!emailVariant) {
        throw new Error('account deletion principal is outside its finite email variants');
      }
      const brand = emailVariant.brand;
      const url = `/__test__/owned-artifact-snapshot?user_id=${snapshot.profile.id}`
        + `&brand=${encodeURIComponent(brand)}`;
      const beforeResponse = await page.request.get(url);
      const actualBefore = await beforeResponse.json();
      const expectedBefore = {
        users: 1, logs: 1, goals: 1, cravings: 1, owned_pouches: 1,
        named_pouches: 1, orphan_named_pouches: 0,
      };
      if (Object.keys(actualBefore).length !== Object.keys(expectedBefore).length
        || Object.entries(expectedBefore).some(([key, value]) => actualBefore[key] !== value)) {
        throw new Error('account deletion catalog precondition differs from the immutable owned-artifact fixture');
      }
      return { control, descriptor: { activation: { kind: 'keyboard', key: 'Enter' },
        request: await catalogFormRequest(page, state, action),
        feedback: flashFeedback(page, 'Your account has been deleted.'),
        persistence: { kind: 'json', url, expectedBefore,
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
      const fixture = {
        'Log one Release Fixture, 3.5 milligrams': {
          brand: 'Release Fixture', storageStrength: '3.50', displayStrength: '3.5',
        },
        'Log one Steady Mint, 6 milligrams': {
          brand: 'Steady Mint', storageStrength: '6.00', displayStrength: '6',
        },
      }[action];
      if (!fixture) throw new Error(`${state} › ${action} has no immutable quick-add fixture`);
      const fixtureResponse = await page.request.get(
        `/__test__/supporting-pouch-fixture?brand=${encodeURIComponent(fixture.brand)}`,
      );
      if (fixtureResponse.status() !== 200) {
        throw new Error(`${state} › ${action} immutable pouch fixture is missing`);
      }
      const pouch = await fixtureResponse.json();
      if (pouch.brand !== fixture.brand || pouch.nicotine_mg !== fixture.storageStrength) {
        throw new Error(`${state} › ${action} immutable pouch fixture differs`);
      }
      const pouchId = String(pouch.id);
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
      const expectedCounts = {
        'logbook\u0000Log one Release Fixture, 3.5 milligrams': [2, 3],
        'logbook\u0000Log one Steady Mint, 6 milligrams': [3, 4],
        'log-add\u0000Log one Release Fixture, 3.5 milligrams': [4, 5],
        'log-add\u0000Log one Steady Mint, 6 milligrams': [5, 6],
      }[`${state}\u0000${action}`];
      if (!expectedCounts) throw new Error(`${state} › ${action} has no literal quick-add counts`);
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
            text: `Added 1 ${fixture.brand} (${fixture.displayStrength}mg)`,
            ownership: { kind: 'quick-notification', type: 'success' },
          },
          persistence: {
            kind: 'json', url: '/__test__/account-snapshot', path: 'logs.length',
            expectedBefore: expectedCounts[0], expectedAfter: expectedCounts[1],
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
  if (baseline.profile === 'skip') return skipScenario(page, state, action);
  if (baseline.profile === 'draftToggle') return draftToggleScenario(page, state, action);
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
  resolvedSupportingControlAuthority,
  supportingControlAuthority,
  supportingScenarioFor,
};
