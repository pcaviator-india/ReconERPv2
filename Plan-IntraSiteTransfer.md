# Intra Site Transfer Module — Implementation Plan

## 1. Overview

Add a new **Intra Site Transfer** module to the RECON ERP system that allows users to transfer goods from one site to another. Key business rule: **stock is only updated at the destination site when the transfer is received** — items sent but not yet received remain at the source site and do not appear in destination stock.

## 2. Current State Analysis

### Existing infrastructure (verified in codebase)

| Component | Location | Details |
|-----------|----------|---------|
| Backend API | `api/src/` | Express.js, SQLite (D1-compatible) |
| Routes | `api/src/routes/` | `movements.js`, `stock.js`, `vehicles.js`, `permissions.js`, `legacy.js`, etc. |
| Middleware | `api/src/middleware/auth.js` | `authenticateToken`, `requireRole`, `requirePermission` |
| Schema | `api/schema.sql` | `sites`, `stock`, `inventory_movements`, `stock_ledger`, `users`, `roles`, `role_permissions`, `vehicles`, `people` |
| Seed | `api/seed.sql` | 3 sites (MAIN, ALPHA, BRAVO), 3 users (admin, manager, operator), vehicles, people |
| Permissions seed | `api/src/utils/permissions-seed.js` | `MODULE_DEFINITIONS`, `DEFAULT_ROLES`, `ROLE_PERMISSIONS_DEFAULTS` |
| Frontend | `frontend/index.html` | Dynamic module loader via `loadModule(name)`, sidebar nav |
| Module HTML | `frontend/modules/*.html` | Each module is an HTML file fetched via `getModuleHtml()` |
| Module JS | `frontend/js/*.js` | Module logic, e.g. `InvMovJS.js`, `StockJS.js` |
| Auth | JWT-based | `req.user` contains `userId`, `role`, `site` |
| Role permissions | `role_permissions` table | `can_view`, `can_edit`, `can_approve`, `site_scope` ('all' \| 'assigned') |

### Existing tables relevant to transfers

- **sites**: `id`, `site_id`, `name`, `code`, `active`
- **stock**: `id`, `item_id`, `site_id`, `quantity`, `available_qty`, `reserved_qty`, `is_active`
- **inventory_movements**: `movement_id`, `type`, `item_id`, `stock_id`, `quantity`, `site_id`, `performed_by`, `notes`, `created_at`
- **stock_ledger**: append-only audit of stock changes (`item_id`, `qty_change`, `transaction_type`, `reference_id`, `reference_type`, `comments`, `user_name`)
- **vehicles**: `id`, `vehicle_number`, `vehicle_type`, `license_plate`, `capacity_kg`, `is_active`
- **people**: `id`, `name`, `department`, `active`, `sector`, `email`
- **users**: `user_id`, `name`, `email`, `site`, `role`, `is_active`
- **role_permissions**: `role_id`, `module_key`, `can_view`, `can_edit`, `can_approve`, `site_scope`

## 3. Requirements (confirmed)

| # | Requirement | Confirmed Detail |
|---|-------------|------------------|
| 1 | Select **from site** and **to site** | — |
| 2 | **Start date** and **finish date** | Start date entered when despatching; **finish date is registered when received at destination** (not entered at start) |
| 3 | **Driver** selection | References **`people` table** |
| 4 | **Despatch No** (No guia) — one transfer per guia | **Unique**, user-provided (generated via official SII tax system) |
| 5 | **Vehicle No** selection | References `vehicles` table |
| 6 | Multiple items per transfer | One transfer = one guia, multiple line items |
| 7 | Stock only updated at **destination when received** | Not when despatched |
| 8 | **USER role**: can send goods from their own site; sees only their own site transfers | Sent or received transfers where user's site is from or to |
| 9 | **ADMIN, Manager, Office**: see all transfers across all sites | — |
| 10 | **Qty discrepancy handling** | At destination, user can confirm if received qty matches sent qty; if not, record the discrepancy (no partial receive per despatch) |
| 11 | **Inventory movements** | Create `inventory_movements` records for despatch and receive (audit trail) |
| 12 | **Email notifications** | Not needed for now; system can be created with flags for future use |

## 4. Database Schema Changes

### New tables

```sql
-- Site transfer header (one row per guia/transfer)
CREATE TABLE IF NOT EXISTS site_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_no TEXT UNIQUE NOT NULL,
  from_site_id INTEGER NOT NULL REFERENCES sites(id),
  to_site_id INTEGER NOT NULL REFERENCES sites(id),
  start_date TEXT,              -- set when despatched (goods leave source)
  finish_date TEXT,             -- set when received at destination (not at start)
  driver_id TEXT REFERENCES people(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  despatch_no TEXT UNIQUE,      -- No guia, unique, user-provided via SII tax system
  status TEXT DEFAULT 'draft',  -- draft, despatched, in_transit, received, cancelled
  created_by TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  received_at TEXT,             -- timestamp when received at destination
  received_by TEXT REFERENCES users(user_id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_transfers_no ON site_transfers(transfer_no);
CREATE INDEX IF NOT EXISTS idx_site_transfers_from ON site_transfers(from_site_id);
CREATE INDEX IF NOT EXISTS idx_site_transfers_to ON site_transfers(to_site_id);
CREATE INDEX IF NOT EXISTS idx_site_transfers_status ON site_transfers(status);
CREATE INDEX IF NOT EXISTS idx_site_transfers_despatch ON site_transfers(despatch_no);

-- Site transfer line items
CREATE TABLE IF NOT EXISTS site_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES site_transfers(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES products(id),
  stock_id INTEGER REFERENCES stock(id),       -- source stock record at from_site
  quantity_sent INTEGER NOT NULL DEFAULT 0,    -- qty despatched from source
  quantity_received INTEGER DEFAULT 0,         -- qty received at destination
  quantity_discrepancy INTEGER DEFAULT 0,      -- sent - received (recorded at receive)
  unit_cost REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_transfer_items_transfer ON site_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_site_transfer_items_item ON site_transfer_items(item_id);
```

### Status lifecycle

| Status | Meaning | Stock effect |
|--------|---------|--------------|
| `draft` | Transfer being prepared, not yet sent | None |
| `despatched` | Goods left source site | Source stock decremented per item |
| `in_transit` | Goods en route | Source stock decremented, destination not yet updated |
| `received` | Goods received at destination | Destination stock incremented per item (qty_received) |
| `cancelled` | Transfer cancelled | Any reserved source stock released |

**Note:** No `partially_received` status. Per despatch, all items are received together. If received qty differs from sent qty, the discrepancy is recorded in `quantity_discrepancy` per line item, and destination stock is incremented only by the actually-received quantity.

## 5. API Routes (new file: `api/src/routes/site-transfers.js`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/site-transfers` | List transfers with filters (site, status, date range, despatch_no) | authenticateToken + requirePermission('site_transfer', 'view') |
| GET | `/api/v1/site-transfers/:id` | Get single transfer with items | authenticateToken + requirePermission('site_transfer', 'view') |
| POST | `/api/v1/site-transfers` | Create transfer (draft) with items | authenticateToken + requirePermission('site_transfer', 'edit') |
| PUT | `/api/v1/site-transfers/:id` | Update transfer (draft only) | authenticateToken + requirePermission('site_transfer', 'edit') |
| DELETE | `/api/v1/site-transfers/:id` | Cancel/delete draft transfer | authenticateToken + requirePermission('site_transfer', 'edit') |
| POST | `/api/v1/site-transfers/:id/despatch` | Mark as despatched (decrement source stock) | authenticateToken + requirePermission('site_transfer', 'edit') |
| POST | `/api/v1/site-transfers/:id/receive` | Receive goods at destination (increment destination stock by qty_received, record discrepancies) | authenticateToken + requirePermission('site_transfer', 'edit') |
| POST | `/api/v1/site-transfers/:id/cancel` | Cancel transfer | authenticateToken + requirePermission('site_transfer', 'edit') |

### Role-based filtering (in `requirePermission` middleware)

- **ADMIN / Manager / Office**: `site_scope = 'all'` → no site filter, see all transfers
- **USER**: `site_scope = 'assigned'` → `req.siteFilter = user.site` → see transfers where `from_site_id = user.site OR to_site_id = user.site`
- **USER can only create transfers from their own site** (enforced in POST handler)

## 6. Permissions Changes

### `api/src/utils/permissions-seed.js`

Add to `MODULE_DEFINITIONS`:
```js
{ key: 'site_transfer', category: 'Inventory', name: 'Intra Site Transfer', moduleFile: 'SiteTransfer.html', navId: 'nav-SiteTransfer' }
```

Add to `ROLE_PERMISSIONS_DEFAULTS`:

| Role | can_view | can_edit | can_approve | site_scope |
|------|----------|----------|-------------|------------|
| admin | 1 | 1 | 1 | all |
| manager | 1 | 1 | 1 | all |
| office | 1 | 1 | 0 | all |
| user | 1 | 1 | 0 | assigned |
| driver | 0 | 0 | 0 | assigned |

## 7. Frontend Module

### New files

- `frontend/modules/SiteTransfer.html` — UI
- `frontend/js/SiteTransferJS.js` — logic

### UI Tabs

1. **Create Transfer** — form: from site (locked for USER), to site, driver (people table), vehicle, despatch no (unique), items table (add/remove items), save as draft / despatch. Start date is set automatically at despatch time.
2. **View Transfers** — list with filters (status, from/to site, date range, despatch no), click to view details including sent vs received qty and discrepancies
3. **Receive Transfer** — for transfers destined to user's site, confirm received qty per item (defaults to qty_sent), record any discrepancy, mark as received. Finish date and received_at are set automatically at receive time.

### Role-based UI behavior

- **USER**: from site auto-set to their site and locked; can only see transfers where from_site = their site OR to_site = their site
- **ADMIN / Manager / Office**: full access to all sites and all transfers

## 8. Registration in `frontend/index.html`

Add to `loadModule(name)` function:
```js
if (name === "SiteTransfer") {
  setTimeout(() => {
    if (typeof window.initSiteTransferModule === "function") {
      window.initSiteTransferModule();
    }
    if (window.applyRolePermissions) window.applyRolePermissions();
  }, 100);
}
```

Add sidebar nav item:
```html
<a id="nav-SiteTransfer" class="nav-link py-1 text-white-50 small" onclick="loadModule('SiteTransfer', this)" title="Intra Site Transfer">
  <i class="bi bi-truck me-1"></i> Site Transfer
</a>
```

## 9. Stock Flow Details

### Despatch (source site stock decremented)
1. Validate source stock has sufficient quantity for each item (quantity_sent)
2. Decrement `stock.quantity` at `from_site_id` for each item
3. Insert `stock_ledger` entries (transaction_type = 'transfer_out', reference_type = 'site_transfer')
4. Insert `inventory_movements` records (type = 'transfer_out', site_id = from_site_id)
5. Set `start_date` = now, status = 'despatched' (or 'in_transit')

### Receive (destination site stock incremented)
1. For each item, user confirms `quantity_received` (defaults to `quantity_sent`)
2. If `quantity_received` != `quantity_sent`, record `quantity_discrepancy = quantity_sent - quantity_received`
3. Increment `stock.quantity` at `to_site_id` by `quantity_received` (create stock record if not exists)
4. Insert `stock_ledger` entries (transaction_type = 'transfer_in', reference_type = 'site_transfer')
5. Insert `inventory_movements` records (type = 'transfer_in', site_id = to_site_id)
6. Set `finish_date` = now, `received_at` = now, `received_by` = current user, status = 'received'

### Key invariant
- **Destination stock is NOT incremented at despatch time** — only at receive time
- Items in transit are not visible in destination stock
- No partial receive per despatch: all items on a transfer are received together; discrepancies are recorded per line item
- `finish_date` is set only at receive time, not at despatch/start time

## 10. Implementation Steps (in order)

1. **Database schema** — Add `site_transfers` and `site_transfer_items` tables to `api/schema.sql`
2. **Seed data** — Add default permissions for `site_transfer` module in `permissions-seed.js`
3. **API routes** — Create `api/src/routes/site-transfers.js` with all endpoints
4. **Register route** — Add `app.use('/api/v1/site-transfers', siteTransferRoutes)` in `api/src/index.js`
5. **Frontend HTML** — Create `frontend/modules/SiteTransfer.html`
6. **Frontend JS** — Create `frontend/js/SiteTransferJS.js`
7. **Register module** — Add `SiteTransfer` case in `index.html` `loadModule()` + sidebar nav item
8. **Test** — Verify role-based access, stock flow, and UI behavior

## 11. Decisions Summary (all confirmed)

| Question | Decision |
|----------|----------|
| Driver field | References `people` table |
| Despatch no uniqueness | Yes, unique (user-provided via SII tax system) |
| Partial receive per despatch | No — all items received together; discrepancies recorded per line item |
| Qty discrepancy | Record `quantity_discrepancy = quantity_sent - quantity_received` per item; destination stock incremented only by received qty |
| Finish date | Set only when received at destination (not at despatch/start) |
| Inventory movements | Yes — create records for both despatch (transfer_out) and receive (transfer_in) |
| Email notifications | Not needed now; can be added later with feature flags |

## 12. Files to Create / Modify

### Create
- `api/src/routes/site-transfers.js`
- `frontend/modules/SiteTransfer.html`
- `frontend/js/SiteTransferJS.js`
- `Plan-IntraSiteTransfer.md` (this file)

### Modify
- `api/schema.sql` — add transfer tables
- `api/src/utils/permissions-seed.js` — add module key + role defaults
- `api/src/index.js` — register new route
- `frontend/index.html` — add loadModule case + sidebar nav item
