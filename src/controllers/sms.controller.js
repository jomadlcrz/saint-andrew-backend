/**
 * SMS Controller
 * Handles customer notification dispatches via Semaphore with Firestore audit logging.
 */

const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { formatBalanceReminderSms } = require('../templates/sms.templates');
const semaphoreService = require('../services/semaphore.service');
const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');

/**
 * Dispatches balance reminder SMS to the client.
 * POST /send-balance-sms
 */
async function sendBalanceSms(req, res, next) {
  try {
    const rawPhone = req.body?.phone;
    const phone = normalizePhilippinePhone(rawPhone);
    const clientName = req.body?.clientName;
    const deceasedName = req.body?.deceasedName;
    const balance = req.body?.balance;
    const dueDate = req.body?.dueDate;
    const transactionId = req.body?.transactionId ? String(req.body.transactionId) : null;

    // 1. Phone validation
    if (!isValidPhilippinePhone(phone)) {
      return res.status(400).json({
        error: 'A valid 11-digit Philippine mobile number (09XXXXXXXXX) is required.',
      });
    }

    // 2. Prepare message content
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

    // 3. Dispatch SMS via service
    const smsResult = await semaphoreService.sendSms({
      number: phone,
      message: message,
    });

    // 4. Update Firestore transaction document if transactionId was provided
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

    // 5. Respond with identical contract as original endpoint
    return res.status(200).json({
      success: true,
      messageId: smsResult.messageId,
      mode: isFirebaseInitialized ? 'production' : 'development',
      real: !smsResult.simulated,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  sendBalanceSms,
};
