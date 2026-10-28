const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pinHash = bcrypt.hashSync('1234', 10);

const sql = [
  '-- Seed default config',
  "INSERT OR IGNORE INTO config (key, value) VALUES ('app_name', 'RECON ERP');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('version', '1.0.0');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('currency_default', 'USD');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('reqEmailEnabled', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('reqPdfEnabled', 'true');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoEmailEnabled', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoPdfEnabled', 'true');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailPending', 'true');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailQuoted', 'true');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailApproved', 'true');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailSent', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailReceived', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailDespatched', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailFinalReceived', 'false');",
  "INSERT OR IGNORE INTO config (key, value) VALUES ('company_logo', '');",
  '',
  '-- Seed default users (PIN: 1234)',
  `INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1001', 'Admin User', 'admin@recon.local', '${pinHash}', 'MAIN', 'admin', 1);`,
  `INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1002', 'Manager User', 'manager@recon.local', '${pinHash}', 'MAIN', 'manager', 1);`,
  `INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1003', 'Operator User', 'operator@recon.local', '${pinHash}', 'MAIN', 'operator', 1);`,
  '',
  '-- Seed sites',
  "INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-001', 'Main Warehouse', 'MAIN', 1);",
  "INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-002', 'Site Alpha', 'ALPHA', 1);",
  "INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-003', 'Site Bravo', 'BRAVO', 1);",
  '',
  '-- Seed categories',
  "INSERT OR IGNORE INTO categories (name, active) VALUES ('Electrical', 1);",
  "INSERT OR IGNORE INTO categories (name, active) VALUES ('Mechanical', 1);",
  "INSERT OR IGNORE INTO categories (name, active) VALUES ('Safety', 1);",
  "INSERT OR IGNORE INTO categories (name, active) VALUES ('Consumables', 1);",
  "INSERT OR IGNORE INTO categories (name, active) VALUES ('Tools', 1);"
].join('\n');

const outPath = path.join(__dirname, '..', 'seed.sql');
fs.writeFileSync(outPath, sql, 'utf8');
console.log('seed.sql generated successfully at', outPath);
