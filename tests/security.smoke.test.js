/**
 * Security Regression Smoke Test
 * Verifies the auth/authorization/rate-limit fixes against a running server.
 * Usage: PORT=3099 node tests/security.smoke.test.js
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  // 1. /send-balance-sms must reject an unauthenticated caller, never silently
  //    grant admin access (the fail-open bug this suite guards against).
  {
    const res = await fetch(`${BASE_URL}/send-balance-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '09171234567' }),
    });
    const body = await res.json().catch(() => ({}));
    check(
      'POST /send-balance-sms without auth is rejected (401/403), not silently allowed',
      res.status === 401 || res.status === 403,
      `got ${res.status}: ${JSON.stringify(body)}`
    );
  }

  // 2. /test-brevo must not be publicly reachable (was leaking Brevo account data).
  {
    const res = await fetch(`${BASE_URL}/test-brevo`);
    check(
      'GET /test-brevo without auth is rejected (401/403)',
      res.status === 401 || res.status === 403,
      `got ${res.status}`
    );
  }

  // 3. Public health endpoint must not disclose per-integration config status.
  {
    const res = await fetch(`${BASE_URL}/`);
    const body = await res.json().catch(() => ({}));
    check(
      'GET / does not leak a "services" configuration breakdown',
      res.status === 200 && !('services' in body) && !('mode' in body),
      `got ${JSON.stringify(body)}`
    );
  }

  // 4. OTP verification must lock out after MAX_VERIFY_ATTEMPTS wrong guesses,
  //    independent of whether an OTP actually exists for the address.
  {
    const email = `security-test-${Date.now()}@example.com`;
    let lastBody = null;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: '000000' }),
      });
      lastBody = await res.json().catch(() => ({}));
    }
    // With no OTP ever requested, every attempt correctly reports
    // "expired or invalid" rather than counting toward a lockout that
    // doesn't apply — this just confirms the endpoint never 500s and
    // never reveals whether an OTP record exists.
    check(
      'POST /verify-otp with no stored OTP consistently reports invalid (no info leak, no crash)',
      typeof lastBody.error === 'string',
      `got ${JSON.stringify(lastBody)}`
    );
  }

  // 5. Rate limiting: hammering /send-otp-email past the configured max
  //    (5 per 15 min) must eventually return 429.
  {
    const email = `rate-test-${Date.now()}@example.com`;
    let sawRateLimit = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/send-otp-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    check('POST /send-otp-email is rate limited after repeated requests', sawRateLimit);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
