const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, '../recon-erp.sqlite'), { readonly: true });

const missingTables = ['vehicles', 'voyages', 'voyage_expenses', 'voyage_gps_points', 'voyage_tracking_sessions'];

console.log('Generating non-destructive migration script...');

let sqlStatements = [];

sqlStatements.push('-- =================================================================');
sqlStatements.push('-- SAFE NON-DESTRUCTIVE D1 MIGRATION');
sqlStatements.push('-- Generated on: ' + new Date().toISOString());
sqlStatements.push('-- NO DATA IS DELETED OR TRUNCATED OR OVERWRITTEN.');
sqlStatements.push('-- =================================================================\n');

// 1. ALTER TABLE ADD COLUMN for existing tables
sqlStatements.push('-- 1. ADD MISSING COLUMNS TO EXISTING TABLES');
sqlStatements.push('ALTER TABLE quote_items ADD COLUMN despatched_qty INTEGER DEFAULT 0;');
sqlStatements.push('ALTER TABLE quote_items ADD COLUMN updated_at TEXT;');
sqlStatements.push('ALTER TABLE requisition_items ADD COLUMN original_quantity INTEGER DEFAULT 0;');
sqlStatements.push('ALTER TABLE sites ADD COLUMN address TEXT;');
sqlStatements.push('ALTER TABLE sites ADD COLUMN latitude REAL;');
sqlStatements.push('ALTER TABLE sites ADD COLUMN longitude REAL;\n');

// 2. CREATE TABLE IF NOT EXISTS for missing tables
sqlStatements.push('-- 2. CREATE MISSING TABLES AND INDICES');
for (const tbl of missingTables) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tbl);
  let createSql = row.sql.trim();
  if (!createSql.includes('IF NOT EXISTS')) {
    createSql = createSql.replace(/CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  }
  sqlStatements.push(createSql + ';\n');

  // Indices
  const idxs = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(tbl);
  for (const idx of idxs) {
    let idxSql = idx.sql.trim();
    if (!idxSql.includes('IF NOT EXISTS')) {
      idxSql = idxSql.replace(/CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ');
    }
    sqlStatements.push(idxSql + ';');
  }
  sqlStatements.push('');
}

// 3. Seed 'driver' role if not exists
sqlStatements.push('-- 3. INSERT DRIVER ROLE IF NOT EXISTS');
sqlStatements.push("INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES ('driver', 'Driver', 'Driver personnel with access to own vehicle tracking voyages', 1);\n");

// 4. Seed role permissions for vehicle_tracking and fleet_map
sqlStatements.push('-- 4. INSERT ROLE PERMISSIONS FOR vehicle_tracking AND fleet_map');
const newPerms = db.prepare("SELECT role_id, module_key, can_view, can_edit, can_approve, site_scope FROM role_permissions WHERE module_key IN ('vehicle_tracking', 'fleet_map')").all();
for (const p of newPerms) {
  sqlStatements.push(`INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('${p.role_id}', '${p.module_key}', ${p.can_view}, ${p.can_edit}, ${p.can_approve}, '${p.site_scope}');`);
}
sqlStatements.push('');

// 5. Update site coordinates (sites 4..12)
sqlStatements.push('-- 5. UPDATE SITE COORDINATES AND ADDRESSES (PRESERVING ALL OTHER SITE DATA)');
const sites = db.prepare("SELECT id, name, address, latitude, longitude FROM sites WHERE latitude IS NOT NULL").all();
for (const s of sites) {
  const addr = s.address ? `'${s.address.replace(/'/g, "''")}'` : 'NULL';
  sqlStatements.push(`UPDATE sites SET address = ${addr}, latitude = ${s.latitude}, longitude = ${s.longitude} WHERE id = ${s.id};`);
}
sqlStatements.push('');

// 6. Seed vehicles into vehicles table
sqlStatements.push('-- 6. SEED VEHICLES TABLE WITH REGISTERED FLEET');
const vehicles = db.prepare("SELECT id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active FROM vehicles").all();
for (const v of vehicles) {
  const type = v.vehicle_type ? `'${v.vehicle_type.replace(/'/g, "''")}'` : 'NULL';
  const plate = v.license_plate ? `'${v.license_plate.replace(/'/g, "''")}'` : 'NULL';
  const cap = v.capacity_kg != null ? v.capacity_kg : 'NULL';
  sqlStatements.push(`INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (${v.id}, '${v.vehicle_number}', ${type}, ${plate}, ${cap}, ${v.is_active});`);
}

const migrationFile = path.join(__dirname, 'd1_migration.sql');
fs.writeFileSync(migrationFile, sqlStatements.join('\n'));
console.log(`Generated migration script at ${migrationFile} (${sqlStatements.length} lines)`);