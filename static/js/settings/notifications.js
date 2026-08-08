export async function runNotificationAction({
  button,
  status,
  request,
  pendingLabel = 'Working…',
  failureMessage = 'The action could not be completed. Please try again.',
}) {
  if (!button || !status || typeof request !== 'function') return false;
  if (button.dataset.busy === 'true') return false;

  const originalLabel = button.textContent;
  const originallyDisabled = button.disabled;
  const activeDocument = button.ownerDocument;
  const initiatedWithFocus = activeDocument?.activeElement === button;
  button.dataset.busy = 'true';
  button.disabled = true;
  const focusAfterDisable = activeDocument?.activeElement;
  button.textContent = pendingLabel;
  status.hidden = false;
  status.textContent = pendingLabel;
  status.dataset.state = 'loading';
  status.setAttribute('aria-busy', 'true');
  status.classList?.remove('c-status--constructive', 'c-status--attention');

  let succeeded = false;
  try {
    const result = await request();
    succeeded = result?.success === true;
    status.textContent = result?.message || (succeeded ? 'Complete.' : failureMessage);
    status.dataset.state = succeeded ? 'success' : 'error';
    status.classList?.toggle('c-status--constructive', succeeded);
    status.classList?.toggle('c-status--attention', !succeeded);
    return succeeded;
  } catch (_error) {
    status.textContent = failureMessage;
    status.dataset.state = 'error';
    status.classList?.remove('c-status--constructive');
    status.classList?.add('c-status--attention');
    return false;
  } finally {
    status.hidden = false;
    status.setAttribute('aria-busy', 'false');
    button.textContent = originalLabel;
    button.disabled = originallyDisabled;
    delete button.dataset.busy;
    const focusWasNotMoved = (
      activeDocument?.activeElement === focusAfterDisable
      || activeDocument?.activeElement === button
    );
    if (
      initiatedWithFocus
      && focusWasNotMoved
      && button.isConnected
      && activeDocument?.visibilityState === 'visible'
    ) button.focus();
  }
}

async function postJson(fetchImpl, endpoint, body, csrfToken) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_error) {
    payload = {};
  }
  return {
    success: response.ok && payload.success === true,
    message: payload.message || payload.error?.message,
  };
}

export function initReminderSettings(root = document, fetchImpl = fetch) {
  if (!root || typeof root.querySelector !== 'function') return () => {};

  const discordCheckbox = root.querySelector('#notification_channel_discord');
  const emailCheckbox = root.querySelector('#notification_channel_email');
  const channelGroup = root.querySelector('#notification-channel-group');
  const webhookRegion = root.querySelector('#discord-webhook-region');
  const webhookInput = root.querySelector('#discord_webhook');
  const discordButton = root.querySelector('#test-discord-webhook');
  const discordStatus = root.querySelector('#discord-test-status');
  const weeklyCheckbox = root.querySelector('#weekly_reports');
  const dailyCheckbox = root.querySelector('#daily_reminders');
  const reminderInput = root.querySelector('#reminder_time');
  const quietStart = root.querySelector('#quiet_hours_start');
  const quietEnd = root.querySelector('#quiet_hours_end');
  const weeklyButton = root.querySelector('#trigger-weekly-report');
  const weeklyStatus = root.querySelector('#weekly-report-status');
  const csrfToken = root.querySelector('meta[name="csrf-token"]')?.content || '';
  const cleanups = [];

  const setDescribedBy = (input, id, enabled) => {
    if (!input) return;
    const ids = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    if (enabled) ids.add(id); else ids.delete(id);
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' '));
    else input.removeAttribute('aria-describedby');
  };

  const updateDiscordState = () => {
    const enabled = discordCheckbox?.checked === true;
    if (webhookRegion) webhookRegion.hidden = !enabled;
    if (webhookInput) {
      webhookInput.required = enabled;
      webhookInput.setAttribute('aria-required', String(enabled));
    }
    if (discordButton && discordButton.dataset.busy !== 'true') {
      discordButton.disabled = !enabled;
    }
  };
  const updateTimeDependencies = () => {
    const dailyEnabled = dailyCheckbox?.checked === true;
    if (reminderInput) {
      reminderInput.required = dailyEnabled;
      reminderInput.setAttribute('aria-required', String(dailyEnabled));
    }
    const oneQuietTime = Boolean(quietStart?.value || quietEnd?.value);
    const equalQuietTimes = Boolean(
      quietStart?.value && quietEnd?.value && quietStart.value === quietEnd.value,
    );
    for (const input of [quietStart, quietEnd]) {
      if (!input) continue;
      input.required = oneQuietTime;
      input.setAttribute('aria-required', String(oneQuietTime));
      setDescribedBy(input, 'quiet-hours-dependency', true);
      const invalid = oneQuietTime && (!input.value || equalQuietTimes);
      input.setCustomValidity(invalid
        ? (equalQuietTimes
          ? 'Quiet hours must start and end at different times.'
          : 'Set both quiet-hour times or clear both.')
        : '');
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  };
  const updateWeeklyState = () => {
    const weeklyEnabled = weeklyCheckbox?.checked === true;
    const usableChannel = emailCheckbox?.checked === true || (
      discordCheckbox?.checked === true && Boolean(webhookInput?.value.trim())
    );
    const invalid = weeklyEnabled && !usableChannel;
    weeklyCheckbox?.setCustomValidity(
      invalid ? 'Choose a usable channel for weekly reports.' : '',
    );
    for (const input of [emailCheckbox, discordCheckbox]) {
      if (!input) continue;
      setDescribedBy(input, 'notification-channel-dependency', true);
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (channelGroup) {
      if (invalid) channelGroup.setAttribute('aria-invalid', 'true');
      else channelGroup.removeAttribute('aria-invalid');
    }
    if (weeklyButton && weeklyButton.dataset.busy !== 'true') {
      weeklyButton.disabled = !weeklyEnabled || !usableChannel;
    }
  };

  if (discordCheckbox) {
    const updateDiscordDependencies = () => {
      updateDiscordState();
      updateWeeklyState();
    };
    discordCheckbox.addEventListener('change', updateDiscordDependencies);
    cleanups.push(() => discordCheckbox.removeEventListener('change', updateDiscordDependencies));
  }
  if (emailCheckbox) {
    emailCheckbox.addEventListener('change', updateWeeklyState);
    cleanups.push(() => emailCheckbox.removeEventListener('change', updateWeeklyState));
  }
  if (webhookInput) {
    webhookInput.addEventListener('input', updateWeeklyState);
    cleanups.push(() => webhookInput.removeEventListener('input', updateWeeklyState));
  }
  if (weeklyCheckbox) {
    weeklyCheckbox.addEventListener('change', updateWeeklyState);
    cleanups.push(() => weeklyCheckbox.removeEventListener('change', updateWeeklyState));
  }
  if (dailyCheckbox) {
    dailyCheckbox.addEventListener('change', updateTimeDependencies);
    cleanups.push(() => dailyCheckbox.removeEventListener('change', updateTimeDependencies));
  }
  for (const input of [quietStart, quietEnd]) {
    if (!input) continue;
    input.addEventListener('input', updateTimeDependencies);
    cleanups.push(() => input.removeEventListener('input', updateTimeDependencies));
  }

  const testDiscord = () => runNotificationAction({
    button: discordButton,
    status: discordStatus,
    pendingLabel: 'Testing…',
    failureMessage: 'The Discord connection could not be tested. Please try again.',
    request: () => {
      const webhookUrl = webhookInput?.value.trim() || '';
      if (!webhookUrl) {
        return Promise.resolve({
          success: false,
          message: 'Enter a Discord webhook URL before running a test.',
        });
      }
      return postJson(fetchImpl, discordButton.dataset.endpoint, {
        webhook_url: webhookUrl,
      }, csrfToken);
    },
  });
  const sendWeekly = () => runNotificationAction({
    button: weeklyButton,
    status: weeklyStatus,
    pendingLabel: 'Sending…',
    failureMessage: 'The weekly report could not be queued. Please try again.',
    request: () => postJson(
      fetchImpl,
      weeklyButton.dataset.endpoint,
      {},
      csrfToken,
    ),
  });

  const handleDiscordClick = () => {
    void testDiscord().finally(updateDiscordState);
  };
  const handleWeeklyClick = () => {
    void sendWeekly().finally(updateWeeklyState);
  };

  if (discordButton && discordStatus) {
    discordButton.addEventListener('click', handleDiscordClick);
    cleanups.push(() => discordButton.removeEventListener('click', handleDiscordClick));
  }
  if (weeklyButton && weeklyStatus) {
    weeklyButton.addEventListener('click', handleWeeklyClick);
    cleanups.push(() => weeklyButton.removeEventListener('click', handleWeeklyClick));
  }

  updateDiscordState();
  updateWeeklyState();
  updateTimeDependencies();
  return () => cleanups.splice(0).forEach((cleanup) => cleanup());
}

if (typeof document !== 'undefined') {
  const start = () => initReminderSettings(document, window.fetch.bind(window));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
