/**
 * SMS Controller
 * Handles customer notification dispatches via Semaphore with Firestore audit logging and idempotency deduplication.
 */

const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { sanitizeNumeric } = require('../utils/sanitize.util');
const { formatBalanceReminderSms } = require('../templates/sms.templates');
const semaphoreService = require('../services/semaphore.service');
const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');

// In-memory idempotency deduplication cache (5-minute TTL)
const smsDeduplicationCache = new Map();
const SMS_CACHE_TTL_MS = 5 * 60 * 1000;

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of smsDeduplicationCache.entries()) {
    if (now - entry.timestamp > SMS_CACHE_TTL_MS) {
      smsDeduplicationCache.delete(key);
    }
  }
}

/**
 * Dispatches balance reminder SMS to the client with idempotency protection.
 * POST /send-balance-sms
 */
async function sendBalanceSms(req, res, next) {
  try {
    const rawPhone = req.body?.phone;
    const phone = normalizePhilippinePhone(rawPhone);
    const clientName = req.body?.clientName;
    const deceasedName = req.body?.deceasedName;
    const rawBalance = req.body?.balance;
    const dueDate = req.body?.dueDate;
    const transactionId = req.body?.transactionId ? String(req.body.transactionId) : null;

    // 1. Phone validation
    if (!isValidPhilippinePhone(phone)) {
      return res.status(400).json({
        error: 'A valid 11-digit Philippine mobile number (09XXXXXXXXX) is required.',
      });
    }

    // 2. Balance validation (strictly numeric to prevent characters)
    let balance = rawBalance;
    if (rawBalance !== undefined && rawBalance !== null && rawBalance !== '') {
      if (typeof rawBalance === 'string' && /[^\d.]/.test(rawBalance.trim())) {
        return res.status(400).json({
          error: 'Balance must be a valid numeric amount without letters or special characters.',
        });
      }
      balance = sanitizeNumeric(rawBalance, 0);
    }

    // 3. Prepare message content
    const message = formatBalanceReminderSms({
      clientName,
      deceasedName,
      balance,
      dueDate,
      customMessage: req.body?.message,
    });

    if (!message) {
      return res.status(400).json({
        error: 'Message content cannot be empty.',
      });
    }

    if (message.length > 918) {
      return res.status(400).json({
        error: 'Message text exceeds maximum permissible length (918 characters).',
      });
    }

    // 4. Idempotency & deduplication check
    const explicitKey =
      req.headers['x-idempotency-key'] ||
      req.headers['idempotency-key'] ||
      req.body?.idempotencyKey;
    const cacheKey =
      explicitKey ?
        String(explicitKey).trim() :
        `sms_${phone}_${transactionId || 'notxn'}_${Buffer.from(message).toString('base64').slice(0, 32)}`;

    const existingEntry = smsDeduplicationCache.get(cacheKey);
    if (existingEntry && (Date.now() - existingEntry.timestamp < SMS_CACHE_TTL_MS)) {
      console.warn(`🔒 [Idempotency] Duplicate SMS blocked for key: ${cacheKey}`);
      return res.status(200).json({
        ...existingEntry.result,
        idempotent: true,
        duplicateBlocked: true,
      });
    }

    // 5. Dispatch SMS via service
    const smsResult = await semaphoreService.sendSms({
      number: phone,
      message: message,
    });

    // 6. Update Firestore transaction document if transactionId was provided
    if (isFirebaseInitialized && db && admin && transactionId) {
      try {
        await db.collection('transactions').doc(transactionId).update({
          balanceReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          balanceReminderMessageId: smsResult.messageId || null,
        });
        console.log(`📝 [Firestore] Recorded SMS dispatch on transaction: ${transactionId}`);
      } catch (dbErr) {
        console.warn(`⚠️ [Firestore] Failed to update transaction ${transactionId}:`, dbErr.message);
      }
    }

    const responsePayload = {
      success: true,
      messageId: smsResult.messageId,
      mode: isFirebaseInitialized ? 'production' : 'development',
      real: !smsResult.simulated,
    };

    // 7. Store in deduplication cache
    smsDeduplicationCache.set(cacheKey, {
      timestamp: Date.now(),
      result: responsePayload,
    });

    if (smsDeduplicationCache.size > 200) {
      cleanupExpiredEntries();
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  sendBalanceSms,
};
