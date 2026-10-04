/**
 * Sign-up verification email through Brevo (no network, no Firebase).
 * Run: npm run test:verify-email
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyEmailService } = require('../src/services/verify-email.service');
const { getVerifyEmailTemplate } = require('../src/templates/email.templates');

function setup(user) {
  const sent = [];
  const service = createVerifyEmailService({
    getUser: async () => user,
    makeLink: async (email) => `https://example.firebaseapp.com/__/auth/action?mode=verifyEmail&email=${email}&oobCode=abc`,
    sendEmail: async (message) => sent.push(message),
  });
  return { service, sent };
}

test('emails the St. Andrew verification email with the Firebase link', async () => {
  const { service, sent } = setup({ email: 'maria@example.com', emailVerified: false, displayName: 'Maria Santos' });
  assert.equal(await service.send('u1'), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'maria@example.com');
  assert.equal(sent[0].subject, 'Verify your email – St. Andrew Funeral Home');
  assert.equal(sent[0].senderName, 'St. Andrew Funeral Home');
  assert.match(sent[0].htmlContent, /Hello Maria Santos,/);
  assert.match(sent[0].htmlContent, /mode=verifyEmail&amp;email=maria@example\.com&amp;oobCode=abc/);
  assert.match(sent[0].htmlContent, /lh3\.googleusercontent\.com\/d\/1c9jjuLr5Xf7aY0iLeQEjXHcyn8MTYawh/);
});

test('sends nothing when the email is already verified', async () => {
  const { service, sent } = setup({ email: 'maria@example.com', emailVerified: true });
  assert.equal(await service.send('u1'), 'already-verified');
  assert.equal(sent.length, 0);
});

test('refuses accounts that sign in with a mobile number, and callers without an account', async () => {
  const phone = setup({ email: '639171234567@phone.saintandrew.invalid', emailVerified: false });
  await assert.rejects(phone.service.send('u1'), (err) => err.status === 400);
  assert.equal(phone.sent.length, 0);
  await assert.rejects(setup({}).service.send(''), (err) => err.status === 401);
});

test('the email escapes the name and still greets families without one', () => {
  assert.match(getVerifyEmailTemplate({ name: '<b>Ana</b>', verifyLink: 'https://x' }), /Hello &lt;b&gt;Ana&lt;\/b&gt;,/);
  assert.match(getVerifyEmailTemplate({ name: '', verifyLink: 'https://x' }), />Hello,</);
});

test('every email template starts with the St. Andrew logo', () => {
  const T = require('../src/templates/email.templates');
  const emails = {
    otp: T.getOtpEmailTemplate({ otp: '482913' }),
    reset: T.getResetLinkEmailTemplate({ resetLink: 'https://x' }),
    verify: T.getVerifyEmailTemplate({ verifyLink: 'https://x' }),
    support: T.getSupportEmailTemplate({ name: 'Maria', email: 'maria@example.com', message: 'Hi' }),
    staff: T.getStaffAlertEmailTemplate({ items: [] }),
    family: T.getFamilyNoticeEmailTemplate({ title: 'Update', body: 'Hello', link: '' }),
  };
  const templates = Object.keys(T).filter((name) => /^get\w+EmailTemplate$/.test(name));
  assert.equal(templates.length, Object.keys(emails).length, 'a new template should be added here too');
  for (const [name, html] of Object.entries(emails)) {
    assert.match(html, /<img src="https:\/\/lh3\.googleusercontent\.com\/d\/1c9jjuLr5Xf7aY0iLeQEjXHcyn8MTYawh"/, name);
  }
});
