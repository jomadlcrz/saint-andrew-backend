/**
 * Moves the photos that scripts/move-images-to-storage.js put in `migrated/{sha256}` into the same
 * folders the apps use for new uploads, by the record that uses each photo:
 *   a family's request or case (ID, signature, the deceased)  requests/{uid}/{recordId}/{label}.ext
 *   a walk-in (ID, signature, receipt)                        staff/walk-ins/{reference}/{label}.ext
 *   the family's GCash receipt on a request                    proofs/{transactionId}_{time}.jpg
 *   a receipt staff recorded on a case                         staff/receipts/{caseId}/{receiptId}.ext
 *   package / promo / testimonial photos                       staff/{inventory|promotions|testimonials}/{id}/photo.ext
 *   anything else                                              staff/other/{collection}/{id}/{label}.ext
 * A photo used by several records (a request, its case, the walk-in's saved copy) goes to the
 * folder of the first one and every record gets that one link. Then `migrated/` files no record
 * uses any more are removed (the backup made before move-images-to-storage.js still has them).
 *
 *   node scripts/organize-migrated-images.js                       look only (default)
 *   node scripts/organize-migrated-images.js --apply --backup=FILE  do it (FILE: today's backup)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'saint-andrew-funeral-home.firebasestorage.app';
const MIGRATED_LINK = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[\w.-]+\/o\/(migrated%2F[\w.-]+)\?alt=media(&token=[\w-]+)?$/;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);

const isPlainObject = (v) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'x';

/** Every `migrated/` link inside a value, with the field it's in. */
function findLinks(value, where, found) {
  if (typeof value === 'string') {
    const m = MIGRATED_LINK.exec(value.trim());
    if (m) found.push({ where, link: value, file: decodeURIComponent(m[1]) });
  } else if (Array.isArray(value)) {
    value.forEach((v) => findLinks(v, `${where}[]`, found));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) findLinks(v, where ? `${where}.${k}` : k, found);
  }
  return found;
}

function replaceLinks(value, links) {
  if (typeof value === 'string') return links.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceLinks(v, links));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceLinks(v, links)]));
  return value;
}

/** A short name for the photo from the field it's in. */
function labelOf(where) {
  if (/frontImageUrl$/.test(where)) return 'id-front';
  if (/backImageUrl$/.test(where)) return 'id-back';
  if (/contractSignature/.test(where)) return 'signature';
  if (/proofOfPaymentUrl$/.test(where)) return 'receipt';
  if (/paymentReceiptImage$/.test(where)) return 'receipt';
  return safe(where.split('.').pop());
}

/** Where a photo used by this record (and field) belongs. `parents` has the request for attachments. */
function targetFor(docPath, data, where, file, parents) {
  const ext = path.extname(file) || '.jpg';
  const parts = docPath.split('/');
  const [collection, id] = parts;
  const label = labelOf(where);
  const hash = path.basename(file, ext).slice(0, 8);

  // Walk-ins (and their saved copy in idempotency_keys) go to the walk-in's folder
  const walkInRef = data.isWalkIn === true ? data.referenceCode || data.trackingId : data.type === 'walkInArrangement' ? data.referenceCode : '';
  if (collection === 'transactions' && parts.length === 4 && parts[2] === 'attachments') {
    const parent = parents.get(`transactions/${id}`) || {};
    if (parent.isWalkIn === true) return `staff/walk-ins/${safe(parent.referenceCode || id)}/${safe(parts[3])}${ext}`;
    if (parent.userId) return `requests/${safe(parent.userId)}/${safe(id)}/${safe(parts[3])}${ext}`;
    return `staff/other/transactions/${safe(id)}/${safe(parts[3])}${ext}`;
  }
  if (collection === 'pre_plans' && parts.length === 4 && parts[2] === 'payment_receipts') {
    return `staff/receipts/${safe(id)}/${safe(parts[3])}${ext}`;
  }
  if (parts.length !== 2) return `staff/other/${parts.map(safe).join('/')}/${label}-${hash}${ext}`;
  if (collection === 'transactions' && label === 'receipt' && where === 'proofOfPaymentUrl' && data.userId && data.isWalkIn !== true) {
    return `proofs/${safe(id)}_${Date.now()}.jpg`;
  }
  if (walkInRef) return `staff/walk-ins/${safe(walkInRef)}/${label}${ext}`;
  if ((collection === 'transactions' || collection === 'pre_plans') && data.userId) return `requests/${safe(data.userId)}/${safe(id)}/${label}${ext}`;
  if (['inventory', 'promotions', 'testimonials'].includes(collection)) return `staff/${collection}/${safe(id)}/photo-${hash}${ext}`;
  return `staff/other/${safe(collection)}/${safe(id)}/${label}-${hash}${ext}`;
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

  // 1. Read every record that uses a migrated/ link. Requests first, so a photo shared with
  //    its case or the walk-in's saved copy lands in the request's folder.
  const order = (p) => (p.startsWith('transactions/') ? 0 : p.startsWith('pre_plans/') ? 1 : p.startsWith('idempotency_keys/') ? 3 : 2);
  const records = [];
  const parents = new Map();
  for (const collection of await db.listCollections()) {
    for await (const doc of allDocs(collection)) {
      const data = doc.data();
      if (doc.ref.path.split('/').length === 2 && doc.ref.parent.id === 'transactions') parents.set(doc.ref.path, data);
      const found = findLinks(data, '', []);
      if (found.length) records.push({ ref: doc.ref, path: doc.ref.path, data, found });
    }
  }
  records.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));

  // 2. One new place per migrated file
  const plan = new Map(); // file -> { target, usedBy: [] }
  const taken = new Set();
  for (const r of records) {
    for (const f of r.found) {
      if (!plan.has(f.file)) {
        // Two different photos never share a name (e.g. a case whose signature differs from its request's)
        let target = targetFor(r.path, r.data, f.where, f.file, parents);
        if (taken.has(target)) target = target.replace(/(\.[\w]+)$/, `-${path.basename(f.file).slice(0, 8)}$1`);
        taken.add(target);
        plan.set(f.file, { target, usedBy: [] });
      }
      plan.get(f.file).usedBy.push(`${r.path} :: ${f.where}`);
    }
  }
  const [existing] = await bucket.getFiles({ prefix: 'migrated/' });
  const unused = existing.map((f) => f.name).filter((name) => !plan.has(name));

  const byFolder = {};
  for (const { target } of plan.values()) {
    const folder = target.startsWith('proofs/') ? 'proofs' : target.split('/').slice(0, 2).join('/');
    byFolder[folder] = (byFolder[folder] || 0) + 1;
  }
  for (const [folder, n] of Object.entries(byFolder).sort()) console.log(`${folder.padEnd(40)} ${n} file(s)`);
  console.log(`\n${plan.size} file(s) in migrated/ used by ${records.length} record(s); ${unused.length} not used by any record.`);
  for (const [file, p] of [...plan].slice(0, 8)) console.log(`  e.g. ${file} -> ${p.target}  (${p.usedBy.length} use(s))`);
  if (!APPLY) {
    console.log('\nLook only: nothing changed. Run with --apply --backup=FILE to move them.');
    return;
  }

  // 3. Copy each file to its place with a new download token
  const links = new Map(); // old link -> new link
  for (const [file, p] of plan) {
    const dest = bucket.file(p.target);
    const token = crypto.randomUUID();
    await bucket.file(file).copy(dest);
    await dest.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    const newLink = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(p.target)}?alt=media&token=${token}`;
    for (const r of records) for (const f of r.found) if (f.file === file) links.set(f.link, newLink);
  }

  // 4. Point every record at the new links (only the top-level fields that hold one)
  for (const r of records) {
    const updates = [];
    for (const key of new Set(r.found.map((f) => f.where.split(/[.[]/)[0]))) {
      updates.push(new admin.firestore.FieldPath(key), replaceLinks(r.data[key], links));
    }
    await r.ref.update(...updates);
  }
  console.log(`\nMoved ${plan.size} file(s) and updated ${records.length} record(s).`);

  // 5. Check nothing points at migrated/ any more, then remove those files
  let left = 0;
  for (const collection of await db.listCollections()) {
    for await (const doc of allDocs(collection)) left += findLinks(doc.data(), '', []).length;
  }
  if (left) {
    console.log(`${left} link(s) still point at migrated/; its files were kept.`);
    return;
  }
  for (const name of [...plan.keys(), ...unused]) await bucket.file(name).delete({ ignoreNotFound: true });
  console.log('Verified: no record uses migrated/ now; its files were removed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
