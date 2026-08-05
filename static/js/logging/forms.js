import { installDialogFocusTrap, restoreDialogFocus } from '../shell/dialog_focus.js';
import { installDialogDismissal, removeTransientSearchParam } from '../shell/dialog_lifecycle.js';

function syncCustomProductFields(form) {
  const select = form.querySelector('[data-product-select]');
  const fields = form.querySelector('[data-custom-product-fields]');
  if (!select || !fields) return;
  const customBrand = fields.querySelector('[name="custom_brand"]');
  const customStrength = fields.querySelector('[name="custom_nicotine_mg"]');
  const isCustom = select.value === 'custom';
  fields.hidden = !isCustom;
  if (customBrand) customBrand.required = isCustom;
  if (customStrength) customStrength.required = isCustom;
  if (!isCustom) {
    if (customBrand) customBrand.value = '';
    if (customStrength) customStrength.value = '';
  }
}


export function initLoggingForms(root = document, confirmImpl = window.confirm) {
  if (!root || typeof root.querySelectorAll !== 'function') return () => {};
  const cleanups = [];

  root.querySelectorAll('form.logging-form').forEach((form) => {
    const select = form.querySelector('[data-product-select]');
    if (!select) return;
    const handleChange = () => syncCustomProductFields(form);
    select.addEventListener('change', handleChange);
    syncCustomProductFields(form);
    cleanups.push(() => select.removeEventListener('change', handleChange));
  });

  root.querySelectorAll('form[data-confirm-delete]').forEach((form) => {
    const handleSubmit = (event) => {
      if (!confirmImpl('Delete this log permanently?')) event.preventDefault();
    };
    form.addEventListener('submit', handleSubmit);
    cleanups.push(() => form.removeEventListener('submit', handleSubmit));
  });

  const dialog = root.querySelector('#addLogModal');
  if (dialog && typeof dialog.showModal === 'function') {
    let returnFocus = null;
    cleanups.push(installDialogFocusTrap(dialog));
    cleanups.push(installDialogDismissal(dialog, {
      panel: dialog.querySelector('[data-dialog-panel]'),
      dismiss: () => {
        if (dialog.open) dialog.close();
        removeTransientSearchParam(dialog.ownerDocument.defaultView, 'open_add_modal');
      },
    }));
    root.querySelectorAll('[data-hs-overlay="#addLogModal"]').forEach((trigger) => {
      const handleClick = (event) => {
        event.preventDefault();
        if (dialog.contains(trigger)) {
          dialog.close();
          return;
        }
        returnFocus = trigger;
        if (!dialog.open) dialog.showModal();
        trigger.setAttribute('aria-expanded', 'true');
        dialog.querySelector('[name="log_date"]')?.focus({ preventScroll: true });
      };
      trigger.addEventListener('click', handleClick);
      cleanups.push(() => trigger.removeEventListener('click', handleClick));
    });

    const handleClose = () => {
      root.querySelectorAll('[aria-controls="addLogModal"]').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'false');
      });
      restoreDialogFocus(dialog, returnFocus);
      returnFocus = null;
    };
    dialog.addEventListener('close', handleClose);
    cleanups.push(() => dialog.removeEventListener('close', handleClose));

    if (dialog.dataset.autoOpen === 'true') {
      queueMicrotask(() => {
        root.querySelector('[data-logbook-add-action]')?.click();
      });
    }
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}


if (typeof document !== 'undefined') {
  const start = () => initLoggingForms(document, window.confirm.bind(window));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
