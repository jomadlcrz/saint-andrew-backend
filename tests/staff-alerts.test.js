const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pendingAlerts, pickupAlert, deceasedNameOf } = require('../src/services/staff-alert.service');
const { getStaffAlertEmailTemplate } = require('../src/templates/email.templates');

const at = (iso) => ({ toMillis: () => Date.parse(iso) });

test('alerts staff once about a new request from the app or website', () => {
  const data = { status: 'pending', createdAt: at('2026-09-28T07:45:00Z'), clientName: 'Maria', deceasedInfo: { firstName: 'Juan', lastName: 'Dela Cruz' } };
  const [alert] = pendingAlerts(data);
  assert.equal(alert.kind, 'request');
  assert.equal(alert.title, 'New request: Juan Dela Cruz');
  // Already emailed: nothing more
  assert.deepEqual(pendingAlerts({ ...data, staffAlerts: { request: alert.at } }), []);
  // Walk-ins are entered by staff themselves
  assert.deepEqual(pendingAlerts({ ...data, isWalkIn: true }), []);
});

test('alerts about a receipt until staff record a payment, and again for a new receipt', () => {
  const data = { status: 'in_progress', deceasedName: 'Juan', proofOfPaymentUrl: 'data:image/png;base64,AA', proofPeriodIndex: 2, proofSubmittedAt: at('2026-09-28T08:00:00Z') };
  const [alert] = pendingAlerts(data);
  assert.equal(alert.kind, 'receipt');
  assert.match(alert.title, /Period 2/);
  assert.deepEqual(pendingAlerts({ ...data, staffAlerts: { receipt: alert.at } }), []);
  assert.deepEqual(pendingAlerts({ ...data, proofReviewedAt: at('2026-09-28T09:00:00Z') }), []);
  assert.equal(pendingAlerts({ ...data, staffAlerts: { receipt: alert.at }, proofSubmittedAt: at('2026-09-29T08:00:00Z') }).length, 1);
});

test('alerts about a pending burial change request, not a decided one', () => {
  const request = { status: 'pending', requestedAt: at('2026-09-28T10:00:00Z'), requestedByName: 'Maria' };
  const data = { status: 'in_progress', deceasedName: 'Juan', scheduleChangeRequest: request };
  const [alert] = pendingAlerts(data);
  assert.equal(alert.kind, 'schedule');
  assert.equal(alert.title, 'Burial details change: Juan');
  assert.deepEqual(pendingAlerts({ ...data, scheduleChangeRequest: { ...request, status: 'approved' } }), []);
});

test('names the deceased from the name parts when the full name is missing', () => {
  assert.equal(deceasedNameOf({ deceasedInfo: { firstName: 'Juan', middleName: 'S', lastName: 'Cruz' } }), 'Juan S Cruz');
  assert.equal(deceasedNameOf({}), 'Memorial arrangement');
});

test('email lists each item with its Philippine date and time, escaped', () => {
  const html = getStaffAlertEmailTemplate({
    items: [{ kind: 'schedule', title: 'Burial details change: <Juan>', detail: 'Maria', at: Date.parse('2026-09-28T07:45:00Z') }],
    adminUrl: 'https://admin.example.com',
  });
  assert.match(html, /Burial change request/);
  assert.match(html, /&lt;Juan&gt;/);
  assert.match(html, /Sep 28, 2026, 3:45 PM/);
  assert.match(html, /https:\/\/admin\.example\.com/);
});

test('emails staff once about a pickup still without a team after 10 minutes', () => {
  const data = { status: 'requested', createdAt: at('2026-10-16T01:00:00Z'), deceasedName: 'Juan Dela Cruz', pickupAddress: 'Region 1 Medical Center', contactPhone: '09171234567' };
  // The bell chimes at once; email only if no one has assigned a team for 10 minutes
  assert.equal(pickupAlert(data, Date.parse('2026-10-16T01:05:00Z')), null);
  const alert = pickupAlert(data, Date.parse('2026-10-16T01:12:00Z'));
  assert.equal(alert.kind, 'pickup');
  assert.equal(alert.title, 'Pickup needs a team: Juan Dela Cruz');
  assert.match(alert.detail, /Region 1 Medical Center · 09171234567 · waiting 12 min/);
  assert.equal(pickupAlert({ ...data, staffAlerts: { pickup: alert.at } }, Date.parse('2026-10-16T02:00:00Z')), null);
  assert.equal(pickupAlert({ ...data, status: 'assigned' }, Date.parse('2026-10-16T02:00:00Z')), null);
  assert.match(getStaffAlertEmailTemplate({ items: [{ ...alert, id: 'p1' }] }), /Pickup waiting for a team/);
});
