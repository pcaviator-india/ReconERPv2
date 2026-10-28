const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/requisitions
 * Query params: status, site, requested_by, page, limit
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { status, site, requested_by, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = [];
    let params = [];

    if (status) {
      whereClauses.push('r.status = ?');
      params.push(status);
    }
    if (site) {
      whereClauses.push('r.site_id = ?');
      params.push(site);
    }
    if (requested_by) {
      whereClauses.push('r.requested_by = ?');
      params.push(requested_by);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const stmt = await db.prepare(`
      SELECT r.*, u.name as requested_by_name, u.user_id as requested_by_uid
      FROM requisitions r
      LEFT JOIN users u ON r.requested_by = u.user_id
      ${whereSql}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const countStmt = await db.prepare(`
      SELECT COUNT(*) as total FROM requisitions r ${whereSql}
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
    console.error('Get requisitions error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/requisitions/:id
 * Get single requisition with items
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const reqStmt = await db.prepare(`
      SELECT r.*, u.name as requested_by_name, u.user_id as requested_by_uid
      FROM requisitions r
      LEFT JOIN users u ON r.requested_by = u.user_id
      WHERE r.id = ?
    `);

    const itemsStmt = await db.prepare(`
      SELECT ri.*, p.geo, p.description, p.name, p.unit
      FROM requisition_items ri
      JOIN products p ON ri.product_id = p.id
      WHERE ri.requisition_id = ?
      ORDER BY ri.id
    `);

    const [requisition, items] = await Promise.all([
      reqStmt.bind(req.params.id).first(),
      itemsStmt.bind(req.params.id).all()
    ]);

    if (!requisition) {
      return res.status(404).json({ status: 'error', message: 'Requisition not found' });
    }

    res.json({
      status: 'success',
      data: {
        ...requisition,
        items: items.results || items
      }
    });
  } catch (err) {
    console.error('Get requisition error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/requisitions
 * Create new requisition with items
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { site_id, priority, notes, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Requisition items are required' });
    }

    const db = req.app.locals.db;
    const requisitionId = uuidv4();
    const userId = req.user.userId;

    const insertReq = await db.prepare(`
      INSERT INTO requisitions (id, requisition_no, site_id, requested_by, priority, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    const countStmt = await db.prepare('SELECT COUNT(*) as count FROM requisitions');
    const countResult = await countStmt.first();
    const requisitionNo = `REQ-${String(countResult.count + 1).padStart(6, '0')}`;

    await insertReq.bind(requisitionId, requisitionNo, site_id, userId, priority || 'normal', notes || '').run();

    const insertItem = await db.prepare(`
      INSERT INTO requisition_items (requisition_id, product_id, quantity_requested, notes)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of items) {
      await insertItem.bind(requisitionId, item.product_id, item.quantity_requested, item.notes || '').run();
    }

    res.status(201).json({
      status: 'success',
      data: {
        id: requisitionId,
        requisition_no: requisitionNo
      },
      message: 'Requisition created successfully'
    });
  } catch (err) {
    console.error('Create requisition error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/requisitions/:id
 * Update requisition status
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const db = req.app.locals.db;

    const stmt = await db.prepare(`
      UPDATE requisitions
      SET status = COALESCE(?, status),
          notes = COALESCE(?, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    await stmt.bind(status || null, notes || null, req.params.id).run();

    res.json({
      status: 'success',
      message: 'Requisition updated successfully'
    });
  } catch (err) {
    console.error('Update requisition error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/requisitions/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('DELETE FROM requisitions WHERE id = ?');
    await stmt.bind(req.params.id).run();

    res.json({ status: 'success', message: 'Requisition deleted successfully' });
  } catch (err) {
    console.error('Delete requisition error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
