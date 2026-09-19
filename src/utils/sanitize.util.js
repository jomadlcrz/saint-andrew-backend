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

module.exports = {
  escapeHtml,
  sanitizeString,
};
