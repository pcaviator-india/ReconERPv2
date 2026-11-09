const jwt = require('jsonwebtoken');

/**
 * JWT Authentication Middleware
 * Verifies Bearer token on protected routes
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ status: 'error', message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

/**
 * Optional auth - doesn't fail if no token, just sets req.user if valid
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
    });
  }
  next();
}

/**
 * Role Check Middleware
 * e.g. requireRole('admin') or requireRole('admin', 'manager')
 */
function requireRole(...allowedRoles) {
  const normalized = allowedRoles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    const userRole = String(req.user.role).toLowerCase();
    if (!normalized.includes(userRole)) {
      return res.status(403).json({ status: 'error', message: 'Permission denied: Insufficient role' });
    }
    next();
  };
}

/**
 * Dynamic Permission Check Middleware
 * e.g. requirePermission('stock', 'edit')
 */
function requirePermission(moduleKey, action = 'view') {
  return async (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }

    const userRole = String(req.user.role).toLowerCase();
    // Admin always bypasses
    if (userRole === 'admin') {
      req.siteFilter = null;
      return next();
    }

    try {
      const db = req.app.locals.db;
      const stmt = await db.prepare(`
        SELECT can_view, can_edit, can_approve, site_scope 
        FROM role_permissions 
        WHERE role_id = ? AND module_key = ?
      `);
      const perm = await stmt.bind(userRole, moduleKey).first();

      if (!perm) {
        return res.status(403).json({ status: 'error', message: `Access denied to module ${moduleKey}` });
      }

      if (action === 'view' && !perm.can_view) {
        return res.status(403).json({ status: 'error', message: `View access denied for ${moduleKey}` });
      }
      if (action === 'edit' && !perm.can_edit) {
        return res.status(403).json({ status: 'error', message: `Edit access denied for ${moduleKey}` });
      }
      if (action === 'approve' && !perm.can_approve) {
        return res.status(403).json({ status: 'error', message: `Approval access denied for ${moduleKey}` });
      }

      if (perm.site_scope === 'assigned') {
        req.siteFilter = req.user.site || null;
      } else {
        req.siteFilter = null;
      }

      next();
    } catch (err) {
      console.error('requirePermission error:', err);
      res.status(500).json({ status: 'error', message: 'Failed to verify permission' });
    }
  };
}

module.exports = { authenticateToken, optionalAuth, requireRole, requirePermission };
