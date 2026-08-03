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
  EXPECTED_ACTIONS,
  RELEASE_PAGES,
  RELEASE_STATES,
  loginAs,
  resolveReleaseState,
};
