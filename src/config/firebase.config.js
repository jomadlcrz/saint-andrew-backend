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

  // 1. Check FIREBASE_SERVICE_ACCOUNT_JSON environment variable
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

  // 2. If not provided via env, attempt to locate local service-account JSON file
  if (!serviceAccountCredentials) {
    const candidatePaths = [
      path.resolve(__dirname, '../../service-account.json'),
      path.resolve(__dirname, '../../funeral-system-7ca06-firebase-adminsdk-fbsvc-a3c3a71d82.json'),
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
  }

  if (serviceAccountCredentials) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountCredentials),
    });

    adminInstance = admin;
    dbInstance = admin.firestore();
    authInstance = admin.auth();
    isInitialized = true;

    console.log('✅ [Firebase] Admin SDK initialized successfully (Firestore & Auth active)');
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
