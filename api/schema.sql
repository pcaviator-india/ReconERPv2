-- RECON ERP D1 Schema (SQLite-compatible)
-- Aligned with API routes in src/routes/
-- Run on Cloudflare: wrangler d1 execute recon-erp --file=./schema.sql
-- Run locally: automatically applied via scripts/seed.js

-- System configuration (replaces Config sheet)
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Users (4-digit user_id + bcrypt-hashed 4-digit PIN)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  position TEXT,
  site TEXT,
  role TEXT DEFAULT 'operator',
  sign_link TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens (email link flow)
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);

-- Sites
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT UNIQUE,
  name TEXT NOT NULL,
  code TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Brands (marcas)
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers (proveedores)
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sub categories
CREATE TABLE IF NOT EXISTS sub_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  symbol TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sub areas (groups of emails used for notifications)
CREATE TABLE IF NOT EXISTS sub_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  site TEXT DEFAULT 'Workshop',
  suffix TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- People (replaces the "People" sheet: RD-xxx id, name, department, active,
-- sector, notes, rut, biometric template, email). This is a DIFFERENT entity
-- from `users` (which holds login credentials).
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT,
  department TEXT,
  active INTEGER DEFAULT 1,
  sector TEXT,
  notes TEXT,
  rut TEXT,
  biometric_template TEXT,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_people_rut ON people(rut);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);

-- Movement_Val (replaces the "Movement_Val" sheet): the master list of
-- sectors / machinery / generators / vehicles used to validate movements.
CREATE TABLE IF NOT EXISTS movement_val (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT,
  maquinaria TEXT,
  generadores TEXT,
  vehiculos TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Fuel purchases (replaces the "CompraCombustible" sheet). Kept separate
-- from `fuel_entries` (the "ControlCombustible" consumption sheet) so the
-- balance calculation stays faithful to the GAS original.
CREATE TABLE IF NOT EXISTS fuel_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_date TEXT DEFAULT CURRENT_TIMESTAMP,
  proveedor TEXT,
  litros REAL DEFAULT 0,
  factura TEXT,
  user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Macro history log (replaces the "MacroHistoryLog" sheet): audit trail of
-- bulk-PO compilations.
CREATE TABLE IF NOT EXISTS macro_history_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  user_email TEXT,
  po_count INTEGER DEFAULT 0,
  export_type TEXT,
  file_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Products / Master inventory
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geo TEXT UNIQUE NOT NULL,
  pn TEXT,
  name TEXT,
  description TEXT,
  description_es TEXT,
  category_id INTEGER REFERENCES categories(id),
  sub_category_id INTEGER REFERENCES sub_categories(id),
  brand_id INTEGER REFERENCES brands(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  unit TEXT,
  cost REAL DEFAULT 0,
  min_qty INTEGER DEFAULT 0,
  max_qty INTEGER DEFAULT 0,
  eta TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_geo ON products(geo);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);


-- Stock levels per site (replaces Stock sheet)
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES products(id),
  site_id INTEGER REFERENCES sites(id),
  product_name TEXT,
  location_type TEXT DEFAULT 'Sector',
  location_id TEXT,
  quantity INTEGER DEFAULT 0,
  min_level INTEGER DEFAULT 0,
  max_level INTEGER DEFAULT 0,
  reserved_qty INTEGER DEFAULT 0,
  available_qty INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_item_site ON stock(item_id, site_id);

-- Inventory movements (replaces Inv_Movement sheet)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id TEXT UNIQUE NOT NULL,
  type TEXT,
  movement_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  item_id INTEGER REFERENCES products(id),
  stock_id INTEGER REFERENCES stock(id),
  geo TEXT,
  quantity INTEGER DEFAULT 0,
  qty INTEGER,
  site_id INTEGER,
  requisition_id TEXT,
  performed_by TEXT,
  person TEXT,
  sector TEXT,
  maquina TEXT,
  generador TEXT,
  vehiculo TEXT,
  condition TEXT,
  comments TEXT,
  notes TEXT,
  site TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_id ON inventory_movements(movement_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_requisition ON inventory_movements(requisition_id);

-- Stock ledger (append-only audit of stock changes)
CREATE TABLE IF NOT EXISTS stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES products(id),
  location_type TEXT,
  location_id TEXT,
  qty_change INTEGER NOT NULL,
  transaction_type TEXT,
  reference_id TEXT,
  reference_type TEXT,
  comments TEXT,
  user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_item ON stock_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref ON stock_ledger(reference_id, reference_type);

-- Item status (replaces ItemStatus sheet)
CREATE TABLE IF NOT EXISTS item_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geo TEXT NOT NULL,
  status TEXT NOT NULL,
  person TEXT,
  sector TEXT,
  status_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  condition TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_item_status_geo ON item_status(geo);

-- Requisitions (replaces Ordenes)
CREATE TABLE IF NOT EXISTS requisitions (
  id TEXT PRIMARY KEY,
  requisition_no TEXT UNIQUE NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  requested_by TEXT,
  priority TEXT DEFAULT 'normal',
  notes TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requisitions_no ON requisitions(requisition_no);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);

-- Requisition line items
CREATE TABLE IF NOT EXISTS requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity_requested INTEGER DEFAULT 0,
  quantity_issued INTEGER DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


-- Quotes (replaces Quote sheet)
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  quote_no TEXT UNIQUE NOT NULL,
  requisition_id TEXT REFERENCES requisitions(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  created_by TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  currency TEXT DEFAULT 'CLP',
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  freight REAL DEFAULT 0,
  iva REAL DEFAULT 0,
  total REAL DEFAULT 0,
  pdf_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quotes_no ON quotes(quote_no);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

-- Quote items
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id TEXT REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0,
  geo TEXT,
  pn TEXT,
  description_es TEXT,
  description_en TEXT,
  supplier TEXT,
  category TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- Bundles (group of GEOs issued together)
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id TEXT UNIQUE NOT NULL,
  name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER REFERENCES bundles(id) ON DELETE CASCADE,
  geo_code TEXT,
  qty INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Min/Max stock levels
CREATE TABLE IF NOT EXISTS min_max (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT,
  geo_code TEXT,
  min_qty INTEGER,
  max_qty INTEGER,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- HSE Signatures
CREATE TABLE IF NOT EXISTS hse_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id TEXT,
  worker_id TEXT,
  worker_name TEXT,
  fingerprint_base64 TEXT,
  match_score INTEGER DEFAULT 0,
  pdf_url TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Stock counts
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT,
  count_date TEXT,
  user_name TEXT,
  status TEXT,
  location TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT,
  barcode TEXT,
  geo TEXT,
  product_number TEXT,
  desc_en TEXT,
  desc_es TEXT,
  quantity INTEGER,
  count_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(count_id);

-- Item location map
CREATE TABLE IF NOT EXISTS item_location_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT,
  rack_id TEXT,
  has_sides INTEGER DEFAULT 0,
  no_of_shelves INTEGER,
  item_id TEXT,
  side_code TEXT,
  shelf_level TEXT
);

-- Control Combustible / Fuel
-- Column order mirrors the GAS "ControlCombustible" sheet:
--   Date, Proyecto, TipoActivo, ID/Patente, Litros, KM, Nombre, User
CREATE TABLE IF NOT EXISTS fuel_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT DEFAULT CURRENT_TIMESTAMP,
  proyecto TEXT,
  tipo_activo TEXT,
  asset_id TEXT,
  liters REAL DEFAULT 0,
  odometer_km INTEGER,
  driver TEXT,
  user_email TEXT,
  vehicle TEXT,
  cost REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Labels (replaces the "Labels" sheet)
--   TemplateID, TemplateName, ElementsJSON, UpdatedAt, CanvasWidth, CanvasHeight
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT,
  template_data TEXT,
  canvas_width INTEGER,
  canvas_height INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Background jobs (replaces CacheService)
CREATE TABLE IF NOT EXISTS background_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT UNIQUE NOT NULL,
  job_type TEXT,
  ref_id TEXT,
  title TEXT,
  status TEXT DEFAULT 'RUNNING',
  progress INTEGER DEFAULT 0,
  step TEXT,
  pdf_url TEXT,
  email_sent INTEGER DEFAULT 0,
  error_message TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_job_id ON background_jobs(job_id);

-- Files metadata (R2 stores the actual bytes)
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER DEFAULT 0,
  category TEXT DEFAULT 'general',
  uploaded_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT,
  record_id TEXT,
  action TEXT,
  old_values TEXT,
  new_values TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requisition_items_req ON requisition_items(requisition_id);
