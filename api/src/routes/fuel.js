const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * Helper to check if user has manager or admin rights
 */
function isElevated(user) {
  if (!user || !user.role) return false;
  const r = String(user.role).toLowerCase();
  return r === 'admin' || r === 'manager';
}

/**
 * GET /api/v1/fuel/tanks
 * Returns all mochilas (fuel tanks) with calculated balance and capacity.
 * Enforces site isolation: standard site users only see mochilas for their own site.
 */
router.get('/tanks', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const { site } = req.query;

    let query = `
      SELECT t.id, t.site, t.tank_code, t.name, t.capacity_liters, t.fuel_type, t.is_active,
             t.created_at, t.updated_at,
             COALESCE((SELECT SUM(litros) FROM fuel_purchases WHERE tank_id = t.id), 0) AS total_bought,
             COALESCE((SELECT SUM(liters) FROM fuel_entries WHERE tank_id = t.id), 0) AS total_used,
             (COALESCE((SELECT SUM(litros) FROM fuel_purchases WHERE tank_id = t.id), 0) -
              COALESCE((SELECT SUM(liters) FROM fuel_entries WHERE tank_id = t.id), 0)) AS balance
      FROM fuel_tanks t
    `;

    const whereClauses = [];
    const params = [];

    if (!elevated) {
      // Strictly enforce user's site
      whereClauses.push('t.site = ?');
      params.push(userSite || 'Store');
      whereClauses.push('t.is_active = 1');
    } else {
      if (site) {
        whereClauses.push('t.site = ?');
        params.push(site);
      }
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ' ORDER BY t.site ASC, t.id ASC';

    const stmt = await db.prepare(query);
    const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    const rows = result.results || result || [];

    const tanks = rows.map(r => ({
      ...r,
      capacity_liters: Number(r.capacity_liters) || 0,
      total_bought: Number(r.total_bought) || 0,
      total_used: Number(r.total_used) || 0,
      balance: Number(r.balance) || 0,
      percentage: (Number(r.capacity_liters) > 0)
        ? Math.min(100, Math.max(0, Math.round((Number(r.balance) / Number(r.capacity_liters)) * 100)))
        : 0
    }));

    res.json({
      status: 'success',
      data: tanks,
      user_site: elevated ? null : userSite
    });
  } catch (err) {
    console.error('Error fetching fuel tanks:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/fuel/tanks
 * Creates a new mochila. Admin / Manager only.
 */
router.post('/tanks', authenticateToken, async (req, res) => {
  try {
    if (!isElevated(req.user)) {
      return res.status(403).json({ status: 'error', message: 'Admin or Manager access required to register Mochilas' });
    }

    const db = req.app.locals.db;
    const { site, tank_code, name, capacity_liters, fuel_type } = req.body;

    if (!site || !tank_code || !name) {
      return res.status(400).json({ status: 'error', message: 'site, tank_code, and name are required' });
    }

    const cap = parseFloat(capacity_liters) || 0;
    const type = fuel_type || 'Diesel';

    const stmt = await db.prepare(`
      INSERT INTO fuel_tanks (site, tank_code, name, capacity_liters, fuel_type, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    const result = await stmt.bind(site.trim(), tank_code.trim(), name.trim(), cap, type).run();
    const newId = (result && result.meta && result.meta.last_row_id) || null;

    res.json({
      status: 'success',
      data: {
        id: newId,
        site,
        tank_code,
        name,
        capacity_liters: cap,
        fuel_type: type,
        balance: 0
      },
      message: 'Mochila registrada exitosamente'
    });
  } catch (err) {
    console.error('Error creating fuel tank:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PUT /api/v1/fuel/tanks/:id
 * Updates an existing mochila. Admin / Manager only.
 */
router.put('/tanks/:id', authenticateToken, async (req, res) => {
  try {
    if (!isElevated(req.user)) {
      return res.status(403).json({ status: 'error', message: 'Admin or Manager access required to update Mochilas' });
    }

    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const { site, tank_code, name, capacity_liters, fuel_type, is_active } = req.body;

    const existing = await (await db.prepare('SELECT id FROM fuel_tanks WHERE id = ?')).bind(id).first();
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Mochila no encontrada' });
    }

    const updates = [];
    const params = [];

    if (site !== undefined) { updates.push('site = ?'); params.push(site.trim()); }
    if (tank_code !== undefined) { updates.push('tank_code = ?'); params.push(tank_code.trim()); }
    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (capacity_liters !== undefined) { updates.push('capacity_liters = ?'); params.push(parseFloat(capacity_liters) || 0); }
    if (fuel_type !== undefined) { updates.push('fuel_type = ?'); params.push(fuel_type.trim()); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await (await db.prepare(`UPDATE fuel_tanks SET ${updates.join(', ')} WHERE id = ?`)).bind(...params).run();

    res.json({ status: 'success', message: 'Mochila actualizada exitosamente' });
  } catch (err) {
    console.error('Error updating fuel tank:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/fuel/balance
 * Returns fuel balance. If tank_id provided, returns that tank's balance.
 * Enforces site permissions.
 */
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const { tank_id, site } = req.query;

    let targetTankId = tank_id ? parseInt(tank_id, 10) : null;

    if (targetTankId) {
      const tank = await (await db.prepare('SELECT id, site, name, capacity_liters FROM fuel_tanks WHERE id = ?')).bind(targetTankId).first();
      if (!tank) {
        return res.status(404).json({ status: 'error', message: 'Mochila no encontrada' });
      }
      if (!elevated && tank.site !== userSite) {
        return res.status(403).json({ status: 'error', message: 'No tiene acceso a las mochilas de este sitio' });
      }

      const bought = await (await db.prepare('SELECT COALESCE(SUM(litros), 0) AS total FROM fuel_purchases WHERE tank_id = ?')).bind(targetTankId).first();
      const used = await (await db.prepare('SELECT COALESCE(SUM(liters), 0) AS total FROM fuel_entries WHERE tank_id = ?')).bind(targetTankId).first();

      const totalBought = Number(bought && bought.total) || 0;
      const totalUsed = Number(used && used.total) || 0;
      const balance = totalBought - totalUsed;
      const cap = Number(tank.capacity_liters) || 0;

      return res.json({
        status: 'success',
        data: {
          tank_id: tank.id,
          tank_name: tank.name,
          site: tank.site,
          capacity_liters: cap,
          totalBought,
          totalUsed,
          balance,
          percentage: cap > 0 ? Math.min(100, Math.max(0, Math.round((balance / cap) * 100))) : 0
        }
      });
    }

    // Site-level balance
    const targetSite = elevated ? (site || null) : userSite;
    let bQuery = 'SELECT COALESCE(SUM(litros), 0) AS total FROM fuel_purchases';
    let uQuery = 'SELECT COALESCE(SUM(liters), 0) AS total FROM fuel_entries';
    const params = [];

    if (targetSite) {
      bQuery += ' WHERE site = ?';
      uQuery += ' WHERE site = ?';
      params.push(targetSite);
    }

    const boughtStmt = await db.prepare(bQuery);
    const usedStmt = await db.prepare(uQuery);

    const bought = params.length > 0 ? await boughtStmt.bind(...params).first() : await boughtStmt.first();
    const used = params.length > 0 ? await usedStmt.bind(...params).first() : await usedStmt.first();

    const totalBought = Number(bought && bought.total) || 0;
    const totalUsed = Number(used && used.total) || 0;

    res.json({
      status: 'success',
      data: {
        site: targetSite || 'Global',
        totalBought,
        totalUsed,
        balance: totalBought - totalUsed
      }
    });
  } catch (err) {
    console.error('Error getting fuel balance:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/fuel/history
 * Returns fuel consumption entries.
 */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const { tank_id, site, limit = 100 } = req.query;

    let query = `
      SELECT e.id, e.tank_id, e.site, e.entry_date, e.proyecto, e.tipo_activo,
             e.asset_id, e.liters, e.odometer_km, e.driver, e.user_email, e.vehicle, e.cost,
             t.name AS tank_name, t.tank_code
      FROM fuel_entries e
      LEFT JOIN fuel_tanks t ON e.tank_id = t.id
    `;

    const whereClauses = [];
    const params = [];

    if (!elevated) {
      whereClauses.push('e.site = ?');
      params.push(userSite || 'Store');
    } else if (site) {
      whereClauses.push('e.site = ?');
      params.push(site);
    }

    if (tank_id) {
      whereClauses.push('e.tank_id = ?');
      params.push(parseInt(tank_id, 10));
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ' ORDER BY e.entry_date DESC, e.id DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 100);

    const stmt = await db.prepare(query);
    const result = await stmt.bind(...params).all();
    const rows = result.results || result || [];

    // Map positional format compatible with existing frontend table
    const formatted = rows.map(r => {
      let raw = String(r.entry_date || '').trim();
      let iso = raw;
      if (raw) {
        let d = new Date(raw.replace(' ', 'T'));
        if (!isNaN(d.getTime())) iso = d.toISOString();
      }
      return [
        iso,
        r.proyecto || '',
        r.tipo_activo || '',
        r.asset_id || '',
        Number(r.liters) || 0,
        r.odometer_km !== null ? Number(r.odometer_km) : '',
        r.driver || '',
        r.user_email || '',
        r.tank_name || ('Mochila ' + (r.tank_id || '1')),
        r.id
      ];
    });

    res.json({
      status: 'success',
      data: formatted,
      raw: rows
    });
  } catch (err) {
    console.error('Error getting fuel history:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/fuel/purchases
 * Returns fuel purchase/reception history.
 */
router.get('/purchases', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const { tank_id, site, limit = 100 } = req.query;

    let query = `
      SELECT p.id, p.tank_id, p.site, p.purchase_date, p.proveedor, p.litros, p.factura, p.user_name,
             t.name AS tank_name, t.tank_code
      FROM fuel_purchases p
      LEFT JOIN fuel_tanks t ON p.tank_id = t.id
    `;

    const whereClauses = [];
    const params = [];

    if (!elevated) {
      whereClauses.push('p.site = ?');
      params.push(userSite || 'Store');
    } else if (site) {
      whereClauses.push('p.site = ?');
      params.push(site);
    }

    if (tank_id) {
      whereClauses.push('p.tank_id = ?');
      params.push(parseInt(tank_id, 10));
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ' ORDER BY p.purchase_date DESC, p.id DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 100);

    const stmt = await db.prepare(query);
    const result = await stmt.bind(...params).all();
    const rows = result.results || result || [];

    const formatted = rows.map(x => {
      let raw = String(x.purchase_date || '').trim();
      let iso = raw;
      if (raw) {
        let d = new Date(raw.replace(' ', 'T'));
        if (!isNaN(d.getTime())) iso = d.toISOString();
      }
      return [
        iso,
        x.proveedor || '',
        Number(x.litros) || 0,
        x.factura || '',
        x.user_name || '',
        x.tank_name || ('Mochila ' + (x.tank_id || '1')),
        x.id
      ];
    });

    res.json({
      status: 'success',
      data: formatted,
      raw: rows
    });
  } catch (err) {
    console.error('Error getting fuel purchases:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/fuel/entry
 * Record a fuel consumption entry tied to a specific mochila.
 */
router.post('/entry', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const d = req.body || {};

    let targetTankId = parseInt(d.tank_id || d.tankId, 10);
    if (!targetTankId) {
      // Find default tank
      const defTank = await (await db.prepare('SELECT id, site FROM fuel_tanks WHERE site = ? AND is_active = 1 ORDER BY id ASC LIMIT 1')).bind(elevated ? 'Store' : userSite).first();
      targetTankId = defTank ? defTank.id : 1;
    }

    // Verify tank and site
    const tank = await (await db.prepare('SELECT id, site, name FROM fuel_tanks WHERE id = ?')).bind(targetTankId).first();
    if (!tank) {
      return res.status(404).json({ status: 'error', message: 'Mochila seleccionada no existe' });
    }

    if (!elevated && tank.site !== userSite) {
      return res.status(403).json({ status: 'error', message: 'No tiene permiso para dispensar combustible desde esta mochila' });
    }

    const liters = Number(d.liters || d.cantidadLitro) || 0;
    if (liters <= 0) {
      return res.status(400).json({ status: 'error', message: 'La cantidad de litros debe ser mayor a 0' });
    }

    const stmt = await db.prepare(`
      INSERT INTO fuel_entries
        (tank_id, site, entry_date, proyecto, tipo_activo, asset_id, liters, odometer_km, driver, user_email, vehicle, cost)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = await stmt.bind(
      tank.id,
      tank.site,
      d.proyecto || '',
      d.tipoActivo || d.tipo_activo || '',
      d.assetId || d.asset_id || '',
      liters,
      d.kilometraje || d.odometer_km ? Number(d.kilometraje || d.odometer_km) : null,
      d.nombre || d.driver || '',
      d.userEmail || d.user_email || (req.user ? req.user.email : ''),
      d.vehicle || null,
      d.cost ? Number(d.cost) : 0
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    res.json({
      status: 'success',
      success: true,
      id,
      tank_id: tank.id,
      site: tank.site,
      message: 'Carga de combustible registrada exitosamente en ' + tank.name
    });
  } catch (err) {
    console.error('Error saving fuel entry:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/fuel/purchase
 * Record fuel reception into a mochila.
 */
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const elevated = isElevated(req.user);
    const userSite = req.user && req.user.site ? String(req.user.site).trim() : '';
    const d = req.body || {};

    let targetTankId = parseInt(d.tank_id || d.tankId, 10);
    if (!targetTankId) {
      const defTank = await (await db.prepare('SELECT id, site FROM fuel_tanks WHERE site = ? AND is_active = 1 ORDER BY id ASC LIMIT 1')).bind(elevated ? 'Store' : userSite).first();
      targetTankId = defTank ? defTank.id : 1;
    }

    const tank = await (await db.prepare('SELECT id, site, name FROM fuel_tanks WHERE id = ?')).bind(targetTankId).first();
    if (!tank) {
      return res.status(404).json({ status: 'error', message: 'Mochila seleccionada no existe' });
    }

    if (!elevated && tank.site !== userSite) {
      return res.status(403).json({ status: 'error', message: 'No tiene permiso para recibir combustible en esta mochila' });
    }

    const liters = Number(d.litros || d.liters) || 0;
    if (liters <= 0) {
      return res.status(400).json({ status: 'error', message: 'La cantidad de litros debe ser mayor a 0' });
    }

    const stmt = await db.prepare(`
      INSERT INTO fuel_purchases (tank_id, site, purchase_date, proveedor, litros, factura, user_name)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `);

    const result = await stmt.bind(
      tank.id,
      tank.site,
      d.proveedor || '',
      liters,
      d.factura || '',
      d.userName || d.user_name || (req.user ? (req.user.name || req.user.email) : '')
    ).run();

    const id = (result && result.meta && result.meta.last_row_id) || null;

    res.json({
      status: 'success',
      success: true,
      id,
      tank_id: tank.id,
      site: tank.site,
      message: 'Recepción de combustible registrada exitosamente en ' + tank.name
    });
  } catch (err) {
    console.error('Error saving fuel purchase:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/fuel/last-odometer
 * Returns last recorded odometer for asset
 */
router.get('/last-odometer', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const assetId = String(req.query.asset_id || '').trim();
    if (!assetId) {
      return res.json({ status: 'success', lastKm: null });
    }

    const row = await (await db.prepare('SELECT odometer_km FROM fuel_entries WHERE asset_id = ? ORDER BY entry_date DESC LIMIT 1')).bind(assetId).first();
    const km = row ? Number(row.odometer_km) : null;

    res.json({ status: 'success', lastKm: km });
  } catch (err) {
    console.error('Error getting last odometer:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;

