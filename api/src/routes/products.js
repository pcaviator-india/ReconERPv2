const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/products
 * Query params: search, category, brand, supplier, geo, page, limit
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { search, category, brand, supplier, geo, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = ['p.is_active = 1'];
    let params = [];

    if (search) {
      whereClauses.push('(p.geo LIKE ? OR p.description LIKE ? OR p.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      whereClauses.push('p.category_id = ?');
      params.push(category);
    }
    if (brand) {
      whereClauses.push('p.brand_id = ?');
      params.push(brand);
    }
    if (supplier) {
      whereClauses.push('p.supplier_id = ?');
      params.push(supplier);
    }
    if (geo) {
      whereClauses.push('p.geo LIKE ?');
      params.push(`%${geo}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const stmt = await db.prepare(`
      SELECT p.*, c.name as category_name, b.name as brand_name, s.name as supplier_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ${whereSql}
      ORDER BY p.geo
      LIMIT ? OFFSET ?
    `);

    const countStmt = await db.prepare(`
      SELECT COUNT(*) as total FROM products p ${whereSql}
    `);

    const [result, countResult] = await Promise.all([
      stmt.bind(...params, parseInt(limit), offset).all(),
      countStmt.bind(...params).first()
    ]);

    res.json({
      status: 'success',
      data: result.results || result,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/products/:geo
 * Get single product by GEO number
 */
router.get('/:geo', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare(`
      SELECT p.*, c.name as category_name, b.name as brand_name, s.name as supplier_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.geo = ? AND p.is_active = 1
    `);

    const result = await stmt.bind(req.params.geo).first();

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
