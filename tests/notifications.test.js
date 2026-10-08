/**
 * Notification & push unit tests (no network, no Firebase).
 * Run: npm run test:notifications
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANDROID_CHANNEL_ID,
  NOTIFICATION_SOUND,
  buildExpoMessages,
  isExpoPushToken,
  parseExpoTickets,
  sendExpoPush,
} = require('../src/services/push.service');
const { createNotifier } = require('../src/services/notification.service');

const TOKEN_A = 'ExponentPushToken[aaa]';
const TOKEN_B = 'ExpoPushToken[bbb]';

test('omits the badge when the unread total is unknown', () => {
  const [message] = buildExpoMessages([TOKEN_A], { title: 't', body: 'b' });
  assert.equal('badge' in message, false);
  const [withBadge] = buildExpoMessages([TOKEN_A], { title: 't', body: 'b', badge: 3 });
  assert.equal(withBadge.badge, 3);
});

test('recognizes Expo push tokens only', () => {
  assert.equal(isExpoPushToken(TOKEN_A), true);
  assert.equal(isExpoPushToken(TOKEN_B), true);
  assert.equal(isExpoPushToken('fcm-raw-token'), false);
  assert.equal(isExpoPushToken(undefined), false);
});

test('builds one message per valid token with route data and the app channel', () => {
  const messages = buildExpoMessages([TOKEN_A, 'junk', TOKEN_B], {
    title: 'Arrangement approved',
    body: 'Your arrangement was approved.',
    route: '/(app)/arrangements',
    type: 'request_status',
    notificationId: 'n1',
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    to: TOKEN_A,
    title: 'Arrangement approved',
    body: 'Your arrangement was approved.',
    sound: NOTIFICATION_SOUND,
    channelId: ANDROID_CHANNEL_ID,
    priority: 'high',
    data: { route: '/(app)/arrangements', type: 'request_status', notificationId: 'n1' },
  });
});

test('counts delivered tickets and collects unregistered devices', () => {
  const messages = [{ to: TOKEN_A }, { to: TOKEN_B }, { to: 'ExpoPushToken[ccc]' }];
  const result = parseExpoTickets(messages, [
    { status: 'ok', id: '1' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'MessageRateExceeded' } },
  ]);
  assert.deepEqual(result, { sent: 1, invalidTokens: [TOKEN_B] });
});

test('sendExpoPush posts to Expo and throws on HTTP errors', async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
  };
  const result = await sendExpoPush([{ to: TOKEN_A }], okFetch);
  assert.equal(result.sent, 1);
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');

  const badFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => sendExpoPush([{ to: TOKEN_A }], badFetch), /Status 500/);
});

/** Minimal in-memory stand-in for the Firestore calls notification.service makes. */
function fakeFirestore(users) {
  const saved = [];
  const updates = [];
  return {
    saved,
    updates,
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: Boolean(users[id]), data: () => users[id] }),
        update: async (patch) => updates.push({ id, patch }),
        collection: () => ({
          add: async (doc) => {
            saved.push({ userId: id, ...doc });
            return { id: `notif-${saved.length}` };
          },
          where: (field, op, value) => ({
            count: () => ({
              get: async () => ({
                data: () => ({ count: saved.filter((n) => n.userId === id && n[field] === value).length }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

const FieldValue = {
  serverTimestamp: () => 'SERVER_TS',
  arrayRemove: (...values) => ({ arrayRemove: values }),
};

test('saves the notification and pushes to every device', async () => {
  const db = fakeFirestore({ u1: { pushTokens: [TOKEN_A, TOKEN_B] } });
  let pushed;
  const notify = createNotifier({
    db,
    FieldValue,
    sendPush: async (messages) => {
      pushed = messages;
      return { sent: messages.length, invalidTokens: [] };
    },
  });

  const result = await notify({
    userId: 'u1',
    type: 'payment',
    title: 'Payment received',
    body: '₱5,000',
    route: '/(app)/arrangements',
    refId: 'txn-42',
  });
  assert.deepEqual(result, { saved: true, pushed: 2 });
  assert.equal(db.saved.length, 1);
  assert.equal(db.saved[0].read, false);
  assert.equal(db.saved[0].refId, 'txn-42');
  assert.equal(db.saved[0].createdAt, 'SERVER_TS');
  assert.equal(pushed[0].data.notificationId, 'notif-1');
  // App icon badge = unread total, including the one just saved
  assert.equal(pushed[0].badge, 1);
});

test('skips users without an account (walk-ins)', async () => {
  const db = fakeFirestore({});
  const notify = createNotifier({ db, FieldValue, sendPush: async () => assert.fail('should not push') });
  const result = await notify({ userId: 'walk-in', type: 'payment', title: 't', body: 'b' });
  assert.deepEqual(result, { saved: false, pushed: 0, reason: 'user-not-found' });
  assert.equal(db.saved.length, 0);
});

test('respects pushEnabled=false but still saves to the in-app list', async () => {
  const db = fakeFirestore({ u1: { pushEnabled: false, pushTokens: [TOKEN_A] } });
  const notify = createNotifier({ db, FieldValue, sendPush: async () => assert.fail('should not push') });
  const result = await notify({ userId: 'u1', type: 'chat_reply', title: 't', body: 'b' });
  assert.deepEqual(result, { saved: true, pushed: 0, reason: 'push-disabled' });
  assert.equal(db.saved.length, 1);
});

test('removes unregistered devices and survives push failures', async () => {
  const db = fakeFirestore({ u1: { pushTokens: [TOKEN_A, TOKEN_B] } });
  const notify = createNotifier({
    db,
    FieldValue,
    sendPush: async () => ({ sent: 1, invalidTokens: [TOKEN_B] }),
  });
  const result = await notify({ userId: 'u1', type: 'request_status', title: 't', body: 'b' });
  assert.equal(result.pushed, 1);
  assert.deepEqual(db.updates[0].patch, { pushTokens: { arrayRemove: [TOKEN_B] } });

  const failing = createNotifier({
    db,
    FieldValue,
    sendPush: async () => {
      throw new Error('network down');
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  const failed = await failing({ userId: 'u1', type: 'request_status', title: 't', body: 'b' });
  console.warn = warn;
  assert.deepEqual(failed, { saved: true, pushed: 0, reason: 'push-failed' });
});

const { formatPaymentReminder } = require('../src/templates/sms.templates');
const {
  applyReminderResult,
  pendingReminderChannels,
  needsDueDayNotice,
  amountOwed,
  periodsByDueDate,
  paymentBreakdownRoute,
  qualifiesForUpcomingReminder,
} = require('../src/services/preplan-reminder.service');
const { notifyUserHandler } = require('../src/controllers/notification.controller');

test('payment reminder push text follows the plan kind, like the SMS', () => {
  const base = { periodIndex: 2, amountDue: 1500, remainingBalance: 9000, dueDateLabel: 'October 1, 2026' };

  const preNeed = formatPaymentReminder({ ...base, paymentPlanKind: 'longTermInstallment' });
  assert.equal(preNeed.title, 'Pre-Need payment reminder');
  assert.equal(preNeed.body, 'Installment #2 of ₱1500.00 is due on October 1, 2026.');

  const shortTerm = formatPaymentReminder({ ...base, paymentPlanKind: 'shortTerm' });
  assert.equal(shortTerm.title, 'Payment reminder');
  assert.doesNotMatch(shortTerm.title + shortTerm.body, /Pre-Need/);
  assert.match(shortTerm.body, /Remaining balance: ₱9000\.00/);

  const full = formatPaymentReminder({ ...base, periodIndex: undefined, paymentPlanKind: 'full' });
  assert.equal(full.title, 'Balance reminder');
  assert.equal(full.body, 'Your remaining balance is ₱9000.00. Full payment is required before interment.');

  for (const reminder of [preNeed, shortTerm, full]) {
    assert.doesNotMatch(reminder.sms + reminder.title + reminder.body, /undefined|NaN/);
  }
});

test('a failed SMS is retried without re-sending the in-app notification', () => {
  const channels = { canSms: true, userId: 'u1' };
  let period = { periodIndex: 1, status: 'Pending' };

  // Day 1: SMS fails, notification saved
  assert.deepEqual(pendingReminderChannels(period, channels), { needsSms: true, needsNotification: true });
  period = applyReminderResult(period, { ...channels, smsSent: false, notificationDone: true, now: 'D1' });
  assert.equal(period.notificationReminderSentAt, 'D1');
  assert.equal(period.reminderSentAt, undefined);

  // Day 2: only the SMS is still pending; once it goes out the period is done
  assert.deepEqual(pendingReminderChannels(period, channels), { needsSms: true, needsNotification: false });
  period = applyReminderResult(period, { ...channels, smsSent: true, notificationDone: false, now: 'D2' });
  assert.equal(period.smsReminderSentAt, 'D2');
  assert.equal(period.reminderSentAt, 'D2');
});

test('an SMS-only plan is done as soon as the SMS goes out', () => {
  const period = applyReminderResult({}, { canSms: true, userId: '', smsSent: true, notificationDone: false, now: 'D1' });
  assert.equal(period.reminderSentAt, 'D1');
});

test('the due-day notice goes out once, on the Manila due date, for unpaid periods', () => {
  // 9 AM Manila on Oct 1 is 1 AM UTC: the due date is compared in Manila time, not the server's
  const now = new Date('2026-10-01T01:00:00Z');
  const dueDate = new Date('2026-09-30T16:00:00Z'); // Oct 1, 12 AM Manila

  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000, dueDate }, now), true);
  assert.equal(needsDueDayNotice({ status: 'Paid', amountDue: 5000, dueDate }, now), false);
  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000, dueDate, dueDayNotifiedAt: now }, now), false);
  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000, dueDate: new Date('2026-10-02T02:00:00Z') }, now), false);
  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000, dueDate: { toDate: () => dueDate } }, now), true);
  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000 }, now), false);
  // The heads-up reminder already went out today (schedule set up on its due date): no second push
  assert.equal(needsDueDayNotice({ status: 'Pending', amountDue: 5000, dueDate, notificationReminderSentAt: now }, now), false);
});

test("payment reminders open the plan's payment breakdown in the app", () => {
  assert.equal(paymentBreakdownRoute('plan123'), '/payments/plan123');
});

async function callNotifyUser(body) {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await notifyUserHandler({ body }, res, (err) => assert.fail(err));
  return res;
}

test('/notify-user rejects external routes', async () => {
  const valid = { userId: 'u1', type: 'payment', title: 't', body: 'b' };
  for (const route of ['//evil.example', '/\\evil.example', 'https://evil.example', '/ path', '/a\nb']) {
    const res = await callNotifyUser({ ...valid, route });
    assert.equal(res.statusCode, 400, `route ${JSON.stringify(route)} should be rejected`);
    assert.equal(res.body.success, false);
  }
});

test('/notify-user rejects ids Firestore cannot use', async () => {
  const valid = { userId: 'u1', type: 'payment', title: 't', body: 'b' };
  for (const userId of ['', '.', '..', '__id__', 'a/b']) {
    const res = await callNotifyUser({ ...valid, userId });
    assert.equal(res.statusCode, 400, `userId ${JSON.stringify(userId)} should be rejected`);
    assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
    assert.equal(res.body.success, false);
  }
  const badRef = await callNotifyUser({ ...valid, refId: '..' });
  assert.equal(badRef.statusCode, 400);
});

test('/notify-user accepts in-app routes', async () => {
  const valid = { userId: 'u1', type: 'payment', title: 't', body: 'b' };
  for (const route of ['/(app)/arrangements', '/(app)/chat/abc-123?tab=history']) {
    const res = await callNotifyUser({ ...valid, route });
    assert.equal(res.statusCode, 200, `route ${JSON.stringify(route)} should be accepted`);
  }
});

test('reminders skip empty ₱0 rows and follow due dates', () => {
  assert.equal(amountOwed({ amountDue: 0, amountPaid: 0, status: 'Upcoming' }), 0);
  assert.equal(amountOwed({ amountDue: 1000, amountPaid: 400, status: 'Upcoming' }), 600);
  assert.equal(amountOwed({ amountDue: 1000, amountPaid: 0, status: 'Paid' }), 0);
  const now = new Date('2026-09-27T02:00:00Z'); // Sep 27, 10 AM in Manila
  assert.equal(needsDueDayNotice({ amountDue: 0, amountPaid: 0, dueDate: new Date('2026-09-27T01:00:00Z') }, now), false);

  const schedule = [
    { periodIndex: 1, dueDate: new Date('2026-09-29T00:00:00Z'), amountDue: 29500 },
    { periodIndex: 2, dueDate: new Date('2026-10-03T00:00:00Z'), amountDue: 22125 },
    { periodIndex: 3, dueDate: new Date('2026-09-28T00:00:00Z'), amountDue: 1000 },
  ];
  assert.deepEqual(periodsByDueDate(schedule), [2, 0, 1]);
});

test('due date already passed (e.g. Oct 7 when today is Oct 8) should not send reminder', () => {
  // Now is Oct 8, 2026 09:00 AM Manila (01:00 UTC)
  const now = new Date('2026-10-08T01:00:00Z');
  const windowEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // Oct 11

  // Period due Oct 7 (yesterday in Manila)
  const passedPeriod = {
    periodIndex: 1,
    status: 'Upcoming',
    amountDue: 2000,
    amountPaid: 0,
    dueDate: new Date('2026-10-07T00:00:00Z'),
  };
  // Passed period must NOT qualify for an upcoming reminder sweep
  assert.equal(qualifiesForUpcomingReminder(passedPeriod, now, windowEnd), false);
  // Passed period also must NOT get due-day notice
  assert.equal(needsDueDayNotice(passedPeriod, now), false);

  // Period due Oct 8 (today)
  const todayPeriod = {
    periodIndex: 2,
    status: 'Upcoming',
    amountDue: 2000,
    amountPaid: 0,
    dueDate: new Date('2026-10-08T00:00:00Z'),
  };
  assert.equal(qualifiesForUpcomingReminder(todayPeriod, now, windowEnd), true);
  assert.equal(needsDueDayNotice(todayPeriod, now), true);

  // Period due Oct 10 (upcoming in 2 days, within 3-day window)
  const upcomingPeriod = {
    periodIndex: 3,
    status: 'Upcoming',
    amountDue: 2000,
    amountPaid: 0,
    dueDate: new Date('2026-10-10T00:00:00Z'),
  };
  assert.equal(qualifiesForUpcomingReminder(upcomingPeriod, now, windowEnd), true);
  assert.equal(needsDueDayNotice(upcomingPeriod, now), false);

  // Period due Oct 15 (future, outside 3-day window)
  const futurePeriod = {
    periodIndex: 4,
    status: 'Upcoming',
    amountDue: 2000,
    amountPaid: 0,
    dueDate: new Date('2026-10-15T00:00:00Z'),
  };
  assert.equal(qualifiesForUpcomingReminder(futurePeriod, now, windowEnd), false);
});

// ---- Email with the notice (e.g. the family's contract), to the account's own address ----
const { isDeliverableEmail, webLink } = require('../src/services/notification.service');
const { readAttachment } = require('../src/controllers/notification.controller');

const PDF = Buffer.from('%PDF-1.4\n% sample contract\n').toString('base64');

function emailNotifier(users, sendEmail) {
  return createNotifier({
    db: fakeFirestore(users),
    FieldValue,
    sendPush: async (messages) => ({ sent: messages.length, invalidTokens: [] }),
    sendEmail,
    webUrl: 'https://saint-andrew.vercel.app',
  });
}

test('emails the account address with the PDF and a link to it on the website', async () => {
  const sent = [];
  const notify = emailNotifier({ u1: { email: 'maria@example.com', fullName: 'Maria Santos' } }, async (mail) => sent.push(mail));
  const result = await notify({
    userId: 'u1',
    type: 'request_status',
    title: 'Your Funeral Contract is ready',
    body: 'View it in the app. <b>Bring</b> nothing.',
    route: '/contract/case1',
    email: true,
    attachment: { name: 'Funeral-Contract.pdf', content: PDF },
  });
  assert.equal(result.emailed, true);
  assert.equal(result.saved, true);
  assert.equal('user' in result, false, 'the account is never returned');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'maria@example.com');
  assert.equal(sent[0].subject, 'Your Funeral Contract is ready');
  assert.deepEqual(sent[0].attachments, [{ name: 'Funeral-Contract.pdf', content: PDF }]);
  assert.match(sent[0].html, /href="https:\/\/saint-andrew\.vercel\.app\/contract\/case1"/);
  assert.match(sent[0].html, /&lt;b&gt;Bring&lt;\/b&gt;/);
});

test('never emails a mobile-number account, an unverified or suspended one, or without being asked', async () => {
  const sent = [];
  const users = {
    phone: { email: 'p.3f9a@phone.standrew.invalid' },
    none: {},
    inactive: { email: 'a@example.com', status: 'inactive' },
    suspended: { email: 'b@example.com', status: 'suspended' },
    asked: { email: 'c@example.com' },
  };
  const notify = emailNotifier(users, async (mail) => sent.push(mail));
  const base = { type: 'request_status', title: 't', body: 'b', email: true };
  assert.deepEqual(pick(await notify({ ...base, userId: 'phone' })), { emailed: false, emailReason: 'no-email' });
  assert.deepEqual(pick(await notify({ ...base, userId: 'none' })), { emailed: false, emailReason: 'no-email' });
  assert.deepEqual(pick(await notify({ ...base, userId: 'inactive' })), { emailed: false, emailReason: 'user-inactive' });
  assert.deepEqual(pick(await notify({ ...base, userId: 'suspended' })), { emailed: false, emailReason: 'user-suspended' });
  assert.deepEqual(pick(await notify({ ...base, userId: 'walk-in' })), { emailed: false, emailReason: 'user-not-found' });
  // Not asked: no email, and the result looks exactly as before
  const plain = await notify({ ...base, userId: 'asked', email: false });
  assert.equal('emailed' in plain, false);
  assert.equal(sent.length, 0);
});

test('a failed email never loses the notice', async () => {
  const warn = console.warn;
  console.warn = () => {};
  const notify = emailNotifier({ u1: { email: 'maria@example.com' } }, async () => {
    throw new Error('Brevo down');
  });
  const result = await notify({ userId: 'u1', type: 'request_status', title: 't', body: 'b', email: true });
  console.warn = warn;
  assert.equal(result.saved, true);
  assert.deepEqual(pick(result), { emailed: false, emailReason: 'email-failed' });
});

test('recognizes addresses that can receive mail, and builds website links', () => {
  assert.equal(isDeliverableEmail('maria@example.com'), true);
  assert.equal(isDeliverableEmail('p.1@phone.standrew.invalid'), false);
  assert.equal(isDeliverableEmail(''), false);
  assert.equal(isDeliverableEmail(undefined), false);
  assert.equal(webLink('https://x.app', '/(app)/arrangements'), 'https://x.app/arrangements');
  assert.equal(webLink('https://x.app', '/contract/abc'), 'https://x.app/contract/abc');
  assert.equal(webLink('', '/contract/abc'), '');
});

test('accepts only a real PDF within 2 MB as the attachment', () => {
  assert.deepEqual(readAttachment(undefined), { attachment: null });
  assert.deepEqual(readAttachment({ name: 'Funeral-Contract.pdf', content: PDF }).attachment, { name: 'Funeral-Contract.pdf', content: PDF });
  assert.match(readAttachment({ name: 'x.exe', content: PDF }).error, /\.pdf/);
  assert.match(readAttachment({ name: '../x.pdf', content: PDF }).error, /\.pdf/);
  assert.match(readAttachment({ name: 'x.pdf', content: 'not base64!' }).error, /base64/);
  assert.match(readAttachment({ name: 'x.pdf', content: Buffer.from('<html>').toString('base64') }).error, /PDF/);
  const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64');
  assert.match(readAttachment({ name: 'x.pdf', content: big }).error, /too large/);
});

/** Just the email part of a result. */
function pick({ emailed, emailReason }) {
  return emailReason === undefined ? { emailed } : { emailed, emailReason };
}
