/**
 * Account lookup & arrangement track/claim unit tests (no network, no Firebase).
 * Run: npm run test:arrangements
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountLookup } = require('../src/services/account-lookup.service');
const { createArrangementService, NOT_FOUND_MESSAGE } = require('../src/services/arrangement.service');

/** Minimal in-memory Firestore: equality / `in` queries, doc get, batched updates. */
function createFakeFirestore(seed) {
  const store = new Map(Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(docs))]));
  const writes = [];

  function docRef(collectionName, id) {
    return {
      id,
      path: `${collectionName}/${id}`,
      async get() {
        const data = store.get(collectionName)?.get(id);
        return { id, exists: Boolean(data), ref: docRef(collectionName, id), data: () => data };
      },
    };
  }

  function query(collectionName, filters, max) {
    return {
      where(field, op, value) {
        return query(collectionName, [...filters, { field, op, value }], max);
      },
      limit(n) {
        return query(collectionName, filters, n);
      },
      async get() {
        const docs = [...(store.get(collectionName) || new Map()).entries()]
          .filter(([, data]) =>
            filters.every(({ field, op, value }) =>
              op === 'in' ? value.includes(data[field]) : data[field] === value
            )
          )
          .slice(0, max ?? Infinity)
          .map(([id, data]) => ({ id, ref: docRef(collectionName, id), data: () => data }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }

  return {
    writes,
    read: (collectionName, id) => store.get(collectionName)?.get(id),
    collection(name) {
      return { ...query(name, []), doc: (id) => docRef(name, id) };
    },
    batch() {
      const pending = [];
      return {
        update(ref, data) {
          pending.push({ ref, data });
        },
        async commit() {
          for (const { ref, data } of pending) {
            const [collectionName, id] = ref.path.split('/');
            store.get(collectionName).set(id, { ...store.get(collectionName).get(id), ...data });
            writes.push({ path: ref.path, data });
          }
        },
      };
    },
  };
}

const SERVER_TS = '__server_ts__';

function arrangementsFixture() {
  return createFakeFirestore({
    transactions: {
      walkin1: {
        referenceCode: 'SAFH-1001',
        userId: 'walk-in',
        clientName: 'Maria Santos',
        clientPhone: '+639171234567',
        clientEmail: 'maria@example.com',
        deceasedName: 'Jose Santos',
        status: 'accepted',
        totalPrice: 50000,
        amountPaid: 10000,
        balance: 40000,
        proofOfPaymentUrl: 'data:image/jpeg;base64,secret',
      },
      owned1: { referenceCode: 'SAFH-2002', userId: 'someone-else', clientPhone: '09181112222' },
      mirrorTxn: { referenceCode: 'PN-3003', userId: 'web-client', clientPhone: '09193334444' },
      MixedCaseDocId: { userId: '', clientPhone: '09205556666', deceasedName: 'Ana Cruz' },
    },
    pre_plans: {
      plan1: {
        referenceNumber: 'PN-3003',
        contactPhone: '09193334444',
        contactName: 'Pedro Reyes',
        totalAmount: 90000,
        amountPaid: 0,
        requestStatus: 'Pending',
      },
    },
  });
}

function service(firestore) {
  return createArrangementService({ db: firestore, serverTimestamp: () => SERVER_TS });
}

// ── Account lookup ────────────────────────────────────────────────────────────

test('resolves the login email for a number stored in either 09 or +63 form', async () => {
  const lookup = createAccountLookup({
    db: createFakeFirestore({
      users: {
        u1: { phone: '09171234567', email: 'a@example.com' },
        u2: { phone: '+639181234567', email: 'b@example.com' },
      },
    }),
  });
  assert.equal(await lookup.resolveLoginEmail('+639171234567'), 'a@example.com');
  assert.equal(await lookup.resolveLoginEmail('09181234567'), 'b@example.com');
  assert.equal(await lookup.resolveLoginEmail('09990000000'), null);
});

test('phone availability ignores only the caller’s own account', async () => {
  const lookup = createAccountLookup({
    db: createFakeFirestore({ users: { u1: { phone: '09171234567' } } }),
  });
  assert.equal(await lookup.isPhoneAvailable('09171234567'), false);
  assert.equal(await lookup.isPhoneAvailable('09171234567', 'u2'), false);
  assert.equal(await lookup.isPhoneAvailable('09171234567', 'u1'), true);
  assert.equal(await lookup.isPhoneAvailable('09990000000'), true);
});

// ── Tracking ──────────────────────────────────────────────────────────────────

test('tracks an arrangement with reference code + matching phone, without contact or payment details', async () => {
  const summary = await service(arrangementsFixture()).trackArrangement({
    code: 'safh-1001',
    phone: '09171234567',
  });
  assert.equal(summary.referenceCode, 'SAFH-1001');
  assert.equal(summary.deceasedName, 'Jose Santos');
  assert.equal(summary.balance, 40000);
  for (const key of ['clientPhone', 'clientEmail', 'proofOfPaymentUrl', 'userId']) {
    assert.equal(key in summary, false, `${key} must not be exposed`);
  }
});

test('a wrong phone and an unknown code return the same not-found error', async () => {
  const svc = service(arrangementsFixture());
  await assert.rejects(svc.trackArrangement({ code: 'SAFH-1001', phone: '09999999999' }), {
    status: 404,
    message: NOT_FOUND_MESSAGE,
  });
  await assert.rejects(svc.trackArrangement({ code: 'NOPE-0000', phone: '09171234567' }), {
    status: 404,
    message: NOT_FOUND_MESSAGE,
  });
});

test('rejects malformed input before touching the database', async () => {
  const svc = service(arrangementsFixture());
  await assert.rejects(svc.trackArrangement({ code: '', phone: '09171234567' }), { status: 400 });
  await assert.rejects(svc.trackArrangement({ code: 'a/b', phone: '09171234567' }), { status: 400 });
  await assert.rejects(svc.trackArrangement({ code: 'SAFH-1001', phone: '12345' }), { status: 400 });
});

test('finds a transaction by its exact (case-sensitive) document id', async () => {
  const svc = service(arrangementsFixture());
  const byId = await svc.trackArrangement({ code: 'MixedCaseDocId', phone: '09205556666' });
  assert.equal(byId.deceasedName, 'Ana Cruz');
});

// ── Claiming ──────────────────────────────────────────────────────────────────

test('claims a walk-in arrangement for the caller', async () => {
  const firestore = arrangementsFixture();
  await service(firestore).claimArrangement({ code: 'SAFH-1001', phone: '0917 123 4567', uid: 'family-1' });
  assert.equal(firestore.read('transactions', 'walkin1').userId, 'family-1');
  assert.deepEqual(firestore.writes, [
    { path: 'transactions/walkin1', data: { userId: 'family-1', updatedAt: SERVER_TS } },
  ]);
});

test('claiming a pre-plan also claims its mirrored transaction', async () => {
  const firestore = arrangementsFixture();
  await service(firestore).claimArrangement({ code: 'PN-3003', phone: '09193334444', uid: 'family-2' });
  assert.equal(firestore.read('transactions', 'mirrorTxn').userId, 'family-2');
  assert.equal(firestore.read('pre_plans', 'plan1').userId, 'family-2');
});

test('refuses to claim an arrangement owned by another account', async () => {
  const firestore = arrangementsFixture();
  await assert.rejects(
    service(firestore).claimArrangement({ code: 'SAFH-2002', phone: '09181112222', uid: 'family-1' }),
    { status: 409 }
  );
  assert.equal(firestore.writes.length, 0);
});

test('re-claiming your own arrangement is a no-op success', async () => {
  const firestore = arrangementsFixture();
  const summary = await service(firestore).claimArrangement({
    code: 'SAFH-2002',
    phone: '09181112222',
    uid: 'someone-else',
  });
  assert.equal(summary.referenceCode, 'SAFH-2002');
});

test('refuses to claim with a phone that is not on the record', async () => {
  const firestore = arrangementsFixture();
  await assert.rejects(
    service(firestore).claimArrangement({ code: 'SAFH-1001', phone: '09999999999', uid: 'family-1' }),
    { status: 404 }
  );
  assert.equal(firestore.writes.length, 0);
});
