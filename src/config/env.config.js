/**
 * Application Environment Configuration
 * Centralized parsing and validation of environment variables.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables — .env.production when NODE_ENV=production
// (e.g. for a local production dry-run), otherwise .env. Render's own
// dashboard env vars are still the actual source of truth at deploy time,
// since this file isn't present on Render's filesystem (it's gitignored).
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile, override: true });
const PORT = parseInt(process.env.PORT || '3000', 10);

const SEMAPHORE_API_KEY = (process.env.SEMAPHORE_API_KEY || '').trim();
const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const BREVO_SENDER_EMAIL = (process.env.BREVO_SENDER_EMAIL || 'saintandrewfh@gmail.com').trim();
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';

// Custom Allowed Origins
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || '';
const customAllowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

const config = {
  env: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  isDevelopment: NODE_ENV === 'development',
  port: PORT,
  semaphore: {
    apiKey: SEMAPHORE_API_KEY,
    isConfigured: Boolean(SEMAPHORE_API_KEY),
  },
  brevo: {
    apiKey: BREVO_API_KEY,
    senderEmail: BREVO_SENDER_EMAIL,
    isConfigured: Boolean(BREVO_API_KEY),
  },
  firebase: {
    serviceAccountJson: FIREBASE_SERVICE_ACCOUNT_JSON,
  },
  cors: {
    customOrigins: customAllowedOrigins,
  },
};

module.exports = config;
