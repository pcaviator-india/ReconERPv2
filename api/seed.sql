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

-- Seed vehicles
INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES ('TRK-001', 'Truck', 'ABC-1234', 5000, 1);
INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES ('VAN-002', 'Van', 'XYZ-5678', 1500, 1);
INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES ('TRK-003', 'Truck', 'DEF-9012', 8000, 1);
INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES ('CAR-004', 'Car', 'GHI-3456', 500, 1);

-- Seed people
INSERT OR IGNORE INTO people (id, name, department, active, sector, rut, email) VALUES ('P-001', 'Juan Pérez', 'Operations', 1, 'Warehouse', '11.111.111-1', 'juan.perez@recon.local');
INSERT OR IGNORE INTO people (id, name, department, active, sector, rut, email) VALUES ('P-002', 'María García', 'Operations', 1, 'Warehouse', '11.111.111-2', 'maria.garcia@recon.local');
INSERT OR IGNORE INTO people (id, name, department, active, sector, rut, email) VALUES ('P-003', 'Carlos López', 'Transport', 1, 'Dispatch', '11.111.111-3', 'carlos.lopez@recon.local');
INSERT OR IGNORE INTO people (id, name, department, active, sector, rut, email) VALUES ('P-004', 'Ana Martínez', 'Logistics', 1, 'Dispatch', '11.111.111-4', 'ana.martinez@recon.local');