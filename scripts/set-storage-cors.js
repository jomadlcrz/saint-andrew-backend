/**
 * Lets the admin website download photos from Firebase Storage in the browser (e.g. "Download
 * receipt"): read-only (GET) from any site. Photos still need their link's token to be opened.
 *
 *   node scripts/set-storage-cors.js
 */
const { admin, isFirebaseInitialized } = require('../src/config/firebase.config');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'saint-andrew-funeral-home.firebasestorage.app';

async function main() {
  if (!isFirebaseInitialized) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  const bucket = admin.storage().bucket(BUCKET);
  await bucket.setCorsConfiguration([{ origin: ['*'], method: ['GET', 'HEAD'], maxAgeSeconds: 3600 }]);
  const [meta] = await bucket.getMetadata();
  console.log(`CORS on ${BUCKET}:`, JSON.stringify(meta.cors));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
