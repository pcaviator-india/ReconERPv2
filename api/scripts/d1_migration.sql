-- =================================================================
-- SAFE NON-DESTRUCTIVE D1 MIGRATION
-- Generated on: 2026-11-12T13:18:55.799Z
-- NO DATA IS DELETED OR TRUNCATED OR OVERWRITTEN.
-- =================================================================

-- 1. ADD MISSING COLUMNS TO EXISTING TABLES
ALTER TABLE quote_items ADD COLUMN despatched_qty INTEGER DEFAULT 0;
ALTER TABLE quote_items ADD COLUMN updated_at TEXT;
ALTER TABLE requisition_items ADD COLUMN original_quantity INTEGER DEFAULT 0;
ALTER TABLE sites ADD COLUMN address TEXT;
ALTER TABLE sites ADD COLUMN latitude REAL;
ALTER TABLE sites ADD COLUMN longitude REAL;

-- 2. CREATE MISSING TABLES AND INDICES
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_number TEXT UNIQUE NOT NULL,
  vehicle_type TEXT,
  license_plate TEXT,
  capacity_kg REAL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vehicles_number ON vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_active ON vehicles(is_active);

CREATE TABLE IF NOT EXISTS voyages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_number TEXT UNIQUE NOT NULL,
  from_site TEXT,
  to_site TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id),
  driver_id TEXT,
  start_km INTEGER,
  end_km INTEGER,
  reason TEXT,
  start_time TEXT,
  end_time TEXT,
  total_expenses REAL DEFAULT 0,
  status TEXT DEFAULT 'IN_PROGRESS',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voyages_number ON voyages(voyage_number);
CREATE INDEX IF NOT EXISTS idx_voyages_driver ON voyages(driver_id);
CREATE INDEX IF NOT EXISTS idx_voyages_status ON voyages(status);
CREATE INDEX IF NOT EXISTS idx_voyages_created ON voyages(created_at);

CREATE TABLE IF NOT EXISTS voyage_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER REFERENCES voyages(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  description TEXT,
  receipt_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voyage_expenses_voyage ON voyage_expenses(voyage_id);

CREATE TABLE IF NOT EXISTS voyage_gps_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER REFERENCES voyages(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voyage_gps_voyage ON voyage_gps_points(voyage_id, timestamp);

CREATE TABLE IF NOT EXISTS voyage_tracking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER REFERENCES voyages(id) ON DELETE CASCADE,
  wake_lock_active INTEGER DEFAULT 0,
  pip_requested INTEGER DEFAULT 0,
  browser_visibility_state TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_voyage_tracking_voyage ON voyage_tracking_sessions(voyage_id);

-- 3. INSERT DRIVER ROLE IF NOT EXISTS
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES ('driver', 'Driver', 'Driver personnel with access to own vehicle tracking voyages', 1);

-- 4. INSERT ROLE PERMISSIONS FOR vehicle_tracking AND fleet_map
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('admin', 'vehicle_tracking', 1, 1, 1, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('admin', 'fleet_map', 1, 1, 1, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('manager', 'vehicle_tracking', 1, 1, 1, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('manager', 'fleet_map', 1, 1, 1, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('office', 'vehicle_tracking', 1, 1, 0, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('office', 'fleet_map', 1, 0, 0, 'all');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('user', 'vehicle_tracking', 1, 1, 0, 'assigned');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('user', 'fleet_map', 1, 0, 0, 'assigned');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('driver', 'vehicle_tracking', 1, 1, 0, 'assigned');
INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope) VALUES ('driver', 'fleet_map', 1, 0, 0, 'assigned');

-- 5. UPDATE SITE COORDINATES AND ADDRESSES (PRESERVING ALL OTHER SITE DATA)
UPDATE sites SET address = 'Faena MantoVerde, Chañaral, Región de Atacama', latitude = -26.5458, longitude = -70.2858 WHERE id = 4;
UPDATE sites SET address = 'Proyecto Valeriano (Atex Resources), Región de Atacama', latitude = -28.45, longitude = -69.88 WHERE id = 5;
UPDATE sites SET address = 'Proyecto Fénix Gold, Maricunga, Región de Atacama', latitude = -27.135, longitude = -69.34 WHERE id = 6;
UPDATE sites SET address = 'Faena La Coipa, Franja Maricunga, Región de Atacama', latitude = -26.8286, longitude = -69.2486 WHERE id = 7;
UPDATE sites SET address = 'Minera Centinela / Antucoya, Región de Antofagasta', latitude = -23.1167, longitude = -69.6 WHERE id = 8;
UPDATE sites SET address = 'Taller Central, Parque Industrial, La Serena, Coquimbo', latitude = -29.915, longitude = -71.248 WHERE id = 9;
UPDATE sites SET address = 'Bodega Central, Av. Balmaceda 1234, La Serena, Coquimbo', latitude = -29.9027, longitude = -71.2519 WHERE id = 10;
UPDATE sites SET address = 'Minera Cerro Bayo, Chile Chico, Región de Aysén', latitude = -46.54, longitude = -71.72 WHERE id = 11;
UPDATE sites SET address = 'Planta Dos Amigos, Domeyko / Vallenar, Región de Atacama', latitude = -28.5708, longitude = -70.76 WHERE id = 12;

-- 6. SEED VEHICLES TABLE WITH REGISTERED FLEET
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (1, 'TRK-001', 'Truck', 'ABC-1234', 5000, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (2, 'VAN-002', 'Van', 'XYZ-5678', 1500, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (3, 'TRK-003', 'Truck', 'DEF-9012', 8000, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (4, 'CAR-004', 'Car', 'GHI-3456', 500, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (5, 'CGTT-60', 'Vehicle', 'CGTT-60', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (6, 'DRPR-20', 'Vehicle', 'DRPR-20', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (7, 'GXXR-69', 'Vehicle', 'GXXR-69', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (8, 'HCPF-43', 'Vehicle', 'HCPF-43', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (9, 'LRTH-71', 'Vehicle', 'LRTH-71', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (10, 'SXSV-20', 'Vehicle', 'SXSV-20', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (11, 'SXSW-67', 'Vehicle', 'SXSW-67', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (12, 'SXSW-68', 'Vehicle', 'SXSW-68', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (13, 'TRSW-10', 'Vehicle', 'TRSW-10', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (14, 'TVBS-65', 'Vehicle', 'TVBS-65', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (15, 'TVBS-67', 'Vehicle', 'TVBS-67', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (16, 'TVBS-70', 'Vehicle', 'TVBS-70', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (17, 'TVCR-12', 'Vehicle', 'TVCR-12', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (18, 'TVKV-17', 'Vehicle', 'TVKV-17', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (19, 'TWPZ-32', 'Vehicle', 'TWPZ-32', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (20, 'TYKR-69', 'Vehicle', 'TYKR-69', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (21, 'TYKR-70', 'Vehicle', 'TYKR-70', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (22, 'VDWK-45', 'Vehicle', 'VDWK-45', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (23, 'VDWK-46', 'Vehicle', 'VDWK-46', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (24, 'VDWK-47', 'Vehicle', 'VDWK-47', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (25, 'VDWK-48', 'Vehicle', 'VDWK-48', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (26, 'VFPJ-19', 'Vehicle', 'VFPJ-19', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (27, 'VGPS-15', 'Vehicle', 'VGPS-15', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (28, 'VKJZ-72', 'Vehicle', 'VKJZ-72', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (29, 'VFTF-19', 'Vehicle', 'VFTF-19', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (30, 'HHHF-15', 'Vehicle', 'HHHF-15', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (31, 'VPJH-12', 'Vehicle', 'VPJH-12', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (32, 'TVKR-49', 'Vehicle', 'TVKR-49', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (33, 'TVCS-80', 'Vehicle', 'TVCS-80', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (34, 'TBVS-65', 'Vehicle', 'TBVS-65', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (35, 'VJYD-41', 'Vehicle', 'VJYD-41', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (36, 'GFBZ-80', 'Vehicle', 'GFBZ-80', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (37, 'SHPY-36', 'Vehicle', 'SHPY-36', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (38, 'TSLL-10', 'Vehicle', 'TSLL-10', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (39, 'TCPF-87', 'Vehicle', 'TCPF-87', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (40, 'VYSP-99', 'Vehicle', 'VYSP-99', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (41, 'TSLP-10', 'Vehicle', 'TSLP-10', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (42, 'TBKR-49', 'Vehicle', 'TBKR-49', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (43, 'TSLL-83', 'Vehicle', 'TSLL-83', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (44, 'VGPS-62', 'Vehicle', 'VGPS-62', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (45, 'VYJB-53', 'Vehicle', 'VYJB-53', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (46, 'VPJG-96', 'Vehicle', 'VPJG-96', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (47, 'VFJP-19', 'Vehicle', 'VFJP-19', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (48, 'TSLP-13', 'Vehicle', 'TSLP-13', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (49, 'TYFG-14', 'Vehicle', 'TYFG-14', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (50, 'VPJH-11', 'Vehicle', 'VPJH-11', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (51, 'VPJH-13', 'Vehicle', 'VPJH-13', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (52, 'TYRJ-47', 'Vehicle', 'TYRJ-47', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (53, 'VRXL-25', 'Vehicle', 'VRXL-25', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (54, 'THVP-75', 'Vehicle', 'THVP-75', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (55, 'TSLL-95', 'Vehicle', 'TSLL-95', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (56, 'VHRK-65', 'Vehicle', 'VHRK-65', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (57, 'RGYY-85', 'Vehicle', 'RGYY-85', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (58, 'VFTG-89', 'Vehicle', 'VFTG-89', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (59, 'SZZT-98', 'Vehicle', 'SZZT-98', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (60, 'VYHJ-99', 'Vehicle', 'VYHJ-99', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (61, 'HPZC-21', 'Vehicle', 'HPZC-21', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (62, 'WDPG-66', 'Vehicle', 'WDPG-66', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (63, 'TPFD-60', 'Vehicle', 'TPFD-60', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (64, 'VHRK-68', 'Vehicle', 'VHRK-68', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (65, 'SXLR-59', 'Vehicle', 'SXLR-59', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (66, 'VCBY-67', 'Vehicle', 'VCBY-67', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (67, 'VFZG-14', 'Vehicle', 'VFZG-14', NULL, 1);
INSERT OR IGNORE INTO vehicles (id, vehicle_number, vehicle_type, license_plate, capacity_kg, is_active) VALUES (68, 'WCYP-18', 'Vehicle', 'WCYP-18', NULL, 1);