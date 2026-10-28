const cfg = require('./sheets-config');
function ident(col) {
  return '"' + String(col).replace(/"/g, '""') + '"';
}

const SKIP = new Set(['dashboard', 'rfq', 'reportes', 'solicitudes']);

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_()\/]/g, '');
}

function toValue(raw, parse) {
  if (raw === null || raw === undefined || raw === '') return null;
  // If parsing a number (Cost, MinQty, MaxQty), strip currency symbols & commas (e.g. "$50" -> 50)
  if (parse === Number || (parse && parse.name === 'Number')) {
    const cleaned = String(raw).replace(/[\$,]/g, '').trim();
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  }
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
  for (const col of meta.columns) {
    let rawIdx = col.index;
    if (columnMap) {
      const mappedIdx = Object.entries(columnMap).find(([, f]) => {
        if (!f) return false;
        return f === col.dbField || f === col.header ||
               f.toLowerCase() === col.dbField.toLowerCase() ||
               f.toLowerCase() === col.header.toLowerCase() ||
               norm(f) === norm(col.dbField) ||
               norm(f) === norm(col.header);
      });
      if (mappedIdx) rawIdx = parseInt(mappedIdx[0], 10);
      else continue;
    }
    const raw = row[rawIdx];
    if (raw === undefined || raw === '') continue;
    const v = toValue(raw, col.parse);
    if (v === undefined || v === '') continue;
    record[col.dbField] = v;
  }
  return record;
}

const refCache = new Map();

async function refId(db, table, name, create) {
  if (!name) return null;
  const clean = String(name).trim();
  if (!clean) return null;
  const cacheKey = `${table}:${clean.toLowerCase()}`;
  if (refCache.has(cacheKey)) {
    return refCache.get(cacheKey);
  }
  const stmt = await db.prepare('SELECT id FROM ' + ident(table) + ' WHERE name = ? LIMIT 1');
  const row = await stmt.bind(clean).first();
  if (row) {
    refCache.set(cacheKey, row.id);
    return row.id;
  }
  if (create) {
    try {
      const ins = await db.prepare('INSERT INTO ' + ident(table) + ' (name) VALUES (?)');
      const res = await ins.bind(clean).run();
      const newId = res && res.meta && res.meta.last_row_id ? res.meta.last_row_id : null;
      if (newId) {
        refCache.set(cacheKey, newId);
        return newId;
      }
    } catch (e) {
      // Ignore conflict / concurrent insert
    }
    const retry = await (await db.prepare('SELECT id FROM ' + ident(table) + ' WHERE name = ? LIMIT 1')).bind(clean).first();
    const finalId = retry ? retry.id : null;
    if (finalId) refCache.set(cacheKey, finalId);
    return finalId;
  }
  return null;
}

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
  } catch (e) { /* audit_log may not exist */ }
}

function shouldSkip(key) { return SKIP.has(key); }

function parsePasted(text, hasHeaderRow = true) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const split = (line) => {
    if (delim === '\t') return line.split('\t').map((c) => c.trim());
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else { q = !q; }
      } else if (ch === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  if (!hasHeaderRow) {
    const rows = lines.map(split);
    const colCount = rows[0] ? rows[0].length : 0;
    const headers = Array.from({ length: colCount }, (_, i) => `Col ${i + 1}`);
    return { headers, rows };
  }

  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function checkHeaders(meta, actual) {
  const expected = (meta.columns || []).map((c) => c.header);
  const mismatches = [];
  const max = Math.max(expected.length, actual.length);
  for (let i = 0; i < max; i++) {
    const exp = expected[i] || '(missing)';
    const got = actual[i] || '(missing)';
    if (exp !== got && norm(exp) !== norm(got)) mismatches.push({ index: i, expected: exp, got });
  }
  return {
    ok: mismatches.length === 0,
    expectedCount: expected.length,
    actualCount: actual.length,
    mismatches,
  };
}

async function runHandler(db, key, meta, rows, opts = {}) {
  if (key === 'users') return [];
  if (key === 'master') {
    const out = [];
    const defaultMap = {
      0: 'geo', 1: 'pn', 2: 'name', 3: 'description', 4: 'description_es',
      5: 'category', 6: 'sub_category', 7: 'brand', 8: 'supplier',
      9: 'unit', 10: 'cost', 11: 'min_qty', 12: 'max_qty', 13: 'eta',
      14: 'is_active'
    };
    const cm = opts.columnMap && Object.keys(opts.columnMap).length ? opts.columnMap : defaultMap;
    const fieldToIdx = {};
    Object.entries(cm).forEach(([pi, f]) => {
      if (!f) return;
      const idx = parseInt(pi, 10);
      fieldToIdx[f] = idx;
      fieldToIdx[String(f).toLowerCase()] = idx;
      fieldToIdx[norm(f)] = idx;
    });

    const getIdx = (...names) => {
      for (const n of names) {
        if (fieldToIdx[n] !== undefined) return fieldToIdx[n];
        if (fieldToIdx[n.toLowerCase()] !== undefined) return fieldToIdx[n.toLowerCase()];
        if (fieldToIdx[norm(n)] !== undefined) return fieldToIdx[norm(n)];
      }
      return undefined;
    };

    const gi = getIdx('geo', 'id');
    const ni = getIdx('name', 'description');

    for (const r of rows) {
      // Keep row if either geo or name column has a value, OR if no mapping specified and row has content
      if (gi !== undefined && ni !== undefined) {
        if (!r[gi] && !r[ni]) continue;
      } else if (gi !== undefined) {
        if (!r[gi]) continue;
      } else if (ni !== undefined) {
        if (!r[ni]) continue;
      } else if (!r.some(Boolean)) {
        continue;
      }

      const create = Boolean(opts.createRefs);
      const cat = toValue(r[getIdx('category', 'category_id', 'categoria')]);
      const sub = toValue(r[getIdx('sub_category', 'subCategory', 'subcategory', 'sub_categoria')]);
      const brand = toValue(r[getIdx('brand', 'brand_id', 'marca')]);
      const sup = toValue(r[getIdx('supplier', 'supplier_id', 'proveedor')]);

      const nameVal = toValue(r[getIdx('name', 'nombre')]) || toValue(r[getIdx('description', 'description_en', 'descripcion')]) || '';
      const rawActive = toValue(r[getIdx('is_active', 'isactive', 'active')]);
      const isActive = rawActive !== undefined && rawActive !== null && rawActive !== '' ? (Number(rawActive) || 1) : 1;

      out.push({
        table: meta.dbTable,
        record: {
          geo: toValue(r[getIdx('geo', 'id')]),
          pn: toValue(r[getIdx('pn', 'part_number', 'p/n')]),
          name: nameVal,
          description: toValue(r[getIdx('description', 'description_en', 'descripcion')]),
          description_es: toValue(r[getIdx('description_es', 'descripcion_es')]),
          category_id: await refId(db, 'categories', cat, create),
          category_name: cat,
          sub_category_id: await refId(db, 'sub_categories', sub, create),
          sub_category_name: sub,
          brand_id: await refId(db, 'brands', brand, create),
          brand_name: brand,
          supplier_id: await refId(db, 'suppliers', sup, create),
          supplier_name: sup,
          unit: toValue(r[getIdx('unit', 'unidad')]),
          cost: toValue(r[getIdx('cost', 'costo')], Number),
          min_qty: toValue(r[getIdx('min_qty', 'minqty')], Number),
          max_qty: toValue(r[getIdx('max_qty', 'maxqty')], Number),
          is_active: isActive,
        },
        keys: meta.naturalKey,
      });
    }
    return out;
  }

  if (key === 'validation') {
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

  return rows.map((r) => ({ table: meta.dbTable, record: mapRow(meta, r, opts.columnMap), keys: meta.naturalKey }));
}

class Importer {
  constructor(db, sheetsClient) { this.db = db; this.sheets = sheetsClient; }

  async previewPasted(key, text, columnMap, hasHeaderRow = true) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, skipped: true, total: 0, inserts: 0, updates: 0, sample: [] };
    const parsed = parsePasted(text, hasHeaderRow);
    if (!parsed.headers.length) throw new Error('No data detected — paste the sheet data');
    const headerCheck = hasHeaderRow ? checkHeaders(meta, parsed.headers) : { ok: true, mismatches: [] };

    // Optimize preview for large datasets: sample only the first 20 rows to avoid subrequest limits
    const sampleRows = parsed.rows.slice(0, 20);
    const sampleItems = await runHandler(this.db, key, meta, sampleRows, { createRefs: false, columnMap });
    const sampleValid = sampleItems.filter((i) => i && Object.keys(i.record || {}).length);

    let sampleInserts = 0;
    let sampleUpdates = 0;
    for (const item of sampleValid) {
      try {
        const existing = await findByKeys(this.db, item.table, item.record, item.keys || []);
        if (existing) sampleUpdates++; else sampleInserts++;
      } catch (e) { sampleInserts++; }
    }

    return {
      key,
      gasSheet: meta.gasSheet,
      table: meta.dbTable,
      source: 'pasted',
      headers: parsed.headers,
      headerCheck,
      total: parsed.rows.length,
      rawRows: parsed.rows.length,
      inserts: sampleInserts,
      updates: sampleUpdates,
      sample: sampleValid.slice(0, 10).map((i) => i.record),
    };
  }

  async importPasted(key, text, columnMap, hasHeaderRow = true) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, imported: 0, skipped: true, errors: [] };
    const parsed = parsePasted(text, hasHeaderRow);
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

  async previewAll(opts = {}) {
    const summary = { started: new Date().toISOString(), sheets: [] };
    for (const key of Object.keys(cfg.SHEETS)) {
      try { summary.sheets.push(await this.previewSheet(key, opts)); }
      catch (err) { summary.sheets.push({ key, error: err.message }); }
    }
    return summary;
  }

  async importSheet(key) {
    const meta = cfg.SHEETS[key];
    if (!meta) throw new Error('Unknown sheet key: ' + key);
    if (shouldSkip(key)) return { key, imported: 0, skipped: true, errors: [] };
    const data = await this.sheets.readSheet(meta.gasSheet);
    const items = await runHandler(this.db, key, meta, data.rows, { createRefs: true });
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
    const summary = { started: new Date().toISOString(), imported: 0, sheets: [] };
    for (const key of Object.keys(cfg.SHEETS)) {
      try {
        const r = await this.importSheet(key);
        summary.sheets.push(r);
        summary.imported += r.imported || 0;
      } catch (err) {
        summary.sheets.push({ key, error: err.message });
      }
    }
    return summary;
  }
}

module.exports = { Importer, parsePasted, checkHeaders };
