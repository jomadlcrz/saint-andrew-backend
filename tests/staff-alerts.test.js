const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pendingAlerts, deceasedNameOf } = require('../src/services/staff-alert.service');
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
