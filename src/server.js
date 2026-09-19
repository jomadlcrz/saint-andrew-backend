/**
 * Server Bootstrap
 * Starts the HTTP server and attaches graceful termination handlers.
 */

const app = require('./app');
const config = require('./config/env.config');
const { isFirebaseInitialized } = require('./config/firebase.config');
const semaphoreService = require('./services/semaphore.service');
const brevoService = require('./services/brevo.service');

const server = app.listen(config.port, () => {
  const modeLabel = isFirebaseInitialized
    ? '🔥 Production (Firebase Active)'
    : '🧪 Development (Simulated Fallback)';

  const smsLabel = semaphoreService.isConfigured()
    ? '✅ Semaphore Live Gateway'
    : '⚠️ Simulated Mode (No Key)';

  const brevoLabel = brevoService.isConfigured()
    ? '✅ Brevo SMTP Live'
    : '⚠️ Unconfigured';

  console.log('\n============================================================');
  console.log(`🕊️  ST. ANDREW FUNERAL HOME - BACKEND MICROSERVICE`);
  console.log('============================================================');
  console.log(`🚀 Server listening on: http://localhost:${config.port}`);
  console.log(`📋 Operational Mode:   ${modeLabel}`);
  console.log(`📱 SMS Gateway:         ${smsLabel}`);
  console.log(`📧 Brevo Email:         ${brevoLabel}`);
  console.log(`🌐 CORS Origins:        localhost:* + 127.0.0.1:*`);
  console.log(`🩺 Health Endpoint:     http://localhost:${config.port}/`);
  console.log(`🔍 Brevo Test:          http://localhost:${config.port}/test-brevo`);
  console.log('============================================================\n');
});

// Handle graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('👋 HTTP server closed cleanly.');
    process.exit(0);
  });

  // Force close if hung
  setTimeout(() => {
    console.error('⚠️ Forcefully terminating after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;
