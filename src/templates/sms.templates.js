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

module.exports = {
  formatBalanceReminderSms,
};
