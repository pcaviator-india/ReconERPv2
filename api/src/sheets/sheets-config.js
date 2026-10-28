'use strict';

/**
 * sheets-config.js — Extraction of sheet names + column headers from the old
 * Google Apps Script code (RECON ERP).
 *
 * The old code read sheets as ranges (getDataRange().getValues()) and then
 * addressed cells with hard-coded column indices (row[0], row[1], ...) or,
 * in a few places, by header name (headers.indexOf("Name")). This module
 * records, for every sheet that must be synced to the local SQLite / Cloudflare
 * D1 database:
 *
 *   - gasSheet:    the tab name in the Google Spreadsheet
 *   - dbTable:     the target table in the DB
 *   - naturalKey:  the field(s) used as the upsert key
 *   - columns:     [{ index, header, dbField, parse }]
 *       • index:    0-based column position in the sheet range (from row[i])
 *       • header:   the column header the old code found via headers.indexOf()
 *       • dbField:  the target schema field
 *       • parse:    optional value-coercion used by the old code
 *
 * Notes:
 *   • `index` is 0-based (Excel column A = 0), matching row[i] in the old code.
 *   • `header` is only filled when the old code located the column by header
 *     name; otherwise it is the guessed header name used for documentation.
 *   • Master (products) fields category/sub_category/brand/supplier are TEXT in
 *     the sheet and will be resolved to category_id / sub_category_id /
 *     brand_id / supplier_id via the reference endpoints.
 */

const SHEETS = Object.freeze({
  // --- Reference / master data ----------------------------------------------


  people: {
    gasSheet: 'People',
    dbTable: 'people',
    naturalKey: ['id'],
    columns: [
      { index: 0, header: 'ID (RD-xxx)', dbField: 'id', parse: v => String(v) },
      { index: 1, header: 'Name', dbField: 'name' },
      { index: 2, header: 'Department', dbField: 'department' },
      { index: 3, header: 'Active', dbField: 'active', parse: v => Number(v) || 0 },
      { index: 4, header: 'Sector', dbField: 'sector' },
      { index: 6, header: 'RUT', dbField: 'rut' },
      { index: 7, header: 'Biometric template', dbField: 'biometric_template' },
      { index: 8, header: 'Email', dbField: 'email' },
    ],
  },

  movementVal: {
    gasSheet: 'Movement_Val',
    dbTable: 'movement_val',
    naturalKey: [],
    columns: [
      { index: 0, header: 'Sector', dbField: 'sector' },
      { index: 1, header: 'Maquina', dbField: 'maquinaria' },
      { index: 2, header: 'Generador', dbField: 'generadores' },
      { index: 3, header: 'Vehiculo', dbField: 'vehiculos' },
    ],
  },

  master: {
    gasSheet: 'Master',
    dbTable: 'products',
    naturalKey: ['geo'],
    columns: [
      { index: 0, header: 'Geo', dbField: 'geo' },
      { index: 1, header: 'P/N', dbField: 'pn' },
      { index: 2, header: 'Name', dbField: 'name' },
      { index: 3, header: 'Description (en)', dbField: 'description' },
      { index: 4, header: 'Description (es)', dbField: 'description_es' },
      { index: 5, header: 'Category', dbField: 'category', parse: v => String(v || '').trim() },
      { index: 6, header: 'SubCategory', dbField: 'subCategory', parse: v => String(v || '').trim() },
      { index: 7, header: 'Brand', dbField: 'brand', parse: v => String(v || '').trim() },
      { index: 8, header: 'Supplier', dbField: 'supplier', parse: v => String(v || '').trim() },
      { index: 9, header: 'Unit', dbField: 'unit' },
      { index: 10, header: 'Cost', dbField: 'cost', parse: v => Number(v) || 0 },
      { index: 11, header: 'MinQty', dbField: 'min_qty', parse: v => Number(v) || 0 },
      { index: 12, header: 'MaxQty', dbField: 'max_qty', parse: v => Number(v) || 0 },
      { index: 13, header: 'ETA', dbField: 'eta' },
      { index: 14, header: 'IsActive', dbField: 'is_active', parse: v => Number(v) || 0 },
    ],
  },

  stock: {
    gasSheet: 'Stock',
    dbTable: 'stock',
    naturalKey: ['item_id', 'site_id'],
    columns: [
      { index: 0, header: 'ItemID', dbField: 'item_id' },
      { index: 1, header: 'ProductName', dbField: 'product_name' },
      { index: 2, header: 'LocationType', dbField: 'location_type' },
      { index: 3, header: 'LocationID', dbField: 'location_id' },
      { index: 4, header: 'Quantity', dbField: 'quantity', parse: v => Number(v) || 0 },
      { index: 5, header: 'ReservedQty', dbField: 'reserved_qty', parse: v => Number(v) || 0 },
      { index: 6, header: 'AvailableQty', dbField: 'available_qty', parse: v => Number(v) || 0 },
      { index: 7, header: 'LastUpdated', dbField: 'last_updated' },
      { index: 8, header: 'UpdatedBy', dbField: 'updated_by' },
    ],
  },

  itemLocationMap: {
    gasSheet: 'ItemLocationMap',
    dbTable: 'item_location_map',
    naturalKey: ['location_id', 'item_id'],
    columns: [
      { index: 0, header: 'LocationID', dbField: 'location_id' },
      { index: 1, header: 'RackID', dbField: 'rack_id' },
      { index: 2, header: 'SideCode', dbField: 'side_code' },
      { index: 3, header: 'ShelfLevel', dbField: 'shelf_level' },
      { index: 4, header: 'ItemID', dbField: 'item_id' },
    ],
  },

  rackConfig: {
    gasSheet: 'RackConfig',
    dbTable: 'item_location_map',
    naturalKey: ['location_id'],
    columns: [
      { index: 0, header: 'LocationID', dbField: 'location_id' },
      { index: 1, header: 'RackID', dbField: 'rack_id' },
      { index: 2, header: 'HasSides', dbField: 'has_sides', parse: v => (String(v).toLowerCase() === 'yes' ? 1 : 0) },
      { index: 3, header: 'NoOfShelves', dbField: 'no_of_shelves', parse: v => parseInt(v, 10) || null },
    ],
  },


  // --- Movements / inventory -------------------------------------------------

  invMovement: {
    gasSheet: 'Inv_Movement',
    dbTable: 'inventory_movements',
    naturalKey: ['movement_id'],
    columns: [
      { index: 0, header: 'MovementID', dbField: 'movement_id' },
      { index: 1, header: 'Timestamp', dbField: 'movement_timestamp' },
      { index: 2, header: 'Geo', dbField: 'geo' },
      { index: 3, header: 'Type (ISSUE/RETURN)', dbField: 'type' },
      { index: 4, header: 'Qty', dbField: 'quantity', parse: v => Number(v) || 0 },
      { index: 5, header: 'Person', dbField: 'person' },
      { index: 6, header: 'Sector', dbField: 'sector' },
      { index: 7, header: 'Maquina', dbField: 'maquina' },
      { index: 8, header: 'Generador', dbField: 'generador' },
      { index: 9, header: 'Vehiculo', dbField: 'vehiculo' },
      { index: 10, header: 'Condition', dbField: 'condition' },
      { index: 11, header: 'Comments', dbField: 'comments' },
      { index: 12, header: 'UserSite', dbField: 'site' },
    ],
  },

  itemStatus: {
    gasSheet: 'ItemStatus',
    dbTable: 'item_status',
    naturalKey: ['geo'],
    columns: [
      { index: 0, header: 'Barcode/Geo', dbField: 'geo' },
      { index: 1, header: 'Status', dbField: 'status' },
      { index: 2, header: 'Holder', dbField: 'person' },
      { index: 3, header: 'Sector', dbField: 'sector' },
      { index: 4, header: 'Timestamp', dbField: 'status_timestamp' },
      { index: 5, header: 'Condition', dbField: 'condition' },
    ],
  },

  hseSignatures: {
    gasSheet: 'HSE_Signatures',
    dbTable: 'hse_signatures',
    naturalKey: ['movement_id'],
    columns: [
      { index: 0, header: 'MovementID', dbField: 'movement_id' },
      { index: 1, header: 'WorkerID (RUT)', dbField: 'worker_id' },
      { index: 2, header: 'WorkerName', dbField: 'worker_name' },
      { index: 3, header: 'FingerprintBase64', dbField: 'fingerprint_base64' },
      { index: 4, header: 'MatchScore', dbField: 'match_score', parse: v => Number(v) || 0 },
      { index: 5, header: 'MatchTimestamp', dbField: 'match_timestamp' },
      { index: 6, header: 'ItemsCount', dbField: 'items_count', parse: v => Number(v) || 0 },
      { index: 7, header: 'PDFDriveLink', dbField: 'pdf_url' },
      { index: 8, header: 'Status', dbField: 'status' },
      { index: 9, header: 'HSEItemsJSON', dbField: 'hse_items_json' },
    ],
  },

  minMax: {
    gasSheet: 'MinMax',
    dbTable: 'min_max',
    naturalKey: ['site', 'geo_code'],
    columns: [
      { index: 0, header: 'Site', dbField: 'site' },
      { index: 1, header: 'Geo Code', dbField: 'geo_code' },
      { index: 2, header: 'Min', dbField: 'min_qty', parse: v => Number(v) || null },
      { index: 3, header: 'Max', dbField: 'max_qty', parse: v => Number(v) || null },
      { index: 4, header: 'LastUpdated', dbField: 'last_updated' },
      { index: 5, header: 'UpdatedBy', dbField: 'updated_by' },
    ],
  },

  controlCombustible: {
    gasSheet: 'ControlCombustible',
    dbTable: 'fuel_entries',
    naturalKey: ['asset_id', 'entry_date'],
    columns: [
      { index: 0, header: 'Date', dbField: 'entry_date' },
      { index: 1, header: 'Proyecto', dbField: 'proyecto' },
      { index: 2, header: 'TipoActivo', dbField: 'tipo_activo' },
      { index: 3, header: 'ID/Patente', dbField: 'asset_id' },
      { index: 4, header: 'Litros', dbField: 'liters', parse: v => Number(v) || 0 },
      { index: 5, header: 'KM', dbField: 'odometer_km', parse: v => parseInt(v, 10) || null },
      { index: 6, header: 'Nombre', dbField: 'vehicle' },
      { index: 7, header: 'User', dbField: 'user_email' },
    ],
  },

  compraCombustible: {
    gasSheet: 'CompraCombustible',
    dbTable: 'fuel_purchases',
    naturalKey: ['proveedor', 'purchase_date'],
    columns: [
      { index: 0, header: 'Date', dbField: 'purchase_date' },
      { index: 1, header: 'Proveedor', dbField: 'proveedor' },
      { index: 2, header: 'Litros', dbField: 'litros', parse: v => Number(v) || 0 },
      { index: 3, header: 'Factura', dbField: 'factura' },
      { index: 4, header: 'User', dbField: 'user_name' },
    ],
  },


  // --- Requisitions / quotes -------------------------------------------------

  ordenes: {
    gasSheet: 'Ordenes',
    dbTable: 'requisitions',
    naturalKey: ['requisition_no'],
    columns: [
      { index: 0, header: 'OrderID (DRAFT-xxx)', dbField: 'requisition_no' },
      { index: 1, header: 'Fecha', dbField: 'created_at' },
      { index: 2, header: 'P/N', dbField: 'pn' },
      { index: 3, header: 'Geo Code', dbField: 'geo' },
      { index: 4, header: 'Faena', dbField: 'site' },
      { index: 5, header: 'Desc Es', dbField: 'notes' },
      { index: 6, header: 'Cantidad', dbField: 'quantity_requested', parse: v => Number(v) || 0 },
      { index: 7, header: 'Estado', dbField: 'status' },
      { index: 8, header: 'User', dbField: 'requested_by' },
      { index: 12, header: 'Category', dbField: 'category' },
      { index: 16, header: 'SubArea', dbField: 'sub_area' },
      { index: 17, header: 'SubArea No', dbField: 'sub_area_no' },
      { index: 18, header: 'Emails', dbField: 'emails' },
      { index: 19, header: 'Notes', dbField: 'notes' },
    ],
  },

  quotes: {
    gasSheet: 'Quotes',
    dbTable: 'quotes',
    naturalKey: ['quote_no'],
    columns: [
      { index: 0, header: 'Ref ID', dbField: 'quote_no' },
      { index: 1, header: 'Proveedor', dbField: 'supplier' },
      { index: 2, header: 'Category', dbField: 'category' },
      { index: 3, header: 'Estado', dbField: 'status' },
    ],
  },

  // --- Stock counts -----------------------------------------------------------

  stockCounts: {
    gasSheet: 'StockCounts',
    dbTable: 'stock_counts',
    naturalKey: ['count_id'],
    columns: [
      { index: 0, header: 'CountID', dbField: 'count_id' },
      { index: 1, header: 'Date', dbField: 'count_date' },
      { index: 2, header: 'UserName', dbField: 'user_name' },
      { index: 3, header: 'Status', dbField: 'status' },
      { index: 4, header: 'Location', dbField: 'location' },
    ],
  },

  stockCountItems: {
    gasSheet: 'StockCountItems',
    dbTable: 'stock_count_items',
    naturalKey: ['count_id', 'barcode'],
    columns: [
      { index: 0, header: 'CountID', dbField: 'count_id' },
      { index: 1, header: 'Barcode', dbField: 'barcode' },
      { index: 2, header: 'Geo', dbField: 'geo' },
      { index: 3, header: 'PN', dbField: 'product_number' },
      { index: 4, header: 'EN', dbField: 'desc_en' },
      { index: 5, header: 'ES', dbField: 'desc_es' },
      { index: 6, header: 'Qty', dbField: 'quantity', parse: v => Number(v) || 0 },
    ],
  },

  // --- Validation (multi-section source) ------------------------------------------

  validation: {
    // "Validation" is NOT a single table. It is a multi-section workbook used to
    // seed: sites, categories, brands, suppliers, sub_areas, currencies.
    // Section layout (0-based columns observed in the old code):
    //   A2:C  => sites (name, email, suffix)
    //   F/G   => categories (name, email)
    //   H     => parCategories (parent)
    //   I     => subCategories (name, parent)
    //   K     => brands
    //   P/Q   => suppliers (name, email)
    gasSheet: 'Validation',
    dbTables: ['sites', 'categories', 'brands', 'suppliers', 'sub_areas', 'currencies'],
    sections: {
      sites: {
        headerStart: 0,
        columns: [
          { index: 0, header: 'Site name', dbField: 'name' },
          { index: 1, header: 'Email', dbField: 'email' },
          { index: 2, header: 'Suffix', dbField: 'suffix' },
        ],
      },
      categories: {
        headerStart: 5,
        columns: [
          { index: 5, header: 'Category', dbField: 'name' },
          { index: 6, header: 'Email', dbField: 'email' },
        ],
      },
      brands: {
        headerStart: 10,
        columns: [
          { index: 10, header: 'Brand', dbField: 'name' },
        ],
      },
      suppliers: {
        headerStart: 15,
        columns: [
          { index: 15, header: 'Supplier', dbField: 'name' },
          { index: 16, header: 'Email', dbField: 'email' },
        ],
      },
    },
  },

  // --- Config --------------------------------------------------------------------

  config: {
    gasSheet: 'Config',
    dbTable: 'config',
    naturalKey: ['key'],
    columns: [
      { index: 0, header: 'Key', dbField: 'key' },
      { index: 1, header: 'Value', dbField: 'value' },
    ],
  },

  // --- Macro history log -------------------------------------------------------

  macroHistoryLog: {
    gasSheet: 'MacroHistoryLog',
    dbTable: 'macro_history_log',
    naturalKey: ['timestamp'],
    columns: [
      { index: 0, header: 'Timestamp', dbField: 'timestamp' },
      { index: 1, header: 'UserEmail', dbField: 'user_email' },
      { index: 2, header: 'PoCount', dbField: 'po_count', parse: v => Number(v) || 0 },
      { index: 3, header: 'ExportType', dbField: 'export_type' },
      { index: 4, header: 'FileID', dbField: 'file_id' },
    ],
  },

  bundles: {
    gasSheet: 'Bundles',
    dbTable: 'bundles',
    naturalKey: ['bundle_id'],
    columns: [
      { index: 0, header: 'Bundle ID', dbField: 'bundle_id' },
      { index: 1, header: 'Bundle Name', dbField: 'name' },
      { index: 2, header: 'Active', dbField: 'is_active', parse: v => (String(v).toUpperCase() === 'TRUE' ? 1 : 0) },
    ],
  },

  bundleItems: {
    gasSheet: 'Bundle_Items',
    dbTable: 'bundle_items',
    naturalKey: ['bundle_id', 'geo_code'],
    columns: [
      { index: 0, header: 'Bundle ID', dbField: 'bundle_id' },
      { index: 1, header: 'Geo Code', dbField: 'geo_code' },
      { index: 2, header: 'Qty', dbField: 'qty', parse: v => Number(v) || 0 },
    ],
  },
});

/** @type {Object.<string, string>} GAS sheet tab => internal key */
const GAS_TO_KEY = Object.freeze(
  Object.entries(SHEETS).reduce((acc, [key, meta]) => {
    acc[meta.gasSheet] = key;
    return acc;
  }, {})
);

/** @type {Object.<string, string>} internal key => target DB table */
const KEY_TO_DB_TABLE = Object.freeze(
  Object.entries(SHEETS).reduce((acc, [key, meta]) => {
    acc[key] = meta.dbTable;
    return acc;
  }, {})
);

/** @type {Object.<string, string>} multi-table source => tables */
const GAS_TO_DB_TABLES = Object.freeze({
  Validation: 'sites:categories:brands:suppliers:sub_areas:currencies',
});

/**
 * Resolve a GAS sheet tab name to the internal config key.
 * @param {string} gasSheet
 * @returns {string|null} config key, or null when unknown
 */
function gasKeyForSheet(gasSheet) {
  return GAS_TO_KEY[gasSheet] || null;
}

/**
 * Resolve a config key to its target DB table(s).
 * @param {string} key
 * @returns {string[]} list of target table names
 */
function tablesForKey(key) {
  const meta = SHEETS[key];
  if (!meta) return [];
  return Array.isArray(meta.dbTables) ? meta.dbTables : [meta.dbTable];
}

/**
 * Helper: for the multi-section "Validation" sheet, returns the column index
 * in the source row for a given section + header.
 * @param {string} section - 'sites'|'categories'|'brands'|'suppliers'
 * @param {string} header
 * @returns {number} 0-based index, or -1 when not found
 */
function validationColumnSectionIndex(section, header) {
  const meta = SHEETS.validation;
  const sectionMap = {
    sites: meta.sections.sites,
    categories: meta.sections.categories,
    brands: meta.sections.brands,
    suppliers: meta.sections.suppliers,
  };
  const sec = sectionMap[section];
  if (!sec) return -1;
  return sec.columns.findIndex((c) => c.header === header);
}

module.exports = {
  SHEETS,
  GAS_TO_KEY,
  KEY_TO_DB_TABLE,
  GAS_TO_DB_TABLES,
  gasKeyForSheet,
  tablesForKey,
  validationColumnSectionIndex,
};
