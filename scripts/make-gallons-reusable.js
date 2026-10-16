/**
 * The gallons of mineral water come back to the funeral home after the wake, so on the Stock List
 * they are a Reusable item ("Gamit sa Burol (ibinabalik)"), like chairs and tables. This moves the
 * item there and fixes the cases that took gallons while they still counted as used up: on each
 * case not yet returned, its gallons become reusable and are counted back as Reserved (wake not
 * started) or At wake, so they show in the At Wake Report and come back with Return & Make
 * Available. Available stays the same.
 *
 *   node scripts/make-gallons-reusable.js                       look only (default)
 *   node scripts/make-gallons-reusable.js --apply --backup=FILE  make the change (FILE: today's backup)
 */
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

const ITEM_ID = 'drink-water-gallon';
const REUSABLE_GROUP = 'Gamit sa Burol (ibinabalik)';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);
const num = (v) => Math.max(0, Math.floor(Number(v) || 0));

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }
  const itemRef = db.doc(`stock_items/${ITEM_ID}`);
  const item = (await itemRef.get()).data();
  if (!item) throw new Error(`${ITEM_ID} isn't on the Stock List.`);

  // Cases holding gallons that haven't been returned yet
  let toReserved = 0;
  let toWake = 0;
  const cases = [];
  for (const doc of (await db.collection('pre_plans').get()).docs) {
    const p = doc.data();
    if (!p.stockRelease || p.stockReturn) continue;
    const lines = Array.isArray(p.stockRelease.lines) ? p.stockRelease.lines : [];
    const i = lines.findIndex((l) => l && l.itemId === ITEM_ID && l.kind !== 'reusable');
    if (i < 0) continue;
    const qty = num(lines[i].qty);
    const reserved = p.stockRelease.stage === 'reserved';
    if (reserved) toReserved += qty;
    else toWake += qty;
    cases.push({ ref: doc.ref, label: p.referenceNumber || doc.id, qty, where: reserved ? 'Reserved' : 'At wake', lines: lines.map((l, j) => (j === i ? { ...l, kind: 'reusable' } : l)) });
  }

  console.log(`${item.name}: ${item.kind} in "${item.group}" → reusable in "${REUSABLE_GROUP}"`);
  console.log(`On hand ${num(item.onHand)} → ${num(item.onHand) + toReserved + toWake}, Reserved ${num(item.reserved)} → ${num(item.reserved) + toReserved}, At wake ${num(item.atWake)} → ${num(item.atWake) + toWake} (Available unchanged)`);
  cases.forEach((c) => console.log(`  ${c.label}: ${c.qty} gallons, ${c.where}`));
  if (item.kind === 'reusable' && cases.length === 0) {
    console.log('\nAlready reusable; nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log(`\nLook only: nothing changed. ${cases.length} case(s). Run with --apply --backup=FILE to make the change.`);
    return;
  }

  const batch = db.batch();
  batch.update(itemRef, {
    kind: 'reusable',
    group: REUSABLE_GROUP,
    onHand: num(item.onHand) + toReserved + toWake,
    reserved: num(item.reserved) + toReserved,
    atWake: num(item.atWake) + toWake,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  cases.forEach((c) => batch.update(c.ref, { 'stockRelease.lines': c.lines, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
  await batch.commit();
  console.log(`\nDone: ${item.name} is reusable; ${cases.length} case(s) now return their gallons.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
