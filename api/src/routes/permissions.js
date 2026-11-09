const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { MODULE_DEFINITIONS, DEFAULT_ROLES, ROLE_PERMISSIONS_DEFAULTS } = require('../utils/permissions-seed');

const router = express.Router();

/**
 * Middleware: require Admin role
 */
function requireAdmin(req, res, next) {
  const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
  if (role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access required' });
  }
  next();
}

/**
 * GET /api/v1/permissions/modules
 * Returns list of modules, categories, and keys
 */
router.get('/modules', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    data: MODULE_DEFINITIONS
  });
});

/**
 * GET /api/v1/permissions/roles
 * Returns all roles
 */
router.get('/roles', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, name, description, is_system FROM roles ORDER BY id');
    const result = await stmt.all();
    res.json({
      status: 'success',
      data: result.results || []
    });
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/permissions/matrix
 * Returns the entire permissions matrix for all roles (Admin only or manager view)
 */
router.get('/matrix', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const rolesStmt = await db.prepare('SELECT id, name, description, is_system FROM roles ORDER BY id');
    const rolesResult = await rolesStmt.all();
    const roles = rolesResult.results || [];

    const permsStmt = await db.prepare(`
      SELECT role_id, module_key, can_view, can_edit, can_approve, site_scope 
      FROM role_permissions
    `);
    const permsResult = await permsStmt.all();
    const allPerms = permsResult.results || [];

    // Group permissions by role_id
    const matrix = {};
    for (const r of roles) {
      matrix[r.id] = {
        role: r,
        permissions: {}
      };
      // Populate defaults for all known modules
      for (const m of MODULE_DEFINITIONS) {
        matrix[r.id].permissions[m.key] = {
          module_key: m.key,
          name: m.name,
          category: m.category,
          can_view: 0,
          can_edit: 0,
          can_approve: 0,
          site_scope: 'all'
        };
      }
    }

    // Overlay saved permissions
    for (const p of allPerms) {
      if (matrix[p.role_id] && matrix[p.role_id].permissions[p.module_key]) {
        matrix[p.role_id].permissions[p.module_key].can_view = Number(p.can_view);
        matrix[p.role_id].permissions[p.module_key].can_edit = Number(p.can_edit);
        matrix[p.role_id].permissions[p.module_key].can_approve = Number(p.can_approve);
        matrix[p.role_id].permissions[p.module_key].site_scope = p.site_scope || 'all';
      }
    }

    res.json({
      status: 'success',
      data: {
        modules: MODULE_DEFINITIONS,
        roles,
        matrix
      }
    });
  } catch (err) {
    console.error('Error fetching permission matrix:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/permissions/my
 * Returns the currently logged in user's permissions and scope
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : 'user';
    const userSite = req.user && req.user.site ? req.user.site : null;

    const stmt = await db.prepare(`
      SELECT module_key, can_view, can_edit, can_approve, site_scope 
      FROM role_permissions 
      WHERE role_id = ?
    `);
    const result = await stmt.bind(userRole).all();
    const permsList = result.results || [];

    const permsMap = {};
    for (const p of permsList) {
      permsMap[p.module_key] = {
        can_view: Boolean(p.can_view),
        can_edit: Boolean(p.can_edit),
        can_approve: Boolean(p.can_approve),
        site_scope: p.site_scope || 'all'
      };
    }

    // Fallback if role has no custom permissions row yet (e.g. admin has everything)
    if (userRole === 'admin' && Object.keys(permsMap).length === 0) {
      for (const m of MODULE_DEFINITIONS) {
        permsMap[m.key] = { can_view: true, can_edit: true, can_approve: true, site_scope: 'all' };
      }
    }

    res.json({
      status: 'success',
      data: {
        userId: req.user.userId,
        role: userRole,
        site: userSite,
        permissions: permsMap
      }
    });
  } catch (err) {
    console.error('Error fetching user permissions:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/permissions/roles
 * Create a new custom role (Admin only)
 */
router.post('/roles', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, name, description, cloneFrom } = req.body;
    if (!id || !name) {
      return res.status(400).json({ status: 'error', message: 'Role ID and Name are required' });
    }

    const cleanId = String(id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const db = req.app.locals.db;

    // Check if exists
    const checkStmt = await db.prepare('SELECT id FROM roles WHERE id = ?');
    const existing = await checkStmt.bind(cleanId).first();
    if (existing) {
      return res.status(400).json({ status: 'error', message: `Role "${cleanId}" already exists` });
    }

    // Insert role
    const insertRole = await db.prepare(`
      INSERT INTO roles (id, name, description, is_system) 
      VALUES (?, ?, ?, 0)
    `);
    await insertRole.bind(cleanId, String(name).trim(), description || '').run();

    // Copy permissions from cloneFrom or create blank
    const sourceRole = cloneFrom ? String(cloneFrom).toLowerCase() : 'user';
    const getSourcePerms = await db.prepare(`
      SELECT module_key, can_view, can_edit, can_approve, site_scope 
      FROM role_permissions WHERE role_id = ?
    `);
    const sourcePerms = (await getSourcePerms.bind(sourceRole).all()).results || [];

    const insertPerm = await db.prepare(`
      INSERT OR REPLACE INTO role_permissions 
      (role_id, module_key, can_view, can_edit, can_approve, site_scope)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    if (sourcePerms.length > 0) {
      for (const sp of sourcePerms) {
        await insertPerm.bind(cleanId, sp.module_key, sp.can_view, sp.can_edit, sp.can_approve, sp.site_scope).run();
      }
    } else {
      for (const m of MODULE_DEFINITIONS) {
        await insertPerm.bind(cleanId, m.key, 0, 0, 0, 'assigned').run();
      }
    }

    res.json({
      status: 'success',
      message: `Role "${cleanId}" created successfully`,
      data: { id: cleanId, name, description }
    });
  } catch (err) {
    console.error('Error creating role:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PUT /api/v1/permissions/roles/:roleId
 * Update permissions for a role (Admin only)
 * Body: { permissions: [ { module_key, can_view, can_edit, can_approve, site_scope }, ... ] }
 */
router.put('/roles/:roleId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const roleId = String(req.params.roleId).trim().toLowerCase();
    const { permissions, name, description } = req.body;

    const db = req.app.locals.db;

    // Check if role exists
    const checkStmt = await db.prepare('SELECT id, is_system FROM roles WHERE id = ?');
    const existingRole = await checkStmt.bind(roleId).first();
    if (!existingRole) {
      return res.status(404).json({ status: 'error', message: 'Role not found' });
    }

    // Optionally update name/description
    if (name || description !== undefined) {
      const updateRole = await db.prepare('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      await updateRole.bind(name || null, description !== undefined ? description : null, roleId).run();
    }

    // Update permissions array
    if (Array.isArray(permissions)) {
      const upsertPerm = await db.prepare(`
        INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(role_id, module_key) DO UPDATE SET
          can_view = excluded.can_view,
          can_edit = excluded.can_edit,
          can_approve = excluded.can_approve,
          site_scope = excluded.site_scope,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const p of permissions) {
        if (!p.module_key) continue;
        await upsertPerm.bind(
          roleId,
          p.module_key,
          p.can_view ? 1 : 0,
          p.can_edit ? 1 : 0,
          p.can_approve ? 1 : 0,
          p.site_scope === 'assigned' ? 'assigned' : 'all'
        ).run();
      }
    }

    res.json({
      status: 'success',
      message: `Permissions for role "${roleId}" updated successfully`
    });
  } catch (err) {
    console.error('Error updating permissions:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/permissions/reset
 * Reset default system permissions to recommended baseline (Admin only)
 */
router.post('/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const upsertPerm = await db.prepare(`
      INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(role_id, module_key) DO UPDATE SET
        can_view = excluded.can_view,
        can_edit = excluded.can_edit,
        can_approve = excluded.can_approve,
        site_scope = excluded.site_scope,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const [roleId, perms] of Object.entries(ROLE_PERMISSIONS_DEFAULTS)) {
      for (const [moduleKey, canView, canEdit, canApprove, siteScope] of perms) {
        await upsertPerm.bind(roleId, moduleKey, canView, canEdit, canApprove, siteScope).run();
      }
    }

    res.json({
      status: 'success',
      message: 'System permissions reset to recommended defaults successfully'
    });
  } catch (err) {
    console.error('Error resetting permissions:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;

