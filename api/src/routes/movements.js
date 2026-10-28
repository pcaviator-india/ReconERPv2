const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/movements
 * Query params: type, site, from_date, to_date, requisition_id, page, limit
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { type, site, from_date, to_date, requisition_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = [];
    let params = [];

    if (type) {
      whereClauses.push('m.type = ?');
      params.push(type);
    }
    if (site) {
      whereClauses.push('m.site_id = ?');
      params.push(site);
    }
    if (from_date) {
      whereClauses.push('m.created_at >= ?');
      params.push(from_date);
    }
    if (to_date) {
      whereClauses.push('m.created_at <= ?');
      params.push(to_date);
    }
    if (requisition_id) {
      whereClauses.push('m.requisition_id = ?');
      params.push(requisition_id);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const stmt = await db.prepare(`
      SELECT m.*, p.geo, p.description, p.unit, u.name as performed_by_name
      FROM inventory_movements m
      JOIN products p ON m.item_id = p.id
      LEFT JOIN users u ON m.performed_by = u.user_id
      ${whereSql}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const countStmt = await db.prepare(`
      SELECT COUNT(*) as total FROM inventory_movements m ${whereSql}
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
    console.error('Get movements error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/movements/:movementId
 */
router.get('/:movementId', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare(`
      SELECT m.*, p.geo, p.description, p.unit, u.name as performed_by_name
      FROM inventory_movements m
      JOIN products p ON m.item_id = p.id
      LEFT JOIN users u ON m.performed_by = u.user_id
      WHERE m.movement_id = ?
    `);

    const result = await stmt.bind(req.params.movementId).first();

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'Movement not found' });
    }

    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Get movement error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/movements/bulk-issue
 * Bulk issue items for a requisition
 * Body: { requisition_id, items: [{ item_id, stock_id, quantity, site_id }], notes }
 */
router.post('/bulk-issue', authenticateToken, async (req, res) => {
  try {
    const { requisition_id, items, notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Items are required' });
    }

    const db = req.app.locals.db;
    const userId = req.user.userId;
    const results = [];

    for (const item of items) {
      const movementId = uuidv4();

      // Check available stock
      const stockStmt = await db.prepare(`
        SELECT id, quantity FROM stock
        WHERE id = ? AND is_active = 1
      `);
      const stock = await stockStmt.bind(item.stock_id).first();

      if (!stock) {
        return res.status(400).json({
          status: 'error',
          message: `Stock record not found for item ${item.item_id}`
        });
      }

      if (stock.quantity < item.quantity) {
        return res.status(400).json({
          status: 'error',
          message: `Insufficient stock for item ${item.item_id}. Available: ${stock.quantity}, Requested: ${item.quantity}`
        });
      }

      // Create movement record
      const insertMovement = await db.prepare(`
        INSERT INTO inventory_movements (movement_id, type, item_id, stock_id, quantity, site_id, requisition_id, performed_by, notes)
        VALUES (?, 'issue', ?, ?, ?, ?, ?, ?, ?)
      `);

      await insertMovement.bind(
        movementId,
        item.item_id,
        item.stock_id,
        item.quantity,
        item.site_id,
        requisition_id || null,
        userId,
        notes || ''
      ).run();

      // Update stock quantity
      const updateStock = await db.prepare(`
        UPDATE stock SET quantity = quantity - ? WHERE id = ?
      `);
      await updateStock.bind(item.quantity, item.stock_id).run();

      results.push({ movement_id: movementId, item_id: item.item_id, quantity: item.quantity });
    }

    // Update requisition status to issued
    if (requisition_id) {
      const updateReq = await db.prepare(`
        UPDATE requisitions SET status = 'issued', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `);
      await updateReq.bind(requisition_id).run();
    }

    res.status(201).json({
      status: 'success',
      data: results,
      message: `Successfully issued ${results.length} item(s)`
    });
  } catch (err) {
    console.error('Bulk issue error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;