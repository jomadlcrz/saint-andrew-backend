/**
 * Firebase Cloud Functions Entry Point
 * Wraps the same Express app used by src/server.js (Render) as an HTTPS
 * Cloud Function, so both deploy targets share identical route/business
 * logic with zero duplication. Deployed with `firebase deploy --only functions`.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const app = require('./app');

// Secret Manager-backed secrets — set once via:
//   firebase functions:secrets:set SEMAPHORE_API_KEY
//   firebase functions:secrets:set BREVO_API_KEY
// Bound below, they populate process.env at runtime exactly like a local
// .env file would, so env.config.js needs no changes to read them.
const SEMAPHORE_API_KEY = defineSecret('SEMAPHORE_API_KEY');
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');

exports.api = onRequest(
  { secrets: [SEMAPHORE_API_KEY, BREVO_API_KEY], region: 'us-central1' },
  app
);
