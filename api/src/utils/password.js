const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/**
 * Hash a plain-text PIN (4-digit string)
 */
async function hashPin(pin) {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Compare a plain-text PIN against a stored hash
 */
async function verifyPin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

module.exports = { hashPin, verifyPin };
