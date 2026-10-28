const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { SheetsClient } = require('../sheets/sheets-client');
const { Importer } = require('../sheets/importer');
const cfg = require('../sheets/sheets-config');
const { SCHEMA_DEFINITIONS, parseCSV, transformRows } = require('../sheets/transformer');

/** Resolve effective connection: DB config row > env var. */
async function getConnection(db) {
  let sheetId = process.env.GOOGLE_SHEET_ID || '';
  let credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'api/gcp/service-account.json';
  try {
    const stmt = await db.prepare("SELECT key, value FROM config WHERE key IN ('google_sheet_id','google_credentials_path')");
    const res = await stmt.all();
    const rows = res.results || res || [];
    for (const r of rows) {
      if (r.key === 'google_sheet_id' && r.value) sheetId = r.value;
      if (r.key === 'google_credentials_path' && r.value) credPath = r.value;
    }
  } catch (e) { /* config table may not exist yet */ }
  return { sheetId, credPath };
}

async function saveConnection(db, { sheetId, credPath }) {
  const stmt = await db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  if (sheetId !== undefined) await (await db.prepare(
    "INSERT INTO config (key, value) VALUES ('google_sheet_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )).bind(sheetId).run();
  if (credPath !== undefined) await (await db.prepare(
    "INSERT INTO config (key, value) VALUES ('google_credentials_path', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )).bind(credPath).run();
}



/** Column mapping preferences: key = "map:<sheetKey>", value = JSON { [pastedColIdx]: dbField }. */
async function getMapping(db, sheetKey) {
  try {
    const stmt = await db.prepare("SELECT value FROM config WHERE key = ?");
    const row = await stmt.bind('map:' + sheetKey).first();
    return row && row.value ? JSON.parse(row.value) : null;
  } catch (e) { return null; }
}

async function saveMapping(db, sheetKey, mapping) {
  const stmt = await db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await stmt.bind('map:' + sheetKey, JSON.stringify(mapping)).run();
}
function clientEnv(conn) {
  return { ...process.env, GOOGLE_SHEET_ID: conn.sheetId, GOOGLE_APPLICATION_CREDENTIALS: conn.credPath };
}

/**
 * GET /api/v1/sheets/connection
 * Returns the active connection details (sheet ID + credential status).
 * Private key material is NEVER returned — only file-exists + client_email.
 */
router.get('/connection', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const conn = await getConnection(db);
    const resolved = path.resolve(conn.credPath || '');
    let credInfo = { exists: false, client_email: null };
    if (conn.credPath && fs.existsSync(resolved)) {
      credInfo.exists = true;
      try {
        const j = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        credInfo.client_email = j.client_email || null;
      } catch (e) { /* leave null */ }
    }
    res.json({
      status: 'success',
      data: {
        sheetId: conn.sheetId || '',
        credPath: conn.credPath || '',
        credentialsFound: credInfo.exists,
        serviceAccountEmail: credInfo.client_email,
        sheetUrl: conn.sheetId ? `https://docs.google.com/spreadsheets/d/${conn.sheetId}/edit` : '',
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PUT /api/v1/sheets/connection
 * Body: { sheetId?: string, credPath?: string }
 * Saves connection details into the config table (DB wins over .env).
 */
router.put('/connection', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { sheetId, credPath, serviceAccountJson } = req.body || {};
    let finalCredPath = credPath;
    // Optional: accept pasted service-account JSON and write it to disk.
    if (serviceAccountJson) {
      let parsed;
      try { parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson; }
      catch (e) { return res.status(400).json({ status: 'error', message: 'serviceAccountJson is not valid JSON' }); }
      if (!parsed.client_email || !parsed.private_key) {
        return res.status(400).json({ status: 'error', message: 'Service account JSON must contain client_email and private_key' });
      }
      const dir = path.resolve('api/gcp');
      fs.mkdirSync(dir, { recursive: true });
      finalCredPath = finalCredPath || 'api/gcp/service-account.json';
      fs.writeFileSync(path.resolve(finalCredPath), JSON.stringify(parsed, null, 2), 'utf8');
    }
    await saveConnection(db, { sheetId, credPath: finalCredPath });
    const conn = await getConnection(db);
    res.json({ status: 'success', data: { sheetId: conn.sheetId, credPath: conn.credPath } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/sheets/test
 * Body: { sheetId?: string } — verifies credentials + reads tab list / first rows.
 */
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const conn = await getConnection(db);
    const overrideId = (req.body && req.body.sheetId) || conn.sheetId;
    const client = new SheetsClient(clientEnv({ ...conn, sheetId: overrideId }));
    await client.connect();
    // Read the first configured tab as a smoke test.
    const firstKey = Object.keys(cfg.SHEETS)[0];
    const probe = await client.sheets.spreadsheets.get({
      spreadsheetId: overrideId,
      fields: 'properties.title,sheets.properties.title',
    });
    const tabs = (probe.data.sheets || []).map((s) => s.properties.title);
    res.json({
      status: 'success',
      data: {
        spreadsheetTitle: probe.data.properties.title,
        tabs,
        tabCount: tabs.length,
        firstSheetKey: firstKey,
      },
    });
  } catch (err) {
    console.error('Sheets test error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/sheets/paste-preview
 * Body: { sheet: "<config-key>" (REQUIRED), text: "<pasted TSV/CSV>" }
 * Dry-run for Option-4 paste import: parses pasted text, checks headers
 * against sheets-config, returns counts + sample. Writes NOTHING.
 */


/**
 * GET /api/v1/sheets/mapping/:key
 * Returns saved column mapping for a sheet key.
 */
router.get('/mapping/:key', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const mapping = await getMapping(db, req.params.key);
    res.json({ status: 'success', data: { key: req.params.key, mapping: mapping || {} } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PUT /api/v1/sheets/mapping/:key
 * Body: { mapping: { [pastedColIdx]: dbField } }
 * Saves column mapping preference for a sheet key.
 */
router.put('/mapping/:key', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { mapping } = req.body || {};
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ status: 'error', message: 'mapping object is required' });
    }
    await saveMapping(db, req.params.key, mapping);
    res.json({ status: 'success', data: { key: req.params.key, mapping } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/paste-preview', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { sheet, text, columnMap, hasHeaderRow } = req.body || {};
    if (!sheet) return res.status(400).json({ status: 'error', message: 'sheet key is required (pick which sheet you pasted)' });
    if (!text || !String(text).trim()) return res.status(400).json({ status: 'error', message: 'No pasted data received' });
    // 10MB express limit already caps size; add a row guard for safety.
    const lineCount = String(text).split(/\r?\n/).length;
    if (lineCount > 20000) return res.status(400).json({ status: 'error', message: 'Too many rows (max 20000 per paste)' });
    const client = new SheetsClient(clientEnv(await getConnection(db)));
    const importer = new Importer(db, client);
    const isHeader = hasHeaderRow !== false && hasHeaderRow !== "false";
    const result = await importer.previewPasted(sheet, String(text), columnMap, isHeader);
    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Sheets paste-preview error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/sheets/paste-import
 * Body: { sheet: "<config-key>" (REQUIRED), text: "<pasted TSV/CSV>" }
 * Real import from pasted text — call ONLY after user confirms the preview.
 */
router.post('/paste-import', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { sheet, text, columnMap, hasHeaderRow } = req.body || {};
    if (!sheet) return res.status(400).json({ status: 'error', message: 'sheet key is required' });
    if (!text || !String(text).trim()) return res.status(400).json({ status: 'error', message: 'No pasted data received' });
    const lineCount = String(text).split(/\r?\n/).length;
    if (lineCount > 20000) return res.status(400).json({ status: 'error', message: 'Too many rows (max 20000 per paste)' });
    const client = new SheetsClient(clientEnv(await getConnection(db)));
    const importer = new Importer(db, client);
    const isHeader = hasHeaderRow !== false && hasHeaderRow !== "false";
    const result = await importer.importPasted(sheet, String(text), columnMap, isHeader);
    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Sheets paste-import error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});
router.post('/preview', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const conn = await getConnection(db);
    const client = new SheetsClient(clientEnv(conn));
    await client.connect();
    const importer = new Importer(db, client);
    const { sheet, sheetId } = req.body || {};
    const opts = sheetId ? { sheetId } : {};
    const result = sheet
      ? await importer.previewSheet(sheet, opts)
      : await importer.previewAll(opts);
    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Sheets preview error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});
router.get('/status', authenticateToken, async (req, res) => {
  const sheets = Object.entries(cfg.SHEETS).map(([key, meta]) => ({
    key,
    gasSheet: meta.gasSheet,
    dbTable: meta.dbTable || meta.dbTables || null,
    naturalKey: meta.naturalKey,
    columns: (meta.columns || []).length,
    expectedHeaders: (meta.columns || []).map((c) => c.header),
    fields: (meta.columns || []).map((c) => ({ header: c.header, dbField: c.dbField })),
    sections: meta.sections ? Object.keys(meta.sections) : undefined,
  }));
  res.json({
    status: 'success',
    data: {
      configured: sheets.length,
      sheetIdSet: Boolean(process.env.GOOGLE_SHEET_ID),
      credentialsSet: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      sheets,
    },
  });
});

/**
 * POST /api/v1/sheets/import
 * Body: { sheet?: "<config-key>" } — omit to import ALL sheets.
 * Reads from Google Sheets API v4 (service account) and upserts into SQLite/D1.
 */
router.post('/import', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const conn = await getConnection(db);
    const client = new SheetsClient(clientEnv(conn));
    await client.connect();
    const importer = new Importer(db, client);

    const { sheet, sheetId } = req.body || {};
    // Only call readSheet's sheetId override when explicitly provided.
    if (sheetId) {
      const origRead = client.readSheet.bind(client);
      client.readSheet = (tab, range) => origRead(tab, range, sheetId);
    }
    const result = sheet
      ? await importer.importSheet(sheet)
      : await importer.importAll();

    res.json({ status: 'success', data: result });
  } catch (err) {
    console.error('Sheets import error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
