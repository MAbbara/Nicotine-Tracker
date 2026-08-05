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
