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


// ========================================================
// LIVE SYNC STUDIO & VISUAL COLUMN MAPPER ROUTES
// ========================================================

/**
 * GET /api/v1/sheets/schema-definitions
 * Returns metadata of target schemas and default mappings.
 */
router.get('/schema-definitions', authenticateToken, (req, res) => {
  res.json({
    status: 'success',
    data: SCHEMA_DEFINITIONS
  });
});

/**
 * POST /api/v1/sheets/fetch-remote-sheet
 * Body: { sheetId, sheetName }
 * Fetches remote sheet headers and 5 sample rows via public/published gviz CSV.
 */
router.post('/fetch-remote-sheet', authenticateToken, async (req, res) => {
  try {
    const { sheetId, sheetName } = req.body || {};
    if (!sheetId || !sheetName) {
      return res.status(400).json({ status: 'error', message: 'sheetId and sheetName are required' });
    }

    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({
        status: 'error',
        message: `Google Sheets returned HTTP ${response.status}. Ensure sheet is accessible or published.`
      });
    }

    const text = await response.text();
    if (text.includes('<!DOCTYPE html>')) {
      return res.status(403).json({
        status: 'error',
        message: 'Could not access sheet. Please verify Sheet ID and Sharing settings ("Anyone with link can view").'
      });
    }

    const { headers, rows } = parseCSV(text);
    const sampleRows = rows.slice(0, 5);

    res.json({
      status: 'success',
      data: {
        headers,
        sampleRows,
        totalRows: rows.length
      }
    });
  } catch (err) {
    console.error('fetch-remote-sheet error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/sheets/preview-transformed
 * Body: { sheetKey, headers, sampleRows, mapping }
 * Runs transformRows in-memory on sample rows and returns structured preview.
 */
router.post('/preview-transformed', authenticateToken, (req, res) => {
  try {
    const { sheetKey, headers, sampleRows, mapping } = req.body || {};
    if (!sheetKey || !headers || !sampleRows) {
      return res.status(400).json({ status: 'error', message: 'sheetKey, headers, and sampleRows are required' });
    }

    const preview = transformRows(sheetKey, headers, sampleRows, mapping || {});
    const recordCount = preview.records ? preview.records.length : 0;
    console.log('preview-transformed:', {
      sheetKey,
      headersCount: Array.isArray(headers) ? headers.length : 0,
      headers: headers,
      sampleRowsCount: Array.isArray(sampleRows) ? sampleRows.length : 0,
      mappingKeys: mapping ? Object.keys(mapping) : [],
      recordCount
    });
    res.json({
      status: 'success',
      data: { preview }
    });
  } catch (err) {
    console.error('preview-transformed error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * Helper to execute an array of D1 statements in chunks of 50 using db.batch()
 */
async function executeBatchChunks(db, statements, chunkSize = 50) {
  let executedCount = 0;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      await db.batch(chunk);
      executedCount += chunk.length;
    }
  }
  return executedCount;
}

/**
 * POST /api/v1/sheets/sync-remote-tab
 * Body: { sheetId, sheetKey, mapping }
 * Fetches full remote tab, transforms rows, and batch-upserts into Cloudflare D1.
 */
router.post('/sync-remote-tab', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { sheetId, sheetKey, mapping } = req.body || {};
    if (!sheetId || !sheetKey) {
      return res.status(400).json({ status: 'error', message: 'sheetId and sheetKey are required' });
    }

    const def = SCHEMA_DEFINITIONS[sheetKey];
    if (!def) {
      return res.status(400).json({ status: 'error', message: `Unknown sheetKey: ${sheetKey}` });
    }

    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(def.gasSheet)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ status: 'error', message: `Google Sheets returned ${response.status}` });
    }

    const text = await response.text();
    const { headers, rows } = parseCSV(text);
    if (!headers.length || !rows.length) {
      return res.json({ status: 'success', data: { synced: 0, message: 'Tab has no data rows' } });
    }

    const transformed = transformRows(sheetKey, headers, rows, mapping || {});
    const stmts = [];

    const genId = (prefix) => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID();
      }
      return (prefix ? prefix + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
    };

    if (sheetKey === 'ordenes') {
      const records = transformed.records || [];
      for (const rec of records) {
        const p = rec.parent;
        const reqId = genId('req');
        const stmtParent = await db.prepare(`
          INSERT INTO requisitions (
            id, requisition_no, created_at, site, status, requested_by,
            quote_id, po_status, po_no, category, pdf_url, quo_pdf_url,
            last_modified_by, last_modified_date, mod_count, emails,
            sub_area, sub_area_no, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(requisition_no) DO UPDATE SET
            site = excluded.site,
            status = excluded.status,
            requested_by = excluded.requested_by,
            quote_id = excluded.quote_id,
            po_status = excluded.po_status,
            po_no = excluded.po_no,
            category = excluded.category,
            pdf_url = excluded.pdf_url,
            quo_pdf_url = excluded.quo_pdf_url,
            last_modified_by = excluded.last_modified_by,
            last_modified_date = excluded.last_modified_date,
            mod_count = excluded.mod_count,
            emails = excluded.emails,
            sub_area = excluded.sub_area,
            sub_area_no = excluded.sub_area_no,
            notes = excluded.notes,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmtParent.bind(
          reqId, p.requisition_no, p.created_at || new Date().toISOString(), p.site || null,
          p.status || 'Pending', p.requested_by || null, p.quote_id || null, p.po_status || null,
          p.po_no || null, p.category || null, p.pdf_url || null, p.quo_pdf_url || null,
          p.last_modified_by || null, p.last_modified_date || null, p.mod_count || 0,
          p.emails || null, p.sub_area || null, p.sub_area_no || null, p.notes || null
        ));

        // Delete old child items for this requisition to refresh cleanly
        const stmtDelChildren = await db.prepare(`
          DELETE FROM requisition_items WHERE requisition_id = ? OR requisition_id = (SELECT id FROM requisitions WHERE requisition_no = ?)
        `);
        stmts.push(stmtDelChildren.bind(reqId, p.requisition_no));

        for (const c of rec.children || []) {
          const stmtChild = await db.prepare(`
            INSERT INTO requisition_items (
              requisition_id, geo, pn, description_es, quantity_requested,
              item_notes, supplier_notes, images, notes, status
            ) VALUES (
              (SELECT id FROM requisitions WHERE requisition_no = ?),
              ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
          `);
          stmts.push(stmtChild.bind(
            p.requisition_no, c.geo || null, c.pn || null, c.description_es || null,
            c.quantity_requested || 0, c.item_notes || null, c.supplier_notes || null,
            c.images || null, c.item_notes || null, p.status || 'Pending'
          ));
        }
      }
    } else if (sheetKey === 'quotes') {
      const records = transformed.records || [];
      for (const rec of records) {
        const p = rec.parent;
        const quoteId = genId('quo');
        const stmtParent = await db.prepare(`
          INSERT INTO quotes (
            id, quote_no, ref_id, created_at, supplier, site, ref_cotiz,
            status, pdf_url, fecha_acordada, comprador, currency, exchange_rate,
            comments, iva_inc, condicion_pago, category, last_modified_by,
            last_modified_date, mod_count, emails, created_by, quoted_doc_url, total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(quote_no) DO UPDATE SET
            ref_id = excluded.ref_id,
            supplier = excluded.supplier,
            site = excluded.site,
            ref_cotiz = excluded.ref_cotiz,
            status = excluded.status,
            pdf_url = excluded.pdf_url,
            fecha_acordada = excluded.fecha_acordada,
            comprador = excluded.comprador,
            currency = excluded.currency,
            exchange_rate = excluded.exchange_rate,
            comments = excluded.comments,
            iva_inc = excluded.iva_inc,
            condicion_pago = excluded.condicion_pago,
            category = excluded.category,
            last_modified_by = excluded.last_modified_by,
            last_modified_date = excluded.last_modified_date,
            mod_count = excluded.mod_count,
            emails = excluded.emails,
            quoted_doc_url = excluded.quoted_doc_url,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmtParent.bind(
          quoteId, p.quote_no, p.ref_id || null, p.created_at || new Date().toISOString(),
          p.supplier || null, p.site || null, p.ref_cotiz || null, p.status || 'Pending',
          p.pdf_url || null, p.fecha_acordada || null, p.comprador || null, p.currency || 'CLP',
          p.exchange_rate || 1, p.comments || null, p.iva_inc || 'Neto', p.condicion_pago || null,
          p.category || null, p.last_modified_by || null, p.last_modified_date || null,
          p.mod_count || 0, p.emails || null, p.created_by || null, p.quoted_doc_url || null, 0
        ));

        // Delete old items for this quote
        const stmtDelChildren = await db.prepare(`
          DELETE FROM quote_items WHERE quote_id = ? OR quote_id = (SELECT id FROM quotes WHERE quote_no = ?)
        `);
        stmts.push(stmtDelChildren.bind(quoteId, p.quote_no));

        for (const c of rec.children || []) {
          const stmtChild = await db.prepare(`
            INSERT INTO quote_items (
              quote_id, geo, pn, description_es, quantity, unit_price,
              total_price, sub_category, received_qty, approved_qty,
              discount_pct, freight
            ) VALUES (
              (SELECT id FROM quotes WHERE quote_no = ?),
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
          `);
          stmts.push(stmtChild.bind(
            p.quote_no, c.geo || null, c.pn || null, c.description_es || null,
            c.quantity || 0, c.unit_price || 0, c.total_price || 0,
            c.sub_category || null, c.received_qty || 0, c.approved_qty || 0,
            c.discount_pct || 0, c.freight || 0
          ));
        }
      }
    } else if (sheetKey === 'stock') {
      for (const r of transformed.records || []) {
        if (!r.geo) continue;
        const stmt = await db.prepare(`
          INSERT INTO stock (item_id, product_name, location_type, location_id, quantity, reserved_qty, available_qty, last_updated, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.geo, r.product_name || null, r.location_type || 'Sector', r.location_id || 'Store',
          r.quantity || 0, r.reserved_qty || 0, r.available_qty || 0,
          r.last_updated || new Date().toISOString(), r.updated_by || 'System'
        ));
      }
    } else if (sheetKey === 'stockLedger') {
      for (const r of transformed.records || []) {
        if (!r.ledger_id) continue;
        const stmt = await db.prepare(`
          INSERT INTO stock_ledger (ledger_id, created_at, geo, product_name, sector_from, sector_to, qty_change, new_balance, transaction_type, reference_id, reference_type, user_name, comments, condition)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.ledger_id, r.created_at || new Date().toISOString(), r.geo || null, r.product_name || null,
          r.sector_from || null, r.sector_to || null, r.qty_change || 0, r.new_balance || 0,
          r.transaction_type || null, r.reference_id || null, r.reference_type || null,
          r.user_name || null, r.comments || null, r.condition || null
        ));
      }
    } else if (sheetKey === 'invMovement') {
      for (const r of transformed.records || []) {
        if (!r.movement_id) continue;
        const stmt = await db.prepare(`
          INSERT INTO inventory_movements (movement_id, movement_timestamp, geo, type, quantity, qty, person, sector, maquina, generador, vehiculo, condition, comments, site)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(movement_id) DO UPDATE SET
            movement_timestamp = excluded.movement_timestamp,
            geo = excluded.geo,
            type = excluded.type,
            quantity = excluded.quantity,
            qty = excluded.qty,
            person = excluded.person,
            sector = excluded.sector,
            maquina = excluded.maquina,
            generador = excluded.generador,
            vehiculo = excluded.vehiculo,
            condition = excluded.condition,
            comments = excluded.comments,
            site = excluded.site
        `);
        stmts.push(stmt.bind(
          r.movement_id, r.movement_timestamp || new Date().toISOString(), r.geo || null,
          r.type || null, r.quantity || 0, r.quantity || 0, r.person || null, r.sector || null,
          r.maquina || null, r.generador || null, r.vehiculo || null, r.condition || null,
          r.comments || null, r.site || null
        ));
      }
    } else if (sheetKey === 'people') {
      for (const r of transformed.records || []) {
        if (!r.id) continue;
        const stmt = await db.prepare(`
          INSERT INTO people (id, name, department, active, sector, position, rut, biometric_template, email, ingreso_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            department = excluded.department,
            active = excluded.active,
            sector = excluded.sector,
            position = excluded.position,
            rut = excluded.rut,
            biometric_template = excluded.biometric_template,
            email = excluded.email,
            ingreso_date = excluded.ingreso_date,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmt.bind(
          r.id, r.name || null, r.department || null, r.active != null ? r.active : 1,
          r.sector || null, r.position || null, r.rut || null, r.biometric_template || null,
          r.email || null, r.ingreso_date || null
        ));
      }
    } else if (sheetKey === 'rackConfig') {
      for (const r of transformed.records || []) {
        if (!r.location_id || !r.rack_id) continue;
        const stmt = await db.prepare(`
          INSERT INTO rack_config (location_id, rack_id, has_sides, no_of_shelves)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(location_id, rack_id) DO UPDATE SET
            has_sides = excluded.has_sides,
            no_of_shelves = excluded.no_of_shelves
        `);
        stmts.push(stmt.bind(
          r.location_id, r.rack_id, r.has_sides || 0, r.no_of_shelves || 1
        ));
      }
    } else if (sheetKey === 'itemLocationMap') {
      for (const r of transformed.records || []) {
        if (!r.item_id) continue;
        const stmt = await db.prepare(`
          INSERT INTO item_location_map (location_id, rack_id, side_code, shelf_level, item_id)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.location_id || null, r.rack_id || null, r.side_code || null, r.shelf_level || null, r.item_id
        ));
      }
    } else if (sheetKey === 'controlCombustible') {
      for (const r of transformed.records || []) {
        const stmt = await db.prepare(`
          INSERT INTO fuel_entries (entry_date, proyecto, tipo_activo, asset_id, liters, odometer_km, vehicle, user_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.entry_date || new Date().toISOString(), r.proyecto || null, r.tipo_activo || null,
          r.asset_id || null, r.liters || 0, r.odometer_km || 0, r.vehicle || null, r.user_email || null
        ));
      }
    } else if (sheetKey === 'compraCombustible') {
      for (const r of transformed.records || []) {
        const stmt = await db.prepare(`
          INSERT INTO fuel_purchases (purchase_date, proveedor, litros, factura, user_name)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.purchase_date || new Date().toISOString(), r.proveedor || null, r.litros || 0,
          r.factura || null, r.user_name || null
        ));
      }
    } else if (sheetKey === 'sites') {
      for (const r of transformed.records || []) {
        if (!r.name) continue;
        const stmt = await db.prepare(`
          INSERT INTO sites (site_id, name, code, active)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(site_id) DO UPDATE SET
            name = excluded.name,
            code = excluded.code,
            active = excluded.active
        `);
        stmts.push(stmt.bind(
          r.site_id || null, r.name || null, r.site_id || null, r.active != null ? r.active : 1
        ));
      }
    } else if (sheetKey === 'categories') {
      for (const r of transformed.records || []) {
        if (!r.name) continue;
        const stmt = await db.prepare(`
          INSERT INTO categories (name, active)
          VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET
            active = excluded.active,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmt.bind(
          r.name || null, r.active != null ? r.active : 1
        ));
      }
    } else if (sheetKey === 'sub_categories') {
      const catMap = {};
      const cats = await db.prepare('SELECT id, name FROM categories').all();
      for (const c of cats.results || cats || []) {
        catMap[String(c.name).trim().toLowerCase()] = c.id;
      }
      for (const r of transformed.records || []) {
        if (!r.name) continue;
        const categoryName = String(r.category_name || '').trim();
        const categoryId = categoryName ? catMap[categoryName.toLowerCase()] : null;
        if (!categoryId) continue;
        const stmt = await db.prepare(`
          INSERT INTO sub_categories (category_id, name, active)
          VALUES (?, ?, ?)
        `);
        stmts.push(stmt.bind(
          categoryId, r.name || null, r.active != null ? r.active : 1
        ));
      }
    } else if (sheetKey === 'brands') {
      for (const r of transformed.records || []) {
        if (!r.name) continue;
        const stmt = await db.prepare(`
          INSERT INTO brands (name, active)
          VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET
            active = excluded.active,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmt.bind(
          r.name || null, r.active != null ? r.active : 1
        ));
      }
    } else if (sheetKey === 'suppliers') {
      for (const r of transformed.records || []) {
        if (!r.name) continue;
        const stmt = await db.prepare(`
          INSERT INTO suppliers (name, email, contact_person, active)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            email = excluded.email,
            contact_person = excluded.contact_person,
            active = excluded.active,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmts.push(stmt.bind(
          r.name || null, r.email || null, r.contact_person || null, r.active != null ? r.active : 1
        ));
      }
    } else if (sheetKey === 'minMax') {
      for (const r of transformed.records || []) {
        if (!r.site || !r.geo_code) continue;
        const stmt = await db.prepare(`
          INSERT INTO min_max (site, geo_code, min_qty, max_qty, last_updated, updated_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.site, r.geo_code, r.min_qty || 0, r.max_qty || 0,
          r.last_updated || new Date().toISOString(), r.updated_by || 'System'
        ));
      }
    } else if (sheetKey === 'quoteLog') {
      for (const r of transformed.records || []) {
        if (!r.quote_id) continue;
        const stmt = await db.prepare(`
          INSERT INTO quote_logs (timestamp, quote_id, order_id, editor_email, change_details_json, mod_count, pdf_regenerated)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmts.push(stmt.bind(
          r.timestamp || new Date().toISOString(), r.quote_id, r.order_id || null,
          r.editor_email || null, r.change_details_json || null, r.mod_count || 0, r.pdf_regenerated || 0
        ));
      }
    }

    const executedCount = await executeBatchChunks(db, stmts, 50);

    res.json({
      status: 'success',
      data: {
        sheetKey,
        recordsTransformed: transformed.isSplit ? (transformed.records || []).length : (transformed.records || []).length,
        statementsExecuted: executedCount
      }
    });
  } catch (err) {
    console.error('sync-remote-tab error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
