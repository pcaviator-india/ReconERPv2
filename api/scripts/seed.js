/**
 * Seed script for local development
 * Creates SQLite database from schema.sql and inserts default data
 *
 * Usage: node scripts/seed.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'recon-erp.sqlite');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

console.log(`Using database: ${DB_PATH}`);

// Remove existing database
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('Removed existing database');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Execute schema
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
// Split by semicolons at line ends, but keep CREATE TABLE statements intact
const statements = schema.split(/;\s*\n/).filter(s => s.trim().length > 0);

for (const stmt of statements) {
  if (stmt.trim()) {
    try {
      db.exec(stmt + ';');
    } catch (err) {
      // Skip errors from already-existing objects
      if (!err.message.includes('already exists')) {
        console.error('Error executing statement:', err.message);
        console.error('Statement:', stmt.substring(0, 100) + '...');
      }
    }
  }
}

console.log('Schema created successfully');

// Seed default config
const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
insertConfig.run('app_name', 'RECON ERP');
insertConfig.run('version', '1.0.0');
insertConfig.run('currency_default', 'USD');
// Feature flags formerly read from the Config sheet (getAdminData)
insertConfig.run('reqEmailEnabled', 'false');
insertConfig.run('reqPdfEnabled', 'true');
insertConfig.run('quoEmailEnabled', 'false');
insertConfig.run('quoPdfEnabled', 'true');
insertConfig.run('quoteEmailPending', 'true');
insertConfig.run('quoteEmailQuoted', 'true');
insertConfig.run('quoteEmailApproved', 'true');
insertConfig.run('quoteEmailSent', 'false');
insertConfig.run('quoteEmailReceived', 'false');
insertConfig.run('quoteEmailDespatched', 'false');
insertConfig.run('quoteEmailFinalReceived', 'false');
insertConfig.run('company_logo', '');
console.log('Default config seeded');

// Seed default users (all with PIN 1234 for development)
const defaultPin = process.env.DEFAULT_PIN || '1234';
const pinHash = bcrypt.hashSync(defaultPin, 10);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

const defaultUsers = [
  { user_id: '1001', name: 'Admin User', email: 'admin@recon.local', site: 'MAIN', role: 'admin' },
  { user_id: '1002', name: 'Manager User', email: 'manager@recon.local', site: 'MAIN', role: 'manager' },
  { user_id: '1003', name: 'Operator User', email: 'operator@recon.local', site: 'MAIN', role: 'operator' },
];

for (const user of defaultUsers) {
  insertUser.run(user.user_id, user.name, user.email, pinHash, user.site, user.role);
}

console.log(`Seeded ${defaultUsers.length} users with PIN: ${defaultPin}`);

// Seed reference data
const insertSite = db.prepare('INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES (?, ?, ?, 1)');
insertSite.run('SITE-001', 'Main Warehouse', 'MAIN');
insertSite.run('SITE-002', 'Site Alpha', 'ALPHA');
insertSite.run('SITE-003', 'Site Bravo', 'BRAVO');

const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, active) VALUES (?, 1)');
insertCategory.run('Electrical');
insertCategory.run('Mechanical');
insertCategory.run('Safety');
insertCategory.run('Consumables');
insertCategory.run('Tools');

console.log('Reference data seeded');

// Seed sample brands and suppliers (referenced by products/quotes FKs)
const insertBrand = db.prepare('INSERT OR IGNORE INTO brands (name, active) VALUES (?, 1)');
['Bosch', '3M', 'DeWalt', 'SKF', 'Mobil'].forEach(n => insertBrand.run(n));

const insertSupplier = db.prepare('INSERT OR IGNORE INTO suppliers (name, contact_person, email, phone, active) VALUES (?, ?, ?, ?, 1)');
[
  ['Acme Industrial Supply', 'John Doe', 'sales@acme.example', '+1-555-0100'],
  ['Global Parts Ltd', 'Jane Smith', 'contact@globalparts.example', '+1-555-0200'],
  ['Safety First Corp', 'Bob Wilson', 'info@safetyfirst.example', '+1-555-0300']
].forEach(s => insertSupplier.run(...s));

console.log('Brands and suppliers seeded');

// Seed some sample products
const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (geo, name, description, category_id, brand_id, supplier_id, unit, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`);

// Get category IDs
const catIds = {};
db.prepare('SELECT id, name FROM categories').all().forEach(row => { catIds[row.name] = row.id; });

const sampleProducts = [
  { geo: 'GEO-0001', name: 'Safety Helmet', desc: 'Industrial safety helmet', cat: 'Safety', unit: 'pcs' },
  { geo: 'GEO-0002', name: 'Cable Tie 200mm', desc: 'Nylon cable tie', cat: 'Electrical', unit: 'pcs' },
  { geo: 'GEO-0003', name: 'Wrench Set', desc: 'Combination wrench set 6-22mm', cat: 'Tools', unit: 'set' },
  { geo: 'GEO-0004', name: 'Lubricant Spray', desc: 'Multi-purpose lubricant', cat: 'Consumables', unit: 'can' },
  { geo: 'GEO-0005', name: 'Bearing 6205', desc: 'Deep groove ball bearing', cat: 'Mechanical', unit: 'pcs' },
];

for (const p of sampleProducts) {
  insertProduct.run(p.geo, p.name, p.desc, catIds[p.cat] || null, null, null, p.unit);
}

console.log(`Seeded ${sampleProducts.length} sample products`);

// Seed stock for sample products
const insertStock = db.prepare(`
  INSERT INTO stock (item_id, site_id, quantity, min_level, max_level, is_active)
  VALUES (?, ?, ?, ?, ?, 1)
`);

const siteRows = db.prepare('SELECT id FROM sites').all();
const productRows = db.prepare('SELECT id FROM products').all();

for (const product of productRows) {
  for (const site of siteRows) {
    const qty = Math.floor(Math.random() * 100) + 10;
    insertStock.run(product.id, site.id, qty, 5, 200);
  }
}

console.log('Stock seeded');

// Summary
const counts = {
  users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
  sites: db.prepare('SELECT COUNT(*) as c FROM sites').get().c,
  categories: db.prepare('SELECT COUNT(*) as c FROM categories').get().c,
  products: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
  stock: db.prepare('SELECT COUNT(*) as c FROM stock').get().c,
};

console.log('\n=== Seed Complete ===');
console.log(`Users: ${counts.users}`);
console.log(`Sites: ${counts.sites}`);
console.log(`Categories: ${counts.categories}`);
console.log(`Products: ${counts.products}`);
console.log(`Stock records: ${counts.stock}`);
console.log(`\nLogin with: user_id 1001, PIN ${defaultPin}`);

db.close();
