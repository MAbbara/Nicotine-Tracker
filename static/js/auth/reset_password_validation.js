// Confirm-password match feedback via native validity; server validation stays authoritative.
function bootstrap() {
  const passwordField = document.getElementById('password');
  const confirmPasswordField = document.getElementById('confirm_password');
  const form = document.querySelector('.auth-form');

  if (!passwordField || !confirmPasswordField || !form) {
    return;
  }

  function validatePasswords() {
    if (confirmPasswordField.value && passwordField.value !== confirmPasswordField.value) {
      confirmPasswordField.setCustomValidity('Passwords do not match');
    } else {
      confirmPasswordField.setCustomValidity('');
    }
  }

  passwordField.addEventListener('input', validatePasswords);
  confirmPasswordField.addEventListener('input', validatePasswords);

  form.addEventListener('submit', (event) => {
    validatePasswords();
    if (!form.checkValidity()) {
      event.preventDefault();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
