const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { hashPin, verifyPin } = require('../utils/password');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/v1/auth/login
 * Body: { userId: "1001", pin: "1234" }
 */
router.post('/login', async (req, res) => {
  try {
    const { userId, pin } = req.body;

    if (!userId || !pin) {
      return res.status(400).json({ status: 'error', message: 'User ID and PIN are required' });
    }

    const userIdStr = String(userId).trim();
    const pinStr = String(pin).trim();

    if (!/^\d{4}$/.test(userIdStr)) {
      return res.status(400).json({ status: 'error', message: 'User ID must be exactly 4 digits' });
    }
    if (!/^\d{4}$/.test(pinStr)) {
      return res.status(400).json({ status: 'error', message: 'PIN must be exactly 4 digits' });
    }

    const db = req.app.locals.db;
    const stmt = await db.prepare(
      'SELECT id, user_id, email, pin_hash, name, site, role, is_active FROM users WHERE user_id = ?'
    );
    const user = await stmt.bind(userIdStr).first();

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Invalid user ID or PIN' });
    }

    if (!user.is_active) {
      return res.status(401).json({ status: 'error', message: 'Account is deactivated' });
    }

    const pinValid = await verifyPin(pinStr, user.pin_hash);
    if (!pinValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid user ID or PIN' });
    }

    const token = jwt.sign(
      {
        userId: user.user_id,
        email: user.email,
        name: user.name,
        site: user.site,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      status: 'success',
      data: {
        token,
        user: {
          userId: user.user_id,
          email: user.email,
          name: user.name,
          site: user.site,
          role: user.role
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/reset-pin
 * Body: { email }
 * Sends PIN reset link via Microsoft Graph API
 */
router.post('/reset-pin', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, email, name FROM users WHERE email = ? AND is_active = 1');
    const user = await stmt.bind(email).first();

    if (!user) {
      return res.json({ status: 'success', message: 'If this email is registered, a reset link has been sent' });
    }

    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const insertStmt = await db.prepare('INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)');
    await insertStmt.bind(email, resetToken, expiresAt).run();

    const graphToken = await getGraphAccessToken();
    if (graphToken) {
      await sendPinResetEmail(graphToken, email, user.name, resetToken);
    }

    res.json({ status: 'success', message: 'If this email is registered, a reset link has been sent' });
  } catch (err) {
    console.error('Reset PIN error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/confirm-reset-pin
 * Body: { token, newPin }
 */
router.post('/confirm-reset-pin', async (req, res) => {
  try {
    const { token, newPin } = req.body;

    if (!token || !newPin) {
      return res.status(400).json({ status: 'error', message: 'Token and new PIN are required' });
    }

    if (!/^\d{4}$/.test(String(newPin).trim())) {
      return res.status(400).json({ status: 'error', message: 'PIN must be exactly 4 digits' });
    }

    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, email, expires_at, used FROM password_resets WHERE token = ? AND used = 0');
    const reset = await stmt.bind(token).first();

    if (!reset) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token' });
    }

    if (new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ status: 'error', message: 'Reset token has expired' });
    }

    const pinHash = await hashPin(String(newPin).trim());
    const updateUser = await db.prepare('UPDATE users SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?');
    await updateUser.bind(pinHash, reset.email).run();

    const markUsed = await db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?');
    await markUsed.bind(reset.id).run();

    res.json({ status: 'success', message: 'PIN has been reset successfully' });
  } catch (err) {
    console.error('Confirm reset error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/auth/me
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({ status: 'success', data: { user: req.user } });
});

/**
 * POST /api/v1/auth/change-pin
 */
router.post('/change-pin', authenticateToken, async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;

    if (!oldPin || !newPin) {
      return res.status(400).json({ status: 'error', message: 'Old PIN and new PIN are required' });
    }

    if (!/^\d{4}$/.test(String(newPin).trim())) {
      return res.status(400).json({ status: 'error', message: 'New PIN must be exactly 4 digits' });
    }

    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT pin_hash FROM users WHERE user_id = ?');
    const user = await stmt.bind(req.user.userId).first();

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const pinValid = await verifyPin(String(oldPin).trim(), user.pin_hash);
    if (!pinValid) {
      return res.status(401).json({ status: 'error', message: 'Current PIN is incorrect' });
    }

    const newHash = await hashPin(String(newPin).trim());
    const updateStmt = await db.prepare('UPDATE users SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?');
    await updateStmt.bind(newHash, req.user.userId).run();

    res.json({ status: 'success', message: 'PIN changed successfully' });
  } catch (err) {
    console.error('Change PIN error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/logout
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ status: 'success', message: 'Logged out successfully' });
});

module.exports = router;


// ============================================
// Microsoft Graph API helpers
// ============================================

let graphTokenCache = { token: null, expiresAt: 0 };

async function getGraphAccessToken() {
  if (graphTokenCache.token && Date.now() < graphTokenCache.expiresAt) {
    return graphTokenCache.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.warn('Graph API credentials not configured');
    return null;
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    });

    const data = await response.json();
    if (data.access_token) {
      graphTokenCache.token = data.access_token;
      graphTokenCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000;
      return data.access_token;
    }
    console.error('Graph token error:', data);
    return null;
  } catch (err) {
    console.error('Graph token fetch error:', err);
    return null;
  }
}

async function sendPinResetEmail(graphToken, email, userName, resetToken) {
  const resetUrl = `${process.env.API_BASE_URL || 'https://recon-erp.your-domain.com'}/reset-pin.html?token=${resetToken}`;

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${graphToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject: 'RECON ERP - PIN Reset Request',
        body: {
          contentType: 'HTML',
          content: `
            <h2>RECON ERP PIN Reset</h2>
            <p>Hello ${userName || 'User'},</p>
            <p>You requested a PIN reset for your RECON ERP account.</p>
            <p>Click the link below to reset your PIN:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p>This link expires in 1 hour.</p>
            <p>If you did not request this, please ignore this email.</p>
          `
        },
        toRecipients: [
          { emailAddress: { address: email } }
        ]
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Graph sendMail error:', response.status, errorText);
  }
}
