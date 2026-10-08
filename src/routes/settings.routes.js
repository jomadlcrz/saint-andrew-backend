/**
 * App Settings & Download Routes
 */

const express = require('express');
const router = express.Router();
const { db, admin, isFirebaseInitialized } = require('../config/firebase.config');
const { verifyFirebaseAuth, requireAdminRole, optionalFirebaseAuth } = require('../middleware/auth.middleware');

const DEFAULT_CONFIG = {
  enabled: true,
  downloadUrl: 'https://expo.dev/artifacts/eas/saint-andrew-funeral-home.apk',
  version: 'v1.0.2',
  fileSize: '48 MB',
  minAndroid: 'Android 8.0+',
  releaseDate: 'October 2026',
  description:
    'Download the official St. Andrew Funeral Home mobile application for Android. Access your arrangements, tracking, digital contracts, and memorials anytime.',
  playStoreUrl: '',
};

// GET /api/settings/app-download - Public / cached retrieval
router.get('/api/settings/app-download', optionalFirebaseAuth, async (req, res) => {
  if (!isFirebaseInitialized || !db) {
    return res.json({ success: true, data: DEFAULT_CONFIG });
  }

  try {
    const docSnap = await db.collection('settings').doc('app_download').get();
    if (!docSnap.exists) {
      return res.json({ success: true, data: DEFAULT_CONFIG });
    }
    const data = docSnap.data();
    return res.json({
      success: true,
      data: {
        ...DEFAULT_CONFIG,
        ...data,
      },
    });
  } catch (err) {
    console.error('❌ [Settings Routes] Failed to read app download settings:', err.message);
    return res.status(500).json({ error: 'Could not fetch app download settings.' });
  }
});

// POST /api/settings/app-download - Admin only write via Admin SDK
router.post('/api/settings/app-download', verifyFirebaseAuth, requireAdminRole, async (req, res) => {
  if (!isFirebaseInitialized || !db) {
    return res.status(503).json({ error: 'Firestore service is unavailable.' });
  }

  try {
    const body = req.body || {};
    const cleanConfig = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      downloadUrl: typeof body.downloadUrl === 'string' ? body.downloadUrl.trim() : DEFAULT_CONFIG.downloadUrl,
      version: typeof body.version === 'string' && body.version.trim() ? body.version.trim() : DEFAULT_CONFIG.version,
      fileSize: typeof body.fileSize === 'string' && body.fileSize.trim() ? body.fileSize.trim() : DEFAULT_CONFIG.fileSize,
      minAndroid: typeof body.minAndroid === 'string' && body.minAndroid.trim() ? body.minAndroid.trim() : DEFAULT_CONFIG.minAndroid,
      releaseDate: typeof body.releaseDate === 'string' && body.releaseDate.trim() ? body.releaseDate.trim() : DEFAULT_CONFIG.releaseDate,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : DEFAULT_CONFIG.description,
      playStoreUrl: typeof body.playStoreUrl === 'string' ? body.playStoreUrl.trim() : '',
      updatedAt: admin ? admin.firestore.FieldValue.serverTimestamp() : new Date(),
      updatedBy: req.user?.email || 'admin',
    };

    await db.collection('settings').doc('app_download').set(cleanConfig, { merge: true });

    console.log(`✅ [Settings Routes] Updated app_download settings by ${cleanConfig.updatedBy}: v${cleanConfig.version} (${cleanConfig.enabled ? 'Enabled' : 'Hidden'})`);

    return res.json({ success: true, data: cleanConfig });
  } catch (err) {
    console.error('❌ [Settings Routes] Failed to save app download settings:', err.message);
    return res.status(500).json({ error: 'Could not save app download settings.' });
  }
});

module.exports = router;
