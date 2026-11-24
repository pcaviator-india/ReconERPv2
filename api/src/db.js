/**
 * Database helper for Cloudflare D1
 * In Workers environment, DB is available via env.DB binding
 * For local development, falls back to better-sqlite3
 */
const fs = require('fs');
const path = require('path');
const { seedPermissions } = require('./utils/permissions-seed');

let Sqlite3 = null;
if (typeof process !== 'undefined' && process.versions && process.versions.node && !process.env.CF_WORKER) {
  try {
    // Dynamic require so esbuild does not bundle native better-sqlite3 into Workers
    const req = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : eval('require');
    Sqlite3 = req('better-sqlite3');
  } catch (e) {
    // better-sqlite3 not available — running in Workers environment
  }
}

// Migrations that ALTER existing tables. schema.sql only creates new tables
// (CREATE TABLE IF NOT EXISTS), so column additions need to be listed here.
const COLUMN_MIGRATIONS = [
  ['fuel_entries', 'proyecto', 'TEXT'],
  ['fuel_entries', 'tipo_activo', 'TEXT'],
  ['fuel_entries', 'asset_id', 'TEXT'],
  ['fuel_entries', 'user_email', 'TEXT'],
  ['fuel_entries', 'vehicle', 'TEXT'],
  ['fuel_entries', 'tank_id', 'INTEGER'],
  ['fuel_entries', 'site', 'TEXT'],
  ['fuel_purchases', 'tank_id', 'INTEGER'],
  ['fuel_purchases', 'site', 'TEXT'],
  ['labels', 'canvas_height', 'INTEGER'],
  ['bundles', 'name', 'TEXT'],
  ['bundles', 'is_active', 'INTEGER DEFAULT 1'],
  // requisitions
  ['requisitions', 'site', 'TEXT'],
  ['requisitions', 'quote_id', 'TEXT'],
  ['requisitions', 'po_status', 'TEXT'],
  ['requisitions', 'po_no', 'TEXT'],
  ['requisitions', 'category', 'TEXT'],
  ['requisitions', 'pdf_url', 'TEXT'],
  ['requisitions', 'quo_pdf_url', 'TEXT'],
  ['requisitions', 'last_modified_by', 'TEXT'],
  ['requisitions', 'last_modified_date', 'TEXT'],
  ['requisitions', 'mod_count', 'INTEGER DEFAULT 0'],
  ['requisitions', 'emails', 'TEXT'],
  ['requisitions', 'sub_area', 'TEXT'],
  ['requisitions', 'sub_area_no', 'TEXT'],
  // requisition_items
  ['requisition_items', 'geo', 'TEXT'],
  ['requisition_items', 'pn', 'TEXT'],
  ['requisition_items', 'description_es', 'TEXT'],
  ['requisition_items', 'item_notes', 'TEXT'],
  ['requisition_items', 'supplier_notes', 'TEXT'],
  ['requisition_items', 'images', 'TEXT'],
  ['requisition_items', 'original_quantity', 'INTEGER DEFAULT 0'],
  // quotes
  ['quotes', 'ref_id', 'TEXT'],
  ['quotes', 'supplier', 'TEXT'],
  ['quotes', 'site', 'TEXT'],
  ['quotes', 'ref_cotiz', 'TEXT'],
  ['quotes', 'fecha_acordada', 'TEXT'],
  ['quotes', 'comprador', 'TEXT'],
  ['quotes', 'comments', 'TEXT'],
  ['quotes', 'iva_inc', "TEXT DEFAULT 'Neto'"],
  ['quotes', 'condicion_pago', 'TEXT'],
  ['quotes', 'category', 'TEXT'],
  ['quotes', 'last_modified_by', 'TEXT'],
  ['quotes', 'last_modified_date', 'TEXT'],
  ['quotes', 'mod_count', 'INTEGER DEFAULT 0'],
  ['quotes', 'emails', 'TEXT'],
  ['quotes', 'quoted_doc_url', 'TEXT'],
  ['quotes', 'exchange_rate', 'REAL DEFAULT 1'],
  // quote_items
  ['quote_items', 'sub_category', 'TEXT'],
  ['quote_items', 'approved_qty', 'INTEGER DEFAULT 0'],
  ['quote_items', 'received_qty', 'INTEGER DEFAULT 0'],
  ['quote_items', 'despatched_qty', 'INTEGER DEFAULT 0'],
  ['quote_items', 'discount_pct', 'REAL DEFAULT 0'],
  ['quote_items', 'freight', 'REAL DEFAULT 0'],
  ['quote_items', 'status', "TEXT DEFAULT 'Pending'"],
  ['quote_items', 'supplier_quote_no', 'TEXT'],
  ['quote_items', 'quoted_doc_url', 'TEXT'],
  ['quote_items', 'updated_at', 'TEXT'],
  // stock & stock_ledger
  ['stock', 'geo', 'TEXT'],
  ['stock_ledger', 'ledger_id', 'TEXT'],
  ['stock_ledger', 'geo', 'TEXT'],
  ['stock_ledger', 'product_name', 'TEXT'],
  ['stock_ledger', 'sector_from', 'TEXT'],
  ['stock_ledger', 'sector_to', 'TEXT'],
  ['stock_ledger', 'new_balance', 'INTEGER DEFAULT 0'],
  ['stock_ledger', 'condition', 'TEXT'],
  // bundles & people & hse
  ['bundle_items', 'bundle_code', 'TEXT'],
  ['people', 'position', 'TEXT'],
  ['people', 'ingreso_date', 'TEXT'],
  ['hse_signatures', 'match_timestamp', 'TEXT'],
  ['hse_signatures', 'items_count', 'INTEGER DEFAULT 0'],
  ['hse_signatures', 'items_json', 'TEXT'],
  // Reference tables used by the Google Sheets sync routes.
  ['sites', 'email', 'TEXT'],
  ['sites', 'address', 'TEXT'],
  ['sites', 'latitude', 'REAL'],
  ['sites', 'longitude', 'REAL'],
  ['categories', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  ['brands', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  ['suppliers', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  ['sub_categories', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  // users
  ['users', 'phone', 'TEXT'],
  ['users', 'position', 'TEXT'],
  ['users', 'sign_link', 'TEXT'],
  ['users', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  ['users', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
];

// Reads schema.sql and returns the CREATE TABLE statements it contains.
function readSchemaStatements() {
  try {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (!fs.existsSync(schemaPath)) return [];
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    return schema
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch (e) {
    return [];
  }
}

// Applies the schema + column migrations. Safe to call repeatedly:
// every statement is CREATE TABLE IF NOT EXISTS or a guarded ALTER.
function applyMigrations(sqlite) {
  const stmts = readSchemaStatements();
  for (const stmt of stmts) {
    try {
      sqlite.exec(stmt + ';');
    } catch (err) {
      if (!/already exists/i.test(err.message)) {
        console.error('[db] schema statement failed:', err.message);
      }
    }
  }

  for (const [table, column, type] of COLUMN_MIGRATIONS) {
    try {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.length) continue;
      if (cols.some((c) => c.name === column)) continue;
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[db] migrated ${table}.${column}`);
    } catch (err) {
      console.error(`[db] migration ${table}.${column} failed:`, err.message);
    }
  }

  // Ensure default roles and permissions are seeded
  seedPermissions(sqlite);

  // Ensure initial mochilas exist and unassigned fuel records are migrated to Store Mochila 1
  seedFuelTanksAndMigrate(sqlite);

  // Ensure vehicles are seeded from movement_val catalog
  seedVehiclesFromMovementVal(sqlite);

  // Ensure site coordinates and addresses are populated
  seedSiteCoordinates(sqlite);
}

const SITE_GEO_DATA = [
  { name: 'Store', address: 'Bodega Central, Av. Balmaceda 1234, La Serena, Coquimbo', lat: -29.9027, lng: -71.2519 },
  { name: 'Workshop', address: 'Taller Central, Parque Industrial, La Serena, Coquimbo', lat: -29.9150, lng: -71.2480 },
  { name: 'Manto Verde', address: 'Faena MantoVerde, Chañaral, Región de Atacama', lat: -26.5458, lng: -70.2858 },
  { name: 'Coipa', address: 'Faena La Coipa, Franja Maricunga, Región de Atacama', lat: -26.8286, lng: -69.2486 },
  { name: 'Fenix', address: 'Proyecto Fénix Gold, Maricunga, Región de Atacama', lat: -27.1350, lng: -69.3400 },
  { name: 'AMSA', address: 'Minera Centinela / Antucoya, Región de Antofagasta', lat: -23.1167, lng: -69.6000 },
  { name: 'Atex', address: 'Proyecto Valeriano (Atex Resources), Región de Atacama', lat: -28.4500, lng: -69.8800 },
  { name: 'Dos Amigos', address: 'Planta Dos Amigos, Domeyko / Vallenar, Región de Atacama', lat: -28.5708, lng: -70.7600 },
  { name: 'Chile Chico', address: 'Minera Cerro Bayo, Chile Chico, Región de Aysén', lat: -46.5400, lng: -71.7200 }
];

function seedSiteCoordinates(sqlite) {
  try {
    const tableExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'").get();
    if (!tableExists) return;

    const updateStmt = sqlite.prepare(`
      UPDATE sites
      SET address = COALESCE(NULLIF(address, ''), ?),
          latitude = COALESCE(latitude, ?),
          longitude = COALESCE(longitude, ?)
      WHERE name = ? OR name LIKE ?
    `);

    for (const site of SITE_GEO_DATA) {
      updateStmt.run(site.address, site.lat, site.lng, site.name, `%${site.name}%`);
    }
  } catch (err) {
    console.error('[seedSiteCoordinates] Warning:', err.message);
  }
}

function seedVehiclesFromMovementVal(sqlite) {
  try {
    const tableExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vehicles'").get();
    if (!tableExists) return;

    const mvExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='movement_val'").get();
    if (mvExists) {
      sqlite.exec(`
        INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, is_active)
        SELECT DISTINCT TRIM(vehiculos), 'Vehicle', TRIM(vehiculos), 1
        FROM movement_val
        WHERE vehiculos IS NOT NULL AND TRIM(vehiculos) != ''
      `);
    }
  } catch (err) {
    console.error('[seedVehiclesFromMovementVal] Warning:', err.message);
  }
}

function seedFuelTanksAndMigrate(sqlite) {
  try {
    const tableExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fuel_tanks'").get();
    if (!tableExists) return;

    // Seed Store Mochila 1 & Store Mochila 2
    const insertTank = sqlite.prepare(`
      INSERT OR IGNORE INTO fuel_tanks (site, tank_code, name, capacity_liters, fuel_type, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertTank.run('Store', 'STORE-MOC-1', 'Mochila 1 (Principal)', 5000, 'Diesel', 1);
    insertTank.run('Store', 'STORE-MOC-2', 'Mochila 2', 5000, 'Diesel', 1);

    // Get ID of Store Mochila 1
    const m1 = sqlite.prepare("SELECT id FROM fuel_tanks WHERE tank_code = 'STORE-MOC-1'").get();
    if (m1 && m1.id) {
      // Migrate unassigned fuel_entries
      const updateEntries = sqlite.prepare(`
        UPDATE fuel_entries 
        SET tank_id = ?, site = COALESCE(NULLIF(site, ''), 'Store')
        WHERE tank_id IS NULL OR tank_id = 0
      `);
      const r1 = updateEntries.run(m1.id);
      if (r1.changes > 0) {
        console.log(`[db] Migrated ${r1.changes} fuel_entries to Store Mochila 1 (ID: ${m1.id})`);
      }

      // Migrate unassigned fuel_purchases
      const updatePurchases = sqlite.prepare(`
        UPDATE fuel_purchases 
        SET tank_id = ?, site = COALESCE(NULLIF(site, ''), 'Store')
        WHERE tank_id IS NULL OR tank_id = 0
      `);
      const r2 = updatePurchases.run(m1.id);
      if (r2.changes > 0) {
        console.log(`[db] Migrated ${r2.changes} fuel_purchases to Store Mochila 1 (ID: ${m1.id})`);
      }
    }
  } catch (err) {
    console.error('[seedFuelTanksAndMigrate] Warning:', err.message);
  }
}

class Database {
  constructor(env) {
    this.env = env;
    this._sqlite = null;

    // If no D1 binding (env.DB is null/undefined), use better-sqlite3
    if ((!this.env || !this.env.DB) && Sqlite3) {
      const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'recon-erp.sqlite');
      this._sqlite = new Sqlite3(dbPath);
      this._sqlite.pragma('journal_mode = WAL');
      // Ensure the schema exists and any pending column migrations are applied.
      applyMigrations(this._sqlite);
    }
  }

  async prepare(sql) {
    if (this._sqlite) {
      return new SqliteStatement(this._sqlite.prepare(sql));
    }
    return new D1Statement(this.env.DB.prepare(sql));
  }

  async batch(statements) {
    if (this._sqlite) {
      return statements.map(s => {
        if (s instanceof SqliteStatement) {
          return s.stmt.run(...s._bindings);
        }
        return s && s.raw ? s.raw.run() : null;
      });
    }
    return this.env.DB.batch(statements.map(s => s.raw));
  }
}

// D1 (Cloudflare Workers) statement wrapper
class D1Statement {
  constructor(stmt) {
    this.stmt = stmt;
    this._bindings = [];
  }

  bind(...values) {
    this._bindings = values;
    if (this.stmt && typeof this.stmt.bind === 'function') {
      this.stmt = this.stmt.bind(...values);
    }
    return this;
  }

  async run() {
    return this.stmt.run();
  }

  async all() {
    return this.stmt.all();
  }

  async first() {
    return this.stmt.first();
  }

  get raw() {
    return this.stmt;
  }
}

// better-sqlite3 statement wrapper (matches D1 API)
class SqliteStatement {
  constructor(stmt) {
    this.stmt = stmt;
    this._bindings = [];
  }

  bind(...values) {
    this._bindings = values;
    return this;
  }

  async run() {
    const info = this.stmt.run(...this._bindings);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid)
      }
    };
  }

  async all() {
    const results = this.stmt.all(...this._bindings);
    return {
      success: true,
      results
    };
  }

  async first() {
    const row = this.stmt.get(...this._bindings);
    return row || null;
  }

  get raw() {
    return this.stmt;
  }
}

module.exports = { Database, D1Statement, SqliteStatement };
