/**
 * Test Suite for SMS Controller Idempotency & Validation Rules
 */
const assert = require('assert');
const { sendBalanceSms } = require('../src/controllers/sms.controller');

async function runTests() {
  console.log('🧪 Starting SMS Controller Idempotency & Validation Test Suite...\n');

  function createMockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  // 1. Phone validation rejection
  {
    const req = {
      body: { phone: '09123', message: 'Test message' },
      headers: {},
    };
    const res = createMockRes();
    await sendBalanceSms(req, res, (err) => { throw err; });
    assert.strictEqual(res.statusCode, 400, 'Invalid phone number should return HTTP 400');
    assert.ok(res.body.error.includes('11-digit Philippine mobile number'), 'Should report Philippine phone format error');
    console.log('✅ Rejects invalid phone numbers with descriptive error');
  }

  // 2. Numeric balance injection rejection (prevent letters in numeric balance)
  {
    const req = {
      body: {
        phone: '09171234567',
        balance: '5000PHP', // Characters in numeric field
        message: 'Balance test',
      },
      headers: {},
    };
    const res = createMockRes();
    await sendBalanceSms(req, res, (err) => { throw err; });
    assert.strictEqual(res.statusCode, 400, 'Non-numeric balance should return HTTP 400');
    assert.ok(res.body.error.includes('valid numeric amount'), 'Should report numeric error on character injection');
    console.log('✅ Rejects character injections in numeric balance field');
  }

  // 3. First valid SMS dispatch succeeds
  const key1 = `test_idem_${Date.now()}_1`;
  {
    const req = {
      body: {
        phone: '09171234567',
        message: 'Your arrangement contract is confirmed.',
        idempotencyKey: key1,
      },
      headers: {},
    };
    const res = createMockRes();
    await sendBalanceSms(req, res, (err) => { throw err; });
    assert.strictEqual(res.statusCode, 200, 'First request should succeed with HTTP 200');
    assert.strictEqual(res.body.success, true, 'First request should return success');
    console.log('✅ Dispatches first SMS request successfully');
  }

  // 4. Duplicate request within TTL window is intercepted & blocked
  {
    const req = {
      body: {
        phone: '09171234567',
        message: 'Your arrangement contract is confirmed.',
        idempotencyKey: key1,
      },
      headers: {},
    };
    const res = createMockRes();
    await sendBalanceSms(req, res, (err) => { throw err; });
    assert.strictEqual(res.statusCode, 200, 'Duplicate request should return HTTP 200');
    assert.strictEqual(res.body.idempotent, true, 'Duplicate request should have idempotent: true');
    assert.strictEqual(res.body.duplicateBlocked, true, 'Duplicate request should have duplicateBlocked: true');
    console.log('✅ Intercepts and blocks duplicate SMS submission with identical key');
  }

  // 5. Header-based idempotency key support (X-Idempotency-Key)
  const headerKey = `header_idem_${Date.now()}_2`;
  {
    const req1 = {
      body: { phone: '09171234567', message: 'Header key message' },
      headers: { 'x-idempotency-key': headerKey },
    };
    const res1 = createMockRes();
    await sendBalanceSms(req1, res1, (err) => { throw err; });
    assert.strictEqual(res1.statusCode, 200);

    const req2 = {
      body: { phone: '09171234567', message: 'Header key message' },
      headers: { 'x-idempotency-key': headerKey },
    };
    const res2 = createMockRes();
    await sendBalanceSms(req2, res2, (err) => { throw err; });
    assert.strictEqual(res2.body.idempotent, true, 'Header-based key duplicate must be blocked');
    console.log('✅ Successfully respects X-Idempotency-Key request headers');
  }

  // 6. Payload fingerprint deduplication (when client does not pass explicit key)
  {
    const uniqueMsg = `Fingerprint test ${Date.now()}`;
    const req1 = {
      body: { phone: '09189876543', message: uniqueMsg },
      headers: {},
    };
    const res1 = createMockRes();
    await sendBalanceSms(req1, res1, (err) => { throw err; });
    assert.strictEqual(res1.statusCode, 200);

    // Immediate repeat with identical phone and message
    const req2 = {
      body: { phone: '09189876543', message: uniqueMsg },
      headers: {},
    };
    const res2 = createMockRes();
    await sendBalanceSms(req2, res2, (err) => { throw err; });
    assert.strictEqual(res2.body.idempotent, true, 'Automatic fingerprint must intercept duplicate payload');
    assert.strictEqual(res2.body.duplicateBlocked, true);
    console.log('✅ Automatically generates fingerprint and blocks duplicates without explicit key');
  }

  console.log('\n🎉 All SMS Idempotency & Validation tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
