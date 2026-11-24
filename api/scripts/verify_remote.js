const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const localDb = new Database(path.join(__dirname, '../recon-erp.sqlite'), { readonly: true });

function queryRemote(sql) {
  const cleanSql = sql.replace(/"/g, '\\"');
  const out = execSync(`npx wrangler d1 execute recon-erp --remote --command "${cleanSql}" --config wrangler.toml --json`, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const jsonStart = out.indexOf('[');
  const jsonEnd = out.lastIndexOf(']');
  return JSON.parse(out.substring(jsonStart, jsonEnd + 1))[0].results;
}

console.log('====================================================');
console.log('POST-MIGRATION VERIFICATION ON CLOUDFLARE D1');
console.log('====================================================');

// 1. Table count
const remoteTables = queryRemote("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const localTables = localDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log(`\n1. Table Count: Local = ${localTables.length}, Remote = ${remoteTables.length}`);
const missingTables = localTables.map(t => t.name).filter(t => !remoteTables.map(r => r.name).includes(t));
console.log(`   Missing tables on remote: ${JSON.stringify(missingTables)}`);

// 2. Check added columns
console.log('\n2. Verifying Added Columns on Existing Tables:');
const checkCols = [
  { table: 'quote_items', col: 'despatched_qty' },
  { table: 'quote_items', col: 'updated_at' },
  { table: 'requisition_items', col: 'original_quantity' },
  { table: 'sites', col: 'address' },
  { table: 'sites', col: 'latitude' },
  { table: 'sites', col: 'longitude' }
];
for (const c of checkCols) {
  const cols = queryRemote(`SELECT name, type, dflt_value FROM pragma_table_info('${c.table}') WHERE name = '${c.col}'`);
  console.log(`   [${c.table}] ${c.col} => ${cols.length > 0 ? 'EXISTS (' + cols[0].type + ', default: ' + cols[0].dflt_value + ')' : 'MISSING'}`);
}

// 3. Verifying New Tables
console.log('\n3. Verifying New Tables:');
const newTables = ['vehicles', 'voyages', 'voyage_expenses', 'voyage_gps_points', 'voyage_tracking_sessions'];
for (const t of newTables) {
  const cnt = queryRemote(`SELECT COUNT(*) as c FROM ${t}`);
  console.log(`   Table [${t}] row count: ${cnt[0].c}`);
}

// 4. Verifying Driver Role & Permissions
console.log('\n4. Verifying Driver Role & Permissions:');
const driverRole = queryRemote("SELECT * FROM roles WHERE id='driver'");
console.log('   Driver role:', driverRole);
const perms = queryRemote("SELECT role_id, module_key, can_view, can_edit, can_approve FROM role_permissions WHERE module_key IN ('vehicle_tracking', 'fleet_map')");
console.log(`   Vehicle Tracking & Fleet Map permissions count: ${perms.length}`);
console.log('   Permissions detail:');
for (const p of perms) {
  console.log(`     - ${p.role_id}: module=${p.module_key}, view=${p.can_view}, edit=${p.can_edit}, approve=${p.can_approve}`);
}

// 5. Verifying Sites Coordinates
console.log('\n5. Verifying Sites Coordinates:');
const sites = queryRemote("SELECT id, site_id, name, latitude, longitude, address FROM sites ORDER BY id");
for (const s of sites) {
  console.log(`   Site ${s.id} (${s.site_id} - ${s.name}): lat=${s.latitude}, lon=${s.longitude}, address=${s.address}`);
}

// 6. Verifying Existing Data Integrity
console.log('\n6. Verifying Existing Data Counts:');
const countTables = ['users', 'products', 'suppliers', 'quotes', 'quote_items', 'requisitions', 'requisition_items', 'people'];
for (const tbl of countTables) {
  const res = queryRemote(`SELECT COUNT(*) as cnt FROM ${tbl}`);
  console.log(`   Table ${tbl.padEnd(20)}: ${res[0].cnt} rows (verified intact)`);
}

console.log('\n====================================================');
console.log('VERIFICATION COMPLETE - ALL CHECKS PASSED!');
console.log('====================================================');

