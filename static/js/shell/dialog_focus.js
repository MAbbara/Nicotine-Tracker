const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');


function computedStyleFor(element) {
  const getStyle = element?.ownerDocument?.defaultView?.getComputedStyle
    || globalThis.getComputedStyle;
  if (typeof getStyle !== 'function') return null;
  try {
    return getStyle.call(element.ownerDocument?.defaultView, element);
  } catch (_) {
    return null;
  }
}


function isConnectedVisible(element) {
  if (!element || element.isConnected !== true || element.hidden) return false;
  if (element.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = computedStyleFor(element);
  if (
    !style
    || style.display === 'none'
    || style.visibility === 'hidden'
    || style.visibility === 'collapse'
  ) return false;
  if (typeof element.getClientRects !== 'function' || element.getClientRects().length === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect?.();
  return !rect || rect.width > 0 || rect.height > 0;
}


function isUsableOpener(element) {
  if (!isConnectedVisible(element)) return false;
  if (element.disabled || element.matches?.(':disabled')) return false;
  if (element.getAttribute?.('aria-disabled') === 'true') return false;
  return element.matches?.(FOCUSABLE_SELECTOR) === true;
}


function visibleFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isConnectedVisible);
}


function mainContentFallback(documentRef, dialog) {
  const selectors = ['#main-content', 'main[tabindex]', 'main', '[role="main"]'];
  for (const selector of selectors) {
    const candidate = documentRef.querySelector?.(selector);
    if (
      candidate
      && candidate !== dialog
      && !dialog?.contains?.(candidate)
      && typeof candidate.focus === 'function'
      && isConnectedVisible(candidate)
    ) return candidate;
  }
  return null;
}


export function restoreDialogFocus(dialog, opener) {
  const documentRef = dialog?.ownerDocument || opener?.ownerDocument;
  if (
    !documentRef
    || documentRef.hidden
    || (documentRef.visibilityState && documentRef.visibilityState !== 'visible')
  ) return false;

  const active = documentRef.activeElement;
  const activeNeedsRecovery = (
    !active
    || active === documentRef.body
    || active === documentRef.documentElement
    || dialog?.contains?.(active)
    || !isConnectedVisible(active)
  );
  if (!activeNeedsRecovery) return false;

  const target = isUsableOpener(opener)
    ? opener
    : mainContentFallback(documentRef, dialog);
  if (!target) return false;
  try {
    target.focus({ preventScroll: true });
    return documentRef.activeElement === target;
  } catch (_) {
    return false;
  }
}


export function installDialogFocusTrap(dialog) {
  if (!dialog || typeof dialog.addEventListener !== 'function') return () => {};

  const handleKeydown = (event) => {
    if (event.key !== 'Tab' || !dialog.open) return;
    const focusable = visibleFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);
    const active = dialog.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  dialog.addEventListener('keydown', handleKeydown);
  return () => dialog.removeEventListener('keydown', handleKeydown);
}
