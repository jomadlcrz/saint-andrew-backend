/**
 * Sign-up email verification sent through Brevo (St. Andrew branding) instead of Firebase's
 * own email, which can't be changed for this project. Firebase still makes and checks the link.
 */

const { getVerifyEmailTemplate } = require('../templates/email.templates');

/** Accounts that sign in with a mobile number get a placeholder email (…@*.invalid) */
const isRealEmail = (email) => Boolean(email) && !/\.invalid$/i.test(email);

function statusError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * @param {{
 *   getUser: (uid: string) => Promise<{ email?: string, emailVerified?: boolean, displayName?: string }>,
 *   makeLink: (email: string) => Promise<string>,
 *   sendEmail: (message: { to: string, subject: string, htmlContent: string, senderName: string }) => Promise<unknown>,
 * }} deps
 */
function createVerifyEmailService({ getUser, makeLink, sendEmail }) {
  return {
    /** Emails the verification link to the account. Returns 'sent' or 'already-verified'. */
    async send(uid) {
      if (!uid) throw statusError(401, 'Please sign in again.');
      const user = await getUser(uid);
      if (user.emailVerified) return 'already-verified';
      if (!isRealEmail(user.email)) throw statusError(400, 'This account has no email address to verify.');

      const verifyLink = await makeLink(user.email);
      await sendEmail({
        to: user.email,
        subject: 'Verify your email – St. Andrew Funeral Home',
        htmlContent: getVerifyEmailTemplate({ name: user.displayName, verifyLink }),
        senderName: 'St. Andrew Funeral Home',
      });
      return 'sent';
    },
  };
}

module.exports = { createVerifyEmailService };
