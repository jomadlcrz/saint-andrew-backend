/**
 * Phone-number accounts: sign-up, sign-in lookup and password reset by SMS code (no network, no
 * Firebase). Run: npm run test:phone-accounts
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhoneAccounts, isInternalEmail, RESEND_COOLDOWN_MS } = require('../src/services/phone-account.service');
const { createAccountLookup } = require('../src/services/account-lookup.service');

/** In-memory Firestore: doc get/set and equality / `in` queries on one level. */
function fakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const query = (name, filters, max) => ({
    where: (field, op, value) => query(name, [...filters, { field, op, value }], max),
    limit: (n) => query(name, filters, n),
    async get() {
      const docs = [...col(name).entries()]
        .filter(([, d]) => filters.every(({ field, op, value }) => (op === 'in' ? value.includes(d[field]) : d[field] === value)))
        .slice(0, max ?? Infinity)
        .map(([id, d]) => ({ id, data: () => d }));
      return { docs, empty: docs.length === 0 };
    },
  });
  return {
    store,
    collection: (name) => ({
      ...query(name, []),
      doc: (id) => ({
        async get() {
          const d = col(name).get(id);
          return { exists: Boolean(d), data: () => d };
        },
        async set(d) {
          col(name).set(id, { ...d });
        },
      }),
    }),
  };
}

function setup({ users = {}, failUserWrite = false, dailySmsLimit } = {}) {
  const db = fakeFirestore({ users });
  if (failUserWrite) {
    const original = db.collection;
    db.collection = (name) => {
      const c = original(name);
      return name === 'users' ? { ...c, doc: () => ({ set: async () => { throw new Error('write failed'); } }) } : c;
    };
  }
  const sent = [];
  const codes = new Map();
  const tokens = new Map();
  // 3 Oct 2026, Manila (date-of-birth checks need a real date)
  let clock = Date.UTC(2026, 9, 3, 2);
  const authUsers = new Map();
  const auth = {
    async createUser(u) {
      const uid = `uid-${authUsers.size + 1}`;
      authUsers.set(uid, { uid, ...u });
      return { uid };
    },
    async deleteUser(uid) {
      authUsers.delete(uid);
    },
    async getUserByEmail(email) {
      const u = [...authUsers.values()].find((x) => x.email === email);
      if (!u) throw new Error('no user');
      return u;
    },
    async updateUser(uid, patch) {
      Object.assign(authUsers.get(uid), patch);
    },
    async revokeRefreshTokens(uid) {
      authUsers.get(uid).revoked = true;
    },
  };
  const otp = {
    generateOtp: () => '123456',
    async storeOtp(key, code) {
      codes.set(key, code);
    },
    async verifyOtp(key, code) {
      return codes.get(key) === code ? { valid: true } : { valid: false, reason: 'Invalid verification code.' };
    },
    async clearOtp(key) {
      codes.delete(key);
    },
  };
  const resetTokens = {
    async issueResetToken(key) {
      tokens.set(key, 'tok');
      return 'tok';
    },
    async verifyAndConsumeResetToken(key, token) {
      const ok = tokens.get(key) === token;
      tokens.delete(key);
      return ok ? { valid: true } : { valid: false, reason: 'expired' };
    },
  };
  const lookup = createAccountLookup({ db });
  const sms = { sendSms: async (m) => sent.push(m) };
  const service = createPhoneAccounts({ db, auth, otp, resetTokens, sms, lookup, now: () => clock, dailySmsLimit });
  return { service, db, sent, authUsers, lookup, tick: (ms) => (clock += ms) };
}

const PERSON = { firstName: 'Maria', lastName: 'Santos', password: 'Sunset2026', address: 'Sual, Pangasinan', gender: 'Female', birthday: '1960-03-04' };

test('signs up with a mobile number and an SMS code: no email, active, signs in by number', async () => {
  const { service, db, sent, authUsers, lookup } = setup();
  assert.deepEqual(await service.requestCode({ phone: '+639171234567', purpose: 'signup' }), { sent: true });
  assert.equal(sent[0].number, '09171234567');
  assert.match(sent[0].message, /123456/);

  const { uid } = await service.register({ phone: '09171234567', otp: '123456', ...PERSON });
  const record = db.store.get('users').get(uid);
  assert.equal(record.email, '');
  assert.equal(record.phone, '09171234567');
  assert.equal(record.status, 'active');
  assert.equal(record.signUpMethod, 'phone');
  assert.equal(record.address, 'Sual, Pangasinan');
  assert.equal(record.birthday, '1960-03-04');
  assert.equal(record.addressParts, undefined);
  assert.ok(isInternalEmail(record.loginEmail));
  // The Firebase account signs in with the internal email, already counted as verified
  assert.equal(authUsers.get(uid).email, record.loginEmail);
  assert.equal(authUsers.get(uid).emailVerified, true);
  // Signing in with the number finds that email
  assert.equal(await lookup.resolveLoginEmail('09171234567'), record.loginEmail);
});

test('refuses a number that is already registered, and a wrong code', async () => {
  const { service } = setup({ users: { u1: { phone: '09171234567', email: 'maria@example.com' } } });
  await assert.rejects(service.requestCode({ phone: '09171234567', purpose: 'signup' }), (e) => e.status === 409);

  const fresh = setup();
  await fresh.service.requestCode({ phone: '09170000000', purpose: 'signup' });
  await assert.rejects(fresh.service.register({ phone: '09170000000', otp: '999999', ...PERSON }), /Invalid verification code/);
});

test('one code per number per minute (SMS credits)', async () => {
  const { service, sent, tick } = setup();
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  await assert.rejects(service.requestCode({ phone: '09171234567', purpose: 'signup' }), (e) => e.status === 429);
  tick(RESEND_COOLDOWN_MS);
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  assert.equal(sent.length, 2);
});

test('checks the name, password and number before anything is created', async () => {
  const { service, authUsers } = setup();
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON, password: 'short' }));
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON, firstName: '' }));
  // 18 and over only, and gender is required
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON, birthday: '' }), /date of birth/);
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON, birthday: '2015-01-01' }), /at least 18/);
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON, gender: '' }), /gender/);
  await assert.rejects(service.requestCode({ phone: '12345', purpose: 'signup' }), /valid Philippine mobile number/);
  assert.equal(authUsers.size, 0);
});

test('no half-made accounts when the record cannot be saved', async () => {
  const { service, authUsers } = setup({ failUserWrite: true });
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  await assert.rejects(service.register({ phone: '09171234567', otp: '123456', ...PERSON }), /write failed/);
  assert.equal(authUsers.size, 0);
});

test('resets the password by SMS code and signs out other devices', async () => {
  const { service, authUsers, tick } = setup();
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  const { uid } = await service.register({ phone: '09171234567', otp: '123456', ...PERSON });

  tick(RESEND_COOLDOWN_MS);
  assert.deepEqual(await service.requestCode({ phone: '09171234567', purpose: 'reset' }), { sent: true });
  const { resetToken } = await service.verifyResetCode({ phone: '09171234567', otp: '123456' });
  await service.resetPassword({ phone: '09171234567', token: resetToken, newPassword: 'Moonrise2027' });
  assert.equal(authUsers.get(uid).password, 'Moonrise2027');
  assert.equal(authUsers.get(uid).revoked, true);
  // The token works once
  await assert.rejects(service.resetPassword({ phone: '09171234567', token: resetToken, newPassword: 'Starlight2028' }));
});

test('a reset for an unregistered number sends nothing and looks the same', async () => {
  const { service, sent } = setup();
  assert.deepEqual(await service.requestCode({ phone: '09175555555', purpose: 'reset' }), { sent: false });
  assert.equal(sent.length, 0);
});

test('at most 5 codes per number per day, even a minute apart', async () => {
  const { service, tick } = setup();
  for (let i = 0; i < 5; i++) {
    await service.requestCode({ phone: '09171234567', purpose: 'signup' });
    tick(RESEND_COOLDOWN_MS);
  }
  await assert.rejects(service.requestCode({ phone: '09171234567', purpose: 'signup' }), (e) => e.status === 429 && /today/.test(e.message));
  // The next day it works again
  tick(24 * 60 * 60 * 1000);
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
});

test('a daily limit for all SMS codes protects the credits from many-number abuse', async () => {
  const { service, sent } = setup({ dailySmsLimit: 3 });
  for (const n of ['09170000001', '09170000002', '09170000003']) await service.requestCode({ phone: n, purpose: 'signup' });
  await assert.rejects(service.requestCode({ phone: '09170000004', purpose: 'signup' }), (e) => e.status === 503);
  assert.equal(sent.length, 3);
});

test('a date of birth must be 18 to 120 years back (Manila day)', () => {
  const { birthdayProblem } = require('../src/services/phone-account.service');
  assert.equal(birthdayProblem('2008-10-03', '2026-10-03'), null);
  assert.match(birthdayProblem('2008-10-04', '2026-10-03'), /at least 18/);
  assert.match(birthdayProblem('2027-01-01', '2026-10-03'), /future/);
  assert.match(birthdayProblem('1906-10-02', '2026-10-03'), /check the year/);
  assert.match(birthdayProblem('', '2026-10-03'), /select your date of birth/);
});

test('keeps the address picked from the PSGC list next to the address text', async () => {
  const { service, db } = setup();
  await service.requestCode({ phone: '09171234567', purpose: 'signup' });
  const addressParts = { street: '12 Rizal St.', provinceCode: '015500000', provinceName: 'Pangasinan', cityCode: '015542000', cityName: 'Sual', barangayCode: '015542001', barangayName: 'Baquioen', extra: 'dropped' };
  const { uid } = await service.register({ phone: '09171234567', otp: '123456', ...PERSON, addressParts });
  const saved = db.store.get('users').get(uid).addressParts;
  assert.equal(saved.barangayName, 'Baquioen');
  assert.equal(saved.extra, undefined);
});

test('Find your account: says whether an email or a number has an account', async () => {
  const { createFindAccount } = require('../src/services/find-account.service');
  const auth = {
    async getUserByEmail(email) {
      if (email === 'maria@example.com') return { uid: 'u1' };
      const err = new Error('no user');
      err.code = 'auth/user-not-found';
      throw err;
    },
  };
  const lookup = { isPhoneAvailable: async (phone) => phone !== '09171234567' };
  const findAccount = createFindAccount({ auth, lookup });

  assert.deepEqual(await findAccount(' Maria@Example.com '), { found: true, kind: 'email' });
  assert.deepEqual(await findAccount('nobody@example.com'), { found: false, kind: 'email' });
  assert.deepEqual(await findAccount('0917 123 4567'), { found: true, kind: 'phone' });
  assert.deepEqual(await findAccount('+639181234567'), { found: false, kind: 'phone' });
  await assert.rejects(findAccount('maria'), /valid email address or mobile number/);
  // A number account's internal sign-in email can't be looked up
  await assert.rejects(findAccount('p.abc@phone.standrew.invalid'), /valid email address or mobile number/);
  await assert.rejects(findAccount(''), /enter your email or mobile number/);
});

test('a gateway failure reaches the family as a plain message, never the raw gateway error', async () => {
  const { createPhoneAccounts } = require('../src/services/phone-account.service');
  const failing = createPhoneAccounts({
    db: setup().db,
    auth: {},
    otp: { generateOtp: () => '123456', storeOtp: async () => {} },
    resetTokens: {},
    sms: { sendSms: async () => { const e = new Error('Semaphore API rejected request (400): {"apikey":["invalid"]}'); e.status = 400; throw e; } },
    lookup: { isPhoneAvailable: async () => true },
  });
  await assert.rejects(failing.requestCode({ phone: '09171234567', purpose: 'signup' }), (err) => {
    assert.equal(err.status, 503);
    assert.doesNotMatch(err.message, /Semaphore|apikey/);
    return true;
  });
});

test('the error handler never shows raw library errors', () => {
  const { getErrorMessage } = require('../src/middleware/error.middleware');
  assert.equal(getErrorMessage(new Error('Please enter your home address.'), 400), 'Please enter your home address.');
  assert.match(getErrorMessage(new Error('Firebase: Error (auth/invalid-credential).'), 400), /couldn't read that request/);
  assert.match(getErrorMessage(new Error('Cannot read properties of undefined'), 500), /Something went wrong on our side/);
  assert.match(getErrorMessage(Object.assign(new Error('Unexpected token } in JSON'), { type: 'entity.parse.failed' }), 400), /couldn't read that request/);
  assert.match(getErrorMessage(new Error('too many'), 429), /too many/);
});

