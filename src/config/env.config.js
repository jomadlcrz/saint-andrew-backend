/**
 * Application Environment Configuration
 * Centralized parsing and validation of environment variables.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ override: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
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
