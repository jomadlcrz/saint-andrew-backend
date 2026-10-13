/**
 * "Maria Reyes Santos Jr." from a record's name parts. Records keep only the parts (no `fullName`
 * field), so the full name is put together here. A "None"/"N/A" suffix is left out.
 */
function fullNameFrom(person) {
  if (!person) return '';
  const part = (v) => (typeof v === 'string' ? v.trim() : '');
  const suffix = part(person.suffix);
  return [part(person.firstName), part(person.middleName), part(person.lastName), /^(none|n\/?a|-+)$/i.test(suffix) ? '' : suffix]
    .filter(Boolean)
    .join(' ');
}

module.exports = { fullNameFrom };
