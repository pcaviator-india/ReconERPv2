'use strict';

/**
 * transformer.js — Normalization and Parent-Child splitting for legacy Google Sheets
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
      { field: 'notes', label: 'Order Notes' },
    ],
    childFields: [
      { field: 'geo', label: 'GEO Code (Item)', required: true },
      { field: 'pn', label: 'Part Number (P/N)' },
      { field: 'quantity_requested', label: 'Quantity Requested', type: 'number' },
      { field: 'item_notes', label: 'Item Notes / Description' },
    ],
    defaultMapping: {
      'Order': 'parent.requisition_no',
      'Fecha/Hora': 'parent.created_at',
      'Faena': 'parent.site',
      'Estado': 'parent.status',
      'User': 'parent.requested_by',
      'Notes': 'parent.notes',
      'Geo Code': 'child.geo',
      'P/N': 'child.pn',
      'Cantidad': 'child.quantity_requested',
      'Desc Es': 'child.item_notes',
      'Item Notes': 'child.item_notes'
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
      { field: 'requisition_no', label: 'Associated Requisition No' },
      { field: 'supplier', label: 'Supplier Name' },
      { field: 'created_at', label: 'Quote Date' },
      { field: 'status', label: 'Quote Status' },
      { field: 'currency', label: 'Currency (CLP/USD)' },
      { field: 'total', label: 'Total Amount', type: 'number' },
      { field: 'pdf_url', label: 'PDF Document Link' },
    ],
    childFields: [
      { field: 'geo', label: 'GEO Code', required: true },
      { field: 'pn', label: 'Part Number (P/N)' },
      { field: 'description_es', label: 'Description' },
      { field: 'quantity', label: 'Quantity', type: 'number' },
      { field: 'unit_price', label: 'Unit Price', type: 'number' },
      { field: 'total_price', label: 'Net Total Price', type: 'number' },
    ],
    defaultMapping: {
      'Quote ID': 'parent.quote_no',
      'Ref ID': 'parent.requisition_no',
      'Proveedor': 'parent.supplier',
      'Fecha': 'parent.created_at',
      'Estado': 'parent.status',
      'Moneda': 'parent.currency',
      'PDF Link': 'parent.pdf_url',
      'Geo Code': 'child.geo',
      'P/N': 'child.pn',
      'Descripción': 'child.description_es',
      'Cant.': 'child.quantity',
      'Precio Unit.': 'child.unit_price',
      'Total Neto': 'child.total_price'
    }
  },

  stock: {
    key: 'stock',
    label: 'Inventory Stock Levels',
    gasSheet: 'Stock',
    isSplit: false,
    table: 'stock',
    fields: [
      { field: 'item_id', label: 'Item ID / GEO Code', required: true },
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
      'ItemID': 'item_id',
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
      { field: 'user_email', label: 'User' },
    ],
    defaultMapping: {
      'Date': 'entry_date',
      'Proyecto': 'proyecto',
      'TipoActivo': 'tipo_activo',
      'ID/Patente': 'asset_id',
      'Litros': 'liters',
      'KM': 'odometer_km',
      'Nombre': 'vehicle',
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
      'Date': 'purchase_date',
      'Proveedor': 'proveedor',
      'Litros': 'litros',
      'Factura': 'factura',
      'User': 'user_name'
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
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));
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

  const headerToIdx = {};
  headers.forEach((h, i) => {
    headerToIdx[h] = i;
    headerToIdx[h.toLowerCase()] = i;
  });

  // Effective mapping: user mapping overrides defaultMapping
  const effective = { ...(def.defaultMapping || {}), ...(mapping || {}) };

  if (def.isSplit) {
    const parentMap = new Map(); // key: groupKeyValue -> { header: {...}, items: [...] }

    for (const r of rows) {
      const parentRecord = {};
      const childRecord = {};

      Object.entries(effective).forEach(([srcCol, targetField]) => {
        if (!targetField || targetField === 'ignore') return;
        const colIdx = headerToIdx[srcCol] !== undefined ? headerToIdx[srcCol] : (headerToIdx[srcCol.toLowerCase()] !== undefined ? headerToIdx[srcCol.toLowerCase()] : parseInt(srcCol, 10));
        if (isNaN(colIdx) || colIdx < 0 || colIdx >= r.length) return;
        const rawVal = r[colIdx];

        if (targetField.startsWith('parent.')) {
          const fName = targetField.replace('parent.', '');
          const fDef = def.parentFields.find(f => f.field === fName);
          parentRecord[fName] = cleanVal(rawVal, fDef ? fDef.type : 'string');
        } else if (targetField.startsWith('child.')) {
          const fName = targetField.replace('child.', '');
          const fDef = def.childFields.find(f => f.field === fName);
          childRecord[fName] = cleanVal(rawVal, fDef ? fDef.type : 'string');
        }
      });

      const groupKey = parentRecord[def.groupKeyField];
      if (!groupKey) continue; // Skip lines with missing primary order/quote number

      if (!parentMap.has(groupKey)) {
        parentMap.set(groupKey, {
          parent: parentRecord,
          items: []
        });
      }

      // Add child item if child has content (e.g. geo code or quantity)
      if (childRecord.geo || childRecord.geo_code || childRecord.quantity || childRecord.quantity_requested) {
        parentMap.get(groupKey).items.push(childRecord);
      }
    }

    return {
      isSplit: true,
      records: Array.from(parentMap.values())
    };
  } else {
    // Flat table transformation
    const out = [];
    for (const r of rows) {
      const record = {};
      Object.entries(effective).forEach(([srcCol, targetField]) => {
        if (!targetField || targetField === 'ignore') return;
        const colIdx = headerToIdx[srcCol] !== undefined ? headerToIdx[srcCol] : (headerToIdx[srcCol.toLowerCase()] !== undefined ? headerToIdx[srcCol.toLowerCase()] : parseInt(srcCol, 10));
        if (isNaN(colIdx) || colIdx < 0 || colIdx >= r.length) return;
        const rawVal = r[colIdx];
        const fDef = def.fields.find(f => f.field === targetField);
        record[targetField] = cleanVal(rawVal, fDef ? fDef.type : 'string');
      });
      if (Object.keys(record).length > 0) {
        out.push(record);
      }
    }
    return {
      isSplit: false,
      records: out
    };
  }
}

module.exports = {
  SCHEMA_DEFINITIONS,
  parseCSV,
  parseCSVLine,
  transformRows
};

