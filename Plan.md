# RECON ERP — Migration Plan (Apps Script/Sheets → Cloudflare D1 + REST API)

**Project:** RECON ERP | **Status:** Planning — no coding yet | **Date:** 2026-10-19

## 1. EXECUTIVE SUMMARY

Migrate RECON ERP from Google Apps Script + Google Sheets to Cloudflare D1 + REST API.
Frontend HTML/CSS/JS stays mostly unchanged. Only the data layer changes:
`google.script.run()` → `fetch()` API calls.

**Confirmed Stack:**
- API: Node.js + Express (Cloudflare Workers)
- Database: Cloudflare D1 (SQLite-compatible SQL at the edge)
- File Storage: Cloudflare R2 (S3-compatible object storage)
- Email: Microsoft Graph API (existing)
- Auth: Simple JWT
- Frontend Hosting: Cloudflare Pages
- Deployment: Cloudflare (Workers + Pages + D1 + R2)
- Timeline: ASAP


## 2. CURRENT STATE ANALYSIS

### 2.1 Project Structure

Clasp-managed Google Apps Script project:

| File Type | Count | Description |
|-----------|-------|-------------|
| `.gs` backend | ~30 | Google Apps Script server files |
| `.html` | ~35 | Frontend HTML templates |
| `*JS.html` | ~35 | Frontend JavaScript (uses google.script.run) |
| `modules/` | empty | Reserved |
| `.clasp.json`, `appsscript.json` | 2 | Config |

**Key backend:** `Código.js` (6,637 lines, doGet/doPost entry), `CreateReqGS.js` (~4,384 lines), `QuoteMgmtGS.js` (~175,958 lines), `InvMovGS.js` (~33,588 lines), `StockGS.js` (~17,889 lines), `ViewEditReqGS.js` (~20,751 lines).

**Key frontend:** `Index.html` (main shell), `i18n.html` (translations), module-specific `*.html` + `*JS.html` pairs.

### 2.2 Current Architecture

Browser → `google.script.run` → Google Apps Script → `SpreadsheetApp` → Google Sheets → `DriveApp`/`GmailApp` → Drive/Gmail

### 2.3 Sheets → PostgreSQL Tables

| Sheet | Purpose | Key Fields |
|-------|---------|------------|
| Validation | Reference data | name, email, category, etc. |
| Master | Product catalog | geo, pn, category, en, es, stock, costo_clp |
| Stock | Stock levels | ItemID, LocationID, Quantity, ReservedQty, AvailableQty |
| StockLedger | Stock journal | itemId, qtyChange, transactionType, referenceId |
| Inv_Movement | Inventory movements | movementId, geo, type, qty, person, sector |
| ItemStatus | Item status | geo, status, person, sector |
| Ordenes | Requisitions (1 row per item) | ReqID, pn, geo, site, qty, status, pdfLink |
| Config | System config | label, value |
| Users | User accounts (PIN auth) | userId, pin, name, email, site, role, active |
| People | Personnel | id, name, rut |
| Labels | Label templates | name, CanvasWidth |
| Bundle_Items | Bundle definitions | Bundle ID, Geo Code, Qty |
| ControlCombustible | Fuel log | date, vehicle, driver, liters, cost |
| ItemLocationMap | Rack/shelf location | LocationID, RackID, ItemID |
| MinMax | Min/max stock | Site, Geo Code, Min, Max |
| HSE_Signatures | HSE signature queue | MovementID, WorkerID, Status, PDFDriveLink |
| StockCounts | Physical counts | CountID, Barcode, Quantity, Date |

### 2.4 Google Services Used

`SpreadsheetApp`, `DriveApp`, `GmailApp`, `Session.getActiveUser()`, `CacheService`, `Utilities`, `HtmlService`.

## 3. TARGET ARCHITECTURE

### 3.1 High-Level Architecture

Browser (HTML/JS, mostly unchanged) → `fetch()`/AJAX → REST API (Cloudflare Workers) → Cloudflare D1 → Cloudflare R2 (files) → Microsoft Graph API (email)

### 3.2 Confirmed Stack (Node.js + Cloudflare)

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js (adapted for Cloudflare Workers) |
| Database | Cloudflare D1 (SQLite-compatible SQL at the edge) |
| DB Driver | D1 SQL via `wrangler` binding + prepared statements |
| Auth | JWT (jsonwebtoken) |
| Email | Microsoft Graph API (existing) |
| Files | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` |
| Frontend Hosting | Cloudflare Pages |
| Deployment | `wrangler` CLI + Cloudflare dashboard |

### 3.3 API Design Principles

- RESTful: `/api/v1/{resource}`
- JSON request/response
- Standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Response format: `{ status, data, message, error }`
- JWT auth: `Authorization: Bearer <token>`
- CORS enabled for browser frontend
- Pagination: `?page=1&limit=50`

### 3.4 Cloudflare D1 Considerations

- D1 is SQLite-compatible SQL at the edge
- D1 does NOT support all PostgreSQL features (e.g., JSONB, complex types, some index types)
- Use standard SQL types: `TEXT`, `INTEGER`, `REAL`, `BLOB`, `TIMESTAMP`
- D1 has row size limits (~1MB per row) — avoid storing large blobs in DB (use R2 for files)
- D1 access via prepared statements: `db.prepare("...").bind(...).run()`
- No connection pooling needed — D1 is accessed via HTTP binding in Workers
## 4. DATABASE SCHEMA (Cloudflare D1)

### 4.1 Core Tables

**Note:** Cloudflare D1 is SQLite-compatible. `SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`, `DECIMAL` → `REAL`, `BOOLEAN` → `INTEGER (0/1)`, `TIMESTAMP` → `TEXT` (ISO string).

-- System configuration (replaces Config sheet)
CREATE TABLE config (id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT UNIQUE NOT NULL, config_value TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

-- Users (replaces Users sheet + PIN auth)
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, name TEXT, site TEXT, role TEXT, is_active INTEGER DEFAULT 1);

-- Reference data (from Validation sheet)
CREATE TABLE sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE brands (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);
CREATE TABLE sub_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE currencies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE sub_areas (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);

-- Products / Master inventory (replaces Master sheet)
CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, geo TEXT, pn TEXT, category TEXT, sub_categoria TEXT, marca TEXT, en_description TEXT, es_description TEXT, un TEXT, stock INTEGER DEFAULT 0, costo_clp REAL DEFAULT 0, proveedor TEXT);
CREATE INDEX idx_products_geo ON products(geo);
CREATE INDEX idx_products_pn ON products(pn);

-- Stock levels (replaces Stock sheet)
CREATE TABLE stock (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT, location_id TEXT, quantity INTEGER DEFAULT 0, available_qty INTEGER DEFAULT 0, updated_by TEXT);
CREATE INDEX idx_stock_item_location ON stock(item_id, location_id);

-- Inventory movements (replaces Inv_Movement sheet)
CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, movement_id TEXT, geo TEXT, movement_type TEXT, qty INTEGER, person TEXT, sector TEXT, site TEXT);
CREATE INDEX idx_inventory_movements_movement_id ON inventory_movements(movement_id);

-- Item status (replaces ItemStatus sheet)
CREATE TABLE item_status (id INTEGER PRIMARY KEY AUTOINCREMENT, geo TEXT, status TEXT, person TEXT, sector TEXT);

-- Requisitions (replaces Ordenes - one row per header)
CREATE TABLE requisitions (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_number TEXT UNIQUE NOT NULL, site TEXT, user_name TEXT, status TEXT DEFAULT 'Pending', pdf_url TEXT);

-- Requisition line items
CREATE TABLE requisition_items (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_id INTEGER REFERENCES requisitions(id) ON DELETE CASCADE, pn TEXT, geo TEXT, description_es TEXT, qty INTEGER DEFAULT 0, status TEXT DEFAULT 'Pending');

-- Quotes
CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id TEXT UNIQUE NOT NULL, supplier TEXT, status TEXT DEFAULT 'Pending', total REAL DEFAULT 0, pdf_url TEXT);

-- Quote items
CREATE TABLE quote_items (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE, geo TEXT, pn TEXT, qty INTEGER DEFAULT 0, price REAL DEFAULT 0);

-- Bundles + Bundle items
CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, bundle_id TEXT UNIQUE NOT NULL);
CREATE TABLE bundle_items (id INTEGER PRIMARY KEY AUTOINCREMENT, bundle_id INTEGER REFERENCES bundles(id) ON DELETE CASCADE, geo_code TEXT, qty INTEGER DEFAULT 1);

-- Remaining tables
CREATE TABLE labels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE min_max (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT, geo_code TEXT, min_qty INTEGER, max_qty INTEGER);
CREATE TABLE hse_signatures (id INTEGER PRIMARY KEY AUTOINCREMENT, movement_id TEXT, status TEXT DEFAULT 'PENDING');
CREATE TABLE background_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'RUNNING', progress INTEGER DEFAULT 0);

| Email | nodemailer | fastapi-mail / smtplib |
## 5. API ENDPOINT DESIGN

### 5.1 Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/login | Validate email+PIN, return JWT |
| POST | /api/v1/auth/logout | Invalidate token |
| GET | /api/v1/auth/me | Get current user profile |
| POST | /api/v1/auth/change-pin | Change user PIN |

### 5.2 Reference Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/reference/sites | List sites |
| GET | /api/v1/reference/categories | List categories |
| GET | /api/v1/reference/brands | List brands |
| GET | /api/v1/reference/suppliers | List suppliers |
| GET | /api/v1/reference/validation | All validation data (combined) |
| POST/PUT/DELETE | /api/v1/reference/{type}/{id} | CRUD reference items |

### 5.3 Products & Stock
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/products | List products (paginated) |
| GET | /api/v1/products/:geo | Get product by GEO |
| POST | /api/v1/products | Create product |
| PUT | /api/v1/products/:id | Update product |
| GET | /api/v1/stock | Get all stock levels |
| GET | /api/v1/stock/available/:itemId | Get available stock |

### 5.4 Requisitions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/requisitions | List requisitions |
| GET | /api/v1/requisitions/:id | Get requisition + items |
| POST | /api/v1/requisitions | Create requisition (+ items) |
| PUT | /api/v1/requisitions/:id | Update requisition |
| DELETE | /api/v1/requisitions/:id | Delete |

### 5.5 Inventory Movements
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/movements | List movements |
| POST | /api/v1/movements/bulk-issue | Bulk issue items |
| GET | /api/v1/movements/:movementId | Get movement details |
## 6. FRONTEND CHANGES REQUIRED

### 6.1 Pattern Replacement

**Current (Google Apps Script):**
```javascript
google.script.run
  .withSuccessHandler(function(response) { ... })
  .withFailureHandler(function(err) { ... })
  .functionName(arg1, arg2);
```

**New (REST API):**
```javascript
async function apiCall(endpoint, method, body) {
  const token = localStorage.getItem('authToken');
  const res = await fetch(endpoint, {
    method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}
```

### 6.2 Files Requiring Changes

Every `*JS.html` file using `google.script.run` needs updates. High-impact files:
## 7. AUTHENTICATION MIGRATION

### 7.1 Current: Google Session Auth

- `Session.getActiveUser().getEmail()` — gets Google account of user
- Users have 4-digit user ID + 4-digit PIN (stored in Users sheet)
- Access controlled by GAS deployment permissions

### 7.2 New: JWT-Based Auth (Same Credentials)

- **Authentication method stays identical:** 4-digit user ID + 4-digit PIN
- **Existing data preserved:** Users keep their current IDs — no recreation needed
- **PIN reset:** Via email (Microsoft Graph API sends reset link/code)
- `POST /api/v1/auth/login` — body: `{ userId, pin }`, validates against `users` table (bcrypt hash)
- Returns `{ token, user }` — token stored in `localStorage`
- Middleware verifies JWT on every protected route
- Existing PINs are plaintext in Sheets — must be bcrypt-hashed during migration
- `POST /api/v1/auth/reset-pin` — body: `{ email }`, sends reset via Graph API

## 8. FILE STORAGE & EMAIL MIGRATION

### 8.1 File Storage

- **Current:** Google Drive (`DriveApp`) — PDFs, logos, uploads
- **New:** Cloudflare R2 (S3-compatible object storage) — served via `/api/v1/files/:fileId`
- SDK: `@aws-sdk/client-s3` with R2 endpoint
- Logo images become static assets (uploaded to R2 or served from Cloudflare Pages)

### 8.2 Email

- **Current:** `GmailApp.sendEmail()` — sent from deploying user's Gmail
- **New:** Microsoft Graph API (existing — no change needed)
- Graph API endpoints for sending email remain the same
- HTML email templates remain unchanged

- `Index.html` — Global helpers, bgFireAndForget, auth infrastructure
## 9. DATA MIGRATION PLAN

### Phase 0: Schema Creation

1. Create Cloudflare D1 database (`npx wrangler d1 create recon-erp`)
2. Create tables via D1 SQL (see Section 4) using `wrangler d1 execute`
3. Create Cloudflare R2 bucket for file storage

### Phase 1: Export from Google Sheets

1. Export each sheet as CSV or JSON (via Sheets API or manual)
2. Clean and validate data

### Phase 2: Import to Cloudflare D1

1. Import CSV into D1 tables via `wrangler d1 execute` or D1 HTTP API
2. Transform and load into final tables
3. Hash PINs with bcrypt
4. Generate requisition numbers for existing records
5. Validate row counts match

### Phase 3: Dual-Write (optional, zero-downtime)

1. Write to both Google Sheets and Cloudflare D1
2. Verify consistency, then cut over to D1 only

## 10. IMPLEMENTATION PHASES

| Phase | Weeks | Focus |
|-------|-------|-------|
| 1 | 1-2 | Infrastructure: Cloudflare D1, R2, API project (Workers), auth (JWT), api.js client, login page |
| 2 | 2-3 | Reference data API (sites, categories, brands, suppliers, etc.) |
| 3 | 3-4 | Products & Stock API |
| 4 | 4-5 | Requisition API (+ numbering sequence) |
| 5 | 5-6 | Inventory Movements API (bulk issue, item status) |
| 6 | 6-7 | Quotes API (status workflow, quote items) |
| 7 | 7-8 | Files (R2), Email (Graph API), Background Jobs |
| 8 | 8-9 | Remaining modules: Labels, MinMax, LocationMap, Fuel, Bundles, OpSphere |
| 9 | 9-10 | Testing: E2E, performance (20K+ products), security |
| 10 | 10-11 | Deployment (Cloudflare Pages + Workers), data migration, cut-over, user training |
## 11. RISK ASSESSMENT

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Frontend UI breaks | High | Medium | Keep HTML identical, only change JS data layer |
| Data loss during migration | Critical | Low | Export Sheets to CSV first; keep GAS as read-only backup |
| Performance with 20K+ products | High | Medium | Database indexes, pagination, test with production volumes |
| JWT session loss | Medium | Medium | Token refresh, appropriate expiry |
| PDF output differs | Medium | Medium | Test visually; use same HTML templates |
| Email delivery fails | Medium | Low | Use Graph API with proper auth; test before cutover |

## 12. QUESTIONS FOR USER (Before Coding) — ANSWERED

| # | Question | Answer |
|---|----------|--------|
| 1 | Technology stack | Node.js + Express |
| 2 | Database hosting | Cloudflare D1 |
| 3 | File storage | Cloudflare R2 (bucket) |
| 4 | Email service | Microsoft Graph API (existing) |
| 5 | Authentication | Simple JWT |
| 6 | Frontend hosting | Cloudflare Pages |
| 7 | Deployment | Cloudflare (Workers + Pages + D1 + R2) via `wrangler` |
| 8 | Target go-live date | ASAP |
| 9 | Team size | TBD |
| 10 | Row counts in largest sheets | TBD |

## 13. SUCCESS CRITERIA

- [ ] All existing frontend modules work with the new API
- [ ] Data integrity: row counts match between Google Sheets and Cloudflare D1
- [ ] Authentication works (login, PIN validation, session management via JWT)
- [ ] PDF generation works (quotes, requisitions)
- [ ] Email sending works via Microsoft Graph API
- [ ] File upload/download works via Cloudflare R2
- [ ] Performance: page loads < 3 seconds, API responses < 500ms
- [ ] Zero data loss during migration
- [ ] Users can perform all existing operations

## 14. NEXT STEPS

1. Review this updated plan (Cloudflare stack confirmed)
2. Provide missing info: team size, row counts in largest sheets
3. Approve implementation phases and timeline (ASAP target)
4. Once confirmed, coding begins with Phase 1 (Infrastructure & API Foundation)

---

**No coding will begin until you confirm this plan.**

| 3 | 3-4 | Products & Stock API |
| 4 | 4-5 | Requisition API (+ numbering sequence) |
| 5 | 5-6 | Inventory Movements API (bulk issue, item status) |
| 6 | 6-7 | Quotes API (status workflow, quote items) |
| 7 | 7-8 | Files, Email, Background Jobs |
| 8 | 8-9 | Remaining modules: Labels, MinMax, LocationMap, Fuel, Bundles, OpSphere |
| 9 | 9-10 | Testing: E2E, performance (20K+ products), security |
| 10 | 10-11 | Deployment, data migration execution, cut-over, user training |

- `CreateReqJS.html` — Requisition creation (heavy usage)
- `InvMovJS.html` — Inventory movements (heavy usage)
- `ProductsJS.html` — Product sync with laned loading
- `QuoteMgmtJS.html` — Quote management (heavy usage)
- `ViewEditReqJS.html` — View/edit requisitions
- `DashboardJS.html`, `AdminValJS.html`, `StockJS.html`, `RFQJS.html`, `ScannerJS.html`, etc.

### 6.3 Unchanged Frontend Files

No changes needed: `*.html` layout files, `ChoicesCSS.html`, `i18n.html`, PDF templates (`REQ_Template.html`, `Quote_Template.html`).

### 6.4 New Files Needed
- `api.js` — Shared API client wrapper
- `login.html` — Login page (replaces Google Session auth)
- `auth.js` — Token management, login/logout


### 5.6 Quotes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/quotes | List quotes |
| GET | /api/v1/quotes/:id | Get quote + items |
| POST | /api/v1/quotes | Create quote |
| PUT | /api/v1/quotes/:id/status | Update quote status |

### 5.7 Background Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/jobs/:jobId | Get job status |
| GET | /api/v1/jobs | List jobs (batch poll) |
| POST | /api/v1/jobs | Create job entry |
| PUT | /api/v1/jobs/:jobId | Update progress |

### 5.8 Files & System
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/files/upload | Upload file |
| GET | /api/v1/files/:fileId | Download file |
| GET | /api/v1/system/config | Get system config |
| GET | /api/v1/health | Health check |

| Files | multer + local/S3 | python-multipart + S3 |

### 3.3 API Design Principles

- RESTful: `/api/v1/{resource}`
- JSON request/response
- Standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Response format: `{ status, data, message, error }`
- JWT auth: `Authorization: Bearer <token>`
- CORS enabled for browser frontend
- Pagination: `?page=1&limit=50`

---

## 4. Session Progress Log

### Frontend Port Session (GAS → standalone SPA)

Done this session:

- **`frontend/js/gas-shim.js`** — chainable `google.script.run` compatibility layer (Proxy-based). Mapped handlers: `getModuleHtml` (fetches `modules/*.html`), `verifyUserLogin`, `getValidationData`, `getSiteData`, `getAutoSelectedSite`, `getAdminData`, `getFullStockData`, `getRequirementsHistory`, `getPeople`, `getAllActiveAssignments`. All other GAS calls fall back to `POST /api/v1/legacy/:fn`.
- **`frontend/js/*.js` (27 files)** + **`frontend/modules/*.html` (25 files)** + **`frontend/css/choices.css`** — extracted from the GAS `*JS.html` / module HTML files by `api/scripts/port-frontend.js` (re-runnable).
- **`frontend/index.html`** — transformed from GAS `Index.html`: all `<?!= include(...) ?>` scriptlets replaced with `<script src>` tags, zero scriptlets remain; `api.js` + `gas-shim.js` injected before `</head>`; `logoutUser()` now clears the JWT.
- **`frontend/login.html`** — fully recreated (was corrupted by earlier `insert_line` bug). Stores user in `recon_user_secure`, redirects to `index.html`.
- **`frontend/reset-pin.html`** — new standalone page for the Graph email reset link (`?token=...`).
- **`api/src/routes/legacy.js`** — POST `/api/v1/legacy/:fn` (JWT-protected). Implemented: `getPeople` → `[]` (people table not migrated), `getAllActiveAssignments` → aggregated from `inventory_movements` (same rules as InvMovGS). ~80 known-unimplemented names respond `{ __legacy: true }`; unknown names 404.
- **`api/src/index.js`** — mounts legacy route; serves `frontend/` statically; rate limit raised to env-configurable `RATE_LIMIT_MAX` (default 2000).
- **`api/scripts/seed.js`** — seeds the 11 config feature flags (`reqEmailEnabled`, `quoPdfEnabled`, `quoteEmail*`, `company_logo`).
- **Smoke test** `api/scripts/smoke-frontend.js` — 15/15 passing (static assets, login, config flags, legacy implemented/unimplemented/404/401).

Key architecture decision: **incremental port via shim** — frontend files stay as close to the GAS originals as possible; the shim routes each server function to either a REST endpoint (mapped) or the legacy fallback (unimplemented → warns + returns null). Per-module work replaces legacy fallbacks with real endpoints over time.

### History-shape reconciliation session (2026-10-19)
- **`getRequirementsHistory` now GAS-shaped** (`api/src/routes/legacy.js`): one row per requisition ITEM, newest-first, with the exact field names from `Código.js` (`order, fecha, fechaIso, pn, geo, faena, desc, cant, estado, user, category, pdfUrl, subArea, emails, subAreaNo, notes, itemNotes, supplierNotes, images, reqLastModifiedBy, reqLastModified, reqLastModifiedIso, reqModCount`). Built from `requisitions + requisition_items + products + sites + categories`; excludes Draft rows (GAS parity); `rowNum` emulates sheet row numbers. Verified live: seeded requisition returns the full shape with correct joins (`geo GEO-0001`, `faena Main Warehouse`, `category Safety`).
- **`gas-shim.js`**: `getRequirementsHistory` now routes to `legacyCall` instead of `GET /requisitions` (which returned header-shaped objects the Dashboard can't consume). Key finding: Dashboard's `r.price`/`r.supplier` usages never existed in the GAS history either — the dashboard degrades to 0 / "No supplier activity data" for those, same as production GAS. Real price/supplier data lives in the Quotes domain; wiring it into the dashboard is a future enhancement, not a parity fix.
- **Smoke test**: 16/16 passing (new `getRequirementsHistory → [] on fresh DB` check).

Known gaps (next sessions):

1. ~80 legacy functions return null — port per module priority: Products/Stock/Requisitions/Dashboard data shapes (e.g. `getRequirementsHistory` currently maps to `GET /requisitions` but GAS returned sheet-row-shaped objects — DashboardJS/ViewEditReqJS field expectations must be reconciled).
2. `getPeople` needs a `people` table migration (id, name, department, active, sector, rut, email).
3. `getAdminData().users` is `[]` — needs an admin users endpoint (never expose PINs; the GAS app shipped PINs to the client — do not replicate).
4. Multipart uploads (`uploadQuoteAttachment`, `uploadRequirementItemImages`) need multer/R2 wiring.
5. Email dispatch (`dispatchEmailWithProvider`) — Graph API integration from Node.
6. Browser-level E2E (the smoke test covers HTTP only; a headless-browser pass would validate the shim chains in-page).



---------------------------------------------------------------------------------
---------------------------------------------------------------------------------
RECON ERP — Mobile & Tablet Responsive Transformation Plan
1. Executive Summary & Objectives

RECON ERP is deployed as a Progressive Web App (PWA) with standalone installation capabilities (display: standalone). However, its UI and interaction models were originally engineered for wide desktop monitors (1400px+), relying heavily on:

10+ column spreadsheet tables with horizontal scrolling
Fixed sidebar navigation (240px)
Ultra-wide desktop modal windows (modal-quote-full at 99vw)
Multi-column inline tabular data-entry forms (e.g. creating requisitions, quotes, and inventory movements)
Small touch targets (< 32px) and missing mobile virtual keyboard hints
Core Objective

Transform RECON ERP into a Mobile-First / Hybrid-Responsive Enterprise Application that delivers a fluid native-like experience on smartphones (360px–480px) and tablets (768px–1024px) while preserving full desktop power (1200px+).

2. Device Breakpoint & Layout Architecture
Breakpoint Matrix
Breakpoint	Target Devices	Navigation Shell	Tables & Grids	Form Entry
Mobile (< 768px)	iPhone, Galaxy, Pixel (360–430px)	Fixed Mobile Header + Thumb-friendly Bottom Bar + Offcanvas Menu	Adaptive Card / List-Detail pattern (no horizontal scroll)	Stacked Form / Bottom-Sheet Item Editor with 48px touch targets
Tablet (768px - 1024px)	iPad, Galaxy Tab, Surface	Collapsible Slim Rail Sidebar (76px)	Split view or 2-column cards; condensed tables with touch scroll	2-column grid layout with sticky action headers
Desktop (> 1024px)	Laptops, Monitors (1200px+)	Persistent 240px Sidebar	Full tabular multi-column view with advanced sorting	Multi-column spreadsheet / side-by-side editing
3. App Shell & Global Responsive Foundations
3.1 Mobile Header & Safe Area Handling
Safe Area Insets: Support iPhone notch and Android gesture pill with padding-top: max(12px, env(safe-area-inset-top)) and padding-bottom: max(12px, env(safe-area-inset-bottom)).
Top Mobile Header: Clean sticky bar featuring:
Hamburger toggle button (left)
Active Module Title + Active Site badge (center)
User avatar / Site switcher / QR Scan shortcut (right)
3.2 Thumb-Friendly Bottom Navigation Bar (< 768px)

Operators in the field primarily use 4–5 core modules daily. A persistent bottom navigation bar provides instant one-tap thumb access:

📊 Dashboard (Dashboard)
📝 Requisitions (CreateReq / ViewReq)
💼 Quotes (QuoteMgmt)
⛽ Fuel Control (ControlCombustible)
☰ More / Menu (Opens full module drawer with search)
3.3 Touch Targets & Virtual Keyboard Optimization
All form inputs, selects, and action buttons styled with min-height: 44px (Apple Human Interface Guidelines) and min-height: 48px (Android Material).
Specialized virtual keyboard input modes:
Odometer & Liters: inputmode="decimal"
PIN codes & Counts: inputmode="numeric"
Part Numbers / Codes: autocapitalize="characters"
Email addresses: inputmode="email"
Phone numbers: inputmode="tel"
4. UI Patterns: Solving the "Big Screen" Problems
4.1 Pattern 1: Wide Tables to Responsive Touch Cards

The Problem: 10-column tables require pinching and awkward side-scrolling on phones. The Solution: A unified CSS class .recon-responsive-table using CSS custom properties and media queries:

On desktop (>= 768px): Renders standard HTML <table>.
On mobile (< 768px): The <table>, <thead>, <tbody>, <tr>, <td> switch to display: block. Each <tr> becomes an individual card with:
Header row: Primary ID (e.g. REQ-1392) + Status Badge (Approved) + Date
Content body: Key fields displayed with data-label="..." pseudo-elements (td::before { content: attr(data-label); font-weight: 600; })
Action footer: Full-width tap targets (View, Edit, Approve, PDF)
4.2 Pattern 2: Multi-Item Entry (Stacked Mobile Bottom-Sheet)

The Problem: In CreateReq, QuoteMgmt, and InvMov, adding items requires filling 6–8 horizontal table columns inline. The Solution:

Desktop: Retain the fast desktop spreadsheet row entry.
Mobile / Tablet: Add a floating + Add Item button that slides up a Bottom Sheet / Mobile Modal. The operator searches P/N, inputs Qty and Unit on large touch inputs, taps Add to List, and sees a list of summary cards with swipe-to-delete.
4.3 Pattern 3: Full-Screen Modals & Sticky Mobile Action Bars

The Problem: modal-quote-full uses 99vw with fixed vertical layout. On mobile, the modal header and buttons scroll out of view. The Solution:

On < 768px, modals become full-viewport views (height: 100dvh; border-radius: 0;).
The modal header stays sticky at the top with a prominent ✕ Close or ← Back icon.
Primary CTA buttons (Save Changes, Submit Approval, Confirm Despatch) stay sticky at the bottom (position: sticky; bottom: 0; padding: 12px; background: white; box-shadow: 0 -4px 12px rgba(0,0,0,0.1)).
5. Module Prioritization & Implementation Roadmap

We group the ERP modules into 3 phased tiers based on operational field importance:

Phase 1: High-Priority Field Modules (Mobile Daily Drivers)

IMPORTANT

These modules are actively used in the field, warehouses, and fuel stations on phones and tablets.

Fuel Control (ControlCombustible.html & ControlCombustibleJS.js)

Current State: Large Mochila tabs, wide purchase history table, dense fuel entry form.
Mobile Upgrade:
Large swipeable Mochila selector pills.
Big circular fuel balance gauge / progress bar optimized for phone screens.
Large touch keypad inputs for odometer and liters.
Purchase history converted to chronological timeline cards.

Requisitions (CreateReq.html, ViewReq.html, CreateReqJS.js, ViewEditReqJS.js)

Current State: Complex requisition creation with multiple inline rows and wide email chip bar.
Mobile Upgrade:
Mobile item drawer / bottom sheet for adding requisition items with autocomplete.
Card-based requisition list with color-coded status badges (Pending, Quoted, Approved).
One-tap quick approval flow for managers reviewing on phone.

Inventory Movements & Scanning (InvMov.html, Scanner.html, MovScanner.html)

Current State: Multi-item movement table, desktop barcode scanner layout, HSE signature canvas.
Mobile Upgrade:
Full-screen responsive camera viewfinder for barcode/QR scanning with flash toggle.
Mobile-friendly touch signature canvas with landscape auto-rotate support.
Touch-first dispatch/reception item checklists.

Quote Management (QuoteMgmt.html & QuoteMgmtJS.js)

Current State: 99vw modal with 15+ column item pricing table.
Mobile Upgrade:
Mobile filter drawer (search, site, category, status).
Quote cards with segmented progress bar.
Quote details and approval view converted into a mobile-friendly collapsible item list with price summaries and sticky Approve / Reject bar.
Phase 2: Operations & Inventory Exploration (Tablets & Mobile)

Stock & Products (Stock.html, Products.html, MinMax.html)

Instant search bar with barcode scanner trigger.
Stock list converted to responsive item cards showing Site, On-Hand, Min/Max alerts.
Location map and rack view scaled for touch pinch-to-zoom.

Dashboard & KPIs (Dashboard.html & DashboardJS.js)

Single-column stacked KPI stat cards on mobile (grid-template-columns: 1fr on phone, repeat(2, 1fr) on tablet, repeat(4, 1fr) on desktop).
Touch-friendly Chart.js graphs with tooltip interaction.
Phase 3: Administrative & Back-Office

Permissions & Roles (Permissions.html & PermissionsJS.js)

Role selector dropdown + accordion modules with tap-to-toggle switches (replacing wide checkbox matrix).

Sheets Sync & Audit Logs (SheetsSync.html, AdminVal.html, LifecycleReport.html)

Responsive log viewer with collapsible payloads and copy buttons.
6. Implementation Architecture & Code Strategy

To ensure clean code without breaking desktop functionality:

Shared CSS Stylesheet (frontend/css/responsive.css):
Centralize all mobile breakpoints, touch utilities, card tables, and navigation layout styles into a single, clean CSS file included in index.html.
Backward Compatible:
Desktop markup and behavior remain completely unchanged at >= 1024px.
PWA Offline & Hardware Integration:
Utilize native mobile camera (getUserMedia with rear-facing environment mode).
Support iOS rubber-banding and Android back-button modal dismissals.
7. Recommended Next Steps
Review & Approve Architecture: Confirm the proposed layout model (Bottom Nav + Card Tables + Stacked Mobile Forms).
Sprint 1 Execution:
Create frontend/css/responsive.css with mobile navigation shell, safe-area fixes, and table-to-card utilities.
Implement Phase 1 Priority: Fuel Control and Requisitions (CreateReq & ViewReq).
Sprint 2 Execution:
Implement Quote Management (QuoteMgmt) mobile cards & approval modal.
Implement Inventory Movements & Mobile Scanner (InvMov & Scanner).
Sprint 3 Verification:
Device testing on Chrome DevTools (iPhone SE, iPhone 14/15 Pro Max, Galaxy S23, iPad 10th gen) and live physical device testing via PWA.

---

## 8. VEHICLE TRACKING & FLEET MAP ENHANCEMENTS — 9-POINT ACTION PLAN

### Point 1 & 2: Trip Completion Modal with Final Odometer & Total/Detailed Expenses
- **Current problem:** Uses browser `confirm()` and `prompt()` for final KM. No way to record final total expenses at end of trip unless added one-by-one.
- **Solution:** Custom Swal modal prompting for:
  - Final Odometer (KM), pre-filled with start KM, validated (must be $\ge$ start KM).
  - Total Expenses (optional lump sum or single total amount).
  - Optional expander to add detailed expense line items (fuel, food, toll, other).
  - Update `PUT /api/v1/voyages/:id` to accept `end_km`, `total_expenses`, `status: 'COMPLETED'`, and insert any quick expenses.

### Point 3: SweetAlert2 (Swal) Standardization
- Replace all native `alert()`, `confirm()`, and `prompt()` in `VehicleTrackingJS.js` with `Swal.fire()`.
- Standardize success, error, warning, and confirmation dialogs with bootstrap-themed Swal styles.

### Point 4: Fix History Detail View (No Accidental Trip Reactivation)
- **Current problem:** Clicking "View Details" on finished voyage in history sets `activeVoyage` and calls `showActiveVoyage()`, restarting elapsed timer and showing "End Voyage" button.
- **Solution:** Create `showVoyageDetailsModal(voyage)` with a dedicated read-only modal/offcanvas:
  - Displays voyage number, status badge (Orange for Completed), route (From Site $\to$ To Site), start time, end time, elapsed duration, start KM, end KM, total KM driven, total expenses, detailed expense list, and Leaflet route map showing breadcrumbs and site pins.
  - Leaves `activeVoyage` intact and does not start GPS tracking or elapsed timer.

### Point 5: Driver Role & Scoped Trip Visibility
- Add `driver` role to `roles` table in `DEFAULT_ROLES` and `permissions-seed.js`.
- In `GET /api/v1/voyages`, if user role is `driver`, enforce scoping: `WHERE (driver_id = req.user.user_id OR driver_id = req.user.id)`.
- Non-driver roles (admin, manager, office, etc.) can view all voyages or filtered by driver.
- Add `vehicle_tracking` and `fleet_map` permissions to role permissions matrix.

### Point 6: Fix Table Layout Shrinking on Admin Pages
- **Current problem:** In `frontend/css/responsive.css`, the rule `.recon-responsive-table tbody, .recon-responsive-table tr, .recon-responsive-table td` assigned `display: table-cell !important;` to all three selectors on desktop, forcing tbody and rows to render as individual table cells, severely shrinking all admin tables. Also `.recon-bottom-nav` had `display: flex;` outside media query.
- **Solution:** Clean up `responsive.css`:
  - Properly scope card transformation strictly inside `@media (max-width: 767.98px)`.
  - Fix desktop reset to assign proper display types: `tbody { display: table-row-group !important; }`, `tr { display: table-row !important; }`, `td { display: table-cell !important; }`.
  - Ensure `.recon-bottom-nav` defaults to `display: none` on desktop.

### Point 7: Color-Coded Status Badges
- Running / In Progress trips: **Green** (`badge bg-success`).
- Finished / Completed trips: **Orange** (`badge bg-warning text-dark` / custom `#fd7e14`).
- Deleted / Cancelled trips: **Red** (`badge bg-danger`).
- Apply consistently in active voyage header, history cards, detail modals, and fleet map popups.

### Point 8: Live Fleet Map Module (`FleetTracking` / Active Trips Map)
- Create a dedicated module `FleetTracking.html` + `FleetTrackingJS.js`:
  - Shows an interactive Leaflet map with all currently active trips (`status = 'IN_PROGRESS'`).
  - Each active trip renders:
    - Route line from From Site coordinates to To Site coordinates.
    - Moving vehicle marker at the latest GPS coordinate.
    - Clickable popup with driver name, vehicle number, from/to sites, start KM, elapsed time.
    - Side panel / drawer listing active voyages with "Locate on map" button.
- In `VehicleTrackingJS.js` (for current driver's trip):
  - Plot From Site pin, To Site pin, a connecting route polyline, and the live vehicle position marker.

### Point 9: Site Coordinates & Addresses (Database & API)
- Migrate `sites` table schema with columns:
  - `address TEXT`
  - `latitude REAL`
  - `longitude REAL`
- Add to `COLUMN_MIGRATIONS` in `db.js` and `schema.sql`.
- Seed coordinates & addresses for all 9 sites (Store, Workshop, Manto Verde, Coipa, Fenix, AMSA, Atex, Dos Amigos, Chile Chico).
- Update `/reference/sites` and `/reference/validation` to return `address`, `latitude`, `longitude`.

---

## 9. QUANTITY AUDITING, PARTIAL DELIVERIES & DISPATCH LIFECYCLE — ACTION PLAN

### Gap 1: ReqEdit — Preserving Original Requested Quantity vs Approved Quantity
- **Problem:** Currently `requisition_items` only stores `quantity_requested`. When manager reduces quantity in `ViewEditReqJS.js`, the original number is overwritten and lost.
- **Solution:**
  1. Add `original_quantity INTEGER DEFAULT 0` column to `requisition_items` in `api/schema.sql` and `COLUMN_MIGRATIONS` in `api/src/db.js`.
  2. In `POST /api/v1/requisitions`, when creating requisition lines, set `original_quantity = quantity_requested`.
  3. In `updateRequirementOnSheetWithItemStatuses` (`legacy.js`), when updating lines, keep `original_quantity` intact and only update `quantity_requested = it.cant`.
  4. In `ViewEditReqJS.js` modal:
     - Render both `Original Qty` (read-only reference) and `Qty` (editable approved amount).
     - If quantity is reduced, display a small badge/hint: `"Original: X (Reduced by Y)"`.

### Gap 2: QuoteMgmt — Quoted vs Approved Quantity Visibility
- **Status:** Architecture is in place (`quantity` frozen as quoted, `approved_qty` as approved).
- **Enhancement:**
  - Verify and make sure that in both list/cards view and modal table, when `approved_qty < quantity`, the shortfall is highlighted with an orange badge and explicit counter: `"Quoted: X → Approved: Y (-Z)"`.

### Gap 3 & 4: Supplier Partial Deliveries — Rest Later vs Short Close (Won't Send More)
- **Problem:** When supplier sends a partial shipment and confirms no more will be sent, the line is stuck in `⚠️ X of Y missing` unless manager manually deduces how to change approved qty.
- **Solution:**
  1. Add a **"Short Close"** / **"Cerrar Entrega Parcial"** action button in `QuoteMgmt` when line has `received_qty > 0 && received_qty < approved_qty`.
  2. When clicked, trigger a SweetAlert2 confirmation dialog:
     - Prompts reason/note (e.g. "Supplier out of stock", "Cancelled remainder").
     - Automatically sets `approved_qty = received_qty`.
     - Appends note to `supplier_notes` / `item_notes`.
     - Sets line/quote status to `Final Received` / `Closed` with 0 missing units.
     - Recalculates quote total to match received goods and updates inventory records.

### Gap 5: Partial Quantity Dispatched from Store to Site
- **Problem:** When moving from Main Store to Site, setting status to `Despatched` assumes 100% of approved quantity is sent. There is no `despatched_qty` column.
- **Solution:**
  1. Add `despatched_qty INTEGER DEFAULT 0` column to `quote_items` in `api/schema.sql` and `COLUMN_MIGRATIONS` in `api/src/db.js`.
  2. In `QuoteMgmtJS.js`:
     - When status is changed to `Despatched`, enable a `Despatched Qty` input (defaults to available in store / approved qty, but editable).
     - Store keeper can enter partial dispatch (e.g. 4 out of 10).
  3. In `QuoteMgmtGS.js` / backend:
     - Only deduct the actual `despatched_qty` from Main Store stock (`IssueToSite` with `despatched_qty`).
     - Display remaining balance: `"In Store: 6, Dispatched: 4"`.

### Gap 6: Partial Quantity Received at Remote Site
- **Problem:** When Site receives less than dispatched, `PUT /quotes/:id/receive` sets `Partial Received` but doesn't track whether missing units are still in transit or lost/short.
- **Solution:**
  1. In `QuoteMgmtJS.js` & `api/src/routes/quotes.js`:
     - Site receiving compares `received_qty` against `despatched_qty` (or `approved_qty`).
     - Site user can flag:
       - **"In Transit"** (remaining units expected in another batch).
       - **"Missing / Damaged Claim"** (carrier/loss report).
     - Displays badge: `⚠️ Site Received: X / Y dispatched (Z pending/claim)`.
     - Keeps status as `Partial Received` until final balance is acknowledged or short-closed.

---

## 10. CLOUDFLARE D1 DATABASE SYNCHRONIZATION & AUDIT (COMPLETED)

### 10.1 Schema Difference Audit (Local SQLite vs Cloudflare D1)
- **Database Target:** Cloudflare D1 `recon-erp` (Binding ID: `1a7d3b6c-1808-4c81-baae-f5c06dc414c0`).
- **Initial State:**
  - Local tables: 53
  - Remote D1 tables: 48 (5 missing: `vehicles`, `voyages`, `voyage_expenses`, `voyage_gps_points`, `voyage_tracking_sessions`)
  - Missing Columns in D1:
    - `quote_items`: `despatched_qty INTEGER DEFAULT 0`, `updated_at TEXT`
    - `requisition_items`: `original_quantity INTEGER DEFAULT 0`
    - `sites`: `address TEXT`, `latitude REAL`, `longitude REAL`
  - Missing Reference Data:
    - `driver` role in `roles`
    - `vehicle_tracking` and `fleet_map` module permissions in `role_permissions`
    - GPS coordinates and addresses for 9 production sites (IDs 4..12)
    - 68 registered fleet vehicles in `vehicles` table

### 10.2 Non-Destructive Safe Migration Applied
- **Strict Data Safety Rules Enforced:**
  - Zero `DROP TABLE`, zero `DELETE`, zero `TRUNCATE`.
  - Non-destructive `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
  - Safe `ALTER TABLE ADD COLUMN`.
  - Safe `INSERT OR IGNORE` for `roles`, `role_permissions`, and `vehicles`.
  - Targeted `UPDATE sites SET address = ..., latitude = ..., longitude = ... WHERE id = ...` for the 9 sites.
- **Migration Executed:** via `wrangler d1 execute recon-erp --remote --file=scripts/d1_migration.sql` (108 queries, 13.52ms).

### 10.3 Post-Migration Verification Results
- Table Count: 53 (Local) = 53 (Remote D1).
- Added Columns: All 6 columns verified with proper data types.
- New Tables: `vehicles` (68 rows), `voyages` (0 rows), `voyage_expenses` (0 rows), `voyage_gps_points` (0 rows), `voyage_tracking_sessions` (0 rows).
- Permissions: 10 permissions configured across admin, manager, office, user, driver.
- Sites: All 9 sites populated with GPS coordinates and addresses.
- **Online Data Integrity Confirmed:**
  - `products`: 28,821 rows intact
  - `people`: 562 rows intact
  - `quotes`: 296 rows intact
  - `quote_items`: 1,227 rows intact
  - `requisitions`: 117 rows intact
  - `requisition_items`: 1,423 rows intact
  - `suppliers`: 128 rows intact
  - `users`: 30 rows intact

