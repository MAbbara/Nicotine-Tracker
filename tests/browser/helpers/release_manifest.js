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
    name: 'data', path: '/settings/data', status: 200,
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
    name: 'data-settings-action', path: '/settings/data', status: 200,
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
  'Insights', 'Journey', 'Nicotine Tracker home', 'Skip to main content',
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
    'Archive plan', 'Finish Observe', 'Go to Today’s next useful action',
    'Mark complete', 'Pause plan', 'Review this draft',
    'Show the complete schedule',
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
    'Go to Today', 'Open Insights', 'Review Journey', 'Start with Today',
  ]),
  'dashboard-sparse': appActions('release-analytics-sparse@example.com', [
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
  appChrome: 'tests/browser/release-core-actions.spec.js › public and authenticated chrome actions reach focus and navigation targets',
  authLinks: 'tests/browser/release-core-actions.spec.js › authentication links reach the neighboring recovery or account form',
  authLogin: 'tests/browser/release-core-actions.spec.js › login validation and Remember me preserve the authenticated session',
  authForgot: 'tests/browser/release-core-actions.spec.js › forgot form enforces validation and preserves a neutral recovery response',
  authReset: 'tests/browser/release-core-actions.spec.js › reset form enforces native and matching validation without consuming the token',
  checkIn: 'tests/browser/today-states.spec.js › optional empty reflection saves once, reconciles one row, and reopens canonical values',
  cravingEnhanced: 'tests/browser/craving-flow.spec.js › Craving enhancement waits for readiness and opens support without navigation',
  insightsDisclosures: 'tests/browser/release-core-actions.spec.js › Insights export disclosures and next steps keep data accessible',
  insightsRanges: 'tests/browser/analytics.spec.js › Insights supports every range and preserves current content when refresh fails',
  insightsRender: 'tests/browser/analytics.spec.js › Insights range response updates narrative controls export chart and table together',
  journeyChoices: 'tests/browser/release-core-actions.spec.js › uncovered onboarding choices and Journey handoffs preserve user control',
  journeyLifecycle: 'tests/browser/journey.spec.js › Journey previews explicitly, mutates future rows only, and carries status history through archive',
  journeyObserve: 'tests/browser/journey.spec.js › Observe recovery and migrated Goal review remain visibly separate and non-activating',
  landing: 'tests/browser/landing.spec.js › public landing exposes one promise and working account actions',
  onboarding: 'tests/browser/onboarding.spec.js › registration previews transparently and activates only after final confirmation',
  quickLogEnhanced: 'tests/browser/quick-log.spec.js › Quick Log enhanced control waits for controller-ready and opens the dialog without navigation',
  quickLogFallback: 'tests/browser/quick-log.spec.js › Quick Log fallback remains usable while enhancement is delayed',
  quickLogNoDefault: 'tests/browser/quick-log.spec.js › Today without a smart default keeps the detailed logging link fallback',
  signOut: 'tests/browser/offline-replay.spec.js › logout clears queued storage before another account can replay it',
  theme: 'tests/browser/shell.spec.js › theme choice publishes one effective contract and System alone follows the device',
  todayLinks: 'tests/browser/release-core-actions.spec.js › Today fallback and recovery links reach their intended next action',
  youLinks: 'tests/browser/release-core-actions.spec.js › You links reach every settings and catalog destination',
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
      coveredBy[name] = owner;
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
  ownedBy(ACTION_OWNERS.cravingEnhanced, [
    'I have a craving Pause and choose what helps next',
  ]),
  ownedBy(ACTION_OWNERS.quickLogFallback, ['Log nicotine use']),
  ownedBy(ACTION_OWNERS.quickLogEnhanced, [
    'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
);

attachActionCoverage(
  'today-no-plan',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today-no-plan')),
  ownedBy(ACTION_OWNERS.todayLinks, [
    'Continue neutral tracking', 'Create a plan', 'Log your first nicotine use',
  ]),
  ownedBy(ACTION_OWNERS.cravingEnhanced, [
    'I have a craving Pause and choose what helps next',
  ]),
  ownedBy(ACTION_OWNERS.quickLogNoDefault, [
    'Log nicotine use', 'Log nicotine use Add the details now',
  ]),
);

attachActionCoverage(
  'today-paused',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('today-paused')),
  ownedBy(ACTION_OWNERS.todayLinks, ['Review or resume in Journey']),
  ownedBy(ACTION_OWNERS.cravingEnhanced, [
    'I have a craving Pause and choose what helps next',
  ]),
  ownedBy(ACTION_OWNERS.quickLogFallback, ['Log nicotine use']),
  ownedBy(ACTION_OWNERS.quickLogEnhanced, [
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
  ownedBy(ACTION_OWNERS.cravingEnhanced, [
    'I have a craving Pause and choose what helps next',
  ]),
  ownedBy(ACTION_OWNERS.quickLogEnhanced, [
    'Log nicotine use Steady Mint · 6.00 mg is ready',
  ]),
);

attachActionCoverage(
  'journey',
  ownedBy(ACTION_OWNERS.appChrome, appChromeActions('journey')),
  ownedBy(ACTION_OWNERS.journeyLifecycle, [
    'Archive plan', 'Mark complete', 'Pause plan', 'Show the complete schedule',
  ]),
  ownedBy(ACTION_OWNERS.journeyObserve, ['Finish Observe']),
  ownedBy(ACTION_OWNERS.journeyChoices, [
    'Go to Today’s next useful action', 'Review this draft',
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
    ownedBy(ACTION_OWNERS.insightsRanges, ['1 year', '30 days', '7 days', '90 days']),
    ownedBy(ACTION_OWNERS.insightsRender, [
      'Open hourly detail and supporting measures', 'Weekly',
    ]),
    ownedBy(ACTION_OWNERS.insightsDisclosures, [
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
  EXPECTED_ACTIONS,
  RELEASE_PAGES,
  RELEASE_STATES,
  loginAs,
  resolveReleaseState,
};
