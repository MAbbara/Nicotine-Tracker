// Inline registration validation. Renders persistent field errors and uses
// native validity for focus and announcements; feedback stays inline and
// never replaces server-side validation, which stays authoritative.

export function validateRegistration(password, confirmation) {
  const passwordError = password.length < 6 ? 'Use at least 6 characters.' : '';
  const confirmationError = password !== confirmation ? 'Passwords do not match.' : '';
  return {
    valid: passwordError === '' && confirmationError === '',
    passwordError,
    confirmationError,
  };
}

export function renderFieldError(control, message) {
  const errorNode = document.querySelector(`[data-error-for="${control.id}"]`);
  if (errorNode) {
    errorNode.textContent = message;
  }
  const wrapper = control.closest('[data-registration-field]');
  if (wrapper) {
    wrapper.classList.toggle('c-field--error', message !== '');
  }
  if (message) {
    control.setAttribute('aria-invalid', 'true');
  } else {
    control.removeAttribute('aria-invalid');
  }
}

function bootstrap() {
  const form = document.querySelector('[data-registration-form]');
  if (!form) {
    return;
  }

  const password = form.querySelector('#password');
  const confirmation = form.querySelector('#confirm_password');
  if (!password || !confirmation) {
    return;
  }

  const clearOnInput = (control) => {
    control.addEventListener('input', () => {
      control.setCustomValidity('');
      renderFieldError(control, '');
    });
  };
  clearOnInput(password);
  clearOnInput(confirmation);

  // The confirmation error depends on the password, so editing the password
  // must recompute and render the confirmation state. Otherwise a recorded
  // mismatch survives after the password is edited to match, Chromium
  // suppresses the next submit event, and a valid form can never submit.
  password.addEventListener('input', () => {
    if (!confirmation.value) {
      confirmation.setCustomValidity('');
      renderFieldError(confirmation, '');
      return;
    }
    const { confirmationError } = validateRegistration(password.value, confirmation.value);
    confirmation.setCustomValidity(confirmationError);
    renderFieldError(confirmation, confirmationError);
  });

  form.addEventListener('submit', (event) => {
    const result = validateRegistration(password.value, confirmation.value);
    password.setCustomValidity(result.passwordError);
    confirmation.setCustomValidity(result.confirmationError);
    renderFieldError(password, result.passwordError);
    renderFieldError(confirmation, result.confirmationError);
    if (!result.valid) {
      event.preventDefault();
      const firstInvalid = result.passwordError ? password : confirmation;
      firstInvalid.focus();
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
