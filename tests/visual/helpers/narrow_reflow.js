const { expect } = require('@playwright/test');


async function collectNarrowReflowFacts(page, { kind, stateName }) {
  return page.evaluate(({ captureKind, captureState }) => {
    const visible = (element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('details:not([open])')) continue;
        const summary = ancestor.querySelector(':scope > summary');
        if (!summary?.contains(element)) return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };
    const lineCount = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const tops = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => Math.round(rect.top));
      return new Set(tops).size;
    };
    const hasHorizontalScrollAncestor = (element, stopAt) => {
      for (let parent = element.parentElement; parent && parent !== stopAt; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (['auto', 'scroll'].includes(overflow)) return true;
      }
      return false;
    };
    const measureText = (element, text) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
        .filter(Boolean).join(' ');
      return context.measureText(text).width;
    };

    const root = document.documentElement;
    const documentOverflowElements = [...document.body.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > root.clientWidth + 1;
      })
      .filter((element) => !element.closest('.horizontal-scroll-region, .analytics-data'))
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.innerText || element.value || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        rect: rectOf(element),
      }));
    const nav = document.querySelector('.primary-nav');
    const main = document.querySelector('main');
    const navRect = nav && visible(nav) ? rectOf(nav) : null;
    const mainStyle = main ? getComputedStyle(main) : null;
    const navLinks = navRect ? [...nav.querySelectorAll('.primary-nav__link')].map((link) => {
      const label = link.querySelector('span');
      const rect = rectOf(link);
      return {
        label: label?.textContent.trim() || '',
        top: rect.top,
        width: rect.width,
        height: rect.height,
        inside: rect.left >= navRect.left - 1
          && rect.right <= navRect.right + 1
          && rect.top >= navRect.top - 1
          && rect.bottom <= navRect.bottom + 1,
        labelLines: label ? lineCount(label) : 0,
        labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
        labelWhiteSpace: label ? getComputedStyle(label).whiteSpace : null,
      };
    }) : [];

    const dialog = document.querySelector('dialog[open]');
    const dialogRect = dialog ? rectOf(dialog) : null;
    const contentRoot = dialog || main || document.body;
    const horizontalControlProblems = [...contentRoot.querySelectorAll(
      'button, input, select, textarea, a.c-button, [role="button"]',
    )].filter(visible).filter((element) => !element.closest('.primary-nav')).filter((element) => {
      if (hasHorizontalScrollAncestor(element, contentRoot)) return false;
      const rect = element.getBoundingClientRect();
      const leftEdge = dialogRect ? Math.max(dialogRect.left, 0) : 0;
      const rightEdge = dialogRect ? Math.min(dialogRect.right, root.clientWidth) : root.clientWidth;
      return rect.left < leftEdge - 1
        || rect.right > rightEdge + 1
        || (
          !element.matches('input, select, textarea')
          && element.scrollWidth > element.clientWidth + 1
        );
    }).map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.value || element.getAttribute('aria-label') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 80),
      rect: rectOf(element),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const labelInternalProblems = [...contentRoot.querySelectorAll('a, button, label')]
      .filter(visible)
      .filter((element) => !element.closest('.primary-nav'))
      .filter((element) => (element.innerText || '').trim())
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: element.innerText.trim().replace(/\s+/g, ' ').slice(0, 80),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        insideHorizontalScroller: hasHorizontalScrollAncestor(element, contentRoot),
      }));
    const nativeControlFitProblems = [...contentRoot.querySelectorAll(
      'select, input[type="date"], input[type="time"]',
    )].filter(visible).map((element) => {
      const style = getComputedStyle(element);
      let visibleText = '';
      let affordanceAllowance = 0;
      if (element instanceof HTMLSelectElement) {
        visibleText = element.selectedOptions[0]?.textContent.trim() || '';
        affordanceAllowance = 32;
      } else if (element.type === 'date') {
        visibleText = element.value ? '08/03/2026' : 'mm/dd/yyyy';
        affordanceAllowance = 36;
      } else {
        visibleText = element.value ? '11:59 PM' : '--:-- --';
        affordanceAllowance = 36;
      }
      const requiredWidth = measureText(element, visibleText)
        + Number.parseFloat(style.paddingInlineStart)
        + Number.parseFloat(style.paddingInlineEnd)
        + Number.parseFloat(style.borderInlineStartWidth)
        + Number.parseFloat(style.borderInlineEndWidth)
        + affordanceAllowance;
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        type: element.type,
        visibleText,
        clientWidth: element.clientWidth,
        fontSize: Number.parseFloat(style.fontSize),
        requiredWidth,
      };
    }).filter(({ clientWidth, requiredWidth }) => requiredWidth > clientWidth + 1);
    const visiblePlaceholderFitProblems = [...contentRoot.querySelectorAll(
      '#logbook-search[type="search"]',
    )].filter(visible).filter((element) => !element.value && element.placeholder).map((element) => {
      const style = getComputedStyle(element);
      const searchAffordanceAllowance = 24;
      const requiredWidth = measureText(element, element.placeholder)
        + Number.parseFloat(style.paddingInlineStart)
        + Number.parseFloat(style.paddingInlineEnd)
        + Number.parseFloat(style.borderInlineStartWidth)
        + Number.parseFloat(style.borderInlineEndWidth)
        + searchAffordanceAllowance;
      return {
        id: element.id,
        placeholder: element.placeholder,
        clientWidth: element.clientWidth,
        fontSize: Number.parseFloat(style.fontSize),
        requiredWidth,
      };
    }).filter(({ clientWidth, requiredWidth }) => requiredWidth > clientWidth + 1);

    const dialogHorizontalProblems = dialog ? [...dialog.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => !hasHorizontalScrollAncestor(element, dialog))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < Math.max(dialogRect.left, 0) - 1
          || rect.right > Math.min(dialogRect.right, root.clientWidth) + 1
          || element.scrollWidth > element.clientWidth + 1;
      }).filter((element) => !element.matches('svg, path, .u-visually-hidden, .sr-only'))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.innerText || element.value || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: rectOf(element),
      })) : [];
    const dialogComputedScrollOwners = dialog ? [dialog, ...dialog.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => !element.matches('input, select, textarea'))
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowY;
        return ['auto', 'scroll'].includes(overflow);
      }).map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
        actuallyScrolling: element.scrollHeight > element.clientHeight + 1,
      })) : [];

    const todayFacts = [...document.querySelectorAll('.today-status__facts')].map((facts) => {
      const parentWidth = facts.getBoundingClientRect().width;
      return [...facts.children].map((child) => ({
        parentWidth,
        width: child.getBoundingClientRect().width,
      }));
    }).flat();
    const todayTimelineCopies = [...document.querySelectorAll('.today-timeline__copy')]
      .filter(visible)
      .map((copy) => ({
        width: copy.getBoundingClientRect().width,
        itemWidth: copy.closest('.today-timeline__item').getBoundingClientRect().width,
      }));
    const journeyButtons = [...document.querySelectorAll('.journey-editor__buttons .c-button')]
      .filter(visible)
      .map((button) => ({
        text: button.textContent.trim(),
        clipped: button.scrollWidth > button.clientWidth + 1,
        rect: rectOf(button),
      }));
    const journeyPreviewTable = document.querySelector(
      '[data-plan-editor="revision"] [data-plan-editor-preview]:not([hidden]) table',
    );
    const journeyPreviewScroller = journeyPreviewTable?.closest(
      '.journey-editor__preview, .journey-table-scroll, .horizontal-scroll-region',
    );
    const dialogHeadings = dialog ? [...dialog.querySelectorAll('h1, h2, h3')]
      .filter(visible)
      .map((heading) => ({ text: heading.textContent.trim(), lines: lineCount(heading) })) : [];

    return {
      captureKind,
      captureState,
      document: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        overflowElements: documentOverflowElements,
      },
      nav: navRect ? {
        rect: navRect,
        links: navLinks,
        mainPaddingBottom: Number.parseFloat(mainStyle?.paddingBottom) || 0,
      } : null,
      horizontalControlProblems,
      labelInternalProblems,
      nativeControlFitProblems,
      visiblePlaceholderFitProblems,
      dialog: dialogRect ? {
        rect: dialogRect,
        horizontalProblems: dialogHorizontalProblems,
        computedScrollOwners: dialogComputedScrollOwners,
        headings: dialogHeadings,
      } : null,
      todayFacts,
      todayTimelineCopies,
      journeyButtons,
      journeyPreview: journeyPreviewTable ? {
        hasLocalScroller: Boolean(journeyPreviewScroller),
        scrollerRect: journeyPreviewScroller ? rectOf(journeyPreviewScroller) : null,
      } : null,
    };
  }, { captureKind: kind, captureState: stateName });
}


async function expectFinalActionClearsNav(page, stateName) {
  const clearance = await page.evaluate(async () => {
    const visible = (element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('details:not([open])')) continue;
        const summary = ancestor.querySelector(':scope > summary');
        if (!summary?.contains(element)) return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const nav = document.querySelector('.primary-nav');
    const main = document.querySelector('main');
    if (!nav || !main) return null;
    const actions = [...main.querySelectorAll([
      'a[href]',
      'button:not([disabled])',
      'input[type="button"]:not([disabled])',
      'input[type="submit"]:not([disabled])',
    ].join(', '))].filter(visible).filter((element) => !element.closest('dialog'));
    const finalAction = actions.at(-1);
    if (!finalAction) return { action: null };
    finalAction.focus({ preventScroll: true });
    finalAction.scrollIntoView({ behavior: 'instant', block: 'end', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const actionRect = finalAction.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      action: (finalAction.innerText || finalAction.value || finalAction.getAttribute('aria-label') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 80),
      actionBottom: actionRect.bottom,
      navTop: navRect.top,
    };
  });
  expect(clearance, `${stateName}: page must expose a final action and fixed navigation`).not.toBeNull();
  expect(clearance.action, `${stateName}: page must expose a final actionable control`).toBeTruthy();
  expect(
    clearance.actionBottom,
    `${stateName}: final action “${clearance.action}” must scroll fully above the fixed navigation`,
  ).toBeLessThanOrEqual(clearance.navTop + 1);
}


async function expectNarrowSurface(page, result, {
  kind = 'page',
  maxNavRows,
  stateName,
  expectedWidth,
  requireSingleNavRow = false,
}) {
  const facts = await collectNarrowReflowFacts(page, { kind, stateName });
  expect(
    facts.document.scrollWidth,
    `${stateName}: document must not scroll horizontally at the narrow viewport; `
      + `outside elements: ${JSON.stringify(facts.document.overflowElements)}`,
  ).toBe(facts.document.clientWidth);

  if (facts.nav && kind !== 'dialog') {
    expect(
      facts.nav.links.filter((link) => (
        link.width < 44
        || link.height < 44
        || !link.inside
        || link.labelLines !== 1
        || link.labelClipped
        || link.labelWhiteSpace !== 'nowrap'
      )),
      `${stateName}: all four primary destinations must stay usable with intact one-line labels`,
    ).toEqual([]);
    if (requireSingleNavRow) {
      const navLinkTops = await page.locator('.primary-nav__link').evaluateAll((links) => (
        [...new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))]
      ));
      expect(
        navLinkTops,
        `${stateName}: normal narrow navigation must keep four familiar destinations in one row`,
      ).toHaveLength(1);
    }
    if (maxNavRows) {
      const navLinkTops = new Set(facts.nav.links.map((link) => Math.round(link.top)));
      expect(
        navLinkTops.size,
        `${stateName}: enlarged-text navigation must use no more than ${maxNavRows} rows`,
      ).toBeLessThanOrEqual(maxNavRows);
    }
    expect(
      facts.nav.mainPaddingBottom,
      `${stateName}: main content must reserve the measured fixed-navigation height`,
    ).toBeGreaterThanOrEqual(facts.nav.rect.height);
  }

  expect(
    facts.horizontalControlProblems,
    `${stateName}: visible controls and actions must remain fully inside their content surface`,
  ).toEqual([]);
  expect(
    facts.labelInternalProblems,
    `${stateName}: visible action labels must fit internally, including inside local scrollers`,
  ).toEqual([]);
  expect(
    facts.nativeControlFitProblems,
    `${stateName}: native select/date/time values must fit with padding and browser affordances`,
  ).toEqual([]);
  expect(
    facts.visiblePlaceholderFitProblems,
    `${stateName}: the empty Logbook search must show its complete visible placeholder`,
  ).toEqual([]);

  if (stateName === 'today') {
    expect(facts.todayFacts.length, 'Today plan facts must be present').toBeGreaterThan(0);
    expect(
      facts.todayFacts.filter(({ parentWidth, width }) => width < parentWidth - 1),
      'Today plan facts must deliberately stack to the full readable width',
    ).toEqual([]);
    expect(facts.todayTimelineCopies.length, 'Today timeline copy must be present').toBeGreaterThan(0);
    expect(
      facts.todayTimelineCopies.filter(({ itemWidth, width }) => width < itemWidth * 0.6),
      'Today timeline copy must retain normal word-flow width',
    ).toEqual([]);
  }

  if (stateName === 'journey-revision') {
    expect(facts.journeyButtons.length, 'Journey revision actions must be present').toBe(2);
    expect(
      facts.journeyButtons.filter(({ clipped, rect }) => clipped || rect.left < 0 || rect.right > 320),
      'Journey revision action labels must remain fully visible',
    ).toEqual([]);
    expect(facts.journeyPreview?.hasLocalScroller, 'Journey preview table needs a local scroller').toBe(true);
    expect(facts.journeyPreview.scrollerRect.right).toBeLessThanOrEqual(321);
  }

  if (kind === 'dialog') {
    expect(facts.dialog, `${stateName}: expected an open dialog`).not.toBeNull();
    expect(facts.dialog.rect.left).toBeGreaterThanOrEqual(0);
    expect(
      facts.dialog.rect.right,
      `${stateName}: dialog must stay inside the document client width`,
    ).toBeLessThanOrEqual(facts.document.clientWidth);
    expect(facts.dialog.rect.top).toBeGreaterThanOrEqual(0);
    expect(facts.dialog.rect.bottom).toBeLessThanOrEqual(900);
    expect(
      facts.dialog.horizontalProblems,
      `${stateName}: dialog content must wrap inside the visual viewport`,
    ).toEqual([]);
    expect(
      facts.dialog.computedScrollOwners.length,
      `${stateName}: dialog must declare exactly one intended vertical scroll owner`,
    ).toBe(1);
    expect(
      facts.dialog.computedScrollOwners.filter(({ actuallyScrolling }) => actuallyScrolling).length,
      `${stateName}: dialog must have no more than one actively scrolling surface`,
    ).toBeLessThanOrEqual(1);
    expect(
      facts.dialog.headings.filter(({ lines }) => lines > 4),
      `${stateName}: dialog headings must wrap as phrases, not isolated word stacks`,
    ).toEqual([]);
  }

  if (kind !== 'dialog') await expectFinalActionClearsNav(page, stateName);
  expect(result.geometry.viewport.width).toBe(expectedWidth);
}


async function expectNarrowReflow(page, result, { kind = 'page', stateName }) {
  await expectNarrowSurface(page, result, {
    kind,
    maxNavRows: kind === 'dialog' ? undefined : 2,
    stateName,
    expectedWidth: 320,
  });
}


async function expectNarrowMobileReflow(page, result, { kind = 'page', stateName, width }) {
  await expectNarrowSurface(page, result, {
    kind,
    stateName,
    expectedWidth: width,
    requireSingleNavRow: kind !== 'dialog',
  });
  const undersizedNativeControls = await page.locator(
    'select, input[type="date"], input[type="time"]',
  ).evaluateAll((controls) => controls.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && rect.width > 0 && Number.parseFloat(style.fontSize) < 14;
  }).map((element) => ({ id: element.id, fontSize: getComputedStyle(element).fontSize })));
  expect(
    undersizedNativeControls,
    `${stateName}: normal narrow native controls must retain at least 14px text`,
  ).toEqual([]);
}


module.exports = { expectNarrowMobileReflow, expectNarrowReflow };
