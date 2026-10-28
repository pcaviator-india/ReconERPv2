const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/jobs/:jobId
 * Get status of a background job
 */
router.get('/:jobId', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT * FROM background_jobs WHERE job_id = ?');
    const job = await stmt.bind(req.params.jobId).first();

    if (!job) {
      return res.status(404).json({ status: 'error', message: 'Job not found' });
    }

    res.json({ status: 'success', data: job });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/jobs
 * Batch get multiple job statuses
 * Body: { jobIds: [...] }
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { jobIds } = req.body;

    if (!jobIds || !Array.isArray(jobIds)) {
      return res.status(400).json({ status: 'error', message: 'jobIds array is required' });
    }

    const db = req.app.locals.db;
    const placeholders = jobIds.map(() => '?').join(',');
    const stmt = await db.prepare(`
      SELECT * FROM background_jobs WHERE job_id IN (${placeholders})
    `);

    const result = await stmt.bind(...jobIds).all();

    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
