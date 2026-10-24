const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFirebaseAuth } = require('../src/middleware/auth.middleware');

test('verifyFirebaseAuth rejects unauthenticated request when Bearer token is missing', async () => {
  let statusCode = 0;
  let responseData = null;

  const req = {
    headers: {},
  };
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(data) {
          responseData = data;
        },
      };
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await verifyFirebaseAuth(req, res, next);

  assert.equal(nextCalled, false, 'next() must not be called when unauthenticated');
  assert.equal(statusCode, 401, 'Must return HTTP 401');
  assert.equal(responseData?.error, 'Authorization header with Bearer token is required.');
});

test('verifyFirebaseAuth rejects request with empty Bearer token', async () => {
  let statusCode = 0;
  let responseData = null;

  const req = {
    headers: {
      authorization: 'Bearer ',
    },
  };
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(data) {
          responseData = data;
        },
      };
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await verifyFirebaseAuth(req, res, next);

  assert.equal(nextCalled, false, 'next() must not be called when token is empty');
  assert.equal(statusCode, 401, 'Must return HTTP 401');
  assert.equal(responseData?.error, 'Bearer token cannot be empty.');
});
