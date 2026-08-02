const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

async function loadRegisterValidation() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'auth', 'register_validation.js'),
    'utf8',
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('short password returns length guidance and stays invalid', async () => {
  const { validateRegistration } = await loadRegisterValidation();
  assert.deepEqual(validateRegistration('short', 'short'), {
    valid: false,
    passwordError: 'Use at least 6 characters.',
    confirmationError: '',
  });
});

test('mismatched confirmation returns mismatch guidance', async () => {
  const { validateRegistration } = await loadRegisterValidation();
  const result = validateRegistration('long-enough', 'different');
  assert.equal(result.valid, false);
  assert.equal(result.passwordError, '');
  assert.equal(result.confirmationError, 'Passwords do not match.');
});

test('short password and mismatch report both errors', async () => {
  const { validateRegistration } = await loadRegisterValidation();
  assert.deepEqual(validateRegistration('tiny', 'other'), {
    valid: false,
    passwordError: 'Use at least 6 characters.',
    confirmationError: 'Passwords do not match.',
  });
});

test('matching long-enough passwords are valid', async () => {
  const { validateRegistration } = await loadRegisterValidation();
  assert.deepEqual(validateRegistration('long-enough', 'long-enough'), {
    valid: true,
    passwordError: '',
    confirmationError: '',
  });
});

test('module never calls alert()', async () => {
  const source = fs.readFileSync(
    path.join(projectRoot, 'static', 'js', 'auth', 'register_validation.js'),
    'utf8',
  );
  assert.ok(!source.includes('alert('), 'validation must render inline, never alert()');
});
