const DIMENSIONS = ['error', 'focus', 'keyboard', 'loading', 'persistence', 'request'];

const OWNER_TITLES = Object.freeze({
  chrome: 'tests/browser/release-core-actions.spec.js › every core chrome action runs in its exact representative state',
  landing: 'tests/browser/landing.spec.js › public landing exposes one promise and working account actions',
  authLinks: 'tests/browser/release-core-actions.spec.js › authentication links reach the neighboring recovery or account form',
  authLogin: 'tests/browser/release-core-actions.spec.js › login validation and Remember me preserve the authenticated session',
  onboarding: 'tests/browser/onboarding.spec.js › registration previews transparently and activates only after final confirmation',
  authForgot: 'tests/browser/release-core-actions.spec.js › forgot form enforces validation and preserves a neutral recovery response',
  authReset: 'tests/browser/release-core-actions.spec.js › reset form enforces native and matching validation without consuming the token',
  todayCheckIn: 'tests/browser/release-core-actions.spec.js › exact Today check-in actions open and return focus in their representative fixtures',
  todayRepeated: 'tests/browser/release-core-actions.spec.js › Today repeated controls run in each exact representative state',
  todayLinks: 'tests/browser/release-core-actions.spec.js › Today fallback and recovery links reach their intended next action',
  journeyLifecycle: 'tests/browser/journey.spec.js › Journey previews explicitly, mutates future rows only, and carries status history through archive',
  journeyObserve: 'tests/browser/journey.spec.js › Observe recovery and migrated Goal review remain visibly separate and non-activating',
  journeyChoices: 'tests/browser/release-core-actions.spec.js › uncovered onboarding choices and Journey handoffs preserve user control',
  insights: 'tests/browser/release-core-actions.spec.js › Insights actions run in every exact representative data state',
  theme: 'tests/browser/shell.spec.js › theme choice publishes one effective contract and System alone follows the device',
  signOut: 'tests/browser/offline-replay.spec.js › logout clears queued storage before another account can replay it',
  youLinks: 'tests/browser/release-core-actions.spec.js › You links reach every settings and catalog destination',
});

const PROFILE_EVIDENCE = Object.freeze({
  skip: {
    error: ['not-applicable', 'same-document focus has no recoverable error branch'],
    focus: ['asserted', 'the exact main region receives focus'],
    keyboard: ['asserted', 'the exact skip link is focused and activated with Enter'],
    loading: ['not-applicable', 'same-document focus is synchronous'],
    persistence: ['not-applicable', 'focus movement has no durable state'],
    request: ['not-applicable', 'the hash target changes without an HTTP request'],
  },
  navigation: {
    error: ['not-applicable', 'the action is a native full-document destination'],
    focus: ['not-applicable', 'this link makes no application-managed focus promise'],
    keyboard: ['asserted', 'the exact link is focused and activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['not-applicable', 'the destination itself is the complete action outcome'],
    request: ['asserted', 'the owner asserts GET, status, empty body, and exact destination'],
  },
  primaryNavigation: {
    error: ['not-applicable', 'the action is a native full-document destination'],
    focus: ['asserted', 'the destination main region receives focus'],
    keyboard: ['asserted', 'the exact primary link is focused and activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['not-applicable', 'the destination itself is the complete action outcome'],
    request: ['asserted', 'the owner asserts GET, status, empty body, and exact destination'],
  },
  primarySameDocument: {
    error: ['not-applicable', 'the current-destination focus jump has no error branch'],
    focus: ['asserted', 'the current page main region receives focus'],
    keyboard: ['asserted', 'the current primary link is focused and activated with Enter'],
    loading: ['not-applicable', 'the hash focus jump is synchronous'],
    persistence: ['not-applicable', 'the focus jump has no durable state'],
    request: ['not-applicable', 'the current-destination hash changes without HTTP'],
  },
  localFocus: {
    error: ['not-applicable', 'the local control has no asynchronous failure branch'],
    focus: ['asserted', 'the owner asserts the opened or returned focus target'],
    keyboard: ['asserted', 'the exact control is activated from the keyboard'],
    loading: ['not-applicable', 'the local state change is synchronous'],
    persistence: ['not-applicable', 'opening or toggling does not promise durable state'],
    request: ['not-applicable', 'the local control makes no request'],
  },
  navigationFragment: {
    error: ['not-applicable', 'the same-page target has no asynchronous error branch'],
    focus: ['not-applicable', 'the contract is a visible in-page destination, not managed focus'],
    keyboard: ['asserted', 'the exact link is activated from the keyboard'],
    loading: ['not-applicable', 'the fragment transition is synchronous'],
    persistence: ['not-applicable', 'the fragment transition has no durable state'],
    request: ['not-applicable', 'the fragment transition makes no HTTP request'],
  },
  loginRemember: {
    error: ['not-applicable', 'the checkbox itself has no error branch'],
    focus: ['not-applicable', 'the native checkbox has no application-managed focus transfer'],
    keyboard: ['asserted', 'the checkbox is focused and toggled with Space'],
    loading: ['not-applicable', 'the checkbox changes synchronously'],
    persistence: ['asserted', 'the checked and unchecked session-cookie expiry boundaries are asserted'],
    request: ['not-applicable', 'the checkbox itself sends no request'],
  },
  loginSubmit: {
    error: ['asserted', 'the invalid credential response and calm inline error are asserted'],
    focus: ['not-applicable', 'the full-page authentication result has no managed focus transfer'],
    keyboard: ['asserted', 'the submit button is focused and activated with Enter'],
    loading: ['not-applicable', 'the action completes through full-document navigation'],
    persistence: ['asserted', 'the authenticated cookie lifetime and reload boundary are asserted'],
    request: ['asserted', 'POST method, status, and exact form payload are asserted'],
  },
  validationSubmit: {
    error: ['asserted', 'native or inline validation and the controlled server result are asserted'],
    focus: ['asserted', 'the invalid field receives focus'],
    keyboard: ['asserted', 'the submit control is activated with Enter'],
    loading: ['not-applicable', 'native validation or full-document navigation completes the action'],
    persistence: ['not-applicable', 'the tested validation action does not promise durable state'],
    request: ['asserted', 'the owner asserts zero invalid POSTs and the exact valid request when applicable'],
  },
  onboardingChoice: {
    error: ['not-applicable', 'this local wizard choice has no asynchronous error branch'],
    focus: ['asserted', 'the next wizard heading or selected choice is asserted'],
    keyboard: ['asserted', 'the exact choice or Continue control is activated by keyboard'],
    loading: ['not-applicable', 'the local wizard transition is synchronous'],
    persistence: ['not-applicable', 'the choice remains draft state until final activation'],
    request: ['not-applicable', 'the local wizard choice makes no request'],
  },
  registrationSubmit: {
    error: ['asserted', 'the owner asserts inline invalid registration before the valid attempt'],
    focus: ['asserted', 'successful registration focuses the onboarding heading'],
    keyboard: ['asserted', 'the submit control is activated by keyboard'],
    loading: ['not-applicable', 'the valid action completes through full-document navigation'],
    persistence: ['asserted', 'the new authenticated user reaches onboarding after registration'],
    request: ['asserted', 'invalid submission sends zero POSTs and valid submission asserts exact POST status'],
  },
  termsChoice: {
    error: ['not-applicable', 'the terms checkbox itself has no asynchronous error branch'],
    focus: ['not-applicable', 'the native checkbox has no managed focus transfer'],
    keyboard: ['asserted', 'the exact checkbox is focused and toggled with Space'],
    loading: ['not-applicable', 'the checkbox changes synchronously'],
    persistence: ['not-applicable', 'the checkbox value is submitted only with registration'],
    request: ['not-applicable', 'the checkbox itself makes no request'],
  },
  journeyMutation: {
    error: ['not-applicable', 'the owner verifies the successful canonical lifecycle transition'],
    focus: ['not-applicable', 'the action completes through full-document navigation'],
    keyboard: ['asserted', 'the exact lifecycle control is activated with Enter'],
    loading: ['not-applicable', 'the action completes through full-document navigation'],
    persistence: ['asserted', 'the resulting lifecycle state is asserted after reload'],
    request: ['asserted', 'the exact POST response status and request target are asserted'],
  },
  range: {
    error: ['asserted', 'a controlled failure preserves prior data and the same control retries successfully'],
    focus: ['asserted', 'the exact range control retains focus through failure and success'],
    keyboard: ['asserted', 'the exact range control is activated with Enter'],
    loading: ['asserted', 'busy root and requested range plus live loading status are asserted while held'],
    persistence: ['not-applicable', 'range selection is intentionally page-local'],
    request: ['asserted', 'GET method, exact days query, status, and empty body are asserted'],
  },
  exportData: {
    error: ['asserted', 'controlled export failure produces inline recovery before successful retry'],
    focus: ['asserted', 'the export button retains focus after failure and success'],
    keyboard: ['asserted', 'the exact Export CSV control is activated with Enter'],
    loading: ['asserted', 'disabled and aria-busy state are asserted while the request is held'],
    persistence: ['not-applicable', 'a downloaded file does not mutate application state'],
    request: ['asserted', 'GET method, current range query, status, empty body, and filename are asserted'],
  },
  exportEmpty: {
    error: ['asserted', 'the owner asserts calm no-data guidance'],
    focus: ['asserted', 'the export button retains focus after local guidance'],
    keyboard: ['asserted', 'the exact Export CSV control is activated with Enter'],
    loading: ['not-applicable', 'known-empty export resolves synchronously'],
    persistence: ['not-applicable', 'the local guidance does not mutate state'],
    request: ['asserted', 'the owner asserts that the empty action sends zero export requests'],
  },
  theme: {
    error: ['asserted', 'a controlled account-preference failure keeps the local choice and exposes recovery feedback before retry'],
    focus: ['asserted', 'the exact theme control retains focus'],
    keyboard: ['asserted', 'the exact theme control is activated with Enter'],
    loading: ['asserted', 'the exact saving feedback is asserted while account preference persistence is held'],
    persistence: ['asserted', 'the exact saved and effective theme survives reload'],
    request: ['asserted', 'the authenticated owner asserts the exact account-preference PATCH, payload, and success status'],
  },
  signOut: {
    error: ['not-applicable', 'the native logout destination has no inline recovery branch'],
    focus: ['not-applicable', 'logout completes through full-document navigation'],
    keyboard: ['asserted', 'the exact Sign out link is activated with Enter'],
    loading: ['not-applicable', 'the browser owns full-document loading'],
    persistence: ['asserted', 'private queued state is absent for the next authenticated user'],
    request: ['asserted', 'the logout GET response and anonymous destination are asserted'],
  },
});

function materializeDimensions(profileName, state, action) {
  const profile = PROFILE_EVIDENCE[profileName];
  if (!profile) throw new Error(`Unknown evidence profile: ${profileName}`);
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

const publicChromeStates = ['landing', 'login', 'register', 'forgot-password', 'reset-password'];
group(OWNER_TITLES.chrome, publicChromeStates.flatMap((state) => [
  [state, 'Nicotine Tracker home', 'navigation'],
  [state, 'Skip to main content', 'skip'],
]));

const appChromeStates = [
  ['today', 'today-targeted@example.com', 'Today'],
  ['today-no-plan', 'browser@example.com', 'Today'],
  ['today-paused', 'today-paused@example.com', 'Today'],
  ['today-exceeded', 'today-exceeded@example.com', 'Today'],
  ['journey', 'journey-review-desktop@example.com', 'Journey'],
  ['journey-onboarding', 'browser@example.com', null],
  ['insights', 'release-analytics-ready@example.com', 'Insights'],
  ['insights-empty', 'release-analytics-empty@example.com', 'Insights'],
  ['insights-sparse', 'release-analytics-sparse@example.com', 'Insights'],
  ['you', 'release-settings@example.com', 'You'],
];
group(OWNER_TITLES.chrome, appChromeStates.flatMap(([state, email, current]) => [
  [state, 'Nicotine Tracker home', 'navigation'],
  [state, 'Skip to main content', 'skip'],
  [state, `Open your space for ${email}`, 'navigation'],
  ...['Today', 'Logbook', 'Journey', 'Insights', 'You'].map((action) => [
    state, action, action === current ? 'primarySameDocument' : 'primaryNavigation',
  ]),
]));

group(OWNER_TITLES.landing, [
  ['landing', 'Create account', 'navigation'],
  ['landing', 'Sign in', 'navigation'],
]);
group(OWNER_TITLES.authLinks, [
  ['login', 'Create one here', 'navigation'],
  ['login', 'Forgot password?', 'navigation'],
  ['register', 'Sign in here', 'navigation'],
  ['forgot-password', 'Sign in here', 'navigation'],
  ['reset-password', 'Sign in here', 'navigation'],
]);
group(OWNER_TITLES.authLogin, [
  ['login', 'Remember me', 'loginRemember'],
  ['login', 'Sign in', 'loginSubmit'],
]);
group(OWNER_TITLES.onboarding, [
  ['register', 'Create account', 'registrationSubmit'],
  ['register', 'I understand this is a personal tracking tool, not medical advice.', 'termsChoice'],
  ['journey-onboarding', 'Continue', 'onboardingChoice'],
  ['journey-onboarding', 'Reduce steadily Work toward a lower daily pouch ceiling.', 'onboardingChoice'],
]);
group(OWNER_TITLES.authForgot, [['forgot-password', 'Send reset link', 'validationSubmit']]);
group(OWNER_TITLES.authReset, [['reset-password', 'Reset password', 'validationSubmit']]);
group(OWNER_TITLES.todayCheckIn, [
  ['today', 'Edit reflection', 'localFocus'],
  ['today-exceeded', 'Take a short check-in', 'localFocus'],
]);
group(OWNER_TITLES.todayRepeated, [
  ['today', 'I have a craving Pause and choose what helps next', 'localFocus'],
  ['today', 'Log nicotine use', 'navigationFragment'],
  ['today', 'Log nicotine use Steady Mint · 6.00 mg is ready', 'localFocus'],
  ['today-no-plan', 'I have a craving Pause and choose what helps next', 'localFocus'],
  ['today-no-plan', 'Log nicotine use', 'navigationFragment'],
  ['today-no-plan', 'Log nicotine use Add the details now', 'navigation'],
  ['today-paused', 'I have a craving Pause and choose what helps next', 'localFocus'],
  ['today-paused', 'Log nicotine use', 'navigationFragment'],
  ['today-paused', 'Log nicotine use Steady Mint · 6.00 mg is ready', 'localFocus'],
  ['today-exceeded', 'I have a craving Pause and choose what helps next', 'localFocus'],
  ['today-exceeded', 'Log nicotine use Steady Mint · 6.00 mg is ready', 'localFocus'],
]);
group(OWNER_TITLES.todayLinks, [
  ['today-no-plan', 'Continue neutral tracking', 'navigation'],
  ['today-no-plan', 'Create a plan', 'navigation'],
  ['today-no-plan', 'Log your first nicotine use', 'navigation'],
  ['today-paused', 'Review or resume in Journey', 'navigation'],
  ['today-exceeded', 'Keep logging', 'navigationFragment'],
  ['today-exceeded', 'Pause or revise in Journey', 'navigation'],
  ['today-exceeded', 'Reflect on today', 'navigationFragment'],
  ['today-exceeded', 'Review the plan in Journey', 'navigation'],
]);
group(OWNER_TITLES.journeyLifecycle, [
  ['journey', 'Archive plan', 'journeyMutation'],
  ['journey', 'Mark complete', 'journeyMutation'],
  ['journey', 'Pause plan', 'journeyMutation'],
  ['journey', 'Plan details and history', 'localFocus'],
  ['journey', 'Preview revision', 'journeyMutation'],
]);
group(OWNER_TITLES.journeyChoices, [
  ['journey', 'Log nicotine or respond to a craving', 'navigation'],
  ['journey', 'Review this draft', 'navigation'],
  ['journey-onboarding', 'Quit by a date Build a schedule that ends at zero.', 'onboardingChoice'],
  ['journey-onboarding', 'Understand my baseline first Track for seven days without a reduction target.', 'onboardingChoice'],
]);

const insightsStates = [
  ['insights', 'Plan for Afternoon (12PM-6PM)'],
  ['insights-empty', 'Log today'],
  ['insights-sparse', 'Log today'],
];
group(OWNER_TITLES.insights, insightsStates.flatMap(([state, nextAction]) => [
  ...[
    ['1 year', 'range'], ['30 days', 'range'], ['7 days', 'range'], ['90 days', 'range'],
    ['Daily', 'localFocus'], ['Weekly', 'localFocus'],
    ['Open hourly detail and supporting measures', 'localFocus'],
    ['View consumption trend data', 'localFocus'],
    ['View product data', 'localFocus'],
    ['View time-of-day data', 'localFocus'],
    ['View weekly pattern data', 'localFocus'],
    ['Export CSV', state === 'insights-empty' ? 'exportEmpty' : 'exportData'],
    [nextAction, 'navigation'],
  ].map(([action, profile]) => [state, action, profile]),
]));
group(OWNER_TITLES.theme, [
  ['you', 'Dark', 'theme'], ['you', 'Light', 'theme'], ['you', 'System', 'theme'],
]);
group(OWNER_TITLES.signOut, [['you', 'Sign out', 'signOut']]);
group(OWNER_TITLES.youLinks, [
  ['you', 'Data & privacy Export and account controls', 'navigation'],
  ['you', 'Day & timezone Daily reset and display preferences', 'navigation'],
  ['you', 'Profile Personal details kept private', 'navigation'],
  ['you', 'Reminders Channels, timing, and quiet hours', 'navigation'],
  ['you', 'Your pouches Catalog and quick-log choices', 'navigation'],
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
  if (obligationKeys.has(key)) throw new Error(`Duplicate core behavior obligation: ${key}`);
  obligationKeys.add(key);
}

const CORE_BEHAVIOR_OBLIGATIONS = Object.freeze(obligationEntries);
const TRANSITION_ONLY_BEHAVIOR_ACTIONS = Object.freeze([
  Object.freeze({ state: 'journey', action: 'Archive plan' }),
  Object.freeze({ state: 'journey', action: 'Mark complete' }),
  Object.freeze({ state: 'journey', action: 'Pause plan' }),
]);
const transitionOnlyKeys = new Set(TRANSITION_ONLY_BEHAVIOR_ACTIONS.map(({ state, action }) => (
  `${state}\u0000${action}`
)));

function obligationFor(state, action) {
  return CORE_BEHAVIOR_OBLIGATIONS.find((entry) => (
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

function createBehaviorRecorder(
  owner,
  expectApi,
  injectedObligations = [],
) {
  const mandatoryKeys = new Set(CORE_BEHAVIOR_OBLIGATIONS.map((obligation) => (
    `${obligation.state}\u0000${obligation.action}`
  )));
  const injectedKeys = new Set();
  for (const obligation of injectedObligations) {
    if (obligation.owner !== owner) {
      throw new Error(
        `${obligation.state} › ${obligation.action} injected obligation owner differs from ${owner}`,
      );
    }
    const key = `${obligation.state}\u0000${obligation.action}`;
    if (mandatoryKeys.has(key)) {
      throw new Error(
        `${obligation.state} › ${obligation.action} conflicts with a mandatory core obligation`,
      );
    }
    if (injectedKeys.has(key)) {
      throw new Error(`${obligation.state} › ${obligation.action} is a duplicate injected obligation`);
    }
    injectedKeys.add(key);
  }
  const obligations = [...CORE_BEHAVIOR_OBLIGATIONS, ...injectedObligations];
  const expected = obligations.filter((entry) => entry.owner === owner);
  const recordedEvidence = new Set();
  return Object.freeze({
    record(state, action, observedDimensions) {
      const obligation = expected.find((entry) => (
        entry.state === state && entry.action === action
      ));
      expectApi(obligation, `${owner} owns ${state} › ${action}`).toBeDefined();
      if (!obligation) return;
      const applicable = assertedDimensions(obligation);
      for (const dimension of observedDimensions) {
        expectApi(
          applicable,
          `${state} › ${action} permits recorded ${dimension} evidence`,
        ).toContain(dimension);
        recordedEvidence.add(evidenceToken(state, action, dimension));
      }
    },
    assertComplete() {
      const expectedEvidence = expected.flatMap((obligation) => (
        assertedDimensions(obligation).map((dimension) => evidenceToken(
          obligation.state, obligation.action, dimension,
        ))
      ));
      expectApi(
        [...recordedEvidence].sort(),
        `${owner} runtime dimension evidence`,
      ).toEqual(expectedEvidence.sort());
    },
  });
}

function validateCoverage(expectedActions, coveredBy) {
  const states = [...new Set(CORE_BEHAVIOR_OBLIGATIONS.map(({ state }) => state))];
  for (const state of states) {
    const actions = expectedActions[state];
    if (!actions) throw new Error(`${state} action inventory is missing`);
    const obligations = CORE_BEHAVIOR_OBLIGATIONS.filter((entry) => (
      entry.state === state && !transitionOnlyKeys.has(`${entry.state}\u0000${entry.action}`)
    ));
    const obligationActions = obligations.map(({ action }) => action).sort();
    if (JSON.stringify(obligationActions) !== JSON.stringify([...actions].sort())) {
      throw new Error(`${state} independent behavior obligations differ from action inventory`);
    }
    const stateCoverage = coveredBy[state] || {};
    for (const obligation of obligations) {
      const receipt = stateCoverage[obligation.action];
      if (!receipt) throw new Error(`${state} › ${obligation.action} missing receipt`);
      if (receipt.test !== obligation.owner) {
        throw new Error(`${state} › ${obligation.action} owner mismatch`);
      }
      if (JSON.stringify(receipt.dimensions) !== JSON.stringify(obligation.dimensions)) {
        throw new Error(`${state} › ${obligation.action} dimension evidence mismatch`);
      }
    }
  }
  return true;
}

module.exports = {
  CORE_BEHAVIOR_OBLIGATIONS,
  DIMENSIONS,
  OWNER_TITLES,
  TRANSITION_ONLY_BEHAVIOR_ACTIONS,
  assertedDimensions,
  createBehaviorRecorder,
  obligationFor,
  validateCoverage,
};
