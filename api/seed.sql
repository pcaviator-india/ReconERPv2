-- Seed default config
INSERT OR IGNORE INTO config (key, value) VALUES ('app_name', 'RECON ERP');
INSERT OR IGNORE INTO config (key, value) VALUES ('version', '1.0.0');
INSERT OR IGNORE INTO config (key, value) VALUES ('currency_default', 'USD');
INSERT OR IGNORE INTO config (key, value) VALUES ('reqEmailEnabled', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('reqPdfEnabled', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoEmailEnabled', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoPdfEnabled', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailPending', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailQuoted', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailApproved', 'true');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailSent', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailReceived', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailDespatched', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('quoteEmailFinalReceived', 'false');
INSERT OR IGNORE INTO config (key, value) VALUES ('company_logo', '');

-- Seed default users (PIN: 1234)
INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1001', 'Admin User', 'admin@recon.local', '$2a$10$Koh/e9USawQD5NVe2kKp0ORIiST78tqXhNy6jegFuDLz4IrkM0BsK', 'MAIN', 'admin', 1);
INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1002', 'Manager User', 'manager@recon.local', '$2a$10$Koh/e9USawQD5NVe2kKp0ORIiST78tqXhNy6jegFuDLz4IrkM0BsK', 'MAIN', 'manager', 1);
INSERT OR IGNORE INTO users (user_id, name, email, pin_hash, site, role, is_active) VALUES ('1003', 'Operator User', 'operator@recon.local', '$2a$10$Koh/e9USawQD5NVe2kKp0ORIiST78tqXhNy6jegFuDLz4IrkM0BsK', 'MAIN', 'operator', 1);

-- Seed sites
INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-001', 'Main Warehouse', 'MAIN', 1);
INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-002', 'Site Alpha', 'ALPHA', 1);
INSERT OR IGNORE INTO sites (site_id, name, code, active) VALUES ('SITE-003', 'Site Bravo', 'BRAVO', 1);

-- Seed categories
INSERT OR IGNORE INTO categories (name, active) VALUES ('Electrical', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Mechanical', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Safety', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Consumables', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Tools', 1);