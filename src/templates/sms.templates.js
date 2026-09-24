/**
 * SMS Content Formatters
 */

/**
 * Generates a courteous, respectful balance reminder SMS message.
 * @param {Object} params
 * @param {string} [params.clientName]
 * @param {string} [params.deceasedName]
 * @param {number} [params.balance]
 * @param {string} [params.dueDate]
 * @param {string} [params.customMessage]
 * @returns {string}
 */
function formatBalanceReminderSms({ clientName, deceasedName, balance, dueDate, customMessage }) {
  if (customMessage && typeof customMessage === 'string' && customMessage.trim()) {
    return customMessage.trim();
  }

  const greeting = clientName ? `Dear ${clientName}` : 'Dear Valued Client';
  const lovedOne = deceasedName ? `the arrangement of ${deceasedName}` : 'your arrangement';
  const formattedBalance = `₱${Number(balance || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const settleDate = dueDate ? `before ${dueDate}` : 'prior to the schedule';

  return `${greeting}, gentle reminder from St. Andrew Funeral Home regarding the remaining balance of ${formattedBalance} for ${lovedOne}. Kindly settle ${settleDate}. For questions or assistance, please reach out to our office. Thank you.`;
}

/**
 * Builds the SMS and push/in-app text for a scheduled payment reminder, worded by payment plan kind
 * so both channels always say the same thing.
 * @param {Object} params
 * @param {'longTermInstallment'|'shortTerm'|'full'} params.paymentPlanKind
 * @param {string} [params.installmentCadence]
 * @param {number} [params.periodIndex]
 * @param {number} params.amountDue
 * @param {number} params.remainingBalance
 * @param {string} params.dueDateLabel
 * @returns {{ sms: string, title: string, body: string }}
 */
function formatPaymentReminder({
  paymentPlanKind,
  installmentCadence = 'monthly',
  periodIndex,
  amountDue,
  remainingBalance,
  dueDateLabel,
}) {
  const due = `₱${Number(amountDue || 0).toFixed(2)}`;
  const balance = `₱${Number(remainingBalance || 0).toFixed(2)}`;
  const installment = periodIndex != null ? ` #${periodIndex}` : '';

  if (paymentPlanKind === 'longTermInstallment') {
    return {
      sms: `Saint Andrew Funeral Homes: Your ${installmentCadence} payment of ${due} for your Pre-Need Plan (installment${installment}) is due on ${dueDateLabel}.`,
      title: 'Pre-Need payment reminder',
      body: `Installment${installment} of ${due} is due on ${dueDateLabel}.`,
    };
  }
  if (paymentPlanKind === 'shortTerm') {
    return {
      sms: `Saint Andrew Funeral Homes: Installment${installment} of your short-term payment plan — ${due} — is due on ${dueDateLabel}. Remaining balance: ${balance}.`,
      title: 'Payment reminder',
      body: `Installment${installment} of your short-term plan (${due}) is due on ${dueDateLabel}. Remaining balance: ${balance}.`,
    };
  }
  return {
    sms: `Saint Andrew Funeral Homes: Your remaining balance is ${balance}. Full payment is required before interment.`,
    title: 'Balance reminder',
    body: `Your remaining balance is ${balance}. Full payment is required before interment.`,
  };
}

module.exports = {
  formatBalanceReminderSms,
  formatPaymentReminder,
};
