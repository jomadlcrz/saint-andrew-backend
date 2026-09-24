/**
 * Sanitization & Escaping Utilities
 */

/**
 * Escapes characters with special meaning in HTML to prevent HTML injection/XSS.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[character])
  );
}

/**
 * Safely trims and cleans incoming string inputs.
 * @param {any} value
 * @param {number} [maxLength]
 * @returns {string}
 */
function sanitizeString(value, maxLength) {
  const str = String(value || '').trim();
  if (typeof maxLength === 'number' && maxLength > 0) {
    return str.substring(0, maxLength);
  }
  return str;
}

/**
 * Strips all non-digit characters, guaranteeing pure integer digits.
 * @param {any} value
 * @returns {string}
 */
function sanitizeDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Parses and sanitizes a numeric value, preventing characters or NaN from entering the database.
 * @param {any} value
 * @param {number} [defaultValue=0]
 * @returns {number}
 */
function sanitizeNumeric(value, defaultValue = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : defaultValue;
  }
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

module.exports = {
  escapeHtml,
  sanitizeString,
  sanitizeDigitsOnly,
  sanitizeNumeric,
};
