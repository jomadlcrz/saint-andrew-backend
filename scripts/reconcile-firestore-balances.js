const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

function paymentStatusFor(total, paid) {
  if (total > 0 && paid >= total) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

function round(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function computeCanonicalFinancials(docData) {
  // 1. Determine total:
  let total = Number(docData.totalAmount ?? docData.totalPrice ?? 0);
  if (Array.isArray(docData.paymentSchedule) && docData.paymentSchedule.length > 0) {
    const schedSum = docData.paymentSchedule.reduce((sum, p) => sum + (Number(p.amountDue) || 0), 0);
    if (schedSum > 0) {
      total = schedSum;
    }
  }
  total = round(total);

  // 2. Determine paid:
  const paid = round(Math.min(total, Math.max(0, Number(docData.amountPaid ?? 0))));

  // 3. Balance:
  const balance = round(Math.max(0, total - paid));

  // 4. Payment status:
  const paymentStatus = paymentStatusFor(total, paid);

  return { total, paid, balance, paymentStatus };
}

async function reconcile() {
  if (!isFirebaseInitialized || !db) {
    console.error('Firebase Admin not initialized');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  console.log(`\nReconciling Firestore Balances & Totals ${apply ? '(APPLY)' : '(dry run)'}`);

  const [plansSnap, txSnap] = await Promise.all([
    db.collection('pre_plans').get(),
    db.collection('transactions').get()
  ]);

  const planUpdates = [];
  const txUpdates = [];

  // Map plans by ID and by reference
  const plansMap = new Map();
  plansSnap.forEach(d => plansMap.set(d.id, { id: d.id, ...d.data() }));

  // Reconcile pre_plans
  plansSnap.forEach(doc => {
    const d = doc.data();
    const { total, paid, balance, paymentStatus } = computeCanonicalFinancials(d);

    const changes = [];
    const fields = {};

    const curTotal = Number(d.totalAmount ?? d.totalPrice ?? 0);
    if (Math.abs(curTotal - total) > 0.01) {
      fields.totalAmount = total;
      fields.totalPrice = total;
      changes.push(`total: ${curTotal} → ${total}`);
    }

    const curPaid = Number(d.amountPaid ?? 0);
    if (Math.abs(curPaid - paid) > 0.01) {
      fields.amountPaid = paid;
      changes.push(`paid: ${curPaid} → ${paid}`);
    }

    const curBalance = Number(d.balance ?? (curTotal - curPaid));
    if (Math.abs(curBalance - balance) > 0.01) {
      fields.balance = balance;
      changes.push(`balance: ${curBalance} → ${balance}`);
    }

    if (changes.length > 0) {
      planUpdates.push({ id: doc.id, fields, changes, ref: d.referenceNumber || d.referenceCode });
    }
  });

  // Reconcile transactions
  txSnap.forEach(doc => {
    const d = doc.data();
    // Check if linked to pre_plan
    const linkedPlan = plansMap.get(doc.id) || 
      Array.from(plansMap.values()).find(p => (p.referenceNumber && p.referenceNumber === d.referenceCode));

    let canonical = computeCanonicalFinancials(d);
    if (linkedPlan) {
      canonical = computeCanonicalFinancials(linkedPlan);
    }

    const changes = [];
    const fields = {};

    const curTotal = Number(d.totalPrice ?? d.totalAmount ?? 0);
    if (Math.abs(curTotal - canonical.total) > 0.01) {
      fields.totalPrice = canonical.total;
      changes.push(`total: ${curTotal} → ${canonical.total}`);
    }

    const curPaid = Number(d.amountPaid ?? 0);
    if (Math.abs(curPaid - canonical.paid) > 0.01) {
      fields.amountPaid = canonical.paid;
      changes.push(`paid: ${curPaid} → ${canonical.paid}`);
    }

    const curBalance = Number(d.balance ?? (curTotal - curPaid));
    if (Math.abs(curBalance - canonical.balance) > 0.01) {
      fields.balance = canonical.balance;
      changes.push(`balance: ${curBalance} → ${canonical.balance}`);
    }

    if (d.paymentStatus !== canonical.paymentStatus) {
      fields.paymentStatus = canonical.paymentStatus;
      changes.push(`paymentStatus: ${d.paymentStatus} → ${canonical.paymentStatus}`);
    }

    if (changes.length > 0) {
      txUpdates.push({ id: doc.id, fields, changes, ref: d.referenceCode || d.referenceNumber });
    }
  });

  console.log(`\n--- PRE_PLANS UPDATES (${planUpdates.length}) ---`);
  for (const u of planUpdates) {
    console.log(`  pre_plans/${u.id} (ref: ${u.ref || 'N/A'}): ${u.changes.join(', ')}`);
  }

  console.log(`\n--- TRANSACTIONS UPDATES (${txUpdates.length}) ---`);
  for (const u of txUpdates) {
    console.log(`  transactions/${u.id} (ref: ${u.ref || 'N/A'}): ${u.changes.join(', ')}`);
  }

  const totalUpdates = planUpdates.length + txUpdates.length;
  console.log(`\nTotal updates needed: ${totalUpdates}`);

  if (apply && totalUpdates > 0) {
    console.log('\nApplying updates in Firestore...');
    const batch = db.batch();
    for (const u of planUpdates) {
      batch.update(db.collection('pre_plans').doc(u.id), {
        ...u.fields,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    for (const u of txUpdates) {
      batch.update(db.collection('transactions').doc(u.id), {
        ...u.fields,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    console.log('✅ All updates successfully committed to Firestore!');
  } else if (!apply) {
    console.log('\nRun with --apply to commit these changes.');
  }
}

reconcile().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
