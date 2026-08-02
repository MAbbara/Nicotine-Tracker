function bindDeleteConfirmation(root, confirmAction) {
  root.querySelectorAll('.catalog-delete-form[data-confirm]').forEach((form) => {
    if (form.dataset.confirmBound === 'true') return;
    form.dataset.confirmBound = 'true';
    form.addEventListener('submit', (event) => {
      if (!confirmAction(form.dataset.confirm)) event.preventDefault();
    });
  });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  bindDeleteConfirmation(document, window.confirm.bind(window));
}

export { bindDeleteConfirmation };
