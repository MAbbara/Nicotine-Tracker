const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');


function visibleFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hidden || element.closest('[hidden], [inert]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && element.getClientRects().length > 0;
  });
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
