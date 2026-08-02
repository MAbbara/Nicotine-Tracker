// Race-free progressive enhancement for Today's primary actions.
//
// Contract: a [data-action-slot] container holds one visible
// [data-action-fallback] anchor and one hidden [data-action-enhanced]
// button with an identical accessible name. Activation attaches the
// enhanced click listener first, then reveals the enhanced control,
// hides the fallback, and only then marks the slot with
// data-controller-ready="true". Until that marker appears the fallback
// keeps its plain server-rendered navigation behavior, so no click can
// ever land on an action whose handler is not attached yet.

const activations = new WeakMap();

function noop() {}

function bestEffort(operation) {
  try {
    operation();
  } catch {
    // Continue restoring the remaining parts of the server-rendered state.
  }
}

function restoreServerAction(root, fallback, enhanced, activate) {
  // Teardown mirrors activation in reverse so no intermediate state is
  // unsafe: drop readiness first, restore the fallback before hiding the
  // enhanced control, and detach its listener last. Each step is isolated so
  // one hostile DOM mutation cannot prevent the remaining recovery work.
  bestEffort(() => { delete root.dataset.controllerReady; });
  bestEffort(() => { fallback.hidden = false; });
  bestEffort(() => { enhanced.hidden = true; });
  bestEffort(() => { enhanced.removeEventListener('click', activate); });
  activations.delete(root);
}

export function activateActionEnhancement(root, onActivate) {
  if (!root || typeof root.querySelector !== 'function') return noop;
  const existing = activations.get(root);
  if (existing) return existing;
  const fallback = root.querySelector('[data-action-fallback]');
  const enhanced = root.querySelector('[data-action-enhanced]');
  if (!fallback || !enhanced || typeof onActivate !== 'function') return noop;

  const activate = (event) => onActivate(event);
  let active = true;
  // The listener must be attached before any visibility change so the
  // revealed control is never interactive without its handler.
  try {
    enhanced.addEventListener('click', activate);
    enhanced.hidden = false;
    fallback.hidden = true;
    root.dataset.controllerReady = 'true';
  } catch (error) {
    active = false;
    restoreServerAction(root, fallback, enhanced, activate);
    throw error;
  }

  const cleanup = () => {
    if (!active) return;
    active = false;
    restoreServerAction(root, fallback, enhanced, activate);
  };
  activations.set(root, cleanup);
  return cleanup;
}
