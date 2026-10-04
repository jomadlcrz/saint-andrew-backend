/**
 * St. Andrew Chapel availability unit tests (no network, no Firebase).
 * The cases match admin-web tests/chapel.test.ts (src/lib/shared/funeral-rules.ts chapelStayOf).
 * Run: npm run test:chapel
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { chapelStayOf, chapelStays, createChapelService, dayOf } = require('../src/services/chapel.service');

test('a wake has the chapel from its Start of Mourning through its Last Night', () => {
  const busy = { from: '2026-10-04', to: '2026-10-10' };
  assert.deepEqual(chapelStayOf({ viewing: 'chapel', startOfMourning: '2026-10-04', lastNight: '2026-10-10', burial: '2026-10-11' }), busy);
  assert.deepEqual(chapelStayOf({ viewing: 'chapel', startOfMourning: '2026-10-04', burial: '2026-10-11' }), busy);
  assert.deepEqual(chapelStayOf({ viewing: 'chapel', startOfMourning: '2026-10-05', chapelFrom: '2026-10-11', lastNight: '2026-10-14' }), { from: '2026-10-11', to: '2026-10-14' });
  assert.deepEqual(chapelStayOf({ viewing: 'chapel', startOfMourning: '2026-10-04', burialTBA: true }), { from: '2026-10-04', to: null });
  assert.equal(chapelStayOf({ viewing: 'home', startOfMourning: '2026-10-04', lastNight: '2026-10-10' }), null);
  assert.equal(chapelStayOf({ viewing: 'chapel', startOfMourning: '' }), null);
});

test('reads days stored as strings or Firestore Timestamps, in Philippine time', () => {
  assert.equal(dayOf('2026-10-04'), '2026-10-04');
  // 16:30 UTC on Oct 4 is already Oct 5 in Manila
  assert.equal(dayOf({ toDate: () => new Date('2026-10-04T16:30:00Z') }), '2026-10-05');
  assert.equal(dayOf('next week'), '');
});

const caseDoc = (id, data) => ({ id, data: { planKind: 'atNeed', lifecycleStatus: 'Claimed', viewingPreference: 'chapel', startOfMourning: '2026-10-04', lastNight: '2026-10-10', ...data } });
const request = (id, data) => ({ id, data: { status: 'in_progress', ...data } });

test('only accepted wakes that are not over hold the chapel, and only their days are shared', () => {
  const stays = chapelStays(
    [
      caseDoc('accepted'),
      caseDoc('paid', { startOfMourning: '2026-10-20', lastNight: '2026-10-22' }),
      caseDoc('pending', { startOfMourning: '2026-11-01', lastNight: '2026-11-03' }),
      caseDoc('declined', { startOfMourning: '2026-11-05', lastNight: '2026-11-07' }),
      caseDoc('over', { startOfMourning: '2026-09-01', lastNight: '2026-09-05' }),
      caseDoc('home', { viewingPreference: 'home', startOfMourning: '2026-10-12', lastNight: '2026-10-14' }),
      caseDoc('alive', { planKind: 'preNeed', lifecycleStatus: 'Active' }),
      caseDoc('tba', { startOfMourning: '2026-12-01', burialTBA: true, lastNight: null }),
    ],
    [
      request('accepted'),
      request('paid', { status: 'completed' }),
      request('pending', { status: 'pending' }),
      request('declined', { status: 'cancelled' }),
      request('over'),
      request('home'),
      request('tba'),
    ],
    '2026-10-04'
  );
  assert.deepEqual(stays, [
    { from: '2026-10-04', to: '2026-10-10' },
    { from: '2026-10-20', to: '2026-10-22' },
    { from: '2026-12-01', to: null },
  ]);
  for (const s of stays) assert.deepEqual(Object.keys(s).sort(), ['from', 'to'], 'days only, never who');
});

test('a Pre-Need plan claimed after the holder passed holds the chapel, linked by reference number', () => {
  const stays = chapelStays(
    [{ id: 'case-1', data: { planKind: 'preNeed', lifecycleStatus: 'Claimed', referenceNumber: 'PN-1', viewingPreference: 'chapel', startOfMourning: '2026-10-06', lastNight: '2026-10-09' } }],
    [request('req-1', { referenceCode: 'PN-1' })],
    '2026-10-04'
  );
  assert.deepEqual(stays, [{ from: '2026-10-06', to: '2026-10-09' }]);
});

test('the service reads both collections once a minute', async () => {
  let reads = 0;
  const collection = (name) => ({
    get: async () => {
      reads += 1;
      const docs = name === 'pre_plans' ? [caseDoc('accepted')] : [request('accepted')];
      return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });
  let now = new Date('2026-10-04T02:00:00Z');
  const service = createChapelService({ db: { collection }, now: () => now });
  const first = await service.availability();
  assert.deepEqual(first, { today: '2026-10-04', stays: [{ from: '2026-10-04', to: '2026-10-10' }] });
  await service.availability();
  assert.equal(reads, 2, 'cached');
  now = new Date('2026-10-04T02:02:00Z');
  await service.availability();
  assert.equal(reads, 4, 'read again after a minute');
});
