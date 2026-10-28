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

