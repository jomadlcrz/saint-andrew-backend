/**
 * Password rules and the change-password guards (no network, no Firebase writes).
 * Run: node --test tests/password.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordProblem, isCurrentPassword, SAME_PASSWORD_MESSAGE } = require('../src/utils/password-policy');
const { changePassword } = require('../src/controllers/auth.controller');

test('passwords need 8+ characters with letters and numbers', () => {
  assert.match(passwordProblem('abc123'), /at least 8/);
  assert.match(passwordProblem('abcdefgh'), /letters and numbers/);
  assert.match(passwordProblem('12345678'), /letters and numbers/);
  assert.equal(passwordProblem('Mourning2026'), null);
});

test("passwords can't contain the account's email or name", () => {
  assert.match(passwordProblem('mariasantos12', { email: 'mariasantos@example.com' }), /email/);
  assert.match(passwordProblem('Santos2026!', { name: 'Maria Santos' }), /name/);
  // Short name parts (e.g. "Jo") don't count
  assert.equal(passwordProblem('Joyful2026', { name: 'Jo Cruz' }), null);
});

test('the current password is checked by signing in to Firebase (only with the web API key)', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: JSON.parse(init.body).password === 'Current123' };
  };
  assert.equal(await isCurrentPassword('a@b.com', 'Current123', 'KEY', fakeFetch), true);
  assert.equal(await isCurrentPassword('a@b.com', 'Different123', 'KEY', fakeFetch), false);
  assert.match(calls[0].url, /accounts:signInWithPassword\?key=KEY/);
  // No key: skipped
  assert.equal(await isCurrentPassword('a@b.com', 'Current123', '', fakeFetch), false);
  // Network error: doesn't block
  assert.equal(await isCurrentPassword('a@b.com', 'x', 'KEY', async () => { throw new Error('offline'); }), false);
});

function run(body, user) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data });
      },
    };
    changePassword({ body, user }, res, (err) => resolve({ status: 500, data: { error: err.message } }));
  });
}

test('change password needs both passwords, a fresh sign-in, and a new password', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await run({ newPassword: 'Mourning2026' }, { uid: 'u1', auth_time: now })).status, 400);
  // Signed in long ago: the current password must be entered again
  const stale = await run({ currentPassword: 'Old12345', newPassword: 'Mourning2026' }, { uid: 'u1', auth_time: now - 3600 });
  assert.equal(stale.status, 401);
  assert.match(stale.data.error, /current password again/);
  // Same as the current one
  const same = await run({ currentPassword: 'Mourning2026', newPassword: 'Mourning2026' }, { uid: 'u1', auth_time: now });
  assert.equal(same.status, 400);
  assert.equal(same.data.error, SAME_PASSWORD_MESSAGE);
});
