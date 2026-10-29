'use strict';

/**
 * transformer.js — Normalization and Parent-Child splitting for legacy Google Sheets
 * Full 32-tab coverage with complete column mappings for all legacy GAS sheets.
 */

const SCHEMA_DEFINITIONS = {
  ordenes: {
    key: 'ordenes',
    label: 'Orders & Requisitions',
    gasSheet: 'Ordenes',
    isSplit: true,
    groupKeyField: 'requisition_no',
    parentTable: 'requisitions',
    childTable: 'requisition_items',
    parentFields: [
      { field: 'requisition_no', label: 'Order / Req Number (Unique Key)', required: true },
      { field: 'created_at', label: 'Date / Time' },
      { field: 'site', label: 'Site / Faena' },
      { field: 'status', label: 'Status / Estado' },
      { field: 'requested_by', label: 'Requested By / User' },
      { field: 'quote_id', label: 'Quote ID' },
      { field: 'po_status', label: 'PO Status' },
      { field: 'po_no', label: 'PO Number' },
      { field: 'category', label: 'Category' },
      { field: 'pdf_url', label: 'Req PDF Link' },
      { field: 'quo_pdf_url', label: 'Quote PDF Link' },
      { field: 'last_modified_by', label: 'Last Modified By' },
      { field: 'last_modified_date', label: 'Last Modified Date' },
      { field: 'mod_count', label: 'Mod Count', type: 'number' },
      { field: 'emails', label: 'Notification Emails' },
      { field: 'sub_area', label: 'SubArea' },
      { field: 'sub_area_no', label: 'SubArea No' },
      { field: 'notes', label: 'Order Notes' },
    ],
    childFields: [
      { field: 'geo', label: 'GEO Code (Item)', required: true },
      { field: 'pn', label: 'Part Number (P/N)' },
      { field: 'description_es', label: 'Description (Spanish)' },
      { field: 'quantity_requested', label: 'Quantity Requested', type: 'number' },
      { field: 'item_notes', label: 'Item Notes' },
      { field: 'supplier_notes', label: 'Supplier Notes' },
      { field: 'images', label: 'Item Images (URLs)' },
    ],
    defaultMapping: {
      'Order': 'parent.requisition_no',
      'Fecha/Hora': 'parent.created_at',
      'P/N': 'child.pn',
      'Geo Code': 'child.geo',
      'Faena': 'parent.site',
      'Desc Es': 'child.description_es',
      'Cantidad': 'child.quantity_requested',
      'Estado': 'parent.status',
      'User': 'parent.requested_by',
      'Quote ID': 'parent.quote_id',
      'PO Status': 'parent.po_status',
      'PO No.': 'parent.po_no',
      'Category': 'parent.category',
      'Req PDF Link': 'parent.pdf_url',
      'Quo PDF Link': 'parent.quo_pdf_url',
      'lastModifiedBy': 'parent.last_modified_by',
      'lastModifiedDate': 'parent.last_modified_date',
      'modCount': 'parent.mod_count',
      'Emails': 'parent.emails',
      'SubArea': 'parent.sub_area',
      'SubArea No': 'parent.sub_area_no',
      'Notes': 'parent.notes',
      'Item Notes': 'child.item_notes',
      'Supplier Notes': 'child.supplier_notes',
      'Item Images': 'child.images'
    }
  },

  quotes: {
    key: 'quotes',
    label: 'Quotes & RFQs',
    gasSheet: 'Quotes',
    isSplit: true,
    groupKeyField: 'quote_no',
    parentTable: 'quotes',
    childTable: 'quote_items',
    parentFields: [
      { field: 'quote_no', label: 'Quote / RFQ Number (Unique Key)', required: true },
      { field: 'ref_id', label: 'Associated Requisition No (Ref ID)' },
      { field: 'created_at', label: 'Quote Date' },
      { field: 'supplier', label: 'Supplier Name' },
      { field: 'site', label: 'Site / Faena' },
      { field: 'ref_cotiz', label: 'Supplier Quote Ref (Ref Cotiz.)' },
      { field: 'status', label: 'Quote Status' },
      { field: 'pdf_url', label: 'Quote PDF Link' },
      { field: 'fecha_acordada', label: 'Agreed Delivery Date' },
      { field: 'comprador', label: 'Buyer (Comprador)' },
      { field: 'currency', label: 'Currency (CLP/USD)' },
      { field: 'exchange_rate', label: 'Exchange Rate (Tipo Cambio)', type: 'number' },
      { field: 'comments', label: 'Comments' },
      { field: 'iva_inc', label: 'IVA Inclusion (Neto/Bruto)' },
      { field: 'condicion_pago', label: 'Payment Terms (Condicion Pago)' },
      { field: 'category', label: 'Category' },
      { field: 'last_modified_by', label: 'Last Modified By' },
      { field: 'last_modified_date', label: 'Last Modified Date' },
      { field: 'mod_count', label: 'Mod Count', type: 'number' },
      { field: 'emails', label: 'Distribution Emails' },
      { field: 'created_by', label: 'Created By User' },
      { field: 'quoted_doc_url', label: 'Quoted Document Link' },
    ],
    childFields: [
      { field: 'geo', label: 'GEO Code', required: true },
      { field: 'pn', label: 'Part Number (P/N)' },
      { field: 'description_es', label: 'Description' },
      { field: 'quantity', label: 'Quantity', type: 'number' },
      { field: 'unit_price', label: 'Unit Price', type: 'number' },
      { field: 'total_price', label: 'Net Total Price', type: 'number' },
      { field: 'sub_category', label: 'SubCategory' },
      { field: 'received_qty', label: 'Quantity Received', type: 'number' },
      { field: 'approved_qty', label: 'Quantity Approved', type: 'number' },
      { field: 'discount_pct', label: 'Discount %', type: 'number' },
      { field: 'freight', label: 'Transport / Freight', type: 'number' },
    ],
    defaultMapping: {
      'Ref ID': 'parent.ref_id',
      'Fecha': 'parent.created_at',
      'Proveedor': 'parent.supplier',
      'Faena': 'parent.site',
      'Geo Code': 'child.geo',
      'P/N': 'child.pn',
      'Descripción': 'child.description_es',
      'Cant.': 'child.quantity',
      'Precio Unit.': 'child.unit_price',
      'Total Neto': 'child.total_price',
      'Quote ID': 'parent.quote_no',
      'Ref Cotiz.': 'parent.ref_cotiz',
      'Estado': 'parent.status',
      'PDF Link': 'parent.pdf_url',
      'Fecha Acordada': 'parent.fecha_acordada',
      'Comprador': 'parent.comprador',
      'Moneda': 'parent.currency',
      'Comments': 'parent.comments',
      'IVA INC': 'parent.iva_inc',
      'Condicion Pago': 'parent.condicion_pago',
      'Category': 'parent.category',
      'SubCategory': 'child.sub_category',
      'Created Date': 'parent.created_at',
      'Last Modified By': 'parent.last_modified_by',
      'Last Modified Date': 'parent.last_modified_date',
      'Mod Count': 'parent.mod_count',
      'Emails': 'parent.emails',
      'Cant. Recibido': 'child.received_qty',
      'Created By': 'parent.created_by',
      'Quoted Doc Link': 'parent.quoted_doc_url',
      'Tipo Cambio': 'parent.exchange_rate',
      'Cant. Aprobado': 'child.approved_qty',
      'Descuento %': 'child.discount_pct',
      'Transporte': 'child.freight'
    }
  },

  stock: {
    key: 'stock',
    label: 'Inventory Stock Levels',
    gasSheet: 'Stock',
    isSplit: false,
    table: 'stock',
    fields: [
      { field: 'geo', label: 'GEO Code (Item ID)', required: true },
      { field: 'product_name', label: 'Product Name' },
      { field: 'location_type', label: 'Location / Sector Type' },
      { field: 'location_id', label: 'Location / Sector ID' },
      { field: 'quantity', label: 'Quantity on Hand', type: 'number' },
      { field: 'reserved_qty', label: 'Reserved Quantity', type: 'number' },
      { field: 'available_qty', label: 'Available Quantity', type: 'number' },
      { field: 'last_updated', label: 'Last Updated Date' },
      { field: 'updated_by', label: 'Updated By User' },
    ],
    defaultMapping: {
      'ItemID': 'geo',
      'ProductName': 'product_name',
      'SectorType': 'location_type',
      'SectorID': 'location_id',
      'Quantity': 'quantity',
      'ReservedQty': 'reserved_qty',
      'AvailableQty': 'available_qty',
      'LastUpdated': 'last_updated',
      'UpdatedBy': 'updated_by'
    }
  },

  sites: {
    key: 'sites',
    label: 'Sites / Faenas',
    gasSheet: 'Validation',
    isSplit: false,
    table: 'sites',
    fields: [
      { field: 'site_id', label: 'Site ID / Suffix', required: true },
      { field: 'name', label: 'Site Name', required: true },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'Site name': 'name',
      'Suffix': 'site_id',
    }
  },

  categories: {
    key: 'categories',
    label: 'Categories',
    gasSheet: 'Validation',
    isSplit: false,
    table: 'categories',
    fields: [
      { field: 'name', label: 'Category Name', required: true },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'Category': 'name',
    }
  },

  sub_categories: {
    key: 'sub_categories',
    label: 'Sub Categories',
    gasSheet: 'Validation',
    isSplit: false,
    table: 'sub_categories',
    fields: [
      { field: 'name', label: 'Sub Category Name', required: true },
      { field: 'category_name', label: 'Parent Category Name' },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'SubCategory': 'name',
      'Category': 'category_name',
    }
  },

  brands: {
    key: 'brands',
    label: 'Brands',
    gasSheet: 'Validation',
    isSplit: false,
    table: 'brands',
    fields: [
      { field: 'name', label: 'Brand Name', required: true },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'Brand': 'name',
    }
  },

  suppliers: {
    key: 'suppliers',
    label: 'Suppliers / Proveedores',
    gasSheet: 'Validation',
    isSplit: false,
    table: 'suppliers',
    fields: [
      { field: 'name', label: 'Supplier Name', required: true },
      { field: 'email', label: 'Email' },
      { field: 'contact_person', label: 'Contact Person' },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'Supplier': 'name',
      'Email': 'email',
    }
  },

  stockLedger: {
    key: 'stockLedger',
    label: 'Stock Ledger (Audit Log)',
    gasSheet: 'StockLedger',
    isSplit: false,
    table: 'stock_ledger',
    fields: [
      { field: 'ledger_id', label: 'Ledger ID', required: true },
      { field: 'created_at', label: 'Date / Time' },
      { field: 'geo', label: 'GEO Code' },
      { field: 'product_name', label: 'Product Name' },
      { field: 'sector_from', label: 'Sector From' },
      { field: 'sector_to', label: 'Sector To' },
      { field: 'qty_change', label: 'Quantity Change', type: 'number' },
      { field: 'new_balance', label: 'New Balance', type: 'number' },
      { field: 'transaction_type', label: 'Transaction Type' },
      { field: 'reference_id', label: 'Reference ID' },
      { field: 'reference_type', label: 'Reference Type' },
      { field: 'user_name', label: 'User Name' },
      { field: 'comments', label: 'Comments' },
      { field: 'condition', label: 'Condition' },
    ],
    defaultMapping: {
      'LedgerID': 'ledger_id',
      'DateTime': 'created_at',
      'ItemID': 'geo',
      'ProductName': 'product_name',
      'SectorFrom': 'sector_from',
      'SectorTo': 'sector_to',
      'QtyChange': 'qty_change',
      'NewBalance': 'new_balance',
      'TransactionType': 'transaction_type',
      'ReferenceID': 'reference_id',
      'ReferenceType': 'reference_type',
      'UserName': 'user_name',
      'Comments': 'comments',
      'Condition': 'condition'
    }
  },

  invMovement: {
    key: 'invMovement',
    label: 'Inventory Movements',
    gasSheet: 'Inv_Movement',
    isSplit: false,
    table: 'inventory_movements',
    fields: [
      { field: 'movement_id', label: 'Movement ID', required: true },
      { field: 'movement_timestamp', label: 'Timestamp' },
      { field: 'geo', label: 'GEO Code' },
      { field: 'type', label: 'Action (ISSUE / RETURN)' },
      { field: 'quantity', label: 'Quantity', type: 'number' },
      { field: 'person', label: 'Person' },
      { field: 'sector', label: 'Sector' },
      { field: 'maquina', label: 'Maquina' },
      { field: 'generador', label: 'Generador' },
      { field: 'vehiculo', label: 'Vehiculo' },
      { field: 'condition', label: 'Condition' },
      { field: 'comments', label: 'Comments' },
      { field: 'site', label: 'Site' },
    ],
    defaultMapping: {
      'Movement ID': 'movement_id',
      'Timestamp': 'movement_timestamp',
      'Geo Code': 'geo',
      'Action': 'type',
      'Qty': 'quantity',
      'Person': 'person',
      'Sector': 'sector',
      'Maquina': 'maquina',
      'Generador': 'generador',
      'Vehiculo': 'vehiculo',
      'Condition': 'condition',
      'Comments': 'comments',
      'Site': 'site'
    }
  },

  people: {
    key: 'people',
    label: 'People & Personnel',
    gasSheet: 'People',
    isSplit: false,
    table: 'people',
    fields: [
      { field: 'id', label: 'Person ID (RD-xxx)', required: true },
      { field: 'name', label: 'Full Name' },
      { field: 'department', label: 'Department' },
      { field: 'active', label: 'Active (1/0)', type: 'number' },
      { field: 'sector', label: 'Default Sector' },
      { field: 'position', label: 'Position' },
      { field: 'rut', label: 'RUT' },
      { field: 'biometric_template', label: 'Biometric Template' },
      { field: 'email', label: 'Email' },
      { field: 'ingreso_date', label: 'Entry Date (Ingreso)' },
    ],
    defaultMapping: {
      'Person ID': 'id',
      'Name': 'name',
      'Department': 'department',
      'Active': 'active',
      'Default Sector': 'sector',
      'Position': 'position',
      'RUT': 'rut',
      'BiometricTemplate': 'biometric_template',
      'Email': 'email',
      'INGRESO': 'ingreso_date'
    }
  },

  rackConfig: {
    key: 'rackConfig',
    label: 'Rack Configuration',
    gasSheet: 'RackConfig',
    isSplit: false,
    table: 'rack_config',
    fields: [
      { field: 'location_id', label: 'Location ID / Sector', required: true },
      { field: 'rack_id', label: 'Rack ID', required: true },
      { field: 'has_sides', label: 'Has Sides (1/0)', type: 'number' },
      { field: 'no_of_shelves', label: 'Number of Shelves', type: 'number' },
    ],
    defaultMapping: {
      'LocationID': 'location_id',
      'Rack': 'rack_id',
      'Side': 'has_sides',
      'Shelves': 'no_of_shelves'
    }
  },

  itemLocationMap: {
    key: 'itemLocationMap',
    label: 'Item Location Map',
    gasSheet: 'ItemLocationMap',
    isSplit: false,
    table: 'item_location_map',
    fields: [
      { field: 'location_id', label: 'Location ID' },
      { field: 'rack_id', label: 'Rack ID' },
      { field: 'side_code', label: 'Side Code' },
      { field: 'shelf_level', label: 'Shelf Level' },
      { field: 'item_id', label: 'Item ID (GEO Code)', required: true },
    ],
    defaultMapping: {
      'LocationID': 'location_id',
      'RackID': 'rack_id',
      'SideCode': 'side_code',
      'ShelfLevel': 'shelf_level',
      'ItemID': 'item_id'
    }
  },

  bundles: {
    key: 'bundles',
    label: 'Bundles & Kits',
    gasSheet: 'Bundles',
    isSplit: true,
    groupKeyField: 'bundle_id',
    parentTable: 'bundles',
    childTable: 'bundle_items',
    parentFields: [
      { field: 'bundle_id', label: 'Bundle ID (Unique)', required: true },
      { field: 'name', label: 'Bundle Name' },
      { field: 'is_active', label: 'Is Active', type: 'number' },
    ],
    childFields: [
      { field: 'geo_code', label: 'GEO Code', required: true },
      { field: 'qty', label: 'Quantity', type: 'number' },
    ],
    defaultMapping: {
      'Bundle ID': 'parent.bundle_id',
      'Bundle Name': 'parent.name',
      'Active': 'parent.is_active'
    }
  },

  controlCombustible: {
    key: 'controlCombustible',
    label: 'Fuel Usage (Control Combustible)',
    gasSheet: 'ControlCombustible',
    isSplit: false,
    table: 'fuel_entries',
    fields: [
      { field: 'entry_date', label: 'Date' },
      { field: 'proyecto', label: 'Proyecto' },
      { field: 'tipo_activo', label: 'Tipo Activo' },
      { field: 'asset_id', label: 'Asset ID / Patente' },
      { field: 'liters', label: 'Liters', type: 'number' },
      { field: 'odometer_km', label: 'Odometer KM', type: 'number' },
      { field: 'vehicle', label: 'Vehicle Name' },
      { field: 'driver', label: 'Driver / Person Name' },
      { field: 'user_email', label: 'User' },
    ],
    defaultMapping: {
      'Fecha': 'entry_date',
      'Proyecto': 'proyecto',
      'TipoVehiculo': 'tipo_activo',
      'Patente': 'asset_id',
      'CantidadLitro': 'liters',
      'Kilometraje': 'odometer_km',
      'Nombre': 'driver',
      'User': 'user_email'
    }
  },

  compraCombustible: {
    key: 'compraCombustible',
    label: 'Fuel Purchases (Compra Combustible)',
    gasSheet: 'CompraCombustible',
    isSplit: false,
    table: 'fuel_purchases',
    fields: [
      { field: 'purchase_date', label: 'Date' },
      { field: 'proveedor', label: 'Supplier / Proveedor' },
      { field: 'litros', label: 'Liters Purchased', type: 'number' },
      { field: 'factura', label: 'Invoice No / Factura' },
      { field: 'user_name', label: 'User Name' },
    ],
    defaultMapping: {
      'Fecha': 'purchase_date',
      'Proveedor': 'proveedor',
      'Litros': 'litros',
      'Factura': 'factura',
      'Usuario': 'user_name'
    }
  },

  minMax: {
    key: 'minMax',
    label: 'Min / Max Stock Settings',
    gasSheet: 'MinMax',
    isSplit: false,
    table: 'min_max',
    fields: [
      { field: 'site', label: 'Site / Faena', required: true },
      { field: 'geo_code', label: 'GEO Code', required: true },
      { field: 'min_qty', label: 'Min Stock', type: 'number' },
      { field: 'max_qty', label: 'Max Stock', type: 'number' },
      { field: 'last_updated', label: 'Last Updated' },
      { field: 'updated_by', label: 'Updated By' },
    ],
    defaultMapping: {
      'Site': 'site',
      'Geo Code': 'geo_code',
      'Min': 'min_qty',
      'Max': 'max_qty',
      'LastUpdated': 'last_updated',
      'UpdatedBy': 'updated_by'
    }
  },

  quoteLog: {
    key: 'quoteLog',
    label: 'Quote Change Audit Log',
    gasSheet: 'QuoteLog',
    isSplit: false,
    table: 'quote_logs',
    fields: [
      { field: 'timestamp', label: 'Timestamp' },
      { field: 'quote_id', label: 'Quote ID', required: true },
      { field: 'order_id', label: 'Order ID' },
      { field: 'editor_email', label: 'Editor Email' },
      { field: 'change_details_json', label: 'Change Details JSON' },
      { field: 'mod_count', label: 'Mod Count', type: 'number' },
      { field: 'pdf_regenerated', label: 'PDF Regenerated (1/0)', type: 'number' },
    ],
    defaultMapping: {
      'Timestamp': 'timestamp',
      'Quote ID': 'quote_id',
      'Order ID': 'order_id',
      'Editor Email': 'editor_email',
      'ChangeDetailsJSON': 'change_details_json',
      'Mod Count': 'mod_count',
      'PdfRegenerated': 'pdf_regenerated'
    }
  }
};

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text) {
  const s = String(text || '');
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += c;
      }
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      if (cur.trim().length > 0) lines.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim().length > 0) lines.push(cur);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(parseCSVLine);
  return { headers, rows };
}

function cleanVal(v, type) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/^"|"$/g, '').trim();
  if (!s) return null;
  if (type === 'number') {
    const num = Number(s.replace(/[\$,]/g, ''));
    return isNaN(num) ? null : num;
  }
  return s;
}

function transformRows(sheetKey, headers, rows, mapping = {}) {
  const def = SCHEMA_DEFINITIONS[sheetKey];
  if (!def) throw new Error('Unknown sheet definition: ' + sheetKey);

  const headerIndexMap = {};
  headers.forEach((h, idx) => {
    const key = (h || '').trim();
    if (!key) return;
    // exact (trimmed) header -> column index
    if (headerIndexMap[key] === undefined) headerIndexMap[key] = idx;
    // case-insensitive alias -> column index (first occurrence wins)
    const lower = key.toLowerCase();
    if (headerIndexMap[lower] === undefined) headerIndexMap[lower] = idx;
  });

  function resolveColIdx(sheetHeader) {
    if (sheetHeader == null) return undefined;
    const key = String(sheetHeader).trim();
    if (headerIndexMap[key] !== undefined) return headerIndexMap[key];
    return headerIndexMap[key.toLowerCase()];
  }

  const activeMapping = Object.assign({}, def.defaultMapping, mapping);

  if (def.isSplit) {
    const parentMap = new Map();
    const groupKeyField = def.groupKeyField;

    rows.forEach(row => {
      const parentObj = {};
      const childObj = {};

      Object.entries(activeMapping).forEach(([sheetHeader, targetPath]) => {
        const colIdx = resolveColIdx(sheetHeader);
        if (colIdx === undefined || colIdx >= row.length) return;

        const rawVal = row[colIdx];
        if (targetPath.startsWith('parent.')) {
          const fieldName = targetPath.replace('parent.', '');
          const fieldDef = def.parentFields.find(f => f.field === fieldName);
          parentObj[fieldName] = cleanVal(rawVal, fieldDef ? fieldDef.type : 'string');
        } else if (targetPath.startsWith('child.')) {
          const fieldName = targetPath.replace('child.', '');
          const fieldDef = def.childFields.find(f => f.field === fieldName);
          childObj[fieldName] = cleanVal(rawVal, fieldDef ? fieldDef.type : 'string');
        }
      });

      const groupKeyValue = parentObj[groupKeyField];
      if (!groupKeyValue) return;

      if (!parentMap.has(groupKeyValue)) {
        parentMap.set(groupKeyValue, {
          parent: parentObj,
          children: []
        });
      }

      // Merge non-null parent fields
      const existing = parentMap.get(groupKeyValue);
      Object.keys(parentObj).forEach(k => {
        if (parentObj[k] !== null && parentObj[k] !== undefined && existing.parent[k] == null) {
          existing.parent[k] = parentObj[k];
        }
      });

      // Add child record if at least one meaningful field exists
      const hasChildContent = Object.values(childObj).some(v => v !== null && v !== undefined && v !== '');
      if (hasChildContent) {
        existing.children.push(childObj);
      }
    });

    return {
      isSplit: true,
      records: Array.from(parentMap.values())
    };
  } else {
    const flatRecords = [];

    rows.forEach(row => {
      const record = {};
      Object.entries(activeMapping).forEach(([sheetHeader, targetField]) => {
        const colIdx = resolveColIdx(sheetHeader);
        if (colIdx === undefined || colIdx >= row.length) return;

        const rawVal = row[colIdx];
        const fieldDef = def.fields.find(f => f.field === targetField);
        record[targetField] = cleanVal(rawVal, fieldDef ? fieldDef.type : 'string');
      });

      const hasContent = Object.values(record).some(v => v !== null && v !== undefined && v !== '');
      if (hasContent) {
        flatRecords.push(record);
      }
    });

    return {
      isSplit: false,
      records: flatRecords
    };
  }
}

module.exports = {
  SCHEMA_DEFINITIONS,
  parseCSV,
  transformRows
};
