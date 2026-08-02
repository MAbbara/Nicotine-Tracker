export async function updateOfflineQueue({ checkbox, status, request }) {
  if (!checkbox || !status || typeof request !== 'function') return false;
  if (checkbox.dataset.busy === 'true') return false;

  const requestedState = checkbox.checked === true;
  const previousState = !requestedState;
  checkbox.dataset.busy = 'true';
  checkbox.disabled = true;
  status.hidden = false;
  status.textContent = 'Saving offline preference…';
  status.dataset.state = 'loading';
  status.setAttribute('aria-busy', 'true');
  status.classList?.remove('c-status--constructive', 'c-status--attention');

  let succeeded = false;
  try {
    const result = await request(requestedState);
    succeeded = result?.success === true;
    if (!succeeded) throw new Error('offline-preference-rejected');
    checkbox.checked = result.enabled === true;
    status.textContent = result.message || (
      checkbox.checked ? 'Offline saving is on.' : 'Offline saving is off.'
    );
    status.dataset.state = 'success';
    status.classList?.add('c-status--constructive');
    return true;
  } catch (_error) {
    checkbox.checked = previousState;
    status.textContent = 'Offline preference could not be saved. Please try again.';
    status.dataset.state = 'error';
    status.classList?.add('c-status--attention');
    return false;
  } finally {
    checkbox.disabled = false;
    delete checkbox.dataset.busy;
    status.hidden = false;
    status.setAttribute('aria-busy', 'false');
  }
}

export function initDataPrivacy(root = document, fetchImpl = fetch) {
  if (!root || typeof root.querySelector !== 'function') return () => {};
  const checkbox = root.querySelector('#offline_queue_enabled');
  const status = root.querySelector('#offline-queue-status');
  if (!checkbox || !status) return () => {};

  const csrfToken = root.querySelector('meta[name="csrf-token"]')?.content || '';
  const enabledMeta = root.querySelector('meta[name="offline-queue-enabled"]');
  const savePreference = async (enabled) => {
    const response = await fetchImpl(checkbox.dataset.endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled }),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    const saved = payload?.offline_queue?.enabled;
    const success = response.ok && typeof saved === 'boolean';
    if (success && enabledMeta) enabledMeta.content = String(saved);
    return {
      success,
      enabled: saved,
      message: success
        ? (saved ? 'Offline saving is on.' : 'Offline saving is off.')
        : undefined,
    };
  };

  const handleChange = () => {
    void updateOfflineQueue({ checkbox, status, request: savePreference });
  };
  checkbox.addEventListener('change', handleChange);
  return () => checkbox.removeEventListener('change', handleChange);
}

if (typeof document !== 'undefined') {
  const start = () => initDataPrivacy(document, window.fetch.bind(window));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
