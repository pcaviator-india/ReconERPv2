// =============================================
// MinMaxGS.gs - Per-Site Product Min/Max Management
// Stores per-site Min/Max thresholds for the Store (main warehouse)
// and requirement creation, keyed by (Site, Geo Code).
// Falls back to the global Master (Master sheet) min/max when no
// per-site override exists.
// =============================================

/**
 * Returns (creating it if needed) the MinMax sheet with headers:
 * Site | Geo Code | Min | Max | LastUpdated | UpdatedBy
 */
function getMinMaxSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("MinMax");
  if (!sheet) {
    sheet = ss.insertSheet("MinMax");
    sheet
      .getRange(1, 1, 1, 6)
      .setValues([["Site", "Geo Code", "Min", "Max", "LastUpdated", "UpdatedBy"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Builds a per-site min/max overlay map: { geo: { min, max } }.
 * Per-site rows override the global Master min/max.
 * @param {string} site
 * @returns {Object}
 */
function getSiteMinMaxMap(site) {
  const map = {};
  const inv = getInventoryData() || [];
  inv.forEach((i) => {
    if (i.geo) {
      map[String(i.geo).trim()] = {
        min: Number(i.min) || 0,
        max: Number(i.max) || 0,
      };
    }
  });

  const sheet = getMinMaxSheet_();
  const vals = sheet.getDataRange().getValues();
  const target = String(site || "").trim().toUpperCase();

  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim().toUpperCase() !== target) continue;
    const geo = String(vals[i][1] || "").trim();
    if (!geo) continue;
    map[geo] = {
      min: Number(vals[i][2]) || 0,
      max: Number(vals[i][3]) || 0,
    };
  }

  return map;
}

/**
 * Convenience accessor for a single product within a site (with global fallback).
 * @param {string} site
 * @param {string} geo
 * @returns {{min:number, max:number}}
 */
function getPerSiteMinMaxForProduct(site, geo) {
  const map = getSiteMinMaxMap(site);
  const key = String(geo || "").trim();
  return map[key] || { min: 0, max: 0 };
}

/**
 * Suggests a requirement quantity for a product at a site so that the
 * site's current stock + qty reaches at least Min (capped at Max).
 * Client stays authoritative (user may override); this is guidance only.
 * @param {string} site
 * @param {string} geo
 * @param {number} requestedQty
 * @param {number} currentSiteStock
 * @returns {{suggested:number, min:number, max:number, belowMin:boolean, aboveMax:boolean}}
 */
function getSuggestedRequirementQty(site, geo, requestedQty, currentSiteStock) {
  const { min, max } = getPerSiteMinMaxForProduct(site, geo);
  const stock = Number(currentSiteStock) || 0;
  const req = Math.max(0, Number(requestedQty) || 0);

  // Suggested = what is needed to reach Min from current stock.
  let suggested = 1;
  if (min > 0) {
    suggested = Math.max(1, min - stock);
  }
  if (max > 0 && suggested > max) {
    suggested = Math.max(1, max);
  }

  const belowMin = min > 0 && stock + req < min;
  const aboveMax = max > 0 && req > max && stock > 0;

  return { suggested, min, max, belowMin, aboveMax };
}

/**
 * Returns the full data matrix for the MinMax maintenance module.
 * @returns {{rows:Array, products:Array, sites:Array}}
 */
function getMinMaxData() {
  // Global fallback values from Master sheet.
  const globalByGeo = new Map();
  try {
    (getInventoryData() || []).forEach((i) => {
      if (i.geo) {
        globalByGeo.set(String(i.geo).trim(), { min: i.min, max: i.max });
      }
    });
  } catch (e) {
    Logger.log("getMinMaxData: inventory fallback error " + e);
  }

  // Sites list from Validation.
  let sites = [];
  try {
    const val = getValidationData();
    sites = (val.sites || []).map((s) => s.name);
  } catch (e) {
    Logger.log("getMinMaxData: sites error " + e);
  }

  const sheet = getMinMaxSheet_();
  const vals = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const site = String(vals[i][0] || "").trim();
    const geo = String(vals[i][1] || "").trim();
    if (!site || !geo) continue;
    rows.push({
      site,
      geo,
      min: Number(vals[i][2]) || 0,
      max: Number(vals[i][3]) || 0,
      lastUpdated: vals[i][4] ? String(vals[i][4]) : "",
      updatedBy: String(vals[i][5] || "") || "",
    });
  }

  // Products with global fallback (for display / defaults).
  const products = Array.from(globalByGeo.entries()).map(([geo, fb]) => ({
    geo,
    globalMin: fb.min,
    globalMax: fb.max,
  }));

  return { rows, products, sites };
}

/**
 * Upserts per-site min/max rows into the MinMax sheet.
 * @param {Array} rows - [{ site, geo, min, max }]
 * @returns {{success:boolean, count:number}}
 */
function saveMinMaxItems(rows) {
  if (!rows || !Array.isArray(rows)) {
    throw new Error("saveMinMaxItems: rows array required");
  }

  const sheet = getMinMaxSheet_();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const user = Session.getActiveUser
    ? String(Session.getActiveUser().getEmail() || "") || "System"
    : "System";

  // Build lookup of existing row indices keyed by `SITE__GEO`.
  const keyToRow = new Map();
  for (let i = 1; i < data.length; i++) {
    const site = String(data[i][0] || "").trim().toUpperCase();
    const geo = String(data[i][1] || "").trim().toUpperCase();
    if (site && geo) keyToRow.set(site + "__" + geo, i + 1);
  }

  let count = 0;
  rows.forEach((entry) => {
    const site = String(entry.site || "").trim();
    const geo = String(entry.geo || "").trim();
    if (!site || !geo) return;

    const min = Math.max(0, Number(entry.min) || 0);
    const max = Math.max(0, Number(entry.max) || 0);
    const key = site.toUpperCase() + "__" + geo.toUpperCase();

    const existingRow = keyToRow.get(key);
    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, 6).setValues([
        [site, geo, min, max, now, user],
      ]);
    } else {
      sheet.appendRow([site, geo, min, max, now, user]);
      keyToRow.set(key, sheet.getLastRow());
    }
    count++;
  });

  return { success: true, count };
}

/**
 * Bulk delete of per-site min/max rows (used by the maintenance module).
 * @param {Array} rows - [{ site, geo }]
 * @returns {{success:boolean, deleted:number}}
 */
function deleteMinMaxItems(rows) {
  if (!rows || !Array.isArray(rows)) {
    throw new Error("deleteMinMaxItems: rows array required");
  }
  const sheet = getMinMaxSheet_();
  const data = sheet.getDataRange().getValues();
  const toDelete = [];

  rows.forEach((entry) => {
    const site = String(entry.site || "").trim().toUpperCase();
    const geo = String(entry.geo || "").trim().toUpperCase();
    for (let i = 1; i < data.length; i++) {
      if (
        String(data[i][0] || "").trim().toUpperCase() === site &&
        String(data[i][1] || "").trim().toUpperCase() === geo
      ) {
        toDelete.push(i + 1);
        break;
      }
    }
  });

  // Delete from bottom up.
  let deleted = 0;
  toDelete
    .sort((a, b) => b - a)
    .forEach((row) => {
      sheet.deleteRow(row);
      deleted++;
    });

  return { success: true, deleted };
}

/**
 * Parses an uploaded Excel file (first sheet) into a matrix of rows.
 * Uses Drive conversion to Google Sheets - no external libraries required.
 * @param {string} base64 - base64 payload of the xlsx/xls file
 * @param {string} fileName - original file name (extension drives the MIME type)
 * @returns {{success:boolean, rows:Array<Array>, message?:string}}
 */
function importMinMaxExcel(base64, fileName) {
  let tempFile = null;
  try {
    if (!base64) return { success: false, message: "Empty file payload" };

    const name = String(fileName || "upload.xlsx").toLowerCase();
    const mime = name.endsWith(".xls")
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, "mm_import_" + Date.now() + "_" + name);
    tempFile = DriveApp.createFile(blob);

    // Convert to Google Sheets so the Spreadsheet service can read it.
    const resource = { name: tempFile.getName(), mimeType: MimeType.GOOGLE_SHEETS };
    tempFile = Drive.Files.update(resource, tempFile.getId(), tempFile);
    const ss = SpreadsheetApp.openById(tempFile.getId());
    const sheet = ss.getSheets()[0];
    const rows = sheet.getDataRange().getDisplayValues();

    return { success: true, rows: rows };
  } catch (e) {
    return { success: false, message: "Excel parse failed: " + e.message };
  } finally {
    // Clean up the temp Drive file
    try {
      if (tempFile) DriveApp.getFileById(tempFile.getId()).setTrashed(true);
    } catch (e2) { /* ignore cleanup errors */ }
  }
}

/**
 * Imports min/max rows from the import preview, honoring the conflict mode.
 * @param {Array} rows - [{ site, geo, min, max }]
 * @param {string} mode - "replace" (upsert) | "newOnly" (skip existing)
 * @returns {{saved:number, skipped:number, failed:number}}
 */
function saveMinMaxImport(rows, mode) {
  if (!rows || !Array.isArray(rows) || !rows.length) {
    throw new Error("saveMinMaxImport: rows array required");
  }
  const conflictMode = mode === "newOnly" ? "newOnly" : "replace";

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Server-side re-validation: valid rows only
    const valid = [];
    let failed = 0;
    rows.forEach((entry) => {
      const site = String(entry.site || "").trim();
      const geo = String(entry.geo || "").trim();
      if (!site || !geo) { failed++; return; }
      const min = Math.max(0, Number(entry.min) || 0);
      const max = Math.max(0, Number(entry.max) || 0);
      valid.push({ site: site, geo: geo, min: min, max: max });
    });

    // De-duplicate within the import itself (last wins)
    const byKey = new Map();
    valid.forEach((r) => {
      byKey.set(r.site.toUpperCase() + "__" + r.geo.toUpperCase(), r);
    });

    const sheet = getMinMaxSheet_();
    const data = sheet.getDataRange().getValues();
    const existing = new Set();
    for (let i = 1; i < data.length; i++) {
      const site = String(data[i][0] || "").trim().toUpperCase();
      const geo = String(data[i][1] || "").trim().toUpperCase();
      if (site && geo) existing.add(site + "__" + geo);
    }

    // Split according to conflict mode
    const toWrite = [];
    let skipped = 0;
    byKey.forEach((r, key) => {
      if (existing.has(key)) {
        if (conflictMode === "replace") toWrite.push(r);
        else skipped++;
      } else {
        toWrite.push(r);
      }
    });

    let saved = 0;
    if (toWrite.length) {
      const res = saveMinMaxItems(toWrite);
      saved = res.count || 0;
    }

    return { saved: saved, skipped: skipped, failed: failed };
  } finally {
    lock.releaseLock();
  }
}

