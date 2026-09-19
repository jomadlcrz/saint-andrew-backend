/**
 * CORS Middleware Configuration
 * Supports local Vite dev ports, Expo mobile, Postman/curl, and production origins.
 */

const cors = require('cors');
const config = require('../config/env.config');

const corsOptions = {
  origin: function (origin, callback) {
    // 1. Allow non-browser agents (cURL, Postman, React Native mobile app)
    if (!origin) {
      return callback(null, true);
    }

    // 2. Allow all localhost & 127.0.0.1 variants on any port
    if (
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    // 3. Allow explicitly configured origins
    if (config.cors.customOrigins.includes(origin)) {
      return callback(null, true);
    }

    // In non-production, log and permit if from local network
    if (config.isDevelopment && /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01]))/.test(origin)) {
      return callback(null, true);
    }

    console.warn(`⚠️ [CORS] Rejected request from origin: ${origin}`);
    callback(new Error('Cross-Origin Request blocked by CORS policy.'));
  },

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

module.exports = {
  corsMiddleware: cors(corsOptions),
  corsPreflight: cors(corsOptions),
};
