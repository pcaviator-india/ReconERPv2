const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (e) {
  // pdfkit not loaded
}

let graphTokenCache = { token: null, expiresAt: 0 };

async function nextRequisitionNumber(db) {
  await (await db.prepare(`
    CREATE TABLE IF NOT EXISTS requisition_sequences (
      sequence_key TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)).run();
  const existing = await (await db.prepare(
    "SELECT last_number FROM requisition_sequences WHERE sequence_key = 'requisition_no'"
  )).first();
  if (!existing) {
    const config = await (await db.prepare(
      "SELECT value FROM config WHERE key = 'req_no_counter' LIMIT 1"
    )).first();
    const rows = await (await db.prepare('SELECT requisition_no FROM requisitions')).all();
    const configured = Number.parseInt(config && config.value, 10);
    const maxExisting = (rows.results || rows).reduce((max, row) => {
      const match = String(row.requisition_no || '').match(/^REQ-(\d+)/i);
      return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
    }, 0);
    const initial = Number.isFinite(configured) ? Math.max(configured, maxExisting) : maxExisting;
    await (await db.prepare(`
      INSERT OR IGNORE INTO requisition_sequences (sequence_key, last_number)
      VALUES ('requisition_no', ?)
    `)).bind(initial).run();
  }
  const result = await (await db.prepare(`
    UPDATE requisition_sequences
    SET last_number = last_number + 1, updated_at = CURRENT_TIMESTAMP
    WHERE sequence_key = 'requisition_no'
    RETURNING last_number
  `)).first();
  if (!result) throw new Error('Unable to allocate requisition number');
  return `REQ-${String(result.last_number).padStart(6, '0')}`;
}

async function getGraphAccessToken() {
  if (graphTokenCache.token && Date.now() < graphTokenCache.expiresAt) return graphTokenCache.token;
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Graph token request failed (${response.status})`);
  }
  graphTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) * 1000) - 60000
  };
  return data.access_token;
}

function buildReqItemsTable(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = items.map(i => {
    const geo = String(i.geo || i.product_geo || '').trim();
    const pn = String(i.pn || i.product_pn || '').trim();
    const desc = String(i.desc || i.es || i.description || i.en || '').trim();
    const qty = Number(i.qty || i.quantity || i.quantity_requested || i.cant || 0);
    const notes = String(i.itemNotes || i.notes || '').trim();
    // Item images: stored as JSON array string or comma-separated Drive URLs
    let imagesHtml = '';
    try {
      const imgs = Array.isArray(i.images) ? i.images : (typeof i.images === 'string' && i.images.trim() ? JSON.parse(i.images) : null);
      if (Array.isArray(imgs) && imgs.length) {
        imagesHtml = imgs.map(u => `<img src="${String(u).trim()}" style="max-width:60px;max-height:60px;margin:2px;border:1px solid #ddd;" alt="item image">`).join('');
      }
    } catch (e) {
      // If images is a raw URL string, show it directly
      if (typeof i.images === 'string' && i.images.trim() && i.images.startsWith('http')) {
        imagesHtml = `<img src="${i.images.trim()}" style="max-width:60px;max-height:60px;margin:2px;border:1px solid #ddd;" alt="item image">`;
      }
    }
    return `<tr>
      <td style="border:1px solid #ddd;padding:4px;">${geo}</td>
      <td style="border:1px solid #ddd;padding:4px;">${pn}</td>
      <td style="border:1px solid #ddd;padding:4px;">${desc}</td>
      <td style="border:1px solid #ddd;padding:4px;text-align:center;">${qty}</td>
      <td style="border:1px solid #ddd;padding:4px;">${notes}</td>
      <td style="border:1px solid #ddd;padding:4px;text-align:center;">${imagesHtml || '—'}</td>
    </tr>`;
  }).join('');
  return `
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;margin:12px 0;">
      <thead>
        <tr style="background:#f2f2f2;">
          <th style="border:1px solid #ddd;padding:4px;text-align:left;">Geo</th>
          <th style="border:1px solid #ddd;padding:4px;text-align:left;">P/N</th>
          <th style="border:1px solid #ddd;padding:4px;text-align:left;">Description</th>
          <th style="border:1px solid #ddd;padding:4px;text-align:center;">Qty</th>
          <th style="border:1px solid #ddd;padding:4px;text-align:left;">Notes</th>
          <th style="border:1px solid #ddd;padding:4px;text-align:center;">Images</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function sendRequirementEmail(shipment, orderId, authenticatedUser) {
  const sender = String(authenticatedUser && authenticatedUser.email || '').trim().toLowerCase();
  if (!sender || !/@recondrilling\.com$/i.test(sender)) {
    return {
      emailSent: false,
      emailError: 'Email was not sent: the logged-in user must have a recondrilling.com email address.'
    };
  }

  const token = await getGraphAccessToken();
  if (!token) return { emailSent: false, emailError: 'Microsoft Graph credentials are not configured.' };

  const recipients = (value) => String(value || '')
    .split(/[;, \n]+/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  // Build the full email body: header info + user's message + item table + signature + company logo
  const userBody = shipment.body || '';
  const itemsTable = buildReqItemsTable(shipment.items);
  const createdBy = String(shipment.createdBy || shipment.userName || '').trim();
  const solicitedBy = String(shipment.solicitedBy || shipment.userName || '').trim();
  const headerInfo = `
    <div style="margin-bottom:12px;font-size:12px;color:#555;">
      <strong>Req No:</strong> ${orderId}<br>
      ${createdBy ? `<strong>Created By:</strong> ${createdBy}<br>` : ''}
      ${solicitedBy ? `<strong>Solicitated By:</strong> ${solicitedBy}<br>` : ''}
    </div>`;
  const signatureHtml = shipment.signature ? `<div style="margin-top:16px;font-size:11px;color:#555;">${shipment.signature}</div>` : '';

  // Company logo at bottom with signature (from config table)
  const logoRow = await queryOne(db, "SELECT value FROM config WHERE key = 'company_logo' LIMIT 1");
  const logoUrl = logoRow ? String(logoRow.value || '').trim() : '';
  const logoBottomHtml = logoUrl ? `<div style="margin-top:16px;text-align:center;"><img src="${logoUrl}" style="max-height:50px;max-width:160px;" alt="Company Logo"></div>` : '';

  const emailContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      ${headerInfo}
      ${userBody ? `<div style="margin-bottom:12px;">${userBody}</div>` : ''}
      <h3 style="font-size:14px;margin:0 0 8px 0;">Items</h3>
      ${itemsTable || '<p style="font-size:12px;color:#666;">No items.</p>'}
      ${signatureHtml}
      ${logoBottomHtml}
    </div>`;

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject: shipment.subject || `REQ ${orderId} - Material Requirement`,
        body: { contentType: 'HTML', content: emailContent || 'Material Requirement Created' },
        toRecipients: recipients(shipment.to),
        ccRecipients: recipients(shipment.cc)
      },
      saveToSentItems: true
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    return { emailSent: false, emailError: `Graph send failed (${response.status}): ${detail.slice(0, 300)}` };
  }
  return { emailSent: true, emailService: 'Microsoft Graph' };
}

// Normalize statement results across drivers:
// better-sqlite3 -> { results: [...] }, D1/Cloudflare -> [...] directly.
const allRows = (result) => result && result.results !== undefined ? result.results : result;

// Movement_Val asset types → their column in the `movement_val` table.
// Mirrors GestionActivosGS.getSheetColForType().
const ASSET_TYPE_COLUMN = {
  maquinaria: 'maquinaria',
  generadores: 'generadores',
  vehiculos: 'vehiculos'
};

// GestionActivosGS.isAuthorizedRole — only admin/manager may edit assets.
const isAuthorizedRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' || r === 'manager';
};

// Maps a raw lifecycle status string to the canonical stage name.
// Ported from Código.js normalizeStage() inside getLifecycleReportData.
const normalizeLifecycleStage = (s) => {
  if (!s) return '';
  const x = String(s).toLowerCase();
  // "Not Quoted" must be matched BEFORE the bare "quot" check.
  if ((x.includes('not') && x.includes('quot')) || x.includes('no cotiz') || x.includes('sin cotiz')) return 'Not Quoted';
  if (x.includes('final')) return 'Final Received';
  if (x.includes('po') || x.includes('orden') || x.includes('ordered') || x.includes('comprad')) return 'PO Created';
  if (x.includes('approv') || x.includes('aprob')) return 'Approved';
  if (x.includes('despatch') || x.includes('despach')) return 'Despatched';
  if (x.includes('received') || x.includes('recib')) return 'Received';
  if (x.includes('quot') || x.includes('cotiz')) return 'Quoted';
  if (x.includes('rfq') || x.includes('sent')) return 'Sent';
  if (x.includes('pend')) return 'Pending';
  return s;
};

// Requirement-level stage precedence (highest first).
const LIFECYCLE_PRECEDENCE = [
  'Final Received', 'PO Created', 'Despatched', 'Approved',
  'Quoted', 'Sent', 'Pending', 'Not Quoted', 'Created'
];

// Builds the lifecycle entries from the requirement map built by
// getLifecycleReportData(). Ported from Código.js.
const buildLifecycleEntries = (reqMap) => {
  return Object.keys(reqMap).map((orderId) => {
    const req = reqMap[orderId];
    // STORE orders cap at "Received".
    const isStore = String(req.site || '').trim().toLowerCase() === 'store';
    const stages = new Set();
    let totalQuotedValue = 0;

    req.items.forEach((it) => {
      let itemStage = 'Pending';
      if (it.quotes && it.quotes.length) {
        let latest = it.quotes[0];
        let latestTime = latest.timestampIso ? new Date(latest.timestampIso).getTime() : 0;
        for (let j = 1; j < it.quotes.length; j++) {
          const cand = it.quotes[j];
          const candTime = cand.timestampIso ? new Date(cand.timestampIso).getTime() : 0;
          if (candTime > latestTime) { latest = cand; latestTime = candTime; }
        }
        itemStage = latest.estado || latest.status || itemStage;
        totalQuotedValue += Number(latest.total) || 0;
      }
      let norm = normalizeLifecycleStage(itemStage);
      if (isStore && (norm === 'Final Received' || norm === 'Despatched')) norm = 'Received';
      stages.add(norm || itemStage || 'Pending');
      it.lastKnownStage = norm || itemStage;
    });

    let reqStage = 'Created';
    for (let p = 0; p < LIFECYCLE_PRECEDENCE.length; p++) {
      if ([...stages].some((s) => s === LIFECYCLE_PRECEDENCE[p])) {
        reqStage = LIFECYCLE_PRECEDENCE[p];
        break;
      }
    }
    if (isStore && (reqStage === 'Final Received' || reqStage === 'Despatched')) reqStage = 'Received';

    const quoteIdsArr = Array.from(req.quoteIds || []);
    const suppliersArr = Array.from(req.suppliers || []);

    return {
      orderId: req.orderId,
      createdDate: req.createdDate,
      site: req.site,
      category: req.category,
      creator: req.creator,
      items: req.items,
      quotesCount: quoteIdsArr.length,
      quoteIds: quoteIdsArr,
      supplierCount: suppliersArr.length,
      suppliers: suppliersArr,
      totalQuoted: totalQuotedValue,
      stage: reqStage,
      currentStage: reqStage,
      lastUpdated: req.lastUpdated || req.createdDate || ''
    };
  }).sort((a, b) => {
    const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
    const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
    return tb - ta;
  });
};

// db.prepare() is async; these helpers await it, bind params, and execute.
const queryAll = async (db, sql, params = []) => {
  const stmt = await db.prepare(sql);
  return allRows(await stmt.bind(...params).all());
};
const queryOne = async (db, sql, params = []) => {
  const stmt = await db.prepare(sql);
  return stmt.bind(...params).first();
};
const exec = async (db, sql, params = []) => {
  const stmt = await db.prepare(sql);
  return stmt.bind(...params).run();
};

/**
 * POST /api/v1/legacy/:fn  { args: [...] }
 *
 * Compatibility endpoint for GAS server functions that have not been
 * ported to a dedicated REST route yet. The gas-shim.js client falls
 * back here for any google.script.run.<fn>() call it cannot map.
 *
 * Responses use raw GAS-style return values (arrays/objects/null),
 * NOT the { status, data } envelope — the frontend expects the raw
 * value, exactly as google.script.run delivered it.
 *
 * Every function carries the GAS argument signature and the GAS return
 * field names, so the frontend works unchanged. Coverage of the 96 GAS
 * functions the frontend calls is checked by scripts/legacy-coverage.js:
 * each one is either in IMPLEMENTED (SQL-backed) or in
 * KNOWN_UNIMPLEMENTED below ({ __legacy: true }).
 */

const IMPLEMENTED = {
  // InvMovGS.getPeople — active people list from the People sheet.
  // GAS shape: {id, name, department, active, sector, rut, email}
  getPeople: async (db) => {
    const rows = await queryAll(db, `
      SELECT id, name, department, active, sector, rut, email
      FROM people
      ORDER BY LOWER(name)
    `);
    return rows.map((r) => ({
      id: r.id,
      name: r.name || '',
      department: r.department || '',
      active: Number(r.active) === 1,
      sector: r.sector || '',
      rut: r.rut || '',
      email: r.email || ''
    }));
  },

  // Recreates InvMovGS.getAllActiveAssignments(): aggregate ISSUE/RETURN
  // movements per person__geo, keep pairs whose net active qty > 0.
  getAllActiveAssignments: async (db) => {
    const rows = await queryAll(db, `
      SELECT movement_id, movement_timestamp, geo, type, condition,
             COALESCE(qty, quantity, 0) AS q, person, sector, maquina, generador, vehiculo
      FROM inventory_movements
      WHERE person IS NOT NULL AND person != '' AND geo IS NOT NULL AND geo != ''
      ORDER BY movement_timestamp ASC
    `);

    const map = {};
    rows.forEach((r) => {
      const movementId = r.movement_id || '';
      const timestamp = r.movement_timestamp ? new Date(r.movement_timestamp).toLocaleString() : '';
      const geo = String(r.geo || '').trim();
      const action = String(r.type || '').trim().toUpperCase();
      const qty = parseFloat(r.q) || 0;
      const person = String(r.person || '').trim().toUpperCase();
      const condition = String(r.condition || '').trim().toUpperCase();

      // GAS rule: issued consumables are excluded
      if (action === 'ISSUE' && condition === 'CONSUMABLE') return;
      if (!geo || !person) return;

      const key = `${person}__${geo}`;
      if (!map[key]) {
        map[key] = {
          geo, person, issued: 0, returned: 0, active: 0,
          sector: '', maquina: '', generador: '', vehiculo: '',
          movementId: '', timestamp: ''
        };
      }
      map[key].movementId = movementId;
      map[key].timestamp = timestamp;
      map[key].sector = String(r.sector || '').trim();
      map[key].maquina = String(r.maquina || '').trim();
      map[key].generador = String(r.generador || '').trim();
      map[key].vehiculo = String(r.vehiculo || '').trim();

      if (action === 'ISSUE') map[key].issued += qty;
      else if (action === 'RETURN') map[key].returned += qty;
      map[key].active = map[key].issued - map[key].returned;
    });

    return Object.values(map).filter((x) => x.active > 0);
  },

  // Recreates Código.js getRequirementsHistory(): one row per requisition
  // ITEM (the Ordenes sheet had one row per item), newest first, with the
  // exact GAS field names. Excludes Draft rows (GAS: estado !== "Draft"
  // and order not starting with "DRAFT-"). Row numbers emulate the sheet
  // rowNum (used by the edit modal to pair items back to rows).
  getRequirementsHistory: async (db) => {
    const rows = await queryAll(db, `
      SELECT r.id, r.requisition_no, r.created_at, r.updated_at,
             r.requested_by, r.status AS req_status, r.notes AS req_notes,
             r.site, r.pdf_url, r.sub_area, r.sub_area_no, r.emails,
             r.last_modified_by, r.last_modified_date, r.mod_count,
             r.category AS req_category,
             s.name AS site_name,
             ri.id AS item_id, ri.quantity_requested, ri.status AS item_status,
             ri.notes AS item_notes_legacy, ri.item_notes, ri.supplier_notes, ri.images,
             ri.geo AS ri_geo, ri.pn AS ri_pn, ri.description_es AS ri_desc_es,
             p_id.geo AS product_geo, p_id.pn AS product_pn,
             p_geo.geo AS geo_product_geo, p_geo.pn AS geo_product_pn,
             COALESCE(p_id.name, p_geo.name) AS product_name,
             COALESCE(p_id.description, p_geo.description) AS description,
             COALESCE(c_id.name, c_geo.name) AS category_name
      FROM requisitions r
      JOIN requisition_items ri ON ri.requisition_id = r.id
      LEFT JOIN sites s ON s.id = r.site_id
      LEFT JOIN products p_id ON p_id.id = ri.product_id
      LEFT JOIN products p_geo ON p_geo.geo = ri.geo
      LEFT JOIN categories c_id ON c_id.id = p_id.category_id
      LEFT JOIN categories c_geo ON c_geo.id = p_geo.category_id
      ORDER BY r.created_at DESC, ri.id ASC
    `);

    const out = [];
    let rowNum = rows.length + 1; // newest row keeps the highest rowNum
    rows.forEach((row) => {
      const order = row.requisition_no || '';
      const estado = row.item_status || row.req_status || 'Pending';
      // GAS parity: skip drafts
      if (estado === 'Draft' || String(order).trim().startsWith('DRAFT-')) return;
      if (!order) return;

      const parseFlexibleDate = (str) => {
        if (!str) return null;
        const s = String(str).trim();
        const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
        if (dmyMatch) {
          const day = parseInt(dmyMatch[1], 10);
          const month = parseInt(dmyMatch[2], 10) - 1;
          const year = parseInt(dmyMatch[3], 10);
          const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
          const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
          const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
          const d = new Date(year, month, day, hour, min, sec);
          if (!isNaN(d.getTime())) return d;
        }
        const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
        return !isNaN(d.getTime()) ? d : null;
      };

      const validDate = parseFlexibleDate(row.created_at);
      const validMod = parseFlexibleDate(row.updated_at);

      const formatDisplayDate = (d, rawFallback) => {
        if (!d) return rawFallback || '';
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      };

      out.push({
        rowNum: rowNum--,
        order,
        fecha: formatDisplayDate(validDate, row.created_at),
        fechaIso: validDate ? validDate.toISOString() : '',
        pn: row.ri_pn || row.product_pn || row.geo_product_pn || '',
        geo: row.ri_geo || row.product_geo || row.geo_product_geo || '',
        faena: row.site || row.site_name || '',
        desc: row.ri_desc_es || row.description || row.product_name || '',
        cant: row.quantity_requested != null ? row.quantity_requested : 0,
        estado,
        user: row.requested_by || '',
        category: row.req_category || row.category_name || 'General',
        pdfUrl: row.pdf_url || '',
        subArea: row.sub_area || '',
        emails: row.emails || '',
        subAreaNo: row.sub_area_no || '',
        notes: row.req_notes || '',
        itemNotes: row.item_notes || row.item_notes_legacy || '',
        supplierNotes: row.supplier_notes || '',
        images: row.images || '',
        reqLastModifiedBy: row.last_modified_by || '',
        reqLastModified: row.last_modified_date || (validMod
          ? `${String(validMod.getDate()).padStart(2, '0')}-${String(validMod.getMonth() + 1).padStart(2, '0')}-${validMod.getFullYear()} ${String(validMod.getHours()).padStart(2, '0')}:${String(validMod.getMinutes()).padStart(2, '0')}`
          : ''),
        reqLastModifiedIso: validMod ? validMod.toISOString() : '',
        reqModCount: Number(row.mod_count) || 0
      });
    });
    return out;
  },

  // ===== Newly ported GAS functions (SQL-backed) =====
  // Raw GAS-style return values so gas-shim.js clients work via
  // POST /api/v1/legacy/:fn.

  // ControlCombustibleGS.getFuelBalance — balance = purchased - consumed.
  // The GAS original summed column C of "CompraCombustible" (purchases) and
  // column E of "ControlCombustible" (consumption).
  getFuelBalance: async (db) => {
    const bought = await queryOne(db, `SELECT COALESCE(SUM(litros), 0) AS total FROM fuel_purchases`);
    const used = await queryOne(db, `SELECT COALESCE(SUM(liters), 0) AS total FROM fuel_entries`);
    const totalBought = Number(bought && bought.total) || 0;
    const totalUsed = Number(used && used.total) || 0;
    return {
      balance: totalBought - totalUsed,
      totalBought,
      totalUsed
    };
  },

  // ControlCombustibleGS.getFuelHistory — last 50 consumption rows, newest
  // first. GAS returned positional arrays:
  //   [Date, Proyecto, TipoActivo, ID/Patente, Litros, KM, Nombre, User]
  getFuelHistory: async (db) => {
    const rows = await queryAll(db, `
      SELECT entry_date, proyecto, tipo_activo, asset_id, liters,
             odometer_km, driver, user_email
      FROM fuel_entries
      ORDER BY entry_date DESC, id DESC
      LIMIT 50
    `);
    return rows.map((r) => {
      const d = r.entry_date ? new Date(String(r.entry_date).replace(' ', 'T')) : null;
      const dateStr = d && !isNaN(d.getTime())
        ? d.toISOString().slice(0, 16).replace('T', ' ')
        : String(r.entry_date || '');
      return [
        dateStr,
        r.proyecto || '',
        r.tipo_activo || '',
        r.asset_id || '',
        r.liters || 0,
        r.odometer_km || '',
        r.driver || '',
        r.user_email || ''
      ];
    });
  },

  // ControlCombustibleGS.getFuelPurchaseHistory — purchase history.
  getFuelPurchaseHistory: async (db) => {
    const rows = await queryAll(db, `
      SELECT purchase_date, proveedor, litros, factura, user_name
      FROM fuel_purchases
      ORDER BY purchase_date DESC, id DESC
    `);
    return rows.map((x) => {
      const d = x.purchase_date ? new Date(String(x.purchase_date).replace(' ', 'T')) : null;
      const iso = d && !isNaN(d.getTime()) ? d.toISOString() : String(x.purchase_date || '');
      return {
        fecha: iso ? iso.slice(0, 16).replace('T', ' ') : '',
        fechaISO: iso,
        fechaObj: x.purchase_date,
        proveedor: x.proveedor || '',
        litros: x.litros || 0,
        factura: x.factura || '',
        usuario: x.user_name || ''
      };
    });
  },

  // MinMaxGS.getMinMaxData — per-site min/max + global fallback + sites.
  getMinMaxData: async (db) => {
    const [minRows, prodRows, siteRows] = await Promise.all([
      queryAll(db, `SELECT site, geo_code AS geo, min_qty AS min, max_qty AS max, last_updated, updated_by FROM min_max`),
      queryAll(db, `SELECT geo, min_qty AS min, max_qty AS max FROM products WHERE is_active = 1`),
      queryAll(db, `SELECT name AS site FROM sites WHERE active = 1 ORDER BY name`)
    ]);
    return {
      rows: (minRows || []).map((x) => ({
        site: x.site, geo: x.geo,
        min: Number(x.min) || 0, max: Number(x.max) || 0,
        lastUpdated: x.last_updated || '', updatedBy: x.updated_by || ''
      })),
      products: (prodRows || []).map((x) => ({
        geo: x.geo, globalMin: Number(x.min) || 0, globalMax: Number(x.max) || 0
      })),
      sites: (siteRows || []).map((x) => x.site)
    };
  },

  // MinMaxGS.getSiteMinMaxMap — site -> geo -> {min, max}.
  getSiteMinMaxMap: async (db) => {
    const rows = await queryAll(db, `SELECT site, geo_code AS geo, min_qty AS min, max_qty AS max FROM min_max`);
    const map = {};
    (rows || []).forEach((x) => {
      if (!map[x.site]) map[x.site] = {};
      map[x.site][x.geo] = { min: Number(x.min) || 0, max: Number(x.max) || 0 };
    });
    return map;
  },

  // InvMovGS.getPersonById — person by id or name.
  getPersonById: async (db, args) => {
    const id = args[0];
    const r = await queryOne(db, `
      SELECT id, name, department, active, sector, rut, biometric_template, email
      FROM people
      WHERE id = ? OR name = ?
      LIMIT 1
    `, [String(id == null ? '' : id), String(id == null ? '' : id)]);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name || '',
      department: r.department || '',
      active: Number(r.active) === 1,
      sector: r.sector || '',
      rut: r.rut || '',
      biometricTemplate: r.biometric_template || '',
      email: r.email || ''
    };
  },

  // ScannerGS.getScannerData(startDateStr, endDateStr) — count history.
  // GAS shape: {history: [[countId, dateIso, userName, status, location]]}
  getScannerData: async (db, args) => {
    const [startDateStr, endDateStr] = args;
    const rows = await queryAll(db, `
      SELECT count_id, count_date, user_name, status, location
      FROM stock_counts
      ORDER BY count_date DESC
    `);

    let history = rows.map((r) => {
      const d = r.count_date ? new Date(String(r.count_date).replace(' ', 'T')) : null;
      return [
        r.count_id,
        d && !isNaN(d.getTime()) ? d.toISOString() : (r.count_date || ''),
        r.user_name || '',
        r.status || '',
        r.location || ''
      ];
    });

    // Inclusive date-range filter.
    if (startDateStr || endDateStr) {
      const from = startDateStr ? new Date(`${startDateStr}T00:00:00`) : null;
      const to = endDateStr ? new Date(`${endDateStr}T23:59:59`) : null;
      history = history.filter((row) => {
        const d = new Date(row[1]);
        if (isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    return { history: history.slice(0, 50) };
  },

  // ScannerGS.getItemsByCountId(countId) — the items of a stock count.
  // GAS shape: [{barcode, geo, pn, en, es, qty}]
  getItemsByCountId: async (db, args) => {
    const countId = args[0];
    const rows = await queryAll(db, `
      SELECT sci.barcode, sci.geo, sci.product_number, sci.desc_en, sci.desc_es, sci.quantity
      FROM stock_count_items sci
      JOIN stock_counts sc ON sc.count_id = sci.count_id
      WHERE sci.count_id = ?
    `, [countId]);
    return rows.map((r) => ({
      barcode: r.barcode || '',
      geo: r.geo || '',
      pn: r.product_number || '',
      en: r.desc_en || '',
      es: r.desc_es || '',
      qty: Number(r.quantity) || 0
    }));
  },

  // BundlesGS.getBundles — list of bundles.
  // GAS shape: [{bundleId, name, isActive, itemCount}]
  getBundles: async (db) => {
    const rows = await queryAll(db, `
      SELECT b.id, b.bundle_id, b.name, b.is_active,
             (SELECT COUNT(*) FROM bundle_items bi WHERE bi.bundle_id = b.id) AS item_count
      FROM bundles b
      ORDER BY b.created_at DESC
    `);
    return rows.map((r) => ({
      bundleId: r.bundle_id,
      name: r.name || '',
      isActive: Number(r.is_active) === 1,
      itemCount: Number(r.item_count) || 0
    }));
  },

  // BundlesGS.getBundleItems — items in a bundle.
  // GAS shape: {bundle: {bundleId, name, isActive}, items: [{geo, qty}]}
  getBundleItems: async (db, args) => {
    const bundleId = args[0];
    const b = await queryOne(db, `SELECT id, bundle_id, name, is_active FROM bundles WHERE bundle_id = ? LIMIT 1`, [bundleId]);
    if (!b) return { bundle: { bundleId, name: '', isActive: false }, items: [] };
    const items = await queryAll(db, `SELECT geo_code, qty FROM bundle_items WHERE bundle_id = ?`, [b.id]);
    return {
      bundle: { bundleId: b.bundle_id, name: b.name || '', isActive: Number(b.is_active) === 1 },
      items: items.map((i) => ({ geo: i.geo_code, qty: Number(i.qty) || 0 }))
    };
  },

  // BundlesGS.getBundleDetails — bundle header + items.
  // The frontend reads `data.bundle.bundleId` directly, so a missing bundle
  // returns an empty structure instead of throwing (GAS threw "Bundle not
  // found", which the UI surfaced as an unhandled error).
  getBundleDetails: async (db, args) => {
    const bundleId = args[0];
    const b = await queryOne(db, `SELECT id, bundle_id, name, is_active FROM bundles WHERE bundle_id = ? LIMIT 1`, [bundleId]);
    if (!b) {
      return { bundle: { bundleId: String(bundleId || ''), name: '', isActive: false }, items: [] };
    }
    const items = await queryAll(db, `SELECT geo_code, qty FROM bundle_items WHERE bundle_id = ?`, [b.id]);
    return {
      bundle: { bundleId: b.bundle_id, name: b.name || '', isActive: Number(b.is_active) === 1 },
      items: items.map((i) => ({ geo: i.geo_code, qty: Number(i.qty) || 0 }))
    };
  },

  // Código.js.getBundlesForSearch — bundles matching a search term.
  getBundlesForSearch: async (db, args) => {
    const term = String(args[0] || '').trim();
    const params = [];
    let where = '';
    if (term) {
      where = 'WHERE LOWER(b.bundle_id) LIKE ? OR LOWER(IFNULL(b.name, \'\')) LIKE ?';
      params.push(`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`);
    }
    const rows = await queryAll(db, `
      SELECT b.id, b.bundle_id, b.name, b.is_active,
             (SELECT COUNT(*) FROM bundle_items bi WHERE bi.bundle_id = b.id) AS item_count
      FROM bundles b
      ${where}
      ORDER BY b.created_at DESC
      LIMIT 50
    `, params);
    return rows.map((r) => ({
      bundleId: r.bundle_id,
      name: r.name || '',
      isActive: Number(r.is_active) === 1,
      itemCount: Number(r.item_count) || 0
    }));
  },

  // LocationMapGS.getSectors — distinct LocationIDs (Sectors).
  // GAS shape: array of unique non-empty strings.
  getSectors: async (db) => {
    const rows = await queryAll(db, `
      SELECT DISTINCT location_id FROM item_location_map
      WHERE location_id IS NOT NULL AND TRIM(location_id) != ''
      ORDER BY location_id
    `);
    return rows.map((r) => String(r.location_id).trim());
  },

  // LocationMapGS.getRackConfig — rack definitions.
  // GAS shape: [{locationId, rackId, hasSides, noOfShelves}]
  getRackConfig: async (db) => {
    const rows = await queryAll(db, `
      SELECT location_id, rack_id, has_sides, no_of_shelves
      FROM item_location_map
      ORDER BY location_id, rack_id
    `);
    return rows.map((r) => ({
      locationId: r.location_id || '',
      rackId: r.rack_id || '',
      hasSides: Number(r.has_sides) === 1,
      noOfShelves: r.no_of_shelves != null ? parseInt(r.no_of_shelves, 10) : 0
    }));
  },

  // LocationMapGS.searchItemsByLocation(locationId, query)
  // GAS shape: [{itemID, productName, quantity, availableQty, rackID, sideCode, shelfLevel}]
  searchItemsByLocation: async (db, args) => {
    const locationId = String(args[0] || '').trim();
    const query = String(args[1] || '').trim().toLowerCase();

    const rows = await queryAll(db, `
      SELECT st.item_id, p.geo, p.name AS product_name, st.quantity,
             st.available_qty, st.location_id,
             ilm.rack_id, ilm.side_code, ilm.shelf_level
      FROM stock st
      JOIN products p ON p.id = st.item_id
      LEFT JOIN item_location_map ilm
        ON LOWER(IFNULL(ilm.location_id, '')) = LOWER(st.location_id)
       AND (IFNULL(ilm.item_id, '') = CAST(st.item_id AS TEXT) OR IFNULL(ilm.item_id, '') = p.geo)
      WHERE st.is_active = 1
        AND LOWER(IFNULL(st.location_id, '')) = LOWER(?)
        AND COALESCE(st.available_qty, st.quantity, 0) > 0
    `, [locationId]);

    return rows
      .map((r) => ({
        itemID: r.geo || String(r.item_id),
        productName: r.product_name || '',
        quantity: Number(r.quantity) || 0,
        availableQty: Number(r.available_qty) || 0,
        rackID: r.rack_id || '',
        sideCode: r.side_code || '',
        shelfLevel: r.shelf_level || ''
      }))
      .filter((item) => {
        if (!query) return true;
        return String(item.itemID).toLowerCase().includes(query)
          || String(item.productName).toLowerCase().includes(query);
      });
  },

  // CreateReqGS.getLiveStockMap — available stock grouped by geo.
  getLiveStockMap: async (db) => {
    const rows = await queryAll(db, `SELECT p.geo, SUM(COALESCE(s.available_qty, s.quantity, 0)) AS qty FROM stock s JOIN products p ON p.id = s.item_id WHERE s.is_active = 1 AND p.is_active = 1 GROUP BY p.geo`);
    const map = {};
    (rows || []).forEach((x) => { map[x.geo] = Number(x.qty) || 0; });
    return map;
  },










  // InvMovGS.getMovementValidation — the distinct validation lists used to
  // populate the movement dropdowns.
  // GAS shape: {Sector: [], Maquina: [], Generador: [], Vehiculo: []}
  getMovementValidation: async (db) => {
    const rows = await queryAll(db, `
      SELECT sector, maquinaria, generadores, vehiculos FROM movement_val
    `);

    const result = { Sector: new Set(), Maquina: new Set(), Generador: new Set(), Vehiculo: new Set() };
    (rows || []).forEach((r) => {
      if (r.sector) result.Sector.add(String(r.sector).trim());
      if (r.maquinaria) result.Maquina.add(String(r.maquinaria).trim());
      if (r.generadores) result.Generador.add(String(r.generadores).trim());
      if (r.vehiculos) result.Vehiculo.add(String(r.vehiculos).trim());
    });

    return {
      Sector: [...result.Sector],
      Maquina: [...result.Maquina],
      Generador: [...result.Generador],
      Vehiculo: [...result.Vehiculo]
    };
  },


  // Get last fuel entry for an asset (for odometer validation)
  getLastFuelEntry: async (db, args) => {
    const assetId = String((args && args[0]) || '').trim();
    if (!assetId) return { status: 'success', success: true, data: { lastKm: null }, lastKm: null };

    const row = await queryOne(db, `
      SELECT odometer_km FROM fuel_entries 
      WHERE asset_id = ? 
      ORDER BY entry_date DESC 
      LIMIT 1
    `, [assetId]);

    const km = row ? Number(row.odometer_km) : null;
    return { status: 'success', success: true, data: { lastKm: km }, lastKm: km };
  },

  // RFQGS.getRFQStockMap — available stock per geo for RFQ.
  getRFQStockMap: async (db, args) => {
    const site = String((args && args[0]) || '').trim().toUpperCase();
    const rows = await queryAll(db, `
      SELECT COALESCE(s.geo, p.geo) AS geo, s.location_id,
             SUM(COALESCE(s.available_qty, s.quantity, 0)) AS available
      FROM stock s
      LEFT JOIN products p ON p.id = s.item_id
      WHERE s.is_active = 1
      GROUP BY COALESCE(s.geo, p.geo), s.location_id
    `);
    const siteStock = {};
    const bodegaStock = {};
    (rows || []).forEach((x) => {
      if (!x.geo) return;
      const loc = String(x.location_id || '').trim().toUpperCase();
      const avail = Number(x.available) || 0;
      if (site && loc === site) {
        siteStock[x.geo] = (siteStock[x.geo] || 0) + avail;
      }
      if (loc === 'BODEGA' || loc === 'STORE') {
        bodegaStock[x.geo] = (bodegaStock[x.geo] || 0) + avail;
      }
    });
    return { siteStock, bodegaStock };
  },

  // QuoteMgmtGS.getRequirementQuoteRows — quotes for a requisition/order.
  getRequirementQuoteRows: async (db, args) => {
    const orderId = String(args[0] || '').trim();
    if (!orderId) return [];
    return queryAll(db, `SELECT q.id, q.quote_no, q.supplier_id, q.status, q.total, q.created_at FROM quotes q WHERE q.requisition_id = ? ORDER BY q.created_at DESC`, [orderId]);
  },

  // Código.js.getPendingRequirementsForRFQ — requirements grouped by order for RFQ page.
  getPendingRequirementsForRFQ: async (db, args = []) => {
    const site = args && args[0] ? String(args[0]).trim() : '';
    const statusFilter = args && args[1] ? String(args[1]).trim().toLowerCase() : 'approved';

    const allHistory = await IMPLEMENTED.getRequirementsHistory(db);

    let pending;
    if (statusFilter === 'all') {
      pending = allHistory.filter((item) => item.estado && !item.estado.toString().toLowerCase().includes('pend'));
    } else {
      pending = allHistory.filter((item) => item.estado && item.estado.toString().toLowerCase().includes(statusFilter));
    }
    if (site) {
      pending = pending.filter((item) => item.faena === site);
    }

    const products = await queryAll(db, `
      SELECT p.geo, p.pn,
             p.description_es AS es, p.description AS en,
             c.name AS category,
             sc.name AS subCategory,
             s.name AS supplier
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.is_active = 1
    `);
    const masterMap = new Map();
    (products || []).forEach((p) => {
      if (p.geo && !masterMap.has(p.geo)) {
        masterMap.set(p.geo, {
          en: p.en || '',
          es: p.es || '',
          supplier: p.supplier || '',
          category: p.category || '',
          subCategory: p.subCategory || '',
          pn: p.pn || ''
        });
      }
    });

    const quotes = await queryAll(db, `
      SELECT q.id, q.quote_no, COALESCE(q.ref_id, r.requisition_no) AS ref_order, q.supplier, q.status,
             qi.geo
      FROM quotes q
      LEFT JOIN requisitions r ON r.id = q.requisition_id
      JOIN quote_items qi ON qi.quote_id = q.id
      WHERE LOWER(q.status) != 'deleted'
    `);
    const quotesByOrderGeo = {};
    (quotes || []).forEach((q) => {
      if (!q.geo) return;
      const key = String(q.ref_order || '').trim() + '||' + String(q.geo || '').trim();
      (quotesByOrderGeo[key] = quotesByOrderGeo[key] || []).push({
        supplier: q.supplier || '',
        quoteId: q.quote_no || '',
        status: q.status || ''
      });
    });

    const GENERAL_TOKENS = ['', 'general', 'generica', 'generico', 'sin categoria', 'sin cat', 'uncategorized', 'varios', 'n/a', 'na', 'none', '-'];
    const resolveCategory = (reqCat, masterCat) => {
      let cat = '';
      const a = String(reqCat || '').trim();
      if (a && !GENERAL_TOKENS.includes(a.toLowerCase())) {
        cat = a;
      } else {
        const b = String(masterCat || '').trim();
        if (b && !GENERAL_TOKENS.includes(b.toLowerCase())) {
          cat = b;
        } else {
          cat = 'General';
        }
      }
      if (cat.toUpperCase() === 'OPERACIONES') return 'OPERACIONES';
      if (cat.toUpperCase() === 'MANTENIMIENTO') return 'MANTENIMIENTO';
      if (cat.toUpperCase() === 'GENERAL') return 'General';
      return cat;
    };

    const groupedReqs = {};
    pending.forEach((item) => {
      if (!groupedReqs[item.order]) {
        groupedReqs[item.order] = {
          id: item.order,
          date: item.fecha,
          site: item.faena,
          subArea: item.subArea || '',
          status: item.estado || '',
          items: []
        };
      }
      const official = masterMap.get(item.geo) || { en: '', es: '', supplier: '', category: '', subCategory: '', pn: '' };
      const qKey = String(item.order || '').trim() + '||' + String(item.geo || '').trim();
      groupedReqs[item.order].items.push({
        p: item.pn || official.pn || '',
        geo: item.geo || '',
        es: (official.es || item.desc || '').toString().trim(),
        en: (official.en || '').toString().trim(),
        req_desc: (item.desc || '').toString().trim(),
        qty: item.cant || 0,
        supplier: official.supplier || '',
        category: resolveCategory(item.category, official.category),
        subCategory: official.subCategory || '',
        quotedBy: quotesByOrderGeo[qKey] || [],
        reqItemNotes: [{ ref: String(item.order || ''), notes: String(item.itemNotes || '') }],
        reqSupplierNotes: [{ ref: String(item.order || ''), notes: String(item.supplierNotes || '') }],
        images: String(item.images || '')
      });
    });

    return Object.values(groupedReqs);
  },

  // Código.js.getInventoryChunk — paginated product inventory.
  getInventoryChunk: async (db, args) => {
    const page = Math.max(parseInt(args[0]) || 1, 1);
    const limit = Math.max(parseInt(args[1]) || 50, 1);
    const offset = (page - 1) * limit;
    return queryAll(db, `SELECT id, geo, pn, name, description, unit, cost, min_qty, max_qty FROM products WHERE is_active = 1 ORDER BY geo LIMIT ? OFFSET ?`, [limit, offset]);
  },

  // GestionActivosGS.getAssetsData(assetType) — the asset list for a tab.
  // GAS shape: [{_rowIndex, name}]
  getAssetsData: async (db, args) => {
    const assetType = String(args[0] || '');
    const column = ASSET_TYPE_COLUMN[assetType];
    if (!column) throw new Error('Tipo de activo no válido.');
    const rows = await queryAll(db, `SELECT id, ${column} AS name FROM movement_val ORDER BY id`);
    return rows
      .filter((r) => r.name && String(r.name).trim() !== '')
      .map((r) => ({ _rowIndex: r.id, name: String(r.name).trim() }));
  },

  // GestionActivosGS.saveAsset(assetType, assetData, isEdit, userRole)
  saveAsset: async (db, args) => {
    const [assetType, assetData, isEdit, userRole] = args;
    const column = ASSET_TYPE_COLUMN[String(assetType || '')];
    if (!column) throw new Error('Tipo de activo no válido.');
    if (isEdit && !isAuthorizedRole(userRole)) {
      throw new Error('Acceso denegado: Solo usuarios con rol Admin o Manager pueden editar registros.');
    }
    const name = String((assetData && assetData.name) || '').trim();
    if (!name) throw new Error('El nombre o identificador no puede estar vacío.');

    if (isEdit && assetData && assetData._rowIndex) {
      await exec(db, `UPDATE movement_val SET ${column} = ? WHERE id = ?`, [name, assetData._rowIndex]);
    } else {
      await exec(db, `INSERT INTO movement_val (${column}) VALUES (?)`, [name]);
    }
    return true;
  },

  // GestionActivosGS.deleteAsset(assetType, rowIndex, userRole)
  deleteAsset: async (db, args) => {
    const [assetType, rowIndex, userRole] = args;
    const column = ASSET_TYPE_COLUMN[String(assetType || '')];
    if (!column) throw new Error('Tipo de activo no válido.');
    if (!isAuthorizedRole(userRole)) {
      throw new Error('Acceso denegado: Solo usuarios con rol Admin o Manager pueden eliminar registros.');
    }
    if (!rowIndex) throw new Error('No se pudo encontrar el registro a eliminar.');
    await exec(db, `UPDATE movement_val SET ${column} = NULL WHERE id = ?`, [rowIndex]);
    return true;
  },

  // CreateBulkPOMACGS.getMacroHistoryLogs — the bulk-PO audit trail.
  getMacroHistoryLogs: async (db) => {
    const rows = await queryAll(db, `
      SELECT timestamp, user_email, po_count, export_type, file_id
      FROM macro_history_log
      ORDER BY timestamp DESC, id DESC
    `);
    return rows.map((r) => {
      const d = r.timestamp ? new Date(String(r.timestamp).replace(' ', 'T')) : null;
      const ts = d && !isNaN(d.getTime())
        ? d.toISOString().slice(0, 16).replace('T', ' ')
        : String(r.timestamp || '');
      return {
        timestamp: ts,
        user: r.user_email || '',
        poCount: r.po_count || 0,
        type: r.export_type || '',
        driveId: r.file_id || ''
      };
    });
  },

  // Código.js.getRequirementRouting(siteName, categoryName, subAreaName)
  // Recipients come from the users table (Position = category and Role in
  // office/admin/manager); the suffix comes from the site code.
  getRequirementRouting: async (db, args) => {
    const [siteName, categoryName, subAreaName] = args;
    const sName = String(siteName || '').trim();

    // SubArea routing override: when a SubArea is given, its emails replace
    // the category-based recipients.
    const subAreaRequested = String(subAreaName || '').trim();
    if (subAreaRequested) {
      const sa = await queryOne(db, `
        SELECT name, email, suffix FROM sub_areas
        WHERE LOWER(name) = LOWER(?) AND active = 1 LIMIT 1
      `, [subAreaRequested]);
      if (sa && sa.email) {
        const emails = String(sa.email).split(/[,;]/).map((e) => e.trim()).filter(Boolean);
        return {
          emails: emails.length ? emails.join(', ') : 'procurement@yourcompany.com',
          suffix: sa.suffix || 'REQ',
          matchedUsers: emails
        };
      }
    }

    // Suffix lookup from the site code.
    const site = await queryOne(db, `SELECT code FROM sites WHERE LOWER(name) = LOWER(?) LIMIT 1`, [sName]);
    const suffix = (site && site.code) || 'REQ';

    // Accepted categories: empty/General means only General-ish categories.
    const GENERAL_CATEGORIES = ['general', 'generica', 'generico', 'sin categoria', 'sin cat', 'uncategorized', 'varios'];
    const cTokens = String(categoryName || '')
      .split(/[,;]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const isGeneralRequest = cTokens.length === 0 || cTokens.every((t) => GENERAL_CATEGORIES.includes(t));
    const acceptedCats = isGeneralRequest ? GENERAL_CATEGORIES : cTokens;

    const users = await queryAll(db, `SELECT email, position, role, is_active FROM users`);
    const emails = [];
    (users || []).forEach((u) => {
      const uCat = String(u.position || '').trim().toLowerCase();
      const uRole = String(u.role || '').trim().toLowerCase();
      if (!uCat) return;                       // no Position → never a recipient
      if (!acceptedCats.includes(uCat)) return;
      if (!['office', 'admin', 'manager'].includes(uRole)) return;
      if (Number(u.is_active) !== 1) return;
      const email = String(u.email || '').trim();
      if (email && !emails.includes(email)) emails.push(email);
    });

    return {
      emails: emails.length ? emails.join(', ') : 'procurement@yourcompany.com',
      suffix,
      matchedUsers: emails
    };
  },

  // CreateReqGS.getRoutingPreview(site, category, userEmail, subArea)
  getRoutingPreview: async (db, args) => {
    const [site, category, userEmail, subArea] = args;
    const routing = await IMPLEMENTED.getRequirementRouting(db, [site, category, subArea || '']);
    const signature = await IMPLEMENTED.getUserSignature(db, [userEmail]);
    return {
      routing: {
        emails: routing.emails || '',
        suffix: routing.suffix || 'GEN'
      },
      subArea: subArea || '',
      signature
    };
  },

  // QuoteMgmtGS.getReqQuoteTimeline(orderId) — the requirement/quote timeline.
  getReqQuoteTimeline: async (db, args) => {
    const oid = String(args[0] || '').trim();
    const empty = {
      orderId: oid, reqCreated: '', reqCreatedIso: '', reqApprovedBy: '',
      reqApprovedDate: '', reqLastModifiedBy: '', reqLastModified: '',
      reqLastModifiedIso: '', reqModCount: 0, quotes: []
    };
    if (!oid) return empty;

    const req = await queryOne(db, `
      SELECT requisition_no, created_at, updated_at, requested_by,
             last_modified_by, last_modified_date, mod_count
      FROM requisitions
      WHERE requisition_no = ? OR id = ?
      LIMIT 1
    `, [oid, oid]);
    if (!req) return empty;

    const created = req.created_at ? new Date(String(req.created_at).replace(' ', 'T')) : null;
    const modified = req.updated_at ? new Date(String(req.updated_at).replace(' ', 'T')) : null;

    const quotes = await queryAll(db, `
      SELECT q.id, q.quote_no, q.requisition_id, q.status, q.total,
             q.created_at, q.updated_at, q.created_by,
             q.last_modified_by, q.last_modified_date, q.mod_count,
             COALESCE(q.supplier, s.name) AS supplier
      FROM quotes q
      LEFT JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.requisition_id = ?
         OR q.requisition_id IN (SELECT id FROM requisitions WHERE requisition_no = ?)
         OR q.ref_id = ?
      ORDER BY q.created_at ASC
    `, [oid, oid, oid]);

    return {
      orderId: oid,
      reqCreated: created && !isNaN(created.getTime()) ? created.toISOString() : '',
      reqCreatedIso: created && !isNaN(created.getTime()) ? created.toISOString() : '',
      reqApprovedBy: '',
      reqApprovedDate: '',
      reqLastModifiedBy: req.requested_by || '',
      reqLastModified: modified && !isNaN(modified.getTime()) ? modified.toISOString() : '',
      reqLastModifiedIso: modified && !isNaN(modified.getTime()) ? modified.toISOString() : '',
      reqModCount: 0,
      quotes: (quotes || []).map((q) => {
        const qc = q.created_at ? new Date(String(q.created_at).replace(' ', 'T')) : null;
        const qm = q.updated_at ? new Date(String(q.updated_at).replace(' ', 'T')) : null;
        return {
          supplier: q.supplier || '',
          quoteId: q.quote_no || q.id,
          createdDate: qc && !isNaN(qc.getTime()) ? qc.toISOString() : '',
          createdBy: q.created_by || '',
          lastModifiedDate: q.last_modified_date || (qm && !isNaN(qm.getTime()) ? qm.toISOString() : ''),
          lastModifiedBy: q.last_modified_by || q.created_by || '',
          modCount: Number(q.mod_count) || 0,
          uploadedDate: '',
          uploadedBy: '',
          approvedBy: '',
          approvedDate: '',
          status: q.status || '',
          total: Number(q.total) || 0
        };
      })
    };
  },

  // Código.js.getLifecycleReportData(params) — the requirement lifecycle view.
  getLifecycleReportData: async (db, args) => {
    const params = args[0] || {};
    const reqRows = await IMPLEMENTED.getRequirementsHistory(db, []);

    const reqMap = {};
    (reqRows || []).forEach((r) => {
      const orderId = String(r.order || '').trim();
      if (!orderId) return;
      if (!reqMap[orderId]) {
        reqMap[orderId] = {
          orderId,
          createdDate: r.fecha || '',
          site: r.faena || '',
          category: r.category || '',
          creator: r.user || '',
          items: [],
          quoteIds: new Set(),
          suppliers: new Set(),
          lastUpdated: r.fecha || ''
        };
      }
      reqMap[orderId].items.push({
        pn: r.pn || '',
        geo: r.geo || '',
        desc: r.desc || '',
        qty: r.cant || 0,
        estado: r.estado || '',
        pdfUrl: r.pdfUrl || '',
        quotes: []
      });
    });

    // Attach the quotes that reference each requirement.
    const quotes = await queryAll(db, `
      SELECT q.id, q.quote_no, q.requisition_id, q.status, q.total, q.created_at,
             s.name AS supplier
      FROM quotes q
      LEFT JOIN suppliers s ON s.id = q.supplier_id
    `);
    (quotes || []).forEach((q) => {
      const orderId = String(q.requisition_id || '').trim();
      const req = reqMap[orderId];
      if (!req) return;
      req.quoteIds.add(q.quote_no || q.id);
      if (q.supplier) req.suppliers.add(q.supplier);
      const qc = q.created_at ? new Date(String(q.created_at).replace(' ', 'T')) : null;
      const iso = qc && !isNaN(qc.getTime()) ? qc.toISOString() : '';
      req.items.forEach((it) => {
        it.quotes.push({
          quoteId: q.quote_no || q.id,
          supplier: q.supplier || '',
          estado: q.status || '',
          status: q.status || '',
          total: Number(q.total) || 0,
          timestampIso: iso
        });
      });
    });

    const entries = buildLifecycleEntries(reqMap);

    // Optional filters (site / category / stage) from the GAS params object.
    let filtered = entries;
    if (params && params.site) {
      const s = String(params.site).toLowerCase();
      filtered = filtered.filter((e) => String(e.site || '').toLowerCase() === s);
    }
    if (params && params.category) {
      const c = String(params.category).toLowerCase();
      filtered = filtered.filter((e) => String(e.category || '').toLowerCase() === c);
    }
    if (params && params.stage) {
      const st = String(params.stage).toLowerCase();
      filtered = filtered.filter((e) => String(e.stage || '').toLowerCase() === st);
    }

    return { entries: filtered, total: filtered.length };
  },

  // QuoteMgmtGS.getPoReminderDraft — latest quote for a requisition (reminder draft).
  getPoReminderDraft: async (db, args) => {
    const orderId = String(args[0] || '').trim();
    if (!orderId) return null;
    return queryOne(db, `SELECT q.id, q.quote_no, q.requisition_id, q.supplier_id, q.status, q.total, q.pdf_url, q.created_at FROM quotes q WHERE q.requisition_id = ? ORDER BY q.created_at DESC LIMIT 1`, [orderId]) || null;
  },

  // Código.js.getUserSignature — HTML signature block for a user email.
  getUserSignature: async (db, args) => {
    const email = String(args[0] || '').trim();
    const r = await queryOne(db, `SELECT name, position, site, email, sign_link FROM users WHERE email = ? LIMIT 1`, [email]);
    if (!r) return '<div><strong>RECON Drilling</strong></div>';
    const imageSrc = r.sign_link || '';
    return `<div style="font-family:Arial,sans-serif;margin-top:15px;line-height:1.2;"><img src="${imageSrc}" style="width:120px;height:auto;display:block;margin-bottom:8px;" alt="RECON Logo"><div style="border-left:2px solid #198754;padding-left:10px;margin-top:5px;"><strong style="font-size:14px;color:#333;">${r.name || ''}</strong><br><span style="font-size:12px;color:#666;">${r.position || ''} | ${r.site || 'Chile'}</span><br><span style="font-size:11px;color:#198754;">${r.email || ''}</span></div></div>`;
  },

  // Código.js.getCesiumToken — Cesium access token from config.
  getCesiumToken: async (db) => {
    const r = await queryOne(db, `SELECT value FROM config WHERE key = 'cesium_token' LIMIT 1`);
    return r ? r.value : '';
  },

  // Código.js.getCompanyLogo — company logo URL from config.
  getCompanyLogo: async (db) => {
    const r = await queryOne(db, `SELECT value FROM config WHERE key = 'company_logo' LIMIT 1`);
    return r ? r.value : '';
  },

  // CreateBulkPOMACGS.getDownloadUrlById — download URL (R2 key) for a file id.
  getDownloadUrlById: async (db, args) => {
    const fileId = String(args[0] || '').trim();
    const r = await queryOne(db, `SELECT r2_key FROM files WHERE id = ? LIMIT 1`, [fileId]);
    return r ? r.r2_key : null;
  },

  // Código.js.getEmailSuggestions — people + supplier email suggestions.
  getEmailSuggestions: async (db, args) => {
    const term = String(args[0] || '').trim().toLowerCase();
    if (!term) return [];
    const results = [];
    const seen = {};
    const add = (label, value, source) => {
      if (!value || !label) return;
      const key = String(value).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      results.push({ label, value, source });
    };
    const ures = await queryAll(db, `SELECT name, email FROM users WHERE is_active = 1`);
    (ures || []).forEach((p) => {
      const email = String(p.email || '').trim().toLowerCase();
      const name = String(p.name || '').trim();
      if (!email || !name) return;
      if (name.indexOf(term) !== -1 || email.indexOf(term) !== -1) {
        add(name + ' <' + email + '>', email, 'people');
      }
    });
    const sres = await queryAll(db, `SELECT name, email FROM suppliers WHERE active = 1`);
    (sres || []).forEach((s) => {
      const email = String(s.email || '').trim().toLowerCase();
      const name = String(s.name || '').trim();
      if (!email || !name) return;
      if (name.indexOf(term) !== -1 || email.indexOf(term) !== -1) {
        add(name + ' <' + email + '>', email, 'supplier');
      }
    });
    results.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    return results.slice(0, 10);
  },

  // Código.js.getAdminData — aggregate admin counts.
  getAdminData: async (db) => {
    const counts = {};
    const tables = ['users', 'sites', 'products', 'requisitions', 'quotes', 'inventory_movements', 'fuel_entries'];
    for (const t of tables) {
      const r = await queryOne(db, `SELECT COUNT(*) AS c FROM ` + t);
      counts[t] = Number(r && r.c) || 0;
    }
    return counts;
  },

  // Código.js.getAutoSelectedSite — default active site.
  getAutoSelectedSite: async (db) => {
    const r = await queryOne(db, `SELECT name, code FROM sites WHERE active = 1 ORDER BY name LIMIT 1`);
    return r ? { name: r.name, code: r.code } : null;
  },

  // ControlCombustibleGS.saveFuelEntry — record a fuel consumption entry.
  // GAS appended: [Date, Proyecto, TipoActivo, ID/Patente, Litros, KM,
  //                Nombre, User]
  saveFuelEntry: async (db, args) => {
    const d = args[0] || {};
    const r = await exec(db, `
      INSERT INTO fuel_entries
        (entry_date, proyecto, tipo_activo, asset_id, liters, odometer_km, driver, user_email)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
    `, [
      d.proyecto || '', d.tipoActivo || '', d.assetId || '',
      Number(d.cantidadLitro) || 0, d.kilometraje ? Number(d.kilometraje) : null,
      d.nombre || '', d.userEmail || ''
    ]);
    const id = (r && r.meta && r.meta.last_row_id) || null;
    return { status: 'success', success: true, id, message: 'Registro guardado exitosamente' };
  },

  // ControlCombustibleGS.saveFuelPurchase — record a fuel purchase.
  // GAS appended: [Date, Proveedor, Litros, Factura, Nombre Usuario]
  saveFuelPurchase: async (db, args) => {
    const d = args[0] || {};
    const r = await exec(db, `
      INSERT INTO fuel_purchases (purchase_date, proveedor, litros, factura, user_name)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `, [d.proveedor || '', Number(d.litros) || 0, d.factura || '', d.userName || '']);
    const id = (r && r.meta && r.meta.last_row_id) || null;
    return { status: 'success', success: true, id, message: 'Compra registrada exitosamente' };
  },

  // InvMovGS.savePerson — create or update a person (People sheet record).
  // GAS payload: {id, name, department, active, sector, notes, rut,
  //                biometricTemplate, email}
  savePerson: async (db, args) => {
    const p = args[0] || {};
    const active = p.active === true || p.active === 1 || p.active === 'TRUE' ? 1 : 0;

    if (p.id) {
      const existing = await queryOne(db, `SELECT id FROM people WHERE id = ? LIMIT 1`, [String(p.id)]);
      if (existing) {
        await exec(db, `
          UPDATE people SET name = ?, department = ?, active = ?, sector = ?,
                            notes = ?, rut = ?, biometric_template = ?, email = ?,
                            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [p.name || '', p.department || '', active, p.sector || '', p.notes || '',
        p.rut || '', p.biometricTemplate || '', p.email || '', String(p.id)]);
        return { success: true, message: 'Person updated successfully' };
      }
    }

    const id = 'RD-' + Date.now();
    await exec(db, `
      INSERT INTO people (id, name, department, active, sector, notes, rut, biometric_template, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, p.name || '', p.department || '', active, p.sector || '', p.notes || '',
      p.rut || '', p.biometricTemplate || '', p.email || '']);
    return { success: true, message: 'Person added successfully' };
  },

  // InvMovGS.togglePersonStatus — activate/deactivate a person.
  // GAS payload: (id, newStatus)
  togglePersonStatus: async (db, args) => {
    const [id, newStatus] = args;
    const active = newStatus === true || newStatus === 1 || newStatus === 'TRUE' ? 1 : 0;
    const r = await exec(db, `UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [active, String(id == null ? '' : id)]);
    const changes = (r && r.meta && r.meta.changes) || 0;
    if (!changes) return { success: false, message: 'Person not found' };
    return { success: true, message: active ? 'Person activated' : 'Person deactivated' };
  },

  // MinMaxGS.saveMinMaxItems — save min/max levels (one row per item).
  saveMinMaxItems: async (db, args) => {
    const items = args[0] || [];
    for (const it of items) {
      await exec(db, `INSERT INTO min_max (site, geo_code, min_qty, max_qty, updated_by) VALUES (?, ?, ?, ?, ?)`, [it.site, it.geo, it.min, it.max, it.updatedBy || '']);
    }
    return { success: true, count: items.length };
  },

  // MinMaxGS.deleteMinMaxItems — delete min/max rows.
  deleteMinMaxItems: async (db, args) => {
    const items = args[0] || [];
    for (const it of items) {
      await exec(db, `DELETE FROM min_max WHERE site = ? AND geo_code = ?`, [it.site, it.geo]);
    }
    return { success: true };
  },

  // LabelsGS.saveLabelTemplate — save or update a label template.
  // GAS payload: {templateId, templateName, elementsJson, canvasWidth, canvasHeight}
  saveLabelTemplate: async (db, args) => {
    const t = args[0] || {};
    const id = t.templateId || uuidv4();
    const existing = await queryOne(db, `SELECT id FROM labels WHERE id = ? LIMIT 1`, [id]);
    if (existing) {
      await exec(db, `
        UPDATE labels SET name = ?, template_data = ?, canvas_width = ?,
                          canvas_height = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [t.templateName || '', t.elementsJson || '', t.canvasWidth || null,
      t.canvasHeight || null, id]);
    } else {
      await exec(db, `
        INSERT INTO labels (id, name, template_data, canvas_width, canvas_height)
        VALUES (?, ?, ?, ?, ?)
      `, [id, t.templateName || '', t.elementsJson || '', t.canvasWidth || null,
        t.canvasHeight || null]);
    }
    return { success: true, message: 'Template saved successfully!', templateId: id };
  },

  // LabelsGS.getLabelTemplates — all templates, or one by id.
  getLabelTemplates: async (db, args) => {
    const templateId = args[0];
    const rows = await queryAll(db, `
      SELECT id, name, template_data, canvas_width, canvas_height, updated_at
      FROM labels ORDER BY name
    `);
    const templates = rows.map((r) => ({
      templateId: r.id,
      templateName: r.name || 'Untitled Template',
      elementsJson: r.template_data || '',
      updatedAt: r.updated_at ? new Date(String(r.updated_at).replace(' ', 'T')).toISOString() : new Date().toISOString(),
      canvasWidth: r.canvas_width,
      canvasHeight: r.canvas_height
    }));
    if (templateId) return templates.find((t) => t.templateId === templateId) || null;
    return templates;
  },

  // LabelsGS.deleteLabelTemplate — delete a label template.
  deleteLabelTemplate: async (db, args) => {
    const id = args[0];
    await exec(db, `DELETE FROM labels WHERE id = ?`, [id]);
    return { success: true };
  },

  // BundlesGS.saveBundle — create or update a bundle with its items.
  // GAS payload: {bundleId, name, isActive, items:[{geoCode, qty}]}
  saveBundle: async (db, args) => {
    const b = args[0] || {};
    const bundleId = b.bundleId || uuidv4();
    const name = b.name || '';
    const isActive = b.isActive === undefined ? 1 : (b.isActive ? 1 : 0);

    const existing = await queryOne(db, `SELECT id FROM bundles WHERE bundle_id = ? LIMIT 1`, [bundleId]);
    let rowId;
    if (existing) {
      rowId = existing.id;
      await exec(db, `UPDATE bundles SET name = ?, is_active = ? WHERE id = ?`, [name, isActive, rowId]);
      // Replace the item set (GAS rewrites the Bundle_Items rows).
      await exec(db, `DELETE FROM bundle_items WHERE bundle_id = ?`, [rowId]);
    } else {
      const r = await exec(db, `INSERT INTO bundles (bundle_id, name, is_active) VALUES (?, ?, ?)`, [bundleId, name, isActive]);
      rowId = (r && r.meta && r.meta.last_row_id) || null;
    }

    const items = b.items || [];
    for (const it of items) {
      await exec(db, `INSERT INTO bundle_items (bundle_id, geo_code, qty) VALUES (?, ?, ?)`, [rowId, it.geoCode || it.geo, it.qty || 1]);
    }
    return { success: true, bundleId };
  },

  // LocationMapGS.saveNewRack — create a rack location mapping.
  saveNewRack: async (db, args) => {
    const r = args[0] || {};
    await exec(db, `INSERT INTO item_location_map (location_id, rack_id, has_sides, no_of_shelves, item_id, side_code, shelf_level) VALUES (?, ?, ?, ?, ?, ?, ?)`, [r.locationId, r.rackId, r.hasSides ? 1 : 0, r.noOfShelves, r.itemId, r.sideCode, r.shelfLevel]);
    return { success: true };
  },

  // ScannerGS.saveStockCount(sessionData) — save a stock count and apply it
  // to the stock table.
  // GAS payload: {userName, location, stockMode, items:[{barcode, geo, pn, en, es, qty}]}
  saveStockCount: async (db, args) => {
    const c = args[0] || {};
    const countId = `SC-${Date.now()}`;
    const countDate = new Date().toISOString();
    const location = String(c.location || '').trim();
    const stockMode = String(c.stockMode || 'add').toLowerCase() === 'replace' ? 'replace' : 'add';
    const items = c.items || [];

    await exec(db, `INSERT INTO stock_counts (count_id, count_date, user_name, status, location) VALUES (?, ?, ?, 'Completed', ?)`,
      [countId, countDate, c.userName || 'System', location]);

    for (const it of items) {
      await exec(db, `INSERT INTO stock_count_items (count_id, barcode, geo, product_number, desc_en, desc_es, quantity, count_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [countId, it.barcode || '', it.geo || '', it.pn || '', it.en || it.name || '', it.es || '', Number(it.qty) || 0, countDate]);
    }

    // Apply the count to the stock table.
    let processed = 0;
    for (const it of items) {
      const barcode = String(it.barcode || '').trim();
      if (!barcode) continue;
      const counted = Number(it.qty) || 0;

      const stockRow = await queryOne(db, `
        SELECT st.id, st.quantity, st.available_qty
        FROM stock st
        JOIN products p ON p.id = st.item_id
        WHERE (p.geo = ? OR p.pn = ? OR CAST(st.item_id AS TEXT) = ?)
          AND LOWER(IFNULL(st.location_id, '')) = LOWER(?)
        LIMIT 1
      `, [barcode, barcode, barcode, location]);

      if (!stockRow) continue;   // not stocked at this location — nothing to adjust
      if (stockMode === 'replace') {
        const delta = counted - (Number(stockRow.quantity) || 0);
        if (delta === 0) { processed++; continue; }
        await exec(db, `UPDATE stock SET quantity = ?, available_qty = ?, updated_by = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          [counted, Math.max(0, counted - (Number(stockRow.available_qty) || 0)), c.userName || 'System', stockRow.id]);
      } else {
        await exec(db, `UPDATE stock SET quantity = quantity + ?, available_qty = COALESCE(available_qty, 0) + ?, updated_by = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          [counted, counted, c.userName || 'System', stockRow.id]);
      }

      await exec(db, `INSERT INTO stock_ledger (item_id, location_type, location_id, qty_change, transaction_type, reference_id, reference_type, comments, user_name) VALUES ((SELECT item_id FROM stock WHERE id = ?), 'Sector', ?, ?, 'StockCount', ?, 'StockCount', ?, ?)`,
        [stockRow.id, location, counted, countId, `Stock Count (${stockMode}) - ${location}`, c.userName || 'System']);
      processed++;
    }

    return { success: true, countId, stockUpdated: true, stockMode, processed };
  },

  // Código.js.updateInventoryItem — update a product's inventory fields.
  updateInventoryItem: async (db, args) => {
    const it = args[0] || {};
    await exec(db, `UPDATE products SET pn = ?, name = ?, description = ?, unit = ?, cost = ?, min_qty = ?, max_qty = ? WHERE geo = ?`, [it.pn, it.name, it.description, it.unit, it.cost, it.minQty, it.maxQty, it.geo]);
    return { success: true };
  },

  // updateRequirementOnSheetWithItemStatuses: updates requisition header + items and finishes bg job
  updateRequirementOnSheetWithItemStatuses: async (db, args, authenticatedUser) => {
    let orderId, header, items, customRecipient, jobId;

    // Handle both signatures:
    // Signature A (standard webapp): [orderId, header, items, customRecipient, jobId]
    // Signature B (array of updates): [[{ itemId, status }]]
    if (typeof args[0] === 'string') {
      orderId = String(args[0] || '').trim();
      header = args[1] || {};
      items = Array.isArray(args[2]) ? args[2] : [];
      customRecipient = args[3] || null;
      jobId = args[4] || (header && header._jobId) || null;
    } else if (Array.isArray(args[0])) {
      const updates = args[0] || [];
      for (const u of updates) {
        if (u && u.itemId) {
          await exec(db, 'UPDATE requisition_items SET status = ? WHERE id = ?', [u.status || 'Pending', u.itemId]);
        }
      }
      return { success: true, count: updates.length };
    }

    try {
      const req = await queryOne(db, 'SELECT id, mod_count FROM requisitions WHERE requisition_no = ? OR id = ? LIMIT 1', [orderId, orderId]);
      if (!req) {
        if (jobId) await IMPLEMENTED.bgFinishJob(db, [jobId, false, { step: 'Requirement not found', error: 'Requirement ' + orderId + ' not found' }]);
        return { success: false, message: 'Requirement not found: ' + orderId };
      }

      const newModCount = (Number(req.mod_count) || 0) + 1;
      const editorName = header.userName || (authenticatedUser && (authenticatedUser.name || authenticatedUser.email)) || 'System Edit';

      const site = String(header.faena || header.site || '').trim();
      const siteRow = site
        ? await queryOne(db, 'SELECT id, name FROM sites WHERE lower(name) = lower(?) OR lower(site_id) = lower(?) LIMIT 1', [site, site])
        : null;

      // Update requisition header
      await exec(db, `
        UPDATE requisitions
        SET site_id = COALESCE(?, site_id),
            site = COALESCE(?, site),
            sub_area = COALESCE(?, sub_area),
            emails = CASE WHEN ? != '' THEN ? ELSE emails END,
            last_modified_by = ?,
            last_modified_date = CURRENT_TIMESTAMP,
            mod_count = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        siteRow ? siteRow.id : null,
        siteRow ? siteRow.name : (site || null),
        header.subArea !== undefined ? header.subArea : null,
        String(header.emails || '').trim(),
        String(header.emails || '').trim(),
        editorName,
        newModCount,
        req.id
      ]);

      // Update line items
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;

        let existingItem = null;
        if (it.id || it.itemId) {
          existingItem = await queryOne(db, 'SELECT id FROM requisition_items WHERE id = ?', [it.id || it.itemId]);
        }
        if (!existingItem && it.geo) {
          existingItem = await queryOne(db, 'SELECT id FROM requisition_items WHERE requisition_id = ? AND geo = ? LIMIT 1', [req.id, it.geo]);
        }

        if (existingItem) {
          await exec(db, `
            UPDATE requisition_items
            SET quantity_requested = COALESCE(?, quantity_requested),
                status = COALESCE(?, status),
                notes = COALESCE(?, notes),
                item_notes = COALESCE(?, item_notes),
                supplier_notes = COALESCE(?, supplier_notes),
                pn = COALESCE(?, pn),
                description_es = COALESCE(?, description_es)
            WHERE id = ?
          `, [
            it.cant !== undefined && it.cant !== null ? Number(it.cant) : null,
            it.estado || it.status || null,
            it.itemNotes !== undefined ? it.itemNotes : null,
            it.itemNotes !== undefined ? it.itemNotes : null,
            it.supplierNotes !== undefined ? it.supplierNotes : null,
            it.pn || null,
            it.es || it.desc || null,
            existingItem.id
          ]);
        }
      }

      // Finish background job so UI bubble shows 100% DONE
      if (jobId) {
        await IMPLEMENTED.bgFinishJob(db, [jobId, true, { step: 'Done', progress: 100 }]);
      }

      return { success: true, orderId: orderId, modCount: newModCount };
    } catch (err) {
      console.error('updateRequirementOnSheetWithItemStatuses error:', err);
      if (jobId) {
        await IMPLEMENTED.bgFinishJob(db, [jobId, false, { step: 'Failed', error: String(err && err.message || err) }]);
      }
      throw err;
    }
  },

  // Código.js.updateRequirementOnSheetWithRecipient — set requisition recipient + send update email.
  updateRequirementOnSheetWithRecipient: async (db, args, authenticatedUser) => {
    const orderId = args[0] || '';
    const header = args[1] || {};
    const items = Array.isArray(args[2]) ? args[2] : [];
    const recipientEmail = args[3] || '';

    // Update the DB (recipient / requested_by)
    await exec(db, `UPDATE requisitions SET requested_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR requisition_no = ?`, [recipientEmail || '', orderId, orderId]);

    // Build email with item table (parity with GAS update email)
    const sender = String(authenticatedUser && authenticatedUser.email || '').trim().toLowerCase();
    if (!sender || !/@recondrilling\.com$/i.test(sender)) {
      return { success: true, emailSent: false, emailError: 'Email was not sent: the logged-in user must have a recondrilling.com email address.' };
    }

    const token = await getGraphAccessToken();
    if (!token) return { success: true, emailSent: false, emailError: 'Microsoft Graph credentials are not configured.' };

    const recipients = (value) => String(value || '')
      .split(/[;, \n]+/)
      .map((email) => email.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));

    const toEmails = recipients(header.emails || recipientEmail || '');
    const ccEmails = recipients('');

    const userBody = header.notes || '';
    const itemsTable = buildReqItemsTable(items);
    const createdBy = String(header.createdBy || header.userName || '').trim();
    const solicitedBy = String(header.solicitedBy || header.userName || '').trim();
    const headerInfo = `
      <div style="margin-bottom:12px;font-size:12px;color:#555;">
        <strong>Req No:</strong> ${orderId}<br>
        ${createdBy ? `<strong>Created By:</strong> ${createdBy}<br>` : ''}
        ${solicitedBy ? `<strong>Solicitated By:</strong> ${solicitedBy}<br>` : ''}
      </div>`;
    const subject = `REQ ${orderId} - Requirement Updated`;

    // Company logo at bottom with signature (from config table)
    const logoRow = await queryOne(db, "SELECT value FROM config WHERE key = 'company_logo' LIMIT 1");
    const logoUrl = logoRow ? String(logoRow.value || '').trim() : '';
    const logoBottomHtml = logoUrl ? `<div style="margin-top:16px;text-align:center;"><img src="${logoUrl}" style="max-height:50px;max-width:160px;" alt="Company Logo"></div>` : '';

    const emailContent = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;">
        ${headerInfo}
        ${userBody ? `<div style="margin-bottom:12px;">${userBody}</div>` : ''}
        <h3 style="font-size:14px;margin:0 0 8px 0;">Items</h3>
        ${itemsTable || '<p style="font-size:12px;color:#666;">No items.</p>'}
        ${logoBottomHtml}
      </div>`;

    let emailResult = { emailSent: false, emailError: 'No recipients configured' };
    if (toEmails.length > 0) {
      try {
        const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'HTML', content: emailContent || 'Material Requirement Created' },
              toRecipients: toEmails,
              ccRecipients: ccEmails
            },
            saveToSentItems: true
          })
        });
        if (!response.ok) {
          const detail = await response.text();
          emailResult = { emailSent: false, emailError: `Graph send failed (${response.status}): ${detail.slice(0, 300)}` };
        } else {
          emailResult = { emailSent: true, emailService: 'Microsoft Graph' };
        }
      } catch (err) {
        emailResult = { emailSent: false, emailError: err.message };
      }
    }

    return {
      success: true,
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError,
      emailService: emailResult.emailService,
      emailCc: ccEmails.map(r => r.emailAddress.address).join(', ')
    };
  },

  // Código.js.sendFinalRFQ — send final RFQ/quote email with item table via Microsoft Graph,
  // save quote + quote_items into the database, and update requisition status.
  sendFinalRFQ: async (db, args, authenticatedUser) => {
    const details = args[0] || {};
    const orderId = String(details.orderId || details.refId || 'PENDING');
    const items = Array.isArray(details.items) ? details.items : (Array.isArray(details.deficitItems) ? details.deficitItems : []);
    const toEmailsRaw = String(details.to || details.emails || '').trim();
    const ccEmailsRaw = String(details.cc || '').trim();
    const subject = String(details.subject || `REQ ${orderId} - Quote / RFQ`);
    const userBody = String(details.body || details.message || '');
    const createdBy = String(details.createdBy || details.userName || (authenticatedUser && authenticatedUser.name) || '').trim();
    const solicitedBy = String(details.solicitedBy || details.userName || (authenticatedUser && authenticatedUser.name) || '').trim();
    const mode = String(details.mode || 'EMAIL_AND_PDF');

    // 1. Send Email (if mode is EMAIL_AND_PDF and recipients are provided)
    let emailSent = false;
    let emailService = 'Saved without email';
    let emailError = null;

    if (mode !== 'PDF_ONLY' && toEmailsRaw) {
      const sender = String(authenticatedUser && authenticatedUser.email || '').trim().toLowerCase();
      if (sender && /@recondrilling\.com$/i.test(sender)) {
        const token = await getGraphAccessToken();
        if (token) {
          const recipients = (value) => String(value || '')
            .split(/[;, \n]+/)
            .map((email) => email.trim())
            .filter(Boolean)
            .map((address) => ({ emailAddress: { address } }));

          const toRecipients = recipients(toEmailsRaw);
          const ccRecipients = recipients(ccEmailsRaw);

          if (toRecipients.length > 0) {
            const itemsTable = buildReqItemsTable(items);
            const headerInfo = `
              <div style="margin-bottom:12px;font-size:12px;color:#555;">
                <strong>Req No:</strong> ${orderId}<br>
                ${createdBy ? `<strong>Created By:</strong> ${createdBy}<br>` : ''}
                ${solicitedBy ? `<strong>Solicitated By:</strong> ${solicitedBy}<br>` : ''}
              </div>`;

            const signatureHtml = details.signature ? `<div style="margin-top:16px;font-size:11px;color:#555;">${details.signature}</div>` : '';

            const logoRow = await queryOne(db, "SELECT value FROM config WHERE key = 'company_logo' LIMIT 1");
            const logoUrl = logoRow ? String(logoRow.value || '').trim() : '';
            const logoBottomHtml = logoUrl ? `<div style="margin-top:16px;text-align:center;"><img src="${logoUrl}" style="max-height:50px;max-width:160px;" alt="Company Logo"></div>` : '';

            const emailContent = `
              <div style="font-family:Arial,sans-serif;line-height:1.6;">
                ${headerInfo}
                ${userBody ? `<div style="margin-bottom:12px;">${userBody}</div>` : ''}
                <h3 style="font-size:14px;margin:0 0 8px 0;">Items</h3>
                ${itemsTable || '<p style="font-size:12px;color:#666;">No items.</p>'}
                ${signatureHtml}
                ${logoBottomHtml}
              </div>`;

            try {
              const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  message: {
                    subject,
                    body: { contentType: 'HTML', content: emailContent || 'Quote / RFQ Created' },
                    toRecipients,
                    ccRecipients
                  },
                  saveToSentItems: true
                })
              });
              if (response.ok) {
                emailSent = true;
                emailService = 'Microsoft Graph';
              } else {
                const detail = await response.text();
                emailError = `Graph send failed (${response.status}): ${detail.slice(0, 300)}`;
              }
            } catch (err) {
              emailError = err.message;
            }
          }
        }
      }
    }

    // 2. Persist Quote in DB (quotes and quote_items)
    const quoteId = 'quo-' + uuidv4();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const quoteNo = details.quoteId || `RFQ-${orderId}-${timestampStr}-${uuidv4().slice(0, 8)}`;
    const displayDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // Lookup requisition by requisition_no
    const reqRow = await queryOne(db, 'SELECT id, requisition_no, site FROM requisitions WHERE requisition_no = ? OR id = ? LIMIT 1', [orderId, orderId]);
    const requisitionId = reqRow ? reqRow.id : null;

    // Lookup supplier
    const supplierName = String(details.supplier || '').trim();
    const supplierRow = supplierName ? await queryOne(db, 'SELECT id, name FROM suppliers WHERE lower(name) = lower(?) LIMIT 1', [supplierName]) : null;

    const emailsToSave = ccEmailsRaw || toEmailsRaw || '';

    await exec(db, `
      INSERT INTO quotes (
        id, quote_no, requisition_id, supplier_id, ref_id, supplier, site, category,
        comprador, created_by, notes, comments, status, currency, subtotal, discount, freight, iva, total,
        pdf_url, emails, quoted_doc_url, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'CLP', 0, 0, 0, 0, 0, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      quoteId,
      quoteNo,
      requisitionId,
      supplierRow ? supplierRow.id : null,
      orderId,
      supplierName || 'N/A',
      details.site || (reqRow ? reqRow.site : ''),
      details.category || 'General',
      details.userName || (authenticatedUser && authenticatedUser.name) || '',
      authenticatedUser ? (authenticatedUser.user_id || authenticatedUser.id || authenticatedUser.email) : null,
      userBody,
      details.comments || userBody,
      details.pdfUrl || details.attachmentUrl || '',
      emailsToSave,
      details.attachmentUrl || '',
      displayDate
    ]);

    // Insert line items into quote_items
    for (const item of items) {
      const geo = String(item.geo || '').trim();
      const product = geo ? await queryOne(db, 'SELECT id, geo, pn, description, description_es FROM products WHERE geo = ? LIMIT 1', [geo]) : null;
      const qty = Number(item.qty || item.cant || 0);

      await exec(db, `
        INSERT INTO quote_items (
          quote_id, product_id, geo, pn, description_es, description_en, quantity,
          unit_price, total_price, supplier, category, sub_category, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'Pending', ?)
      `, [
        quoteId,
        product ? product.id : null,
        geo,
        item.pn || item.p || (product ? product.pn : ''),
        item.es || (product ? product.description_es : (item.desc || item.req_desc || '')),
        item.en || (product ? product.description : ''),
        qty,
        supplierName || 'N/A',
        item.category || details.category || 'General',
        item.subCategory || item.sub_category || '',
        displayDate
      ]);
    }

    // 3. Update requisition & requisition_items status
    if (requisitionId) {
      const currentReq = await queryOne(db, 'SELECT status FROM requisitions WHERE id = ?', [requisitionId]);
      const curStatus = String(currentReq && currentReq.status || '');
      let newReqStatus;
      if (curStatus.toLowerCase().startsWith('quoted')) {
        newReqStatus = `${curStatus}, ${quoteNo}`;
      } else {
        newReqStatus = `Quoted | ${quoteNo}`;
      }
      await exec(db, `UPDATE requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newReqStatus, requisitionId]);

      for (const item of items) {
        if (item.geo) {
          await exec(db, `UPDATE requisition_items SET status = 'Quoted' WHERE requisition_id = ? AND geo = ?`, [requisitionId, item.geo]);
        }
      }
    }

    return {
      success: true,
      emailSent,
      emailService,
      quoteId: quoteNo,
      quoteDbId: quoteId,
      pdfUrl: details.pdfUrl || '',
      message: emailSent ? 'Quote email sent and saved.' : 'Quote saved successfully.'
    };
  },

  // EditPinGS.updateUserPin — hash and store a user PIN.
  updateUserPin: async (db, args) => {
    const [email, pin] = args;
    const pinHash = bcrypt.hashSync(pin, 10);
    await exec(db, `UPDATE users SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`, [pinHash, email]);
    return { success: true };
  },

  // QuoteMgmtGS.markQuoteDeleted — mark a quote deleted.
  // QuoteMgmtGS.markQuoteDeleted — mark a quote deleted (all items and quote row).
  markQuoteDeleted: async (db, args) => {
    // Supports both signatures:
    // 1) (orderId, supplier, category, quoteId)
    // 2) (quoteId)
    const [a1, a2, a3, a4] = args;
    let targetQuoteIds = [];

    if (a2 !== undefined) {
      const orderId = String(a1 || '').trim();
      const supplier = String(a2 || '').trim();
      const category = String(a3 || '').trim();
      const directQuoteId = String(a4 || '').trim();

      let whereParts = [];
      let params = [];
      if (orderId) {
        whereParts.push(`(LOWER(TRIM(COALESCE(q.ref_id, r.requisition_no, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(q.quote_no)) = LOWER(TRIM(?)))`);
        params.push(orderId, orderId);
      }
      if (supplier) {
        whereParts.push(`LOWER(TRIM(COALESCE(q.supplier, s.name, ''))) = LOWER(TRIM(?))`);
        params.push(supplier);
      }
      if (category && category.toLowerCase() !== 'all') {
        whereParts.push(`LOWER(TRIM(COALESCE(q.category, ''))) = LOWER(TRIM(?))`);
        params.push(category);
      }
      if (directQuoteId) {
        whereParts.push(`(q.id = ? OR q.quote_no = ?)`);
        params.push(directQuoteId, directQuoteId);
      }

      if (whereParts.length > 0) {
        const rows = await queryAll(db, `
          SELECT q.id FROM quotes q
          LEFT JOIN requisitions r ON r.id = q.requisition_id
          LEFT JOIN suppliers s ON s.id = q.supplier_id
          WHERE ${whereParts.join(' AND ')}
        `, params);
        targetQuoteIds = (rows || []).map(r => r.id);
      }
    } else if (a1) {
      const quoteId = String(a1).trim();
      const rows = await queryAll(db, `SELECT id FROM quotes WHERE id = ? OR quote_no = ?`, [quoteId, quoteId]);
      targetQuoteIds = (rows || []).map(r => r.id);
      if (!targetQuoteIds.length) targetQuoteIds = [quoteId];
    }

    for (const qid of targetQuoteIds) {
      await exec(db, `UPDATE quotes SET status = 'Deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [qid]);
      await exec(db, `UPDATE quote_items SET status = 'Deleted' WHERE quote_id = ?`, [qid]);
    }
    return { success: true, count: targetQuoteIds.length };
  },

  // CreateReqGS.processMassOrders — create ISSUE movements for pending requisition items.
  processMassOrders: async (db, args, authenticatedUser) => {
    if (Array.isArray(args[0])) {
      const shipments = args[0];
      const results = [];

      for (const shipment of shipments) {
        const items = Array.isArray(shipment.items) ? shipment.items : [];
        if (!items.length) continue;

        const requisitionId = uuidv4();
        const requisitionNo = await nextRequisitionNumber(db);
        const site = String(shipment.site || '').trim();
        const siteRow = site
          ? await queryOne(db, 'SELECT id FROM sites WHERE lower(name) = lower(?) OR lower(site_id) = lower(?) LIMIT 1', [site, site])
          : null;

        await exec(db, `
          INSERT INTO requisitions (
            id, requisition_no, site_id, requested_by, notes, status, category
          )
          VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `, [
          requisitionId,
          requisitionNo,
          siteRow ? siteRow.id : null,
          shipment.userName || shipment.currentUserEmail || '',
          shipment.body || '',
          shipment.category || 'General'
        ]);

        for (const item of items) {
          const product = await queryOne(db, 'SELECT id, geo, pn, description, description_es FROM products WHERE geo = ? LIMIT 1', [item.geo]);
          if (!product) continue;

          await exec(db, `
            INSERT INTO requisition_items (
              requisition_id, product_id, quantity_requested, notes,
              geo, pn, description_es, item_notes, supplier_notes, images, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
          `, [
            requisitionId,
            product.id,
            Number(item.qty) || 0,
            item.itemNotes || '',
            product.geo,
            item.pn || product.pn || '',
            item.es || product.description_es || '',
            item.itemNotes || '',
            item.supplierNotes || '',
            Array.isArray(item.images) ? JSON.stringify(item.images) : (item.images || '')
          ]);
        }

        // Gate email sending on the DB feature flag (parity with GAS config sheet).
        // Defaults to disabled when the row is missing.
        const reqEmailRow = await queryOne(db, "SELECT value FROM config WHERE key = 'reqEmailEnabled' LIMIT 1");
        const isReqEmailEnabled = reqEmailRow ? String(reqEmailRow.value).toLowerCase() === 'true' : false;

        let emailResult;
        if (!isReqEmailEnabled) {
          emailResult = { emailSent: false, emailError: 'Requisition email delivery is not enabled.' };
        } else {
          try {
            emailResult = await sendRequirementEmail(shipment, requisitionNo, authenticatedUser);
          } catch (error) {
            emailResult = { emailSent: false, emailError: error.message };
          }
        }
        results.push({
          orderId: requisitionNo,
          pdfUrl: '',
          ...emailResult
        });
      }

      return {
        success: true,
        data: results,
        emailConfigured: results.some((result) => result.emailSent === true),
        message: 'Requirements saved.'
      };
    }

    const orderIds = args[0] || [];
    let processed = 0;
    for (const oid of orderIds) {
      const items = await queryAll(db, `SELECT ri.id, ri.product_id, ri.quantity_requested, p.geo FROM requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ? AND ri.status = 'pending'`, [oid]);
      for (const it of items) {
        await exec(db, `INSERT INTO inventory_movements (movement_id, type, movement_timestamp, item_id, geo, quantity, qty, requisition_id, performed_by) VALUES (?, 'ISSUE', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)`, [uuidv4(), it.product_id, it.geo, it.quantity_requested, it.quantity_requested, oid, 'system']);
        await exec(db, `UPDATE requisition_items SET status = 'issued' WHERE id = ?`, [it.id]);
        processed++;
      }
    }
    return { success: true, processed };
  },

  // Background jobs (replaces CacheService / script properties).
  // BackgroundJobsGS.bgEnqueueJob(type, refId, title, userEmail)
  bgEnqueueJob: async (db, args) => {
    const [type, refId, title, userEmail] = args;
    const prefix = type === 'QUOTE' ? 'Q-' : 'REQ-';
    const jobId = prefix
      + String(refId || 'x').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)
      + '-' + Date.now().toString(36)
      + '-' + Math.floor(Math.random() * 1296).toString(36);

    await exec(db, `
      INSERT INTO background_jobs (job_id, job_type, ref_id, title, status, progress, step, created_by)
      VALUES (?, ?, ?, ?, 'RUNNING', 5, ?, ?)
    `, [jobId, type || 'REQ', String(refId || ''), String(title || (type + ' ' + refId)),
      'Sheet saved - finishing in background...', String(userEmail || '')]);

    return { jobId, job: { jobId, type, refId: String(refId || ''), title: String(title || ''), status: 'RUNNING', progress: 5, step: 'Sheet saved - finishing in background...', createdBy: String(userEmail || ''), pdfUrl: '', emailSent: null, error: '' } };
  },

  // BackgroundJobsGS.bgFinishJob(jobId, success, extra)
  bgFinishJob: async (db, args) => {
    const [jobId, success, extra] = args;
    const e = extra || {};
    const status = success ? 'DONE' : 'ERROR';
    const progress = success ? 100 : 50;
    const step = e.step || (success ? 'Done' : 'Failed');

    await exec(db, `
      UPDATE background_jobs
      SET status = ?, progress = ?, step = ?, pdf_url = COALESCE(?, pdf_url),
          email_sent = COALESCE(?, email_sent), error_message = COALESCE(?, error_message),
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `, [status, progress, step,
      e.pdfUrl === undefined ? null : e.pdfUrl,
      e.emailSent === undefined ? null : (e.emailSent ? 1 : 0),
      e.error === undefined ? null : String(e.error || ''),
      String(jobId || '')]);

    return { jobId, status, progress, step };
  },

  // BackgroundJobsGS.bgGetJobs(jobIds) — poll endpoint for the bubble.
  bgGetJobs: async (db, args) => {
    const jobIds = Array.isArray(args[0]) ? args[0] : [];
    if (!jobIds.length) return [];
    const placeholders = jobIds.map(() => '?').join(',');
    const rows = await queryAll(db, `
      SELECT job_id, job_type, ref_id, title, status, progress, step, pdf_url,
             email_sent, error_message, created_by, created_at, updated_at
      FROM background_jobs
      WHERE job_id IN (${placeholders})
    `, jobIds);

    const byId = {};
    (rows || []).forEach((r) => { byId[r.job_id] = r; });

    return jobIds.map((id) => {
      const r = byId[id];
      if (!r) return { jobId: id, status: 'UNKNOWN', progress: 0, step: 'Expired or unknown job' };
      return {
        jobId: r.job_id,
        type: r.job_type || '',
        refId: r.ref_id || '',
        title: r.title || '',
        status: r.status || 'RUNNING',
        progress: Number(r.progress) || 0,
        step: r.step || '',
        pdfUrl: r.pdf_url || '',
        emailSent: r.email_sent === null ? null : !!Number(r.email_sent),
        error: r.error_message || '',
        createdBy: r.created_by || '',
        createdAt: r.created_at || '',
        updatedAt: r.updated_at || ''
      };
    });
  },

  // InvMovGS.bulkIssueItems(payload) — issue items to a person.
  // GAS payload: {items:[{geo, qty}], person, sector, maquina, generador,
  //               vehiculo, comments, condition, userSite, isHSE, hseItems}
  // Negative qty lines are returns (credited back to stock).
  bulkIssueItems: async (db, args) => {
    const payload = args[0] || {};
    const items = payload.items || [];
    const condition = payload.condition || 'Consumable';
    const movementId = 'MOV-' + Date.now();
    const site = payload.userSite || '';
    const ts = new Date().toISOString();

    let issued = 0;
    let returned = 0;

    for (const it of items) {
      const qty = Number(it.qty) || 0;
      if (!it.geo || qty === 0) continue;

      if (qty > 0) {
        issued++;
        await exec(db, `
          INSERT INTO inventory_movements
            (movement_id, type, movement_timestamp, geo, quantity, qty, person, sector,
             maquina, generador, vehiculo, condition, comments, site, performed_by)
          VALUES (?, 'ISSUE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [movementId, ts, it.geo, qty, qty, payload.person || '', payload.sector || '',
          payload.maquina || '', payload.generador || '', payload.vehiculo || '',
          condition, payload.comments || '', site, payload.person || 'System']);

        // Item status → IN_USE
        await exec(db, `UPDATE item_status SET status = 'IN_USE', person = ?, sector = ?, condition = ? WHERE geo = ?`,
          [payload.person || '', payload.sector || '', condition, it.geo]);
      } else {
        // Negative qty = return: credit the item back to stock.
        const returnQty = Math.abs(qty);
        returned++;
        await exec(db, `
          INSERT INTO inventory_movements
            (movement_id, type, movement_timestamp, geo, quantity, qty, person, sector,
             maquina, generador, vehiculo, condition, comments, site, performed_by)
          VALUES (?, 'RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Good', ?, ?, ?)
        `, [movementId, ts, it.geo, returnQty, returnQty, payload.person || '',
          payload.sector || '', payload.maquina || '', payload.generador || '',
          payload.vehiculo || '', '[Exchange/Return via Issue] ' + (payload.comments || ''),
          site, payload.person || 'System']);

        await exec(db, `UPDATE item_status SET status = 'IN_STORE', person = '', sector = 'STORE', condition = 'Good' WHERE geo = ?`, [it.geo]);
      }
    }

    // HSE signature queue (PDF generation is handled by the background job).
    if (payload.isHSE && Array.isArray(payload.hseItems) && payload.hseItems.length > 0) {
      await exec(db, `
        INSERT INTO hse_signatures
          (movement_id, worker_id, worker_name, fingerprint_base64, match_score, match_timestamp, items_count, items_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `, [
        movementId,
        payload.personId || 'N/A',
        payload.person || 'UNKNOWN',
        payload.fingerprintBase64 || '',
        payload.matchScore || 0,
        ts,
        payload.hseItems.length,
        JSON.stringify(payload.hseItems)
      ]);
    }

    return {
      success: true,
      message: issued > 0
        ? ('Bulk issue completed' + (returned > 0 ? ` (${returned} item(s) added back)` : ''))
        : `Return via issue completed (${returned} item(s) added back)`,
      movementId
    };
  },

  // InvMovGS.bulkReturnItems(payload) — return items to stock.
  bulkReturnItems: async (db, args) => {
    const payload = args[0] || {};
    const items = payload.items || [];
    const movementId = 'MOV-' + Date.now();
    const site = payload.userSite || '';
    const ts = new Date().toISOString();

    for (const it of items) {
      const qty = Math.abs(Number(it.qty) || 0);
      if (!it.geo || qty === 0) continue;

      await exec(db, `
        INSERT INTO inventory_movements
          (movement_id, type, movement_timestamp, geo, quantity, qty, person, sector,
           maquina, generador, vehiculo, condition, comments, site, performed_by)
        VALUES (?, 'RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Good', ?, ?, ?)
      `, [movementId, ts, it.geo, qty, qty, payload.person || '', payload.sector || '',
        payload.maquina || '', payload.generador || '', payload.vehiculo || '',
        payload.comments || '', site, payload.person || 'System']);

      await exec(db, `UPDATE item_status SET status = 'IN_STORE', person = '', sector = 'STORE', condition = 'Good' WHERE geo = ?`, [it.geo]);
    }

    return { success: true, message: 'Bulk return completed', movementId };
  },

  // InvMovGS.bulkSavePeople(payloadArray, mode) — bulk import of people.
  // mode: 'append' (default) or 'upsert' (match on RUT).
  bulkSavePeople: async (db, args) => {
    const people = args[0] || [];
    const mode = args[1] || 'append';
    if (!Array.isArray(people) || people.length === 0) {
      return { success: false, message: 'No person entries found.' };
    }

    let created = 0;
    let updated = 0;
    const summary = [];

    for (const p of people) {
      const active = p.active === true || p.active === 1 || p.active === 'TRUE' ? 1 : 0;
      const rut = String(p.rut || '').trim();
      let targetId = p.id ? String(p.id) : null;

      // In upsert mode an existing RUT wins over a new row.
      if (mode === 'upsert' && rut) {
        const match = await queryOne(db, `SELECT id FROM people WHERE rut = ? LIMIT 1`, [rut]);
        if (match) targetId = match.id;
      } else if (rut) {
        const match = await queryOne(db, `SELECT id FROM people WHERE rut = ? LIMIT 1`, [rut]);
        if (match && !targetId) targetId = match.id;
      }

      if (targetId) {
        const r = await exec(db, `
          UPDATE people SET name = ?, department = ?, active = ?, sector = ?,
                            notes = ?, biometric_template = ?, email = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [p.name || '', p.department || '', active, p.sector || '', p.notes || '',
        p.biometricTemplate || '', p.email || '', targetId]);
        if ((r && r.meta && r.meta.changes) > 0) {
          updated++;
          summary.push(`✓ ${p.name || rut} updated`);
        }
      } else {
        const id = 'RD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        await exec(db, `
          INSERT INTO people (id, name, department, active, sector, notes, rut, biometric_template, email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, p.name || '', p.department || '', active, p.sector || '', p.notes || '',
          rut, p.biometricTemplate || '', p.email || '']);
        created++;
        summary.push(`✓ ${p.name || rut} created`);
      }
    }

    return {
      success: true,
      message: `${created} created, ${updated} updated`,
      created,
      updated,
      details: summary
    };
  },

  // Delete draft requisitions.
  // Delete draft requisitions.
  deleteDraftRows: async (db, args) => {
    const raw = args[0];
    const ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    let count = 0;
    for (const id of ids) {
      const draft = await queryOne(db, `SELECT id FROM requisitions WHERE (id = ? OR requisition_no = ?) AND status = 'draft'`, [id, id]);
      if (draft) {
        await exec(db, `DELETE FROM requisition_items WHERE requisition_id = ?`, [draft.id]);
        await exec(db, `DELETE FROM requisitions WHERE id = ?`, [draft.id]);
        count++;
      }
    }
    return { success: true, count };
  },

  // Get draft requisitions.
  // Get draft requisitions in the shape CreateReqJS expects.
  getDrafts: async (db) => {
    const draftRows = await queryAll(db, `
      SELECT r.id, r.requisition_no, r.site_id, r.site, r.requested_by, r.priority,
             r.notes, r.status, r.created_at, r.updated_at, r.category,
             r.sub_area, r.sub_area_no, r.emails,
             s.name AS site_name
      FROM requisitions r
      LEFT JOIN sites s ON s.id = r.site_id
      WHERE r.status = 'draft' OR r.requisition_no LIKE 'DRAFT-%'
      ORDER BY r.created_at DESC
    `);

    const result = [];
    for (const d of draftRows) {
      const items = await queryAll(db, `
        SELECT ri.id, ri.quantity_requested AS qty, ri.item_notes, ri.supplier_notes,
               ri.images, ri.geo, ri.pn, ri.description_es AS desc, ri.description_es AS es,
               p.name AS product_name, p.description AS product_desc
        FROM requisition_items ri
        LEFT JOIN products p ON p.id = ri.product_id
        WHERE ri.requisition_id = ?
        ORDER BY ri.id ASC
      `, [d.id]);

      result.push({
        draftId: d.requisition_no || d.id,
        id: d.id,
        fecha: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
        site: d.site || d.site_name || '',
        user: d.requested_by || '',
        category: d.category || 'General',
        subArea: d.sub_area || '',
        subAreaNo: d.sub_area_no || '',
        emails: d.emails || '',
        notes: d.notes || '',
        items: (items || []).map(it => {
          let imgs = it.images;
          if (typeof imgs === 'string' && imgs.startsWith('[')) {
            try { imgs = JSON.parse(imgs); } catch (e) { }
          }
          return {
            pn: it.pn || '',
            geo: it.geo || '',
            desc: it.desc || it.product_desc || it.product_name || '',
            es: it.es || it.desc || it.product_desc || it.product_name || '',
            qty: Number(it.qty) || 0,
            itemNotes: it.item_notes || '',
            supplierNotes: it.supplier_notes || '',
            images: imgs || ''
          };
        })
      });
    }
    return result;
  },

  // Import min/max levels from array of rows.
  importMinMaxExcel: async (db, args) => {
    const rows = args[0] || [];
    let count = 0;
    for (const r of rows) {
      await exec(db, `INSERT INTO min_max (site, geo_code, min_qty, max_qty, updated_by) VALUES (?, ?, ?, ?, ?)`, [r.site, r.geo, r.min, r.max, r.updatedBy || 'system']);
      count++;
    }
    return { success: true, count };
  },

  // Org hierarchy from users + sites.
  opSphere_getHierarchy: async (db) => {
    const sites = await queryAll(db, `SELECT id, name, code FROM sites WHERE active = 1 ORDER BY name`);
    const people = await queryAll(db, `SELECT id, email, name, position, site, role, is_active FROM users WHERE is_active = 1 ORDER BY name`);
    return { sites, people };
  },

  // Bulk save assignments as ISSUE movements.
  saveBulkAssignments: async (db, args) => {
    const assignments = args[0] || [];
    let processed = 0;
    for (const a of assignments) {
      await exec(db, `INSERT INTO inventory_movements (movement_id, type, movement_timestamp, item_id, geo, quantity, qty, person, sector, performed_by) VALUES (?, 'ISSUE', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), a.itemId, a.geo, a.qty, a.qty, a.person || '', a.sector || '', a.performedBy || 'system']);
      processed++;
    }
    return { success: true, processed };
  },

  // CreateReqGS.uploadRequirementItemImages - saves uploaded photos to local uploads/images directory
  uploadRequirementItemImages: async (db, args) => {
    const payload = args[0] || {};
    if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
      return { success: false, error: 'No file content provided.' };
    }

    const uploadsBase = path.join(__dirname, '..', '..', 'uploads', 'images');
    const siteSanitized = String(payload.site || 'General').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const targetDir = path.join(uploadsBase, siteSanitized);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const stamp = Date.now();
    const urls = [];

    for (let i = 0; i < payload.files.length; i++) {
      const f = payload.files[i];
      if (!f || !f.base64) continue;

      let raw = String(f.base64 || '');
      const commaAt = raw.indexOf(',');
      if (raw.indexOf('data:') === 0 && commaAt !== -1) {
        raw = raw.substring(commaAt + 1);
      }
      if (!raw) continue;

      const mime = String(f.mimeType || 'image/jpeg').toLowerCase();
      const ext = mime.indexOf('png') !== -1 ? '.png' : (mime.indexOf('webp') !== -1 ? '.webp' : '.jpg');
      const baseName = String(f.name || 'image').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'image';
      const fileName = `${baseName}_${stamp}_${i + 1}${ext}`;
      const filePath = path.join(targetDir, fileName);

      fs.writeFileSync(filePath, Buffer.from(raw, 'base64'));

      // Serve path matching /uploads/images/<site>/<filename>
      const publicUrl = `/uploads/images/${siteSanitized}/${fileName}`;
      urls.push(publicUrl);
    }

    if (!urls.length) {
      return { success: false, error: 'No readable image content was provided.' };
    }

    return { success: true, urls };
  },

  // CreateReqGS.saveDraft(shipments) — save a draft requisition.
  // Re-saving the same requisition_no updates the existing draft.


  // CreateReqGS.saveDraft(shipments) — save draft requisition(s).
  saveDraft: async (db, args) => {
    const raw = args[0];
    const shipments = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!shipments.length) return { success: false, message: 'No shipments provided' };

    const timestamp = Date.now();
    const results = [];

    for (let idx = 0; idx < shipments.length; idx++) {
      const shipment = shipments[idx];
      const items = Array.isArray(shipment.items) ? shipment.items : [];
      const draftId = shipment.draftId || shipment.requisition_no || shipment.requisitionNo || `DRAFT-${timestamp}${shipments.length > 1 ? '-' + (idx + 1) : ''}`;

      const site = String(shipment.site || '').trim();
      const siteRow = site
        ? await queryOne(db, 'SELECT id, name FROM sites WHERE lower(name) = lower(?) OR lower(site_id) = lower(?) LIMIT 1', [site, site])
        : null;

      let reqId = shipment.id;
      const existing = await queryOne(db, 'SELECT id FROM requisitions WHERE requisition_no = ? OR id = ? LIMIT 1', [draftId, reqId || '']);
      if (existing) {
        reqId = existing.id;
        await exec(db, `
          UPDATE requisitions
          SET site_id = ?, site = ?, requested_by = ?, notes = ?, category = ?,
              sub_area = ?, sub_area_no = ?, emails = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          siteRow ? siteRow.id : null,
          siteRow ? siteRow.name : site,
          shipment.userName || shipment.currentUserEmail || '',
          shipment.body || shipment.notes || '',
          shipment.category || 'General',
          shipment.subArea || '',
          shipment.subAreaNumber || shipment.subAreaNo || '',
          shipment.to || shipment.emails || '',
          reqId
        ]);
        await exec(db, 'DELETE FROM requisition_items WHERE requisition_id = ?', [reqId]);
      } else {
        reqId = reqId || uuidv4();
        await exec(db, `
          INSERT INTO requisitions (
            id, requisition_no, site_id, site, requested_by, notes, status, category,
            sub_area, sub_area_no, emails
          )
          VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
        `, [
          reqId,
          draftId,
          siteRow ? siteRow.id : null,
          siteRow ? siteRow.name : site,
          shipment.userName || shipment.currentUserEmail || '',
          shipment.body || shipment.notes || '',
          shipment.category || 'General',
          shipment.subArea || '',
          shipment.subAreaNumber || shipment.subAreaNo || '',
          shipment.to || shipment.emails || ''
        ]);
      }

      for (const item of items) {
        const product = await queryOne(db, 'SELECT id, geo, pn, description, description_es FROM products WHERE geo = ? LIMIT 1', [item.geo]);
        await exec(db, `
          INSERT INTO requisition_items (
            requisition_id, product_id, quantity_requested, notes,
            geo, pn, description_es, item_notes, supplier_notes, images, status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `, [
          reqId,
          product ? product.id : null,
          Number(item.qty) || 0,
          item.itemNotes || '',
          item.geo || (product ? product.geo : ''),
          item.pn || (product ? product.pn : ''),
          item.es || (product ? product.description_es : (item.desc || '')),
          item.itemNotes || '',
          item.supplierNotes || '',
          Array.isArray(item.images) ? JSON.stringify(item.images) : (item.images || '')
        ]);
      }

      results.push({ draftId, id: reqId });
    }

    return { success: true, drafts: results };
  },

  // Import min/max (alias with alternate field names).
  saveMinMaxImport: async (db, args) => {
    const rows = args[0] || [];
    let count = 0;
    for (const r of rows) {
      await exec(db, `INSERT INTO min_max (site, geo_code, min_qty, max_qty, updated_by) VALUES (?, ?, ?, ?, ?)`, [r.site, r.geo_code || r.geo, r.min_qty || r.min, r.max_qty || r.max, r.updated_by || 'system']);
      count++;
    }
    return { success: true, count };
  },

  // Update quote with items (create/update quote_items).
  // Frontend field names: qty, price, es, total, supplierQuoteNo, quotedDocUrl,
  // clearQuotedDoc, status, deleted, approvedQty. Map to DB columns: quantity, unit_price,
  // description_es, total_price, supplier_quote_no, quoted_doc_url, status, approved_qty.
  updateQuoteWithItems: async (db, args) => {
    const q = args[0] || {};
    const items = q.items || [];
    console.log('[updateQuoteWithItems] Received q:', JSON.stringify({
      orderId: q.orderId,
      quoteId: q.quoteId,
      id: q.id,
      quoteNo: q.quoteNo,
      status: q.status,
      quotedDocUrl: q.quotedDocUrl,
      itemsCount: items.length
    }));
    if (items.length > 0) {
      console.log('[updateQuoteWithItems] First item sample:', JSON.stringify({
        quoteId: items[0].quoteId,
        geo: items[0].geo,
        pn: items[0].pn,
        status: items[0].status,
        deleted: items[0].deleted,
        price: items[0].price,
        qty: items[0].qty,
        approvedQty: items[0].approvedQty
      }));
    }

    // Helper to resolve quote uuid from id or quote_no
    async function resolveQuoteUuid(rawId) {
      if (!rawId) return null;
      const r = await queryOne(db, 'SELECT id FROM quotes WHERE id = ? OR quote_no = ? LIMIT 1', [rawId, rawId]);
      return r ? r.id : null;
    }

    let defaultQuoteId = q.quoteId || q.id || null;
    if (!defaultQuoteId && items.length > 0) {
      defaultQuoteId = items[0].quoteId || items[0].quote_id || null;
    }

    let quoteId = await resolveQuoteUuid(defaultQuoteId);
    const quoteNo = q.quoteNo || '';

    // If no quote row found by ID, try looking up by orderId + supplier
    if (!quoteId && (q.orderId || (items[0] && items[0].orderId))) {
      const orderId = q.orderId || (items[0] && items[0].orderId) || '';
      const supplier = q.supplier || (items[0] && items[0].supplier) || '';
      if (orderId && supplier) {
        const existingQuote = await queryOne(db,
          'SELECT q.id FROM quotes q LEFT JOIN requisitions r ON q.requisition_id = r.id WHERE (r.requisition_no = ? OR q.ref_id = ? OR q.requisition_id = ?) AND LOWER(TRIM(q.supplier)) = LOWER(TRIM(?)) LIMIT 1',
          [orderId, orderId, orderId, supplier]
        );
        if (existingQuote) {
          quoteId = existingQuote.id;
          console.log('[updateQuoteWithItems] Resolved quote row by orderId + supplier:', quoteId);
        }
      }
    }

    // If no quote row exists yet, create one
    if (!quoteId) {
      console.log('[updateQuoteWithItems] Creating new quote row');
      const newId = 'quo-' + uuidv4();
      const orderId = q.orderId || '';
      const supplier = q.supplier || (items[0] && items[0].supplier) || '';
      const category = q.category || (items[0] && items[0].category) || '';
      const reqRow = orderId
        ? await queryOne(db, 'SELECT id FROM requisitions WHERE requisition_no = ? OR id = ? LIMIT 1', [orderId, orderId])
        : null;
      const reqId = reqRow ? reqRow.id : null;
      await exec(db, "INSERT INTO quotes (id, quote_no, requisition_id, ref_id, supplier, category, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [newId, quoteNo || newId, reqId, orderId || null, supplier, category, q.createdBy || 'system']);
      quoteId = newId;
      console.log('[updateQuoteWithItems] Created quote row with id:', quoteId);
    }

    const affectedQuoteIds = new Set();
    if (quoteId) affectedQuoteIds.add(quoteId);

    // Upsert / update each item
    for (const it of items) {
      const isDeleted = Boolean(it.deleted || it.status === 'Deleted');
      const itemStatus = isDeleted ? 'Deleted' : (it.status || 'Pending');

      let itQuoteId = quoteId;
      if (it.quoteId) {
        const resolved = await resolveQuoteUuid(it.quoteId);
        if (resolved) itQuoteId = resolved;
      }
      affectedQuoteIds.add(itQuoteId);

      const itemGeo = it.origGeo || it.geo || '';
      const itemPn = it.origPn || it.pn || '';

      // Find existing item
      let existing = null;
      if (it.id) {
        existing = await queryOne(db, 'SELECT id, supplier_quote_no, quoted_doc_url, status, approved_qty, quantity, unit_price FROM quote_items WHERE id = ? LIMIT 1', [it.id]);
      }
      if (!existing && itemGeo) {
        existing = await queryOne(db, 'SELECT id, supplier_quote_no, quoted_doc_url, status, approved_qty, quantity, unit_price FROM quote_items WHERE quote_id = ? AND geo = ? LIMIT 1', [itQuoteId, itemGeo]);
      }
      if (!existing && itemPn) {
        existing = await queryOne(db, 'SELECT id, supplier_quote_no, quoted_doc_url, status, approved_qty, quantity, unit_price FROM quote_items WHERE quote_id = ? AND pn = ? LIMIT 1', [itQuoteId, itemPn]);
      }

      const quantity = (it.qty !== undefined && it.qty !== null) ? Number(it.qty)
        : (it.quantity !== undefined && it.quantity !== null) ? Number(it.quantity)
          : (existing ? Number(existing.quantity || 0) : 0);

      const unitPrice = (it.price !== undefined && it.price !== null) ? Number(it.price)
        : (it.unit_price !== undefined && it.unit_price !== null) ? Number(it.unit_price)
          : (existing ? Number(existing.unit_price || 0) : 0);

      const itemTotal = quantity * unitPrice;

      let approvedQty = 0;
      if (it.approvedQty !== undefined && it.approvedQty !== null) {
        approvedQty = Number(it.approvedQty) || 0;
      } else if (itemStatus === 'Approved') {
        approvedQty = quantity;
      } else if (existing && existing.approved_qty !== undefined && existing.approved_qty !== null && !isDeleted) {
        approvedQty = Number(existing.approved_qty) || 0;
      }

      const itemSupplierQuoteNo = it.supplierQuoteNo !== undefined ? it.supplierQuoteNo : null;
      const itemDocUrl = it.clearQuotedDoc ? '' : (it.quotedDocUrl !== undefined ? it.quotedDocUrl : null);

      if (existing) {
        await exec(db, `UPDATE quote_items SET
          quantity = ?,
          unit_price = ?,
          total_price = ?,
          geo = CASE WHEN ? != '' THEN ? ELSE geo END,
          pn = CASE WHEN ? != '' THEN ? ELSE pn END,
          description_es = COALESCE(?, description_es),
          description_en = COALESCE(?, description_en),
          supplier = COALESCE(?, supplier),
          category = COALESCE(?, category),
          status = ?,
          approved_qty = ?,
          supplier_quote_no = COALESCE(?, supplier_quote_no),
          quoted_doc_url = CASE WHEN ? = 1 THEN '' ELSE COALESCE(?, quoted_doc_url) END
        WHERE id = ?`,
          [
            quantity,
            unitPrice,
            itemTotal,
            it.geo || '', it.geo || '',
            it.pn || '', it.pn || '',
            it.es || it.description_es || null,
            it.description_en || null,
            it.supplier || null,
            it.category || null,
            itemStatus,
            approvedQty,
            itemSupplierQuoteNo,
            it.clearQuotedDoc ? 1 : 0,
            itemDocUrl,
            existing.id
          ]
        );
      } else {
        await exec(db, 'INSERT INTO quote_items (quote_id, product_id, quantity, unit_price, total_price, geo, pn, description_es, description_en, supplier, category, status, approved_qty, supplier_quote_no, quoted_doc_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            itQuoteId,
            it.product_id || null,
            quantity,
            unitPrice,
            itemTotal,
            it.geo || '',
            it.pn || '',
            it.es || it.description_es || '',
            it.description_en || '',
            it.supplier || '',
            it.category || '',
            itemStatus,
            approvedQty,
            itemSupplierQuoteNo,
            itemDocUrl
          ]
        );
      }
    }

    // Recalculate quote totals and status for each affected quote
    let finalTotal = 0;
    const quotedDocUrl = q.quotedDocUrl || '';
    const supplierQuoteNo = q.supplierQuoteNo || (items.find(it => it.supplierQuoteNo) || {}).supplierQuoteNo || null;

    for (const qId of affectedQuoteIds) {
      const qItems = await queryAll(db, 'SELECT status, total_price FROM quote_items WHERE quote_id = ?', [qId]);
      const activeTotal = qItems
        .filter(item => item.status !== 'Deleted')
        .reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);

      if (qId === quoteId) {
        finalTotal = activeTotal;
      }

      // Compute dominant status
      let newStatus = q.status;
      if (!newStatus || newStatus === 'Pending') {
        if (qItems.length > 0 && qItems.every(item => item.status === 'Deleted')) {
          newStatus = 'Deleted';
        } else if (qItems.some(item => ['Approved', 'Sent', 'Received', 'Despatched', 'Final Received'].includes(item.status))) {
          newStatus = 'Approved';
        } else if (qItems.some(item => item.status === 'Quoted')) {
          newStatus = 'Quoted';
        } else if (qItems.length > 0 && qItems.every(item => item.status === 'Not Quoted')) {
          newStatus = 'Not Quoted';
        } else {
          newStatus = 'Pending';
        }
      }

      await exec(db, 'UPDATE quotes SET status = ?, subtotal = ?, total = ?, ref_cotiz = COALESCE(?, ref_cotiz), quoted_doc_url = COALESCE(?, quoted_doc_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newStatus, activeTotal, activeTotal, supplierQuoteNo, quotedDocUrl || null, qId]);
    }

    // Finish background job if called via bgFireAndForget
    const jobId = q._jobId || args[1];
    if (jobId) {
      await IMPLEMENTED.bgFinishJob(db, [jobId, true, { step: 'Done', progress: 100 }]);
    }

    return { success: true, total: finalTotal };
  },

  // Update validation items and system feature flags.
  updateValidationItem: async (db, args) => {
    const [type, oldIdentifier, newData] = args;
    if (type === 'SystemConfig') {
      const aliases = {
        reqEmailEnabled: 'reqEmailEnabled',
        reqPdfEnabled: 'reqPdfEnabled',
        quoEmailEnabled: 'quoEmailEnabled',
        quoPdfEnabled: 'quoPdfEnabled',
        quoteEmailPending: 'quoteEmailPending',
        quoteEmailQuoted: 'quoteEmailQuoted',
        quoteEmailApproved: 'quoteEmailApproved',
        quoteEmailSent: 'quoteEmailSent',
        quoteEmailReceived: 'quoteEmailReceived',
        quoteEmailDespatched: 'quoteEmailDespatched',
        quoteEmailFinalReceived: 'quoteEmailFinalReceived'
      };
      const key = aliases[String(oldIdentifier || '').trim()];
      if (!key) return { success: false, message: 'Unknown system configuration flag.' };
      const normalizedStatus = String(newData && newData.status != null ? newData.status : '').trim().toLowerCase();
      const value = normalizedStatus === 'true' || normalizedStatus === '1' || normalizedStatus === 'yes'
        ? 'true'
        : 'false';
      await exec(db, `
        INSERT INTO config (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `, [key, value]);
      return { success: true, key, value };
    }

    if (type === 'Users') {
      const u = newData || {};
      const userId = String(u.userId || oldIdentifier || '').trim().replace(/[,\s]/g, '');
      const email = String(u.email || '').trim().toLowerCase();
      if (!userId || !email) return { success: false, message: 'User ID and email are required.' };

      const existing = await queryOne(db, 'SELECT id FROM users WHERE user_id = ? LIMIT 1', [String(oldIdentifier || userId).trim().replace(/[,\s]/g, '')]);
      if (!existing) return { success: false, message: 'User account not found.' };

      const emailOwner = await queryOne(db, 'SELECT id FROM users WHERE lower(trim(email)) = ? LIMIT 1', [email]);
      if (emailOwner && emailOwner.id !== existing.id) {
        return { success: false, message: 'Email is already assigned to another user.' };
      }

      const pin = String(u.pin || '').trim();
      const pinHash = pin && pin !== 'Protected' && pin !== 'Not set'
        ? bcrypt.hashSync(pin, 10)
        : null;
      const params = [
        userId, email, u.name || null, u.phone || null, u.position || null,
        u.site || null, u.role || 'operator', u.active === '0' || u.active === 0 ? 0 : 1,
        pinHash, existing.id
      ];
      await exec(db, `
        UPDATE users SET
          user_id = ?, email = ?, name = ?, phone = ?, position = ?, site = ?,
          role = ?, is_active = ?, pin_hash = COALESCE(?, pin_hash),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, params);
      return { success: true, userId };
    }

    const u = args[0] || {};
    await exec(db, `INSERT INTO item_status (geo, status, person, sector, condition) VALUES (?, ?, ?, ?, ?)`, [u.geo || '', u.status || 'pending', u.person || '', u.sector || '', u.condition || '']);
    return { success: true };
  },

  // Inventory movement history.
  getHistoryData: async (db, args) => {
    const limit = Math.max(parseInt(args[0]) || 100, 1);
    return queryAll(db, `SELECT movement_id, type, movement_timestamp, geo, quantity, qty, person, sector, condition, requisition_id, performed_by FROM inventory_movements ORDER BY movement_timestamp DESC LIMIT ?`, [limit]);
  },

  // Recreates InvMovGS.getAllDailyMovements(): full movement list, newest
  // first, with the exact GAS field names consumed by InvMovJS
  // (movementId, timestamp, dateStr, timeStr, itemGeo, type, qty, person,
  //  sector, maquina, generador, vehiculo, condition, comments, site,
  //  descEn, descEs, pdfLink).
  getAllDailyMovements: async (db) => {
    const rows = await queryAll(db, `
      SELECT m.movement_id, m.movement_timestamp, m.geo, m.type,
             COALESCE(m.qty, m.quantity, 0) AS q,
             m.person, m.sector, m.maquina, m.generador, m.vehiculo,
             m.condition, m.comments, m.site,
             p.description, p.description_es
      FROM inventory_movements m
      LEFT JOIN products p ON p.geo = m.geo
      ORDER BY m.movement_timestamp DESC
    `);

    // HSE PDF links: only DONE rows with a stored pdf_url.
    const hseRows = await queryAll(db, `
      SELECT movement_id, pdf_url FROM hse_signatures
      WHERE UPPER(status) = 'DONE' AND pdf_url IS NOT NULL AND pdf_url != ''
    `);
    const hseMap = {};
    hseRows.forEach((h) => { hseMap[String(h.movement_id).trim()] = h.pdf_url; });

    return rows.map((r) => {
      const raw = r.movement_timestamp;
      const d = raw ? new Date(String(raw).replace(' ', 'T')) : null;
      const iso = d && !isNaN(d.getTime()) ? d.toISOString() : null;

      return {
        movementId: String(r.movement_id || '').trim(),
        timestamp: iso ? iso.slice(0, 19) : '',
        dateStr: iso ? iso.slice(0, 10) : '',
        timeStr: iso ? iso.slice(11, 19) : '',
        itemGeo: String(r.geo || ''),
        type: String(r.type || '').toUpperCase(),
        qty: Number(r.q) || 0,
        person: String(r.person || ''),
        sector: String(r.sector || ''),
        maquina: String(r.maquina || ''),
        generador: String(r.generador || ''),
        vehiculo: String(r.vehiculo || ''),
        condition: String(r.condition || ''),
        comments: String(r.comments || ''),
        site: String(r.site || '').trim(),
        descEn: String(r.description || ''),
        descEs: String(r.description_es || ''),
        pdfLink: hseMap[String(r.movement_id || '').trim()] || ''
      };
    });
  },

  // Recreates StockGS.getFullStockData(): stock rows in the GAS shape
  // (ItemID, ProductName, LocationType, LocationID, Quantity, ReservedQty,
  //  AvailableQty, LastUpdated, UpdatedBy, RackId, SideCode, ShelfLevel),
  // enriched from item_location_map.
  getFullStockData: async (db) => {
    const rows = await queryAll(db, `
      SELECT st.item_id, p.geo, p.name AS product_name,
             st.location_type, st.location_id, st.quantity,
             st.reserved_qty, st.available_qty, st.last_updated,
             st.updated_by
      FROM stock st
      LEFT JOIN products p ON p.id = st.item_id
      WHERE st.is_active = 1
      ORDER BY p.geo
    `);

    const locRows = await queryAll(db, `
      SELECT location_id, rack_id, side_code, shelf_level, item_id
      FROM item_location_map
    `);

    return rows.map((r) => {
      // GAS matched the location map by LocationID + ItemID.
      const loc = locRows.find((l) =>
        String(l.location_id || '').toLowerCase() === String(r.location_id || '').toLowerCase() &&
        (String(l.item_id || '') === String(r.item_id || '') ||
          String(l.item_id || '') === String(r.geo || ''))
      ) || locRows.find((l) =>
        String(l.item_id || '') === String(r.item_id || '') ||
        String(l.item_id || '') === String(r.geo || '')
      );

      return {
        ItemID: r.geo || String(r.item_id || ''),
        ProductName: String(r.product_name || ''),
        LocationType: String(r.location_type || ''),
        LocationID: String(r.location_id || ''),
        Quantity: Number(r.quantity) || 0,
        ReservedQty: Number(r.reserved_qty) || 0,
        AvailableQty: Number(r.available_qty) || 0,
        LastUpdated: r.last_updated || '',
        UpdatedBy: String(r.updated_by || ''),
        RackId: loc ? (loc.rack_id || '') : '',
        SideCode: loc && loc.side_code ? String(loc.side_code) : null,
        ShelfLevel: loc ? (loc.shelf_level || '') : ''
      };
    });
  },

  // Recreates Código.js.getSiteData(): [{name, email, suffix}].
  getSiteData: async (db) => {
    const rows = await queryAll(db, `
      SELECT name, code AS suffix FROM sites
      WHERE active = 1 AND name IS NOT NULL AND TRIM(name) != ''
      ORDER BY name
    `);
    return rows.map((r) => ({
      name: String(r.name || '').trim(),
      email: '',
      suffix: String(r.suffix || '').trim()
    }));
  },

  // Recreates Código.js.getValidationData(): the reference "mega" object.
  getValidationData: async (db) => {
    const [categories, subCategories, brands, suppliers, sites, currencies, subAreas] = await Promise.all([
      queryAll(db, `SELECT name FROM categories WHERE active = 1 ORDER BY name`),
      queryAll(db, `SELECT sc.name, c.name AS parent FROM sub_categories sc LEFT JOIN categories c ON c.id = sc.category_id WHERE sc.active = 1 ORDER BY sc.name`),
      queryAll(db, `SELECT name FROM brands WHERE active = 1 ORDER BY name`),
      queryAll(db, `SELECT name, email FROM suppliers WHERE active = 1 ORDER BY name`),
      queryAll(db, `SELECT name, code FROM sites WHERE active = 1 ORDER BY name`),
      queryAll(db, `SELECT name, symbol FROM currencies WHERE active = 1 ORDER BY name`),
      queryAll(db, `SELECT name, email, site, suffix FROM sub_areas WHERE active = 1 ORDER BY name`)
    ]);

    return {
      categories: categories.map((c) => ({ name: c.name, email: '' })),
      subCategories: subCategories.map((s) => ({ name: s.name, parent: s.parent || '' })),
      brands: brands.map((b) => b.name),
      suppliers: suppliers.map((s) => ({ name: s.name, email: s.email || '' })),
      sites: sites.map((s) => ({ name: s.name, email: '', suffix: s.code || '' })),
      currencies: currencies.map((c) => ({ name: c.name, symbol: c.symbol || '' })),
      subAreas: subAreas.map((s) => ({
        name: s.name, email: s.email || '', site: s.site || 'Workshop', suffix: s.suffix || ''
      }))
    };
  },

  // Recreates OpSphereReactGS.opSphere_getRigDetails(country, site, rigId).
  // The Op_* sheets are not migrated, so the shape is preserved with empty
  // payloads — the OpSphere module degrades gracefully.
  opSphere_getRigDetails: async (db, args) => {
    const country = args[0] || '';
    const site = args[1] || '';
    const rigId = args[2] || '';

    return {
      rigId,
      country,
      site,
      status: 'unknown',
      operations: [],
      personnel: [],
      safety: { safetyScore: 100, incidents: 0, lastIncident: 'None' },
      cameras: [
        { id: 'cam1', name: 'Main Rig Floor', status: 'offline' },
        { id: 'cam2', name: 'Derrick Substructure', status: 'offline' },
        { id: 'cam3', name: 'Generator Bay', status: 'offline' }
      ]
    };
  },

  // Recreates Código.js.verifyUserLogin(userId, pin). The GAS version used
  // Session.getActiveUser() for a Google-email cross-check; in the JWT
  // world the caller is already authenticated and the PIN is compared
  // against the bcrypt hash stored in `users`.
  verifyUserLogin: async (db, args) => {
    const userId = args[0];
    const pin = args[1];

    const row = await queryOne(db, `SELECT * FROM users WHERE user_id = ?`, [String(userId == null ? '' : userId)]);

    if (!row) return { success: false, message: 'User ID not found.' };
    if (Number(row.is_active) !== 1) return { success: false, message: 'This account is inactive.' };

    const valid = await bcrypt.compare(String(pin == null ? '' : pin), row.pin_hash);
    if (!valid) return { success: false, message: 'Incorrect PIN.' };

    return {
      success: true,
      user: {
        name: row.name,
        email: row.email,
        phone: row.phone,
        position: row.position,
        site: row.site,
        role: row.role,
        signLink: row.sign_link
      }
    };
  },

  // Recreates Código.js.getModuleHtml(moduleName): served the GAS HTML
  // template. The ported frontend keeps the templates in frontend/modules/,
  // so the file is read from disk and returned as HTML text.
  getModuleHtml: async (db, args) => {
    const moduleName = String(args[0] || '');
    const fileName = moduleName.indexOf('Val') === 0 ? 'AdminVal' : moduleName;
    const modulesDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'modules');
    const resolved = path.resolve(modulesDir, `${fileName}.html`);

    // Guard against path traversal: the file must stay inside modules/.
    if (!resolved.startsWith(modulesDir + path.sep)) {
      return `<div style='color:red; padding:20px;'>Invalid module name: ${moduleName}</div>`;
    }

    if (!fs.existsSync(resolved)) {
      return `<div style='color:red; padding:20px; background:#fff1f1; border:1px solid red;'>` +
        `<h4>⚠️ Error in ${moduleName} or its Included Files</h4>` +
        `<p><b>Message:</b> Module not found</p></div>`;
    }

    return fs.readFileSync(resolved, 'utf-8');
  }
};

// ---------------------------------------------------------------------------
// uploadQuoteAttachment
// Saves the base64-encoded file to api/uploads/ and returns a local URL.
// In production (Cloudflare Worker) this should be replaced with an R2 upload.
// Payload: { orderId, quoteId, supplier, site, fileName, files: [{ name, mimeType, base64 }] }
// Returns: { success: true, url: '/uploads/<filename>', fileName: '<filename>' }
//          | { success: false, error: '<message>' }
// ---------------------------------------------------------------------------
IMPLEMENTED.uploadQuoteAttachment = async function (db, args) {
  try {
    const payload = (Array.isArray(args) ? args[0] : args) || {};

    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      return { success: false, error: 'No file content provided.' };
    }

    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Build a safe, unique base name from supplier + orderId + uuid
    const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 60);
    const baseName = [
      sanitize(payload.supplier || 'doc'),
      sanitize(payload.orderId || ''),
      uuidv4().slice(0, 8),
    ].filter(Boolean).join('_');

    const f = payload.files[0]; // client always sends a single file
    const mime = String(f.mimeType || '').toLowerCase();
    const ext = mime.includes('pdf') ? '.pdf'
      : mime.includes('image/') ? '.jpg'
        : (String(payload.fileName || '').match(/(\.[^.]+)$/) || ['', '.bin'])[1];

    const diskName = baseName + ext;
    const diskPath = path.join(uploadsDir, diskName);

    const buf = Buffer.from(String(f.base64 || ''), 'base64');
    if (buf.length === 0) {
      return { success: false, error: 'File data is empty after base64 decode.' };
    }
    fs.writeFileSync(diskPath, buf);

    // Persist URL to the quotes table if quoteId is provided
    const fileUrl = '/uploads/' + diskName;
    if (payload.quoteId) {
      try {
        await queryOne(db,
          `UPDATE quotes SET quoted_doc_url = ? WHERE id = ?`,
          [fileUrl, payload.quoteId]
        );
      } catch (_) { /* non-fatal — URL returned to client regardless */ }
    }

    console.log(`[uploadQuoteAttachment] saved ${diskName} (${buf.length} bytes)`);
    return { success: true, url: fileUrl, fileName: diskName };
  } catch (e) {
    console.error('[uploadQuoteAttachment] error:', e);
    return { success: false, error: String(e) };
  }
};
// Control Combustible functions
IMPLEMENTED.getFuelHistory = async (db) => {
  const rows = await queryAll(db, `
      SELECT entry_date, proyecto, tipo_activo, asset_id, liters,
             odometer_km, driver, user_email
      FROM fuel_entries
      ORDER BY entry_date DESC, id DESC
      LIMIT 1000
    `);
  return rows.map((r) => {
    let raw = String(r.entry_date || '').trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
    if (m) {
      raw = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}${m[4] || ''}`.trim();
    }
    const dateStr = raw.length > 16 ? raw.slice(0, 16) : raw;
    return [
      dateStr,
      r.proyecto || '',
      r.tipo_activo || '',
      r.asset_id || '',
      r.liters || 0,
      r.odometer_km || '',
      r.driver || '',
      r.user_email || ''
    ];
  });
},

  IMPLEMENTED.getFuelBalance = async (db) => {
    const bought = await queryOne(db, `
      SELECT COALESCE(SUM(litros), 0) AS total FROM fuel_purchases
    `);
    const used = await queryOne(db, `
      SELECT COALESCE(SUM(liters), 0) AS total FROM fuel_entries
    `);
    const totalBought = Number(bought && bought.total) || 0;
    const totalUsed = Number(used && used.total) || 0;
    return {
      balance: totalBought - totalUsed,
      totalBought,
      totalUsed
    };
  },

  IMPLEMENTED.getFuelPurchaseHistory = async (db) => {
    const rows = await queryAll(db, `
      SELECT purchase_date, proveedor, litros, factura, user_name
      FROM fuel_purchases
      ORDER BY purchase_date DESC, id DESC
      LIMIT 1000
    `);
    return rows.map((x) => {
      let raw = String(x.purchase_date || '').trim();
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
      if (m) {
        raw = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}${m[4] || ''}`.trim();
      }
      const fecha = raw.length > 16 ? raw.slice(0, 16) : raw;
      return {
        fecha,
        fechaISO: raw,
        fechaObj: x.purchase_date,
        proveedor: x.proveedor || '',
        litros: x.litros || 0,
        factura: x.factura || '',
        usuario: x.user_name || ''
      };
    });
  },

  IMPLEMENTED.getLastFuelEntry = async (db, args) => {
    const assetId = String((args && args[0]) || '').trim();
    if (!assetId) return { status: 'success', success: true, data: { lastKm: null }, lastKm: null };

    const row = await queryOne(db, `
      SELECT odometer_km FROM fuel_entries
      WHERE asset_id = ?
      ORDER BY entry_date DESC
      LIMIT 1
    `, [assetId]);

    const km = row ? Number(row.odometer_km) : null;
    return { status: 'success', success: true, data: { lastKm: km }, lastKm: km };
  },

  IMPLEMENTED.saveFuelEntry = async (db, args) => {
    const d = args[0] || {};
    const r = await exec(db, `
      INSERT INTO fuel_entries
        (entry_date, proyecto, tipo_activo, asset_id, liters, odometer_km, driver, user_email)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
    `, [
      d.proyecto || '', d.tipoActivo || '', d.assetId || '',
      Number(d.cantidadLitro) || 0, d.kilometraje ? Number(d.kilometraje) : null,
      d.nombre || '', d.userEmail || ''
    ]);
    const id = (r && r.meta && r.meta.last_row_id) || null;
    return { status: 'success', success: true, id, message: 'Registro guardado exitosamente' };
  },

  IMPLEMENTED.saveFuelPurchase = async (db, args) => {
    const d = args[0] || {};
    const r = await exec(db, `
      INSERT INTO fuel_purchases (purchase_date, proveedor, litros, factura, user_name)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `, [d.proveedor || '', Number(d.litros) || 0, d.factura || '', d.userName || '']);
    const id = (r && r.meta && r.meta.last_row_id) || null;
    return { status: 'success', success: true, id, message: 'Compra registrada exitosamente' };
  };

  IMPLEMENTED.processPendingHSEPDFs = async (db) => {
    const pendingRows = await queryAll(db, `
      SELECT id, movement_id, worker_id, worker_name, fingerprint_base64,
             match_score, match_timestamp, items_count, items_json
      FROM hse_signatures
      WHERE UPPER(status) = 'PENDING'
      ORDER BY id ASC
    `);

    if (!pendingRows || pendingRows.length === 0) {
      return { success: true, processed: 0 };
    }

    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    const hseDir = path.join(uploadsDir, 'hse');
    if (!fs.existsSync(hseDir)) {
      fs.mkdirSync(hseDir, { recursive: true });
    }

    let processed = 0;
    for (const row of pendingRows) {
      const movementId = String(row.movement_id || '').trim();
      const workerId = String(row.worker_id || 'N/A').trim();
      const workerName = String(row.worker_name || 'UNKNOWN').trim();
      const matchScore = Number(row.match_score) || 0;
      const matchTs = row.match_timestamp || new Date().toISOString();

      let hseItems = [];
      try {
        if (row.items_json) {
          hseItems = typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json;
        }
      } catch (err) {
        console.warn(`[processPendingHSEPDFs] Failed to parse items_json for ${movementId}:`, err);
      }

      // Mark row as PROCESSING
      await exec(db, `UPDATE hse_signatures SET status = 'PROCESSING' WHERE id = ?`, [row.id]);

      try {
        const fileName = `HSE_Receipt_${movementId.replace(/[^a-zA-Z0-9_\-]/g, '_')}_${Date.now()}.pdf`;
        const filePath = path.join(hseDir, fileName);
        const pdfUrl = `/uploads/hse/${fileName}`;

        if (!PDFDocument) {
          throw new Error('PDFDocument (pdfkit) library not loaded');
        }

        await new Promise((resolve, reject) => {
          const doc = new PDFDocument({ margin: 40, size: 'A4' });
          const stream = fs.createWriteStream(filePath);
          doc.pipe(stream);

          // Header
          doc.rect(40, 40, 515, 45).fill('#0066cc');
          doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
            .text('ENTREGA DE EPP', 40, 53, { align: 'center', width: 515 });

          // Subtitle / Info
          doc.moveDown(2);
          const startInfoY = 100;
          doc.rect(40, startInfoY, 515, 65).fillAndStroke('#f8f9fa', '#e9ecef');

          doc.fillColor('#333333').fontSize(9).font('Helvetica');
          doc.text(`ID Movimiento:`, 55, startInfoY + 10);
          doc.font('Helvetica-Bold').text(movementId, 135, startInfoY + 10);

          doc.font('Helvetica').text(`Fecha / Hora:`, 55, startInfoY + 25);
          doc.font('Helvetica-Bold').text(String(matchTs).replace('T', ' ').slice(0, 19), 135, startInfoY + 25);

          doc.font('Helvetica').text(`Empleado:`, 55, startInfoY + 40);
          doc.font('Helvetica-Bold').text(`${workerName} (${workerId})`, 135, startInfoY + 40);

          doc.font('Helvetica').text(`Puntaje Biométrico:`, 320, startInfoY + 10);
          const scoreColor = matchScore >= 60 ? '#27ae60' : '#c0392b';
          doc.fillColor(scoreColor).font('Helvetica-Bold').text(`${matchScore}/100 (${matchScore >= 60 ? 'VERIFICADO' : 'NO COINCIDE'})`, 425, startInfoY + 10);

          // Table Header
          let tableY = 180;
          doc.rect(40, tableY, 515, 22).fill('#0066cc');
          doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
          doc.text('No.', 45, tableY + 6, { width: 30, align: 'center' });
          doc.text('Código Producto (GEO)', 80, tableY + 6, { width: 130 });
          doc.text('Descripción', 215, tableY + 6, { width: 250 });
          doc.text('Cantidad', 470, tableY + 6, { width: 75, align: 'center' });

          // Table Rows
          tableY += 22;
          doc.fillColor('#333333').font('Helvetica');
          if (hseItems && hseItems.length > 0) {
            hseItems.forEach((item, idx) => {
              const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
              doc.rect(40, tableY, 515, 20).fillAndStroke(rowBg, '#dee2e6');
              doc.fillColor('#333333');
              doc.text(String(idx + 1), 45, tableY + 5, { width: 30, align: 'center' });
              doc.font('Helvetica-Bold').text(String(item.geo || ''), 80, tableY + 5, { width: 130 });
              doc.font('Helvetica').text(String(item.es || item.en || '-'), 215, tableY + 5, { width: 250, ellipsis: true });
              doc.font('Helvetica-Bold').text(String(item.qty || 0), 470, tableY + 5, { width: 75, align: 'center' });
              tableY += 20;
            });
          } else {
            doc.rect(40, tableY, 515, 20).fillAndStroke('#ffffff', '#dee2e6');
            doc.text('Sin ítems especificados', 45, tableY + 5, { align: 'center', width: 505 });
            tableY += 20;
          }

          // Fingerprint & Signature Block
          const sigY = Math.max(tableY + 25, 450);
          doc.rect(40, sigY, 515, 170).fillAndStroke('#ffffff', '#cccccc');

          doc.fillColor('#0066cc').fontSize(11).font('Helvetica-Bold')
            .text('FIRMA BIOMÉTRICA DE RECEPCIÓN', 40, sigY + 12, { align: 'center', width: 515 });

          // If fingerprint image base64 is present, draw image
          let imgDrawn = false;
          if (row.fingerprint_base64 && String(row.fingerprint_base64).length > 50) {
            try {
              let cleanBase64 = String(row.fingerprint_base64);
              const commaIdx = cleanBase64.indexOf(',');
              if (commaIdx !== -1) {
                cleanBase64 = cleanBase64.substring(commaIdx + 1);
              }
              const imgBuf = Buffer.from(cleanBase64, 'base64');
              doc.image(imgBuf, 252, sigY + 30, { fit: [90, 80], align: 'center' });
              imgDrawn = true;
            } catch (imgErr) {
              console.warn('[processPendingHSEPDFs] Could not embed fingerprint image:', imgErr.message);
            }
          }

          const workerTextY = imgDrawn ? sigY + 115 : sigY + 50;
          doc.fillColor('#333333').fontSize(9).font('Helvetica-Bold')
            .text(`Receptor: ${workerName}  |  RUT/ID: ${workerId}`, 40, workerTextY, { align: 'center', width: 515 });

          doc.fillColor('#666666').fontSize(8).font('Helvetica')
            .text('Por medio de mi huella digital, confirmo la recepción conforme de elementos de protección personal (EPP).', 40, workerTextY + 16, { align: 'center', width: 515 })
            .text('CONFORME LA LEY VIGENTE - Artículo 184 del Código del Trabajo, Ley N°16.744 y D.S. N°594.', 40, workerTextY + 28, { align: 'center', width: 515 });

          doc.end();
          stream.on('finish', resolve);
          stream.on('error', reject);
        });

        // Update database with pdf_url and status = DONE
        await exec(db, `
          UPDATE hse_signatures
          SET pdf_url = ?, status = 'DONE'
          WHERE id = ?
        `, [pdfUrl, row.id]);

        processed++;
        console.log(`[processPendingHSEPDFs] Successfully created PDF for movement ${movementId}: ${pdfUrl}`);
      } catch (err) {
        console.error(`[processPendingHSEPDFs] Failed for ${movementId}:`, err);
        await exec(db, `UPDATE hse_signatures SET status = 'ERROR' WHERE id = ?`, [row.id]);
      }
    }

    return { success: true, processed };
  };
// Names that are recognized but not implemented yet. The client receives
// Names that are recognized but not implemented yet. The client receives
// { __legacy: true } and degrades gracefully; unknown names get a 404.
//
// The remaining gaps all require an external integration that this API does
// not provide yet: Microsoft Graph / SendGrid email, Google Drive, R2 object
// storage, or PDF text extraction. They are listed here so the client gets a
// clean "not supported" signal instead of a 404.
const KNOWN_UNIMPLEMENTED = new Set([
  // Email / Microsoft Graph
  'dispatchEmailWithProvider', 'sendPoReminderEmail',
  'testMailReadWriteCapability', 'testSendEmailViaGraph',
  'testSendThreadReply', 'testSendThreadSeed', 'getUiLastReceivedEmail',
  // Drive / file export
  'master_ExportToDrive',
  // PDF / invoice import
  'extractInvoicePDFText', 'saveImportedInvoice',
  // Bulk PO compilation (Drive spreadsheet export)
  'processAndSaveBulkPO',
  // uploadQuoteAttachment is now implemented above
]);

router.post('/:fn', authenticateToken, async (req, res) => {
  const fn = req.params.fn;
  try {
    if (Object.prototype.hasOwnProperty.call(IMPLEMENTED, fn)) {
      const db = req.app.locals.db;
      const value = await IMPLEMENTED[fn](db, (req.body && req.body.args) || [], req.user);
      return res.json(value);
    }
    if (KNOWN_UNIMPLEMENTED.has(fn)) {
      console.warn(`[legacy] unimplemented GAS function called: ${fn}`);
      return res.json({ __legacy: true, fn });
    }
    console.warn(`[legacy] unknown GAS function called: ${fn}`);
    return res.status(404).json({ status: 'error', message: `Unknown server function: ${fn}` });
  } catch (err) {
    console.error(`[legacy] ${fn} error:`, err);
    res.status(500).json({ status: 'error', message: `Legacy function failed: ${fn}` });
  }
});

module.exports = router;
module.exports.IMPLEMENTED = IMPLEMENTED;
