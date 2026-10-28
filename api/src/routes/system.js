const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/system/config
 * Returns system configuration (app version, settings)
 */
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT * FROM config');
    const result = await stmt.all();

    const configMap = {};
    (result.results || result).forEach(row => {
      configMap[row.key] = row.value;
    });

    res.json({
      status: 'success',
      data: configMap
    });
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
