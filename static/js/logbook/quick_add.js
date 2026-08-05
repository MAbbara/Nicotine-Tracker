const HISTORY_SELECTOR = '[data-logbook-history]';
const FRAGMENT_VERSION = 'logbook-history-v1';
const HIGHLIGHT_MS = 700;

function currentView(locationObject) {
  const url = new URL(locationObject.href);
  const parsedPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    q: url.searchParams.get('q') || '',
    from_date: url.searchParams.get('from_date') || '',
    to_date: url.searchParams.get('to_date') || '',
  };
}

function announce(documentRef, message, type) {
  documentRef.querySelector('[data-logbook-quick-notification]')?.remove();
  const notification = documentRef.createElement('div');
  notification.className = `logbook-notification logbook-notification--${type}`;
  notification.setAttribute('data-logbook-quick-notification', '');
  notification.setAttribute('data-notification-type', type);
  const messageNode = documentRef.createElement('p');
  messageNode.setAttribute('data-notification-message', '');
  messageNode.setAttribute('role', type === 'error' ? 'alert' : 'status');
  messageNode.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  messageNode.textContent = message;
  notification.appendChild(messageNode);
  documentRef.body.appendChild(notification);
  return notification;
}

function parseHistory(documentRef, historyHtml, fragmentVersion) {
  if (
    fragmentVersion !== FRAGMENT_VERSION
    || typeof historyHtml !== 'string'
    || !historyHtml.trim()
  ) return null;
  const template = documentRef.createElement('template');
  template.innerHTML = historyHtml.trim();
  const nextRoot = template.content.firstElementChild;
  if (
    !nextRoot
    || nextRoot.dataset?.fragmentVersion !== fragmentVersion
  ) return null;
  return nextRoot;
}

function retryAfterMessage(response) {
  const raw = response.headers?.get?.('Retry-After');
  const seconds = Number.parseInt(raw || '', 10);
  if (Number.isInteger(seconds) && seconds > 0) {
    return `You’re adding logs quickly. Try again in ${seconds} seconds.`;
  }
  return 'You’re adding logs quickly. Try again in a moment.';
}

function responseErrorMessage(response, body) {
  if (response.status === 429) return retryAfterMessage(response);
  const canonicalMessage = body?.error?.message;
  if (typeof canonicalMessage === 'string' && canonicalMessage.trim()) {
    return canonicalMessage;
  }
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  return 'Could not save this log. Try again.';
}

export function createLogbookQuickAddController({
  documentRef = document,
  windowRef = window,
  fetchImpl = fetch,
  uuid = () => globalThis.crypto.randomUUID(),
  setTimeoutImpl = setTimeout,
  endpoint = '/log/api/quick_add',
} = {}) {
  const active = new WeakMap();

  function activate(button) {
    const existing = active.get(button);
    if (existing) return existing;
    const pouchId = Number.parseInt(button?.dataset?.pouchId || '', 10);
    const quantity = Number.parseInt(button?.dataset?.quantity || '1', 10);
    if (!Number.isInteger(pouchId) || pouchId <= 0) return Promise.resolve(false);
    const clientEventId = uuid();
    const originalMarkup = button.innerHTML;
    const initiatedWithFocus = documentRef.activeElement === button;
    const scrollPosition = [windowRef.scrollX || 0, windowRef.scrollY || 0];
    let userTransferredFocus = false;
    const notePointerTransfer = (event) => {
      if (event.target !== button) userTransferredFocus = true;
    };
    const noteKeyboardTransfer = (event) => {
      if (event.key === 'Tab' || event.target !== button) userTransferredFocus = true;
    };
    documentRef.addEventListener?.('pointerdown', notePointerTransfer, true);
    documentRef.addEventListener?.('keydown', noteKeyboardTransfer, true);
    button.dataset.busy = 'true';
    button.textContent = 'Adding…';
    button.disabled = true;

    const mutation = (async () => {
      let response;
      let body;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': documentRef.querySelector(
              'meta[name="csrf-token"]',
            )?.content || '',
          },
          body: JSON.stringify({
            pouch_id: pouchId,
            quantity,
            client_event_id: clientEventId,
            view: currentView(windowRef.location),
          }),
        });
        try {
          body = await response.json();
        } catch (_) {
          body = null;
        }
        if (!response.ok || body?.success !== true) {
          announce(documentRef, responseErrorMessage(response, body), 'error');
          return false;
        }
        const currentHistory = documentRef.querySelector(HISTORY_SELECTOR);
        const nextHistory = parseHistory(
          documentRef,
          body.history_html,
          body.fragment_version,
        );
        if (!currentHistory || !nextHistory) {
          announce(
            documentRef,
            'The log was saved, but history could not refresh. Reload when convenient.',
            'error',
          );
          return false;
        }
        currentHistory.replaceWith(nextHistory);
        if (body.visible) {
          const newLogId = Number.parseInt(String(body.new_log_id), 10);
          const row = Number.isInteger(newLogId)
            ? nextHistory.querySelector(`[data-log-id="${newLogId}"]`)
            : null;
          if (row) {
            row.classList.add('logbook-row--new');
            setTimeoutImpl(() => row.classList.remove('logbook-row--new'), HIGHLIGHT_MS);
          }
        }
        announce(documentRef, body.message, 'success');
        return true;
      } catch (_) {
        announce(
          documentRef,
          'Could not save this log. Check your connection and try again.',
          'error',
        );
        return false;
      } finally {
        documentRef.removeEventListener?.('pointerdown', notePointerTransfer, true);
        documentRef.removeEventListener?.('keydown', noteKeyboardTransfer, true);
        button.innerHTML = originalMarkup;
        button.disabled = false;
        delete button.dataset.busy;
        if (
          initiatedWithFocus
          && button.isConnected
          && documentRef.visibilityState !== 'hidden'
          && !userTransferredFocus
        ) button.focus({ preventScroll: true });
        windowRef.scrollTo?.(...scrollPosition);
        active.delete(button);
      }
    })();
    active.set(button, mutation);
    return mutation;
  }

  return { activate };
}

export function initLogbookQuickAdd(documentRef = document, options = {}) {
  const root = documentRef.querySelector('[data-logbook-page]');
  if (!root || root.dataset.quickAddReady === 'true') return null;
  const controller = createLogbookQuickAddController({ documentRef, ...options });
  for (const button of root.querySelectorAll('[data-quick-add]')) {
    button.addEventListener('click', () => controller.activate(button));
  }
  root.dataset.quickAddReady = 'true';
  return controller;
}
