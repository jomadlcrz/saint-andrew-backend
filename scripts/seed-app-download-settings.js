/**
 * Seeds or verifies the settings/app_download document in Firestore.
 */
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

async function seedAppDownloadSettings() {
  if (!isFirebaseInitialized) {
    console.error('Firebase Admin is not initialized.');
    process.exit(1);
  }

  const docRef = db.collection('settings').doc('app_download');
  const snap = await docRef.get();

  if (snap.exists) {
    console.log('settings/app_download already exists:');
    console.log(snap.data());
    return;
  }

  const initialConfig = {
    enabled: true,
    downloadUrl: 'https://expo.dev/artifacts/eas/saint-andrew-funeral-home.apk',
    version: 'v1.0.2',
    fileSize: '48 MB',
    minAndroid: 'Android 8.0+',
    releaseDate: 'October 2026',
    description:
      'Download the official St. Andrew Funeral Home mobile application for Android. Access your arrangements, tracking, digital contracts, and memorials anytime.',
    playStoreUrl: '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'system',
  };

  await docRef.set(initialConfig);
  console.log('Successfully seeded settings/app_download in Firestore:');
  console.log(initialConfig);
}

seedAppDownloadSettings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed settings/app_download:', err);
    process.exit(1);
  });
