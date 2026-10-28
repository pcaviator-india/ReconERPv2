'use strict';
/**
 * importer.js - Google Sheets -> SQLite sync pipeline.
 * Flow: SheetsClient reads rows -> sheets-config maps tabs/columns ->
 * Importer maps rows to DB records -> upsert by natural key -> audit_log.
 * Works on local SQLite (better-sqlite3) and Cloudflare D1 via db.prepare().
 */
const cfg = require('./sheets-config.js');

const SKIP = new Set(['users']);

function ident(x) {
  return '"' + String(x).replace(/"/g, '""') + '"';
}

function toValue(raw, parse) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (parse) {
    try {
      const p = parse(raw);
      if (p === undefined || p === null || p === '') return null;
      return p;
    } catch (e) { return raw; }
  }
  return raw;
}

function mapRow(meta, row, columnMap) {
  const record = {};
  // columnMap: { [pastedColIndex]: dbFieldName } — user-chosen mapping
  // from pasted sheet columns to DB fields. When absent, fall back to
  // meta.columns index (column position).
  for (const col of meta.columns) {
    let rawIdx = col.index;
    if (columnMap) {
      // Find which pasted column this meta column maps to.
      const mappedIdx = Object.entries(columnMap).find(([, f]) => f === col.dbField);
      if (mappedIdx) rawIdx = parseInt(mappedIdx[0], 10);
      else continue; // not mapped — skip this column
    }
    const raw = row[rawIdx];
    if (raw === undefined || raw === '') continue;
    const v = toValue(raw, col.parse);
    if (v === undefined || v === '') continue;
    // NOTE: null values are KEPT (e.g. unresolved FK lookups) so the
    // preview table shows the column instead of hiding it.
    record[col.dbField] = v;
  }
  return record;
}

async function refId(db, table, name, create) {
  if (!name) return null;
  const clean = String(name).trim();
  if (!clean) return null;
  const stmt = await db.prepare('SELECT id FROM ' + ident(table) + ' WHERE name = ? LIMIT 1');
  const row = await stmt.bind(clean).first();
  if (row) return row.id;
  // Auto-create missing reference rows so pasted names are never lost.
  if (create) {
    const ins = await db.prepare('INSERT INTO ' + ident(table) + ' (name) VALUES (?)');
    const res = await ins.bind(clean).run();
    if (res && res.meta && res.meta.last_row_id) return res.meta.last_row_id;
    const retry = await (await db.prepare('SELECT id FROM ' + ident(table) + ' WHERE name = ? LIMIT 1')).bind(clean).first();
    return retry ? retry.id : null;
  }
  return null;
}


/** Preview-only fields carried for GUI display (original pasted names). */
const HELPER_FIELDS = new Set(['category_name', 'sub_category_name', 'brand_name', 'supplier_name']);
function stripHelpers(record) {
  for (const f of HELPER_FIELDS) delete record[f];
}

async function findByKeys(db, table, record, keys) {
  if (!keys || !keys.length) return null;
  const usable = keys.filter((k) => record[k] !== undefined && record[k] !== null && record[k] !== '');
  if (!usable.length) return null;
  const sql = 'SELECT * FROM ' + ident(table) + ' WHERE ' + usable.map((k) => ident(k) + ' = ?').join(' AND ') + ' LIMIT 1';
  const stmt = await db.prepare(sql);
  return stmt.bind(...usable.map((k) => record[k])).first();
}

async function upsert(db, table, record, keys) {
  // Strip preview-only helper fields (e.g. category_name) that are not DB columns.
  stripHelpers(record);
  const cols = Object.keys(record);
  if (!cols.length) return { action: 'empty', id: null };
  const existing = await findByKeys(db, table, record, keys);
  if (existing && existing.id !== undefined) {
    const sets = cols.map((c) => ident(c) + ' = ?').join(', ');
    const stmt = await db.prepare('UPDATE ' + ident(table) + ' SET ' + sets + ', updated_at = CURRENT_TIMESTAMP WHERE ' + ident('id') + ' = ?');
    await stmt.bind(...cols.map((c) => record[c]), existing.id).run();
    return { action: 'updated', id: existing.id };
  }
  const vals = cols.map(() => '?').join(', ');
  const stmt = await db.prepare('INSERT INTO ' + ident(table) + ' (' + cols.map(ident).join(', ') + ') VALUES (' + vals + ')');
  const res = await stmt.bind(...cols.map((c) => record[c])).run();
  const id = res && res.meta ? res.meta.last_row_id : null;
  return { action: 'inserted', id };
}

async function audit(db, table, recordId, action, newValues) {
  try {
    const stmt = await db.prepare('INSERT INTO audit_log (table_name, record_id, action, new_values) VALUES (?, ?, ?, ?)');
    await stmt.bind(table, String(recordId || ''), action, JSON.stringify(newValues || {})).run();
  } catch (e) { /* audit_log may not exist yet */ }
}

function shouldSkip(key) { return SKIP.has(key); }

/**
 * Parse pasted TSV/CSV text (from Ctrl+A/Ctrl+C in Google Sheets) into
 * { headers, rows }. Auto-detects tab vs comma delimiter from the first line.
 * @param {string} text
 * @returns {{headers: string[], rows: string[][]}}
 */
function parsePasted(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const split = (line) => {
    if (delim === '\t') return line.split('\t').map((c) => c.trim());
    // minimal CSV: handle quoted commas
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]).map((h) => String(h).trim());
  const rows = lines.slice(1).map((l) => {
    const cells = split(l);
    // pad short rows so column indices stay aligned
    while (cells.length < headers.length) cells.push('');
    return cells;
  });
  return { headers, rows };
}

/**
 * Compare pasted headers against the expected headers from sheets-config.
 * Returns { ok, expected, got, mismatches } — tolerant: case-insensitive,
 * ignores extra whitespace; extra/missing columns reported.
 */
function checkHeaders(meta, pastedHeaders) {
  const expected = (meta.columns || []).map((c) => c.header);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const mismatches = [];
  const n = Math.max(expected.length, pastedHeaders.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i];
    const g = pastedHeaders[i];
    if (e === undefined) { mismatches.push({ index: i, expected: '(none)', got: g, issue: 'extra column' }); continue; }
    if (g === undefined) { mismatches.push({ index: i, expected: e, got: '(missing)', issue: 'missing column' }); continue; }
    if (norm(e) !== norm(g)) mismatches.push({ index: i, expected: e, got: g, issue: 'name differs' });
  }
  return { ok: mismatches.length === 0, expected, got: pastedHeaders, mismatches };
}

async function runHandler(db, key, meta, rows, opts = {}) {
  if (key === 'users') return [];
  if (key === 'master') {
    const out = [];
    // Default column mapping for master: pasted index -> db field.
    const defaultMap = {
      0: 'geo', 1: 'pn', 2: 'name', 3: 'description', 4: 'description_es',
      5: 'category', 6: 'sub_category', 7: 'brand', 8: 'supplier',
      9: 'unit', 10: 'cost', 11: 'min_qty', 12: 'max_qty', 13: 'eta',
      14: 'is_active'
    };
    const cm = opts.columnMap && Object.keys(opts.columnMap).length ? opts.columnMap : defaultMap;
    // cm maps pastedIdx -> dbField. Invert: dbField -> pastedIdx.
    const fieldToIdx = {};
    Object.entries(cm).forEach(([pi, f]) => { fieldToIdx[f] = parseInt(pi, 10); });
    for (const r of rows) {
      const gi = fieldToIdx['geo']; const ni = fieldToIdx['name']; if (!r[gi] && !r[ni]) continue;
      const create = Boolean(opts.createRefs);
      const cat = toValue(r[fieldToIdx['category']]);
      const sub = toValue(r[fieldToIdx['sub_category']]);
      const brand = toValue(r[fieldToIdx['brand']]);
      const sup = toValue(r[fieldToIdx['supplier']]);
      out.push({
        table: meta.dbTable,
        record: {
          geo: toValue(r[fieldToIdx['geo']]),
          pn: toValue(r[fieldToIdx['pn']]),
          name: toValue(r[fieldToIdx['name']]),
          description: toValue(r[fieldToIdx['description']]),
          description_es: toValue(r[fieldToIdx['description_es']]),
          category_id: await refId(db, 'categories', cat, create),
          category_name: cat,
          sub_category_id: await refId(db, 'sub_categories', sub, create),
          sub_category_name: sub,
          brand_id: await refId(db, 'brands', brand, create),
          brand_name: brand,
          supplier_id: await refId(db, 'suppliers', sup, create),
          supplier_name: sup,
          unit: toValue(r[fieldToIdx['unit']]),
          cost: toValue(r[fieldToIdx['cost']], Number),
          min_qty: toValue(r[fieldToIdx['min_qty']], Number),
          max_qty: toValue(r[fieldToIdx['max_qty']], Number),
        },
        keys: meta.naturalKey,
      });
    }
    return out;
  }
  if (key === 'validation') {
    // readSheet() already strips the header row, so rows[0] is the first
    // data row of the Validation sheet (sites section, cols A:C).
    const out = [];
    for (const r of rows) {
      if (!r[0]) continue;
      out.push({ table: 'sites', record: { name: toValue(r[0]), email: toValue(r[1]), suffix: toValue(r[2]) }, keys: ['name'] });
    }
    return out;
  }
  if (key === 'config') {
    return rows.filter((r) => r[0]).map((r) => ({ table: meta.dbTable, record: { key: toValue(r[0]), value: toValue(r[1]) }, keys: ['key'] }));
  }
  return rows.map((r) => ({ table: meta.dbTable, record: mapRow(meta, r), keys: meta.naturalKey }));
}

class Importer {
  constructor(db, sheetsClient) { this.db = db; this.sheets = sheetsClient; }
  /**
   * Dry-run: read a sheet and map rows to DB records WITHOUT writing.
   * Returns row counts + insert/update breakdown + sample records for GUI preview.
   */
  async previewSheet(key, opts = {}) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, gasSheet: meta.gasSheet, table: meta.dbTable, skipped: true, total: 0, inserts: 0, updates: 0, sample: [] };
    const data = await this.sheets.readSheet(meta.gasSheet, undefined, opts.sheetId);
    const items = await runHandler(this.db, key, meta, data.rows);
    const valid = items.filter((i) => i && Object.keys(i.record || {}).length);
    let inserts = 0;
    let updates = 0;
    for (const item of valid) {
      try {
        const existing = await findByKeys(this.db, item.table, item.record, item.keys || []);
        if (existing) updates++; else inserts++;
      } catch (e) { inserts++; }
    }
    return {
      key,
      gasSheet: meta.gasSheet,
      table: meta.dbTable,
      headers: data.headers,
      total: valid.length,
      rawRows: data.rows.length,
      inserts,
      updates,
      sample: valid.slice(0, 10).map((i) => i.record),
    };
  }
  /** Dry-run across ALL sheets. */
  async previewAll(opts = {}) {
    const summary = { started: new Date().toISOString(), sheets: [] };
    for (const key of Object.keys(cfg.SHEETS)) {
      try { summary.sheets.push(await this.previewSheet(key, opts)); }
      catch (err) { summary.sheets.push({ key, error: err.message }); }
    }
    return summary;
  }
  /**
   * Dry-run from pasted text: parse -> header check -> map -> insert/update
   * counts + sample. Writes NOTHING.
   */
  async previewPasted(key, text, columnMap) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, skipped: true, total: 0, inserts: 0, updates: 0, sample: [] };
    const parsed = parsePasted(text);
    if (!parsed.headers.length) throw new Error('No data detected — paste the sheet including its header row');
    const headerCheck = checkHeaders(meta, parsed.headers);
    const items = await runHandler(this.db, key, meta, parsed.rows, { createRefs: true, columnMap });
    const valid = items.filter((i) => i && Object.keys(i.record || {}).length);
    let inserts = 0;
    let updates = 0;
    for (const item of valid) {
      try {
        const existing = await findByKeys(this.db, item.table, item.record, item.keys || []);
        if (existing) updates++; else inserts++;
      } catch (e) { inserts++; }
    }
    return {
      key,
      gasSheet: meta.gasSheet,
      table: meta.dbTable,
      source: 'pasted',
      headers: parsed.headers,
      headerCheck,
      total: valid.length,
      rawRows: parsed.rows.length,
      inserts,
      updates,
      sample: valid.slice(0, 10).map((i) => i.record),
    };
  }
  /** Real import from pasted text (call only after user confirms preview). */
  async importPasted(key, text, columnMap) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, imported: 0, skipped: true, errors: [] };
    const parsed = parsePasted(text);
    const items = await runHandler(this.db, key, meta, parsed.rows, { createRefs: true, columnMap });
    let imported = 0;
    const errors = [];
    for (const item of items) {
      if (!item || !Object.keys(item.record || {}).length) continue;
      try {
        const res = await upsert(this.db, item.table, item.record, item.keys || []);
        await audit(this.db, item.table, res.id, res.action, item.record);
        imported++;
      } catch (err) { errors.push({ row: item.record, message: err.message }); }
    }
    return { key, gasSheet: meta.gasSheet, table: meta.dbTable, source: 'pasted', imported, skipped: false, errors };
  }
  async importSheet(key) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, imported: 0, skipped: true, errors: [] };
    const data = await this.sheets.readSheet(meta.gasSheet);
    const items = await runHandler(this.db, key, meta, data.rows);
    let imported = 0;
    const errors = [];
    for (const item of items) {
      if (!item || !Object.keys(item.record || {}).length) continue;
      try {
        const res = await upsert(this.db, item.table, item.record, item.keys || []);
        await audit(this.db, item.table, res.id, res.action, item.record);
        imported++;
      } catch (err) { errors.push({ row: item.record, message: err.message }); }
    }
    return { key, gasSheet: meta.gasSheet, table: meta.dbTable, imported, skipped: false, errors };
  }
  async importAll() {
    const summary = { started: new Date().toISOString(), sheets: [] };
    for (const key of Object.keys(cfg.SHEETS)) {
      try { summary.sheets.push(await this.importSheet(key)); }
      catch (err) { summary.sheets.push({ key, error: err.message }); }
    }
    return summary;
  }
}

module.exports = { Importer, mapRow, upsert, audit, refId, shouldSkip, SKIP, toValue, parsePasted, checkHeaders };
