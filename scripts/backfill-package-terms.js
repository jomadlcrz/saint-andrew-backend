/**
 * The contract prints its package's Contract Terms (Inventory & Packages). New contracts copy them
 * when staff save the Contract Details; cases made before carry none, so their contracts print no
 * terms. This copies each case's package terms onto the case (`selectedPackage.contract`, which the
 * contract reads when its details have none). Cases that already have terms are left alone.
 *
 *   node scripts/backfill-package-terms.js                       look only (default)
 *   node scripts/backfill-package-terms.js --apply --backup=FILE  copy them (FILE: today's backup)
 */
const fs = require('fs');
const path = require('path');
const { db, isFirebaseInitialized } = require('../src/config/firebase.config');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const obj = (v) => (v && typeof v === 'object' ? v : {});

/** The case's package: by id wherever the apps saved it, else by name when only one package has it. */
function packageOf(plan, packages) {
  const id =
    str(obj(plan.selectedPackage).id) || str(plan.packageId) || str(obj(plan.serviceSelections).packageInventoryId) || str(plan.packageInventoryId);
  if (id && packages.has(id)) return packages.get(id);
  const name = str(obj(plan.selectedPackage).name).toLowerCase();
  const named = [...packages.values()].filter((p) => str(p.name).toLowerCase() === name);
  return name && named.length === 1 ? named[0] : null;
}

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }
  const packages = new Map((await db.collection('inventory').get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  let copied = 0;
  let had = 0;
  const missing = [];
  for (const doc of (await db.collection('pre_plans').get()).docs) {
    const plan = doc.data();
    const label = str(plan.referenceNumber) || doc.id;
    if (str(obj(plan.contractDetails).packageTerms) || str(obj(plan.selectedPackage).contract)) {
      had++;
      continue;
    }
    const pkg = packageOf(plan, packages);
    const terms = pkg ? str(pkg.contract) : '';
    if (!terms) {
      missing.push(`${label} (${pkg ? `${pkg.name} has no terms` : 'package not found'})`);
      continue;
    }
    console.log(`${label}  ← ${pkg.name}`);
    copied++;
    if (APPLY) await doc.ref.update({ 'selectedPackage.contract': terms });
  }
  if (missing.length) console.log(`\nNo terms to copy for: ${missing.join(', ')}`);
  console.log(`\n${APPLY ? 'Copied' : 'Would copy'} terms to ${copied} case(s); ${had} already had them.`);
  if (!APPLY) console.log('Look only: nothing changed. Run with --apply --backup=FILE to copy them.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
