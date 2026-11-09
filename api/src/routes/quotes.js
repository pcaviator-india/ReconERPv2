const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/quotes
 * Query params: status, requisition_id, page, limit
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { status, requisition_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = [];
    let params = [];

    if (status) {
      whereClauses.push('q.status = ?');
      params.push(status);
    }
    if (requisition_id) {
      whereClauses.push('q.requisition_id = ?');
      params.push(requisition_id);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const stmt = await db.prepare(`
      SELECT q.*, r.requisition_no, r.site as req_site, s.name as supplier_name, u.name as created_by_name,
             COALESCE((
               SELECT json_group_array(json_object(
                 'id', qi.id,
                 'quote_id', qi.quote_id,
                 'quote_no', q.quote_no,
                 'product_id', qi.product_id,
                 'sub_category', qi.sub_category,
                 'geo', qi.geo,
                 'pn', COALESCE(NULLIF(qi.pn, ''), p.pn, ri.pn),
                 'description_es', COALESCE(NULLIF(qi.description_es, ''), p.description_es, ri.description_es),
                 'description_en', qi.description_en,
                 'quantity', qi.quantity,
                 'approved_qty', qi.approved_qty,
                 'received_qty', qi.received_qty,
                 'unit_price', qi.unit_price,
                 'total_price', qi.total_price,
                 'discount_pct', qi.discount_pct,
                 'freight', qi.freight,
                 'supplier', qi.supplier,
                 'supplier_quote_no', COALESCE(NULLIF(qi.supplier_quote_no, ''), q.ref_cotiz),
                 'quoted_doc_url', COALESCE(NULLIF(qi.quoted_doc_url, ''), q.quoted_doc_url),
                 'currency', q.currency,
                 'exchange_rate', q.exchange_rate,
                 'status', COALESCE(NULLIF(qi.status, ''), q.status),
                 'category', qi.category,
                 'item_notes', COALESCE(ri.item_notes, ''),
                 'supplier_notes', COALESCE(ri.supplier_notes, ''),
                 'images', COALESCE(ri.images, ''),
                 'created_at', qi.created_at
               ))
               FROM quote_items qi
               LEFT JOIN products p ON p.geo = qi.geo
               LEFT JOIN requisition_items ri
                 ON ri.requisition_id = q.requisition_id AND ri.geo = qi.geo
               WHERE qi.quote_id = q.id
             ), '[]') as items_json
      FROM quotes q
      LEFT JOIN requisitions r ON q.requisition_id = r.id
      LEFT JOIN suppliers s ON q.supplier_id = s.id
      LEFT JOIN users u ON q.created_by = u.user_id
      ${whereSql}
      ORDER BY q.updated_at DESC, q.id DESC
      LIMIT ? OFFSET ?
    `);

    const countStmt = await db.prepare(`
      SELECT COUNT(*) as total FROM quotes q ${whereSql}
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
    console.error('Get quotes error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/quotes/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const quoteStmt = await db.prepare(`
      SELECT q.*, r.requisition_no, r.site as req_site, s.name as supplier_name, u.name as created_by_name
      FROM quotes q
      LEFT JOIN requisitions r ON q.requisition_id = r.id
      LEFT JOIN suppliers s ON q.supplier_id = s.id
      LEFT JOIN users u ON q.created_by = u.user_id
      WHERE q.id = ?
    `);

    const itemsStmt = await db.prepare(`
      SELECT qi.*, p.geo as product_geo, p.description as product_description, p.unit
      FROM quote_items qi
      LEFT JOIN products p ON qi.product_id = p.id
      WHERE qi.quote_id = ?
      ORDER BY qi.id
    `);

    const [quote, items] = await Promise.all([
      quoteStmt.bind(req.params.id).first(),
      itemsStmt.bind(req.params.id).all()
    ]);

    if (!quote) {
      return res.status(404).json({ status: 'error', message: 'Quote not found' });
    }

    res.json({
      status: 'success',
      data: {
        ...quote,
        items: items.results || items
      }
    });
  } catch (err) {
    console.error('Get quote error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/quotes
 * Create quote with items
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { requisition_id, supplier_id, notes, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Quote items are required' });
    }

    const db = req.app.locals.db;
    const quoteId = uuidv4();
    const userId = req.user.userId;

    const countStmt = await db.prepare('SELECT COUNT(*) as count FROM quotes');
    const countResult = await countStmt.first();
    const quoteNo = `QT-${String(countResult.count + 1).padStart(6, '0')}`;

    const insertQuote = await db.prepare(`
      INSERT INTO quotes (id, quote_no, requisition_id, supplier_id, created_by, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    await insertQuote.bind(quoteId, quoteNo, requisition_id || null, supplier_id || null, userId, notes || '').run();

    const insertItem = await db.prepare(`
      INSERT INTO quote_items (quote_id, product_id, quantity, unit_price, total_price, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      await insertItem.bind(
        quoteId,
        item.product_id,
        item.quantity,
        item.unit_price,
        item.total_price,
        item.status || 'Pending'
      ).run();
    }

    res.status(201).json({
      status: 'success',
      data: { id: quoteId, quote_no: quoteNo },
      message: 'Quote created successfully'
    });
  } catch (err) {
    console.error('Create quote error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/quotes/:id/status
 * Update quote status
 */
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const db = req.app.locals.db;

    const stmt = await db.prepare(`
      UPDATE quotes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);

    await stmt.bind(status, req.params.id).run();

    res.json({
      status: 'success',
      message: `Quote status updated to ${status}`
    });
  } catch (err) {
    console.error('Update quote status error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;