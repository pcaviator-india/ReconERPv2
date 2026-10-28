# RECON ERP API — Node/SQLite port of the Google Apps Script backend

This service replaces ~30 Apps Script `.gs` files with a REST API. The
frontend (`../frontend`) is served unchanged by this same process; a
`google.script.run` compatibility layer (`frontend/js/gas-shim.js`) routes
calls either to a REST endpoint or to the generic legacy adapter.

## Running

```bash
npm install          # installs better-sqlite3 (dev) + express etc.
npm run seed         # creates/recreates recon-erp.sqlite from schema.sql
npm start            # API + frontend on the port described below
```

Login with the seeded admin: **user_id `1001`, PIN `1234`**.

## Port selection

`PORT` is resolved in this order:

1. **Process environment** (shell `$env:PORT`, systemd/cloud env, CI). Wins
   over everything below.
2. `PORT` in `api/.env` (loaded by `dotenv`, which does **not** override an
   already-set variable) — default `3000`.
3. Hard-coded fallback `3000`.

The startup banner prints the effective value and its source:

```
RECON ERP API running on port 3997
  effective PORT = 3997 (source: environment variable)
  DB_PATH        = recon-erp.sqlite
```

If the server listens on a different port than you set in `.env`, a
higher-priority environment variable is set. Check it with:

- PowerShell: `[Environment]::GetEnvironmentVariable('PORT','User')`
- or just read the startup banner.

## Database

`DB_PATH` (env or `.env`) selects the SQLite file; default
`api/recon-erp.sqlite`. The schema is **self-applied at startup**
(`src/db.js → applyMigrations()`), so a fresh clone works without running
the seed first. The seed script is only needed to (re)create the file with
sample data.

New tables/columns go in `schema.sql` (guarded by `CREATE TABLE IF NOT
EXISTS`). Column additions to existing tables must also be listed in
`COLUMN_MIGRATIONS` in `src/db.js`, otherwise already-created databases
never receive them.

## Legacy adapter (`POST /api/v1/legacy/:fn`)

The frontend still calls the original GAS function names. The adapter maps
each one to SQL and returns the **raw GAS return value** (no
`{status, data}` envelope), so the unmodified frontend keeps working.

- Implemented functions live in `IMPLEMENTED` (`src/routes/legacy.js`).
- Functions that need an external integration the API does not provide yet
  (Microsoft Graph/SendGrid email, Google Drive, R2 uploads, PDF text
  extraction) are listed in `KNOWN_UNIMPLEMENTED` and answer
  `{ "__legacy": true }` so the client degrades gracefully.
- Anything else answers `404`, which usually means a missing entry.

### Coverage

`scripts/legacy-coverage.js` compares the adapter against
`scripts/gas-calls.json` (the 96 functions the frontend actually calls) and
fails on duplicates, uncovered functions, or stale stubs:

```bash
npm run test:coverage
```

Current: **96 = 81 implemented + 15 stubs**, no gaps.

## Tests

| Command | What it covers |
| --- | --- |
| `npm run test:coverage` | static check that every GAS function is implemented or declared stub |
| `npm run test:smoke` | boots the server, static frontend + auth + a few legacy calls |
| `npm run test:legacy` | calls **all 96** legacy functions with realistic args |
| `npm run test:shapes` | asserts each response has the exact GAS field names |
| `npm test` | all of the above |

The two `legacy-*` suites need a running server; `test:smoke` starts its
own on port 3999.

## Known gaps (the 15 stubs)

| Group | Functions | Needs |
| --- | --- | --- |
| Email / Graph | `dispatchEmailWithProvider`, `sendFinalRFQ`, `sendPoReminderEmail`, `getUiLastReceivedEmail`, `testMailReadWriteCapability`, `testSendEmailViaGraph`, `testSendThreadReply`, `testSendThreadSeed` | Microsoft Graph / SendGrid credentials |
| PDF | `extractInvoicePDFText`, `saveImportedInvoice`, `processPendingHSEPDFs` | PDF text extraction (e.g. pdf-parse) + Drive/R2 |
| Drive export | `master_ExportToDrive`, `processAndSaveBulkPO` | Google Drive |
| File upload | `uploadQuoteAttachment`, `uploadRequirementItemImages` | R2 (the `files` table already exists) |
