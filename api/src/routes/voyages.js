const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/voyages
 * List voyages with pagination and filters.
 * Query: page, limit, driver_id, status, from_site, to_site
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const {
      page = 1, limit = 50,
      driver_id, status, from_site, to_site, all_active
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = [];
    let params = [];

    const { user } = req;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';

    if (role === 'driver' && !(status === 'IN_PROGRESS' && (all_active === '1' || all_active === 'true'))) {
      const uId = String(user.userId || user.user_id || user.id || '');
      whereClauses.push('(v.driver_id = ? OR v.driver_id = ?)');
      params.push(uId, String(user.name || uId));
    } else if (driver_id) {
      whereClauses.push('v.driver_id = ?');
      params.push(driver_id);
    }
    if (status) {
      whereClauses.push('v.status = ?');
      params.push(status);
    }
    if (from_site) {
      whereClauses.push('v.from_site = ?');
      params.push(from_site);
    }
    if (to_site) {
      whereClauses.push('v.to_site = ?');
      params.push(to_site);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const stmt = await db.prepare(`
      SELECT v.*,
             ve.vehicle_number,
             COALESCE(p.name, u.name, v.driver_id) as driver_name
      FROM voyages v
      LEFT JOIN vehicles ve ON v.vehicle_id = ve.id
      LEFT JOIN people p ON v.driver_id = p.id
      LEFT JOIN users u ON v.driver_id = u.user_id
      ${whereSql}
      ORDER BY v.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const countStmt = await db.prepare(`SELECT COUNT(*) as total FROM voyages v ${whereSql}`);

    const [result, countResult] = await Promise.all([
      stmt.bind(...params, parseInt(limit), offset).all(),
      countStmt.bind(...params).first()
    ]);

    const rows = result.results || result || [];

    res.json({
      status: 'success',
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Get voyages error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/voyages/:id
 * Get a single voyage with its expenses and GPS points
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const voyageStmt = await db.prepare(`
      SELECT v.*,
             ve.vehicle_number,
             COALESCE(p.name, u.name, v.driver_id) as driver_name
      FROM voyages v
      LEFT JOIN vehicles ve ON v.vehicle_id = ve.id
      LEFT JOIN people p ON v.driver_id = p.id
      LEFT JOIN users u ON v.driver_id = u.user_id
      WHERE v.id = ?
    `);
    const voyage = await voyageStmt.bind(parseInt(req.params.id, 10)).first();

    if (!voyage) {
      return res.status(404).json({ status: 'error', message: 'Voyage not found' });
    }

    const { user } = req;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';
    if (role === 'driver' && voyage.status !== 'IN_PROGRESS') {
      const uId = String(user.userId || user.user_id || user.id || '');
      if (String(voyage.driver_id) !== uId && String(voyage.driver_id) !== String(user.name)) {
        return res.status(403).json({ status: 'error', message: 'Access denied: You can only view your own voyages' });
      }
    }

    const expensesStmt = await db.prepare(`
      SELECT * FROM voyage_expenses WHERE voyage_id = ? ORDER BY created_at ASC
    `);
    const expenses = await expensesStmt.bind(parseInt(req.params.id, 10)).all();
    const expenseRows = expenses.results || expenses || [];

    const gpsStmt = await db.prepare(`
      SELECT * FROM voyage_gps_points WHERE voyage_id = ? ORDER BY timestamp ASC
    `);
    const gps = await gpsStmt.bind(parseInt(req.params.id, 10)).all();
    const gpsRows = gps.results || gps || [];

    res.json({
      status: 'success',
      data: {
        ...voyage,
        expenses: expenseRows,
        gps_points: gpsRows
      }
    });
  } catch (err) {
    console.error('Get voyage error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/voyages
 * Start a new voyage.
 * Body: { from_site, to_site, vehicle_id, start_km, reason }
 * driver_id is taken from the authenticated user session
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { user } = req;
    if (!user || !user.userId) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }

    const { from_site, to_site, vehicle_id, start_km, reason, driver_id } = req.body;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';

    if (!from_site || !to_site) {
      return res.status(400).json({ status: 'error', message: 'from_site and to_site are required' });
    }

    if (!vehicle_id) {
      return res.status(400).json({ status: 'error', message: 'vehicle_id is required' });
    }

    if (!start_km) {
      return res.status(400).json({ status: 'error', message: 'start_km is required' });
    }

    // Verify vehicle exists
    const vehicle = await (await db.prepare('SELECT id FROM vehicles WHERE id = ? AND is_active = 1')).bind(parseInt(vehicle_id, 10)).first();
    if (!vehicle) {
      return res.status(400).json({ status: 'error', message: 'Vehicle not found or inactive' });
    }

    // Generate voyage number: VOY-YYYYMMDD-####
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `VOY-${dateStr}-`;
    const last = await (await db.prepare(`SELECT voyage_number FROM voyages WHERE voyage_number LIKE ? ORDER BY id DESC LIMIT 1`)).bind(`${prefix}%`).first();
    let seq = 1;
    if (last) {
      const match = String(last.voyage_number).match(/-(\d+)$/);
      if (match) seq = parseInt(match[1], 10) + 1;
    }
    const voyageNumber = `${prefix}${String(seq).padStart(4, '0')}`;
    const now = new Date().toISOString();

    const actualDriverId = (role === 'driver') ? (user.userId || user.id) : (driver_id || user.userId || user.id);

    const stmt = await db.prepare(`
      INSERT INTO voyages (voyage_number, from_site, to_site, vehicle_id, driver_id, start_km, reason, start_time, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?)
    `);
    const result = await stmt.bind(
      voyageNumber,
      from_site,
      to_site,
      parseInt(vehicle_id, 10),
      actualDriverId,
      parseInt(start_km, 10),
      reason || '',
      now,
      now,
      now
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    // Log tracking session start
    try {
      const sessionStmt = await db.prepare(`
        INSERT INTO voyage_tracking_sessions (voyage_id, wake_lock_active, pip_requested, browser_visibility_state, started_at)
        VALUES (?, 0, 0, 'visible', ?)
      `);
      await sessionStmt.bind(id, now).run();
    } catch (e) {
      // Non-fatal: session logging shouldn't block voyage creation
      console.warn('Tracking session log warning:', e.message);
    }

    res.status(201).json({
      status: 'success',
      data: { id, voyage_number: voyageNumber },
      message: 'Voyage started successfully'
    });
  } catch (err) {
    console.error('Create voyage error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/voyages/:id
 * End a voyage or update fields.
 * Body: { end_km, end_time, total_expenses, status }
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { end_km, end_time, total_expenses, status, expenses } = req.body;

    const existing = await (await db.prepare('SELECT id, status, driver_id, start_km FROM voyages WHERE id = ?')).bind(parseInt(req.params.id, 10)).first();
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Voyage not found' });
    }

    const { user } = req;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';
    if (role === 'driver') {
      const uId = String(user.userId || user.user_id || user.id || '');
      if (String(existing.driver_id) !== uId && String(existing.driver_id) !== String(user.name)) {
        return res.status(403).json({ status: 'error', message: 'Access denied: You can only update your own voyages' });
      }
    }

    // Insert detailed expenses if provided
    if (Array.isArray(expenses) && expenses.length > 0) {
      const expStmt = await db.prepare(`
        INSERT INTO voyage_expenses (voyage_id, expense_type, amount, description, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const exp of expenses) {
        if (exp && Number(exp.amount) > 0) {
          await expStmt.bind(
            parseInt(req.params.id, 10),
            exp.expense_type || 'other',
            parseFloat(exp.amount),
            exp.description || ''
          ).run();
        }
      }
    }

    // Determine final total expenses (from detailed expenses or provided lump-sum)
    let finalTotal = null;
    const totalRow = await (await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM voyage_expenses WHERE voyage_id = ?')).bind(parseInt(req.params.id, 10)).first();
    if (totalRow && totalRow.total > 0) {
      finalTotal = totalRow.total;
    } else if (total_expenses !== undefined && total_expenses !== null && total_expenses !== '') {
      finalTotal = parseFloat(total_expenses);
    }

    const stmt = await db.prepare(`
      UPDATE voyages
      SET end_km = COALESCE(?, end_km),
          end_time = COALESCE(?, end_time),
          total_expenses = COALESCE(?, total_expenses),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    await stmt.bind(
      end_km !== undefined ? (end_km ? parseInt(end_km, 10) : null) : null,
      end_time || null,
      finalTotal,
      status || null,
      parseInt(req.params.id, 10)
    ).run();

    // If ending voyage, end the tracking session
    if (status === 'COMPLETED') {
      try {
        const now = new Date().toISOString();
        await (await db.prepare(`
          UPDATE voyage_tracking_sessions
          SET ended_at = ?
          WHERE voyage_id = ? AND ended_at IS NULL
        `)).bind(now, parseInt(req.params.id, 10)).run();
      } catch (e) {
        console.warn('Tracking session end warning:', e.message);
      }
    }

    res.json({ status: 'success', message: 'Voyage updated successfully' });
  } catch (err) {
    console.error('Update voyage error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


/**
 * POST /api/v1/voyages/:id/gps
 * Upload a GPS breadcrumb point during an active voyage.
 * Body: { latitude, longitude, accuracy, speed, timestamp }
 */
router.post('/:id/gps', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { latitude, longitude, accuracy, speed, timestamp } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ status: 'error', message: 'latitude and longitude are required' });
    }

    const voyage = await (await db.prepare('SELECT id, status FROM voyages WHERE id = ?')).bind(parseInt(req.params.id, 10)).first();
    if (!voyage) {
      return res.status(404).json({ status: 'error', message: 'Voyage not found' });
    }

    const { user } = req;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';
    if (role === 'driver' && voyage.status !== 'IN_PROGRESS') {
      const uId = String(user.userId || user.user_id || user.id || '');
      if (String(voyage.driver_id) !== uId && String(voyage.driver_id) !== String(user.name)) {
        return res.status(403).json({ status: 'error', message: 'Access denied: You can only view your own voyages' });
      }
    }

    const stmt = await db.prepare(`
      INSERT INTO voyage_gps_points (voyage_id, latitude, longitude, accuracy, speed, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = await stmt.bind(
      parseInt(req.params.id, 10),
      parseFloat(latitude),
      parseFloat(longitude),
      accuracy ? parseFloat(accuracy) : null,
      speed ? parseFloat(speed) : null,
      timestamp || new Date().toISOString()
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    res.status(201).json({
      status: 'success',
      data: { id },
      message: 'GPS point recorded'
    });
  } catch (err) {
    console.error('GPS point error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/voyages/:id/gps
 * Get all GPS points for a voyage (for map polyline)
 */
router.get('/:id/gps', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare(`
      SELECT * FROM voyage_gps_points WHERE voyage_id = ? ORDER BY timestamp ASC
    `);
    const result = await stmt.bind(parseInt(req.params.id, 10)).all();
    const rows = result.results || result || [];

    res.json({
      status: 'success',
      data: rows
    });
  } catch (err) {
    console.error('Get GPS points error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/voyages/:id/expenses
 * Add an expense line to a voyage.
 * Body: { expense_type, amount, description, receipt_url }
 */
router.post('/:id/expenses', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { expense_type, amount, description, receipt_url } = req.body;

    if (!expense_type) {
      return res.status(400).json({ status: 'error', message: 'expense_type is required' });
    }

    if (!amount) {
      return res.status(400).json({ status: 'error', message: 'amount is required' });
    }

    const voyage = await (await db.prepare('SELECT id FROM voyages WHERE id = ?')).bind(parseInt(req.params.id, 10)).first();
    if (!voyage) {
      return res.status(404).json({ status: 'error', message: 'Voyage not found' });
    }

    const { user } = req;
    const role = user && user.role ? String(user.role).toLowerCase() : 'user';
    if (role === 'driver' && voyage.status !== 'IN_PROGRESS') {
      const uId = String(user.userId || user.user_id || user.id || '');
      if (String(voyage.driver_id) !== uId && String(voyage.driver_id) !== String(user.name)) {
        return res.status(403).json({ status: 'error', message: 'Access denied: You can only view your own voyages' });
      }
    }

    const stmt = await db.prepare(`
      INSERT INTO voyage_expenses (voyage_id, expense_type, amount, description, receipt_url)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = await stmt.bind(
      parseInt(req.params.id, 10),
      expense_type,
      parseFloat(amount),
      description || '',
      receipt_url || null
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    // Update voyage total_expenses
    try {
      const total = await (await db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM voyage_expenses WHERE voyage_id = ?`)).bind(parseInt(req.params.id, 10)).first();
      await (await db.prepare(`UPDATE voyages SET total_expenses = ? WHERE id = ?`)).bind(Number(total.total) || 0, parseInt(req.params.id, 10)).run();
    } catch (e) {
      console.warn('Expense total update warning:', e.message);
    }

    res.status(201).json({
      status: 'success',
      data: { id },
      message: 'Expense added'
    });
  } catch (err) {
    console.error('Add expense error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/voyages/:id/expenses
 * List expenses for a voyage
 */
router.get('/:id/expenses', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare(`SELECT * FROM voyage_expenses WHERE voyage_id = ? ORDER BY created_at ASC`);
    const result = await stmt.bind(parseInt(req.params.id, 10)).all();
    const rows = result.results || result || [];

    res.json({
      status: 'success',
      data: rows
    });
  } catch (err) {
    console.error('Get expenses error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;