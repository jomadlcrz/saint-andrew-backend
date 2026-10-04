/**
 * Transactional Email Templates (Calm Memorial Theme)
 */

const { escapeHtml } = require('../utils/sanitize.util');

/** St. Andrew logo for email headers (hosted on Google Drive) */
const LOGO_URL = 'https://lh3.googleusercontent.com/d/1c9jjuLr5Xf7aY0iLeQEjXHcyn8MTYawh';

/**
 * The navy header every email starts with: logo, name and a short line under it.
 * Centered for family account emails; logo beside the name for notices and staff emails.
 * @param {{ subtitle: string, centered?: boolean }} params (subtitle is trusted template text)
 */
function emailHeader({ subtitle, centered = false }) {
  const logo = (size, extra) =>
    `<img src="${LOGO_URL}" width="${size}" height="${size}" alt="St. Andrew Funeral Home" style="display: block; width: ${size}px; height: ${size}px; border-radius: 50%; background-color: #ffffff;${extra}">`;
  if (centered) {
    return `
          <tr>
            <td style="background-color: #1F3A5F; padding: 28px 32px; text-align: center;">
              ${logo(72, ' margin: 0 auto 12px auto;')}
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 600; letter-spacing: 0.5px;">St. Andrew Funeral Home</h1>
              <p style="margin: 4px 0 0 0; color: #D8C3A5; font-size: 13px;">${subtitle}</p>
            </td>
          </tr>`;
  }
  return `
          <tr>
            <td style="background-color: #1F3A5F; padding: 20px 30px;">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding-right: 14px; vertical-align: middle;">${logo(48, '')}</td>
                  <td style="vertical-align: middle;">
                    <h2 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">St. Andrew Funeral Home</h2>
                    <p style="margin: 4px 0 0 0; color: #D8C3A5; font-size: 13px;">${subtitle}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/**
 * Staff notification template for new customer support ticket
 */
function getSupportEmailTemplate({ name, email, message }) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Support Inquiry</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; border: 1px solid #E2E0D8; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          ${emailHeader({ subtitle: 'Customer Support Desk' })}
          <!-- Body -->
          <tr>
            <td style="padding: 30px; color: #2C4B66;">
              <h3 style="margin: 0 0 16px 0; color: #152A45; font-size: 18px;">New Support Inquiry Received</h3>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; width: 90px; color: #64748B; font-size: 14px; font-weight: 500;">From:</td>
                  <td style="padding: 8px 0; color: #1F3A5F; font-size: 14px; font-weight: 600;">${safeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748B; font-size: 14px; font-weight: 500;">Email:</td>
                  <td style="padding: 8px 0; color: #1F3A5F; font-size: 14px;"><a href="mailto:${safeEmail}" style="color: #1F3A5F; text-decoration: underline;">${safeEmail}</a></td>
                </tr>
              </table>
              <div style="border-top: 1px solid #E2E0D8; padding-top: 16px;">
                <p style="margin: 0 0 8px 0; color: #64748B; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Message Content</p>
                <div style="background-color: #FBF9F5; border-left: 3px solid #B08D57; padding: 16px; border-radius: 4px; color: #1F3A5F; font-size: 15px; line-height: 1.6;">
                  ${safeMessage}
                </div>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #FBF9F5; padding: 16px 30px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              Direct inquiry submitted via St. Andrew Funeral Home Portal
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * One-Time Password (OTP) verification email template
 */
function getOtpEmailTemplate({ otp, expiryMinutes = 15 }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border-radius: 12px; border: 1px solid #E2E0D8; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
          ${emailHeader({ subtitle: 'Security & Account Verification', centered: true })}
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px; text-align: center; color: #2C4B66;">
              <h2 style="margin: 0 0 12px 0; color: #152A45; font-size: 20px; font-weight: 600;">Verification Code</h2>
              <p style="margin: 0 0 24px 0; color: #64748B; font-size: 15px; line-height: 1.5;">
                We received a request to access or reset your account password. Use the verification code below to proceed:
              </p>
              <!-- OTP Box -->
              <div style="margin: 24px auto; padding: 18px 24px; background-color: #FBF9F5; border: 1px dashed #B08D57; border-radius: 8px; display: inline-block;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #1F3A5F; margin-left: 10px;">
                  ${otp}
                </span>
              </div>
              <p style="margin: 20px 0 0 0; color: #B08D57; font-size: 14px; font-weight: 500;">
                ⏱️ This code will expire in ${expiryMinutes} minutes.
              </p>
              <p style="margin: 16px 0 0 0; color: #64748B; font-size: 13px; line-height: 1.5;">
                If you did not request this verification code, please disregard this email. Your account remains secure.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #FBF9F5; padding: 18px 32px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              © ${new Date().getFullYear()} St. Andrew Funeral Home. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Direct password reset link email template
 */
function getResetLinkEmailTemplate({ resetLink, expiryHours = 1 }) {
  const safeLink = escapeHtml(resetLink);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border-radius: 12px; border: 1px solid #E2E0D8; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
          ${emailHeader({ subtitle: 'Account Recovery', centered: true })}
          <tr>
            <td style="padding: 36px 32px; text-align: center; color: #2C4B66;">
              <h2 style="margin: 0 0 12px 0; color: #152A45; font-size: 20px; font-weight: 600;">Reset Your Password</h2>
              <p style="margin: 0 0 28px 0; color: #64748B; font-size: 15px; line-height: 1.5;">
                We received a request to reset your password. Click the button below to choose a new password:
              </p>
              <div style="margin: 28px 0;">
                <a href="${safeLink}" target="_blank" style="background-color: #1F3A5F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.3px; border: 1px solid #152A45;">
                  Reset Password
                </a>
              </div>
              <p style="margin: 24px 0 0 0; color: #64748B; font-size: 13px; line-height: 1.5;">
                This link will safely expire in ${expiryHours} hour(s). If you did not request a password change, you may safely ignore this message.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #FBF9F5; padding: 18px 32px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              © ${new Date().getFullYear()} St. Andrew Funeral Home. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Sign-up: confirm the family's email address (replaces Firebase's own verification email)
 * @param {{ name?: string, verifyLink: string }} params
 */
function getVerifyEmailTemplate({ name, verifyLink }) {
  const safeLink = escapeHtml(verifyLink);
  const greeting = name && name.trim() ? `Hello ${escapeHtml(name.trim())},` : 'Hello,';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border-radius: 12px; border: 1px solid #E2E0D8; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
          ${emailHeader({ subtitle: 'Account Verification', centered: true })}
          <tr>
            <td style="padding: 36px 32px; text-align: center; color: #2C4B66;">
              <h2 style="margin: 0 0 12px 0; color: #152A45; font-size: 20px; font-weight: 600;">Verify Your Email</h2>
              <p style="margin: 0 0 8px 0; color: #64748B; font-size: 15px; line-height: 1.5;">${greeting}</p>
              <p style="margin: 0 0 28px 0; color: #64748B; font-size: 15px; line-height: 1.5;">
                Thank you for creating an account with St. Andrew Funeral Home. Please confirm your email address by clicking the button below:
              </p>
              <div style="margin: 28px 0;">
                <a href="${safeLink}" target="_blank" style="background-color: #1F3A5F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.3px; border: 1px solid #152A45;">
                  Verify Email Address
                </a>
              </div>
              <p style="margin: 24px 0 0 0; color: #64748B; font-size: 13px; line-height: 1.5;">
                If you did not create this account, you may safely ignore this message.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #FBF9F5; padding: 18px 32px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              St. Andrew Funeral Home · Poblacion, Sual, Pangasinan
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Staff alert: what families sent (new requests, receipts to check, burial change requests)
 * @param {{ items: { kind: string, title: string, detail: string, at: number, id: string }[], adminUrl?: string }} params
 */
function getStaffAlertEmailTemplate({ items, adminUrl = '' }) {
  const KIND_LABEL = { request: 'New request', receipt: 'Receipt to check', schedule: 'Burial change request' };
  const when = (ms) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  const rows = items
    .map(
      (item) => `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #E2E0D8;">
                    <p style="margin: 0 0 2px 0; color: #B08D57; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">${escapeHtml(KIND_LABEL[item.kind] || 'Update')}</p>
                    <p style="margin: 0; color: #1F3A5F; font-size: 15px; font-weight: 600;">${escapeHtml(item.title)}</p>
                    <p style="margin: 2px 0 0 0; color: #64748B; font-size: 13px;">${escapeHtml(item.detail)} · ${escapeHtml(when(item.at))}</p>
                  </td>
                </tr>`
    )
    .join('');
  const button = adminUrl
    ? `<p style="margin: 24px 0 0 0;"><a href="${escapeHtml(adminUrl)}" style="display: inline-block; background-color: #1F3A5F; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">Open the admin portal</a></p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Needs your attention</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; border: 1px solid #E2E0D8; overflow: hidden;">
          ${emailHeader({ subtitle: 'From families, waiting for staff' })}
          <tr>
            <td style="padding: 24px 30px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">${rows}
              </table>
              ${button}
            </td>
          </tr>
          <tr>
            <td style="background-color: #FBF9F5; padding: 16px 30px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              Review these in the admin portal. You won't be emailed about the same item twice.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * A notice to a family (the same words as their in-app notification), with a button to open it on
 * the website. Used for their contract once staff accept the arrangement.
 */
function getFamilyNoticeEmailTemplate({ title, body, link, attachmentNote = '' }) {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body).replace(/\r?\n/g, '<br>');
  const safeLink = escapeHtml(link);
  const safeNote = escapeHtml(attachmentNote);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3EFE8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3EFE8; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 10px; border: 1px solid #E2E0D8; overflow: hidden;">
          ${emailHeader({ subtitle: 'Poblacion, Sual, Pangasinan · 0921-536-9147 / 0927-410-7716' })}
          <tr>
            <td style="padding: 30px; color: #2C4B66;">
              <h3 style="margin: 0 0 12px 0; color: #152A45; font-size: 18px;">${safeTitle}</h3>
              <p style="margin: 0 0 20px 0; color: #1F3A5F; font-size: 15px; line-height: 1.6;">${safeBody}</p>
              ${safeLink ? `<p style="margin: 0 0 20px 0;"><a href="${safeLink}" style="display: inline-block; background-color: #1F3A5F; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-size: 15px; font-weight: 600;">View it online</a></p>` : ''}
              ${safeNote ? `<p style="margin: 0; color: #64748B; font-size: 13px; line-height: 1.5;">${safeNote}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background-color: #FBF9F5; padding: 16px 30px; border-top: 1px solid #E2E0D8; text-align: center; color: #64748B; font-size: 12px;">
              You received this because you made an arrangement with St. Andrew Funeral Home. Questions? Chat with us in the app or call our office.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

module.exports = {
  getFamilyNoticeEmailTemplate,
  getSupportEmailTemplate,
  getOtpEmailTemplate,
  getResetLinkEmailTemplate,
  getVerifyEmailTemplate,
  getStaffAlertEmailTemplate,
};
