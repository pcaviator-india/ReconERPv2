const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

function applySiteFilter(whereClauses, params, siteFilter) {
  if (siteFilter) {
    whereClauses.push('(st.from_site_id = ? OR st.to_site_id = ?)');
    params.push(siteFilter, siteFilter);
  }
}

router.get('/', authenticateToken, requirePermission('site_transfer', 'view'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const {
      site, status, from_date, to_date, despatch_no, search,
      page = 1, limit = 50
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = [];
    let params = [];

    if (req.siteFilter) {
      applySiteFilter(whereClauses, params, req.siteFilter);
    }

    if (site) {
      whereClauses.push('(st.from_site_id = ? OR st.to_site_id = ?)');
      params.push(site, site);
    }
    if (status) {
      whereClauses.push('st.status = ?');
      params.push(status);
    }
    if (from_date) {
      whereClauses.push('st.created_at >= ?');
      params.push(from_date);
    }
    if (to_date) {
      whereClauses.push('st.created_at <= ?');
      params.push(to_date);
    }
    if (despatch_no) {
      whereClauses.push('st.despatch_no = ?');
      params.push(despatch_no);
    }
    if (search) {
      whereClauses.push('(st.transfer_no LIKE ? OR st.despatch_no LIKE ? OR st.notes LIKE ?)');
      params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const stmt = await db.prepare(
      'SELECT st.*, ' +
      'fs.name as from_site_name, fs.code as from_site_code, ' +
      'ts.name as to_site_name, ts.code as to_site_code, ' +
      'p.name as driver_name, ' +
      'v.vehicle_number, ' +
      'u.name as created_by_name, ' +
      'ru.name as received_by_name, ' +
      '(SELECT COUNT(*) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as item_count, ' +
      '(SELECT COALESCE(SUM(sti.quantity_sent),0) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as total_sent, ' +
      '(SELECT COALESCE(SUM(sti.quantity_received),0) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as total_received ' +
      'FROM site_transfers st ' +
      'JOIN sites fs ON st.from_site_id = fs.id ' +
      'JOIN sites ts ON st.to_site_id = ts.id ' +
      'LEFT JOIN people p ON st.driver_id = p.id ' +
      'LEFT JOIN vehicles v ON st.vehicle_id = v.id ' +
      'LEFT JOIN users u ON st.created_by = u.user_id ' +
      'LEFT JOIN users ru ON st.received_by = ru.user_id ' +
      whereSql +
      ' ORDER BY st.created_at DESC LIMIT ? OFFSET ?'
    );

    const countStmt = await db.prepare(
      'SELECT COUNT(*) as total FROM site_transfers st ' + whereSql
    );

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
    console.error('Get site transfers error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.get('/:id', authenticateToken, requirePermission('site_transfer', 'view'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    const transferStmt = await db.prepare(
      'SELECT st.*, ' +
      'fs.name as from_site_name, fs.code as from_site_code, ' +
      'ts.name as to_site_name, ts.code as to_site_code, ' +
      'p.name as driver_name, ' +
      'v.vehicle_number, ' +
      'u.name as created_by_name, ' +
      'ru.name as received_by_name, ' +
      '(SELECT COUNT(*) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as item_count, ' +
      '(SELECT COALESCE(SUM(sti.quantity_sent),0) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as total_sent, ' +
      '(SELECT COALESCE(SUM(sti.quantity_received),0) FROM site_transfer_items sti WHERE sti.transfer_id = st.id) as total_received ' +
      'FROM site_transfers st ' +
      'JOIN sites fs ON st.from_site_id = fs.id ' +
      'JOIN sites ts ON st.to_site_id = ts.id ' +
      'LEFT JOIN people p ON st.driver_id = p.id ' +
      'LEFT JOIN vehicles v ON st.vehicle_id = v.id ' +
      'LEFT JOIN users u ON st.created_by = u.user_id ' +
      'LEFT JOIN users ru ON st.received_by = ru.user_id ' +
      'WHERE st.id = ?'
    );

    const transfer = await transferStmt.bind(req.params.id).first();

    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (req.siteFilter && transfer.from_site_id !== req.siteFilter && transfer.to_site_id !== req.siteFilter) {
      return res.status(403).json({ status: 'error', message: 'Access denied to this transfer' });
    }

    const itemsStmt = await db.prepare(
      'SELECT sti.*, ' +
      'p.geo, p.name as product_name, p.description, p.description_es, p.unit ' +
      'FROM site_transfer_items sti ' +
      'JOIN products p ON sti.item_id = p.id ' +
      'WHERE sti.transfer_id = ? ' +
      'ORDER BY sti.created_at ASC'
    );

    const items = await itemsStmt.bind(req.params.id).all();

    res.json({
      status: 'success',
      data: Object.assign({}, transfer, { items: items.results || items || [] })
    });
  } catch (err) {
    console.error('Get site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user.userId;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const {
      from_site_id, to_site_id, driver_id, vehicle_id, despatch_no, notes, items
    } = req.body;

    // Coerce scalar inputs to SQLite-safe primitives so a client sending
    // non-primitive values (objects, undefined, etc.) cannot cause a
    // datatype mismatch when the values are bound to typed columns.
    const fromSiteId = Number.parseInt(from_site_id, 10) || null;
    const toSiteId = Number.parseInt(to_site_id, 10) || null;
    const safeDriverId = driver_id == null
      ? null
      : (driver_id && typeof driver_id === 'object' && driver_id.id != null
          ? String(driver_id.id)
          : String(driver_id));
    const safeVehicleId = vehicle_id == null ? null : (Number.parseInt(vehicle_id, 10) || null);
    const safeDespatchNo = despatch_no == null ? '' : String(despatch_no);
    const safeNotes = notes == null ? '' : String(notes);

    if (!fromSiteId || !toSiteId || !safeDespatchNo) {
      return res.status(400).json({ status: 'error', message: 'from_site_id, to_site_id, and despatch_no are required' });
    }

    if (String(fromSiteId) === String(toSiteId)) {
      return res.status(400).json({ status: 'error', message: 'From site and to site must be different' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'error', message: 'At least one item is required' });
    }

    if (userRole === 'user' && userSite && String(fromSiteId) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Users can only create transfers from their own site' });
    }

    const existing = await db.prepare('SELECT id FROM site_transfers WHERE despatch_no = ?').bind(safeDespatchNo).first();
    if (existing) {
      return res.status(400).json({ status: 'error', message: 'Despatch No "' + despatch_no + '" already exists' });
    }

    const fromSite = await db.prepare('SELECT id FROM sites WHERE id = ? AND active = 1').bind(fromSiteId).first();
    const toSite = await db.prepare('SELECT id FROM sites WHERE id = ? AND active = 1').bind(toSiteId).first();
    if (!fromSite || !toSite) {
      return res.status(400).json({ status: 'error', message: 'Invalid from_site_id or to_site_id' });
    }

    if (driver_id) {
      const driver = await db.prepare('SELECT id FROM people WHERE id = ? AND active = 1').bind(safeDriverId).first();
      if (!driver) {
        return res.status(400).json({ status: 'error', message: 'Invalid driver_id' });
      }
    }

    if (vehicle_id) {
      const vehicle = await db.prepare('SELECT id FROM vehicles WHERE id = ? AND is_active = 1').bind(safeVehicleId).first();
      if (!vehicle) {
        return res.status(400).json({ status: 'error', message: 'Invalid vehicle_id' });
      }
    }

    const transferNo = 'TRF-' + uuidv4().slice(0, 8).toUpperCase();

    const insertTransfer = await db.prepare(
      'INSERT INTO site_transfers ' +
      '(transfer_no, from_site_id, to_site_id, driver_id, vehicle_id, despatch_no, status, created_by, notes) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const transferResult = await insertTransfer.bind(
      transferNo, fromSiteId, toSiteId,
      safeDriverId, safeVehicleId, safeDespatchNo, 'draft', userId, safeNotes
    ).run();
    const transferId = transferResult.meta.last_row_id;

    const insertItem = await db.prepare(
      'INSERT INTO site_transfer_items ' +
      '(transfer_id, item_id, stock_id, quantity_sent, quantity_received, quantity_discrepancy, unit_cost, notes) ' +
      'VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    );

    for (const item of items) {
      if (!item.item_id || !item.quantity_sent || item.quantity_sent <= 0) {
        return res.status(400).json({ status: 'error', message: 'Each item must have item_id and quantity_sent > 0' });
      }
      await insertItem.bind(
        transferId,
        Number.parseInt(item.item_id, 10) || null,
        item.stock_id == null ? null : (Number.parseInt(item.stock_id, 10) || null),
        Number.parseInt(item.quantity_sent, 10) || null,
        Number.parseFloat(item.unit_cost) || 0,
        item.notes == null ? '' : String(item.notes)
      ).run();
    }

    res.status(201).json({
      status: 'success',
      data: { id: transferId, transfer_no: transferNo, despatch_no: despatch_no, status: 'draft' },
      message: 'Transfer draft created successfully'
    });
  } catch (err) {
    console.error('Create site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const transfer = await db.prepare('SELECT * FROM site_transfers WHERE id = ?').bind(req.params.id).first();
    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (transfer.status !== 'draft') {
      return res.status(400).json({ status: 'error', message: 'Only draft transfers can be updated' });
    }

    if (userRole === 'user' && userSite && String(transfer.from_site_id) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const { to_site_id, driver_id, vehicle_id, despatch_no, notes } = req.body;

    const updateFields = [];
    const updateParams = [];

    if (to_site_id !== undefined) {
      if (String(to_site_id) === String(transfer.from_site_id)) {
        return res.status(400).json({ status: 'error', message: 'From site and to site must be different' });
      }
      updateFields.push('to_site_id = ?');
      updateParams.push(to_site_id);
    }
    if (driver_id !== undefined) {
      updateFields.push('driver_id = ?');
      updateParams.push(driver_id || null);
    }
    if (vehicle_id !== undefined) {
      updateFields.push('vehicle_id = ?');
      updateParams.push(vehicle_id || null);
    }
    if (despatch_no !== undefined) {
      if (despatch_no !== transfer.despatch_no) {
        const existing = await db.prepare('SELECT id FROM site_transfers WHERE despatch_no = ? AND id != ?').bind(despatch_no, req.params.id).first();
        if (existing) {
          return res.status(400).json({ status: 'error', message: 'Despatch No "' + despatch_no + '" already exists' });
        }
      }
      updateFields.push('despatch_no = ?');
      updateParams.push(despatch_no);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateParams.push(notes || '');
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No fields to update' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(req.params.id);

    await db.prepare(
      'UPDATE site_transfers SET ' + updateFields.join(', ') + ' WHERE id = ?'
    ).bind(...updateParams).run();

    res.json({ status: 'success', message: 'Transfer updated successfully' });
  } catch (err) {
    console.error('Update site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const transfer = await db.prepare('SELECT * FROM site_transfers WHERE id = ?').bind(req.params.id).first();
    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (transfer.status !== 'draft') {
      return res.status(400).json({ status: 'error', message: 'Only draft transfers can be deleted' });
    }

    if (userRole === 'user' && userSite && String(transfer.from_site_id) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    await db.prepare('DELETE FROM site_transfer_items WHERE transfer_id = ?').bind(req.params.id).run();
    await db.prepare('DELETE FROM site_transfers WHERE id = ?').bind(req.params.id).run();

    res.json({ status: 'success', message: 'Transfer deleted successfully' });
  } catch (err) {
    console.error('Delete site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/:id/despatch', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user.userId;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const transfer = await db.prepare('SELECT * FROM site_transfers WHERE id = ?').bind(req.params.id).first();
    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (transfer.status !== 'draft') {
      return res.status(400).json({ status: 'error', message: 'Only draft transfers can be despatched' });
    }

    if (userRole === 'user' && userSite && String(transfer.from_site_id) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const { start_date } = req.body;
    const despatchDate = start_date || new Date().toISOString();

    const items = await db.prepare('SELECT * FROM site_transfer_items WHERE transfer_id = ?').bind(req.params.id).all();
    const itemList = items.results || items || [];

    for (const item of itemList) {
      // Items added "without stock" (stock_id null) have no source stock record
      // to validate against — skip stock checks for them.
      if (item.stock_id == null) continue;

      const stock = await db.prepare(
        'SELECT id, quantity FROM stock WHERE id = ? AND site_id = ? AND is_active = 1'
      ).bind(item.stock_id, transfer.from_site_id).first();

      if (!stock) {
        return res.status(400).json({
          status: 'error',
          message: 'Source stock not found for item ' + item.item_id + ' at from site'
        });
      }

      if (stock.quantity < item.quantity_sent) {
        return res.status(400).json({
          status: 'error',
          message: 'Insufficient stock for item ' + item.item_id + '. Available: ' + stock.quantity + ', Required: ' + item.quantity_sent
        });
      }
    }

    for (const item of itemList) {
      // Skip decrementing stock for items that have no source stock record.
      if (item.stock_id == null) continue;

      await db.prepare(
        'UPDATE stock SET quantity = quantity - ?, available_qty = available_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(item.quantity_sent, item.quantity_sent, item.stock_id).run();

      await db.prepare(
        'INSERT INTO stock_ledger ' +
        '(item_id, location_type, location_id, qty_change, transaction_type, reference_id, reference_type, comments, user_name, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        item.item_id, 'site', transfer.from_site_id, -item.quantity_sent,
        'transfer_out', req.params.id, 'site_transfer',
        'Transfer out to site ' + transfer.to_site_id, userId, despatchDate
      ).run();

      await db.prepare(
        'INSERT INTO inventory_movements ' +
        '(movement_id, type, item_id, stock_id, quantity, site_id, performed_by, notes, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        uuidv4(), 'transfer_out', item.item_id, item.stock_id, item.quantity_sent,
        transfer.from_site_id, userId,
        'Transfer out - despatch ' + transfer.transfer_no, despatchDate
      ).run();
    }

    await db.prepare(
      'UPDATE site_transfers SET status = ?, start_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('despatched', despatchDate, req.params.id).run();

    res.json({
      status: 'success',
      message: 'Transfer despatched successfully. Source stock decremented.'
    });
  } catch (err) {
    console.error('Despatch site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/:id/receive', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user.userId;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const transfer = await db.prepare('SELECT * FROM site_transfers WHERE id = ?').bind(req.params.id).first();
    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (transfer.status === 'received') {
      return res.status(400).json({ status: 'error', message: 'Transfer already received' });
    }

    if (transfer.status === 'cancelled') {
      return res.status(400).json({ status: 'error', message: 'Cannot receive a cancelled transfer' });
    }

    if (userRole === 'user' && userSite && String(transfer.to_site_id) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const { items: receivedItems, received_by } = req.body;
    const receiveDate = new Date().toISOString();

    const items = await db.prepare('SELECT * FROM site_transfer_items WHERE transfer_id = ?').bind(req.params.id).all();
    const itemList = items.results || items || [];

    if (itemList.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Transfer has no items' });
    }

    const receivedMap = {};
    if (receivedItems && Array.isArray(receivedItems)) {
      for (const ri of receivedItems) {
        receivedMap[ri.id] = ri.quantity_received;
      }
    }

    let totalSent = 0;
    let totalReceived = 0;

    for (const item of itemList) {
      totalSent += item.quantity_sent;

      const qtyReceived = receivedMap[item.id] !== undefined
        ? parseInt(receivedMap[item.id], 10)
        : item.quantity_sent;

      if (qtyReceived < 0 || qtyReceived > item.quantity_sent) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid received quantity for item ' + item.item_id + '. Must be between 0 and ' + item.quantity_sent
        });
      }

      const discrepancy = item.quantity_sent - qtyReceived;
      totalReceived += qtyReceived;

      await db.prepare(
        'UPDATE site_transfer_items SET quantity_received = ?, quantity_discrepancy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(qtyReceived, discrepancy, item.id).run();

      if (qtyReceived > 0) {
        const destStock = await db.prepare(
          'SELECT id, quantity FROM stock WHERE item_id = ? AND site_id = ? AND is_active = 1'
        ).bind(item.item_id, transfer.to_site_id).first();

        if (destStock) {
          await db.prepare(
            'UPDATE stock SET quantity = quantity + ?, available_qty = available_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(qtyReceived, qtyReceived, destStock.id).run();
        } else {
          const product = await db.prepare('SELECT name FROM products WHERE id = ?').bind(item.item_id).first();
          await db.prepare(
            'INSERT INTO stock (item_id, site_id, product_name, quantity, available_qty, is_active, last_updated, updated_by, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)'
          ).bind(
            item.item_id, transfer.to_site_id, product ? product.name : '',
            qtyReceived, qtyReceived, userId
          ).run();
        }

        await db.prepare(
          'INSERT INTO stock_ledger ' +
          '(item_id, location_type, location_id, qty_change, transaction_type, reference_id, reference_type, comments, user_name, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          item.item_id, 'site', transfer.to_site_id, qtyReceived,
          'transfer_in', req.params.id, 'site_transfer',
          'Transfer in from site ' + transfer.from_site_id, userId, receiveDate
        ).run();

        await db.prepare(
          'INSERT INTO inventory_movements ' +
          '(movement_id, type, item_id, stock_id, quantity, site_id, performed_by, notes, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          uuidv4(), 'transfer_in', item.item_id,
          destStock ? destStock.id : null, qtyReceived, transfer.to_site_id, userId,
          'Transfer in - receive ' + transfer.transfer_no, receiveDate
        ).run();
      }
    }

    await db.prepare(
      'UPDATE site_transfers SET status = ?, finish_date = ?, received_at = ?, received_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('received', receiveDate, receiveDate, received_by || userId, req.params.id).run();

    res.json({
      status: 'success',
      message: 'Transfer received. Sent: ' + totalSent + ', Received: ' + totalReceived + ', Discrepancy: ' + (totalSent - totalReceived),
      data: {
        total_sent: totalSent,
        total_received: totalReceived,
        total_discrepancy: totalSent - totalReceived,
        status: 'received'
      }
    });
  } catch (err) {
    console.error('Receive site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/:id/cancel', authenticateToken, requirePermission('site_transfer', 'edit'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userRole = String(req.user.role).toLowerCase();
    const userSite = req.user.site;

    const transfer = await db.prepare('SELECT * FROM site_transfers WHERE id = ?').bind(req.params.id).first();
    if (!transfer) {
      return res.status(404).json({ status: 'error', message: 'Transfer not found' });
    }

    if (transfer.status === 'cancelled') {
      return res.status(400).json({ status: 'error', message: 'Transfer already cancelled' });
    }

    if (transfer.status === 'received') {
      return res.status(400).json({ status: 'error', message: 'Cannot cancel a received transfer' });
    }

    if (userRole === 'user' && userSite && String(transfer.from_site_id) !== userSite) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    if (transfer.status === 'despatched' || transfer.status === 'in_transit') {
      const items = await db.prepare('SELECT * FROM site_transfer_items WHERE transfer_id = ?').bind(req.params.id).all();
      const itemList = items.results || items || [];

      for (const item of itemList) {
        const qtyNotReceived = item.quantity_sent - item.quantity_received;
        if (qtyNotReceived > 0 && item.stock_id) {
          await db.prepare(
            'UPDATE stock SET quantity = quantity + ?, available_qty = available_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(qtyNotReceived, qtyNotReceived, item.stock_id).run();

          await db.prepare(
            'INSERT INTO stock_ledger ' +
            '(item_id, location_type, location_id, qty_change, transaction_type, reference_id, reference_type, comments, user_name, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
          ).bind(
            item.item_id, 'site', transfer.from_site_id, qtyNotReceived,
            'transfer_cancel', req.params.id, 'site_transfer',
            'Transfer cancelled - stock released', req.user.name || req.user.userId
          ).run();
        }
      }
    }

    await db.prepare(
      'UPDATE site_transfers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('cancelled', req.params.id).run();

    res.json({ status: 'success', message: 'Transfer cancelled successfully' });
  } catch (err) {
    console.error('Cancel site transfer error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;