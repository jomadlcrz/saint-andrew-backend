/**
 * Philippine Phone Number Utilities
 */

/**
 * Normalizes input phone number to canonical Philippine mobile format: 09XXXXXXXXX
 * Handles:
 *  - +639171234567 -> 09171234567
 *  - 639171234567  -> 09171234567
 *  - 09171234567   -> 09171234567
 *  - 9171234567    -> 09171234567
 * @param {string} value
 * @returns {string}
 */
function normalizePhilippinePhone(value) {
  const raw = String(value || '').replace(/[^\d+]/g, '');

  if (raw.startsWith('+63')) {
    return `0${raw.slice(3)}`;
  }
  if (raw.startsWith('63')) {
    return `0${raw.slice(2)}`;
  }
  if (raw.length === 10 && raw.startsWith('9')) {
    return `0${raw}`;
  }

  return raw;
}

/**
 * Validates whether string is a valid 11-digit Philippine mobile number starting with 09
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhilippinePhone(phone) {
  return /^09\d{9}$/.test(phone);
}

module.exports = {
  normalizePhilippinePhone,
  isValidPhilippinePhone,
};
