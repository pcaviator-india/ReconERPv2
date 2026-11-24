const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/v1/vehicles
 * List all active vehicles. Optional ?active=0 to include inactive.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { active } = req.query;

    let query = 'SELECT * FROM vehicles';
    const params = [];

    if (active !== undefined) {
      query += ' WHERE is_active = ?';
      params.push(active === '1' || active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY vehicle_number ASC';

    const stmt = await db.prepare(query);
    const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    let rows = result.results || result || [];

    if (!rows.length) {
      try {
        const mvStmt = await db.prepare('SELECT DISTINCT vehiculos FROM movement_val WHERE vehiculos IS NOT NULL AND TRIM(vehiculos) != "" ORDER BY vehiculos ASC');
        const mvResult = await mvStmt.all();
        const mvRows = mvResult.results || mvResult || [];
        if (mvRows.length > 0) {
          for (const r of mvRows) {
            const vNum = String(r.vehiculos).trim();
            const insStmt = await db.prepare('INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, is_active) VALUES (?, ?, ?, 1)');
            await insStmt.bind(vNum, 'Vehicle', vNum).run();
          }
          const refetch = await db.prepare(query);
          const refetchResult = params.length > 0 ? await refetch.bind(...params).all() : await refetch.all();
          rows = refetchResult.results || refetchResult || [];
        }
      } catch (mvErr) {
        console.warn('Fallback vehicle import warning:', mvErr.message);
      }
    }

    res.json({
      status: 'success',
      data: rows
    });
  } catch (err) {
    console.error('Get vehicles error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/vehicles/:id
 * Get a single vehicle by ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT * FROM vehicles WHERE id = ?');
    const result = await stmt.bind(parseInt(req.params.id, 10)).first();

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'Vehicle not found' });
    }

    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Get vehicle error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/vehicles
 * Create a new vehicle. Admin/Manager only.
 * Body: { vehicle_number, vehicle_type, license_plate, capacity_kg }
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    if (!user || !user.role) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    const role = String(user.role).toLowerCase();
    if (role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ status: 'error', message: 'Admin or Manager access required' });
    }

    const db = req.app.locals.db;
    const { vehicle_number, vehicle_type, license_plate, capacity_kg } = req.body;

    if (!vehicle_number) {
      return res.status(400).json({ status: 'error', message: 'vehicle_number is required' });
    }

    // Check duplicate
    const exists = await (await db.prepare('SELECT id FROM vehicles WHERE vehicle_number = ?')).bind(vehicle_number).first();
    if (exists) {
      return res.status(400).json({ status: 'error', message: 'Vehicle number already exists' });
    }

    const stmt = await db.prepare(`
      INSERT INTO vehicles (vehicle_number, vehicle_type, license_plate, capacity_kg, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);
    const result = await stmt.bind(
      vehicle_number,
      vehicle_type || '',
      license_plate || '',
      capacity_kg ? parseFloat(capacity_kg) : null
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    res.status(201).json({
      status: 'success',
      data: { id, vehicle_number },
      message: 'Vehicle registered successfully'
    });
  } catch (err) {
    console.error('Create vehicle error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/vehicles/:id
 * Update a vehicle. Admin/Manager only.
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    if (!user || !user.role) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    const role = String(user.role).toLowerCase();
    if (role !== 'admin' && role !== 'manager') {
      return res.status(403).json({ status: 'error', message: 'Admin or Manager access required' });
    }

    const db = req.app.locals.db;
    const { vehicle_type, license_plate, capacity_kg, is_active } = req.body;

    const existing = await (await db.prepare('SELECT id FROM vehicles WHERE id = ?')).bind(parseInt(req.params.id, 10)).first();
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Vehicle not found' });
    }

    const stmt = await db.prepare(`
      UPDATE vehicles
      SET vehicle_type = COALESCE(?, vehicle_type),
          license_plate = COALESCE(?, license_plate),
          capacity_kg = COALESCE(?, capacity_kg),
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    await stmt.bind(
      vehicle_type !== undefined ? vehicle_type : null,
      license_plate !== undefined ? license_plate : null,
      capacity_kg !== undefined ? (capacity_kg ? parseFloat(capacity_kg) : null) : null,
      is_active !== undefined ? (is_active === 1 || is_active === '1' || is_active === true ? 1 : 0) : null,
      parseInt(req.params.id, 10)
    ).run();

    res.json({ status: 'success', message: 'Vehicle updated successfully' });
  } catch (err) {
    console.error('Update vehicle error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;