const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// User-management records deliberately exclude pin_hash.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const statement = await db.prepare(`
      SELECT user_id, email, name, phone, position, site, role, sign_link, is_active, pin_hash
      FROM users
      ORDER BY name COLLATE NOCASE, user_id
    `);
    const result = await statement.all();
    const rows = result.results || result;

    res.json({
      status: 'success',
      data: rows.map((row) => ({
        userId: row.user_id,
        pin: row.pin_hash ? 'Protected' : 'Not set',
        pinSet: Boolean(row.pin_hash),
        name: row.name || '',
        email: row.email || '',
        phone: row.phone || '',
        position: row.position || '',
        site: row.site || '',
        role: row.role || 'operator',
        signLink: row.sign_link || '',
        active: Number(row.is_active) === 1 ? 1 : 0
      }))
    });
  } catch (err) {
    console.error('List users error:', err);
    const message = process.env.CF_WORKER === 'true'
      ? 'Unable to load users'
      : `Unable to load users: ${err.message}`;
    res.status(500).json({ status: 'error', message });
  }
});

module.exports = router;
