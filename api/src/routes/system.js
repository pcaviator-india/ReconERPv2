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

async function updateConfig(req, res, keyFromPath) {
  try {
    const allowed = new Set([
      'reqEmailEnabled', 'reqPdfEnabled', 'quoEmailEnabled', 'quoPdfEnabled',
      'quoteEmailPending', 'quoteEmailQuoted', 'quoteEmailApproved',
      'quoteEmailSent', 'quoteEmailReceived', 'quoteEmailDespatched',
      'quoteEmailFinalReceived', 'req_no_counter'
    ]);
    const key = String(keyFromPath || (req.body && req.body.key) || '').trim();
    if (!allowed.has(key)) {
      return res.status(400).json({ status: 'error', message: 'Unknown system configuration key' });
    }

    const rawValue = req.body && req.body.value;
    const value = key === 'req_no_counter'
      ? String(Number.parseInt(rawValue, 10) || 0)
      : ['true', '1', 'yes'].includes(String(rawValue).trim().toLowerCase()) ? 'true' : 'false';
    const stmt = await req.app.locals.db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    await stmt.bind(key, value).run();
    return res.json({ status: 'success', data: { key, value } });
  } catch (err) {
    console.error('Update config error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to update system configuration' });
  }
}

router.put('/config/:key', authenticateToken, (req, res) => updateConfig(req, res, req.params.key));
router.put('/config', authenticateToken, (req, res) => updateConfig(req, res, null));

module.exports = router;
