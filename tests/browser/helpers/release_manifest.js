const {
  CORE_BEHAVIOR_OBLIGATIONS,
  OWNER_TITLES,
  TRANSITION_ONLY_BEHAVIOR_ACTIONS,
  obligationFor,
} = require('./core_behavior_contract');
const {
  SUPPORTING_ACTION_RECEIPTS,
  SUPPORTING_RECEIPT_STATES,
  supportingReceiptFor,
} = require('./supporting_action_receipts');


const RELEASE_PAGES = [
  ['today', '/today/'], ['journey', '/journey/'],
  ['journey-onboarding', '/journey/onboarding'], ['insights', '/insights/'],
  ['you', '/you/'], ['profile', '/settings/profile'],
  ['account', '/settings/account'], ['preferences', '/settings/preferences'],
  ['reminders', '/settings/notifications'], ['data', '/settings/data'],
  ['statistics', '/settings/statistics'], ['logbook', '/log/view'],
  ['log-add', '/log/add'], ['log-bulk', '/log/bulk'],
  ['catalog', '/catalog/'], ['catalog-add', '/catalog/add'],
  ['cravings', '/cravings/cravings'], ['goals', '/goals/'],
  ['goal-create', '/goals/create'], ['dashboard', '/dashboard/'],
  ['not-found', '/__release_missing_page__'],
];


const RELEASE_STATES = [
  { name: 'landing', path: '/', status: 200 },
  { name: 'login', path: '/auth/login', status: 200 },
  { name: 'register', path: '/auth/register', status: 200 },
  { name: 'forgot-password', path: '/auth/forgot_password', status: 200 },
  {
    name: 'reset-password',
    path: '/auth/reset_password/browser-accessibility-reset-token',
    status: 200,
  },
  {
    name: 'today', path: '/today/', status: 200,
    email: 'today-targeted@example.com',
  },
  {
    name: 'journey', path: '/journey/', status: 200,
    email: 'journey-review-desktop@example.com',
  },
  {
    name: 'journey-onboarding', path: '/journey/onboarding', status: 200,
    email: 'browser@example.com',
  },
  {
    name: 'insights', path: '/insights/', status: 200,
    email: 'release-analytics-ready@example.com', allowAnalytics: true,
    insightsState: 'ready',
  },
  { name: 'you', path: '/you/', status: 200, email: 'release-settings@example.com' },
  {
    name: 'profile', path: '/settings/profile', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'account', path: '/settings/account', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'preferences', path: '/settings/preferences', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'reminders', path: '/settings/notifications', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'data', path: '/settings/data?supporting_state=data', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'statistics', path: '/settings/statistics', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'logbook', path: '/log/view', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'log-add', path: '/log/add', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'log-bulk', path: '/log/bulk', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'catalog', path: '/catalog/', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'catalog-add', path: '/catalog/add', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'cravings', path: '/cravings/cravings', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'goals', path: '/goals/', status: 200,
    email: 'journey-review-desktop@example.com',
  },
  {
    name: 'goal-create', path: '/goals/create', status: 200,
    email: 'journey-review-desktop@example.com',
  },
  {
    name: 'dashboard', path: '/dashboard/', status: 200,
    email: 'release-analytics-ready@example.com', allowAnalytics: true,
  },
  {
    name: 'not-found', path: '/__release_missing_page__', status: 404,
    email: 'release-inventory@example.com',
  },
  {
    name: 'today-no-plan', path: '/today/', status: 200,
    email: 'browser@example.com',
  },
  {
    name: 'today-paused', path: '/today/', status: 200,
    email: 'today-paused@example.com',
  },
  {
    name: 'today-exceeded', path: '/today/', status: 200,
    email: 'today-exceeded@example.com',
  },
  {
    name: 'insights-empty', path: '/insights/', status: 200,
    email: 'release-analytics-empty@example.com', allowAnalytics: true,
    insightsState: 'empty',
  },
  {
    name: 'insights-sparse', path: '/insights/', status: 200,
    email: 'release-analytics-sparse@example.com', allowAnalytics: true,
    insightsState: 'sparse',
  },
  {
    name: 'dashboard-empty', path: '/dashboard/', status: 200,
    email: 'release-analytics-empty@example.com', allowAnalytics: true,
  },
  {
    name: 'dashboard-sparse', path: '/dashboard/', status: 200,
    email: 'release-analytics-sparse@example.com', allowAnalytics: true,
  },
  {
    name: 'data-offline-enabled', path: '/settings/data', status: 200,
    email: 'release-offline-enabled@example.com',
    offlineQueueEnabled: true,
  },
  {
    name: 'data-offline-disabled', path: '/settings/data', status: 200,
    email: 'release-offline-disabled@example.com',
    offlineQueueEnabled: false,
  },
  {
    name: 'data-settings-action', path: '/settings/data?supporting_state=data-settings-action', status: 200,
    email: 'release-settings@example.com',
  },
  {
    name: 'account-destructive', path: '/settings/account', status: 200,
    email: 'release-destructive@example.com',
  },
  {
    name: 'goal-progress', path: '/goals/progress', status: 200,
    email: 'journey-review-desktop@example.com',
  },
  {
    name: 'goal-edit', path: '/__test__/release/goal-edit', status: 200,
    email: 'journey-review-desktop@example.com',
  },
  {
    name: 'log-edit', path: '/__test__/release/log-edit', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'catalog-search', path: '/catalog/search?q=Release', status: 200,
    email: 'release-inventory@example.com',
  },
  {
    name: 'catalog-edit', path: '/__test__/release/catalog-edit', status: 200,
    email: 'release-inventory@example.com',
  },
  { name: 'anonymous-not-found', path: '/__release_missing_page__', status: 404 },
  { name: 'bad-request', path: '/__test__/error/400', status: 400 },
  { name: 'server-error', path: '/__test__/error/500', status: 500 },
];


function sortedActions(...groups) {
  return [...new Set(groups.flat(Infinity))]
    .sort((left, right) => left.localeCompare(right));
}


const APP_SHELL_ACTIONS = [
  'Insights', 'Journey', 'Logbook', 'Nicotine Tracker home', 'Skip to main content',
  'Today', 'You',
];
const SETTINGS_ACTIONS = [
  'Account', 'Data & privacy', 'Preferences', 'Profile', 'Reminders', 'Statistics',
];
const INSIGHTS_ACTIONS = [
  '1 year', '30 days', '7 days', '90 days', 'Daily', 'Export CSV',
  'Open hourly detail and supporting measures', 'View consumption trend data',
  'View product data', 'View time-of-day data', 'View weekly pattern data',
  'Weekly',
];
const DATA_ACTIONS = [
  'Anonymize Data', 'Cleanup', 'Delete Logs', 'Download Data', 'Merge',
  'Recalculate', 'Review account deletion', 'Save actions for offline use',
];


function appActions(email, extras = []) {
  return sortedActions(
    APP_SHELL_ACTIONS,
    [`Open your space for ${email}`],
    extras,
  );
}


function settingsActions(email, extras = []) {
  return appActions(email, [SETTINGS_ACTIONS, extras]);
}


function reviewActions(extras = []) {
  return appActions('journey-review-desktop@example.com', extras);
}


const EXPECTED_ACTIONS = {
  landing: sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'],
    ['Create account', 'Sign in'],
  ),
  login: sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'],
    ['Create one here', 'Forgot password?', 'Remember me', 'Sign in'],
  ),
  register: sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'],
    [
      'Create account',
      'I understand this is a personal tracking tool, not medical advice.',
      'Sign in here',
    ],
  ),
  'forgot-password': sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'],
    ['Send reset link', 'Sign in here'],
  ),
  'reset-password': sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'],
    ['Reset password', 'Sign in here'],
  ),
  today: appActions('today-targeted@example.com', [
    'Edit reflection', 'I have a craving Pause and choose what helps next',
    'Log nicotine use', 'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
  journey: reviewActions([
    'Log nicotine or respond to a craving', 'Plan details and history',
    'Preview revision', 'Review this draft',
  ]),
  'journey-onboarding': appActions('browser@example.com', [
    'Continue', 'Quit by a date Build a schedule that ends at zero.',
    'Reduce steadily Work toward a lower daily pouch ceiling.',
    'Understand my baseline first Track for seven days without a reduction target.',
  ]),
  insights: appActions('release-analytics-ready@example.com', [
    INSIGHTS_ACTIONS, 'Plan for Afternoon (12PM-6PM)',
  ]),
  you: appActions('release-settings@example.com', [
    'Dark', 'Data & privacy Export and account controls',
    'Day & timezone Daily reset and display preferences', 'Light',
    'Profile Personal details kept private',
    'Reminders Channels, timing, and quiet hours', 'Sign out', 'System',
    'Your pouches Catalog and quick-log choices',
  ]),
  profile: settingsActions('release-settings@example.com', ['Save profile']),
  account: settingsActions('release-settings@example.com', [
    'Change password', 'Delete account', 'Update email',
  ]),
  preferences: settingsActions('release-settings@example.com', [
    'Save preferences', 'Steady Mint',
  ]),
  reminders: settingsActions('release-settings@example.com', [
    'Daily logging reminder', 'Discord', 'Email', 'Goal progress', 'Milestones',
    'Save reminders', 'Send weekly report', 'Test Discord connection',
    'Weekly progress report',
  ]),
  data: settingsActions('release-settings@example.com', DATA_ACTIONS),
  statistics: settingsActions('release-settings@example.com', [
    'Explore patterns in Insights',
  ]),
  logbook: appActions('release-inventory@example.com', [
    'Add log', 'Apply filters', 'Bulk add', 'Delete', 'Edit',
    'Log one Release Fixture, 3.5 milligrams', 'Log one Steady Mint, 6 milligrams',
  ]),
  'log-add': appActions('release-inventory@example.com', [
    'Add entry', 'Add log', 'Apply filters', 'Bulk add', 'Cancel',
    'Close add log dialog', 'Delete', 'Edit',
    'Log one Release Fixture, 3.5 milligrams', 'Log one Steady Mint, 6 milligrams',
  ]),
  'log-bulk': appActions('release-inventory@example.com', ['Add entries', 'Cancel']),
  catalog: appActions('release-inventory@example.com', [
    'Add a pouch', 'Delete', 'Edit', 'Search',
  ]),
  'catalog-add': appActions('release-inventory@example.com', [
    '← Your pouches', 'Add pouch', 'Cancel',
  ]),
  cravings: appActions('release-inventory@example.com', [
    'Difficulty concentrating', 'Get immediate support on Today',
    'Increased appetite', 'Irritability', 'Record craving', 'Restlessness',
  ]),
  goals: reviewActions([
    'Adjust goal', 'Create a goal', 'Delete goal', 'Pause goal',
  ]),
  'goal-create': reviewActions([
    'Back to goals', 'Cancel', 'Create goal',
    'Notify me as I approach this goal',
  ]),
  dashboard: appActions('release-analytics-ready@example.com', [
    '1 year', '30 days', '7 days', '90 days',
    'Go to Today', 'Open Insights', 'Review Journey', 'View daily values',
  ]),
  'not-found': appActions('release-inventory@example.com'),
  'today-no-plan': appActions('browser@example.com', [
    'Continue neutral tracking', 'Create a plan',
    'I have a craving Pause and choose what helps next',
    'Log nicotine use', 'Log nicotine use Add the details now',
    'Log your first nicotine use',
  ]),
  'today-paused': appActions('today-paused@example.com', [
    'I have a craving Pause and choose what helps next',
    'Log nicotine use', 'Log nicotine use Steady Mint · 6.00 mg is ready',
    'Review or resume in Journey',
  ]),
  'today-exceeded': appActions('today-exceeded@example.com', [
    'I have a craving Pause and choose what helps next', 'Keep logging',
    'Log nicotine use Steady Mint · 6.00 mg is ready',
    'Pause or revise in Journey', 'Reflect on today',
    'Review the plan in Journey', 'Take a short check-in',
  ]),
  'insights-empty': appActions('release-analytics-empty@example.com', [
    INSIGHTS_ACTIONS, 'Log today',
  ]),
  'insights-sparse': appActions('release-analytics-sparse@example.com', [
    INSIGHTS_ACTIONS, 'Log today',
  ]),
  'dashboard-empty': appActions('release-analytics-empty@example.com', [
    '1 year', '30 days', '7 days', '90 days',
    'Go to Today', 'Open Insights', 'Review Journey', 'Start with Today',
  ]),
  'dashboard-sparse': appActions('release-analytics-sparse@example.com', [
    '1 year', '30 days', '7 days', '90 days',
    'Go to Today', 'Open Insights', 'Review Journey', 'View daily values',
  ]),
  'data-offline-enabled': settingsActions(
    'release-offline-enabled@example.com', DATA_ACTIONS,
  ),
  'data-offline-disabled': settingsActions(
    'release-offline-disabled@example.com', DATA_ACTIONS,
  ),
  'data-settings-action': settingsActions('release-settings@example.com', DATA_ACTIONS),
  'account-destructive': settingsActions('release-destructive@example.com', [
    'Change password', 'Delete account', 'Update email',
  ]),
  'goal-progress': reviewActions(['Back to goals']),
  'goal-edit': reviewActions([
    'Back to goals', 'Cancel', 'Keep this goal active',
    'Notify me as I approach this goal', 'Save changes',
  ]),
  'log-edit': appActions('release-inventory@example.com', [
    'Cancel', 'Save changes',
  ]),
  'catalog-search': appActions('release-inventory@example.com', [
    '← Back to all pouches', 'Delete', 'Edit', 'Search',
  ]),
  'catalog-edit': appActions('release-inventory@example.com', [
    '← Your pouches', 'Cancel', 'Save changes',
  ]),
  'anonymous-not-found': sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'], ['Back to the start page'],
  ),
  'bad-request': sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'], ['Return safely'],
  ),
  'server-error': sortedActions(
    ['Nicotine Tracker home', 'Skip to main content'], ['Back to the start page'],
  ),
};


const CORE_ACTION_STATES = [
  'landing', 'login', 'register', 'forgot-password', 'reset-password',
  'today', 'today-no-plan', 'today-paused', 'today-exceeded',
  'journey', 'journey-onboarding',
  'insights', 'insights-empty', 'insights-sparse', 'you',
];

const ACTION_OWNERS = {
  appChrome: OWNER_TITLES.chrome,
  authLinks: OWNER_TITLES.authLinks,
  authLogin: OWNER_TITLES.authLogin,
  authForgot: OWNER_TITLES.authForgot,
  authReset: OWNER_TITLES.authReset,
  checkIn: OWNER_TITLES.todayCheckIn,
  cravingEnhanced: 'tests/browser/craving-flow.spec.js › Craving enhancement waits for readiness and opens support without navigation',
  insightsExact: OWNER_TITLES.insights,
  journeyChoices: OWNER_TITLES.journeyChoices,
  journeyLifecycle: OWNER_TITLES.journeyLifecycle,
  journeyObserve: OWNER_TITLES.journeyObserve,
  landing: OWNER_TITLES.landing,
  onboarding: OWNER_TITLES.onboarding,
  quickLogEnhanced: 'tests/browser/quick-log.spec.js › Quick Log enhanced control waits for controller-ready and opens the dialog without navigation',
  quickLogFallback: 'tests/browser/quick-log.spec.js › Quick Log fallback remains usable while enhancement is delayed',
  quickLogNoDefault: 'tests/browser/quick-log.spec.js › Today without a smart default keeps the detailed logging link fallback',
  signOut: OWNER_TITLES.signOut,
  theme: OWNER_TITLES.theme,
  todayLinks: OWNER_TITLES.todayLinks,
  todayRepeated: OWNER_TITLES.todayRepeated,
  youLinks: OWNER_TITLES.youLinks,
};


function ownedBy(owner, names) {
  return { owner, names: names.flat(Infinity) };
}


function appChromeActions(stateName) {
  return EXPECTED_ACTIONS[stateName].filter((action) => (
    APP_SHELL_ACTIONS.includes(action) || action.startsWith('Open your space for ')
  ));
}


function attachActionCoverage(stateName, ...groups) {
  const actions = EXPECTED_ACTIONS[stateName];
  const coveredBy = {};
  for (const { owner, names } of groups) {
    for (const name of names) {
      if (!actions.includes(name)) {
        throw new Error(`${stateName} coverage names unknown action: ${name}`);
      }
      if (coveredBy[name]) {
        throw new Error(`${stateName} action has two owners: ${name}`);
      }
      const obligation = obligationFor(stateName, name);
      if (!obligation) {
        throw new Error(`${stateName} › ${name} has no independent behavior obligation`);
      }
      if (obligation.owner !== owner) {
        throw new Error(`${stateName} › ${name} owner differs from independent obligation`);
      }
      coveredBy[name] = Object.freeze({
        action: name,
        state: stateName,
        test: owner,
        dimensions: obligation.dimensions,
      });
    }
  }
  const missing = actions.filter((action) => !coveredBy[action]);
  if (missing.length) {
    throw new Error(`${stateName} actions need owners: ${missing.join(', ')}`);
  }
  Object.defineProperty(actions, 'coveredBy', {
    value: Object.freeze(coveredBy),
    enumerable: false,
  });
}


for (const stateName of ['landing', 'login', 'register', 'forgot-password', 'reset-password']) {
  const actionOwners = [ownedBy(ACTION_OWNERS.appChrome, [
    'Nicotine Tracker home', 'Skip to main content',
  ])];
  if (stateName === 'landing') {
    actionOwners.push(ownedBy(ACTION_OWNERS.landing, ['Create account', 'Sign in']));
  } else if (stateName === 'register') {
    actionOwners.push(
      ownedBy(ACTION_OWNERS.onboarding, [
        'Create account',
        'I understand this is a personal tracking tool, not medical advice.',
      ]),
      ownedBy(ACTION_OWNERS.authLinks, ['Sign in here']),
    );
  } else if (stateName === 'login') {
    actionOwners.push(
      ownedBy(ACTION_OWNERS.authLinks, ['Create one here', 'Forgot password?']),
      ownedBy(ACTION_OWNERS.authLogin, ['Remember me', 'Sign in']),
    );
  } else {
    actionOwners.push(
      ownedBy(ACTION_OWNERS.authLinks, ['Sign in here']),
      ownedBy(
        stateName === 'forgot-password' ? ACTION_OWNERS.authForgot : ACTION_OWNERS.authReset,
        [stateName === 'forgot-password' ? 'Send reset link' : 'Reset password'],
      ),
    );
  }
  attachActionCoverage(stateName, ...actionOwners);
}

attachActionCoverage(
  'today',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today')),
  ownedBy(ACTION_OWNERS.checkIn, ['Edit reflection']),
  ownedBy(ACTION_OWNERS.todayRepeated, [
    'I have a craving Pause and choose what helps next',
    'Log nicotine use',
    'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
);

attachActionCoverage(
  'today-no-plan',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today-no-plan')),
  ownedBy(ACTION_OWNERS.todayLinks, [
    'Continue neutral tracking', 'Create a plan', 'Log your first nicotine use',
  ]),
  ownedBy(ACTION_OWNERS.todayRepeated, [
    'I have a craving Pause and choose what helps next',
    'Log nicotine use', 'Log nicotine use Add the details now',
  ]),
);

attachActionCoverage(
  'today-paused',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today-paused')),
  ownedBy(ACTION_OWNERS.todayLinks, ['Review or resume in Journey']),
  ownedBy(ACTION_OWNERS.todayRepeated, [
    'I have a craving Pause and choose what helps next',
    'Log nicotine use',
    'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
);

attachActionCoverage(
  'today-exceeded',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today-exceeded')),
  ownedBy(ACTION_OWNERS.todayLinks, [
    'Keep logging', 'Pause or revise in Journey', 'Reflect on today',
    'Review the plan in Journey',
  ]),
  ownedBy(ACTION_OWNERS.checkIn, ['Take a short check-in']),
  ownedBy(ACTION_OWNERS.todayRepeated, [
    'I have a craving Pause and choose what helps next',
    'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
);

attachActionCoverage(
  'journey',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('journey')),
  ownedBy(ACTION_OWNERS.journeyLifecycle, [
    'Plan details and history', 'Preview revision',
  ]),
  ownedBy(ACTION_OWNERS.journeyChoices, [
    'Log nicotine or respond to a craving', 'Review this draft',
  ]),
);

attachActionCoverage(
  'journey-onboarding',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('journey-onboarding')),
  ownedBy(ACTION_OWNERS.onboarding, [
    'Continue',
    'Reduce steadily Work toward a lower daily pouch ceiling.',
  ]),
  ownedBy(ACTION_OWNERS.journeyChoices, [
    'Quit by a date Build a schedule that ends at zero.',
    'Understand my baseline first Track for seven days without a reduction target.',
  ]),
);

for (const stateName of ['insights', 'insights-empty', 'insights-sparse']) {
  attachActionCoverage(
    stateName,
    ownedBy(ACTION_OWNERS.appChrome, appChromeActions(stateName)),
    ownedBy(ACTION_OWNERS.insightsExact, [
      '1 year', '30 days', '7 days', '90 days',
      'Open hourly detail and supporting measures', 'Weekly',
      'Daily', 'Export CSV', 'View consumption trend data', 'View product data',
      'View time-of-day data', 'View weekly pattern data',
      stateName === 'insights' ? 'Plan for Afternoon (12PM-6PM)' : 'Log today',
    ]),
  );
}

attachActionCoverage(
  'you',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('you')),
  ownedBy(ACTION_OWNERS.theme, ['Dark', 'Light', 'System']),
  ownedBy(ACTION_OWNERS.signOut, ['Sign out']),
  ownedBy(ACTION_OWNERS.youLinks, [
    'Data & privacy Export and account controls',
    'Day & timezone Daily reset and display preferences',
    'Profile Personal details kept private',
    'Reminders Channels, timing, and quiet hours',
    'Your pouches Catalog and quick-log choices',
  ]),
);


for (const stateName of SUPPORTING_RECEIPT_STATES) {
  const actions = EXPECTED_ACTIONS[stateName];
  const coveredBy = {};
  for (const action of actions) {
    const receipt = supportingReceiptFor(stateName, action);
    if (!receipt) {
      throw new Error(`${stateName} › ${action} has no independent supporting receipt`);
    }
    coveredBy[action] = Object.freeze({
      action,
      state: stateName,
      test: receipt.owner,
      dimensions: receipt.dimensions,
    });
  }
  Object.defineProperty(actions, 'coveredBy', {
    value: Object.freeze(coveredBy),
    enumerable: false,
  });
}


function resolveReleaseState(state, projectName) {
  const device = projectName.includes('mobile') ? 'mobile' : 'desktop';
  return {
    allowAnalytics: false,
    ...state,
    email: state.email?.replace('{device}', device),
  };
}


async function loginAs(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today\/?$/);
}


module.exports = {
  CORE_ACTION_STATES,
  CORE_BEHAVIOR_OBLIGATIONS,
  EXPECTED_ACTIONS,
  RELEASE_PAGES,
  RELEASE_STATES,
  SUPPORTING_ACTION_RECEIPTS,
  SUPPORTING_ACTION_STATES: SUPPORTING_RECEIPT_STATES,
  TRANSITION_ONLY_BEHAVIOR_ACTIONS,
  loginAs,
  resolveReleaseState,
};
