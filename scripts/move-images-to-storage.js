/**
 * Moves the photos kept inside Firestore records (data URLs: ID photos, signatures, receipts,
 * attachments, package and promo pictures, profile photos) to Firebase Storage, and puts their
 * download links in their place. The apps show either form, so nothing changes for staff or families;
 * the records just get small.
 *
 *   node scripts/move-images-to-storage.js                       look only: what would move (default)
 *   node scripts/move-images-to-storage.js --apply --backup=FILE  move them (FILE: a backup from today,
 *                                                                 made with scripts/backup-firestore.js)
 *
 * Each photo is stored once as migrated/{sha256}.{ext}, so the same photo on several records (a
 * request and its case) becomes one file. Running it again only moves what is still inside records.
 * Note: the daily Firestore backup doesn't include Storage files.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'saint-andrew-funeral-home.firebasestorage.app';
const INLINE_IMAGE = /^data:image\/([a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);

const isPlainObject = (v) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** Every data URL image inside a value, with where it is (for the report). */
function findImages(value, where, found) {
  if (typeof value === 'string') {
    if (INLINE_IMAGE.test(value.trim())) found.push({ where, image: value });
  } else if (Array.isArray(value)) {
    value.forEach((v) => findImages(v, `${where}[]`, found));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) findImages(v, where ? `${where}.${k}` : k, found);
  }
  return found;
}

function replaceImages(value, links) {
  if (typeof value === 'string') return links.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceImages(v, links));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceImages(v, links)]));
  return value;
}

/** Uploads one photo (once per content) and returns its download link. */
async function uploadOnce(bucket, image, cache) {
  if (cache.has(image)) return cache.get(image);
  const [, type, base64] = INLINE_IMAGE.exec(image.trim());
  const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const ext = type.toLowerCase() === 'jpeg' ? 'jpg' : type.toLowerCase().replace(/[^a-z0-9]/g, '');
  const filePath = `migrated/${hash}.${ext}`;
  const file = bucket.file(filePath);
  let token;
  const [exists] = await file.exists();
  if (exists) {
    const [meta] = await file.getMetadata();
    token = String(meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
  }
  if (!token) {
    token = crypto.randomUUID();
    await file.save(bytes, {
      resumable: false,
      contentType: `image/${type.toLowerCase()}`,
      metadata: { cacheControl: 'private, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
    });
  }
  const link = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  cache.set(image, link);
  return link;
}

async function* allDocs(ref) {
  const snap = await ref.get();
  for (const doc of snap.docs) {
    yield doc;
    for (const sub of await doc.ref.listCollections()) yield* allDocs(sub);
  }
}

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }
  const bucket = admin.storage().bucket(BUCKET);
  // (The local Storage emulator makes a bucket on its first upload.)
  const onEmulator = Boolean(process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST);
  if (!onEmulator && !(await bucket.exists())[0]) throw new Error(`Storage bucket ${BUCKET} not found.`);

  const report = {};
  const cache = new Map();
  let docsChanged = 0;
  let bytesMoved = 0;
  for (const collection of await db.listCollections()) {
    for await (const doc of allDocs(collection)) {
      const data = doc.data();
      const found = findImages(data, '', []);
      if (!found.length) continue;
      const group = doc.ref.parent.path.replace(/\/[^/]+\//g, '/*/');
      for (const { where, image } of found) {
        const key = `${group} :: ${where}`;
        report[key] = report[key] || { photos: 0, mb: 0 };
        report[key].photos += 1;
        report[key].mb += image.length / 1024 / 1024;
        bytesMoved += image.length;
      }
      if (!APPLY) continue;

      const links = new Map();
      for (const { image } of found) links.set(image, await uploadOnce(bucket, image, cache));
      // Only the top-level fields that hold a photo are rewritten
      const updates = [];
      for (const key of new Set(found.map((f) => f.where.split(/[.[]/)[0]))) {
        updates.push(new admin.firestore.FieldPath(key), replaceImages(data[key], links));
      }
      await doc.ref.update(...updates);
      docsChanged += 1;
    }
  }

  for (const [key, r] of Object.entries(report).sort((a, b) => b[1].mb - a[1].mb)) {
    console.log(`${key.padEnd(72)} ${String(r.photos).padStart(4)} photo(s)  ${r.mb.toFixed(2)} MB`);
  }
  const total = (bytesMoved / 1024 / 1024).toFixed(2);
  if (!APPLY) {
    console.log(`\nLook only: ${total} MB of photos inside records. Nothing changed. Run with --apply --backup=FILE to move them.`);
    return;
  }
  console.log(`\nMoved ${cache.size} photo file(s) (${total} MB) out of ${docsChanged} record(s).`);

  // Check: nothing left inside records
  let left = 0;
  for (const collection of await db.listCollections()) {
    for await (const doc of allDocs(collection)) left += findImages(doc.data(), '', []).length;
  }
  console.log(left ? `${left} photo(s) still inside records.` : 'Verified: no photos left inside records.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
