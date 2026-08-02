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
  enhanced.addEventListener('click', activate);
  enhanced.hidden = false;
  fallback.hidden = true;
  root.dataset.controllerReady = 'true';

  const cleanup = () => {
    if (!active) return;
    active = false;
    enhanced.removeEventListener('click', activate);
    activations.delete(root);
  };
  activations.set(root, cleanup);
  return cleanup;
}
