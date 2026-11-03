const bcrypt = require('bcryptjs');

function normalizeSyncPin(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{1,4}$/.test(text)) return text.padStart(4, '0');
  return text;
}

function normalizeSyncUserId(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/[,\s]/g, '');
}

function hashSyncPin(value) {
  const pin = normalizeSyncPin(value);
  if (!pin) return '';
  return pin.startsWith('$2') ? pin : bcrypt.hashSync(pin, 10);
}

module.exports = { normalizeSyncPin, normalizeSyncUserId, hashSyncPin };
