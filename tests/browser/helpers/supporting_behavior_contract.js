const { DIMENSIONS: CORE_DIMENSIONS } = require('./core_behavior_contract');
const {
  SUPPORTING_ACTION_BASELINES,
  SUPPORTING_BASELINE_STATES,
} = require('./supporting_action_baseline');
const {
  STATE_SCENARIOS,
  resolvedSupportingControlAuthority,
  supportingControlAuthority,
  supportingScenarioFor,
} = require('./supporting_action_scenarios');


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
    persistence: ['not-applicable', 'the draft control is persisted only by a separate Save action'],
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
    focus: ['asserted', 'the exact invalid server-rendered field receives focus'],
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
  rangeNavigation: {
    error: ['not-applicable', 'the validated preset has no managed error branch'],
    feedback: ['not-applicable', 'the exact selected range document is the direct outcome'],
    focus: ['not-applicable', 'full-page range navigation has no managed focus promise'],
    keyboard: ['asserted', 'the exact visible range link is activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['asserted', 'the resulting document exposes the exact selected day count'],
    request: ['asserted', 'the transaction captures the exact preset GET and empty body'],
  },
});


function materializeDimensions(profileName, state, action) {
  const profile = PROFILE_EVIDENCE[profileName];
  if (!profile) throw new Error(`Unknown supporting evidence profile: ${profileName}`);
  return Object.freeze(Object.fromEntries(DIMENSIONS.map((dimension) => {
    const [status] = profile[dimension];
    return [dimension, Object.freeze({
      status,
      reason: `${state} › ${action}: ${profileName} marks ${dimension} ${status}.`,
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
    [state, '7 days', 'rangeNavigation'],
    [state, '30 days', 'rangeNavigation'],
    [state, '90 days', 'rangeNavigation'],
    [state, '1 year', 'rangeNavigation'],
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


const supportingTransactionReceipts = new WeakMap();
let supportingPageMarkerSequence = 0;
let supportingFeedbackMarkerSequence = 0;


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
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...Object.keys(expected), ...dynamicKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `catalog request payload keys differ: expected ${expectedKeys.join(',')}; received ${actualKeys.join(',')}`,
    );
  }
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
  try {
    expectApi(stable).toEqual(expected);
  } catch (error) {
    throw new Error(`catalog request payload values differ: ${error.message}`);
  }
}


function createSupportingBehaviorRecorder(owner, expectApi) {
  const expected = SUPPORTING_BEHAVIOR_OBLIGATIONS.filter((entry) => entry.owner === owner);
  const recordedEvidence = new Set();
  const recorderIdentity = Object.freeze({ owner });
  const boundStatePrincipals = new Map();

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

  function issueTransactionReceipt(obligation, transactionIdentity, page, control, dimensions) {
    const receipt = Object.freeze({});
    supportingTransactionReceipts.set(receipt, {
      recorderIdentity,
      transactionIdentity,
      page,
      control,
      state: obligation.state,
      action: obligation.action,
      dimensions: Object.freeze([...dimensions]),
      consumed: false,
    });
    return receipt;
  }

  async function assertBoundControl(
    obligation, page, control, authority, checkRuntimePrecondition = true,
  ) {
    if (!page || typeof page.url !== 'function' || !page.keyboard) {
      throw new TypeError('typed evidence requires a Playwright page');
    }
    if (!isLocator(control)) throw new TypeError('typed evidence requires a Playwright control locator');
    const path = new URL(page.url()).pathname;
    const stateScenario = STATE_SCENARIOS[obligation.state];
    if (!stateScenario?.path?.test(path)) {
      throw new Error(
        `${obligation.state} › ${obligation.action} received an artifact from wrong state ${path}`,
      );
    }
    const search = new URL(page.url()).search;
    if (!stateScenario.queries?.includes(search)) {
      throw new Error(
        `${obligation.state} › ${obligation.action} authoritative state query differs: ${search}`,
      );
    }
    if (!stateScenario.marker) {
      throw new Error(`${obligation.state} has no authoritative state marker`);
    }
    const stateMarker = page.getByRole('heading', {
      name: stateScenario.marker,
      level: 1,
      exact: typeof stateScenario.marker === 'string',
    });
    if (await stateMarker.count() !== 1 || !await stateMarker.isVisible()) {
      throw new Error(
        `${obligation.state} › ${obligation.action} has no visible authoritative state marker`,
      );
    }
    const runtimeResponse = await page.request.get('/__test__/supporting-state-snapshot');
    expectApi(runtimeResponse.status()).toBe(200);
    const runtimeState = await runtimeResponse.json();
    if (runtimeState.invariant !== stateScenario.invariant) {
      throw new Error(
        `${obligation.state} › ${obligation.action} authoritative state invariant differs`,
      );
    }
    if (checkRuntimePrecondition) {
      for (const [name, value] of Object.entries(stateScenario.precondition.runtime || {})) {
        const runtimeName = { offlineQueueEnabled: 'offline_queue_enabled' }[name] || name;
        if (runtimeState[runtimeName] !== value) {
          throw new Error(
            `${obligation.state} › ${obligation.action} runtime precondition ${name} differs`,
          );
        }
      }
    }
    const identityResponse = await page.request.get('/__test__/account-snapshot', {
      maxRedirects: 0,
    });
    const expectedIdentity = stateScenario.identity;
    if (expectedIdentity === undefined) {
      throw new Error(`${obligation.state} has no authoritative state identity`);
    }
    if (identityResponse.status() !== stateScenario.precondition.identityStatus) {
      if (expectedIdentity === null) {
        throw new Error(`${obligation.state} authoritative anonymous principal differs`);
      }
      throw new Error(`${obligation.state} authoritative identity status differs`);
    }
    if (expectedIdentity === null) {
      if (runtimeState.authenticated || runtimeState.principal !== null) {
        throw new Error(`${obligation.state} authoritative anonymous principal differs`);
      }
    } else {
      const identityProfile = (await identityResponse.json()).profile;
      const identity = identityProfile.email;
      if (!runtimeState.authenticated || runtimeState.principal !== identity) {
        throw new Error(`${obligation.state} authoritative runtime principal differs`);
      }
      if (expectedIdentity instanceof RegExp) {
        if (!expectedIdentity.test(identity)) {
          throw new Error(`${obligation.state} authoritative state principal differs`);
        }
        if (!boundStatePrincipals.has(obligation.state)) {
          boundStatePrincipals.set(obligation.state, identityProfile.id);
        }
        expectApi(identityProfile.id).toBe(boundStatePrincipals.get(obligation.state));
      } else if (identity !== expectedIdentity) {
        throw new Error(`${obligation.state} authoritative state principal differs`);
      }
    }
    await expectApi(control).toHaveCount(1);
    await expectApi(control).toHaveAccessibleName(actionNamePattern(obligation.action));
    if (!authority?.scope?.selector || !authority.role || !authority.name) {
      throw new Error(`${obligation.state} › ${obligation.action} has no catalog control contract`);
    }
    const scope = page.locator(
      authority.scope.selector,
      authority.scope.hasText ? { hasText: authority.scope.hasText } : undefined,
    );
    const catalogControl = authority.role === 'summary'
      ? scope.locator('summary').filter({ hasText: authority.name })
      : scope.getByRole(authority.role, { name: authority.name, exact: true });
    await expectApi(catalogControl).toHaveCount(1);
    if (!authority.selector) {
      throw new Error(`${obligation.state} › ${obligation.action} has no catalog control selector`);
    }
    const selectorControl = scope.locator(authority.selector);
    const selectorCount = await selectorControl.count();
    if (selectorCount !== 1) {
      throw new Error(
        `${obligation.state} › ${obligation.action} catalog control selector resolved ${selectorCount} elements`,
      );
    }
    const selectorHandle = await selectorControl.elementHandle();
    const selectorMatchesCatalog = await catalogControl.evaluate(
      (element, selected) => element === selected, selectorHandle,
    );
    const selectorMatchesControl = await control.evaluate(
      (element, selected) => element === selected, selectorHandle,
    );
    if (!selectorMatchesCatalog || !selectorMatchesControl) {
      throw new Error('typed evidence did not bind the unique catalog control selector');
    }
    const matchesCatalogControl = await control.evaluate(
      (element, expected) => element === expected,
      await catalogControl.elementHandle(),
    );
    if (!matchesCatalogControl) {
      throw new Error('typed evidence did not bind the catalog control contract');
    }
    for (const [name, value] of Object.entries(authority.attributes || {})) {
      if (name === 'href' && String(value).startsWith('fixture:')) continue;
      const actual = await control.getAttribute(name);
      if (actual !== value) {
        throw new Error(
          `catalog control contract ${name} expected ${value}; received ${actual}`,
        );
      }
    }
    if (authority.form) {
      const actualForm = await control.evaluate((element) => {
        const form = element.form || element.closest('form');
        if (!form) return null;
        const url = new URL(form.getAttribute('action') || location.href, location.href);
        return { method: (form.getAttribute('method') || 'get').toLowerCase(), path: url.pathname };
      });
      if (!actualForm
        || actualForm.method !== authority.form.method
        || actualForm.path !== authority.form.action) {
        throw new Error('catalog control contract form method or action differs');
      }
      for (const [name, value] of Object.entries(authority.form.fields || {})) {
        const fields = control.locator('xpath=ancestor::form[1]').locator(
          `input[type="hidden"][name="${name}"]`,
        );
        await expectApi(fields).toHaveCount(1);
        await expectApi(fields).toHaveAttribute('value', value);
      }
    }
    if (obligation.profile === 'rangeNavigation') {
      const expectedBefore = {
        '7 days': '30', '30 days': '7', '90 days': '30', '1 year': '90',
      }[obligation.action];
      const marker = page.locator('[data-dashboard-range-days]');
      const actualBefore = await marker.getAttribute('data-dashboard-range-days');
      if (actualBefore !== expectedBefore) {
        throw new Error(
          `${obligation.state} › ${obligation.action} catalog precondition expected ${expectedBefore}; received ${actualBefore}`,
        );
      }
    }
    const pageMarker = `supporting-evidence-page-${++supportingPageMarkerSequence}`;
    await page.evaluate((marker) => {
      document.documentElement.dataset.supportingEvidencePage = marker;
    }, pageMarker);
    const controlPageMarker = await control.evaluate((element) => (
      element.ownerDocument.documentElement.dataset.supportingEvidencePage || null
    ));
    if (controlPageMarker !== pageMarker) {
      throw new Error('typed evidence control belongs to a different page');
    }
    const semanticRole = await control.evaluate((element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      if (element.tagName === 'A' && element.hasAttribute('href')) return 'link';
      if (element.tagName === 'BUTTON') return 'button';
      if (element.tagName === 'SUMMARY') return 'summary';
      if (element.tagName === 'INPUT' && element.type === 'checkbox') return 'checkbox';
      if (element.tagName === 'INPUT' && ['submit', 'button'].includes(element.type)) return 'button';
      return null;
    });
    if (!semanticRole) throw new Error('authoritative control must expose an interactive role');
    const controlHasBoundary = await control.evaluate((element) => Boolean(
      element.closest('nav, header, main, form, [role="dialog"], dialog, section, article'),
    ));
    if (!controlHasBoundary && obligation.action !== 'Skip to main content') {
      throw new Error('authoritative control must belong to an exact interaction landmark');
    }
    const authoritativeControl = semanticRole === 'summary'
      ? page.locator('summary').filter({ hasText: actionNamePattern(obligation.action) })
      : page.getByRole(semanticRole, { name: actionNamePattern(obligation.action) });
    const visibleCandidates = [];
    for (let index = 0; index < await authoritativeControl.count(); index += 1) {
      const candidate = authoritativeControl.nth(index);
      if (!await candidate.isVisible()) continue;
      const sameBoundary = await control.evaluate((element, possibleMatch) => {
        const boundary = (node) => node.closest(
          'nav, header, main, form, [role="dialog"], dialog, section, article',
        );
        return boundary(element) === boundary(possibleMatch);
      }, await candidate.elementHandle());
      if (sameBoundary) visibleCandidates.push(candidate);
    }
    expectApi(visibleCandidates).toHaveLength(1);
    const sameControl = await control.evaluate((element, candidate) => element === candidate,
      await visibleCandidates[0].elementHandle());
    if (!sameControl) throw new Error('typed evidence did not bind the authoritative unique control');
  }

  function validateActivation(activation) {
    if (!activation || typeof activation !== 'object') {
      throw new TypeError('transaction requires a typed activation');
    }
    if (activation.kind === 'keyboard') {
      if (typeof activation.key !== 'string' || !activation.key) {
        throw new TypeError('keyboard transaction requires an exact key');
      }
      return;
    }
    if (activation.kind === 'click') return;
    throw new TypeError(`unknown transaction activation: ${activation.kind}`);
  }

  function validateRequestDescriptor(request) {
    if (!request) return;
    if (typeof request.method !== 'string' || !(request.path instanceof RegExp)) {
      throw new TypeError('transaction request requires exact method and path');
    }
    if (request.status !== undefined && !Number.isInteger(request.status)) {
      throw new TypeError('transaction request status must be an integer');
    }
  }

  function validatePersistenceDescriptor(persistence) {
    if (!persistence) return;
    if (!['locator', 'json'].includes(persistence.kind)) {
      throw new TypeError('transaction requires a typed persistence descriptor');
    }
    if (persistence.kind === 'locator') {
      if (!isLocator(persistence.locator)
        || !['count', 'text', 'value', 'checked', 'attribute'].includes(persistence.property)
        || persistence.expectedAfter === undefined) {
        throw new TypeError('typed persistence locator requires property and expectedAfter');
      }
      if (persistence.property === 'attribute' && typeof persistence.name !== 'string') {
        throw new TypeError('typed persistence attribute requires a name');
      }
    } else if (typeof persistence.url !== 'string' || persistence.expectedAfter === undefined) {
      throw new TypeError('typed persistence JSON requires URL and expectedAfter');
    }
  }

  async function captureFeedbackState(locator, descriptor, page) {
    if (!isLocator(locator)) throw new TypeError('causal feedback/error requires a locator');
    let preexistingMatchMarker = null;
    if (descriptor && page && (
      descriptor.text !== undefined
      || descriptor.validationMessage !== undefined
      || descriptor.state !== undefined
    )) {
      preexistingMatchMarker = `supporting-feedback-${++supportingFeedbackMarkerSequence}`;
      await page.locator('body *').evaluateAll((elements, expected) => {
        for (const element of elements) {
          const exactMatch = (
            (expected.text === undefined || element.textContent === expected.text)
            && (expected.validationMessage === undefined || (
              element.validationMessage === expected.validationMessage
              && element.matches(':user-invalid')
            ))
            && (expected.state === undefined
              || element.getAttribute('data-state') === expected.state)
          );
          if (exactMatch) {
            Object.defineProperty(element, '__supportingPreexistingFeedback', {
              configurable: true,
              value: expected.marker,
            });
          }
        }
      }, {
        marker: preexistingMatchMarker,
        text: descriptor.text,
        validationMessage: descriptor.validationMessage,
        state: descriptor.state,
      });
    }
    const count = await locator.count();
    if (count === 0) return { count: 0, values: [], preexistingMatchMarker };
    const values = await locator.evaluateAll((elements) => elements.map((element) => ({
      text: element.textContent,
      role: element.getAttribute('role'),
      live: element.getAttribute('aria-live'),
      invalid: element.getAttribute('aria-invalid'),
      state: element.getAttribute('data-state'),
      validationMessage: element.validationMessage || '',
      userInvalid: element.matches(':user-invalid'),
    })));
    return { count, values, preexistingMatchMarker };
  }

  function feedbackStateAlreadyMatches(before, descriptor) {
    return before.values.some((value) => (
      (descriptor.text === undefined || value.text === descriptor.text)
      && (descriptor.validationMessage === undefined
        || (value.validationMessage === descriptor.validationMessage && value.userInvalid))
      && (descriptor.state === undefined || value.state === descriptor.state)
    ));
  }

  async function assertCausalFeedback(kind, descriptor, before, control) {
    if (!descriptor || !isLocator(descriptor.locator)) {
      throw new TypeError(`causal ${kind} requires a typed locator descriptor`);
    }
    if (descriptor.text === undefined && descriptor.validationMessage === undefined
      && descriptor.count === undefined) {
      throw new TypeError(`causal ${kind} requires exact text, validation, or count`);
    }
    if (feedbackStateAlreadyMatches(before, descriptor)) {
      throw new Error(`${kind} already existed before activation`);
    }
    if (descriptor.count !== undefined) {
      await expectApi(descriptor.locator).toHaveCount(descriptor.count);
      return;
    }
    await expectApi(descriptor.locator).toHaveCount(1);
    if (before.preexistingMatchMarker && await descriptor.locator.evaluate(
      (element, marker) => element.__supportingPreexistingFeedback === marker,
      before.preexistingMatchMarker,
    )) {
      throw new Error(`${kind} reused a pre-existing identity not caused by activation`);
    }
    const semantics = await descriptor.locator.evaluate((element) => ({
      role: element.getAttribute('role'),
      live: element.getAttribute('aria-live'),
      invalid: element.getAttribute('aria-invalid'),
    }));
    if (kind === 'feedback'
      && !['status', 'alert'].includes(semantics.role) && !semantics.live
      && descriptor.validationMessage === undefined) {
      throw new Error('feedback locator must be a status, alert, or native validation control');
    }
    if (kind === 'error'
      && !['status', 'alert'].includes(semantics.role) && !semantics.live
      && semantics.invalid !== 'true' && descriptor.validationMessage === undefined) {
      throw new Error('error locator must expose an alert, status, invalid state, or validation');
    }
    if (descriptor.text !== undefined) await expectApi(descriptor.locator).toHaveText(descriptor.text);
    if (descriptor.validationMessage !== undefined) {
      await expectApi(descriptor.locator).toHaveJSProperty(
        'validationMessage', descriptor.validationMessage,
      );
      expectApi(await descriptor.locator.evaluate((element) => (
        element.matches(':user-invalid')
      ))).toBe(true);
    }
    if (descriptor.state !== undefined) {
      await expectApi(descriptor.locator).toHaveAttribute('data-state', descriptor.state);
    }
    let ownedArtifact;
    if (descriptor.ownership?.kind === 'quick-notification') {
      ownedArtifact = await descriptor.locator.evaluate((element, type) => (
        element.closest('[data-notification-type]')?.getAttribute('data-notification-type') === type
      ), descriptor.ownership.type);
      ownedArtifact = ownedArtifact && await control.evaluate((element) => (
        element.hasAttribute('data-quick-add')
      ));
    } else if (descriptor.ownership?.kind === 'container') {
      const owner = descriptor.ownership.locator;
      if (!isLocator(owner)) throw new TypeError(`${kind} container ownership requires a locator`);
      await expectApi(owner).toHaveCount(1);
      ownedArtifact = await owner.evaluate((element, artifact) => element.contains(artifact),
        await descriptor.locator.elementHandle());
    } else if (descriptor.ownership?.kind === 'field') {
      ownedArtifact = await descriptor.locator.evaluate((element) => (
        element.matches('input, select, textarea') && Boolean(element.closest('form'))
      ));
    } else {
      throw new Error(`${kind} has no catalog-owned artifact relationship`);
    }
    if (!ownedArtifact) {
      throw new Error(`${kind} is not an authoritative action-owned artifact`);
    }
  }

  async function assertDismissedDialogError(descriptor, beforeCount) {
    if (!isLocator(descriptor.locator) || !Number.isInteger(descriptor.count)) {
      throw new TypeError('dismissed-dialog error requires an exact locator count');
    }
    expectApi(beforeCount).toBe(descriptor.count);
    await expectApi(descriptor.locator).toHaveCount(descriptor.count);
  }

  async function captureLocatorPersistence(descriptor) {
    if (descriptor.property === 'count') return descriptor.locator.count();
    if (descriptor.property === 'text') return descriptor.locator.allTextContents();
    if (descriptor.property === 'value') return descriptor.locator.inputValue();
    if (descriptor.property === 'checked') return descriptor.locator.isChecked();
    return descriptor.locator.getAttribute(descriptor.name);
  }

  function selectJsonPath(value, path) {
    if (path === undefined) return value;
    const segments = Array.isArray(path) ? path : String(path).split('.');
    return segments.reduce((current, segment) => current?.[segment], value);
  }

  async function capturePersistence(page, descriptor) {
    if (descriptor.kind === 'locator') return captureLocatorPersistence(descriptor);
    const response = await page.request.get(descriptor.url);
    expectApi(response.status()).toBe(descriptor.status || 200);
    return selectJsonPath(await response.json(), descriptor.path);
  }

  async function waitForPersistenceAfter(descriptor) {
    if (descriptor.kind !== 'locator') return;
    if (descriptor.property === 'count') {
      await expectApi(descriptor.locator).toHaveCount(descriptor.expectedAfter);
    } else if (descriptor.property === 'text') {
      await expectApi(descriptor.locator).toHaveText(descriptor.expectedAfter);
    } else if (descriptor.property === 'value') {
      await expectApi(descriptor.locator).toHaveValue(descriptor.expectedAfter);
    } else if (descriptor.property === 'checked') {
      if (descriptor.expectedAfter) await expectApi(descriptor.locator).toBeChecked();
      else await expectApi(descriptor.locator).not.toBeChecked();
    } else if (descriptor.expectedAfter === null) {
      await expectApi(descriptor.locator).not.toHaveAttribute(descriptor.name);
    } else {
      await expectApi(descriptor.locator).toHaveAttribute(
        descriptor.name, descriptor.expectedAfter,
      );
    }
  }

  async function assertTransactionRequest(response, descriptor) {
    const request = response.request();
    expectApi(request.method()).toBe(descriptor.method);
    expectApi(new URL(response.url()).pathname).toMatch(descriptor.path);
    if (descriptor.search !== undefined) expectApi(new URL(response.url()).search).toBe(descriptor.search);
    if (descriptor.status !== undefined) expectApi(response.status()).toBe(descriptor.status);
    if (descriptor.responseInvariant !== undefined) {
      const actualInvariant = await response.headerValue('x-supporting-action-invariant');
      if (actualInvariant !== descriptor.responseInvariant) {
        throw new Error(
          `server action invariant expected ${descriptor.responseInvariant}; received ${actualInvariant}`,
        );
      }
    }
    if (descriptor.method === 'GET') expectApi(request.postData()).toBeNull();
    else if (descriptor.payload) {
      assertExactPayload(
        expectApi,
        exactRequestPayload(request, descriptor.payload.kind),
        descriptor.payload.exact,
        descriptor.dynamicFields || {},
      );
    }
  }

  async function assertTransactionOutcome(outcome) {
    if (!outcome) return;
    if (!isLocator(outcome.locator)) {
      throw new TypeError('transaction outcome requires a typed locator');
    }
    if (outcome.kind === 'visible') await expectApi(outcome.locator).toBeVisible();
    else if (outcome.kind === 'hidden') await expectApi(outcome.locator).toBeHidden();
    else if (outcome.kind === 'count') await expectApi(outcome.locator).toHaveCount(outcome.count);
    else if (outcome.kind === 'checked') {
      if (outcome.checked) await expectApi(outcome.locator).toBeChecked();
      else await expectApi(outcome.locator).not.toBeChecked();
    } else if (outcome.kind === 'attribute') {
      if (outcome.value === null) await expectApi(outcome.locator).not.toHaveAttribute(outcome.name);
      else await expectApi(outcome.locator).toHaveAttribute(outcome.name, outcome.value);
    } else throw new TypeError(`unknown transaction outcome: ${outcome.kind}`);
  }

  function createCatalogBranchTransaction(
    state, action, page, control, authority, checkRuntimePrecondition,
  ) {
    const obligation = obligationForOwner(state, action);
    const transactionIdentity = { state, action, dimensions: new Set() };
    let controlBound = false;
    async function ensureControlBound() {
      if (controlBound) return;
      await assertBoundControl(
        obligation, page, control, authority, checkRuntimePrecondition,
      );
      controlBound = true;
    }
    return Object.freeze({
      async run({
        activation, request, loading, feedback, error, focus, persistence, outcome, dialog,
      } = {}) {
        validateActivation(activation);
        validateRequestDescriptor(request);
        validatePersistenceDescriptor(persistence);
        if (activation.kind !== 'keyboard') {
          throw new TypeError('supporting keyboard evidence requires transaction-owned keyboard activation');
        }
        requireApplicable(obligation, 'keyboard');
        for (const [dimension, descriptor] of Object.entries({
          request, loading, feedback, error, focus, persistence,
        })) {
          if (descriptor) requireApplicable(obligation, dimension);
        }
        if (focus && !['retained', 'moved'].includes(focus.mode)) {
          throw new TypeError('causal focus requires retained or moved mode');
        }
        if (focus?.mode === 'moved' && !isLocator(focus.locator)) {
          throw new TypeError('moved focus requires an exact target locator');
        }
        if (focus?.mode === 'retained' && focus.locator) {
          throw new TypeError('retained focus is bound to the initiating control');
        }
        if (dialog && !['accept', 'dismiss'].includes(dialog)) {
          throw new TypeError('transaction dialog must be accept or dismiss');
        }

        await ensureControlBound();
        const beforeFeedback = feedback
          ? await captureFeedbackState(feedback.locator, feedback, page) : null;
        const beforeError = error?.kind === 'dismissed-dialog'
          ? await error.locator.count()
          : (error ? await captureFeedbackState(error.locator, error, page) : null);
        const beforeLoadingStatus = loading?.status
          ? await captureFeedbackState(loading.status.locator, loading.status, page) : null;
        if (feedback && feedbackStateAlreadyMatches(beforeFeedback, feedback)) {
          throw new Error('feedback already existed before activation');
        }
        if (error && error.kind !== 'dismissed-dialog'
          && feedbackStateAlreadyMatches(beforeError, error)) {
          throw new Error('error already existed before activation');
        }
        const focusTarget = focus?.mode === 'retained' ? control : focus?.locator;
        if (focus?.mode === 'moved') {
          const ownedFocus = await control.evaluate((element, target) => {
            if (target.id === 'main-content') return true;
            const boundary = (node) => node.closest('form, section, article, main');
            if (boundary(element) === boundary(target)) return true;
            const controlledDialog = target.closest('[role="dialog"], dialog');
            if (controlledDialog?.id
              && element.getAttribute('aria-controls') === controlledDialog.id) return true;
            const sourceDialog = element.closest('[role="dialog"], dialog');
            return Boolean(
              sourceDialog?.id && target.getAttribute('aria-controls') === sourceDialog.id,
            );
          }, await focusTarget.elementHandle());
          if (!ownedFocus) throw new Error('focus target is not owned by the authoritative action');
        }
        const beforePersistence = persistence
          ? await capturePersistence(page, persistence) : undefined;
        if (persistence?.expectedBefore !== undefined) {
          expectApi(beforePersistence).toEqual(persistence.expectedBefore);
        }
        if (persistence && persistence.expectedBefore === undefined) {
          throw new Error('authoritative persistence requires exact expectedBefore');
        }
        if (persistence && JSON.stringify(persistence.expectedBefore)
          === JSON.stringify(persistence.expectedAfter)) {
          throw new Error('authoritative persistence must prove a before-to-after change');
        }

        let responseSettled = false;
        const responsePending = request ? page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === request.method
            && request.path.test(url.pathname)
            && (request.search === undefined || url.search === request.search);
        }).then((response) => {
          responseSettled = true;
          return response;
        }) : null;
        if (dialog) {
          page.once('dialog', async (nativeDialog) => {
            if (dialog === 'accept') await nativeDialog.accept();
            else await nativeDialog.dismiss();
          });
        }

        await control.focus();
        await expectApi(control).toBeFocused();
        if (focus?.mode === 'moved') {
          const targetActiveBeforeActivation = await focusTarget.evaluate((element) => (
            element.ownerDocument.activeElement === element
          ));
          if (targetActiveBeforeActivation) {
            throw new Error('focus target was already active after binding the initiating control');
          }
        }
        await page.keyboard.press(activation.key);

        const dimensions = ['keyboard'];
        if (loading) {
          if (!responsePending || responseSettled) {
            throw new Error('loading must be observed while this transaction request is pending');
          }
          if (typeof loading.disabled !== 'boolean') {
            throw new TypeError('causal loading requires an exact disabled state');
          }
          if (loading.disabled) await expectApi(control).toBeDisabled();
          else await expectApi(control).toBeEnabled();
          if (loading.text !== undefined) await expectApi(control).toHaveText(loading.text);
          if (loading.status) {
            if (feedbackStateAlreadyMatches(beforeLoadingStatus, loading.status)) {
              throw new Error('loading status existed before transaction observation');
            }
            await expectApi(loading.status.locator).toHaveText(loading.status.text);
          }
          dimensions.push('loading');
        }
        if (typeof arguments[0]?.whilePending === 'function') {
          await arguments[0].whilePending();
        }

        let response = null;
        if (request) {
          response = await responsePending;
          await assertTransactionRequest(response, request);
          dimensions.push('request');
          if (response.request().isNavigationRequest() && request.settleNavigation !== false) {
            await response.finished();
            await page.waitForLoadState('load');
          }
        }
        await assertTransactionOutcome(outcome);
        if (feedback) {
          await assertCausalFeedback('feedback', feedback, beforeFeedback, control);
          dimensions.push('feedback');
        }
        if (error) {
          if (error.kind === 'dismissed-dialog') {
            if (dialog !== 'dismiss') {
              throw new Error('dismissed-dialog error requires transaction-owned dismissal');
            }
            await assertDismissedDialogError(error, beforeError);
          } else {
            await assertCausalFeedback('error', error, beforeError, control);
          }
          dimensions.push('error');
        }
        if (focus) {
          await expectApi(focusTarget).toBeFocused();
          dimensions.push('focus');
        }
        if (persistence) {
          if (persistence.reload) await page.reload();
          await waitForPersistenceAfter(persistence);
          const afterPersistence = await capturePersistence(page, persistence);
          expectApi(afterPersistence).toEqual(persistence.expectedAfter);
          dimensions.push('persistence');
        }
        const receipt = issueTransactionReceipt(
          obligation, transactionIdentity, page, control, dimensions,
        );
        if (typeof arguments[0]?.after === 'function') await arguments[0].after();
        return receipt;
      },
    });
  }

  function forScenario(page, state, action) {
    if (arguments.length !== 3) {
      throw new TypeError('scenario callers may provide only page, state, and action');
    }
    const obligation = obligationForOwner(state, action);
    const scenario = supportingScenarioFor(page, state, action);
    const dimensions = new Set();
    let branchIndex = 0;
    let finalReceiptIssued = false;
    let authoritativeControl = null;
    return Object.freeze({
      async run(branch) {
        if (arguments.length !== 1 || typeof branch !== 'string') {
          throw new TypeError('scenario branches accept one enumerated branch name');
        }
        if (finalReceiptIssued) throw new Error('scenario transaction already completed');
        const expectedBranch = scenario.branches[branchIndex];
        if (branch !== expectedBranch) {
          throw new Error(
            `${state} › ${action} expected branch ${expectedBranch}; received ${branch}`,
          );
        }
        const { control, descriptor } = await scenario.resolve(branch);
        authoritativeControl ||= control;
        const authority = descriptor.authority
          || await resolvedSupportingControlAuthority(
            page, state, action, obligation.profile,
          );
        const branchTransaction = createCatalogBranchTransaction(
          state, action, page, control, authority, branchIndex === 0,
        );
        const branchReceipt = await branchTransaction.run(descriptor);
        const branchEvidence = supportingTransactionReceipts.get(branchReceipt);
        if (!branchEvidence || branchEvidence.recorderIdentity !== recorderIdentity) {
          throw new Error('scenario branch did not produce owned transaction evidence');
        }
        branchEvidence.consumed = true;
        for (const dimension of branchEvidence.dimensions) dimensions.add(dimension);
        branchIndex += 1;
        if (branchIndex !== scenario.branches.length) return undefined;
        const required = assertedDimensions(obligation);
        const missing = required.filter((dimension) => !dimensions.has(dimension));
        if (missing.length) {
          throw new Error(`${state} › ${action} scenario omitted ${missing.join(', ')}`);
        }
        finalReceiptIssued = true;
        return issueTransactionReceipt(
          obligation,
          { state, action, complete: true, dimensions: new Set() },
          page,
          authoritativeControl,
          required,
        );
      },
    });
  }

  async function runScenario(page, state, action, ...branches) {
    const transaction = forScenario(page, state, action);
    let receipt;
    for (const branch of branches) receipt = await transaction.run(branch);
    if (!receipt) {
      throw new Error(`${state} › ${action} scenario did not complete its branch sequence`);
    }
    const evidence = supportingTransactionReceipts.get(receipt);
    if (!evidence || evidence.recorderIdentity !== recorderIdentity) {
      throw new Error('scenario did not produce an owned opaque receipt');
    }
    const transactionDimensions = evidence.transactionIdentity.dimensions;
    for (const dimension of evidence.dimensions) transactionDimensions.add(dimension);
    evidence.consumed = true;
    for (const dimension of evidence.dimensions) {
      recordedEvidence.add(evidenceToken(state, action, dimension));
    }
    return receipt;
  }

  async function visitState(page, state) {
    if (arguments.length !== 2) {
      throw new TypeError('state visits accept only page and the catalog state name');
    }
    if (!page || typeof page.goto !== 'function') {
      throw new TypeError('state visits require a Playwright page');
    }
    const scenario = STATE_SCENARIOS[state];
    if (!scenario) throw new Error(`unknown supporting state visit: ${state}`);
    const setupResponse = await page.request.post('/__test__/supporting-state-setup', {
      data: { state },
    });
    expectApi(setupResponse.status()).toBe(200);
    expectApi(await setupResponse.json()).toEqual(expectApi.objectContaining({
      state,
      invariant: scenario.invariant,
    }));
    const requestedUrl = `${scenario.visit.path}${scenario.visit.query}`;
    const response = await page.goto(requestedUrl);
    if (!response) throw new Error(`${state} catalog visit returned no document response`);
    expectApi(response.status()).toBe(scenario.visit.status);
    const actual = new URL(page.url());
    if (!scenario.path.test(actual.pathname)) {
      throw new Error(`${state} catalog visit resolved to wrong path ${actual.pathname}`);
    }
    if (scenario.search !== undefined && actual.search !== scenario.search) {
      throw new Error(`${state} catalog visit resolved to wrong query ${actual.search}`);
    }
    return response;
  }

  return Object.freeze({
    accept(token) {
      const transaction = supportingTransactionReceipts.get(token);
      if (transaction) {
        if (transaction.recorderIdentity !== recorderIdentity) {
          throw new Error('transaction receipt belongs to a different recorder');
        }
        if (transaction.consumed) throw new Error('transaction receipt was already consumed');
        transaction.consumed = true;
        const transactionDimensions = transaction.transactionIdentity.dimensions;
        for (const dimension of transaction.dimensions) transactionDimensions.add(dimension);
        const obligation = obligationForOwner(transaction.state, transaction.action);
        const required = assertedDimensions(obligation);
        if (required.every((dimension) => transactionDimensions.has(dimension))) {
          for (const dimension of required) {
            recordedEvidence.add(evidenceToken(
              transaction.state, transaction.action, dimension,
            ));
          }
        }
        return;
      }
      throw new Error('forged transaction receipt');
    },
    forScenario,
    runScenario,
    visitState,
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


function indexedCoverage(entries, sourceName) {
  if (!Array.isArray(entries)) {
    throw new TypeError(`${sourceName} must be an independent static array`);
  }
  const indexed = new Map();
  for (const entry of entries) {
    const key = `${entry.state}\u0000${entry.action}`;
    if (indexed.has(key)) throw new Error(`${sourceName} duplicates ${entry.state} › ${entry.action}`);
    indexed.set(key, entry);
  }
  return indexed;
}


function validateSupportingCoverage(expectedActions, receipts, policies, obligations) {
  const baselineIndex = indexedCoverage(SUPPORTING_ACTION_BASELINES, 'supporting baseline');
  if (SUPPORTING_ACTION_BASELINES.length !== 388 || SUPPORTING_BASELINE_STATES.length !== 30) {
    throw new Error('supporting baseline exact length must remain 388 actions across 30 states');
  }
  const sources = [
    ['supporting receipts', receipts],
    ['supporting policy', policies],
    ['supporting behavior obligations', obligations],
  ];
  const baselineStates = [...SUPPORTING_BASELINE_STATES].sort();
  const baselineKeys = [...baselineIndex.keys()].sort();
  const catalogStates = Object.keys(STATE_SCENARIOS).sort();
  if (JSON.stringify(catalogStates) !== JSON.stringify(baselineStates)) {
    throw new Error('supporting state catalog exact state set differs from supporting baseline');
  }
  const stateIdentities = new Set();
  const stateInvariants = new Set();
  for (const state of baselineStates) {
    const scenario = STATE_SCENARIOS[state];
    if (!scenario.visit || typeof scenario.visit.path !== 'string'
      || typeof scenario.visit.query !== 'string' || !Number.isInteger(scenario.visit.status)
      || scenario.invariant !== `supporting-state:${state}`
      || scenario.precondition?.markerRole !== 'heading'
      || scenario.precondition?.markerLevel !== 1
      || scenario.precondition?.markerName !== scenario.marker
      || scenario.precondition?.principal !== scenario.identity
      || scenario.precondition?.identityStatus !== (scenario.identity === null ? 302 : 200)
      || !Object.isFrozen(scenario.precondition?.runtime)
      || typeof scenario.search !== 'string'
      || !Array.isArray(scenario.queries) || !scenario.queries.length
      || scenario.queries.some((query) => typeof query !== 'string')
      || !scenario.queries.includes(scenario.search)
      || !Object.isFrozen(scenario) || !Object.isFrozen(scenario.visit)
      || !Object.isFrozen(scenario.precondition) || !Object.isFrozen(scenario.queries)) {
      throw new Error(`${state} state catalog lacks exact visit/status/invariant/precondition authority`);
    }
    const identity = scenario.identity === null
      ? 'anonymous'
      : scenario.identity instanceof RegExp
        ? `pattern:${scenario.identity.source}/${scenario.identity.flags}`
        : `exact:${scenario.identity}`;
    if (scenario.identity instanceof RegExp
      && (!scenario.identity.source.startsWith('^') || !scenario.identity.source.endsWith('$'))) {
      throw new Error(`${state} state catalog principal pattern is not deterministic and anchored`);
    }
    const stateIdentity = [
      scenario.visit.path, scenario.visit.query, scenario.visit.status, identity,
    ].join('\u0000');
    if (stateIdentities.has(stateIdentity)) {
      throw new Error(`${state} state catalog identity overlaps another exact state`);
    }
    stateIdentities.add(stateIdentity);
    if (stateInvariants.has(scenario.invariant)) {
      throw new Error(`${state} state catalog invariant is not unique`);
    }
    stateInvariants.add(scenario.invariant);
  }
  const manifestStates = Object.keys(expectedActions).sort();
  if (JSON.stringify(manifestStates) !== JSON.stringify(baselineStates)) {
    throw new Error('supporting manifest exact state set differs from supporting baseline');
  }
  const indexes = new Map();
  for (const [sourceName, source] of sources) {
    const index = indexedCoverage(source, sourceName);
    indexes.set(sourceName, index);
    if (source.length !== SUPPORTING_ACTION_BASELINES.length) {
      throw new Error(`${sourceName} exact length differs from supporting baseline`);
    }
    const states = [...new Set(source.map(({ state }) => state))].sort();
    if (JSON.stringify(states) !== JSON.stringify(baselineStates)) {
      throw new Error(`${sourceName} exact state set differs from supporting baseline`);
    }
    if (JSON.stringify([...index.keys()].sort()) !== JSON.stringify(baselineKeys)) {
      throw new Error(`${sourceName} exact action key set differs from supporting baseline`);
    }
  }
  if (JSON.stringify([...SUPPORTING_ACTION_STATES].sort()) !== JSON.stringify(baselineStates)) {
    throw new Error('runtime supporting exact state set differs from supporting baseline');
  }

  for (const state of SUPPORTING_BASELINE_STATES) {
    const actions = expectedActions[state];
    if (!actions) throw new Error(`${state} supporting action inventory is missing`);
    const baselineActions = SUPPORTING_ACTION_BASELINES
      .filter((entry) => entry.state === state).map(({ action }) => action).sort();
    if (JSON.stringify([...actions].sort()) !== JSON.stringify(baselineActions)) {
      throw new Error(`${state} independent manifest actions differ from exact baseline inventory`);
    }
    for (const action of actions) {
      const key = `${state}\u0000${action}`;
      const baseline = baselineIndex.get(key);
      const receipt = indexes.get('supporting receipts').get(key);
      const policy = indexes.get('supporting policy').get(key);
      const obligation = indexes.get('supporting behavior obligations').get(key);
      if (receipt.owner !== baseline.owner
        || policy.owner !== baseline.owner || obligation.owner !== baseline.owner) {
        throw new Error(`${state} › ${action} receipt owner differs from policy or behavior`);
      }
      if (receipt.profile !== baseline.profile
        || policy.profile !== baseline.profile || obligation.profile !== baseline.profile) {
        throw new Error(`${state} › ${action} receipt profile differs from policy or behavior`);
      }
      for (const [sourceName, entry] of [
        ['supporting baseline', baseline], ['supporting receipts', receipt],
        ['supporting policy', policy], ['supporting behavior obligations', obligation],
      ]) {
        const dimensionKeys = Object.keys(entry.dimensions).sort();
        if (JSON.stringify(dimensionKeys) !== JSON.stringify([...DIMENSIONS].sort())) {
          throw new Error(`${state} › ${action} ${sourceName} exact dimension set differs`);
        }
      }
      for (const dimension of Object.keys(baseline.dimensions)) {
        const statuses = [
          baseline.dimensions[dimension]?.status,
          receipt.dimensions[dimension]?.status,
          policy.dimensions[dimension]?.status,
          obligation.dimensions[dimension]?.status,
        ];
        if (new Set(statuses).size !== 1) {
          throw new Error(
            `${state} › ${action} ${dimension} applicability differs across independent sources`,
          );
        }
        const reasons = [
          baseline.dimensions[dimension]?.reason,
          receipt.dimensions[dimension]?.reason,
          policy.dimensions[dimension]?.reason,
          obligation.dimensions[dimension]?.reason,
        ];
        if (new Set(reasons).size !== 1 || reasons.some((reason) => !reason?.trim())) {
          throw new Error(`${state} › ${action} ${dimension} reason differs across independent sources`);
        }
      }
    }
  }
  return true;
}


module.exports = {
  SUPPORTING_ACTION_STATES,
  SUPPORTING_BEHAVIOR_OBLIGATIONS,
  SUPPORTING_OWNER_TITLES,
  assertedDimensions,
  createSupportingBehaviorRecorder,
  supportingObligationFor,
  validateSupportingCoverage,
};
