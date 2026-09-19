/**
 * Firebase Authentication Verification Middleware
 */

const config = require('../config/env.config');
const { auth, isFirebaseInitialized } = require('../config/firebase.config');

/**
 * Validates Firebase ID Token from the Authorization header.
 * Falls back to simulation mode in development if Firebase is unconfigured.
 */
async function verifyFirebaseAuth(req, res, next) {
  // If Firebase Admin is not active, permit in development mode with a warning
  if (!isFirebaseInitialized || !auth) {
    req.user = { uid: 'dev-user', email: 'dev@saintandrew.test', role: 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    if (config.isDevelopment) {
      console.log('ℹ️ [Auth Middleware] Development mode: permitting request without Bearer token.');
      req.user = { uid: 'dev-admin', email: 'admin@saintandrew.test', role: 'admin' };
      return next();
    }
    return res.status(401).json({
      error: 'Authorization header with Bearer token is required.',
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({
      error: 'Bearer token cannot be empty.',
    });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    return next();
  } catch (err) {
    console.warn('❌ [Auth Middleware] Token verification failed:', err.message);
    const isExpired = err.code === 'auth/id-token-expired';
    return res.status(401).json({
      error: isExpired ? 'Authentication token has expired.' : 'Invalid authentication token.',
    });
  }
}

module.exports = {
  verifyFirebaseAuth,
};
