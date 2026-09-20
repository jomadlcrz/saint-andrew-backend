/**
 * Firebase Authentication Verification Middleware
 */

const config = require('../config/env.config');
const { auth, db, isFirebaseInitialized } = require('../config/firebase.config');

/**
 * Validates Firebase ID Token from the Authorization header.
 * Falls back to simulation mode only in development. In production, an
 * unconfigured Firebase Admin SDK fails the request closed (503) rather
 * than silently granting access.
 */
async function verifyFirebaseAuth(req, res, next) {
  if (!isFirebaseInitialized || !auth) {
    if (config.isDevelopment) {
      req.user = { uid: 'dev-user', email: 'dev@saintandrew.test', role: 'admin' };
      return next();
    }
    console.error('❌ [Auth Middleware] Firebase Admin is unavailable in production — rejecting request.');
    return res.status(503).json({
      error: 'Authentication service is temporarily unavailable.',
    });
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

/**
 * Requires the authenticated caller to be an active admin/staff account.
 * Must run after verifyFirebaseAuth. Looks up role/status from Firestore
 * `/users/{uid}` — the same authorization model documented in AGENTS.md
 * for admin-web — since role is not carried as a Firebase Auth custom claim.
 */
async function requireAdminRole(req, res, next) {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ error: 'Authentication is required.' });
  }

  // Development bypass already stamps req.user.role = 'admin' directly.
  if (req.user.role === 'admin' && !isFirebaseInitialized) {
    return next();
  }

  if (!isFirebaseInitialized || !db) {
    return res.status(503).json({ error: 'Authorization service is temporarily unavailable.' });
  }

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    const data = userDoc.exists ? userDoc.data() : null;

    if (!data || data.role !== 'admin' || data.status !== 'active') {
      console.warn(`⚠️ [Auth Middleware] Non-admin caller ${uid} was denied an admin-only endpoint.`);
      return res.status(403).json({ error: 'This action requires an active admin account.' });
    }

    return next();
  } catch (err) {
    console.error('❌ [Auth Middleware] Failed to verify admin role:', err.message);
    return res.status(500).json({ error: 'Unable to verify account permissions.' });
  }
}

module.exports = {
  verifyFirebaseAuth,
  requireAdminRole,
};
