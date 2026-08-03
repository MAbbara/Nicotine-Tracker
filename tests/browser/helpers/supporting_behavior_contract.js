const { DIMENSIONS: CORE_DIMENSIONS } = require('./core_behavior_contract');
const {
  SUPPORTING_ACTION_POLICY,
  supportingPolicyFor,
} = require('./supporting_action_policy');


const DIMENSIONS = Object.freeze([...CORE_DIMENSIONS, 'feedback']);


const SUPPORTING_OWNER_TITLES = Object.freeze({
  chrome: 'tests/browser/release-supporting-actions.spec.js › every supporting chrome action runs in its exact representative state',
  settingsNavigation: 'tests/browser/release-supporting-actions.spec.js › every settings navigation action runs in its exact representative state',
  settingsProfile: 'tests/browser/settings.spec.js › Profile values persist and actions stay clear of mobile navigation',
  settingsPreferences: 'tests/browser/settings.spec.js › Preferences update with native controls and persist after reload',
  settingsReminders: 'tests/browser/settings.spec.js › Reminders persist and async actions expose success and failure feedback',
  settingsData: 'tests/browser/settings.spec.js › Data privacy controls persist and Statistics hands off to Insights',
  settingsAccountValidation: 'tests/browser/settings.spec.js › Account rejects incorrect credentials without losing the form',
  settingsAccountDisposable: 'tests/browser/settings.spec.js › Account email, password, and deletion mutations work for a disposable user',
  dataExact: 'tests/browser/release-supporting-actions.spec.js › data actions use isolated disposable records in every exact state',
  logbook: 'tests/browser/logbook.spec.js › Logbook supports saved/custom add, filter, edit, bulk add, and confirmed delete',
  loggingGaps: 'tests/browser/release-supporting-actions.spec.js › remaining logging actions preserve exact navigation and isolated records',
  catalog: 'tests/browser/catalog.spec.js › Catalog supports create, Quick Log availability, edit, search, and confirmed delete',
  catalogGaps: 'tests/browser/release-supporting-actions.spec.js › remaining catalog actions preserve exact navigation and isolated records',
  cravingsSymptoms: 'tests/browser/cravings-page.spec.js › Craving history records complete and minimal entries in chronological order',
  cravingsRecord: 'tests/browser/cravings-page.spec.js › Craving history exposes native validation and recoverable server feedback',
  cravingsLink: 'tests/browser/release-supporting-actions.spec.js › standalone craving support link reaches Today without external traffic',
  goalsLifecycle: 'tests/browser/goals.spec.js › Goals preserve create, edit, toggle, and delete behavior',
  goalsGaps: 'tests/browser/release-supporting-actions.spec.js › remaining goal actions preserve exact navigation and disposable state',
  dashboard: 'tests/browser/dashboard.spec.js › Dashboard supporting actions cover ranges, destinations, and disclosure in every data state',
  errors: 'tests/browser/release-supporting-actions.spec.js › public error recovery actions reach a safe destination',
});


const PROFILE_EVIDENCE = Object.freeze({
  skip: {
    error: ['not-applicable', 'same-document focus has no recoverable error branch'],
    feedback: ['not-applicable', 'the focused main region is the direct outcome'],
    focus: ['asserted', 'the exact main region receives focus'],
    keyboard: ['asserted', 'the exact skip link is focused and activated with Enter'],
    loading: ['not-applicable', 'same-document focus is synchronous'],
    persistence: ['not-applicable', 'focus movement has no durable state'],
    request: ['not-applicable', 'the hash target changes without an HTTP request'],
  },
  navigation: {
    error: ['not-applicable', 'the native destination has no application-managed recovery branch'],
    feedback: ['not-applicable', 'the destination document is the direct outcome'],
    focus: ['not-applicable', 'this full-page link makes no managed focus promise'],
    keyboard: ['asserted', 'the exact link is focused and activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['not-applicable', 'the destination is the complete action outcome'],
    request: ['asserted', 'the owner asserts exact GET target, status, and empty body'],
  },
  primaryNavigation: {
    error: ['not-applicable', 'the native destination has no application-managed recovery branch'],
    feedback: ['not-applicable', 'the destination document is the direct outcome'],
    focus: ['not-applicable', 'this full-page link makes no managed focus-transfer promise'],
    keyboard: ['asserted', 'the exact primary link is focused and activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['not-applicable', 'the destination is the complete action outcome'],
    request: ['asserted', 'the owner asserts exact GET target, status, and empty body'],
  },
  draftToggle: {
    error: ['not-applicable', 'the local draft control has no asynchronous error branch'],
    feedback: ['not-applicable', 'the native checked state is the direct draft outcome'],
    focus: ['asserted', 'the exact control retains focus after keyboard activation'],
    keyboard: ['asserted', 'the exact checkbox is toggled with Space'],
    loading: ['not-applicable', 'the local draft change is synchronous'],
    persistence: ['asserted', 'the saved draft value is asserted after reload'],
    request: ['not-applicable', 'the checkbox itself sends no request'],
  },
  localControl: {
    error: ['not-applicable', 'the local control has no asynchronous error branch'],
    feedback: ['not-applicable', 'the opened or closed control state is the direct outcome'],
    focus: ['asserted', 'the exact control retains or returns focus'],
    keyboard: ['asserted', 'the exact control is activated from the keyboard'],
    loading: ['not-applicable', 'the local state change is synchronous'],
    persistence: ['not-applicable', 'the local state has no durable promise'],
    request: ['not-applicable', 'the local control sends no request'],
  },
  formMutation: {
    error: ['not-applicable', 'the owner verifies the successful canonical mutation'],
    feedback: ['asserted', 'the exact success status or canonical result is visible'],
    focus: ['not-applicable', 'the full-document result has no managed focus transfer'],
    keyboard: ['asserted', 'the exact submit control is activated with Enter'],
    loading: ['not-applicable', 'the action completes through full-document navigation'],
    persistence: ['asserted', 'the exact resulting state is asserted after reload'],
    request: ['asserted', 'the owner asserts exact method, status, target, and payload'],
  },
  validatedMutation: {
    error: ['asserted', 'invalid input is rejected before the successful retry'],
    feedback: ['asserted', 'exact invalid and successful result feedback are visible'],
    focus: ['asserted', 'the invalid field receives focus'],
    keyboard: ['asserted', 'the exact submit control is activated with Enter'],
    loading: ['not-applicable', 'native validation or full-document navigation owns completion'],
    persistence: ['asserted', 'the successful value is asserted after reload'],
    request: ['asserted', 'invalid request count and exact successful method, status, and payload are asserted'],
  },
  validationOnly: {
    error: ['asserted', 'the exact invalid credential or confirmation result is asserted'],
    feedback: ['asserted', 'the exact rejected mutation message is visible'],
    focus: ['not-applicable', 'the full-page server validation result makes no managed focus promise'],
    keyboard: ['asserted', 'the exact submit control is activated with Enter'],
    loading: ['not-applicable', 'the full-document validation response owns completion'],
    persistence: ['not-applicable', 'the rejected mutation intentionally changes no durable state'],
    request: ['asserted', 'the exact rejected POST target, status, and payload are asserted'],
  },
  asyncAction: {
    error: ['asserted', 'a controlled failure exposes inline recovery after a successful attempt'],
    feedback: ['asserted', 'exact pending, success, and failure live messages are visible'],
    focus: ['asserted', 'the exact trigger retains focus through completion'],
    keyboard: ['asserted', 'the exact trigger is activated with Enter'],
    loading: ['asserted', 'disabled, busy, and live pending feedback are asserted while held'],
    persistence: ['not-applicable', 'the integration check does not mutate durable settings'],
    request: ['asserted', 'the owner asserts exact method, status, target, headers, and JSON body'],
  },
  download: {
    error: ['not-applicable', 'the successful export is the audited boundary'],
    feedback: ['not-applicable', 'the attachment delivery is the direct browser outcome'],
    focus: ['not-applicable', 'attachment delivery does not define a managed post-download focus target'],
    keyboard: ['asserted', 'the exact download trigger is activated with Enter'],
    loading: ['not-applicable', 'the browser owns attachment delivery'],
    persistence: ['not-applicable', 'a download does not mutate application state'],
    request: ['asserted', 'the owner asserts exact POST target, status, payload, and filename'],
  },
  offlineToggle: {
    error: ['asserted', 'a controlled server failure restores the previous value and exposes recovery'],
    feedback: ['asserted', 'exact pending, success, and failure live messages are visible'],
    focus: ['asserted', 'the exact checkbox retains focus after completion'],
    keyboard: ['asserted', 'the exact checkbox is toggled with Space'],
    loading: ['asserted', 'disabled, busy, and live pending feedback are asserted while held'],
    persistence: ['asserted', 'the successful account preference is asserted after reload'],
    request: ['asserted', 'the owner asserts exact PATCH target, status, CSRF header, and JSON body'],
  },
  destructiveMutation: {
    error: ['asserted', 'wrong confirmation preserves records before the accepted confirmation'],
    feedback: ['asserted', 'exact rejected and accepted mutation outcomes are visible'],
    focus: ['asserted', 'the rejected confirmation field receives focus or error association'],
    keyboard: ['asserted', 'the exact destructive control is activated with Enter'],
    loading: ['not-applicable', 'the action completes through full-document navigation'],
    persistence: ['asserted', 'the exact deletion or anonymization result and isolation boundary are asserted'],
    request: ['asserted', 'the owner asserts exact POST target, status, and confirmation payload'],
  },
  rowDelete: {
    error: ['asserted', 'dismissed native confirmation preserves the row before accepted deletion'],
    feedback: ['asserted', 'the exact successful deletion flash is visible after acceptance'],
    focus: ['not-applicable', 'browser-native confirmation owns focus while open'],
    keyboard: ['asserted', 'the exact delete trigger is activated with Enter'],
    loading: ['not-applicable', 'the action completes through full-document navigation'],
    persistence: ['asserted', 'the row remains after dismissal and is absent after accepted deletion'],
    request: ['asserted', 'the accepted action asserts exact POST target and status'],
  },
  quickMutation: {
    error: ['asserted', 'a controlled failure preserves retry state before success'],
    feedback: ['asserted', 'exact pending, failure, and success feedback are visible'],
    focus: ['asserted', 'the exact quick action retains focus after failure and retry'],
    keyboard: ['asserted', 'the exact quick action is activated with Enter'],
    loading: ['asserted', 'the pending action is held and duplicate activation is suppressed'],
    persistence: ['asserted', 'the canonical created row is asserted after reload'],
    request: ['asserted', 'the owner asserts exact request target, status, and payload'],
  },
  cravingRecord: {
    error: ['asserted', 'native validation and controlled server failure preserve the form before retry'],
    feedback: ['asserted', 'exact failure and success form statuses are visible'],
    focus: ['asserted', 'the invalid field and submit trigger focus outcomes are asserted'],
    keyboard: ['asserted', 'the exact submit control is activated with Enter'],
    loading: ['asserted', 'disabled pending state and duplicate suppression are asserted while held'],
    persistence: ['asserted', 'the canonical craving row is asserted after successful retry and reload'],
    request: ['asserted', 'zero invalid requests and exact failed and successful POST payloads are asserted'],
  },
  disclosure: {
    error: ['not-applicable', 'the local disclosure has no asynchronous error branch'],
    feedback: ['not-applicable', 'the open disclosure state is the direct outcome'],
    focus: ['asserted', 'the exact summary retains focus after activation'],
    keyboard: ['asserted', 'the exact summary is closed and reopened with Enter'],
    loading: ['not-applicable', 'the disclosure opens synchronously'],
    persistence: ['not-applicable', 'the disclosure state is page-local'],
    request: ['not-applicable', 'the disclosure sends no request'],
  },
});


function materializeDimensions(profileName, state, action) {
  const profile = PROFILE_EVIDENCE[profileName];
  if (!profile) throw new Error(`Unknown supporting evidence profile: ${profileName}`);
  return Object.freeze(Object.fromEntries(DIMENSIONS.map((dimension) => {
    const [status, reason] = profile[dimension];
    return [dimension, Object.freeze({
      status,
      reason: `${state} › ${action}: ${reason}.`,
    })];
  })));
}


const groups = [];
function group(owner, entries) {
  groups.push({ owner, entries });
}


const publicSupportingStates = ['anonymous-not-found', 'bad-request', 'server-error'];
group(SUPPORTING_OWNER_TITLES.chrome, publicSupportingStates.flatMap((state) => [
  [state, 'Nicotine Tracker home', 'navigation'],
  [state, 'Skip to main content', 'skip'],
]));

const authenticatedSupportingStates = [
  ['profile', 'release-settings@example.com'],
  ['account', 'release-settings@example.com'],
  ['preferences', 'release-settings@example.com'],
  ['reminders', 'release-settings@example.com'],
  ['data', 'release-settings@example.com'],
  ['statistics', 'release-settings@example.com'],
  ['logbook', 'release-inventory@example.com'],
  ['log-add', 'release-inventory@example.com'],
  ['log-bulk', 'release-inventory@example.com'],
  ['catalog', 'release-inventory@example.com'],
  ['catalog-add', 'release-inventory@example.com'],
  ['cravings', 'release-inventory@example.com'],
  ['goals', 'journey-review-desktop@example.com'],
  ['goal-create', 'journey-review-desktop@example.com'],
  ['dashboard', 'release-analytics-ready@example.com'],
  ['not-found', 'release-inventory@example.com'],
  ['dashboard-empty', 'release-analytics-empty@example.com'],
  ['dashboard-sparse', 'release-analytics-sparse@example.com'],
  ['data-offline-enabled', 'release-offline-enabled@example.com'],
  ['data-offline-disabled', 'release-offline-disabled@example.com'],
  ['data-settings-action', 'release-settings@example.com'],
  ['account-destructive', 'release-destructive@example.com'],
  ['goal-progress', 'journey-review-desktop@example.com'],
  ['goal-edit', 'journey-review-desktop@example.com'],
  ['log-edit', 'release-inventory@example.com'],
  ['catalog-search', 'release-inventory@example.com'],
  ['catalog-edit', 'release-inventory@example.com'],
];
group(SUPPORTING_OWNER_TITLES.chrome, authenticatedSupportingStates.flatMap(([state, email]) => [
  [state, 'Nicotine Tracker home', 'navigation'],
  [state, 'Skip to main content', 'skip'],
  [state, `Open your space for ${email}`, 'navigation'],
  [state, 'Today', 'primaryNavigation'],
  [state, 'Journey', 'primaryNavigation'],
  [state, 'Insights', 'primaryNavigation'],
  [state, 'You', 'primaryNavigation'],
]));

const settingsStates = [
  'profile', 'account', 'preferences', 'reminders', 'data', 'statistics',
  'data-offline-enabled', 'data-offline-disabled', 'data-settings-action',
  'account-destructive',
];
group(SUPPORTING_OWNER_TITLES.settingsNavigation, settingsStates.flatMap((state) => (
  ['Profile', 'Account', 'Preferences', 'Reminders', 'Data & privacy', 'Statistics']
    .map((action) => [state, action, 'navigation'])
)));

group(SUPPORTING_OWNER_TITLES.settingsProfile, [
  ['profile', 'Save profile', 'validatedMutation'],
]);
group(SUPPORTING_OWNER_TITLES.settingsPreferences, [
  ['preferences', 'Save preferences', 'formMutation'],
  ['preferences', 'Steady Mint', 'draftToggle'],
]);
group(SUPPORTING_OWNER_TITLES.settingsReminders, [
  ['reminders', 'Email', 'draftToggle'],
  ['reminders', 'Discord', 'draftToggle'],
  ['reminders', 'Goal progress', 'draftToggle'],
  ['reminders', 'Milestones', 'draftToggle'],
  ['reminders', 'Daily logging reminder', 'draftToggle'],
  ['reminders', 'Weekly progress report', 'draftToggle'],
  ['reminders', 'Save reminders', 'formMutation'],
  ['reminders', 'Test Discord connection', 'asyncAction'],
  ['reminders', 'Send weekly report', 'asyncAction'],
]);
group(SUPPORTING_OWNER_TITLES.settingsData, [
  ['data', 'Download Data', 'download'],
  ['data', 'Review account deletion', 'navigation'],
  ['data', 'Save actions for offline use', 'offlineToggle'],
  ['statistics', 'Explore patterns in Insights', 'primaryNavigation'],
]);
group(SUPPORTING_OWNER_TITLES.settingsAccountValidation, [
  ['account', 'Update email', 'validationOnly'],
  ['account', 'Change password', 'validationOnly'],
  ['account', 'Delete account', 'validationOnly'],
]);
group(SUPPORTING_OWNER_TITLES.settingsAccountDisposable, [
  ['account-destructive', 'Update email', 'validatedMutation'],
  ['account-destructive', 'Change password', 'validatedMutation'],
  ['account-destructive', 'Delete account', 'destructiveMutation'],
]);

group(SUPPORTING_OWNER_TITLES.dataExact, [
  ['data', 'Anonymize Data', 'destructiveMutation'],
  ['data', 'Cleanup', 'destructiveMutation'],
  ['data', 'Delete Logs', 'destructiveMutation'],
  ['data', 'Merge', 'destructiveMutation'],
  ['data', 'Recalculate', 'formMutation'],
  ...['data-offline-enabled', 'data-offline-disabled', 'data-settings-action'].flatMap((state) => [
    [state, 'Anonymize Data', 'destructiveMutation'],
    [state, 'Cleanup', 'destructiveMutation'],
    [state, 'Delete Logs', 'destructiveMutation'],
    [state, 'Download Data', 'download'],
    [state, 'Merge', 'destructiveMutation'],
    [state, 'Recalculate', 'formMutation'],
    [state, 'Review account deletion', 'navigation'],
    [state, 'Save actions for offline use', 'offlineToggle'],
  ]),
]);

group(SUPPORTING_OWNER_TITLES.loggingGaps, [
  ['logbook', 'Add log', 'localControl'],
  ['logbook', 'Apply filters', 'navigation'],
  ['logbook', 'Bulk add', 'navigation'],
  ['logbook', 'Delete', 'rowDelete'],
  ['logbook', 'Edit', 'navigation'],
  ['log-add', 'Add entry', 'validatedMutation'],
  ['log-add', 'Add log', 'localControl'],
  ['log-add', 'Apply filters', 'navigation'],
  ['log-add', 'Bulk add', 'navigation'],
  ['log-add', 'Cancel', 'localControl'],
  ['log-add', 'Close add log dialog', 'localControl'],
  ['log-add', 'Delete', 'rowDelete'],
  ['log-add', 'Edit', 'navigation'],
  ['log-bulk', 'Add entries', 'validatedMutation'],
  ['log-edit', 'Save changes', 'validatedMutation'],
  ['logbook', 'Log one Release Fixture, 3.5 milligrams', 'quickMutation'],
  ['logbook', 'Log one Steady Mint, 6 milligrams', 'quickMutation'],
  ['log-add', 'Log one Release Fixture, 3.5 milligrams', 'quickMutation'],
  ['log-add', 'Log one Steady Mint, 6 milligrams', 'quickMutation'],
  ['log-bulk', 'Cancel', 'navigation'],
  ['log-edit', 'Cancel', 'navigation'],
]);

group(SUPPORTING_OWNER_TITLES.catalog, [
  ['catalog', 'Add a pouch', 'navigation'],
  ['catalog', 'Delete', 'rowDelete'],
  ['catalog', 'Edit', 'navigation'],
  ['catalog', 'Search', 'navigation'],
  ['catalog-add', 'Add pouch', 'validatedMutation'],
  ['catalog-search', '← Back to all pouches', 'navigation'],
  ['catalog-search', 'Delete', 'rowDelete'],
  ['catalog-search', 'Edit', 'navigation'],
  ['catalog-search', 'Search', 'navigation'],
  ['catalog-edit', 'Save changes', 'validatedMutation'],
]);
group(SUPPORTING_OWNER_TITLES.catalogGaps, [
  ['catalog-add', '← Your pouches', 'navigation'],
  ['catalog-add', 'Cancel', 'navigation'],
  ['catalog-edit', '← Your pouches', 'navigation'],
  ['catalog-edit', 'Cancel', 'navigation'],
]);

group(SUPPORTING_OWNER_TITLES.cravingsSymptoms, [
  ['cravings', 'Difficulty concentrating', 'draftToggle'],
  ['cravings', 'Increased appetite', 'draftToggle'],
  ['cravings', 'Irritability', 'draftToggle'],
  ['cravings', 'Restlessness', 'draftToggle'],
]);
group(SUPPORTING_OWNER_TITLES.cravingsRecord, [
  ['cravings', 'Record craving', 'cravingRecord'],
]);
group(SUPPORTING_OWNER_TITLES.cravingsLink, [
  ['cravings', 'Get immediate support on Today', 'primaryNavigation'],
]);

group(SUPPORTING_OWNER_TITLES.goalsLifecycle, [
  ['goals', 'Adjust goal', 'navigation'],
  ['goals', 'Create a goal', 'navigation'],
  ['goals', 'Delete goal', 'rowDelete'],
  ['goals', 'Pause goal', 'formMutation'],
  ['goal-create', 'Create goal', 'validatedMutation'],
  ['goal-create', 'Notify me as I approach this goal', 'draftToggle'],
  ['goal-edit', 'Keep this goal active', 'draftToggle'],
  ['goal-edit', 'Notify me as I approach this goal', 'draftToggle'],
  ['goal-edit', 'Save changes', 'validatedMutation'],
]);
group(SUPPORTING_OWNER_TITLES.goalsGaps, [
  ['goal-create', 'Back to goals', 'navigation'],
  ['goal-create', 'Cancel', 'navigation'],
  ['goal-progress', 'Back to goals', 'navigation'],
  ['goal-edit', 'Back to goals', 'navigation'],
  ['goal-edit', 'Cancel', 'navigation'],
]);

group(SUPPORTING_OWNER_TITLES.dashboard, [
  ...['dashboard', 'dashboard-empty', 'dashboard-sparse'].flatMap((state) => [
    [state, 'Go to Today', 'primaryNavigation'],
    [state, 'Open Insights', 'primaryNavigation'],
    [state, 'Review Journey', 'primaryNavigation'],
  ]),
  ['dashboard', 'View daily values', 'disclosure'],
  ['dashboard-empty', 'Start with Today', 'primaryNavigation'],
  ['dashboard-sparse', 'View daily values', 'disclosure'],
]);
group(SUPPORTING_OWNER_TITLES.errors, [
  ['anonymous-not-found', 'Back to the start page', 'navigation'],
  ['bad-request', 'Return safely', 'navigation'],
  ['server-error', 'Back to the start page', 'navigation'],
]);


const obligationEntries = groups.flatMap(({ owner, entries }) => entries.map(
  ([state, action, profile]) => Object.freeze({
    state,
    action,
    owner,
    profile,
    dimensions: materializeDimensions(profile, state, action),
  }),
));

const obligationKeys = new Set();
for (const obligation of obligationEntries) {
  const key = `${obligation.state}\u0000${obligation.action}`;
  if (obligationKeys.has(key)) throw new Error(`Duplicate supporting behavior obligation: ${key}`);
  obligationKeys.add(key);
}

const SUPPORTING_BEHAVIOR_OBLIGATIONS = Object.freeze(obligationEntries);
const SUPPORTING_ACTION_STATES = Object.freeze([
  ...publicSupportingStates,
  ...authenticatedSupportingStates.map(([state]) => state),
]);


function supportingObligationFor(state, action) {
  return SUPPORTING_BEHAVIOR_OBLIGATIONS.find((entry) => (
    entry.state === state && entry.action === action
  ));
}


function assertedDimensions(obligation) {
  return DIMENSIONS.filter((dimension) => (
    obligation.dimensions[dimension].status === 'asserted'
  ));
}


function evidenceToken(state, action, dimension) {
  return `${state}\u0000${action}\u0000${dimension}`;
}


const supportingEvidenceTokens = new WeakMap();


const STATE_PATHS = Object.freeze({
  'account-destructive': /^\/settings\/account$/,
  'anonymous-not-found': /^\/__release_missing_page__$/,
  'bad-request': /^\/__test__\/error\/400$/,
  account: /^\/settings\/account$/,
  catalog: /^\/catalog\/$/,
  'catalog-add': /^\/catalog\/add$/,
  'catalog-edit': /^(?:\/__test__\/release\/catalog-edit|\/catalog\/edit\/\d+)$/,
  'catalog-search': /^\/catalog\/search$/,
  cravings: /^\/cravings\/cravings$/,
  dashboard: /^\/dashboard\/$/,
  'dashboard-empty': /^\/dashboard\/$/,
  'dashboard-sparse': /^\/dashboard\/$/,
  data: /^\/settings\/data$/,
  'data-offline-disabled': /^\/settings\/data$/,
  'data-offline-enabled': /^\/settings\/data$/,
  'data-settings-action': /^\/settings\/data$/,
  'goal-create': /^\/goals\/create$/,
  'goal-edit': /^(?:\/__test__\/release\/goal-edit|\/goals\/edit\/\d+)$/,
  'goal-progress': /^\/goals\/progress$/,
  goals: /^\/goals\/$/,
  'log-add': /^\/log\/(?:add|view)$/,
  'log-bulk': /^\/log\/bulk$/,
  'log-edit': /^(?:\/__test__\/release\/log-edit|\/log\/edit\/\d+)$/,
  logbook: /^\/log\/view$/,
  'not-found': /^\/__release_missing_page__$/,
  preferences: /^\/settings\/preferences$/,
  profile: /^\/settings\/profile$/,
  reminders: /^\/settings\/notifications$/,
  'server-error': /^\/__test__\/error\/500$/,
  statistics: /^\/settings\/statistics$/,
});


function isLocator(value) {
  return Boolean(value)
    && typeof value.count === 'function'
    && typeof value.evaluate === 'function';
}


function exactFormPayload(request) {
  const exact = {};
  for (const [key, value] of new URLSearchParams(request.postData() || '')) {
    if (!(key in exact)) exact[key] = value;
    else if (Array.isArray(exact[key])) exact[key].push(value);
    else exact[key] = [exact[key], value];
  }
  return exact;
}


function actionNamePattern(action) {
  const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?: [−+])?$`);
}


function exactRequestPayload(request, kind) {
  if (kind === 'json') return request.postDataJSON();
  if (kind === 'form') return exactFormPayload(request);
  throw new TypeError(`Unknown request payload kind: ${kind}`);
}


function assertExactPayload(expectApi, actual, expected, dynamicFields = {}) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new TypeError('request evidence requires an exact payload object');
  }
  const dynamicKeys = Object.keys(dynamicFields);
  expectApi(Object.keys(actual).sort()).toEqual(
    [...Object.keys(expected), ...dynamicKeys].sort(),
  );
  const stable = { ...actual };
  for (const [field, policy] of Object.entries(dynamicFields)) {
    const value = stable[field];
    if (policy === 'non-empty') expectApi(typeof value).toBe('string');
    if (policy === 'non-empty') expectApi(value.length).toBeGreaterThan(0);
    else if (policy === 'uuid') expectApi(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    else throw new TypeError(`Unknown dynamic payload policy for ${field}: ${policy}`);
    delete stable[field];
  }
  expectApi(stable).toEqual(expected);
}


function createSupportingBehaviorRecorder(owner, expectApi) {
  const expected = SUPPORTING_ACTION_POLICY.filter((entry) => entry.owner === owner);
  const recordedEvidence = new Set();
  const recorderIdentity = Object.freeze({ owner });

  function obligationForOwner(state, action) {
    const obligation = expected.find((entry) => (
      entry.state === state && entry.action === action
    ));
    if (!obligation) {
      const owned = expected.map((entry) => `${entry.state} › ${entry.action}`).join(', ');
      throw new Error(`${owner} owns ${owned}; not ${state} › ${action}`);
    }
    return obligation;
  }

  function requireApplicable(obligation, dimension) {
    if (obligation.dimensions[dimension]?.status !== 'asserted') {
      throw new Error(`${obligation.state} › ${obligation.action} ${dimension} is not asserted`);
    }
  }

  function issueToken(obligation, dimension, artifact = null) {
    requireApplicable(obligation, dimension);
    const token = Object.freeze({});
    supportingEvidenceTokens.set(token, {
      recorderIdentity,
      state: obligation.state,
      action: obligation.action,
      dimension,
      artifact,
    });
    return token;
  }

  function metadataFor(token) {
    const metadata = supportingEvidenceTokens.get(token);
    if (!metadata) throw new Error('forged evidence token');
    if (metadata.recorderIdentity !== recorderIdentity) {
      throw new Error('evidence token belongs to a different recorder');
    }
    return metadata;
  }

  async function assertBoundControl(obligation, page, control) {
    if (!page || typeof page.url !== 'function' || !page.keyboard) {
      throw new TypeError('typed evidence requires a Playwright page');
    }
    if (!isLocator(control)) throw new TypeError('typed evidence requires a Playwright control locator');
    const path = new URL(page.url()).pathname;
    const statePath = STATE_PATHS[obligation.state];
    if (!statePath?.test(path)) {
      throw new Error(
        `${obligation.state} › ${obligation.action} received an artifact from wrong state ${path}`,
      );
    }
    await expectApi(control).toHaveCount(1);
    await expectApi(control).toHaveAccessibleName(actionNamePattern(obligation.action));
  }

  async function assertTypedOutcome(outcome, page) {
    if (!outcome || typeof outcome !== 'object' || typeof outcome.then === 'function') {
      throw new TypeError('keyboard evidence requires a typed keyboard outcome');
    }
    if (outcome.kind === 'response') {
      if (!outcome.pending || typeof outcome.pending.then !== 'function') {
        throw new TypeError('typed response outcome requires a pending Playwright response');
      }
      const response = await outcome.pending;
      if (!response || typeof response.request !== 'function' || typeof response.status !== 'function') {
        throw new TypeError('typed response outcome did not resolve to a Playwright response');
      }
      expectApi(response.request().method()).toBe(outcome.method);
      expectApi(new URL(response.url()).pathname).toMatch(outcome.path);
      if (outcome.search !== undefined) {
        expectApi(new URL(response.url()).search).toBe(outcome.search);
      }
      if (outcome.status !== undefined) expectApi(response.status()).toBe(outcome.status);
      if (response.request().isNavigationRequest() && outcome.settleNavigation !== false) {
        await response.finished();
        await page.waitForLoadState('load');
      }
      return response;
    }
    if (outcome.kind === 'url') {
      if (!(outcome.path instanceof RegExp)) throw new TypeError('typed URL outcome requires a path RegExp');
      await expectApi.poll(() => new URL(page.url()).pathname).toMatch(outcome.path);
      return null;
    }
    if (!isLocator(outcome.locator)) {
      throw new TypeError('typed locator outcome requires a Playwright locator');
    }
    if (outcome.kind === 'focused') await expectApi(outcome.locator).toBeFocused();
    else if (outcome.kind === 'visible') await expectApi(outcome.locator).toBeVisible();
    else if (outcome.kind === 'hidden') await expectApi(outcome.locator).toBeHidden();
    else if (outcome.kind === 'checked') {
      if (outcome.checked) await expectApi(outcome.locator).toBeChecked();
      else await expectApi(outcome.locator).not.toBeChecked();
    } else if (outcome.kind === 'disabled') {
      if (outcome.disabled) await expectApi(outcome.locator).toBeDisabled();
      else await expectApi(outcome.locator).toBeEnabled();
    } else if (outcome.kind === 'attribute') {
      if (typeof outcome.name !== 'string') {
        throw new TypeError('typed attribute outcome requires an attribute name');
      }
      if (outcome.value === null) {
        await expectApi(outcome.locator).not.toHaveAttribute(outcome.name);
      } else {
        await expectApi(outcome.locator).toHaveAttribute(outcome.name, outcome.value);
      }
    } else throw new TypeError(`Unknown typed keyboard outcome: ${outcome.kind}`);
    return null;
  }

  function validateTypedOutcomeShape(outcome) {
    if (!outcome || typeof outcome !== 'object' || typeof outcome.then === 'function') {
      throw new TypeError('keyboard evidence requires a typed keyboard outcome');
    }
    if (outcome.kind === 'response') {
      if (!outcome.pending || typeof outcome.pending.then !== 'function'
        || typeof outcome.method !== 'string' || !(outcome.path instanceof RegExp)) {
        throw new TypeError('typed response outcome requires pending response, method, and path');
      }
      if (outcome.settleNavigation !== undefined
        && typeof outcome.settleNavigation !== 'boolean') {
        throw new TypeError('typed response settleNavigation must be boolean');
      }
      return;
    }
    if (outcome.kind === 'url') {
      if (!(outcome.path instanceof RegExp)) {
        throw new TypeError('typed URL outcome requires a path RegExp');
      }
      return;
    }
    if (!['focused', 'visible', 'hidden', 'checked', 'disabled', 'attribute'].includes(outcome.kind)
      || !isLocator(outcome.locator)) {
      throw new TypeError('typed locator outcome requires a Playwright locator');
    }
  }

  function forAction(state, action, { page, control } = {}) {
    const obligation = obligationForOwner(state, action);
    let controlBound = false;
    async function ensureControlBound() {
      if (controlBound) return;
      await assertBoundControl(obligation, page, control);
      controlBound = true;
    }
    return Object.freeze({
      async keyboard({ key, outcome } = {}) {
        requireApplicable(obligation, 'keyboard');
        if (typeof key !== 'string' || !key) {
          throw new TypeError('keyboard evidence requires an exact key');
        }
        validateTypedOutcomeShape(outcome);
        await ensureControlBound();
        await control.focus();
        await expectApi(control).toBeFocused();
        await page.keyboard.press(key);
        const artifact = await assertTypedOutcome(outcome, page);
        return issueToken(obligation, 'keyboard', artifact);
      },
      async focus({ locator } = {}) {
        requireApplicable(obligation, 'focus');
        if (!isLocator(locator)) throw new TypeError('focus evidence requires a focus locator');
        await expectApi(locator).toHaveCount(1);
        await expectApi(locator).toBeFocused();
        const focusable = await locator.evaluate((element) => (
          element === element.ownerDocument.activeElement
          && (element.tabIndex >= -1 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName))
        ));
        expectApi(focusable).toBe(true);
        return issueToken(obligation, 'focus');
      },
      async loading({ disabled, text, status } = {}) {
        requireApplicable(obligation, 'loading');
        if (typeof disabled !== 'boolean') {
          throw new TypeError('loading evidence requires an exact disabled state');
        }
        await ensureControlBound();
        if (disabled) await expectApi(control).toBeDisabled();
        else await expectApi(control).toBeEnabled();
        if (text !== undefined) await expectApi(control).toHaveText(text);
        if (status) {
          if (!isLocator(status.locator) || typeof status.text !== 'string') {
            throw new TypeError('loading status requires a locator and exact text');
          }
          expectApi(await status.locator.getAttribute('role')).toBe('status');
          await expectApi(status.locator).toHaveText(status.text);
        }
        return issueToken(obligation, 'loading');
      },
      async feedback({ locator, text, validationMessage } = {}) {
        requireApplicable(obligation, 'feedback');
        if (!isLocator(locator)) throw new TypeError('feedback evidence requires a locator');
        if (typeof text !== 'string' && typeof validationMessage !== 'string') {
          throw new TypeError('feedback evidence requires exact text or native validation');
        }
        const semantics = await locator.evaluate((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
          validationMessage: element.validationMessage,
        }));
        if (!['status', 'alert'].includes(semantics.role) && !semantics.live && !validationMessage) {
          throw new Error('feedback locator must be a status, alert, or native validation control');
        }
        if (text !== undefined) await expectApi(locator).toHaveText(text);
        if (validationMessage !== undefined) {
          await expectApi(locator).toHaveJSProperty('validationMessage', validationMessage);
        }
        return issueToken(obligation, 'feedback');
      },
      async error({ locator, text, validationMessage, state, count } = {}) {
        requireApplicable(obligation, 'error');
        if (!isLocator(locator)) throw new TypeError('error evidence requires a locator');
        if (Number.isInteger(count)) {
          await expectApi(locator).toHaveCount(count);
          return issueToken(obligation, 'error');
        }
        if (typeof text !== 'string' && typeof validationMessage !== 'string') {
          throw new TypeError('error evidence requires exact text or native validation');
        }
        const semantics = await locator.evaluate((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
          invalid: element.getAttribute('aria-invalid'),
          validationMessage: element.validationMessage,
        }));
        if (!['status', 'alert'].includes(semantics.role) && !semantics.live
          && semantics.invalid !== 'true' && !validationMessage) {
          throw new Error('error locator must expose an alert, status, invalid state, or validation');
        }
        if (text !== undefined) await expectApi(locator).toHaveText(text);
        if (validationMessage !== undefined) {
          await expectApi(locator).toHaveJSProperty('validationMessage', validationMessage);
        }
        if (state) await expectApi(locator).toHaveAttribute('data-state', state);
        return issueToken(obligation, 'error');
      },
      async request({
        activation, method, path, search, status, payload, dynamicFields = {},
      } = {}) {
        requireApplicable(obligation, 'request');
        const activationMetadata = metadataFor(activation);
        if (activationMetadata.state !== state || activationMetadata.action !== action
          || activationMetadata.dimension !== 'keyboard') {
          throw new Error('request evidence received a wrong state/action activation artifact');
        }
        const response = activationMetadata.artifact;
        if (!response || typeof response.request !== 'function') {
          throw new Error('request evidence requires a keyboard-bound Playwright response');
        }
        const request = response.request();
        expectApi(request.method()).toBe(method);
        expectApi(new URL(response.url()).pathname).toMatch(path);
        if (search !== undefined) expectApi(new URL(response.url()).search).toBe(search);
        expectApi(response.status()).toBe(status);
        if (method === 'GET') expectApi(request.postData()).toBeNull();
        else {
          if (!payload?.kind) throw new TypeError('mutating request evidence requires exact payload');
          assertExactPayload(
            expectApi,
            exactRequestPayload(request, payload.kind),
            payload.exact,
            dynamicFields,
          );
        }
        return issueToken(obligation, 'request');
      },
      async persistence({ locator, count, text, value, checked, snapshot } = {}) {
        requireApplicable(obligation, 'persistence');
        if (snapshot) {
          if (!snapshot.actual || !snapshot.expected
            || typeof snapshot.actual !== 'object' || typeof snapshot.expected !== 'object') {
            throw new TypeError('persistence snapshot requires exact object/array actual and expected');
          }
          expectApi(snapshot.actual).toEqual(snapshot.expected);
        } else {
          if (!isLocator(locator)) throw new TypeError('persistence evidence requires a locator');
          const assertions = [count, text, value, checked].filter((item) => item !== undefined);
          if (assertions.length !== 1) {
            throw new TypeError('persistence locator requires exactly one typed expected state');
          }
          if (count !== undefined) await expectApi(locator).toHaveCount(count);
          if (text !== undefined) await expectApi(locator).toHaveText(text);
          if (value !== undefined) await expectApi(locator).toHaveValue(value);
          if (checked !== undefined) {
            if (checked) await expectApi(locator).toBeChecked();
            else await expectApi(locator).not.toBeChecked();
          }
        }
        return issueToken(obligation, 'persistence');
      },
    });
  }

  return Object.freeze({
    accept(token) {
      const metadata = metadataFor(token);
      recordedEvidence.add(evidenceToken(
        metadata.state, metadata.action, metadata.dimension,
      ));
    },
    forAction,
    assertComplete() {
      const expectedEvidence = expected.flatMap((obligation) => (
        assertedDimensions(obligation).map((dimension) => evidenceToken(
          obligation.state, obligation.action, dimension,
        ))
      ));
      expectApi(
        [...recordedEvidence].sort(),
        `${owner} supporting runtime dimension evidence`,
      ).toEqual(expectedEvidence.sort());
    },
  });
}


function validateSupportingCoverage(expectedActions, coveredBy) {
  for (const state of SUPPORTING_ACTION_STATES) {
    const actions = expectedActions[state];
    if (!actions) throw new Error(`${state} supporting action inventory is missing`);
    const policies = SUPPORTING_ACTION_POLICY.filter((entry) => entry.state === state);
    const obligationActions = policies.map(({ action }) => action).sort();
    if (JSON.stringify(obligationActions) !== JSON.stringify([...actions].sort())) {
      throw new Error(`${state} independent supporting obligations differ from action inventory`);
    }
    const stateCoverage = coveredBy[state] || {};
    for (const policy of policies) {
      const obligation = supportingObligationFor(state, policy.action);
      if (!obligation) throw new Error(`${state} › ${policy.action} missing runtime obligation`);
      if (obligation.owner !== policy.owner || obligation.profile !== policy.profile) {
        throw new Error(`${state} › ${policy.action} contract differs from independent policy`);
      }
      for (const dimension of DIMENSIONS) {
        if (obligation.dimensions[dimension].status !== policy.dimensions[dimension].status) {
          throw new Error(
            `${state} › ${policy.action} ${dimension} applicability differs from independent policy`,
          );
        }
      }
      const receipt = stateCoverage[policy.action];
      if (!receipt) throw new Error(`${state} › ${policy.action} missing supporting receipt`);
      if (receipt.test !== policy.owner) {
        throw new Error(`${state} › ${policy.action} supporting owner mismatch`);
      }
      for (const dimension of DIMENSIONS) {
        if (receipt.dimensions[dimension].status !== policy.dimensions[dimension].status) {
          throw new Error(`${state} › ${policy.action} supporting dimension evidence mismatch`);
        }
      }
    }
  }
  return true;
}


module.exports = {
  SUPPORTING_ACTION_STATES,
  SUPPORTING_ACTION_POLICY,
  SUPPORTING_BEHAVIOR_OBLIGATIONS,
  SUPPORTING_OWNER_TITLES,
  assertedDimensions,
  createSupportingBehaviorRecorder,
  supportingObligationFor,
  validateSupportingCoverage,
};
