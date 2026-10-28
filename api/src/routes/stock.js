const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/stock
 * Returns stock for all items or filtered by site/category
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { site, category, search } = req.query;

    let whereClauses = ['st.is_active = 1'];
    let params = [];

    if (site) {
      whereClauses.push('st.site_id = ?');
      params.push(site);
    }
    if (category) {
      whereClauses.push('p.category_id = ?');
      params.push(category);
    }
    if (search) {
      whereClauses.push('(p.geo LIKE ? OR p.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const stmt = await db.prepare(`
      SELECT st.*, p.geo, p.description, p.name, p.unit,
             c.name as category_name, b.name as brand_name,
             s.name as supplier_name
      FROM stock st
      JOIN products p ON st.item_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ${whereSql}
      ORDER BY p.geo
    `);

    const result = await stmt.bind(...params).all();

    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get stock error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/stock/available/:itemId
 * Returns available quantity for a specific item
 */
router.get('/available/:itemId', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as available
      FROM stock
      WHERE item_id = ? AND is_active = 1
    `);

    const result = await stmt.bind(req.params.itemId).first();

    res.json({ status: 'success', data: { available: result.available } });
  } catch (err) {
    console.error('Get available stock error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
