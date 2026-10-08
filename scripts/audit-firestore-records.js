const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

async function audit() {
  if (!isFirebaseInitialized || !db) {
    console.error('Firebase not initialized');
    process.exit(1);
  }

  console.log('====================================================');
  console.log('🔍 FIRESTORE COMPREHENSIVE SCHEMA & DATA AUDIT');
  console.log('====================================================\n');

  const issues = [];
  const warnings = [];

  // 1. AUDIT TRANSACTIONS
  console.log('Checking transactions collection...');
  const txSnap = await db.collection('transactions').get();
  console.log(`Found ${txSnap.size} transactions.`);

  const plansSnap = await db.collection('pre_plans').get();
  const plansByRef = new Map();
  plansSnap.forEach(d => {
    const data = d.data();
    if (data.referenceNumber) plansByRef.set(data.referenceNumber, { id: d.id, ...data });
  });

  txSnap.forEach(doc => {
    const t = doc.data();
    const id = doc.id;
    const ref = t.referenceCode || t.referenceNumber || 'NO-REF';

    // Financial check
    const total = Number(t.totalPrice ?? t.totalAmount ?? 0);
    const paid = Number(t.amountPaid ?? 0);
    const balance = Number(t.balance ?? (total - paid));

    if (total > 0 && Math.abs((total - paid) - balance) > 0.01) {
      issues.push({
        collection: 'transactions',
        id,
        ref,
        issue: `Balance mismatch: total (${total}) - paid (${paid}) = ${total - paid}, but balance is ${balance}`
      });
    }

    // Payment status check
    const expectedPaymentStatus = total > 0 && paid >= total ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    if (t.paymentStatus && t.paymentStatus.toLowerCase() !== expectedPaymentStatus) {
      issues.push({
        collection: 'transactions',
        id,
        ref,
        issue: `Payment status discrepancy: recorded as '${t.paymentStatus}', expected '${expectedPaymentStatus}' (total ${total}, paid ${paid})`
      });
    }

    // Schedule check
    if (Array.isArray(t.paymentSchedule)) {
      t.paymentSchedule.forEach((period, idx) => {
        if (!period.dueDate) {
          warnings.push({ collection: 'transactions', id, ref, warning: `Period ${period.period || idx + 1} has no dueDate` });
        }
      });
    }

    // Linked Pre-plan check
    if (plansByRef.has(ref)) {
      const plan = plansByRef.get(ref);
      const planTotal = Number(plan.totalAmount ?? plan.totalPrice ?? 0);
      const planPaid = Number(plan.amountPaid ?? 0);

      if (Math.abs(planTotal - total) > 0.01) {
        issues.push({
          collection: 'transactions',
          id,
          ref,
          issue: `Total price mismatch with linked pre_plan (${plan.id}): tx has ${total}, plan has ${planTotal}`
        });
      }
      if (Math.abs(planPaid - paid) > 0.01) {
        issues.push({
          collection: 'transactions',
          id,
          ref,
          issue: `Amount paid mismatch with linked pre_plan (${plan.id}): tx has ${paid}, plan has ${planPaid}`
        });
      }
    }
  });

  // 2. AUDIT PRE_PLANS
  console.log('\nChecking pre_plans collection...');
  console.log(`Found ${plansSnap.size} pre_plans.`);

  plansSnap.forEach(doc => {
    const p = doc.data();
    const id = doc.id;
    const ref = p.referenceNumber || 'NO-REF';

    const total = Number(p.totalAmount ?? p.totalPrice ?? 0);
    const paid = Number(p.amountPaid ?? 0);
    const balance = Number(p.balance ?? (total - paid));

    if (total > 0 && Math.abs((total - paid) - balance) > 0.01) {
      issues.push({
        collection: 'pre_plans',
        id,
        ref,
        issue: `Balance mismatch: total (${total}) - paid (${paid}) = ${total - paid}, but balance is ${balance}`
      });
    }

    if (!p.requestStatus) {
      issues.push({ collection: 'pre_plans', id, ref, issue: 'Missing requestStatus' });
    }

    if (!p.planType && !p.package && !p.planName) {
      warnings.push({ collection: 'pre_plans', id, ref, warning: 'Missing planType / package / planName' });
    }
  });

  // 3. AUDIT INVENTORY
  console.log('\nChecking inventory collection...');
  const invSnap = await db.collection('inventory').get();
  console.log(`Found ${invSnap.size} inventory items.`);
  invSnap.forEach(doc => {
    const item = doc.data();
    if (!item.name) issues.push({ collection: 'inventory', id: doc.id, issue: 'Missing item name' });
    if (typeof item.price !== 'number' && typeof item.price !== 'string') {
      issues.push({ collection: 'inventory', id: doc.id, issue: 'Missing or invalid price' });
    }
  });

  // 4. AUDIT USERS
  console.log('\nChecking users collection...');
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users.`);
  usersSnap.forEach(doc => {
    const u = doc.data();
    if (!u.role) warnings.push({ collection: 'users', id: doc.id, warning: 'User doc missing role' });
  });

  // SUMMARY REPORT
  console.log('\n====================================================');
  console.log('AUDIT SUMMARY RESULTS');
  console.log('====================================================');
  console.log(`Issues found:   ${issues.length}`);
  console.log(`Warnings found: ${warnings.length}`);

  if (issues.length > 0) {
    console.log('\n❌ ISSUES:');
    issues.forEach(i => console.log(`  [${i.collection}/${i.id}] (ref: ${i.ref || 'N/A'}): ${i.issue}`));
  } else {
    console.log('\n✅ 0 Critical Schema/Sync Issues found across all Firestore collections!');
  }

  if (warnings.length > 0) {
    console.log('\n⚠️ WARNINGS:');
    warnings.forEach(w => console.log(`  [${w.collection}/${w.id}]: ${w.warning}`));
  }
}

audit().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
