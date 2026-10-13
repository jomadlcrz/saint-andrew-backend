/**
 * Names are kept as their parts (firstName, middleName, lastName, suffix) and the apps put the full
 * name together (fullNameFrom). This removes the `fullName` copies older versions saved: on
 * `users`, and inside cases' person details (`pre_plans` subjectInfo, planHolderInfo,
 * deceasedInfo, ...). A copy is removed only when the record has the name parts and they make the
 * same name, so nothing is lost.
 *
 *   node scripts/remove-saved-full-names.js                       look only (default)
 *   node scripts/remove-saved-full-names.js --apply --backup=FILE  remove them (FILE: today's backup)
 *
 * Run it after the apps that don't read `fullName` are deployed. An app that wasn't updated may
 * still save one; running this again later removes those too.
 */
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');
const { fullNameFrom } = require('../src/utils/person-name.util');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);
const squash = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Field paths of `fullName` copies inside a value that can go, and ones kept (no matching parts). */
function findCopies(value, where, out) {
  if (Array.isArray(value)) return out; // names inside lists aren't saved this way
  if (!value || typeof value !== 'object' || value instanceof admin.firestore.Timestamp) return out;
  if (typeof value.fullName === 'string') {
    const built = fullNameFrom(value);
    (built && squash(built) === squash(value.fullName) ? out.remove : out.keep).push({ path: where ? `${where}.fullName` : 'fullName', saved: value.fullName, built });
  }
  for (const [k, v] of Object.entries(value)) if (k !== 'fullName') findCopies(v, where ? `${where}.${k}` : k, out);
  return out;
}

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }
  let removed = 0;
  let kept = 0;
  for (const name of ['users', 'pre_plans', 'transactions']) {
    for (const doc of (await db.collection(name).get()).docs) {
      const { remove, keep } = findCopies(doc.data(), '', { remove: [], keep: [] });
      for (const k of keep) console.log(`  kept (no matching name parts): ${doc.ref.path} ${k.path} = ${JSON.stringify(k.saved)}`);
      kept += keep.length;
      if (!remove.length) continue;
      console.log(`${doc.ref.path}  ${remove.map((r) => r.path).join(', ')}`);
      removed += remove.length;
      if (APPLY) {
        const updates = [];
        for (const r of remove) updates.push(new admin.firestore.FieldPath(...r.path.split('.')), admin.firestore.FieldValue.delete());
        await doc.ref.update(...updates);
      }
    }
  }
  console.log(`\n${APPLY ? 'Removed' : 'Would remove'} ${removed} saved full name(s); ${kept} kept.`);
  if (!APPLY) console.log('Look only: nothing changed. Run with --apply --backup=FILE to remove them.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
