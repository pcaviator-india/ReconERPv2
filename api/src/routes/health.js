const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/health - Health check endpoint
 */
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    data: {
      service: 'recon-erp-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

module.exports = router;
