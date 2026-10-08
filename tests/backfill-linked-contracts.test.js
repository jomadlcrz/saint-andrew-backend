const test = require('node:test');
const assert = require('node:assert/strict');
const { planLinkedContractBackfill } = require('../scripts/backfill-linked-contracts');

test('planLinkedContractBackfill synchronizes payments, schedules, and embalming fees', () => {
  const plans = [
    {
      id: 'plan-1',
      data: {
        referenceNumber: 'REF-001',
        totalPrice: 50000,
        amountPaid: 20000,
        requestStatus: 'Accepted',
        lifecycleStatus: 'Claimed',
        paymentSchedule: [
          { period: 1, amountDue: 10000, amountPaid: 10000, status: 'Paid' },
          { period: 2, amountDue: 10000, amountPaid: 10000, status: 'Paid' },
          { period: 3, amountDue: 10000, amountPaid: 0, status: 'Upcoming' },
        ],
        embalmingAdditionalDays: 3,
        additionalEmbalmingFee: 4500,
      },
    },
  ];

  const contracts = [
    {
      id: 'contract-1',
      data: {
        referenceCode: 'REF-001',
        totalPrice: 50000,
        amountPaid: 0,
        balance: 50000,
        paymentStatus: 'unpaid',
        status: 'pending',
        lifecycleStatus: 'Active',
        paymentSchedule: [],
        embalmingAdditionalDays: 0,
      },
    },
  ];

  const updates = planLinkedContractBackfill({ plans, contracts });

  assert.equal(updates.length, 1);
  const u = updates[0];
  assert.equal(u.id, 'contract-1');
  assert.equal(u.planId, 'plan-1');
  assert.equal(u.fields.amountPaid, 20000);
  assert.equal(u.fields.balance, 30000);
  assert.equal(u.fields.paymentStatus, 'partial');
  assert.equal(u.fields.status, 'in_progress');
  assert.equal(u.fields.lifecycleStatus, 'Claimed');
  assert.equal(u.fields.embalmingAdditionalDays, 3);
  assert.equal(u.fields.additionalEmbalmingFee, 4500);
  assert.equal(u.fields.paymentSchedule.length, 3);
});

test('planLinkedContractBackfill skips identical records and walk-ins', () => {
  const plans = [
    {
      id: 'same-id',
      data: {
        referenceNumber: 'REF-SAME',
        totalPrice: 30000,
        amountPaid: 30000,
        paymentSchedule: [{ period: 1, amountDue: 30000, status: 'Paid' }],
      },
    },
    {
      id: 'plan-synced',
      data: {
        referenceNumber: 'REF-SYNCED',
        totalPrice: 30000,
        amountPaid: 30000,
        paymentSchedule: [{ period: 1, amountDue: 30000, status: 'Paid' }],
        embalmingAdditionalDays: 0,
      },
    },
  ];

  const contracts = [
    {
      id: 'same-id', // Walk-in or same doc
      data: {
        referenceCode: 'REF-SAME',
        totalPrice: 30000,
        amountPaid: 0,
      },
    },
    {
      id: 'contract-synced',
      data: {
        referenceCode: 'REF-SYNCED',
        totalPrice: 30000,
        amountPaid: 30000,
        balance: 0,
        paymentStatus: 'paid',
        paymentSchedule: [{ period: 1, amountDue: 30000, status: 'Paid' }],
        embalmingAdditionalDays: 0,
      },
    },
  ];

  const updates = planLinkedContractBackfill({ plans, contracts });
  assert.equal(updates.length, 0);
});
