/**
 * Firebase Admin SDK Initialization
 * Handles credentials from environment variables or local service-account files.
 */

const fs = require('fs');
const path = require('path');
const config = require('./env.config');

let adminInstance = null;
let dbInstance = null;
let authInstance = null;
let isInitialized = false;

try {
  const admin = require('firebase-admin');
  let serviceAccountCredentials = null;

  // 1. Check local service-account JSON file first (ensures local development
  // always uses the repository's active service account, preventing stale shell environment variables from hijacking the project)
  const candidatePaths = [
    path.resolve(__dirname, '../../service-account.json'),
  ];

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        serviceAccountCredentials = JSON.parse(raw);
        console.log(`🔑 [Firebase] Loaded credentials from local file: ${path.basename(filePath)}`);
        break;
      } catch (fileErr) {
        console.warn(`⚠️ [Firebase] Error reading credentials from ${filePath}:`, fileErr.message);
      }
    }
  }

  // 2. If not found locally, check FIREBASE_SERVICE_ACCOUNT_JSON (e.g. production deployments on Render / Cloud Run)
  if (!serviceAccountCredentials) {
    if (
      config.firebase.serviceAccountJson &&
      config.firebase.serviceAccountJson !== 'undefined' &&
      config.firebase.serviceAccountJson !== 'null'
    ) {
      try {
        serviceAccountCredentials = JSON.parse(config.firebase.serviceAccountJson);
      } catch (parseErr) {
        console.warn('⚠️ [Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', parseErr.message);
      }
    }
  }

  if (serviceAccountCredentials) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountCredentials),
    });

    adminInstance = admin;
    dbInstance = admin.firestore();
    authInstance = admin.auth();
    isInitialized = true;

    // Shown so a credential for the wrong Firebase project is obvious at startup: login tokens
    // from the apps are only accepted when this matches their project (saint-andrew-funeral-home).
    console.log(
      `✅ [Firebase] Admin SDK initialized successfully (Firestore & Auth active) — project: ${serviceAccountCredentials.project_id || 'unknown'}`
    );
  } else if (process.env.FUNCTION_TARGET || process.env.K_SERVICE || process.env.FUNCTIONS_EMULATOR) {
    // Running inside Firebase Cloud Functions / Cloud Run in the same
    // project — Application Default Credentials are available for free,
    // no explicit service account key needed.
    admin.initializeApp();
    adminInstance = admin;
    dbInstance = admin.firestore();
    authInstance = admin.auth();
    isInitialized = true;

    console.log('✅ [Firebase] Admin SDK initialized via Application Default Credentials (Cloud Functions)');
  } else {
    console.log('⚠️ [Firebase] No credentials found. Running in Development Mode without Firebase.');
  }
} catch (err) {
  console.warn('⚠️ [Firebase] Initialization failed:', err.message);
}

module.exports = {
  admin: adminInstance,
  db: dbInstance,
  auth: authInstance,
  isFirebaseInitialized: isInitialized,
};
