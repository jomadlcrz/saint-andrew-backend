/**
 * Password rules for family accounts, checked by the backend on every password change (the apps
 * check the same rules first, for friendly messages). Mirrors src/lib/password-policy.ts in the apps.
 */

const MIN_LENGTH = 8;

/**
 * What's wrong with a new password, or null when it's fine: at least 8 characters, with letters and
 * numbers, and not built from the account's email or name.
 * @param {string} password
 * @param {{ email?: string, name?: string }} [account]
 */
function passwordProblem(password, account = {}) {
  const value = String(password || '');
  if (value.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters long.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must include both letters and numbers.';

  const lower = value.toLowerCase();
  const emailName = String(account.email || '').split('@')[0].toLowerCase();
  if (emailName.length >= 3 && lower.includes(emailName)) {
    return "Password can't contain your email address. Please choose something harder to guess.";
  }
  const names = String(account.name || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((n) => n.length >= 3);
  if (names.some((n) => lower.includes(n))) {
    return "Password can't contain your name. Please choose something harder to guess.";
  }
  return null;
}

const SAME_PASSWORD_MESSAGE = "That's your current password. Please choose a password you haven't used for this account.";

/**
 * Whether `password` is the account's current password, checked by signing in to Firebase Auth's
 * REST API (the Admin SDK can't read passwords). Needs FIREBASE_WEB_API_KEY (the same public key the
 * apps use); without it the check is skipped (returns false).
 * @param {string} email
 * @param {string} password
 * @param {string} apiKey
 * @param {typeof fetch} [fetchImpl]
 */
async function isCurrentPassword(email, password, apiKey, fetchImpl = fetch) {
  if (!apiKey) return false;
  try {
    const res = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { MIN_LENGTH, passwordProblem, isCurrentPassword, SAME_PASSWORD_MESSAGE };
