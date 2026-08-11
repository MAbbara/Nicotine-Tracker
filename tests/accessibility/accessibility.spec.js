const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { waitForVisibleDialogPanelsSettled } = require('../browser/helpers/dialog_motion');


async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();

  expect(results.violations).toEqual([]);
  await expectProjectTouchTargets(page);
}


async function expectProjectTouchTargets(page) {
  const undersized = await page.locator([
    'a[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]:not([aria-disabled="true"])',
    'summary',
  ].join(',')).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || rect.width === 0
      || rect.height === 0
    ) return [];

    const isInlineProseLink = element.matches('a[href]')
      && style.display === 'inline'
      && !element.classList.contains('c-button')
      && Boolean(element.closest('p, dd, dt, figcaption, small'));
    if (isInlineProseLink) return [];

    let target = element;
    if (
      element.matches('input[type="checkbox"], input[type="radio"]')
      && element.labels?.length
    ) {
      target = element.labels[0];
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width >= 44 && targetRect.height >= 44) return [];

    return [{
      tag: element.tagName.toLowerCase(),
      id: element.id,
      classes: [...element.classList],
      text: (element.textContent || element.getAttribute('aria-label') || '')
        .trim().slice(0, 80),
      width: Math.round(targetRect.width * 10) / 10,
      height: Math.round(targetRect.height * 10) / 10,
    }];
  }));

  expect(undersized).toEqual([]);
}


/* Entrance fades leave text mid-opacity; audits must measure the settled
   state users actually read. */
async function settleEntranceMotion(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.landing-rise, .rise').forEach((el) => {
      el.style.transition = 'none';
      el.classList.add('is-in');
    });
  });
}


async function login(page, email) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


async function relogin(page, email) {
  await page.context().clearCookies();
  await login(page, email);
}


function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push({
    kind: 'pageerror',
    text: error.stack || error.message,
    url: page.url(),
  }));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({
        kind: 'console',
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  return errors;
}


function expectNoUnexpectedBrowserErrors(
  errors,
  allowedStatus = null,
  expectedPath = null,
) {
  const unexpected = errors.filter((error) => {
    if (!allowedStatus) return true;
    let errorPath = null;
    try {
      errorPath = new URL(error.url).pathname;
    } catch {
      return true;
    }
    const isExpectedNavigationError = error.kind === 'console'
      && error.text.includes(`status of ${allowedStatus}`)
      && errorPath === new URL(expectedPath, 'http://browser.test').pathname;
    return !isExpectedNavigationError;
  });
  expect(unexpected).toEqual([]);
  errors.length = 0;
}


async function auditRoute(page, errors, path, heading, options = {}) {
  const response = await page.goto(path);
  if (options.status) expect(response.status()).toBe(options.status);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
  await waitForVisibleDialogPanelsSettled(page);
  await expectNoWcagViolations(page);
  expectNoUnexpectedBrowserErrors(
    errors,
    options.status >= 400 ? options.status : null,
    path,
  );
}


async function useExplicitTheme(page, theme) {
  await page.addInitScript((value) => {
    localStorage.setItem('nicotine-tracker-theme', value);
  }, theme);
}


async function expectExplicitTheme(page, theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}


async function expectKeyboardScrollable(region) {

  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAccessibleName(/plan|schedule|recent logs|log history/i);
  await region.focus();
  expect(await region.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
}


async function expectVisibleFocus(locator) {
  await expect(locator).toBeFocused();
  expect(await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2)
      || style.boxShadow !== 'none'
    );
  })).toBe(true);
}


async function expectNativeDialogKeyboardContract(
  page,
  { trigger, dialog, initialFocus },
) {
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expectVisibleFocus(trigger);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expectVisibleFocus(initialFocus);

  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Tab');
    const focus = await dialog.evaluate((element) => ({
      contained: element.contains(document.activeElement),
      active: document.activeElement?.outerHTML?.slice(0, 240) || null,
    }));
    expect(focus.contained, `Tab ${index + 1} focused ${focus.active}`).toBe(true);
  }
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expectVisibleFocus(trigger);
}


async function expectNoUncontainedHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const permittedScroller = (element) => {
      const candidate = element.closest([
        '.journey-table-scroll',
        '.analytics-data',
        '.settings-nav',
        '[data-horizontal-scroll]',
      ].join(','));
      if (!candidate) return false;
      const style = getComputedStyle(candidate);
      return ['auto', 'scroll'].includes(style.overflowX);
    };
    return {
      delta: document.documentElement.scrollWidth - viewportWidth,
      elements: [...document.querySelectorAll('body *')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        if (rect.left >= -1 && rect.right <= viewportWidth + 1) return [];
        if (permittedScroller(element)) return [];
        return [{
          tag: element.tagName.toLowerCase(),
          id: element.id,
          classes: [...element.classList].slice(0, 4),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        }];
      }).slice(0, 12),
    };
  });
  expect(overflow).toEqual({ delta: 0, elements: [] });
}


test('login page has semantic structure, natural tab order, and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');

  await expect(page.getByRole('heading', { name: 'Sign in to your account', level: 1 })).toBeVisible();
  await expect(page.locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveCount(0);
  await expectNoWcagViolations(page);
});


for (const [path, heading] of [
  ['/', 'Cut back at the pace of your own life.'],
  ['/auth/register', 'Create your account'],
  ['/auth/forgot_password', 'Reset your password'],
  ['/auth/reset_password/browser-accessibility-reset-token', 'Choose a new password'],
]) {
  test(`public page ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
    await expectNoWcagViolations(page);
  });
}


test('primary authenticated pages have one h1 and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  for (const path of ['/today', '/log/view', '/journey/', '/insights/', '/you']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoWcagViolations(page);
  }
});


test('primary destinations follow a visible keyboard order without positive tabindex', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const primary = page.getByRole('navigation', { name: 'Primary' });
  const destinations = ['Today', 'Logbook', 'Journey', 'Insights', 'You'];

  await expect(primary).toBeVisible();
  await expect(page.locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveCount(0);
  const today = primary.getByRole('link', { name: 'Today', exact: true });
  await today.focus();
  await expectVisibleFocus(today);
  for (const destination of destinations.slice(1)) {
    await page.keyboard.press('Tab');
    await expectVisibleFocus(primary.getByRole('link', { name: destination, exact: true }));
  }
});


test('quick log, craving support, and Add log dialogs trap and return keyboard focus', async ({ page }) => {
  await login(page, 'today-targeted@example.com');

  const quickLogTrigger = page.locator('#today-log-action');
  await expectNativeDialogKeyboardContract(page, {
    trigger: quickLogTrigger,
    dialog: page.getByRole('dialog', { name: 'Log nicotine use' }),
    initialFocus: page.getByRole('dialog', { name: 'Log nicotine use' })
      .getByRole('button', { name: 'Log one pouch' }),
  });

  const cravingTrigger = page.locator('#today-craving-action');
  await expectNativeDialogKeyboardContract(page, {
    trigger: cravingTrigger,
    dialog: page.getByRole('dialog', { name: 'Take the next useful step' }),
    initialFocus: page.getByRole('dialog', { name: 'Take the next useful step' })
      .getByRole('heading', { name: 'How strong is it right now?' }),
  });

  await page.goto('/log/view');
  const addLogTrigger = page.getByRole('button', { name: 'Add log', exact: true });
  await expectNativeDialogKeyboardContract(page, {
    trigger: addLogTrigger,
    dialog: page.getByRole('dialog', { name: 'Add a log' }),
    initialFocus: page.getByRole('dialog', { name: 'Add a log' }).getByLabel('Date'),
  });
});


test('Quick Log Escape recovers to main when its opener is disconnected', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const quickLogTrigger = page.locator('#today-log-action');
  const quickLogDialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  await quickLogTrigger.click();
  await expect(quickLogDialog).toBeVisible();
  await quickLogTrigger.evaluate((element) => element.remove());
  await page.keyboard.press('Escape');
  await expect(quickLogDialog).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();
});


test('craving Escape recovers to main when its opener is hidden', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const cravingTrigger = page.locator('#today-craving-action');
  const cravingDialog = page.getByRole('dialog', { name: 'Take the next useful step' });
  await cravingTrigger.click();
  await expect(cravingDialog).toBeVisible();
  await cravingTrigger.evaluate((element) => { element.hidden = true; });
  await page.keyboard.press('Escape');
  await expect(cravingDialog).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();
});


test('Quick Log explicit close preserves intentional visible focus', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  const quickLogTrigger = page.locator('#today-log-action');
  const quickLogDialog = page.getByRole('dialog', { name: 'Log nicotine use' });
  const journey = page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Journey', exact: true });
  await quickLogTrigger.click();
  const closeQuickLog = quickLogDialog.getByRole('button', { name: 'Close quick log' });
  await closeQuickLog.evaluate((button) => {
    button.addEventListener('click', () => {
      button.closest('dialog').close();
      document.querySelector('nav[aria-label="Primary"] a[href*="journey"]')?.focus();
    }, { once: true });
  });
  await closeQuickLog.click();
  await expect(quickLogDialog).toBeHidden();
  await expect(journey).toBeFocused();
});


test('Add Log explicit cancel recovers to main when its opener is disconnected', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/log/view');
  const addLogTrigger = page.getByRole('button', { name: 'Add log', exact: true });
  const addLogDialog = page.getByRole('dialog', { name: 'Add a log' });
  await addLogTrigger.click();
  await expect(addLogDialog).toBeVisible();
  await addLogTrigger.evaluate((element) => element.remove());
  await addLogDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(addLogDialog).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();
});


test('Today, Insights, You, Profile, and Logbook support 200% text and reduced motion', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await login(page, 'today-targeted@example.com');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  for (const [path, heading] of [
    ['/today', 'Today'],
    ['/insights/', 'Insights'],
    ['/you/', 'You'],
    ['/settings/profile', 'Profile'],
    ['/log/view', 'Logbook'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expectNoUncontainedHorizontalOverflow(page);
    await expectNoWcagViolations(page);
    expectNoUnexpectedBrowserErrors(errors);
  }

  await page.goto('/you/');
  await page.locator('.you-links > a strong').evaluateAll((labels) => {
    labels.forEach((label, index) => {
      label.textContent = `A deliberately long account preference label ${index + 1}`;
    });
  });
  const youLinkGeometry = await page.locator('.you-links > a').evaluateAll((links) => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: links.map((link) => {
      const copy = link.querySelector(':scope > span:nth-child(2)').getBoundingClientRect();
      const arrow = link.querySelector(':scope > span[aria-hidden="true"]').getBoundingClientRect();
      return {
        copyRight: copy.right,
        arrowLeft: arrow.left,
        linkRight: link.getBoundingClientRect().right,
        arrowRight: arrow.right,
      };
    }),
  }));
  expect(youLinkGeometry.overflow).toBeLessThanOrEqual(1);
  for (const row of youLinkGeometry.rows) {
    expect(row.copyRight).toBeLessThanOrEqual(row.arrowLeft + 1);
    expect(row.arrowRight).toBeLessThanOrEqual(row.linkRight + 1);
  }

  await page.goto('/today');
  const checkIn = page.locator('[data-check-in-open]:visible, [data-check-in-edit]:visible').first();
  await checkIn.scrollIntoViewIfNeeded();
  await checkIn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-check-in-form]')).toBeVisible();
  const motion = await page.locator('[data-check-in-root]').evaluate((element) => {
    const style = getComputedStyle(element);
    const seconds = (values) => values.split(',').map((value) => (
      parseFloat(value) * (value.includes('ms') ? 0.001 : 1)
    ));
    return Math.max(...seconds(style.animationDuration), ...seconds(style.transitionDuration));
  });
  expect(motion).toBeLessThanOrEqual(0.001);
});


test('remaining first-party route matrix has one h1, clean console, and no WCAG A/AA violations', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await login(page, 'browser@example.com');
  let editPouchHref = null;

  for (const [path, heading] of [
    ['/today', 'Today'],
    ['/journey/onboarding', 'Shape a plan you can learn from'],
    ['/insights/', 'Insights'],
    ['/you', 'You'],
    ['/settings/profile', 'Profile'],
    ['/settings/account', 'Account'],
    ['/settings/preferences', 'Preferences'],
    ['/settings/notifications', 'Reminders'],
    ['/settings/data', 'Data & privacy'],
    ['/settings/statistics', 'Statistics'],
    ['/log/view', 'Logbook'],
    ['/log/add', 'Logbook'],
    ['/log/bulk', 'Bulk add logs'],
    ['/catalog/', 'Your pouches'],
    ['/catalog/add', 'Add a pouch'],
    ['/catalog/search?q=Steady', 'Search pouches'],
    ['/cravings/cravings', 'Craving history'],
    ['/goals/', 'Goals'],
    ['/goals/create', 'Create a goal'],
    ['/dashboard/', 'Dashboard'],
  ]) {
    await auditRoute(page, errors, path, heading);
    if (path === '/log/add') {
      await expect(page.getByRole('dialog', { name: 'Add a log' })).toBeVisible();
    }
    if (path === '/catalog/') {
      editPouchHref = await page.getByRole('link', { name: 'Edit' })
        .first().getAttribute('href');
    }
  }
  await auditRoute(page, errors, editPouchHref, 'Edit pouch');
});


test('populated analytics, edit forms, and goal progress pass the full accessibility contract', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await login(page, 'today-targeted@example.com');

  for (const [path, heading] of [
    ['/today', 'Today'],
    ['/insights/', 'Insights'],
    ['/dashboard/', 'Dashboard'],
    ['/log/view', 'Logbook'],
  ]) {
    await auditRoute(page, errors, path, heading);
  }

  const editLogHref = await page.getByRole('link', { name: 'Edit' }).first().getAttribute('href');
  await auditRoute(page, errors, editLogHref, 'Edit log');

  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await relogin(page, `journey-review-${project}@example.com`);
  let editGoalHref = null;
  for (const [path, heading] of [
    ['/journey/', 'Journey'],
    ['/goals/', 'Goals'],
    ['/goals/progress', 'Goal progress'],
  ]) {
    await auditRoute(page, errors, path, heading);
    if (path === '/goals/') {
      editGoalHref = await page.getByRole('link', { name: 'Adjust goal' }).first().getAttribute('href');
    }
  }

  await auditRoute(page, errors, editGoalHref, 'Adjust goal');
});


test('Goal progress supports narrow dark 200% text and reduced motion without page overflow', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useExplicitTheme(page, 'dark');
  await page.setViewportSize({ width: 320, height: 800 });
  const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await login(page, `journey-review-${project}@example.com`);
  await page.goto('/goals/progress');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  await expectExplicitTheme(page, 'dark');
  await expect(page.getByRole('heading', { name: 'Goal progress', level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  const pageOverflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return {
      delta: document.documentElement.scrollWidth - viewportWidth,
      elements: [...document.querySelectorAll('body *')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right <= viewportWidth + 1 && rect.left >= -1) return [];
        const containingScroller = element.parentElement?.closest(
          '.journey-table-scroll, [data-horizontal-scroll]',
        );
        if (containingScroller) {
          const overflow = getComputedStyle(containingScroller).overflowX;
          if (overflow === 'auto' || overflow === 'scroll') return [];
        }
        return [{
          tag: element.tagName.toLowerCase(),
          classes: [...element.classList].slice(0, 4),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }];
      }).slice(0, 12),
    };
  });
  expect(pageOverflow).toEqual({ delta: 0, elements: [] });

  const history = page.getByRole('region', { name: 'Thirty-day goal record' }).first();
  await expect(history).toBeVisible();
  await expect(history).toHaveAttribute('tabindex', '0');
  expect(await history.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expectNoWcagViolations(page);
  expectNoUnexpectedBrowserErrors(errors);
});


test('400, 404, and 500 pages pass the accessibility and console contract', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  for (const [path, heading, status] of [
    ['/__test__/error/400', 'Refresh and try again', 400],
    ['/missing-accessibility-fixture', 'Page not found', 404],
    ['/__test__/error/500', 'Something went wrong on our end', 500],
  ]) {
    await auditRoute(page, errors, path, heading, { status });
  }
});


test('Insights editorial figures expose labelled keyboard-accessible data', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/insights/');

  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0);
  const regions = page.locator('.analytics-data');
  expect(await regions.count()).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < await regions.count(); index += 1) {
    const region = regions.nth(index);
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveAttribute('aria-label', /data/i);
  }
  await expectNoWcagViolations(page);
});


test('Data & Privacy has a labelled retention control and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill('browser@example.com');
  await page.getByLabel('Password').fill('browser-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);

  await page.goto('/settings/data');
  const daysToKeep = page.getByLabel('Days to keep');
  await expect(daysToKeep).toBeVisible();
  await expect(daysToKeep).toHaveAttribute('required', '');
  await expect(daysToKeep).toHaveAttribute('aria-describedby', 'days_to_keep_help');
  await expect(page.getByRole('checkbox', { name: 'Save actions for offline use' })).toBeVisible();
  await expectNoWcagViolations(page);
});


test('Statistics has an editorial fact list and no WCAG A/AA violations', async ({ page }) => {
  await login(page, 'browser@example.com');
  await page.goto('/settings/statistics');
  await expect(page.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
  await expect(page.locator('dl.statistics-facts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore patterns in Insights' })).toBeVisible();
  await expectNoWcagViolations(page);
});


for (const theme of ['light', 'dark']) {
  test(`Data and Statistics meet WCAG A/AA in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'browser@example.com');

    for (const [path, heading] of [
      ['/settings/data', 'Data & privacy'],
      ['/settings/statistics', 'Statistics'],
    ]) {
      await page.goto(path);
      await expectExplicitTheme(page, theme);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expectNoWcagViolations(page);
    }
  });
}


for (const theme of ['light', 'dark']) {
  test(`Reminders failure feedback meets WCAG A/AA in ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await page.route('**/settings/test-discord-webhook', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Discord rejected the test.' }),
      });
    });
    await login(page, 'browser@example.com');
    await page.goto('/settings/notifications');
    await expectExplicitTheme(page, theme);
    await page.getByRole('checkbox', { name: 'Discord' }).check();
    await page.getByLabel('Discord webhook URL').fill(
      'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789',
    );
    await page.getByRole('button', { name: 'Test Discord connection' }).click();
    await expect(page.locator('#discord-test-status')).toHaveAttribute('data-state', 'error');
    await expectNoWcagViolations(page);
  });
}


test('Settings navigation is labelled, scrollable, and keeps one visible current page', async ({ page }) => {
  await login(page, 'browser@example.com');
  await page.setViewportSize({ width: 320, height: 800 });

  for (const [path, heading] of [
    ['/settings/profile', 'Profile'],
    ['/settings/data', 'Data & privacy'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toHaveCount(1);
    const nav = page.getByRole('navigation', { name: 'Settings' });
    await expect(nav).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav).toHaveAttribute('tabindex', '0');
    expect(await nav.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await nav.focus();
    expect(await nav.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);
  }

  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/settings/profile');
  const savePadding = await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'settings-save-row';
    document.querySelector('.settings-content').append(row);
    return parseFloat(getComputedStyle(row).paddingBottom);
  });
  expect(savePadding).toBeGreaterThanOrEqual(76);
});


for (const theme of ['light', 'dark']) {
  test(`populated Journey has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await useExplicitTheme(page, theme);
    const project = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
    await login(page, `journey-review-${project}@example.com`);
    await page.goto('/journey/');

    await expectExplicitTheme(page, theme);
    const schedule = page.getByRole('region', {
      name: '7-day plan',
      exact: true,
    });
    await expect(schedule).toHaveCount(1);
    await expect(schedule).toBeVisible();
    const scheduleContrast = await schedule.locator(
      'tr[aria-current="date"] > th[scope="row"] > span',
    ).evaluate((currentLabel) => {
      const parseRgb = (value) => {
        if (value.startsWith('#')) {
          return [1, 3, 5].map((index) => Number.parseInt(
            value.slice(index, index + 2), 16,
          ));
        }
        return value.match(/[\d.]+/g).slice(0, 3).map(Number);
      };
      const luminance = (value) => {
        const channels = parseRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
      };
      const foreground = getComputedStyle(currentLabel).color;
      const background = getComputedStyle(currentLabel.closest('tr')).backgroundColor;
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const ratio = (
        Math.max(foregroundLuminance, backgroundLuminance) + 0.05
      ) / (
        Math.min(foregroundLuminance, backgroundLuminance) + 0.05
      );
      const noncurrentLabel = currentLabel.closest('tbody').querySelector(
        'tr:not([aria-current="date"]) > th[scope="row"] > span',
      );
      return {
        foreground,
        background,
        ratio,
        noncurrent: parseRgb(getComputedStyle(noncurrentLabel).color),
        muted: parseRgb(getComputedStyle(document.documentElement)
          .getPropertyValue('--color-text-muted').trim()),
      };
    });
    expect(scheduleContrast.ratio, JSON.stringify(scheduleContrast))
      .toBeGreaterThanOrEqual(5);
    expect(scheduleContrast.noncurrent).toEqual(scheduleContrast.muted);
    await expectNoWcagViolations(page);
  });

  test(`populated dashboard has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/dashboard/');

    await expectExplicitTheme(page, theme);
    await expect(page.locator('[data-dashboard-today]')).toBeVisible();
    await expect(page.locator('[data-dashboard-trend]')).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`populated log history has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/log/view');

    await expectExplicitTheme(page, theme);
    await expect(page.locator('.logbook-row')).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`authenticated 404 has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await login(page, 'today-targeted@example.com');
    await page.goto('/missing-accessibility-fixture');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
}


test('populated Journey mobile overflow is keyboard accessible', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Overflow geometry is mobile-specific');
  await login(page, 'journey-review-mobile@example.com');
  await page.goto('/journey/');

  const schedule = page.getByRole('region', {
    name: '7-day plan',
    exact: true,
  });
  await expect(schedule).toHaveCount(1);
  await expect(schedule).toBeVisible();
  await expectKeyboardScrollable(schedule);
});


test('authenticated 404 has one main landmark and a Today recovery link', async ({ page }) => {
  await login(page, 'today-targeted@example.com');
  await page.goto('/missing-accessibility-fixture');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
});


test('anonymous 404 has one main landmark, a landing recovery action, and no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/missing-accessibility-fixture');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const recovery = main.getByRole('link', { name: 'Back to the start page', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute('href', '/');
  await expectNoWcagViolations(page);
});


for (const theme of ['light', 'dark']) {
  test(`anonymous 404 has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }) => {
    await useExplicitTheme(page, theme);
    await page.goto('/missing-accessibility-fixture');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
}


function deterministicA11yEmail(testInfo, label) {
  const retry = Number(testInfo.retry) || 0;
  const repeat = Number(testInfo.repeatEachIndex) || 0;
  const source = `${testInfo.project.name}:${testInfo.title}:${retry}:${repeat}:${label}`;
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return `a11y-journey-${hash}@example.com`;
}


async function releaseIsoDate(page, daysFromToday = 0) {
  const response = await page.request.get('/__test__/release-clock');
  expect(response.status()).toBe(200);
  const { fixed_now: fixedNow } = await response.json();
  const value = new Date(fixedNow);
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}


async function registerAndCreatePlan(page, testInfo, label) {
  await page.goto('/auth/register');
  await page.getByLabel('Email address').fill(deterministicA11yEmail(testInfo, label));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('browser-password');
  await page.getByLabel('Confirm Password').fill('browser-password');
  await page.getByLabel(/I understand this is a personal tracking tool/i).check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/journey\/onboarding\/?$/);
  await page.locator('input[name="intention"][value="reduce"]').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="baseline_source"][value="manual"]').check();
  await page.locator('#field-baseline_mg').fill('48');
  await page.locator('#field-baseline_mg_per_pouch').fill('6');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Steady · 49 days/).check();
  await page.getByLabel(/End target nicotine per day/).fill('12');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('No reminder').check();
  await page.getByLabel('Plan start date').fill(await releaseIsoDate(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Activate this reviewed plan' }).click();
  await expect(page).toHaveURL(/\/today\/?$/);
}


for (const theme of ['light', 'dark']) {
  test(`active Journey overview has no WCAG A/AA violations in explicit ${theme} theme`, async ({ page }, testInfo) => {
    await useExplicitTheme(page, theme);
    await registerAndCreatePlan(page, testInfo, `overview-${theme}`);
    await page.goto('/journey/');

    await expectExplicitTheme(page, theme);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('[data-journey-scorecard]')).toContainText(/mg/i);
    await expect(page.locator('[data-next-change]')).toContainText(/mg/i);
    await expect(page.locator('[data-path-chart]')).toHaveAttribute(
      'aria-label',
      /nicotine.*mg/i,
    );
    await expect(page.locator('[data-plan-editor="revision"]')).toHaveCount(1);
    await expect(page.locator('[data-path-editor]')).toHaveCount(0);
    for (const action of ['pause', 'complete', 'archive']) {
      await expect(page.locator(`.journey-plan form[action$="/${action}"]`)).toHaveCount(1);
    }

    // Audit the richest state with the sole feature editor's preview visible.
    const editor = page.locator('[data-plan-editor="revision"]');
    await editor.getByLabel('Effective date').fill(await releaseIsoDate(page, 1));
    await editor.getByLabel('Duration days').fill('42');
    await editor.getByRole('button', { name: 'Preview revision' }).click();
    await expect(editor.locator('[data-plan-editor-preview] tbody tr')).not.toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Confirm revision' })).toBeVisible();

    // Entrance effects must not leave audited text partially transparent.
    await page.evaluate(() => document.querySelectorAll('.rise').forEach((el) => {
      el.style.transition = 'none';
      el.classList.add('is-in');
    }));
    await expectNoWcagViolations(page);

    // Milestone tooltip is keyboard-reachable and visible without a pointer.
    await page.locator('.path-hotspot').first().focus();
    await expect(page.locator('[data-chart-tooltip]')).toBeVisible();
    await expect(page.locator('[data-chart-tooltip]')).toContainText(/\d+(?:\.\d{2})? mg/i);
    await expect(page.locator('[data-chart-tooltip]')).not.toContainText(/pouches?/i);
    await expectNoWcagViolations(page);

    // The chart scroll region stays keyboard-accessible at 200% text.
    const scroll = page.locator('.path-scroll');
    await expect(scroll).toHaveAttribute('tabindex', '0');
    await expect(scroll).toHaveAccessibleName(/nicotine ceiling path/i);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    if (testInfo.project.name.includes('mobile')) {
      expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    await expectNoWcagViolations(page);
  });
}
