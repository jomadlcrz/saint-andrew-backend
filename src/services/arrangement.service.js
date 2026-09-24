/**
 * Arrangement Lookup & Claim Service
 * Lets a family look up an arrangement by its reference code, or attach a walk-in / guest
 * arrangement to their account, without giving clients read access to other families'
 * `transactions` and `pre_plans` documents. Both operations require the phone number on file
 * as proof, since a reference code alone is printed on receipts and easy to guess or share.
 */

const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');

/** userId values written for records that have no app account behind them */
const PLACEHOLDER_USER_IDS = new Set(['', 'walk-in', 'web-client', 'anonymous', 'guest']);

function isUnowned(userId) {
  return !userId || PLACEHOLDER_USER_IDS.has(String(userId).trim());
}

/** Phone numbers a transaction or pre-plan may carry for its family contact */
function contactPhones(data) {
  return [
    data.clientPhone,
    data.contactPhone,
    data.representativeInfo?.phone,
    data.informant?.phone,
    data.holder?.phone,
  ].filter(Boolean);
}

function phoneMatches(data, phone) {
  return contactPhones(data).some((candidate) => normalizePhilippinePhone(candidate) === phone);
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The fields a family sees when tracking an arrangement. Never includes contact details,
 * documents, signatures or payment proofs.
 */
function toSummary(match) {
  const { collection, id, data } = match;
  if (collection === 'pre_plans') {
    const totalAmount = Number(data.totalAmount) || 0;
    const amountPaid = Number(data.amountPaid) || 0;
    const deceased = data.deceasedInfo;
    return {
      id,
      source: 'pre_plans',
      referenceCode: data.referenceNumber || id,
      clientName: data.contactName || data.representativeInfo?.name || 'Client',
      deceasedName:
        deceased?.firstName && deceased?.lastName
          ? `${deceased.firstName} ${deceased.lastName}`
          : data.deceasedName || 'Loved One',
      serviceType: data.selectedPackage?.name || 'Pre-Need Plan',
      status: String(data.requestStatus || 'pending').toLowerCase(),
      paymentStatus: amountPaid >= totalAmount && totalAmount > 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
      totalPrice: totalAmount,
      amountPaid,
      balance: data.balance ?? totalAmount - amountPaid,
      burialDate: data.funeralDate || '',
      createdAt: toIso(data.createdAt),
    };
  }
  return {
    id,
    source: 'transactions',
    referenceCode: data.referenceCode || data.trackingId || id,
    clientName: data.clientName || 'Client',
    deceasedName: data.deceasedName || 'Loved One',
    serviceType: data.serviceType || '',
    status: data.status || 'pending',
    paymentStatus: data.paymentStatus || 'unpaid',
    totalPrice: Number(data.totalPrice) || 0,
    amountPaid: Number(data.amountPaid) || 0,
    balance: Number(data.balance) || 0,
    burialDate: data.burialDate || '',
    wakeSchedule: data.wakeSchedule
      ? {
          startOfMourning: data.wakeSchedule.startOfMourning || '',
          lastNight: data.wakeSchedule.lastNight || '',
          funeralDate: data.wakeSchedule.funeralDate || '',
          cemeteryName: data.wakeSchedule.cemeteryName || '',
        }
      : undefined,
    createdAt: toIso(data.createdAt),
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Same message whether the code is unknown or the phone doesn't match, so the endpoint
// can't be used to learn which reference codes exist.
const NOT_FOUND_MESSAGE = 'No arrangement matches that reference code and phone number.';

/**
 * Factory so tests can inject a fake Firestore.
 * @param {{ db: any, serverTimestamp: () => any }} deps
 */
function createArrangementService({ db: firestore, serverTimestamp }) {
  async function firstWhere(collectionName, field, value) {
    const snap = await firestore.collection(collectionName).where(field, '==', value).limit(1).get();
    const [docSnap] = snap.docs;
    return docSnap ? { collection: collectionName, id: docSnap.id, ref: docSnap.ref, data: docSnap.data() } : null;
  }

  /** Finds a transaction by reference code, tracking id or document id, then a pre-plan by reference number. */
  async function findByReference(rawCode) {
    const code = String(rawCode || '').trim();
    const upper = code.toUpperCase();
    const candidates = upper === code ? [code] : [upper, code];

    for (const value of candidates) {
      const match =
        (await firstWhere('transactions', 'referenceCode', value)) ||
        (await firstWhere('transactions', 'trackingId', value));
      if (match) return match;
    }

    const directSnap = await firestore.collection('transactions').doc(code).get();
    if (directSnap.exists) {
      return { collection: 'transactions', id: directSnap.id, ref: directSnap.ref, data: directSnap.data() };
    }

    for (const value of candidates) {
      const match = await firstWhere('pre_plans', 'referenceNumber', value);
      if (match) return match;
    }
    return null;
  }

  /** The other half of a pre-plan ↔ transaction mirror pair, if it exists. */
  async function findMirror(match) {
    if (match.collection === 'pre_plans') {
      const reference = match.data.referenceNumber;
      if (!reference) return null;
      return (
        (await firstWhere('transactions', 'referenceCode', reference)) ||
        (await firstWhere('transactions', 'trackingId', reference))
      );
    }
    const reference = match.data.referenceCode || match.data.trackingId;
    return reference ? firstWhere('pre_plans', 'referenceNumber', reference) : null;
  }

  async function findVerified(code, rawPhone) {
    const phone = normalizePhilippinePhone(rawPhone);
    if (!String(code || '').trim() || code.includes('/')) {
      throw httpError(400, 'A valid reference code is required.');
    }
    if (!isValidPhilippinePhone(phone)) {
      throw httpError(400, 'A valid 11-digit Philippine mobile number (09XXXXXXXXX) is required.');
    }
    const match = await findByReference(code);
    if (!match || !phoneMatches(match.data, phone)) {
      throw httpError(404, NOT_FOUND_MESSAGE);
    }
    return match;
  }

  return {
    /** Read-only summary for a family that is not signed in. */
    async trackArrangement({ code, phone }) {
      const match = await findVerified(code, phone);
      return toSummary(match);
    },

    /**
     * Attaches an unowned arrangement (and its mirror document) to the caller's account.
     * Idempotent for the current owner; refuses records already linked to someone else.
     */
    async claimArrangement({ code, phone, uid }) {
      const match = await findVerified(code, phone);
      if (!isUnowned(match.data.userId) && match.data.userId !== uid) {
        throw httpError(409, 'This arrangement is already linked to another account. Please contact the funeral home.');
      }

      const targets = [match];
      const mirror = await findMirror(match);
      if (mirror && (isUnowned(mirror.data.userId) || mirror.data.userId === uid)) {
        targets.push(mirror);
      }

      const batch = firestore.batch();
      for (const target of targets) {
        batch.update(target.ref, { userId: uid, updatedAt: serverTimestamp() });
      }
      await batch.commit();

      return toSummary({ ...match, data: { ...match.data, userId: uid } });
    },
  };
}

function getArrangementService() {
  if (!isFirebaseInitialized || !db || !admin) {
    throw httpError(503, 'Arrangement lookup is not available on the server.');
  }
  return createArrangementService({
    db,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = {
  NOT_FOUND_MESSAGE,
  createArrangementService,
  getArrangementService,
  isUnowned,
  toSummary,
};
