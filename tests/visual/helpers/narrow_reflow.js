const { expect } = require('@playwright/test');


async function collectNarrowReflowFacts(page, { kind, stateName }) {
  return page.evaluate(({ captureKind, captureState }) => {
    const visible = (element) => {
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
      const leftEdge = dialogRect ? dialogRect.left : 0;
      const rightEdge = dialogRect ? dialogRect.right : innerWidth;
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

    const dialogHorizontalProblems = dialog ? [...dialog.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => !hasHorizontalScrollAncestor(element, dialog))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < dialogRect.left - 1
          || rect.right > dialogRect.right + 1
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
    const dialogScrollOwners = dialog ? [dialog, ...dialog.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => !element.matches('input, select, textarea'))
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowY;
        return ['auto', 'scroll'].includes(overflow)
          && element.scrollHeight > element.clientHeight + 1;
      }).map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
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
      dialog: dialogRect ? {
        rect: dialogRect,
        horizontalProblems: dialogHorizontalProblems,
        scrollOwners: dialogScrollOwners,
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


async function expectNarrowReflow(page, result, { kind = 'page', stateName }) {
  const facts = await collectNarrowReflowFacts(page, { kind, stateName });
  expect(
    facts.document.scrollWidth,
    `${stateName}: document must not scroll horizontally at 320px / 200% text; `
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
    expect(
      facts.nav.mainPaddingBottom,
      `${stateName}: main content must reserve the measured fixed-navigation height`,
    ).toBeGreaterThanOrEqual(facts.nav.rect.height);
  }

  expect(
    facts.horizontalControlProblems,
    `${stateName}: visible controls and actions must remain fully inside their content surface`,
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
    expect(facts.dialog.rect.right).toBeLessThanOrEqual(320);
    expect(facts.dialog.rect.top).toBeGreaterThanOrEqual(0);
    expect(facts.dialog.rect.bottom).toBeLessThanOrEqual(900);
    expect(
      facts.dialog.horizontalProblems,
      `${stateName}: dialog content must wrap inside the visual viewport`,
    ).toEqual([]);
    expect(
      facts.dialog.scrollOwners.length,
      `${stateName}: dialog must have one vertical scroll owner`,
    ).toBeLessThanOrEqual(1);
    expect(
      facts.dialog.headings.filter(({ lines }) => lines > 4),
      `${stateName}: dialog headings must wrap as phrases, not isolated word stacks`,
    ).toEqual([]);
  }

  expect(result.geometry.viewport.width).toBe(320);
}


module.exports = { expectNarrowReflow };
