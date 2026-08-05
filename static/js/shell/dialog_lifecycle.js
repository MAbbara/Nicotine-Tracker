const EXIT_FALLBACK_MS = 260;
const REDUCED_MOTION_EXIT_MS = 1;

function dialogWindow(dialog) {
  return dialog?.ownerDocument?.defaultView || globalThis;
}

function reducedMotionRequested(dialog) {
  return Boolean(dialogWindow(dialog).matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function usableFocusTarget(element) {
  if (
    !element
    || element.isConnected !== true
    || element.hidden
    || element.disabled
    || element.matches?.(':disabled')
    || element.getAttribute?.('aria-disabled') === 'true'
    || element.closest?.('[hidden], [inert], [aria-hidden="true"]')
  ) return false;
  const style = dialogWindow(element).getComputedStyle?.(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}

function focusAfterNativeClose(dialog, opener) {
  const documentRef = dialog?.ownerDocument;
  if (
    !documentRef
    || documentRef.hidden
    || (documentRef.visibilityState && documentRef.visibilityState !== 'visible')
  ) return false;
  if (opener === false) return false;
  const fallback = documentRef.querySelector?.('#main-content, main[tabindex], main, [role="main"]');
  const target = usableFocusTarget(opener)
    ? opener
    : usableFocusTarget(fallback) ? fallback : null;
  if (!target || typeof target.focus !== 'function') return false;
  try {
    target.focus({ preventScroll: true });
    return documentRef.activeElement === target;
  } catch (_) {
    return false;
  }
}

function finishDialogClose(dialog, { reason, restoreFocusTo, beforeNativeClose }) {
  beforeNativeClose?.();
  dialog.close(reason);
  dialog.inert = false;
  delete dialog.dataset.dialogState;
  focusAfterNativeClose(dialog, restoreFocusTo);
  return true;
}

export function showDialog(dialog) {
  if (!dialog || dialog.open || dialog.dataset.dialogState === 'closing') return false;
  dialog.inert = false;
  dialog.dataset.dialogState = 'opening';
  dialog.showModal();
  const windowRef = dialogWindow(dialog);
  const markOpen = () => {
    if (dialog.open && dialog.dataset.dialogState === 'opening') {
      dialog.dataset.dialogState = 'open';
    }
  };
  if (typeof windowRef.requestAnimationFrame === 'function') {
    windowRef.requestAnimationFrame(markOpen);
  } else {
    queueMicrotask(markOpen);
  }
  return true;
}

export function requestDialogClose(dialog, {
  reason = 'dismiss',
  restoreFocusTo = null,
  beforeNativeClose = null,
} = {}) {
  if (!dialog?.open || dialog.dataset.dialogState === 'closing') {
    return Promise.resolve(false);
  }

  dialog.dataset.dialogState = 'closing';
  dialog.inert = true;
  const panel = dialog.querySelector?.('[data-dialog-panel]');
  if (!panel) {
    return Promise.resolve(finishDialogClose(dialog, {
      reason, restoreFocusTo, beforeNativeClose,
    }));
  }

  const windowRef = dialogWindow(dialog);
  const timeoutMs = reducedMotionRequested(dialog)
    ? REDUCED_MOTION_EXIT_MS
    : EXIT_FALLBACK_MS;

  return new Promise((resolve) => {
    let timer = null;
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      panel.removeEventListener('transitionend', onTransitionEnd);
      windowRef.clearTimeout?.(timer);
      resolve(finishDialogClose(dialog, {
        reason, restoreFocusTo, beforeNativeClose,
      }));
    };
    const onTransitionEnd = (event) => {
      if (
        event.target === panel
        && (event.propertyName === 'opacity' || event.propertyName === 'transform')
      ) complete();
    };
    panel.addEventListener('transitionend', onTransitionEnd);
    timer = windowRef.setTimeout?.(complete, timeoutMs) ?? setTimeout(complete, timeoutMs);
  });
}

function outsidePanel(event, dialog, panel) {
  if (event.target === dialog) return true;
  return panel ? !panel.contains(event.target) : false;
}

export function installDialogDismissal(dialog, { dismiss, panel }) {
  let outsidePointer = null;
  const onPointerDown = (event) => {
    outsidePointer = outsidePanel(event, dialog, panel) ? event.pointerId : null;
  };
  const onPointerUp = (event) => {
    const completeOutsideActivation = outsidePointer === event.pointerId
      && outsidePanel(event, dialog, panel);
    outsidePointer = null;
    if (completeOutsideActivation) dismiss('backdrop');
  };
  const onPointerCancel = () => { outsidePointer = null; };
  const onCancel = (event) => {
    if (event.target !== dialog) return;
    event.preventDefault();
    dismiss('escape');
  };
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);
  dialog.addEventListener('pointercancel', onPointerCancel);
  dialog.addEventListener('cancel', onCancel);
  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
    dialog.removeEventListener('pointercancel', onPointerCancel);
    dialog.removeEventListener('cancel', onCancel);
  };
}

export function removeTransientSearchParam(windowRef, name) {
  const url = new URL(windowRef.location.href, windowRef.location.origin);
  if (!url.searchParams.has(name)) return false;
  url.searchParams.delete(name);
  windowRef.history.replaceState(windowRef.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
