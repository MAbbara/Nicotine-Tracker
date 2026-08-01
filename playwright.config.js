// @ts-check
// Playwright runs browser, accessibility, and visual specs only; Node unit
// tests (tests/js) stay with `node --test` and are never collected here.
// Browser binaries are not required for ordinary Python unit-test runs.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: ['browser/**/*.spec.js', 'accessibility/**/*.spec.js', 'visual/**/*.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every browser project shares one disposable in-memory Flask database.
  // A single worker keeps registration and draft writes isolated by test.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: ".venv/bin/python tests/browser/serve_test_app.py",
    url: 'http://127.0.0.1:5000/auth/login',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
