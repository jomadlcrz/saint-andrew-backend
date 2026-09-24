/**
 * Notification & push unit tests (no network, no Firebase).
 * Run: npm run test:notifications
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANDROID_CHANNEL_ID,
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
    type: 'booking_status',
    notificationId: 'n1',
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    to: TOKEN_A,
    title: 'Arrangement approved',
    body: 'Your arrangement was approved.',
    sound: 'default',
    channelId: ANDROID_CHANNEL_ID,
    priority: 'high',
    data: { route: '/(app)/arrangements', type: 'booking_status', notificationId: 'n1' },
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
  const result = await notify({ userId: 'u1', type: 'booking_status', title: 't', body: 'b' });
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
  const failed = await failing({ userId: 'u1', type: 'booking_status', title: 't', body: 'b' });
  console.warn = warn;
  assert.deepEqual(failed, { saved: true, pushed: 0, reason: 'push-failed' });
});
