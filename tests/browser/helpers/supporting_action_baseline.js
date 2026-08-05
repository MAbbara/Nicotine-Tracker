const BASELINE_DIMENSIONS = Object.freeze([
  'error', 'feedback', 'focus', 'keyboard', 'loading', 'persistence', 'request',
]);


// Independent literal release baselines. This module deliberately imports neither
// the applicability policy nor the runtime behavior contract, so changing either
// cannot rewrite manifest ownership or dimension declarations.
const BASELINE_SOURCE = {
  "owners": {
    "chrome": "tests/browser/release-supporting-actions.spec.js › every supporting chrome action runs in its exact representative state",
    "settingsNavigation": "tests/browser/release-supporting-actions.spec.js › every settings navigation action runs in its exact representative state",
    "settingsProfile": "tests/browser/settings.spec.js › Profile values persist and actions stay clear of mobile navigation",
    "settingsPreferences": "tests/browser/settings.spec.js › Preferences update with native controls and persist after reload",
    "settingsReminders": "tests/browser/settings.spec.js › Reminders persist and async actions expose success and failure feedback",
    "settingsData": "tests/browser/settings.spec.js › Data privacy controls persist and Statistics hands off to Insights",
    "settingsAccountValidation": "tests/browser/settings.spec.js › Account rejects incorrect credentials without losing the form",
    "settingsAccountDisposable": "tests/browser/settings.spec.js › Account email, password, and deletion mutations work for a disposable user",
    "dataExact": "tests/browser/release-supporting-actions.spec.js › data actions use isolated disposable records in every exact state",
    "logbook": "tests/browser/logbook.spec.js › Logbook supports saved/custom add, filter, edit, bulk add, and confirmed delete",
    "loggingGaps": "tests/browser/release-supporting-actions.spec.js › remaining logging actions preserve exact navigation and isolated records",
    "catalog": "tests/browser/catalog.spec.js › Catalog supports create, Quick Log availability, edit, search, and confirmed delete",
    "catalogGaps": "tests/browser/release-supporting-actions.spec.js › remaining catalog actions preserve exact navigation and isolated records",
    "cravingsSymptoms": "tests/browser/cravings-page.spec.js › Craving history records complete and minimal entries in chronological order",
    "cravingsRecord": "tests/browser/cravings-page.spec.js › Craving history exposes native validation and recoverable server feedback",
    "cravingsLink": "tests/browser/release-supporting-actions.spec.js › standalone craving support link reaches Today without external traffic",
    "goalsLifecycle": "tests/browser/goals.spec.js › Goals preserve create, edit, toggle, and delete behavior",
    "goalsGaps": "tests/browser/release-supporting-actions.spec.js › remaining goal actions preserve exact navigation and disposable state",
    "dashboard": "tests/browser/dashboard.spec.js › Dashboard supporting actions cover ranges, destinations, and disclosure in every data state",
    "errors": "tests/browser/release-supporting-actions.spec.js › public error recovery actions reach a safe destination"
  },
  "profiles": {
    "navigation": {
      "error": "not-applicable",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "asserted",
      "feedback": "not-applicable"
    },
    "skip": {
      "error": "not-applicable",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "not-applicable",
      "feedback": "not-applicable"
    },
    "primaryNavigation": {
      "error": "not-applicable",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "asserted",
      "feedback": "not-applicable"
    },
    "primarySameDocument": {
      "error": "not-applicable",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "not-applicable",
      "feedback": "not-applicable"
    },
    "validatedMutation": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "formMutation": {
      "error": "not-applicable",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "draftToggle": {
      "error": "not-applicable",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "not-applicable",
      "feedback": "not-applicable"
    },
    "asyncAction": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "asserted",
      "persistence": "not-applicable",
      "request": "asserted",
      "feedback": "asserted"
    },
    "download": {
      "error": "not-applicable",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "asserted",
      "feedback": "not-applicable"
    },
    "offlineToggle": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "asserted",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "validationOnly": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "asserted",
      "feedback": "asserted"
    },
    "destructiveMutation": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "localControl": {
      "error": "not-applicable",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "not-applicable",
      "feedback": "not-applicable"
    },
    "rowDelete": {
      "error": "asserted",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "quickMutation": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "asserted",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "cravingRecord": {
      "error": "asserted",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "asserted",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "asserted"
    },
    "disclosure": {
      "error": "not-applicable",
      "focus": "asserted",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "not-applicable",
      "request": "not-applicable",
      "feedback": "not-applicable"
    },
    "rangeNavigation": {
      "error": "not-applicable",
      "focus": "not-applicable",
      "keyboard": "asserted",
      "loading": "not-applicable",
      "persistence": "asserted",
      "request": "asserted",
      "feedback": "not-applicable"
    }
  },
  "entries": [
    [
      "anonymous-not-found",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "anonymous-not-found",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "bad-request",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "bad-request",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "server-error",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "server-error",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "profile",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "profile",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "profile",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "profile",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "profile",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "profile",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "profile",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "profile",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "account",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "account",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "account",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "preferences",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "preferences",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "preferences",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "preferences",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "preferences",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "preferences",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "preferences",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "preferences",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "reminders",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "reminders",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "reminders",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "reminders",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "reminders",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "reminders",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "reminders",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "reminders",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "data",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "data",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "data",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "statistics",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "statistics",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "statistics",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "statistics",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "statistics",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "statistics",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "statistics",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "statistics",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "logbook",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "logbook",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "logbook",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "logbook",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "logbook",
      "Logbook",
      "chrome",
      "primarySameDocument"
    ],
    [
      "logbook",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "logbook",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "logbook",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-add",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "log-add",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "log-add",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "log-add",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-add",
      "Logbook",
      "chrome",
      "primarySameDocument"
    ],
    [
      "log-add",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-add",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-add",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-bulk",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "log-bulk",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "log-bulk",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "log-bulk",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-bulk",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-bulk",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-bulk",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-bulk",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "catalog",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "catalog",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "catalog",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-add",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "catalog-add",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "catalog-add",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "catalog-add",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-add",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-add",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-add",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-add",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "cravings",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "cravings",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "cravings",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "cravings",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "cravings",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "cravings",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "cravings",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "cravings",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goals",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "goals",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "goals",
      "Open your space for journey-review-desktop@example.com",
      "chrome",
      "navigation"
    ],
    [
      "goals",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goals",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goals",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goals",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goals",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-create",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "goal-create",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "goal-create",
      "Open your space for journey-review-desktop@example.com",
      "chrome",
      "navigation"
    ],
    [
      "goal-create",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-create",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-create",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-create",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-create",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "dashboard",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "dashboard",
      "Open your space for release-analytics-ready@example.com",
      "chrome",
      "navigation"
    ],
    [
      "dashboard",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "not-found",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "not-found",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "not-found",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "not-found",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "not-found",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "not-found",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "not-found",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "not-found",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "dashboard-empty",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "dashboard-empty",
      "Open your space for release-analytics-empty@example.com",
      "chrome",
      "navigation"
    ],
    [
      "dashboard-empty",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "dashboard-sparse",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "dashboard-sparse",
      "Open your space for release-analytics-sparse@example.com",
      "chrome",
      "navigation"
    ],
    [
      "dashboard-sparse",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-enabled",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "data-offline-enabled",
      "Open your space for release-offline-enabled@example.com",
      "chrome",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-enabled",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-enabled",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-enabled",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-enabled",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-disabled",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "data-offline-disabled",
      "Open your space for release-offline-disabled@example.com",
      "chrome",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-disabled",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-disabled",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-disabled",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-offline-disabled",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-settings-action",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "data-settings-action",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "data-settings-action",
      "Open your space for release-settings@example.com",
      "chrome",
      "navigation"
    ],
    [
      "data-settings-action",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-settings-action",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-settings-action",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-settings-action",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "data-settings-action",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account-destructive",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "account-destructive",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "account-destructive",
      "Open your space for release-destructive@example.com",
      "chrome",
      "navigation"
    ],
    [
      "account-destructive",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account-destructive",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account-destructive",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account-destructive",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "account-destructive",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-progress",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "goal-progress",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "goal-progress",
      "Open your space for journey-review-desktop@example.com",
      "chrome",
      "navigation"
    ],
    [
      "goal-progress",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-progress",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-progress",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-progress",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-progress",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-edit",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "goal-edit",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "goal-edit",
      "Open your space for journey-review-desktop@example.com",
      "chrome",
      "navigation"
    ],
    [
      "goal-edit",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-edit",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-edit",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-edit",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "goal-edit",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-edit",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "log-edit",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "log-edit",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "log-edit",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-edit",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-edit",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-edit",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "log-edit",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-search",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "catalog-search",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "catalog-search",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "catalog-search",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-search",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-search",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-search",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-search",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-edit",
      "Nicotine Tracker home",
      "chrome",
      "navigation"
    ],
    [
      "catalog-edit",
      "Skip to main content",
      "chrome",
      "skip"
    ],
    [
      "catalog-edit",
      "Open your space for release-inventory@example.com",
      "chrome",
      "navigation"
    ],
    [
      "catalog-edit",
      "Today",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-edit",
      "Logbook",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-edit",
      "Journey",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-edit",
      "Insights",
      "chrome",
      "primaryNavigation"
    ],
    [
      "catalog-edit",
      "You",
      "chrome",
      "primaryNavigation"
    ],
    [
      "profile",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "preferences",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "reminders",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "statistics",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "data-settings-action",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Profile",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Account",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Preferences",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Reminders",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Data & privacy",
      "settingsNavigation",
      "navigation"
    ],
    [
      "account-destructive",
      "Statistics",
      "settingsNavigation",
      "navigation"
    ],
    [
      "profile",
      "Save profile",
      "settingsProfile",
      "validatedMutation"
    ],
    [
      "preferences",
      "Save preferences",
      "settingsPreferences",
      "formMutation"
    ],
    [
      "preferences",
      "Steady Mint",
      "settingsPreferences",
      "draftToggle"
    ],
    [
      "reminders",
      "Email",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Discord",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Goal progress",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Milestones",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Daily logging reminder",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Weekly progress report",
      "settingsReminders",
      "draftToggle"
    ],
    [
      "reminders",
      "Save reminders",
      "settingsReminders",
      "formMutation"
    ],
    [
      "reminders",
      "Test Discord connection",
      "settingsReminders",
      "asyncAction"
    ],
    [
      "reminders",
      "Send weekly report",
      "settingsReminders",
      "asyncAction"
    ],
    [
      "data",
      "Download Data",
      "settingsData",
      "download"
    ],
    [
      "data",
      "Review account deletion",
      "settingsData",
      "navigation"
    ],
    [
      "data",
      "Save actions for offline use",
      "settingsData",
      "offlineToggle"
    ],
    [
      "statistics",
      "Explore patterns in Insights",
      "settingsData",
      "primaryNavigation"
    ],
    [
      "account",
      "Update email",
      "settingsAccountValidation",
      "validationOnly"
    ],
    [
      "account",
      "Change password",
      "settingsAccountValidation",
      "validationOnly"
    ],
    [
      "account",
      "Delete account",
      "settingsAccountValidation",
      "validationOnly"
    ],
    [
      "account-destructive",
      "Update email",
      "settingsAccountDisposable",
      "validatedMutation"
    ],
    [
      "account-destructive",
      "Change password",
      "settingsAccountDisposable",
      "validatedMutation"
    ],
    [
      "account-destructive",
      "Delete account",
      "settingsAccountDisposable",
      "destructiveMutation"
    ],
    [
      "data",
      "Anonymize Data",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data",
      "Cleanup",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data",
      "Delete Logs",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data",
      "Merge",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data",
      "Recalculate",
      "dataExact",
      "formMutation"
    ],
    [
      "data-offline-enabled",
      "Anonymize Data",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-enabled",
      "Cleanup",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-enabled",
      "Delete Logs",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-enabled",
      "Download Data",
      "dataExact",
      "download"
    ],
    [
      "data-offline-enabled",
      "Merge",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-enabled",
      "Recalculate",
      "dataExact",
      "formMutation"
    ],
    [
      "data-offline-enabled",
      "Review account deletion",
      "dataExact",
      "navigation"
    ],
    [
      "data-offline-enabled",
      "Save actions for offline use",
      "dataExact",
      "offlineToggle"
    ],
    [
      "data-offline-disabled",
      "Anonymize Data",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-disabled",
      "Cleanup",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-disabled",
      "Delete Logs",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-disabled",
      "Download Data",
      "dataExact",
      "download"
    ],
    [
      "data-offline-disabled",
      "Merge",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-offline-disabled",
      "Recalculate",
      "dataExact",
      "formMutation"
    ],
    [
      "data-offline-disabled",
      "Review account deletion",
      "dataExact",
      "navigation"
    ],
    [
      "data-offline-disabled",
      "Save actions for offline use",
      "dataExact",
      "offlineToggle"
    ],
    [
      "data-settings-action",
      "Anonymize Data",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-settings-action",
      "Cleanup",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-settings-action",
      "Delete Logs",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-settings-action",
      "Download Data",
      "dataExact",
      "download"
    ],
    [
      "data-settings-action",
      "Merge",
      "dataExact",
      "destructiveMutation"
    ],
    [
      "data-settings-action",
      "Recalculate",
      "dataExact",
      "formMutation"
    ],
    [
      "data-settings-action",
      "Review account deletion",
      "dataExact",
      "navigation"
    ],
    [
      "data-settings-action",
      "Save actions for offline use",
      "dataExact",
      "offlineToggle"
    ],
    [
      "logbook",
      "Add log",
      "loggingGaps",
      "localControl"
    ],
    [
      "logbook",
      "Apply filters",
      "loggingGaps",
      "navigation"
    ],
    [
      "logbook",
      "Bulk add",
      "loggingGaps",
      "navigation"
    ],
    [
      "logbook",
      "Delete",
      "loggingGaps",
      "rowDelete"
    ],
    [
      "logbook",
      "Edit",
      "loggingGaps",
      "navigation"
    ],
    [
      "log-add",
      "Add entry",
      "loggingGaps",
      "validatedMutation"
    ],
    [
      "log-add",
      "Add log",
      "loggingGaps",
      "localControl"
    ],
    [
      "log-add",
      "Apply filters",
      "loggingGaps",
      "navigation"
    ],
    [
      "log-add",
      "Bulk add",
      "loggingGaps",
      "navigation"
    ],
    [
      "log-add",
      "Cancel",
      "loggingGaps",
      "localControl"
    ],
    [
      "log-add",
      "Close add log dialog",
      "loggingGaps",
      "localControl"
    ],
    [
      "log-add",
      "Delete",
      "loggingGaps",
      "rowDelete"
    ],
    [
      "log-add",
      "Edit",
      "loggingGaps",
      "navigation"
    ],
    [
      "log-bulk",
      "Add entries",
      "loggingGaps",
      "validatedMutation"
    ],
    [
      "log-edit",
      "Save changes",
      "loggingGaps",
      "validatedMutation"
    ],
    [
      "logbook",
      "Log one Release Fixture, 3.5 milligrams",
      "loggingGaps",
      "quickMutation"
    ],
    [
      "logbook",
      "Log one Steady Mint, 6 milligrams",
      "loggingGaps",
      "quickMutation"
    ],
    [
      "log-add",
      "Log one Release Fixture, 3.5 milligrams",
      "loggingGaps",
      "quickMutation"
    ],
    [
      "log-add",
      "Log one Steady Mint, 6 milligrams",
      "loggingGaps",
      "quickMutation"
    ],
    [
      "log-bulk",
      "Cancel",
      "loggingGaps",
      "navigation"
    ],
    [
      "log-edit",
      "Cancel",
      "loggingGaps",
      "navigation"
    ],
    [
      "catalog",
      "Add a pouch",
      "catalog",
      "navigation"
    ],
    [
      "catalog",
      "Delete",
      "catalog",
      "rowDelete"
    ],
    [
      "catalog",
      "Edit",
      "catalog",
      "navigation"
    ],
    [
      "catalog",
      "Search",
      "catalog",
      "navigation"
    ],
    [
      "catalog-add",
      "Add pouch",
      "catalog",
      "validatedMutation"
    ],
    [
      "catalog-search",
      "← Back to all pouches",
      "catalog",
      "navigation"
    ],
    [
      "catalog-search",
      "Delete",
      "catalog",
      "rowDelete"
    ],
    [
      "catalog-search",
      "Edit",
      "catalog",
      "navigation"
    ],
    [
      "catalog-search",
      "Search",
      "catalog",
      "navigation"
    ],
    [
      "catalog-edit",
      "Save changes",
      "catalog",
      "validatedMutation"
    ],
    [
      "catalog-add",
      "← Your pouches",
      "catalogGaps",
      "navigation"
    ],
    [
      "catalog-add",
      "Cancel",
      "catalogGaps",
      "navigation"
    ],
    [
      "catalog-edit",
      "← Your pouches",
      "catalogGaps",
      "navigation"
    ],
    [
      "catalog-edit",
      "Cancel",
      "catalogGaps",
      "navigation"
    ],
    [
      "cravings",
      "Difficulty concentrating",
      "cravingsSymptoms",
      "draftToggle"
    ],
    [
      "cravings",
      "Increased appetite",
      "cravingsSymptoms",
      "draftToggle"
    ],
    [
      "cravings",
      "Irritability",
      "cravingsSymptoms",
      "draftToggle"
    ],
    [
      "cravings",
      "Restlessness",
      "cravingsSymptoms",
      "draftToggle"
    ],
    [
      "cravings",
      "Record craving",
      "cravingsRecord",
      "cravingRecord"
    ],
    [
      "cravings",
      "Get immediate support on Today",
      "cravingsLink",
      "primaryNavigation"
    ],
    [
      "goals",
      "Adjust goal",
      "goalsLifecycle",
      "navigation"
    ],
    [
      "goals",
      "Create a goal",
      "goalsLifecycle",
      "navigation"
    ],
    [
      "goals",
      "Delete goal",
      "goalsLifecycle",
      "rowDelete"
    ],
    [
      "goals",
      "Pause goal",
      "goalsLifecycle",
      "formMutation"
    ],
    [
      "goal-create",
      "Create goal",
      "goalsLifecycle",
      "validatedMutation"
    ],
    [
      "goal-create",
      "Notify me as I approach this goal",
      "goalsLifecycle",
      "draftToggle"
    ],
    [
      "goal-edit",
      "Keep this goal active",
      "goalsLifecycle",
      "draftToggle"
    ],
    [
      "goal-edit",
      "Notify me as I approach this goal",
      "goalsLifecycle",
      "draftToggle"
    ],
    [
      "goal-edit",
      "Save changes",
      "goalsLifecycle",
      "validatedMutation"
    ],
    [
      "goal-create",
      "Back to goals",
      "goalsGaps",
      "navigation"
    ],
    [
      "goal-create",
      "Cancel",
      "goalsGaps",
      "navigation"
    ],
    [
      "goal-progress",
      "Back to goals",
      "goalsGaps",
      "navigation"
    ],
    [
      "goal-edit",
      "Back to goals",
      "goalsGaps",
      "navigation"
    ],
    [
      "goal-edit",
      "Cancel",
      "goalsGaps",
      "navigation"
    ],
    [
      "dashboard",
      "7 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard",
      "30 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard",
      "90 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard",
      "1 year",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-empty",
      "7 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-empty",
      "30 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-empty",
      "90 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-empty",
      "1 year",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-sparse",
      "7 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-sparse",
      "30 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-sparse",
      "90 days",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard-sparse",
      "1 year",
      "dashboard",
      "rangeNavigation"
    ],
    [
      "dashboard",
      "Go to Today",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Open Insights",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "Review Journey",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Go to Today",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Open Insights",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-empty",
      "Review Journey",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Go to Today",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Open Insights",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "Review Journey",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard",
      "View daily values",
      "dashboard",
      "disclosure"
    ],
    [
      "dashboard-empty",
      "Start with Today",
      "dashboard",
      "primaryNavigation"
    ],
    [
      "dashboard-sparse",
      "View daily values",
      "dashboard",
      "disclosure"
    ],
    [
      "anonymous-not-found",
      "Back to the start page",
      "errors",
      "navigation"
    ],
    [
      "bad-request",
      "Return safely",
      "errors",
      "navigation"
    ],
    [
      "server-error",
      "Back to the start page",
      "errors",
      "navigation"
    ]
  ]
};


function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}


const BASELINE_OWNER_TITLES = deepFreeze({ ...BASELINE_SOURCE.owners });
const BASELINE_PROFILE_DIMENSIONS = deepFreeze({ ...BASELINE_SOURCE.profiles });
const SUPPORTING_ACTION_BASELINES = deepFreeze(BASELINE_SOURCE.entries.map(
  ([state, action, ownerKey, profile]) => ({
    state,
    action,
    owner: BASELINE_OWNER_TITLES[ownerKey],
    profile,
    dimensions: Object.fromEntries(BASELINE_DIMENSIONS.map((dimension) => [
      dimension,
      {
        status: BASELINE_PROFILE_DIMENSIONS[profile][dimension],
        reason: state + ' › ' + action + ': ' + profile + ' marks '
          + dimension + ' ' + BASELINE_PROFILE_DIMENSIONS[profile][dimension] + '.',
      },
    ])),
  }),
));
const SUPPORTING_BASELINE_STATES = deepFreeze([
  ...new Set(SUPPORTING_ACTION_BASELINES.map(({ state }) => state)),
]);


function supportingBaselineFor(state, action) {
  return SUPPORTING_ACTION_BASELINES.find((entry) => (
    entry.state === state && entry.action === action
  ));
}


module.exports = {
  BASELINE_DIMENSIONS,
  BASELINE_OWNER_TITLES,
  SUPPORTING_BASELINE_STATES,
  SUPPORTING_ACTION_BASELINES,
  supportingBaselineFor,
};
