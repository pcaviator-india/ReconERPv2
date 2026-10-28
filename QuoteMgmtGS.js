// =============================================
// QuoteMgmtGS.gs - Quote Management + Stock Integration
// =============================================

/**
 * 🔒 ISSUE-4 helper: finds a DIFFERENT supplier's live, approved-or-later row
 * for the same requirement + item as the row being approved right now.
 *
 * Column positions come from the caller's `col` resolver (same helper that
 * maps "Ref ID"/"Proveedor"/"Geo Code"/"P/N"/"Estado" for the main update),
 * because header layouts drift and re-scanning them here would fork the
 * mapping. Rows without either a GEO or a P/N carry no matchable identity
 * and are skipped rather than guessed, so blank-identity lines can never
 * produce a false lock.
 *
 * @param {Array} rows sheet rows (Quotes, data area)
 * @param {number} skipIndex row index of the line currently being saved (its
 *        own row must never block itself, including legacy duplicate rows)
 * @param {object} ctx {col: fn, orderId, supplier, geo, pn}
 * @return {{supplier:string, status:string}|null} the rival holder, if any
 */
function findApprovedRival_(rows, skipIndex, ctx) {
  try {
    const clean = function (v) { return String(v == null ? "" : v).trim(); };
    const colFn = ctx && ctx.col;
    if (typeof colFn !== "function") return null;
    const orderOf = clean(ctx.orderId);
    const supplierOf = clean(ctx.supplier).toLowerCase();
    const normGeo = clean(ctx.geo).toLowerCase();
    const normPn = clean(ctx.pn).toLowerCase();
    if (!orderOf && !normGeo && !normPn) return null;
    // A row whose own identity is entirely blank cannot be rival-checked
    // against anyone: skipping avoids cross-item false positives.
    if (!normGeo && !normPn) return null;
    const cOrder = colFn("Ref ID", "Ref Id", "RefID", "Ref");
    const cSupp = colFn("Proveedor", "Supplier");
    const cGeo = colFn("Geo Code", "Geo", "GeoCode");
    const cPn = colFn("P/N", "PN", "P N");
    const cStatus = colFn("Estado", "Status");
    if (cOrder === -1 || cSupp === -1 || cGeo === -1 || cPn === -1 || cStatus === -1) return null;
    for (let i = 0; i < (rows || []).length; i++) {
      if (i === skipIndex) continue;
      const r = rows[i];
      if (!r) continue;
      if (orderOf && clean(r[cOrder]) !== orderOf) continue;
      const rGeo = clean(r[cGeo]).toLowerCase();
      const rPn = clean(r[cPn]).toLowerCase();
      if (!rGeo && !rPn) continue;
      const keyHit = (normGeo && rGeo === normGeo) || (normPn && rPn === normPn);
      if (!keyHit) continue;
      if (clean(r[cSupp]).toLowerCase() === supplierOf) continue;
      const st = clean(r[cStatus]).toUpperCase();
      if (st === "DELETED") continue;
      if (QUOTE_APPROVED_OR_LATER_.indexOf(st) === -1) continue;
      return { supplier: clean(r[cSupp]) || "(unknown)", status: st };
    }
    return null;
  } catch (e) {
    console.warn("findApprovedRival_ failed safely (no block applied): " + e.toString());
    return null;
  }
}

/**
 * 🔒 VALIDATION RULE: Enforces forward-only status movement
 * Flow: Pending -> Quoted -> Approved -> Sent -> Received -> Despatched -> Final Received
 * Allows transition to "Deleted" from any status at any time.
 * "Not Quoted" is a side-branch off Pending (it never sits in the linear flow,
 * see the client twin in QuoteMgmtJS.html): Pending -> Not Quoted (supplier
 * never quoted the line), Not Quoted -> Pending (undo) / Not Quoted -> Quoted
 * (supplier quoted late). Everything else involving "Not Quoted" is blocked,
 * so it can never be used to go backwards out of Quoted or later.
 */
function isValidQuoteItemStatusProgression(oldStatus, newStatus) {
  // Compare case-insensitively: callers pass upper-cased statuses.
  const cleanNew = String(newStatus || "").trim().toLowerCase();
  const cleanOld = String(oldStatus || "").trim().toLowerCase();

  // 1. Allow items to be moved to "Deleted" from any valid status at any time for auditing/cleanup
  if (cleanNew === "deleted") {
    return true;
  }

  // Prevent moving out of deleted if someone tries to revive it backward improperly
  if (cleanOld === "deleted") {
    return false;
  }

  // 1b. "Not Quoted" side-branch: mark (Pending -> Not Quoted), undo
  // (Not Quoted -> Pending), or pick the line back up when the supplier quotes
  // late (Not Quoted -> Quoted). Any editor may use it (no manager gate: the
  // approver only reads this status to know the line can be ignored).
  if (cleanNew === "not quoted") {
    return cleanOld === "pending";
  }
  if (cleanOld === "not quoted") {
    return cleanNew === "pending" || cleanNew === "quoted";
  }

  // 2. Standard Forward-Only Flow
  const flow = [
    "pending",
    "quoted",
    "approved",
    "sent",
    "received",
    "despatched",
    "final received"
  ];

  const oldIdx = flow.indexOf(cleanOld);
  const newIdx = flow.indexOf(cleanNew);

  // If statuses aren't recognized in the main flow, block for safety
  if (oldIdx === -1 || newIdx === -1) return false; 

  // Enforce strict sequential progression (no skipping steps). Cannot go backward.
  return newIdx === oldIdx + 1;
}

/**
 * Canonical quote-item statuses — server-side single source of truth.
 * Mirrors QUOTE_ITEM_STATUSES in QuoteMgmtJS.html (order = lifecycle flow).
 */
const QUOTE_ITEM_STATUSES_ = [
  "Pending", "Not Quoted", "Quoted", "Approved", "Sent",
  "Received", "Despatched", "Final Received", "Deleted",
];

/**
 * Server twin of normalizeQuoteItemStatus (QuoteMgmtJS.html): returns the
 * value when it is an exact known status, otherwise "Pending". Used by the
 * PO-reminder Approved-status guard to derive the dominant row status.
 * @param {*} value raw Quotes-sheet status cell
 * @return {string} one of QUOTE_ITEM_STATUSES_
 */
function normalizeStatus_(value) {
  const status = String(value || "").trim();
  return QUOTE_ITEM_STATUSES_.includes(status) ? status : "Pending";
}

/**
 * Header of the Quotes column that records what the manager ACTUALLY approved.
 *
 * "Cant." keeps the QUOTED quantity and is frozen once a line reaches Approved;
 * this column carries the APPROVED figure. Before the split both lived in
 * "Cant.", so approving a reduced quantity overwrote the quote and the original
 * figure was unrecoverable (Total Neto was recomputed from it too, and RFQ had
 * already netted out store stock, so neither the requirement nor the log held
 * a reliable "as quoted" number either).
 */
const QUOTE_APPROVED_QTY_HEADER_ = "Cant. Aprobado";

/** Statuses at/after Approved, i.e. once the quoted quantity is frozen. */
const QUOTE_APPROVED_OR_LATER_ = ["APPROVED", "SENT", "RECEIVED", "DESPATCHED", "FINAL RECEIVED"];

/**
 * True when a line has reached (or passed) "Approved". Drives the "Cant." freeze:
 * once a manager has signed off, the quoted quantity must stop moving, otherwise
 * it silently BECOMES the approved quantity and the split carries no information.
 * "Deleted" counts as frozen too, so a cancelled line keeps its history intact.
 * @param {*} status raw Quotes-sheet status cell
 * @return {boolean}
 */
function isQuoteQtyFrozen_(status) {
  const clean = String(status || "").trim().toUpperCase();
  return QUOTE_APPROVED_OR_LATER_.indexOf(clean) !== -1 || clean === "DELETED";
}

/**
 * Effective (approved) quantity of a line: "Cant. Aprobado" when it holds a
 * value, otherwise the quoted "Cant.".
 *
 * The fallback is what keeps this a zero-migration change: every line approved
 * BEFORE this column existed has a blank cell, and for those the approved
 * quantity simply was the quoted one.
 *
 * @param {*} quotedQty raw "Cant." cell
 * @param {*} approvedQty raw "Cant. Aprobado" cell
 * @return {number}
 */
function resolveEffectiveQuoteQty_(quotedQty, approvedQty) {
  const q = Number(String(quotedQty == null ? "" : quotedQty).replace(/,/g, "")) || 0;
  const a = Number(String(approvedQty == null ? "" : approvedQty).replace(/,/g, "")) || 0;
  return a > 0 ? a : q;
}

/**
 * Header of the Quotes column holding the discount the SUPPLIER granted on the
 * quoted unit price (percentage).
 *
 * ONE discount % per supplier quote: the supplier quotes its list prices and
 * then grants a single discount for the whole quote, applied to every line.
 * The value is replicated on each row of the quote (so every row keeps its
 * context when read alone), but the edit UI exposes ONE quote-level input and
 * saving unifies every row to it — it can never differ per line. The net
 * figure is derived (never written to the sheet):
 *
 *     Precio Neto Unit. = Precio Unit. x (1 - Descuento % / 100)
 *
 * A blank cell means "no discount", which is what makes this a zero-migration
 * change: every row quoted before this column existed simply keeps its list
 * price as the net price.
 */
const QUOTE_DISCOUNT_PCT_HEADER_ = "Descuento %";

/**
 * Header of the Quotes column holding the TRANSPORT / freight the supplier
 * charges.
 *
 * Freight is a QUOTE-level amount (one delivery, one charge), not a per-unit
 * one, so it must be counted ONCE per supplier quote - multiplying it by the
 * line quantity, or summing it across the rows of a card, would inflate the
 * quote. The convention used here:
 *
 *   * the same value is stored on every row of the supplier quote (a row has no
 *     way of knowing it is "the" freight row), and
 *   * only the FIRST row of the quote that carries a value adds it to its line
 *     total - every other row of the same quote stores it as metadata only
 *     (see resolveQuoteLineTotal_'s `includeFreight` and pickQuoteFreightCarrier_).
 *
 * A blank cell means "no transport charge".
 */
const QUOTE_FREIGHT_HEADER_ = "Transporte";

/** Largest discount percentage accepted. 100% => a free line. */
const QUOTE_MAX_DISCOUNT_PCT_ = 100;

/**
 * Largest transport amount accepted for one quote. It keeps the value well
 * inside the 15-significant-digit precision of a Sheets cell, so the figure
 * round-trips without losing cents. Mirrors MAX_QUOTE_FREIGHT in
 * QuoteMgmtJS.html - change both together.
 */
const QUOTE_MAX_FREIGHT_ = 999999999999.99;

/**
 * Coerce a raw "Descuento %" cell to a usable percentage in [0, 100].
 *
 * Sheets stores both numbers and (when someone types "10 %") text, and a locale
 * that writes "0,1" for a tenth, so thousands separators and stray spaces are
 * stripped before parsing. Anything unparseable collapses to 0 (no discount)
 * rather than propagating NaN into the net price.
 *
 * @param {*} value raw cell or payload value
 * @return {number} percentage within [0, 100]
 */
function normalizeDiscountPct_(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(String(value).replace(/[%\s,]/g, "").replace(",", "."));
  if (!isFinite(n) || isNaN(n)) return 0;
  if (n < 0) return 0;
  return n > QUOTE_MAX_DISCOUNT_PCT_ ? QUOTE_MAX_DISCOUNT_PCT_ : n;
}

/**
 * Coerce a raw "Transporte" cell to a usable amount >= 0. A lump-sum charge is
 * a plain number, so this is just normalizeDiscountPct_'s parsing with the
 * upper clamp removed.
 *
 * @param {*} value raw cell or payload value
 * @return {number} freight amount, never negative
 */
function normalizeFreight_(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(String(value).replace(/[\s,]/g, "").replace(",", "."));
  if (!isFinite(n) || isNaN(n)) return 0;
  return n < 0 ? 0 : n;
}

/**
 * Net unit price of a line once the supplier's discount is applied.
 *
 * The QUOTED unit price is never overwritten (it is the record of what the
 * supplier asked for); the discount lives beside it and the money figure every
 * downstream consumer uses is derived from the pair.
 *
 * @param {*} price quoted unit price ("Precio Unit.")
 * @param {*} discountPct discount percentage, 0-100
 * @return {number} net unit price
 */
function resolveNetUnitPrice_(price, discountPct) {
  const p = Number(String(price == null ? "" : price).replace(/,/g, "")) || 0;
  if (p <= 0) return p > 0 ? p : 0;
  const pct = normalizeDiscountPct_(discountPct);
  return Math.round(p * (1 - pct / 100) * 100) / 100;
}

/**
 * Line total of a quote line, with the discount already inside the unit price
 * and the transport charged at most once per supplier quote.
 *
 * Freight is only added by the carrier row (includeFreight), so summing the
 * line totals of a card yields the quote total exactly once. See
 * QUOTE_FREIGHT_HEADER_ for why the value is replicated but counted once.
 *
 * A zero QUOTED unit price means the supplier quoted a lump sum, so whatever
 * total the payload carries is preserved untouched rather than being zeroed -
 * this mirrors the pre-existing price-0 guard on the plain price x qty path.
 *
 * @param {number} netUnit net unit price (discount already applied)
 * @param {number} basisQty quantity the total is based on (received/approved/quoted)
 * @param {number} freight transport amount for the quote
 * @param {boolean} includeFreight true only for the carrier row
 * @return {number} line total rounded to 2 decimals
 */
function resolveQuoteLineTotal_(netUnit, basisQty, freight, includeFreight) {
  const net = Number(netUnit) || 0;
  if (net <= 0) return 0;
  const q = Number(basisQty) || 0;
  const f = includeFreight ? (Number(freight) || 0) : 0;
  return Math.round(net * q * 100) / 100 + f;
}

/**
 * Pick the row of a supplier quote that carries the transport into the line
 * totals. The value is replicated on every row, so "the first row that holds
 * one" is the single carrier and the sum can never count freight twice.
 *
 * Rows arrive in sheet order (oldest first), so the carrier is stable across
 * saves: the value is not migrated from row to row.
 *
 * @param {Array} items quote lines (post-write values)
 * @return {number} index of the carrier row, or -1 when the quote has no freight
 */
function pickQuoteFreightCarrier_(items) {
  const rows = Array.isArray(items) ? items : [];
  for (let i = 0; i < rows.length; i++) {
    if (normalizeFreight_(rows[i] && rows[i].freight) > 0) return i;
  }
  return -1;
}

/**
 * Config-sheet labels (Col A) holding the per-status "send quote-change email"
 * flag for each quote status. One row per status, TRUE/FALSE in Col B — the same
 * shape as the existing "Req PDF" / "Quo Email" flags, so they show up in the
 * Admin > System Flags screen as plain TRUE/FALSE dropdowns.
 */
const QUOTE_EMAIL_STATUS_FLAG_LABELS_ = {
  "Pending": "Quote Email Pending",
  "Not Quoted": "Quote Email Not Quoted",
  "Quoted": "Quote Email Quoted",
  "Approved": "Quote Email Approved",
  "Sent": "Quote Email Sent",
  "Received": "Quote Email Received",
  "Despatched": "Quote Email Despatched",
  "Final Received": "Quote Email Final Received",
};

/** Label of the master off-switch for ALL quote emails (existing Config row). */
const QUOTE_EMAIL_MASTER_FLAG_LABEL_ = "Quo Email";

/**
 * Coerce a Config cell to a boolean. The Admin UI writes 1/0 (AdminValJS.html
 * converts the TRUE/FALSE dropdown), while hand-typed cells may hold a real
 * boolean or text, so all of them have to be understood here.
 * @param {*} value raw Config cell
 * @return {boolean}
 */
function configTruthy_(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "on";
}

/**
 * Read the quote-change email flags from the Config sheet.
 *
 * Rows are addressed BY LABEL (scan Col A) instead of a hard-coded cell like
 * "B20": inserting or reordering Config rows can then never silently point the
 * gate at the wrong flag — the exact failure the hard-coded B15/B16 reads are
 * already flagged for in CreateReqGS.js.
 *
 * Fail-open by design: a missing or blank row keeps its DEFAULT (send), so
 * deleting a Config row can never silently mute every quote-change email. Each
 * fallback is logged so the sheet can be repaired.
 *
 * @return {{master: boolean, byStatus: Object<string, boolean>}}
 */
function getQuoteEmailStatusFlags_() {
  const flags = { master: true, byStatus: {} };
  const labelByStatus = {};

  QUOTE_ITEM_STATUSES_.forEach(function (status) {
    if (status === "Deleted") return; // deleted lines never carry a flag
    flags.byStatus[status] = true; // default: send
    labelByStatus[status] = QUOTE_EMAIL_STATUS_FLAG_LABELS_[status];
  });

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName("Config") : null;
    if (!sheet) {
      console.warn("getQuoteEmailStatusFlags_: 'Config' sheet not found — quote-change " +
        "emails default to ON for every status.");
      return flags;
    }

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const data = sheet.getRange(1, 1, lastRow, 2).getValues();
    const valueByLabel = {};
    data.forEach(function (row) {
      const label = String(row[0] == null ? "" : row[0]).trim().toLowerCase();
      if (label) valueByLabel[label] = row[1];
    });

    const masterKey = QUOTE_EMAIL_MASTER_FLAG_LABEL_.toLowerCase();
    if (masterKey in valueByLabel) {
      flags.master = configTruthy_(valueByLabel[masterKey]);
    } else {
      console.warn("getQuoteEmailStatusFlags_: Config row '" + QUOTE_EMAIL_MASTER_FLAG_LABEL_ +
        "' not found — master switch defaults to ON.");
    }

    Object.keys(labelByStatus).forEach(function (status) {
      const label = labelByStatus[status];
      const key = label.toLowerCase();
      if (!(key in valueByLabel)) {
        console.warn("getQuoteEmailStatusFlags_: Config row '" + label + "' not found — " +
          "status '" + status + "' keeps sending (default ON).");
        return;
      }
      const raw = valueByLabel[key];
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        console.warn("getQuoteEmailStatusFlags_: Config row '" + label + "' is blank — " +
          "status '" + status + "' keeps sending (default ON).");
        return;
      }
      flags.byStatus[status] = configTruthy_(raw);
    });
  } catch (e) {
    console.warn("getQuoteEmailStatusFlags_ failed (" + e + ") — quote-change emails " +
      "default to ON for every status.");
  }

  return flags;
}

/**
 * Decide whether the "Quote Updated" notification may be sent for this save.
 *
 * ANY-OF rule (deliberately NOT a dominant/most-advanced status): the email
 * goes out as soon as ONE item of the quote has its status flag enabled. A
 * quote holding (Sent + Pending) therefore still emails, because "Pending" is
 * enabled — only a quote whose items are ALL on disabled statuses stays silent.
 *
 * "Deleted" rows are ignored (they cannot email). The master switch wins over
 * everything: when "Quo Email" is FALSE nothing is sent at any status.
 *
 * @param {Array<Array<*>>} quoteRows rows of THIS quote, post-write
 * @param {number} colStatus index of the "Estado" column
 * @param {Object=} flags result of getQuoteEmailStatusFlags_ (read when omitted)
 * @return {{send: boolean, reason: string, statuses: Array<string>}}
 */
function shouldSendQuoteChangeEmail_(quoteRows, colStatus, flags) {
  const cfg = flags || getQuoteEmailStatusFlags_();

  if (cfg.master === false) {
    return {
      send: false,
      reason: "master switch '" + QUOTE_EMAIL_MASTER_FLAG_LABEL_ + "' is off",
      statuses: [],
    };
  }

  const statuses = [];
  (quoteRows || []).forEach(function (row) {
    const status = normalizeStatus_(row && colStatus !== undefined ? row[colStatus] : "");
    if (status === "Deleted") return;
    statuses.push(status);
  });

  if (!statuses.length) {
    return { send: false, reason: "no active items in the quote", statuses: statuses };
  }

  const enabled = statuses.filter(function (s) { return cfg.byStatus[s] !== false; });
  if (enabled.length) return { send: true, reason: "", statuses: statuses };

  return {
    send: false,
    reason: "every item sits on a no-send status",
    statuses: statuses,
  };
}

/**
 * Greeting used as the first line of the internal PO-creation reminder
 * email. Kept as a constant (rather than inlined in the body) so it can be
 * tuned in one place without touching the HTML template.
 */
const PO_REMINDER_GREETING_ = "Buenas días";




/**
 * STOCK INTEGRATION on Status Change
 * Called from updateQuoteWithItems (only for lines that really moved).
 * Integrates with StockGS.gs tracking Quantity, ReservedQty, AvailableQty.
 *
 * Every entry is one moved quote line:
 *   { geo, qty, site, quoteId, orderId, transition: "TO_PENDING" | "TO_RECEIVED" |
 *     "TO_DESPATCHED" | "RELEASE_FROM_PENDING" | "RECEIVED_TOPUP", previousStatus }
 *
 * Non-negotiable: each movement is TARGET based and posted through
 * postQuoteStockDelta_, which writes only the difference against what is already
 * in StockLedger for (item, transactionType, quoteId). Saving the same quote
 * twice can therefore never post the same receipt / issue / reservation twice.
 */
/**
 * Min/Max GUARD: checks whether issuing `qty` of `geo` from the Store (main
 * warehouse) would drop its available stock below the site-specific minimum.
 * Non-blocking: returns a warning message ("" when OK).
 */
function validateStoreIssueAgainstMin_(geo, site, qty) {
  try {
    if (!geo || !site) return "";
    const mm = getPerSiteMinMaxForProduct(site, geo);
    const min = Number(mm && mm.min) || 0;
    if (min <= 0) return "";

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stockSheet = ss.getSheetByName("Stock");
    if (!stockSheet) return "";

    const data = stockSheet.getDataRange().getValues();
    const storeName = normalizeLocationId_(getStoreSectorName_());
    const canonicalType = normalizeLocationType_(LOCATION_TYPE_SECTOR);
    let storeQty = 0;
    for (let i = 1; i < data.length; i++) {
      if (normalizeLocationId_(data[i][0]) !== normalizeLocationId_(geo)) continue;
      const locType = normalizeLocationType_(data[i][2]);
      const locId = normalizeLocationId_(data[i][3]);
      // Warehouse stock = the canonical sector type whose ID is the Store name.
      if (locType === canonicalType && locId === storeName) {
        storeQty += Number(data[i][6]) || 0;
      }
    }

    if (storeQty - qty < min) {
      return `Issue of ${qty} x ${geo} from Store would leave ${Math.max(0, storeQty - qty)} available, below the minimum (${min}) for site "${site}".`;
    }
    return "";
  } catch (e) {
    console.warn("MinMax guard error: " + e);
    return "";
  }
}

/**
 * Canonical name of the company warehouse sector ("Store").
 *
 * Store is not a special location type — it is one of the sectors listed in the
 * Validation sheet, alongside Workshop and the drilling sites. Reading it from
 * that list (instead of hardcoding "Store") keeps quote movements pointing at
 * exactly the same sector name the Scanner and Stock screens use.
 */
function getStoreSectorName_() {
  const FALLBACK = "Store";
  try {
    const val = getValidationData();
    const sites = (val && val.sites) || [];

    const store = sites.find(s => normalizeLocationId_(s && s.name) === "STORE");
    if (store && String(store.name).trim()) return String(store.name).trim();

    // Exact "Store" may be spelled differently; accept the first site that
    // clearly is the warehouse before giving up.
    const loose = sites.find(s => {
      const n = normalizeLocationId_(s && s.name);
      return n.indexOf("STORE") === 0 || n.indexOf("BODEGA") === 0 || n.indexOf("WAREHOUSE") === 0;
    });
    if (loose && String(loose.name).trim()) return String(loose.name).trim();

    console.warn(
      "getStoreSectorName_: no warehouse sector found in the Validation site " +
      `list — falling back to "${FALLBACK}". Add it to Validation column A if ` +
      "the name is different."
    );
  } catch (e) {
    console.warn("getStoreSectorName_ failed: " + e + ` — using "${FALLBACK}".`);
  }
  return FALLBACK;
}

function processQuoteStockUpdate(items, userName = "System") {
  if (!items || !Array.isArray(items)) return { processed: 0, warnings: [] };

  let processed = 0;
  const warnings = [];

  items.forEach(function (item) {
    const itemId = String(item.geo || item["Geo Code"] || item.origGeo || "").trim();
    if (!itemId) return;

    const qty = Number(item.qty || item.cant || item["Cant."] || 0);
    if (qty <= 0) return;

    // Which movement does this line need? Either the explicit `transition` the
    // caller resolved, or (legacy callers) derived from the status pair.
    const transition = resolveQuoteStockTransition_(item);
    if (!transition) return; // Quoted / Approved / Sent / Final Received move no stock

    const referenceId = String(item.quoteId || item.orderId || "").trim();
    const referenceType = "Quote";
    const site = String(item.site || item.faena || item["Faena"] || item.destination || "").trim();
    const comments = `Quote ${referenceId}`;

    // ==========================================================
    // 🔒 Store / WAREHOUSE STOCK RESERVATION & DEDUCTION RULES
    // LocationType: LOCATION_TYPE_SECTOR ("Sector" for every location)
    // LocationID:   the sector name from the Validation sheet ("Store", etc.)
    // ==========================================================

    // The company warehouse is just another sector; read its name from the
    // Validation site list so it can never drift from what users select.
    const storeSector = getStoreSectorName_();

    // A. Item placed in Pending State -> Reserve/earmark warehouse stock
    if (transition === "TO_PENDING") {
      // Earmark only: this moves ReservedQty (never physical Quantity).
      if (postQuoteStockDelta_(itemId, LOCATION_TYPE_SECTOR, storeSector, qty, "ReserveStock",
            referenceId, referenceType, comments + " - Reserved/Earmarked", userName)) processed++;
    }

    // B. Item Approved directly to Despatched (Internal fulfillment bypass)
    else if (transition === "TO_DESPATCHED") {
      // Min/Max guard: warn (non-blocking) when the issue drops Store stock
      // below the site-specific minimum.
      const minMaxWarn = validateStoreIssueAgainstMin_(itemId, site, qty);
      if (minMaxWarn) {
        warnings.push(minMaxWarn);
        console.warn("⚠️ MinMax: " + minMaxWarn);
      }

      // If it was previously reserved in Pending, clear the reservation first
      if (String(item.previousStatus || "").trim().toUpperCase() === "PENDING") {
        postQuoteStockDelta_(itemId, LOCATION_TYPE_SECTOR, storeSector, -qty, "UnreserveStock",
          referenceId, referenceType, comments + " - Unreserved for Despatch", userName);
      }

      // Deduct physical Store stock (IssueToSite reduces Quantity directly)
      if (postQuoteStockDelta_(itemId, LOCATION_TYPE_SECTOR, storeSector, -qty, "IssueToSite",
            referenceId, referenceType, comments + " - Dispatched from Store", userName)) processed++;
    }

    // C. Received in Warehouse/Store → Add the received qty to the Main Store.
    //    Also covers "RECEIVED_TOPUP" (the received qty grew while the line already
    //    sits at Received — the delta is posted, nothing is posted twice).
    else if (transition === "TO_RECEIVED" || transition === "RECEIVED_TOPUP") {
      if (postQuoteStockDelta_(itemId, LOCATION_TYPE_SECTOR, storeSector, qty, "WarehouseReceipt",
            referenceId, referenceType, comments + " - Received in Warehouse", userName)) processed++;
    }

    // D. Deleted/Cancelled Status -> Release reserved stock if previously held in Pending
    else if (transition === "RELEASE_FROM_PENDING") {
      // Free up the reserved stock amount (ReservedQty only)
      if (postQuoteStockDelta_(itemId, LOCATION_TYPE_SECTOR, storeSector, -qty, "UnreserveStock",
            referenceId, referenceType, comments + " - Cancelled/Deleted (Released Reservation)", userName)) processed++;
    }
  });
  
  console.log(`Successfully processed ${processed} stock operations via Quote updates.`);
  return { processed, warnings };
}

/**
 * Resolve which stock movement a quote line needs. Prefers the explicit
 * `transition` produced by buildQuoteStockMovements_ and falls back to the status
 * pair, so this function stays usable on its own (e.g. from a repair tool).
 * Returns "" when the status moves no physical stock.
 */
function resolveQuoteStockTransition_(item) {
  if (!item) return "";
  if (item.transition) return String(item.transition).trim().toUpperCase();

  const newStatus = String(item.status || item.estado || item["Estado"] || "").trim().toUpperCase();
  const oldStatus = String(item.previousStatus || item.oldStatus || "").trim().toUpperCase();
  if (newStatus === oldStatus) return "";

  if (newStatus === "PENDING") return "TO_PENDING";
  if (newStatus === "RECEIVED") return "TO_RECEIVED";
  if (newStatus === "DESPATCHED") return "TO_DESPATCHED";
  if (newStatus === "DELETED" && oldStatus === "PENDING") return "RELEASE_FROM_PENDING";
  // "Not Quoted" carries no stock movement of its own: the line neither ships
  // nor receives. The reservation (if one was taken while Pending) is
  // released explicitly when the row is marked or deleted — see
  // buildQuoteStockMovements_ — so this fallback must never fabricate one.
  if (newStatus === "NOT QUOTED") return "";
  return "";
}

// Per-execution cache of StockLedger postings: "item|type|reference" -> signed total.
var __quoteStockLedgerPostTotals = null;

/**
 * Reads every quote-relevant posting out of StockLedger once per execution.
 * Columns: C=ItemID, G=Change, I=TransactionType, J=ReferenceID.
 */
function getStockLedgerPostTotals_() {
  if (__quoteStockLedgerPostTotals) return __quoteStockLedgerPostTotals;

  const totals = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockLedger");
    const lastRow = sheet ? sheet.getLastRow() : 0;

    if (lastRow > 1) {
      const values = sheet.getRange(2, 3, lastRow - 1, 8).getValues(); // C..J
      for (let i = 0; i < values.length; i++) {
        const rowItem = String(values[i][0] || "").trim().toLowerCase();
        if (!rowItem) continue;
        const rowType = String(values[i][6] || "").trim().toLowerCase();
        const rowRef = String(values[i][7] || "").trim().toLowerCase();
        const key = rowItem + "|" + rowType + "|" + rowRef;
        totals[key] = (totals[key] || 0) + (Number(values[i][4]) || 0);
      }
    }
  } catch (e) {
    console.warn("getStockLedgerPostTotals_ failed: " + e.toString());
  }

  __quoteStockLedgerPostTotals = totals;
  return totals;
}

/** Signed amount already posted in StockLedger for (item, transactionType, reference). */
function getPostedStockTotal_(itemId, transactionType, referenceId) {
  const key = String(itemId || "").trim().toLowerCase() + "|" +
    String(transactionType || "").trim().toLowerCase() + "|" +
    String(referenceId || "").trim().toLowerCase();
  return Number(getStockLedgerPostTotals_()[key] || 0) || 0;
}

/**
 * Post a quote-driven movement so StockLedger ends up holding EXACTLY
 * `targetChange` for (item, transactionType, referenceId) — never more:
 *
 *   - same amount already posted  -> nothing happens (this is what duplicated the stock)
 *   - target grew (partial receipt completed) -> only the difference is posted
 *   - already posted MORE than the target -> reported for review, never silently reversed
 *
 * Returns true when a movement was actually written.
 */
function postQuoteStockDelta_(itemId, locationType, locationId, targetChange, transactionType, referenceId, referenceType, comments, userName) {
  const target = Number(targetChange) || 0;
  if (target === 0) return false;

  const posted = getPostedStockTotal_(itemId, transactionType, referenceId);
  const delta = target - posted;

  if (Math.abs(delta) < 1e-9) {
    console.log(`Stock ${transactionType} for ${itemId} / ${referenceId} already posted (${posted}) — nothing to do.`);
    return false;
  }

  if ((delta > 0) !== (target > 0)) {
    console.warn(`⚠️ Stock ${transactionType} for ${itemId} / ${referenceId} is over-posted ` +
      `(ledger ${posted}, expected ${target}). Skipped — review StockLedger ` +
      `(reverseDuplicateQuoteReceipts repairs the known duplicates).`);
    return false;
  }

  const result = updateStock(itemId, locationType, locationId, delta, transactionType,
    referenceId, referenceType, comments, userName);

  if (result && result.success) {
    // Keep the per-execution cache in sync so the same line cannot post twice
    // within one save either.
    const key = String(itemId || "").trim().toLowerCase() + "|" +
      String(transactionType || "").trim().toLowerCase() + "|" +
      String(referenceId || "").trim().toLowerCase();
    getStockLedgerPostTotals_()[key] = posted + delta;
    return true;
  }

  return false;
}

/**
 * Build the stock-movement list for one quote save.
 *
 * Only lines that really moved are returned:
 *   - status transition: Pending / Received / Despatched / Deleted-from-Pending
 *   - "RECEIVED_TOPUP": the received qty grew while the line already sits at
 *     "Received" (a partial receipt completed on a later save)
 *
 * `changedItems` is the diff list updateQuoteWithItems already produced, so a line
 * that did not change can never move stock — this is what re-posted the receipt on
 * every save before.
 */
function buildQuoteStockMovements_(payload, changedItems, rows, colSiteIdx) {
  const movements = [];
  if (!payload || !Array.isArray(payload.items)) return movements;

  const cleanKey = function (v) { return String(v || "").trim().toLowerCase(); };

  const diffByKey = {};
  (changedItems || []).forEach(function (ci) {
    if (!ci || !ci.diffs) return;
    diffByKey[cleanKey(ci.quoteId) + "|" + cleanKey(ci.origGeo)] = {
      diffs: ci.diffs,
      site: (colSiteIdx !== -1 && rows[ci.index])
        ? String(rows[ci.index][colSiteIdx] || "").trim()
        : ""
    };
  });

  const seenKeys = {};
  payload.items.forEach(function (it) {
    const key = cleanKey(it.quoteId) + "|" + cleanKey(it.origGeo);
    const entry = diffByKey[key] || diffByKey[cleanKey(it.quoteId) + "|" + cleanKey(it.geo)];
    if (!entry || seenKeys[key]) return; // did not change / already handled once
    seenKeys[key] = true;

    const statusDiff = entry.diffs.status || null;
    const receivedDiff = entry.diffs.receivedQty || null;
    const statusTo = String((statusDiff && statusDiff.to) || it.status || "").trim().toUpperCase();
    const statusFrom = String((statusDiff && statusDiff.from) || "").trim().toUpperCase();

    let transition = "";
    if (statusDiff) {
      if (statusTo === "PENDING") transition = "TO_PENDING";
      else if (statusTo === "RECEIVED") transition = "TO_RECEIVED";
      else if (statusTo === "DESPATCHED") transition = "TO_DESPATCHED";
      else if (statusTo === "DELETED" && (statusFrom === "PENDING" || statusFrom === "NOT QUOTED")) transition = "RELEASE_FROM_PENDING";
      // Pending -> "Not Quoted" drops a line the supplier will never fulfil, so
      // any Pending-time reservation must be released right away (same as the
      // Deleted leg, and target-based so re-running never double-releases).
      else if (statusTo === "NOT QUOTED" && statusFrom === "PENDING") transition = "RELEASE_FROM_PENDING";
      // Undo ("Not Quoted" -> "Pending") re-enters the flow: the same branch
      // below derives TO_PENDING, which re-takes the reservation. Picking the
      // line back up ("Not Quoted" -> "Quoted") re-quotes it for real, so it
      // re-reserves exactly like a fresh Pending line would once quoted.
      else if (statusTo === "QUOTED" && statusFrom === "NOT QUOTED") transition = "TO_PENDING";
    } else if (receivedDiff && statusTo === "RECEIVED") {
      transition = "RECEIVED_TOPUP";
    }

    if (!transition) return; // Quoted / Approved / Sent / Final Received move no stock

    const payloadQty = Number(String(it.qty === undefined || it.qty === null ? "" : it.qty).replace(/,/g, "")) || 0;
    const hasReceivedQty = it.receivedQty !== undefined && it.receivedQty !== null &&
      String(it.receivedQty).trim() !== "";
    const receivedQty = hasReceivedQty
      ? (Number(String(it.receivedQty).replace(/,/g, "")) || 0)
      : null;

    // 🔒 EFFECTIVE QTY. "Cant." now keeps the QUOTED figure (frozen at Approved), so
    // the line quantity in the payload is no longer what was signed off. Issues —
    // reserve, despatch and the reservation release — must move the APPROVED amount,
    // otherwise a manager who reduced the quantity would still have the full quoted
    // quantity pulled out of the store. Receipts keep using the received qty: that
    // is what physically arrived, whatever was approved.
    const hasApprovedQty = it.approvedQty !== undefined && it.approvedQty !== null &&
      String(it.approvedQty).trim() !== "";
    const approvedQty = hasApprovedQty
      ? (Number(String(it.approvedQty).replace(/,/g, "")) || 0)
      : 0;
    const effectiveQty = resolveEffectiveQuoteQty_(payloadQty, approvedQty);

    // A receipt is driven by the received qty when the client sent one (that is the
    // quantity that physically arrived); issues keep using the effective quantity.
    const isReceipt = transition === "TO_RECEIVED" || transition === "RECEIVED_TOPUP";
    const qty = isReceipt && receivedQty !== null ? receivedQty : effectiveQty;
    if (qty <= 0) return;

    movements.push({
      geo: it.geo || it.origGeo || "",
      qty: qty,
      site: entry.site || "",
      quoteId: it.quoteId || "",
      orderId: it.orderId || payload.orderId || "",
      transition: transition,
      previousStatus: statusFrom,
      status: statusTo
    });
  });

  return movements;
}

var __quoteNoCompareTz = null;

/**
 * Spreadsheet timezone (falls back to the script timezone), resolved once and
 * cached. Shared by the Supplier Quote No. normalizer and the Req-date formatter
 * so every date the Quote Mgmt UI displays is stamped in the sheet's own zone.
 */
function getQuoteSheetTimezone_() {
  if (__quoteNoCompareTz === null) {
    __quoteNoCompareTz = Session.getScriptTimeZone();
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) __quoteNoCompareTz = ss.getSpreadsheetTimeZone() || __quoteNoCompareTz;
    } catch (e) { /* keep the script timezone */ }
  }
  return __quoteNoCompareTz;
}

/**
 * Normalize a Supplier Quote No. ("Ref Cotiz.") so it can be compared.
 *
 * Sheets silently converts text like "10-09-2026" into a real Date. After that the
 * cell stringifies as "Thu Sep 10 2026 04:00:00 GMT-0300 (hora de verano de Chile)"
 * while the client keeps sending "10-09-2026", so the diff never settled: every
 * save looked like a change (hasAnyChange = true) and re-ran the stock block.
 * Date objects, Date strings, dd-mm-yyyy and yyyy-mm-dd now all collapse to the
 * same dd-MM-yyyy key.
 */
function normalizeQuoteNoForCompare_(value) {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (raw === "") return "";

  let asDate = null;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    asDate = value;
  } else if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(raw)) {
    asDate = new Date(raw);
  }

  if (asDate && !isNaN(asDate.getTime())) {
    try {
      return Utilities.formatDate(asDate, getQuoteSheetTimezone_(), "dd-MM-yyyy");
    } catch (e) { /* fall through to text handling */ }
  }

  const dmy = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (dmy) {
    return ("0" + dmy[1]).slice(-2) + "-" + ("0" + dmy[2]).slice(-2) + "-" + dmy[3];
  }

  const ymd = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (ymd) {
    return ("0" + ymd[3]).slice(-2) + "-" + ("0" + ymd[2]).slice(-2) + "-" + ymd[1];
  }

  return raw.toUpperCase();
}

/**
 * Normalize a Quotes-sheet AUDIT date cell ("Created Date" / "Last Modified
 * Date") to { text, iso }.
 *
 * The two writers stamp different shapes: saveQuoteToSheet() writes the
 * pre-formatted text "dd/MM/yyyy HH:mm", while the meta block of
 * updateQuoteWithItems() writes a real Date (setValue(new Date())). Both must
 * reach the client as ONE display format (dd-MM-yyyy HH:mm, sheet timezone)
 * plus a sortable ISO timestamp, otherwise the edit-modal audit line and the
 * requirement timeline would render raw Date strings.
 *
 * @param {*} value raw cell (Date, formatted text or blank)
 * @return {{text: string, iso: string}} display value + sortable timestamp
 */
function formatQuoteAuditDate_(value) {
  if (value === undefined || value === null) return { text: "", iso: "" };
  const tz = getQuoteSheetTimezone_();
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return { text: "", iso: "" };
    let iso = "";
    try { iso = value.toISOString(); } catch (e) { iso = ""; }
    let text = "";
    try { text = Utilities.formatDate(value, tz, "dd-MM-yyyy HH:mm"); } catch (e2) { text = ""; }
    return { text: text, iso: iso };
  }
  const raw = String(value).trim();
  if (!raw) return { text: "", iso: "" };

  // "dd/MM/yyyy HH:mm" (or dd-MM-yyyy / with seconds): assembled manually so the
  // parts keep their sheet-zone meaning instead of being re-parsed as UTC.
  const m = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let date = null;
  if (m) {
    date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    if (isNaN(date.getTime())) date = null;
  }
  if (!date) {
    const parsed = new Date(raw);
    date = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date) return { text: raw, iso: "" }; // unparseable: print it as-is
  let text = "";
  try { text = Utilities.formatDate(date, tz, "dd-MM-yyyy HH:mm"); } catch (e3) { text = raw; }
  let iso = "";
  try { iso = date.toISOString(); } catch (e4) { iso = ""; }
  return { text: text, iso: iso };
}

/** Per-execution cache of the Users sheet (email -> full name) map. */
var __quoteUserNameMap = null;

/**
 * Memoized Users-sheet map (lowercased email -> full name) used to show a
 * PERSON's name instead of the raw email the audit columns store. Built once per
 * execution (getQuotesHistory may resolve dozens of editors), fail-open: a
 * missing Users sheet simply leaves the map empty, so callers fall back to the
 * email itself.
 *
 * @return {Object<string, string>}
 */
function getQuoteUserNameMap_() {
  if (__quoteUserNameMap) return __quoteUserNameMap;
  const map = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName("Users") : null;
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        const colMap = {};
        data[0].forEach(function (h, i) {
          const k = String(h == null ? "" : h).trim().toLowerCase();
          if (k && !(k in colMap)) colMap[k] = i;
        });
        const emailIdx = colMap["email"] !== undefined ? colMap["email"] : 3;
        const nameIdx = colMap["name"] !== undefined ? colMap["name"]
          : (colMap["full name"] !== undefined ? colMap["full name"] : 2);
        for (let i = 1; i < data.length; i++) {
          const mail = String(data[i][emailIdx] == null ? "" : data[i][emailIdx]).trim().toLowerCase();
          if (!mail) continue;
          const nm = String(data[i][nameIdx] == null ? "" : data[i][nameIdx]).trim();
          if (nm && !(mail in map)) map[mail] = nm;
        }
      }
    }
  } catch (e) {
    console.warn("getQuoteUserNameMap_ failed: " + e.toString());
  }
  __quoteUserNameMap = map;
  return map;
}

/**
 * Display name of an audit editor: the Users-sheet full name when the email is
 * known, otherwise the raw value (an email, or the plain name Ordenes already
 * stores for requirements).
 *
 * @param {*} value "Last Modified By" / "Created By" cell
 * @return {string}
 */
function quoteAuditName_(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const map = getQuoteUserNameMap_();
  return map[raw.toLowerCase()] || raw;
}

function getQuotesHistory() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      console.error("getQuotesHistory: no active spreadsheet (context has no bound SS).");
      return [];
    }
    const sheet = ss.getSheetByName("Quotes");
    if (!sheet) {
      console.error("getQuotesHistory: sheet 'Quotes' not found. Available: " +
        ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    // Normalize headers: trim + lowercase + collapse internal whitespace, so
    // "Ref  ID", "ref id", "Ref ID " all resolve to the same key.
    const normHeader = function (v) {
      return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
    };
    const headers = data[0].map(normHeader);
    const headerByNorm = {};
    headers.forEach(function (h, i) { if (!(h in headerByNorm)) headerByNorm[h] = i; });
    const col = function () {
      for (var a = 0; a < arguments.length; a++) {
        var key = normHeader(arguments[a]);
        if (key in headerByNorm) return headerByNorm[key];
      }
      return -1;
    };
    let receivedIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h.indexOf("received") !== -1 || h.indexOf("recibido") !== -1 || h.indexOf("cant. recibido") !== -1) {
        receivedIdx = i;
        break;
      }
    }
    // 🔒 APPROVED QTY column, resolved EXACTLY. The loop above is a substring scan
    // for "received"/"recibido"; a fuzzy lookup here could bind it to "Cant. Recibido"
    // and report the received figure as the approved one.
    const approvedIdx = headers.findIndex(h => h === "cant. aprobado");
    // Discount / transport columns. Both are optional on legacy sheets: a -1
    // index simply resolves to "no discount" / "no freight" for every row.
    const discountIdx = headers.findIndex(h => h === "descuento %");
    const freightIdx = headers.findIndex(h => h === "transporte");
    const idx = {
      orderId: col("Ref ID", "Ref Id", "RefID", "Ref"),
      fecha: col("Fecha", "Date"),
      supplier: col("Proveedor", "Supplier"),
      faena: col("Faena", "Site"),
      geo: col("Geo Code", "Geo", "GeoCode"),
      pn: col("P/N", "PN", "P N"),
      desc: col("Descripción", "Descripcion", "Description"),
      qty: col("Cant.", "Cant", "Qty", "Cantidad"),
      status: col("Estado", "Status"),
      quoteId: col("Quote ID", "QuoteID", "Quote Id"),
      refCotiz: col("Ref Cotiz.", "Ref Cotiz", "RefCotiz"),
      quoteLink: col("PDF Link", "PDFLink", "Pdf Link"),
      quotedDoc: col("Quoted Doc Link", "Quoted Doc", "QuotedDoc"),
      currency: col("Moneda", "Currency"),
      exchangeRate: col("Tipo Cambio", "Exchange Rate", "Tasa Cambio", "ExchangeRate"),
      price: col("Precio Unit.", "Precio Unit", "Price", "Unit Price"),
      total: col("Total Neto", "Total", "Total Net"),
      category: col("Category", "Categoria", "Categoría"),
      subCategory: col("SubCategory", "Sub Category", "SubCategoria", "Subcategoría"),
      emails: col("Emails", "Email"),
      // 🕐 Audit columns (header names as ensured by saveQuoteToSheet /
      // ensureSheetHasHeaders_). Optional on legacy sheets: a -1 index resolves
      // to "" / 0 and the UI prints "-", never an exception.
      createdBy: col("Created By"),
      createdDate: col("Created Date"),
      lastModBy: col("Last Modified By"),
      lastModDate: col("Last Modified Date"),
      modCount: col("Mod Count", "ModCount"),
    };

    // Fail loud if the key column is missing: otherwise the filter below
    // silently drops EVERY row (row[-1] === undefined → filtered out) and the
    // client shows "no quotes" with a full sheet — exactly this bug.
    if (idx.orderId === -1) {
      console.error("getQuotesHistory: 'Ref ID' column not found. Headers: [" + data[0].join(" | ") + "]");
      return [];
    }

    const cell = function (row, i) { return i === -1 ? "" : (row[i] == null ? "" : row[i]); };
    // Text-safe coercion: Sheets silently converts text like "10-09-2026" (typed into
    // a quote-number column) into a real Date object. If a raw Date escapes to the
    // client in a string field, google.script.run marshalling / downstream string
    // handling breaks and the whole module can render empty. Everything that is
    // conceptually text is forced through String(); numbers/Amounts keep Number().
    const txt = function (row, i, fallback) {
      const v = cell(row, i);
      const s = String(v).trim();
      return s === "" ? (fallback || "") : s;
    };
    var kept = 0;
    const out = data
      .slice(1)
      .filter(function (row) {
        var v = cell(row, idx.orderId);
        var keep = String(v).trim() !== "";
        if (keep) kept++;
        return keep;
      })
      .map(function (row) {
        // Per-row try/catch: one corrupt row (e.g. an invalid Fecha value that
        // makes toISOString throw, or a #N/A error cell) must not abort the
        // whole batch — log it, skip it, keep the rest.
        try {
        const rawFecha = row[idx.fecha];
        const quoteDate = rawFecha ? new Date(rawFecha) : null;
        const fechaValid = quoteDate && !isNaN(quoteDate.getTime());
        // 🕐 Audit cells parsed ONCE per row (text + sortable ISO), then exposed
        // both raw (email) and as a resolved display name for the edit-modal
        // audit line and the requirement timeline.
        const createdAudit = formatQuoteAuditDate_(cell(row, idx.createdDate));
        const modAudit = formatQuoteAuditDate_(cell(row, idx.lastModDate));
        const createdByRaw = txt(row, idx.createdBy);
        const modByRaw = txt(row, idx.lastModBy);
        return {
          orderId: txt(row, idx.orderId),
          timestamp: rawFecha ? String(rawFecha) : "",
          timestampIso: fechaValid ? quoteDate.toISOString() : "",
          supplier: txt(row, idx.supplier),
          faena: txt(row, idx.faena),
          geo: txt(row, idx.geo),
          pn: txt(row, idx.pn),
          desc: txt(row, idx.desc),
          cant: Number(cell(row, idx.qty)) || 0,
          // 🔒 Quoted vs approved, exposed separately so the UI can always show
          // both. `cant` stays the QUOTED figure (frozen once the line is Approved);
          // `approvedQty` resolves through the blank-cell fallback, so rows
          // approved before this column existed simply report quoted == approved.
          quotedQty: Number(cell(row, idx.qty)) || 0,
          approvedQty: resolveEffectiveQuoteQty_(cell(row, idx.qty), cell(row, approvedIdx)),
          receivedQty: receivedIdx === -1 ? 0 : (Number(String(cell(row, receivedIdx)).replace(/,/g, '')) || 0),
          estado: txt(row, idx.status, "RFQ Saved"),
          quoteId: txt(row, idx.quoteId),
          refCotiz: txt(row, idx.refCotiz),
          quoteLink: txt(row, idx.quoteLink),
          supplierQuoteNo: txt(row, idx.refCotiz),
          quotedDocUrl: txt(row, idx.quotedDoc),
          currency: txt(row, idx.currency, "CLP"),
          exchangeRate: Number(cell(row, idx.exchangeRate)) || 0,
          price: Number(cell(row, idx.price)) || 0,
          total: Number(cell(row, idx.total)) || 0,
          // 💰 SUPPLIER DISCOUNT + TRANSPORT (read side).
          // The QUOTED unit price is sent untouched (it is what the supplier
          // asked for); `netUnitPrice` is the money figure every consumer must
          // use, and `netTotal` is that net price on the effective quantity.
          // Both collapse to the plain figures when the sheet has no discount
          // (blank cell => 0), which is what makes this zero-migration.
          discountPct: normalizeDiscountPct_(cell(row, discountIdx)),
          freight: normalizeFreight_(cell(row, freightIdx)),
          netUnitPrice: resolveNetUnitPrice_(cell(row, idx.price), cell(row, discountIdx)),
          netTotal: resolveQuoteLineTotal_(
            resolveNetUnitPrice_(cell(row, idx.price), cell(row, discountIdx)),
            resolveEffectiveQuoteQty_(cell(row, idx.qty), cell(row, approvedIdx)),
            cell(row, freightIdx),
            false // the carrier decision is made at total-sum time, not per row
          ),
          category: txt(row, idx.category, "General"),
          subCategory: txt(row, idx.subCategory),
          emails: txt(row, idx.emails),
          // 🕐 Per-row audit trail. `*Name` is the Users-sheet full name (falls
          // back to the stored email), `*Date` is the dd-MM-yyyy HH:mm display
          // value and `*Iso` is what the client sorts/compares on. Everything
          // degrades to "" on a legacy sheet that lacks these columns.
          createdBy: createdByRaw,
          createdByName: quoteAuditName_(createdByRaw),
          createdDate: createdAudit.text,
          createdIso: createdAudit.iso,
          lastModifiedBy: modByRaw,
          lastModifiedByName: quoteAuditName_(modByRaw),
          lastModifiedDate: modAudit.text,
          lastModifiedIso: modAudit.iso,
          modCount: idx.modCount === -1 ? 0 : (Number(cell(row, idx.modCount)) || 0),
        };
        } catch (rowErr) {
          console.error("getQuotesHistory: skipping corrupt row (Ref ID=" +
            String(cell(row, idx.orderId) || "<empty>") + "): " + rowErr +
            " | row content: [" + row.map(function (v) { return String(v).slice(0, 40); }).join(" | ") + "]");
          return null; // filtered out below
        }
      })
      .filter(Boolean)
      .reverse();

    // Per-item notes live on the Ordenes rows (unique per requirement + GEO), so
    // they are joined here. A consolidated quote ref ("100123+100127") resolves
    // each part separately so nothing is lost.
    try {
      const notesByOrderGeo = {};
      // Supplier Notes live in a SEPARATE Ordenes column ("Supplier Notes") but
      // use the same ReqID||GEO key. Kept in its own map and exposed to the client
      // as `reqSupplierNotes` with the exact shape of `reqItemNotes`, so the
      // edit-quote modal renders both note columns the same way.
      const suppNotesByOrderGeo = {};
      // Per-item photos (Ordenes "Item Images": comma-separated Drive URLs) use
      // the same ReqID||GEO key and are exposed as `reqImages`
      // ([{ ref, images }]) so quote screens can render the requester's
      // attachments read-only, next to the notes.
      const imagesByOrderGeo = {};
      // Requirement-level metadata (Ordenes): the Req PDF lives on the
      // requirement rows, not on the Quotes sheet, and so does the date the
      // requirement was raised ("Fecha") — the Quotes "Fecha" is the RFQ date.
      // One entry per Req ID; the EARLIEST date wins (a requirement is written
      // one row per item, all stamped at creation, but a later re-save of a row
      // must not make the section look newer than the Req itself) and the first
      // non-empty PDF URL wins.
      const reqMetaByOrder = {};
      (getRequirementsHistory() || []).forEach(function (r) {
        const key = String(r.order || "").trim() + "||" + String(r.geo || "").trim();
        notesByOrderGeo[key] = String(r.itemNotes || "");
        imagesByOrderGeo[key] = String(r.images || "");
        // First non-empty wins, mirroring buildItemNotesIndex_ (re-saving a row
        // must not blank a note that was already captured).
        if (!String(suppNotesByOrderGeo[key] || "").trim()) {
          suppNotesByOrderGeo[key] = String(r.supplierNotes || "");
        }

        const order = String(r.order || "").trim();
        if (!order) return;
        const iso = String(r.fechaIso || "").trim();
        const ts = iso ? new Date(iso).getTime() : 0;
        // Requirement LAST-MODIFIED audit (Ordenes "lastModifiedBy"/
        // "lastModifiedDate"/"modCount", exposed by getRequirementsHistory).
        // Unlike the creation date - where EARLIEST wins - the newest edit wins
        // here, so the info ("i") timeline shows the latest touch of the Req.
        const modIso = String(r.reqLastModifiedIso || "").trim();
        const modTs = modIso ? new Date(modIso).getTime() : 0;
        const modText = String(r.reqLastModified || "").trim();
        const modBy = String(r.reqLastModifiedBy || "").trim();
        const modCount = Number(r.reqModCount) || 0;
        const prev = reqMetaByOrder[order];
        if (!prev) {
          reqMetaByOrder[order] = {
            pdfUrl: String(r.pdfUrl || "").trim(),
            fecha: String(r.fecha || "").trim(),
            fechaIso: iso,
            ts: ts,
            reqLastModIso: modIso,
            reqLastModTs: modTs,
            reqLastModText: modText,
            reqLastModBy: modBy,
            reqModCount: modCount,
          };
          return;
        }
        if (!prev.pdfUrl) prev.pdfUrl = String(r.pdfUrl || "").trim();
        if (ts && (!prev.ts || ts < prev.ts)) {
          prev.fechaIso = iso;
          prev.fecha = String(r.fecha || "").trim();
          prev.ts = ts;
        }
        // Newest audit stamp wins; a text-only value (unparseable date) is kept
        // when nothing better exists, and a missing "By"/count is backfilled.
        if (modTs && modTs > (prev.reqLastModTs || 0)) {
          prev.reqLastModIso = modIso;
          prev.reqLastModTs = modTs;
          prev.reqLastModText = modText;
        } else if (!prev.reqLastModText && modText) {
          prev.reqLastModText = modText;
        }
        if (modTs && !prev.reqLastModIso) {
          prev.reqLastModIso = modIso;
          prev.reqLastModTs = modTs;
        }
        if (!prev.reqLastModBy && modBy) prev.reqLastModBy = modBy;
        if (modCount > (prev.reqModCount || 0)) prev.reqModCount = modCount;
      });

      // dd-MM-yyyy in the spreadsheet timezone (same convention as
      // normalizeQuoteNoForCompare_) so the Req header shows a plain date.
      const formatReqDate_ = function (iso, fallback) {
        if (!iso) return fallback || "";
        try {
          const d = new Date(iso);
          if (isNaN(d.getTime())) return fallback || "";
          return Utilities.formatDate(d, getQuoteSheetTimezone_(), "dd-MM-yyyy");
        } catch (e) {
          return fallback || "";
        }
      };

      out.forEach(function (q) {
        const geo = String(q.geo || "").trim();
        const refs = typeof splitCombinedRef_ === "function" ? splitCombinedRef_(q.orderId) : [String(q.orderId || "")];
        const list = [];
        const suppList = [];
        const imgList = [];
        const pdfs = [];
        let earliest = null;
        // Latest requirement edit across the (possibly consolidated) source Refs:
        // for "A+B" the timeline must show the newest touch of EITHER source.
        let latestMod = null;
        refs.forEach(function (ref) {
          const cleanRef = String(ref).trim();
          const notes = notesByOrderGeo[cleanRef + "||" + geo] || "";
          if (String(notes).trim()) list.push({ ref: cleanRef, notes: notes });

          // Photos travel with the same consolidated-ref treatment.
          const imgs = imagesByOrderGeo[cleanRef + "||" + geo] || "";
          if (String(imgs).trim()) imgList.push({ ref: cleanRef, images: imgs });

          // Same consolidated-ref treatment for the supplier-facing notes.
          const suppNotes = suppNotesByOrderGeo[cleanRef + "||" + geo] || "";
          if (String(suppNotes).trim()) suppList.push({ ref: cleanRef, notes: suppNotes });

          const meta = reqMetaByOrder[cleanRef];
          if (!meta) return;
          if (meta.pdfUrl && pdfs.every(function (p) { return p.url !== meta.pdfUrl; })) {
            pdfs.push({ ref: cleanRef, url: meta.pdfUrl });
          }
          if (meta.ts && (!earliest || meta.ts < earliest.ts)) earliest = meta;
          // Keep the requirement audit entry with the newest modification.
          const modTs = Number(meta.reqLastModTs) || 0;
          if (meta.reqLastModText || modTs) {
            if (!latestMod || modTs > (Number(latestMod.reqLastModTs) || 0)) latestMod = meta;
          }
        });
        q.reqItemNotes = list;
        // Read-only "Supplier Notes" column in the edit-quote modal.
        q.reqSupplierNotes = suppList;
        // Read-only per-item photos (Create Req attachments) for quote screens.
        q.reqImages = imgList;
        q.reqPdfUrls = pdfs;
        q.reqDate = earliest ? formatReqDate_(earliest.fechaIso, earliest.fecha) : "";
        q.reqDateIso = earliest ? earliest.fechaIso : "";
        // Requirement LAST-MODIFIED audit for the header info ("i") timeline.
        // The requester ("Solicitado por") is the requirement's creator, so it
        // rides along as the "created by" of the Req block.
        q.reqLastModifiedBy = latestMod ? String(latestMod.reqLastModBy || "") : "";
        q.reqLastModified = latestMod ? String(latestMod.reqLastModText || "") : "";
        q.reqLastModifiedIso = latestMod ? String(latestMod.reqLastModIso || "") : "";
        q.reqModCount = latestMod ? (Number(latestMod.reqModCount) || 0) : 0;
      });
    } catch (joinErr) {
      console.warn("getQuotesHistory: item notes join failed: " + joinErr.toString());
    }

    console.log("getQuotesHistory: kept " + kept + " of " + (data.length - 1) + " rows.");
    return out;
  } catch (e) {
    console.error("Error loading Quotes history: " + e.toString());
    return [];
  }
}

/**
 * Fresh, filter-independent read for the compare modal's "Fix Deleted" resync.
 * Returns every Quotes row of ONE requirement - all suppliers, Deleted rows
 * included - reusing getQuotesHistory() so the joins (item notes, supplier notes,
 * requirement metadata) and the status/text coercion match the page exactly.
 *
 * Why a dedicated reader: the repair must be based on the SHEET, not on whatever
 * the client has cached or filtered. A stale page can hide a live competitor row,
 * and repairing off that cache could "fix" a balanced requirement.
 *
 * The "User" role is refused outright, mirroring the client gate (isQuoteUserRole)
 * that hides the compare/resync UI for that role. Writes go through the normal
 * updateQuoteWithItems path, so QuoteLog auditing, role checks, the script lock
 * and the stock rules all still apply.
 */
function getRequirementQuoteRows(orderId, currentUserEmail) {
  const oid = String(orderId || "").trim();
  if (!oid) return [];

  // Same role lookup as updateQuoteWithItems (Users sheet: col 3 = email, col 7 = role).
  const email = String(currentUserEmail || "").trim().toLowerCase();
  let role = "";
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss ? ss.getSheetByName("Users") : null;
    if (userSheet) {
      const udata = userSheet.getDataRange().getValues();
      for (let i = 1; i < udata.length; i++) {
        if (String(udata[i][3] || "").trim().toLowerCase() === email) {
          role = String(udata[i][7] || "").trim().toUpperCase();
          break;
        }
      }
    }
  } catch (e) {
    console.warn("getRequirementQuoteRows: could not resolve role: " + e.toString());
  }
  if (role === "USER") {
    throw new Error("Your role cannot run the balance repair.");
  }

  return getQuotesHistory().filter(function (r) {
    return String((r && r.orderId) || "").trim() === oid;
  });
}

function getHistoryData() {
  try {
    const result = getQuotesHistory();
    return Array.isArray(result) ? result : [];
  } catch (e) {
    console.error("getHistoryData failed: " + (e && e.toString ? e.toString() : e));
    return [];
  }
}

/**
 * STORE an uploaded supplier quote document (compressed image or rasterized PDF).
 * Client sends one or more base64 image pages (JPEG after compression) plus the
 * original file name. A single image is stored as-is; multi-page content is
 * re-packaged into one compact PDF via the same HTML→PDF Drive engine used by
 * generateQuotePDF so we still keep one URL per quote.
 * Payload: { orderId, quoteId, supplier, site, fileName, files: [{name, mimeType, base64}] }
 */
function getQuoteDocsFolder_(payload) {
  try {
    const parent = getQuoteTargetFolder_(
      String(payload.site || "").trim(),
      String(payload.supplier || "").trim()
    );
    const docsRoot = shared_getOrCreateFolder(parent, "QuotedDocs");
    return shared_getOrCreateFolder(docsRoot, String(payload.quoteId || "General"));
  } catch (e) {
    return DriveApp.getRootFolder();
  }
}

function uploadQuoteAttachment(payload) {
  try {
    if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
      return { success: false, error: "No file content provided." };
    }

    const folder = getQuoteDocsFolder_(payload);
    const baseName = sanitizeFileName_(
      String(payload.fileName || "QuotedDoc")
        .replace(/\.[^.]+$/, "")
        .trim() || "QuotedDoc"
    );

    // Single file (image or PDF) → store directly as-is.
    if (payload.files.length === 1) {
      const f = payload.files[0];
      const mime = String(f.mimeType || "").toLowerCase();
      const ext = mime.indexOf("pdf") !== -1 ? ".pdf"
        : mime.indexOf("image/") !== -1 ? ".jpg"
        : String(payload.fileName || "").replace(/.*(\.[^.]+)$/, "$1") || ".bin";
      const blob = Utilities.newBlob(
        Utilities.base64Decode(f.base64),
        String(f.mimeType || ""),
        baseName + ext
      );
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return { success: true, url: file.getUrl(), fileName: file.getName() };
    }

    // Fallback: multiple pages/images → repackage into one compact PDF via the
    // Drive HTML→PDF engine (not normally hit; client sends single files only).
    const imgTags = payload.files.map(function (f) {
      return '<img src="data:' + String(f.mimeType || "image/jpeg") + ';base64,' +
        String(f.base64 || "") + '" ' +
        'style="width:100%; display:block; margin:0; page-break-after:always;">';
    }).join("\n");

    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>body{margin:0;padding:0;}img{max-width:100%;}</style></head>' +
      '<body>' + imgTags + '</body></html>';

    const htmlBlob = Utilities.newBlob(html, MimeType.HTML, baseName + ".html");
    const htmlFile = folder.createFile(htmlBlob);
    const pdfBlob = htmlFile.getAs(MimeType.PDF);

    if (!pdfBlob || pdfBlob.getBytes().length === 0) {
      throw new Error("PDF conversion failed from document pages");
    }

    const pdfFile = folder.createFile(pdfBlob);
    htmlFile.setTrashed(true);
    pdfFile.setName(baseName + ".pdf");
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { success: true, url: pdfFile.getUrl(), fileName: pdfFile.getName() };
  } catch (e) {
    console.warn("uploadQuoteAttachment failed: " + e.toString());
    return { success: false, error: String(e) };
  }
}



function isInternalReceivingSite(site) {
  const s = String(site || "").trim().toLowerCase();
  return s === "store" || s === "workshop";
}


function updateQuoteWithItems(payload, jobId) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Invalid payload: items missing");
  }

  // Background-job progress (best-effort): when the client fires this as a
  // fire-and-forget call, jobId lets the floating bubble poll live progress
  // on a separate google.script.run channel while the user keeps working.
  // Accepts jobId as 2nd arg OR payload._jobId for backward compat.
  var __bgJobId = jobId || (payload && payload._jobId) || null;
  function __bgq(pct, step) { try { if (__bgJobId) bgUpdateJob(__bgJobId, pct, step); } catch (e) {} }
  function __bgqFail(step, err) { try { if (__bgJobId) bgFinishJob(__bgJobId, false, { step: step, error: String((err && err.toString) ? err.toString() : err) }); } catch (e) {} }
  __bgq(8, "Loading quote…");

  const lock = LockService.getScriptLock();
  // Shorter wait: with fire-and-forget saves the sheet lock is held only for
  // the fast write section below; the slow PDF/email/stock part releases it.
  // 10s -> 30s wait would serialize the queue — keep 10s, fail fast instead.
  var __lockHeld = false;
  try { lock.waitLock(10000); __lockHeld = true; } catch (lkErr) {
    __bgqFail("Waiting for sheet lock…", lkErr);
    throw lkErr;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName("Quotes"); // ⚠️ change if needed

      // Ensure metadata headers exist on Quotes sheet (safe to call repeatedly)
      try {
        ensureSheetHasHeaders_(sheet, [
          'Created By',
          'Created Date',
          'Last Modified By',
          'Last Modified Date',
          'Mod Count',
          'Emails',
          // Appended at the END (never inserted mid-table) so the fixed-position
          // writes in saveQuoteToSheet() keep lining up with their headers.
          QUOTE_APPROVED_QTY_HEADER_,
          // 💰 Supplier discount (once per quote, replicated on every row) + transport (per supplier quote).
          QUOTE_DISCOUNT_PCT_HEADER_,
          QUOTE_FREIGHT_HEADER_,
        ]);
      } catch (e) {
        console.warn('Failed ensuring headers: ' + e.toString());
      }

      const data = sheet.getDataRange().getValues();
      let headers = data[0];
      let rows = data.slice(1);

    const clean = (v) => String(v || "").trim().toLowerCase();

    const findCol = (name) => {
      const idx = headers.findIndex(h => clean(h) === clean(name));
      if (idx === -1) throw new Error("Column not found: " + name);
      return idx;
    };

    // ✅ CORRECT MAPPING (BASED ON YOUR SHEET)
    const colQuoteId = findCol("Quote ID");   // 🔴 THIS is your key
    const colGeo = findCol("Geo Code");
    const colPn = findCol("P/N");
    const colDesc = findCol("Descripción");
    const colQty = findCol("Cant.");
    const colPrice = findCol("Precio Unit.");
    const colTotal = findCol("Total Neto");
    const colStatus = findCol("Estado");
    const colSite = headers.findIndex(h => clean(h) === 'faena'); // optional (unknown -> remote)
    const colSub = headers.findIndex(h => clean(h).includes("sub"));

    // ✅ NEW: Add Qty Received column tracking (Phase 1.1)
    let colReceivedQty = -1;
    try {
      // Try to find existing "Recibido" / "Received" column
      const found = headers.findIndex(h => 
        clean(h).includes("received") || clean(h).includes("recibido")
      );
      if (found !== -1) colReceivedQty = found;
      
      // If not exists, create a proper new column at the end of the table
      if (colReceivedQty === -1) {
        const lastCol1Based = headers.length; // 1-based index of last existing column
        console.log("🔧 Adding new 'Cant. Recibido' column after column", lastCol1Based);
        sheet.insertColumnAfter(lastCol1Based);
        sheet.getRange(1, lastCol1Based + 1).setValue("Cant. Recibido"); // header
        colReceivedQty = lastCol1Based; // 0-based index of the newly added column
        // Refresh headers/rows so the rest of the function (diffing, write-back)
        // includes the new, empty column.
        const fresh = sheet.getDataRange().getValues();
        headers = fresh[0];
        rows = fresh.slice(1);
      }
    } catch (e) {
      console.warn("⚠️ Could not add Qty Received column:", e.toString());
    }

    // ✅ UPDATED: Use both sentQty and receivedQty columns (Phase 1.2)
    const colSentQty = findCol("Cant.");      // Original despatched qty (LOCKED)
    let actualColReceivedQty = headers.findIndex(h => 
      clean(h).includes("received") || clean(h).includes("recibido"));

    // Handle case where new column might not exist yet
    if (actualColReceivedQty === -1) {
      console.warn("⚠️ Qty Received column not found. Using Cant. column with received flag.");
      actualColReceivedQty = -1;
    }

    // 🔒 APPROVED QTY column ("Cant. Aprobado"). Resolved with an EXACT header
    // match on purpose: the lookup right above is a substring scan for
    // "received"/"recibido", so a fuzzy match here could bind this column to
    // "Cant. Recibido" and silently swap the two quantities. The header itself must
    // never contain those substrings either.
    let colApprovedQty = headers.findIndex(h => clean(h) === clean(QUOTE_APPROVED_QTY_HEADER_));
    if (colApprovedQty === -1) {
      try {
        const lastColAppr = headers.length; // 1-based index of last existing column
        console.log("🔧 Adding new '" + QUOTE_APPROVED_QTY_HEADER_ + "' column after column", lastColAppr);
        sheet.insertColumnAfter(lastColAppr);
        sheet.getRange(1, lastColAppr + 1).setValue(QUOTE_APPROVED_QTY_HEADER_);
        colApprovedQty = lastColAppr;
        const freshAppr = sheet.getDataRange().getValues();
        headers = freshAppr[0];
        rows = freshAppr.slice(1);
      } catch (e) {
        console.warn("⚠️ Could not add Approved Qty column: " + e.toString());
      }
    }

    // ✅ NEW: Supplier Quote No (Ref Cotiz.) + Quoted Doc Link columns
    const colRefCotiz = headers.findIndex(h => clean(h) === "ref cotiz.");
    let colQuotedDoc = headers.findIndex(h => clean(h) === "quoted doc link");
    if (colQuotedDoc === -1) {
      try {
        const lastCol1Based = headers.length;
        console.log("🔧 Adding new 'Quoted Doc Link' column at position", lastCol1Based + 1);
        sheet.insertColumnAfter(lastCol1Based);
        sheet.getRange(1, lastCol1Based + 1).setValue("Quoted Doc Link");
        colQuotedDoc = lastCol1Based;
        const fresh = sheet.getDataRange().getValues();
        headers = fresh[0];
        rows = fresh.slice(1);
      } catch (e) {
        console.warn("⚠️ Could not add Quoted Doc Link column:", e.toString());
      }
    }

    // 🔑 Build lookup map
    const rowMap = {};
    rows.forEach((row, i) => {
      const key = clean(row[colQuoteId]) + "|" + clean(row[colGeo]);
      rowMap[key] = i;
    });

    // Currency (Moneda) + Exchange Rate (Tipo Cambio) columns. Moneda exists from RFQ
    // creation; Tipo Cambio may be absent on legacy sheets -> append it defensively.
    let colCurrency = headers.findIndex(h => clean(h) === "moneda" || clean(h) === "currency");
    if (colCurrency === -1) {
      try {
        const lastColCur = headers.length;
        sheet.insertColumnAfter(lastColCur);
        sheet.getRange(1, lastColCur + 1).setValue("Moneda");
        colCurrency = lastColCur;
        const freshCur = sheet.getDataRange().getValues();
        headers = freshCur[0];
        rows = freshCur.slice(1);
      } catch (e) {
        console.warn("Could not add Moneda column:", e.toString());
      }
    }
    let colExchangeRate = headers.findIndex(h => clean(h) === "tipo cambio" || clean(h) === "exchange rate" || clean(h) === "tasa cambio" || clean(h) === "exchangerate");
    if (colExchangeRate === -1) {
      try {
        const lastColRate = headers.length;
        sheet.insertColumnAfter(lastColRate);
        sheet.getRange(1, lastColRate + 1).setValue("Tipo Cambio");
        colExchangeRate = lastColRate;
        const freshRate = sheet.getDataRange().getValues();
        headers = freshRate[0];
        rows = freshRate.slice(1);
      } catch (e) {
        console.warn("Could not add Tipo Cambio column:", e.toString());
      }
    }

    // 💰 SUPPLIER DISCOUNT ("Descuento %") + TRANSPORT ("Transporte") columns.
    // Same defensive append used for Moneda / Tipo Cambio: the sheet may predate
    // them, so they are created on the first save and the header/row snapshot is
    // refreshed before the batch write (which writes `rows` by position).
    const appendQuoteColumn_ = (headerName) => {
      let idx = headers.findIndex(h => clean(h) === clean(headerName));
      if (idx !== -1) return idx;
      try {
        const lastCol = headers.length; // 1-based index of last existing column
        sheet.insertColumnAfter(lastCol);
        sheet.getRange(1, lastCol + 1).setValue(headerName);
        const fresh = sheet.getDataRange().getValues();
        headers = fresh[0];
        rows = fresh.slice(1);
        // insertColumnAfter shifts every row down by zero net, but the rowMap was
        // built on the previous snapshot: rebuild it against the fresh data so a
        // row created by a concurrent writer is still addressable.
        Object.keys(rowMap).forEach(k => delete rowMap[k]);
        rows.forEach((row, i) => { rowMap[clean(row[colQuoteId]) + "|" + clean(row[colGeo])] = i; });
        console.log("🔧 Added '" + headerName + "' column after column", lastCol);
        return lastCol;
      } catch (e) {
        console.warn("⚠️ Could not add '" + headerName + "' column: " + e.toString());
        return -1;
      }
    };
    let colDiscountPct = appendQuoteColumn_(QUOTE_DISCOUNT_PCT_HEADER_);
    let colFreight = appendQuoteColumn_(QUOTE_FREIGHT_HEADER_);

    // Determine current user & role (from payload)
    const editorEmail = String(payload.currentUserEmail || '').trim().toLowerCase();
    let editorRole = '';
    try {
      const userSheet = ss.getSheetByName('Users');
      if (userSheet) {
        const udata = userSheet.getDataRange().getValues();
        for (let i = 1; i < udata.length; i++) {
          const uEmail = String(udata[i][3] || '').trim().toLowerCase();
          if (uEmail === editorEmail) {
            editorRole = String(udata[i][7] || '').trim().toUpperCase();
            break;
          }
        }
      }
    } catch (e) {
      console.warn('Could not resolve editor role: ' + e.toString());
    }

    // Track changes
    const changedItems = [];
    let hasAnyChange = false;
    let hasQtyAmountChange = false;

    // 🔑 "Ref ID" (requirement) + "Proveedor" (supplier) column indexes for the
    // cross-supplier double-approval guard (Issue 4). Resolved via the same
    // findCol() helper, so a renamed/missing header fails loud here instead of
    // silently disabling the guard.
    const colRefId = findCol("Ref ID");
    const colSupplier = findCol("Proveedor");

    // 💰 FREIGHT CARRIER. Transport is a quote-level charge replicated on every
    // row (QUOTE_FREIGHT_HEADER_), but it must land in the totals exactly ONCE.
    // The carrier is "the first line of this save whose EFFECTIVE freight (payload
    // value, else the stored one) is greater than zero" - payload order, which is
    // sheet order, so it is stable across saves and never migrates between rows.
    // Resolved once, before the loop, so every line sees the same answer.
    const effectiveFreightOfItem_ = (it) => {
      if (it && it.freight !== undefined && it.freight !== null && String(it.freight).trim() !== "") {
        return normalizeFreight_(it.freight);
      }
      const stored = rowMap[clean(it && it.quoteId) + "|" + clean(it && it.origGeo)];
      if (stored === undefined || colFreight === -1) return 0;
      return normalizeFreight_(rows[stored][colFreight]);
    };
    const freightCarrierItemIndex_ = (function () {
      for (let i = 0; i < payload.items.length; i++) {
        if (effectiveFreightOfItem_(payload.items[i]) > 0) return i;
      }
      return -1;
    })();
    if (freightCarrierItemIndex_ !== -1) {
      console.log("💰 Transport carrier for this quote: payload item #" + freightCarrierItemIndex_);
    }

    // Process and collect diffs but do not regenerate PDF yet
    payload.items.forEach((item, itemIndex) => {
      const key = clean(item.quoteId) + "|" + clean(item.origGeo);

      let rowIndex = rowMap[key];

      // Debug logging to help diagnose lookup issues
      if (rowIndex === undefined) {
        console.log("DEBUG: Row lookup failed for key:", key);
        console.log("DEBUG: Available rowMap keys:", Object.keys(rowMap));
        console.log("DEBUG: Item quoteId:", item.quoteId, "origGeo:", item.origGeo);

        // Fallback: Try to find row by iterating through all rows
        // This handles cases where there might be whitespace or case differences
        for (let i = 0; i < rows.length; i++) {
          const rowQuoteId = clean(rows[i][colQuoteId]);
          const rowGeo = clean(rows[i][colGeo]);
          if (rowQuoteId === clean(item.quoteId) && rowGeo === clean(item.origGeo)) {
            console.log("DEBUG: Found row by fallback search at index:", i);
            rowIndex = i;
            break;
          }
        }

        if (rowIndex === undefined) {
          // Additional fallback: Try matching by Geo Code only (for same Quote ID group)
          // This handles cases where Geo Code might have been modified
          for (let i = 0; i < rows.length; i++) {
            const rowQuoteId = clean(rows[i][colQuoteId]);
            if (rowQuoteId === clean(item.quoteId)) {
              console.log("DEBUG: Found row by Quote ID only at index:", i, "row geo:", rows[i][colGeo]);
              rowIndex = i;
              break;
            }
          }
        }

        if (rowIndex === undefined) {
          throw new Error("No matching row found for: " + JSON.stringify({ quoteId: item.quoteId, geo: item.origGeo, key: key }));
        }
      }

      const row = rows[rowIndex];

      // This line is the one that carries the quote-level transport into the
      // totals (resolved once, above). Every other line only stores the value.
      const isThisFreightCarrier_ = (itemIndex === freightCarrierItemIndex_);

      // ✅ NEW: Track both SENT and RECEIVED quantities (Phase 1.3)
      const existingSentQty = Number(row[colQty] || 0);
      const existingReceivedQty = actualColReceivedQty !== -1 
        ? Number(String(row[actualColReceivedQty] || '').replace(/,/g, '')) || 0 
        : 0;

      // Also track original quantities for diffing
      const existingPrice = Number(row[colPrice] || 0);
      const existingTotal = Number(row[colTotal] || 0);
      const existingStatus = String(row[colStatus] || '').trim().toUpperCase();
      const existingPn = String(row[colPn] || '').trim();
      const existingGeo = String(row[colGeo] || '').trim();
      const existingQuoteNo = colRefCotiz !== -1 ? String(row[colRefCotiz] || '').trim() : "";
      // "Ref Cotiz." is often typed as a date ("10-09-2026") which Sheets stores as a
      // real Date. Compare on a normalized key, otherwise every save reports a phantom
      // change and re-runs the stock block.
      const existingQuoteNoKey = normalizeQuoteNoForCompare_(colRefCotiz !== -1 ? row[colRefCotiz] : "");
      const existingDocUrl = colQuotedDoc !== -1 ? String(row[colQuotedDoc] || '').trim() : "";
      const existingCurrency = colCurrency !== -1 ? String(row[colCurrency] || '').trim() : "";
      const existingRate = colExchangeRate !== -1 ? (Number(row[colExchangeRate]) || 0) : 0;
      // 🔒 APPROVED QTY: "Cant." is the QUOTED quantity and freezes at Approved;
      // this cell holds what the manager actually signed off.
      const existingApprovedQty = colApprovedQty !== -1
        ? Number(String(row[colApprovedQty] || '').replace(/,/g, '')) || 0
        : 0;
      // 💰 SUPPLIER DISCOUNT + TRANSPORT (stored values). blank cell = 0, so a row
      // that predates these columns keeps its plain price and no transport.
      const existingDiscountPct = normalizeDiscountPct_(colDiscountPct !== -1 ? row[colDiscountPct] : 0);
      const existingFreight = normalizeFreight_(colFreight !== -1 ? row[colFreight] : 0);
      // Provisional freeze (final value is taken once newStatus is known below).

      // Parse receivedQty from payload (if using separate field) or from qty.
      // IMPORTANT: Only treat receivedQty as a change when the client EXPLICITLY sends
      // a value. When it is omitted (e.g. the Rcvd field is hidden for this row),
      // preserve the stored value so we never fabricate a diff or wipe existing data.
      const hasExplicitReceivedQty =
        item.receivedQty !== undefined && item.receivedQty !== null && String(item.receivedQty).trim() !== "";
      const newReceivedQty = actualColReceivedQty !== -1
        ? (hasExplicitReceivedQty ? (Number(String(item.receivedQty).replace(/,/g, '')) || 0) : existingReceivedQty)
        : 0;

      const newQty = Number(String(item.qty || item.cant || 0).replace(/,/g, '')) || 0;

      const newPrice = Number(item.price || 0);
      const newStatus = String(item.status || '').trim().toUpperCase();

      // 🔒 APPROVED QTY RESOLUTION — the heart of the quoted/approved split.
      //  * pre-approval  : the cell stays empty; the figure is stamped when the
      //                    line actually reaches Approved.
      //  * at approval   : stamp the quantity being approved (reduced or not).
      //  * post-approval : an explicit `approvedQty` from the client is a Manager
      //                    correction; otherwise the stored stamp is preserved.
      //                    A blank cell on an already-approved line means the row
      //                    predates this column, so the quoted qty is adopted.
      const hasExplicitApprovedQty =
        item.approvedQty !== undefined && item.approvedQty !== null && String(item.approvedQty).trim() !== "";
      const newApprovedOrLater = QUOTE_APPROVED_OR_LATER_.indexOf(newStatus) !== -1;
      const isApprovingNow = newStatus === 'APPROVED' && existingStatus !== 'APPROVED';
      // 🔒 THE FREEZE, evaluated on BOTH ends. Including the target status matters:
      // approving straight from this modal (Quoted -> Approved with a reduced Qty)
      // sends that reduced figure as `qty`, and without this the quoted quantity
      // would be overwritten — which is the exact data loss this split exists to
      // prevent. From here on the payload `qty` is read as the APPROVED figure.
      const quotedQtyFrozen = isQuoteQtyFrozen_(existingStatus) || newApprovedOrLater;
      let newApprovedQty = existingApprovedQty;
      if (newApprovedOrLater) {
        if (isApprovingNow || hasExplicitApprovedQty) {
          newApprovedQty = hasExplicitApprovedQty
            ? (Number(String(item.approvedQty).replace(/,/g, '')) || 0)
            : newQty;
        } else if (existingApprovedQty === 0) {
          newApprovedQty = existingSentQty; // legacy row: approved == quoted
        }
      }
      // Approving MORE than was quoted is a data-entry slip, and it would flow
      // straight into the store issue and the PO. The quoted figure is frozen at
      // this point, so it is rejected rather than silently raised.
      if (newApprovedOrLater && newApprovedQty > existingSentQty) {
        throw new Error(
          `[RECON LOCK] Approved qty (${newApprovedQty}) cannot exceed the quoted qty (${existingSentQty}).`
        );
      }

      // Which quantity the line total follows. Preserves the pre-split behaviour
      // exactly, where "Cant." doubled as both:
      //   receiving window open -> what physically arrived (hasExplicitReceivedQty)
      //   before approval        -> the quoted qty
      //   after approval         -> the APPROVED qty (previously held in "Cant.").
      // Without the last case a post-approval save — where the client echoes the
      // now-frozen quoted value back — would re-inflate the total to the quote.
      const totalBasisQty = hasExplicitReceivedQty
        ? newReceivedQty
        : (newApprovedOrLater ? newApprovedQty : newQty);

      // 💰 DISCOUNT + TRANSPORT RESOLUTION.
      // `undefined` = the client did not touch the field, so the stored value is
      // preserved; an explicit value is validated and applied. Unlike the quoted
      // quantity these NEVER freeze (a supplier can revise its discount, or add a
      // freight charge, at any point before the goods move), but the USER role is
      // read-only on both - same protection the price already has.
      const hasExplicitDiscountPct =
        item.discountPct !== undefined && item.discountPct !== null && String(item.discountPct).trim() !== "";
      let newDiscountPct = existingDiscountPct;
      if (hasExplicitDiscountPct) {
        const rawPct = Number(String(item.discountPct).replace(/[%\s,]/g, "").replace(",", "."));
        if (!isFinite(rawPct) || isNaN(rawPct)) {
          throw new Error(`[RECON LOCK] Discount for GEO ${item.origGeo || item.geo || "?"} is not a number: "${item.discountPct}".`);
        }
        if (rawPct < 0 || rawPct > QUOTE_MAX_DISCOUNT_PCT_) {
          throw new Error(`[RECON LOCK] Discount for GEO ${item.origGeo || item.geo || "?"} must be between 0% and 100% (got ${rawPct}%).`);
        }
        newDiscountPct = normalizeDiscountPct_(rawPct);
      }

      const hasExplicitFreight =
        item.freight !== undefined && item.freight !== null && String(item.freight).trim() !== "";
      let newFreight = existingFreight;
      if (hasExplicitFreight) {
        const rawFreight = Number(String(item.freight).replace(/[\s,]/g, "").replace(",", "."));
        if (!isFinite(rawFreight) || isNaN(rawFreight)) {
          throw new Error(`[RECON LOCK] Transport for GEO ${item.origGeo || item.geo || "?"} is not a number: "${item.freight}".`);
        }
        if (rawFreight < 0) {
          throw new Error(`[RECON LOCK] Transport for GEO ${item.origGeo || item.geo || "?"} cannot be negative (got ${rawFreight}).`);
        }
        if (rawFreight > QUOTE_MAX_FREIGHT_) {
          throw new Error(`[RECON LOCK] Transport for GEO ${item.origGeo || item.geo || "?"} exceeds the maximum allowed (${QUOTE_MAX_FREIGHT_}).`);
        }
        newFreight = normalizeFreight_(rawFreight);
      }

      // 🛎️ FIX (approval totals): the sheet owns "Total Neto" arithmetic. Clients
      // used to forward whatever total they had cached, so approving a quote with
      // an edited Qty wrote the new Cant. while keeping the OLD Total - the line
      // total and the quote's grand total therefore never updated.
      //   Total Neto = (Precio Unit. - Descuento %) x <basis qty>  [+ Transporte]
      // A zero unit price means the supplier quoted a lump sum, so whatever the
      // payload carries is preserved untouched rather than being zeroed out.
      //
      // The net unit price is derived (the quoted price is never overwritten), so
      // the discount automatically follows every later edit of the price. Freight
      // is a quote-level charge stored on every row but added to the totals ONCE,
      // by the carrier row only (see QUOTE_FREIGHT_HEADER_).
      const newNetUnitPrice = resolveNetUnitPrice_(newPrice, newDiscountPct);
      const newTotal = newPrice > 0
        ? resolveQuoteLineTotal_(newNetUnitPrice, totalBasisQty, newFreight, isThisFreightCarrier_)
        : (Number(item.total || 0) || 0);
      const newPn = String(item.pn || '').trim();
      const newGeo = String(item.geo || '').trim();
      const newSupplierQuoteNo = String(item.supplierQuoteNo || existingQuoteNo).trim();
      // `quotedDocUrl` is per line: each item keeps its own supplier quotation file,
      // so a supplier quoting part of the items in one file and the rest in another
      // ends up with a different document per row. An omitted/empty value PRESERVES
      // the stored link; only the explicit `clearQuotedDoc` flag blanks the cell
      // (that is what the per-line ✕ in the edit modal sends).
      const newQuotedDocUrl = item.clearQuotedDoc === true
        ? ''
        : String(item.quotedDocUrl || existingDocUrl).trim();

      // 🔒 MANDATORY PROOF FOR "Quoted": a line saved as Quoted MUST carry BOTH
      // the Supplier Quote No. and the supplier quotation PDF (the PDF is only
      // ever uploaded at the Quoted moment). Covers every entry path (edit
      // modal, compare-apply, resync, direct calls); the client blocks first,
      // this is the bypass-proof backstop.
      {
        const toStatus = String(newStatus || '').trim().toUpperCase();
        if (toStatus === 'QUOTED' && String(item.deleted || '') !== 'true' && item.deleted !== true) {
          const hasNo = String(newSupplierQuoteNo || '').trim() !== '';
          const hasDoc = String(newQuotedDocUrl || '').trim() !== '' && /^https?:\/\//i.test(String(newQuotedDocUrl || '').trim());
          if (!hasNo || !hasDoc) {
            throw new Error('[RECON LOCK] GEO ' + (newGeo || item.origGeo || '?') + ' saved as Quoted requires Supplier Quote No. AND the quotation document (' + (!hasNo ? 'missing Quote No.' : '') + (!hasNo && !hasDoc ? ' + ' : '') + (!hasDoc ? 'missing document' : '') + ').');
          }
        }
      }

      // Currency / exchange rate (metadata only): preserve the stored value unless the
      // payload carries an explicit new one. Price/Total stay in the supplier currency.
      let newCurrency = existingCurrency;
      if (item.currency !== undefined && item.currency !== null && String(item.currency).trim() !== '') {
        newCurrency = String(item.currency).trim();
      }
      let newRate = existingRate;
      const hasExplicitRate = item.exchangeRate !== undefined && item.exchangeRate !== null && String(item.exchangeRate).trim() !== '';
      if (hasExplicitRate) {
        const parsedRate = Number(item.exchangeRate);
        if (isFinite(parsedRate) && parsedRate >= 0) newRate = parsedRate;
      }

      const itemDiff = { index: rowIndex, quoteId: item.quoteId, origGeo: item.origGeo, diffs: {} };

      // ✅ NEW: Track diffs for both SENT and RECEIVED quantities (Phase 1.4)
      
      // Check sent quantity changes (should only happen by warehouse/manager)
      // 🔒 Never reported for a frozen line. The client echoes the stored quoted
      // qty back, and with the receiving window open it sends the RECEIVED quantity
      // as `qty` (QuoteMgmtJS.html) — neither is a re-quote, and reporting them
      // would trigger a spurious PDF regeneration and stock run on every save.
      if (!quotedQtyFrozen && Math.abs(existingSentQty - newQty) > 1e-6) {
        itemDiff.diffs.sentQty = {
          from: existingSentQty,
          to: newQty,
          reason: 'sent_qty_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      // Check approved quantity changes (stamped at approval, corrected after).
      // On a legacy row the first save backfills the column, which is why this
      // also raises hasAnyChange: without it the early "no changes" return would
      // skip the batch write and the backfill would never be persisted.
      if (colApprovedQty !== -1 && Math.abs(existingApprovedQty - newApprovedQty) > 1e-6) {
        itemDiff.diffs.approvedQty = {
          from: existingApprovedQty,
          to: newApprovedQty,
          reason: isApprovingNow ? 'approved_qty_stamped' : 'approved_qty_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      // Check received quantity changes (allowed for USER role after Despatched)
      if (actualColReceivedQty !== -1 && Math.abs(existingReceivedQty - newReceivedQty) > 1e-6) {
        itemDiff.diffs.receivedQty = { 
          from: existingReceivedQty, 
          to: newReceivedQty,
          reason: 'received_qty_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      // Check price changes (restricted for USER before Despatched)
      if (Math.abs(existingPrice - newPrice) > 1e-6) {
        itemDiff.diffs.price = { 
          from: existingPrice, 
          to: newPrice,
          reason: 'price_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      // Check total changes (auto-calculated based on received qty)
      if (Math.abs(existingTotal - newTotal) > 1e-6) {
        itemDiff.diffs.total = { 
          from: existingTotal, 
          to: newTotal,
          reason: 'total_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      // 💰 Discount / transport changes. Both move money, so both count as an
      // amount change: without this, entering a discount or a freight charge
      // would leave the generated quote PDF showing the stale (undiscounted)
      // subtotal, because only hasQtyAmountChange triggers a regeneration.
      if (Math.abs(existingDiscountPct - newDiscountPct) > 1e-9) {
        itemDiff.diffs.discountPct = {
          from: existingDiscountPct,
          to: newDiscountPct,
          reason: 'discount_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }
      if (Math.abs(existingFreight - newFreight) > 1e-9) {
        itemDiff.diffs.freight = {
          from: existingFreight,
          to: newFreight,
          reason: 'freight_changed'
        };
        hasQtyAmountChange = true;
        hasAnyChange = true;
      }

      if (existingStatus !== newStatus) {
        // 🔒 ADDED: Strict Sequential Status Forward-Only Enforcement
        if (!isValidQuoteItemStatusProgression(existingStatus, newStatus)) {
          throw new Error(`Invalid status transition from "${existingStatus}" to "${newStatus}". Status must move forward sequentially.`);
        }

        // 🔒 ISSUE-4: cross-supplier double-approval guard (server-side twin of
        // the compare modal's approvedByItem lock). Client state can be stale
        // or hand-built (e.g. the Edit modal's bulk "Apply to selected"), so
        // moving a line INTO Approved must fail when a DIFFERENT supplier
        // already holds this exact item (same Ref ID + GEO/PN) at
        // Approved-or-later — exactly the gap the UI block used to leave once
        // the winner advanced to Sent/Received/.... Same-supplier rows (e.g. a
        // re-sent RFQ round) and Deleted rows never block.
        if (newStatus === 'APPROVED' && existingStatus !== 'APPROVED') {
          // Caller context for the rival check (see findApprovedRival_).
          // Supplier: the row being saved carries the supplier value in the
          // payload item first, else the quote-level payload supplier, else the
          // stored row value. GEO/PN likewise prefer the stored row cells so a
          // mid-edit rename cannot dodge the match; blank-blank = unchecked.
          const rivalCtxSupplier = String(item.supplier || payload.supplier || (typeof row !== 'undefined' && colSupplier !== -1 ? row[colSupplier] : '') || '').trim();
          const rivalCtxGeo = String(existingGeo || item.geo || '').trim();
          const rivalCtxPn = String(existingPn || item.pn || item.p || '').trim();
          const rivalCtxOrder = String(item.orderId || payload.orderId || '').trim();
          // Same double guard against sheet state: read the stored Ref ID cell
          // (a payload with a blank orderId must not match half the sheet).
          const storedOrderForGuard = (typeof row !== 'undefined' && colRefId !== -1) ? String(row[colRefId] || '').trim() : '';
          const doubleWin = (rivalCtxGeo || rivalCtxPn) && (rivalCtxOrder || storedOrderForGuard) ? findApprovedRival_(rows || [], rowIndex, {
            col: function () {
              // Reuse updateQuoteWithItems' own header map (headers/findCol are
              // in scope here): Ref ID for the requirement, Proveedor for the
              // supplier, Geo Code + P/N for the item key, Estado for status.
              const names = Array.prototype.slice.call(arguments);
              for (let n = 0; n < names.length; n++) {
                const want = String(names[n] || '').trim().toLowerCase();
                const hit = headers.findIndex(function (h) { return String(h || '').trim().toLowerCase() === want; });
                if (hit !== -1) return hit;
              }
              return -1;
            },
            orderId: rivalCtxOrder || storedOrderForGuard,
            supplier: rivalCtxSupplier,
            geo: rivalCtxGeo,
            pn: rivalCtxPn,
          }) : null;
          if (doubleWin) {
            throw new Error(
              `[RECON LOCK] Item ${existingGeo || existingPn || '?'} of requirement ${payload.orderId || ''} is already approved from "${doubleWin.supplier}" (status ${doubleWin.status}). ` +
              `Mark that quote line as Deleted first if the award really moved to another supplier.`
            );
          }
        }

        itemDiff.diffs.status = { from: existingStatus, to: newStatus };
        hasAnyChange = true;
        // Enforce Manager/Admin approval for Approved transition
        if (newStatus.toUpperCase() === 'APPROVED' && editorRole !== 'MANAGER' && editorRole !== 'ADMIN') {
          throw new Error('Only users with Manager or Admin role can set Approved status. (email=' + editorEmail + ', resolvedRole=' + (editorRole || '(none)') + ')');
        }
      }

      if (existingPn !== newPn) {
        itemDiff.diffs.pn = { from: existingPn, to: newPn };
        hasAnyChange = true;
      }

      if (existingGeo !== newGeo) {
        itemDiff.diffs.geo = { from: existingGeo, to: newGeo };
        hasAnyChange = true;
      }

      const supplierQuoteNoChanged =
        normalizeQuoteNoForCompare_(newSupplierQuoteNo) !== existingQuoteNoKey;

      if (supplierQuoteNoChanged) {
        itemDiff.diffs.supplierQuoteNo = { from: existingQuoteNoKey, to: newSupplierQuoteNo };
        hasAnyChange = true;
      }

      if (newQuotedDocUrl !== existingDocUrl) {
        itemDiff.diffs.quotedDoc = { from: existingDocUrl, to: newQuotedDocUrl };
        hasAnyChange = true;
      }

      if (colCurrency !== -1 && newCurrency !== existingCurrency) {
        itemDiff.diffs.currency = { from: existingCurrency, to: newCurrency };
        hasAnyChange = true;
      }
      if (colExchangeRate !== -1 && Math.abs(newRate - existingRate) > 1e-9) {
        itemDiff.diffs.exchangeRate = { from: existingRate, to: newRate };
        hasAnyChange = true;
      }

      // 🔒 USER ROLE: Can only adjust receivedQty after Despatched status (Phase 1.4 - Validation)
      const currentStatus = String(existingStatus || '').trim().toUpperCase();
      const isDespatchedOrLater = ['DESPATCHED', 'RECEIVED', 'FINAL RECEIVED'].includes(currentStatus);

      if (editorRole === 'USER') {
        // 🔒 USER is read-only on the supplier discount and the transport charge:
        // both are commercial terms agreed with the supplier, so only a
        // Manager/Admin (or Office) may set them - same lock as the price.
        if (itemDiff.diffs.discountPct || itemDiff.diffs.freight) {
          throw new Error(
            `[RECON LOCK] USER role cannot modify the supplier discount or the transport charge.` +
            `Please contact your manager.`
          );
        }
        // If NOT despatched yet, restrict all changes except receivedQty tracking
        if (!isDespatchedOrLater) {
          // Block sentQty modifications for USER before Despatched
          if (itemDiff.diffs.sentQty && itemDiff.diffs.sentQty.from !== 0) {
            throw new Error(
              `[RECON LOCK] USER role cannot modify "Sent Qty" (${existingSentQty}). ` +
              `Please contact your manager to adjust sent quantities.`
            );
          }

          // Block price modifications for USER before Despatched
          if (itemDiff.diffs.price && itemDiff.diffs.price.from !== 0) {
            throw new Error(
              `[RECON LOCK] USER role cannot modify price until quote status reaches "Despatched".` +
              `Current status: ${currentStatus}`
            );
          }
        }

        // After Despatched: Allow receivedQty adjustments only (not sentQty or price)
        if (isDespatchedOrLater) {
          const userMadeReceivedChange = !!itemDiff.diffs.receivedQty;

          // If USER made any change to sentQty or price (not receivedQty), block it
          if (!userMadeReceivedChange && 
              (itemDiff.diffs.sentQty || itemDiff.diffs.price)) {
            throw new Error(
              `[RECON LOCK] USER role can only modify "Qty Received" field. ` +
              `You cannot change "Sent Qty" (${existingSentQty}) or Price.`
            );
          }

          // Block Geo/PN changes for USER (immutable after approval)
          if (itemDiff.diffs.geo || itemDiff.diffs.pn) {
            throw new Error(
              `[RECON LOCK] USER role cannot modify Geo Code or P/N. These fields are immutable.`
            );
          }
        }
      }

      // 🔒 RECEIVED QUANTITY WINDOW (site-aware): receivedQty may only be recorded
      // once the receiving window has opened for the quote's site.
      //  - Internal sites (Store/Workshop): from "Sent" onwards
      //  - Remote sites (unknown sites default to remote): from "Despatched" onwards
      const siteLabel = colSite !== -1 ? String(row[colSite] || '').trim() : '';
      const isInternalSite = isInternalReceivingSite(siteLabel);
      if (itemDiff.diffs.receivedQty) {
        if (isInternalSite) {
          const isSentOrLater = ['SENT', 'RECEIVED', 'DESPATCHED', 'FINAL RECEIVED'].includes(currentStatus);
          if (!isSentOrLater) {
            throw new Error(
              `[RECON LOCK] Received quantity can only be updated once the item status is "Sent" or later for site "${siteLabel || 'unknown'}". Current status: ${currentStatus}`
            );
          }
        } else {
          const isDespatchedOrLaterRemote = ['DESPATCHED', 'FINAL RECEIVED'].includes(currentStatus);
          if (!isDespatchedOrLaterRemote) {
            throw new Error(
              `[RECON LOCK] Received quantity can only be updated once the item status is "Despatched" or later for site "${siteLabel || 'unknown'}". Current status: ${currentStatus}`
            );
          }
        }
      }

      // ✅ APPLY UPDATES WITH BOTH SENT AND RECEIVED QUANTITIES (Phase 1.5)
      
      // Geo and PN can be updated (but restricted for USER - validated above)
      row[colGeo] = item.geo;
      row[colPn] = item.pn;

      // Description can be edited by all roles
      row[colDesc] = item.es;

      // ⚠️ IMPORTANT: Sent quantity is LOCKED after creation (warehouse/manager only)
      if (quotedQtyFrozen) {
        // 🔒 THE FREEZE. Post-approval "Cant." is the record of what was quoted and
        // must never move again: the client echoes it back, or sends the received
        // quantity when the receiving window is open. Either way the approved figure
        // goes to "Cant. Aprobado" instead, so the reduction stays visible.
        row[colQty] = existingSentQty;
      } else if (editorRole === 'USER' || !hasQtyAmountChange ||
          (itemDiff.diffs.receivedQty && !itemDiff.diffs.sentQty)) {
        // USER can only change receivedQty, not sentQty
        row[colQty] = existingSentQty; // Keep original sent quantity
      } else {
        // Manager/Admin or valid sentQty change
        row[colQty] = newQty;
      }

      // ✅ Approved quantity (stamped once at approval, corrected by a Manager later)
      if (colApprovedQty !== -1) {
        // Stay BLANK (not 0) while the line is still pre-approval: a 0 in this
        // column reads as "approved zero units" rather than "not approved yet".
        // resolveEffectiveQuoteQty_ treats blank and 0 identically, so nothing
        // downstream can tell the difference — only the sheet reader can.
        row[colApprovedQty] = (newApprovedOrLater || existingApprovedQty !== 0)
          ? newApprovedQty
          : '';
      }

      // ✅ NEW: Always update received quantity if column exists
      if (actualColReceivedQty !== -1) {
        row[actualColReceivedQty] = newReceivedQty;
      }

      // Price can be edited by all roles (or restricted by status for USER)
      row[colPrice] = newPrice;

      // Total = qty * price (use receivedQty for USER role after Despatched)
      if (editorRole === 'USER' && isDespatchedOrLater && actualColReceivedQty !== -1) {
        const effectiveQtyForTotal = Number(row[actualColReceivedQty]) || 0;
        row[colTotal] = Math.round(effectiveQtyForTotal * newPrice * 100) / 100;
      } else if (editorRole === 'USER' && !isDespatchedOrLater) {
        // Before Despatched: use sentQty for total calculation
        const effectiveQtyForTotal = Number(row[colQty]) || 0;
        row[colTotal] = Math.round(effectiveQtyForTotal * newPrice * 100) / 100;
      } else {
        // Normal case: use newTotal from payload
        row[colTotal] = newTotal;
      }

      row[colStatus] = item.status;
      // `undefined` means the client did not touch this line's Sub Category (the
      // edit-quote modal no longer exposes the field), so leave the stored cell
      // alone instead of blanking it. Both live callers still send a string.
      if (colSub !== -1 && item.subCategory !== undefined) {
        row[colSub] = item.subCategory || "";
      }

      // ✅ Write supplier quote no + quoted doc link (auto-filled per Quoted item).
      // When the value did not really change, leave the stored cell untouched so a
      // date-typed cell is not rewritten (and re-coerced) on every save.
      if (colRefCotiz !== -1) {
        row[colRefCotiz] = supplierQuoteNoChanged
          ? newSupplierQuoteNo
          : (row[colRefCotiz] || existingQuoteNo);
      }
      if (colQuotedDoc !== -1) row[colQuotedDoc] = newQuotedDocUrl;
      if (colCurrency !== -1) row[colCurrency] = newCurrency;
      if (colExchangeRate !== -1) row[colExchangeRate] = newRate;
      // 💰 Supplier discount (once per quote, replicated on every row) + transport
      // (quote-level, replicated on every row of the quote; only the carrier adds it to the totals).
      if (colDiscountPct !== -1) row[colDiscountPct] = newDiscountPct;
      if (colFreight !== -1) row[colFreight] = newFreight;

      if (Object.keys(itemDiff.diffs).length > 0) changedItems.push(itemDiff);
    });

    if (!hasAnyChange) {
      return { success: true, message: 'No changes detected.' };
    }

    // 🚀 Batch write updated rows
    __bgq(30, "Saving to sheet…");
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // Update metadata columns for changed rows: Last Modified, Mod Count, and Emails remain
    try {
      const colLastModBy = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'last modified by'.toLowerCase());
      const colLastModDate = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'last modified date'.toLowerCase());
      const colModCount = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'mod count'.toLowerCase());
      const colEmails = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'emails'.toLowerCase());

      changedItems.forEach(ci => {
        try {
          const r = ci.index; // zero-based into rows
          const sheetRow = r + 2;
          if (colLastModBy !== -1) sheet.getRange(sheetRow, colLastModBy + 1).setValue(editorEmail || '');
          if (colLastModDate !== -1) sheet.getRange(sheetRow, colLastModDate + 1).setValue(new Date());
          if (colModCount !== -1) {
            const prev = Number(rows[r][colModCount] || 0) || 0;
            sheet.getRange(sheetRow, colModCount + 1).setValue(prev + 1);
          }
        } catch (e) { console.warn('Failed updating meta for row: ' + e.toString()); }
      });
    } catch (e) {
      console.warn('Failed meta update: ' + e.toString());
    }

    // Prepare items for PDF (exclude deleted)
    const activeItems = payload.items.filter(item => String(item.status || '').toLowerCase() !== 'deleted');

    // If all deleted, append audit and return
    if (activeItems.length === 0) {
      try {
        const logSheet = ss.getSheetByName('QuoteLog') || ss.insertSheet('QuoteLog');
        const colModCountIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'mod count');
        let logModCount = 0;
        if (colModCountIdx !== -1 && changedItems && changedItems.length) {
          const firstIdx = changedItems[0].index;
          logModCount = Number(rows[firstIdx] && rows[firstIdx][colModCountIdx] ? rows[firstIdx][colModCountIdx] : 0) + 1;
        }
        logSheet.appendRow([new Date(), payload.quoteId || '', payload.orderId || '', editorEmail || '', JSON.stringify(changedItems), logModCount, false]);
      } catch (e) { console.warn('Failed writing QuoteLog: ' + e.toString()); }

      // Deleted lines still release a reservation taken while Pending.
      try {
        const deletedMovements = buildQuoteStockMovements_(payload, changedItems, rows, colSite);
        if (deletedMovements.length > 0) {
          processQuoteStockUpdate(deletedMovements, payload.currentUserEmail || "System");
        }
      } catch (e) {
        console.warn('Quote stock integration (all deleted) failed: ' + e.toString());
      }

      return { success: true, message: 'All items deleted. No PDF generated.', pdfUrl: '' };
    }

    // Only regenerate PDF if qty/price/total changed
    let newPdfUrl = '';
    if (hasQtyAmountChange) {
      __bgq(55, "Building PDF…");
      const orderId = payload.orderId;
      const quoteId = payload.items[0].quoteId;

      const quoteData = {
        orderId: orderId,
        quoteId: quoteId,
        site: '',
        supplier: payload.supplier || '',
        quoteFileName: 'RFQ_' + orderId + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'),
        supplier: payload.supplier || '',
        category: payload.category || 'General',
        status: payload.status || 'Pending',
        items: activeItems.map(item => ({
          geo: item.geo || '',
          pn: item.pn || '',
          es: item.es || '',
          // 🔒 Print the APPROVED quantity once the line is approved: `item.qty` is
          // now the (frozen) quoted figure, so using it verbatim would put the full
          // quote on a document issued for a reduced approval.
          qty: resolveEffectiveQuoteQty_(item.qty, item.approvedQty),
          price: Number(item.price || 0),
          total: Number(item.total || 0),
          lineTotal: Number(item.total || 0),
          category: item.category || '',
          subCategory: item.subCategory || '',
          status: item.status || 'Pending'
        }))
      };

      // 💰 SUPPLIER DISCOUNT + TRANSPORT on the generated document.
      //
      // The PDF footer (generateQuotePDF) already computes
      //     Total = Subtotal - Descuento + Transporte + IVA
      // from quote-level `discount` / `freight` fields that nothing used to
      // populate. The line rows keep the QUOTED unit price, so the discount is
      // reported once as a single deduction in the footer rather than being
      // baked into every line (which would make the printed line prices
      // disagree with the supplier's own quotation).
      //
      // Discount amount per line = quoted price x printed qty x pct / 100.
      // The printed qty is the APPROVED one once approved (see above), so the
      // printed discount is the money actually granted on what we sign off for.
      const pdfItems = activeItems.map((item) => ({
        geo: item.geo || '',
        pn: item.pn || '',
        es: item.es || '',
        qty: resolveEffectiveQuoteQty_(item.qty, item.approvedQty),
        price: Number(item.price || 0),
        total: Number(item.total || 0),
        lineTotal: Number(item.total || 0),
        category: item.category || '',
        subCategory: item.subCategory || '',
        status: item.status || 'Pending',
        discountPct: normalizeDiscountPct_(item.discountPct),
      }));
      quoteData.items = pdfItems;
      quoteData.discount = Math.round(
        pdfItems.reduce(function (sum, it) {
          return sum + (Number(it.price || 0) * Number(it.qty || 0) * normalizeDiscountPct_(it.discountPct) / 100);
        }, 0) * 100
      ) / 100;
      // Transport is a single charge for the whole quote: taken from the carrier
      // line only, so it can never be printed N times. Falls back to the first
      // line holding a value if the carrier was filtered out as Deleted.
      let quoteFreight = 0;
      for (let i = 0; i < activeItems.length; i++) {
        if (activeItems[i] === payload.items[freightCarrierItemIndex_] || normalizeFreight_(activeItems[i].freight) > 0) {
          quoteFreight = normalizeFreight_(activeItems[i].freight);
          break;
        }
      }
      quoteData.freight = quoteFreight;

      // Load metadata from first matching row
      const originalRow = rows.find(r => clean(r[colQuoteId]) === clean(payload.items[0].quoteId));
      if (originalRow) {
        const colSupplier = findCol('Proveedor');
        const colSite = findCol('Faena');
        const colBuyer = findCol('Comprador');
        const colComments = findCol('Comments');
        const colCurrency = findCol('Moneda');
        const colCondicion = findCol('Condicion Pago');
        const colIva = findCol('IVA INC');

        quoteData.supplier = originalRow[colSupplier] || quoteData.supplier;
        quoteData.site = originalRow[colSite] || '';
        quoteData.comprador = originalRow[colBuyer] || '';
        quoteData.comments = originalRow[colComments] || '';
        quoteData.currency = originalRow[colCurrency] || 'CLP';
        quoteData.condicionPago = originalRow[colCondicion] || '';
        quoteData.ivaInc = originalRow[colIva] || 'Neto';
      }

      const targetFolder = getQuoteTargetFolder_(quoteData.site, quoteData.supplier);
      newPdfUrl = generateQuotePDF(quoteData, targetFolder);

      if (newPdfUrl) {
        const colPdf = findCol('PDF Link');
        rows.forEach((row, i) => {
          if (clean(row[colQuoteId]) === clean(payload.items[0].quoteId)) {
            sheet.getRange(i + 2, colPdf + 1).setValue(newPdfUrl);
          }
        });
      }
    }

    // Send notification email for any change
    // 🚦 CONFIG GATE: governed by the "Quo Email" master switch plus one
    // TRUE/FALSE flag per status in the Config sheet. The email is sent when
    // AT LEAST ONE item of this quote has its status flag enabled (`rows` is
    // already the post-write data, so these are the statuses just saved) and
    // skipped only when every item sits on a no-send status.
    const emailGate = shouldSendQuoteChangeEmail_(
      rows.filter(r => clean(r[colQuoteId]) === clean(payload.items[0].quoteId)),
      colStatus,
      getQuoteEmailStatusFlags_()
    );
    if (!emailGate.send) {
      console.log('📧 Quote-change email skipped — ' + emailGate.reason +
        (emailGate.statuses.length ? ' [' + emailGate.statuses.join(', ') + ']' : '') + '.');
    }
    if (emailGate.send) {
      __bgq(75, "Sending email…");
      try {
        const originalRow = rows.find(r => clean(r[colQuoteId]) === clean(payload.items[0].quoteId));
        const colBuyer = findCol('Comprador');
        const buyerEmail = originalRow ? originalRow[colBuyer] : '';
        const colSupplier = findCol('Proveedor');
        const colSite = findCol('Faena');
        const supplierName = originalRow ? String(originalRow[colSupplier] || payload.supplier || 'N/A') : String(payload.supplier || 'N/A');
        const siteName = originalRow ? String(originalRow[colSite] || '') : '';
        // Prefer persisted Emails column on Quotes if present (initial recipients)
        let toEmail = (buyerEmail && String(buyerEmail).trim()) || 'procurement@yourcompany.com';
        try {
          const colEmailsIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'emails');
          if (colEmailsIdx !== -1 && originalRow && String(originalRow[colEmailsIdx] || '').trim()) {
            toEmail = String(originalRow[colEmailsIdx] || '').trim();
          }
        } catch (e) { /* ignore */ }

        const changeSummaryHtml = buildQuoteChangeSummaryHtml_(changedItems);
        const emailBody = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 700px;">
            <h3 style="margin: 0 0 12px 0; color: #0b4f8a;">Quote Updated</h3>
            <p style="margin: 0 0 8px 0;"><strong>Quote ID:</strong> ${escapeHtml_(payload.quoteId || '')}</p>
            <p style="margin: 0 0 8px 0;"><strong>Supplier:</strong> ${escapeHtml_(supplierName)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Site:</strong> ${escapeHtml_(siteName || '-')}</p>
            <p style="margin: 0 0 12px 0;"><strong>Updated by:</strong> ${escapeHtml_(editorEmail || 'system')}</p>
            <div style="margin-top: 8px;">${changeSummaryHtml}</div>
          </div>
        `;

        const mail = {
          type: 'QuoteEdit',
          refId: payload.quoteId || payload.orderId || '',
          to: toEmail,
          subject: 'Quote Updated: ' + (payload.quoteId || ''),
          body: emailBody,
          replyTo: 'noreply@recon.cl',
          senderEmail: editorEmail || Session.getActiveUser().getEmail(),
          fallbackProvider: String(payload.fallbackProvider || '')
        };

        if (hasQtyAmountChange && newPdfUrl) {
          mail.pdfUrl = newPdfUrl;
        }

        const dispatchResult = SmartDispatcher(mail);
        if (dispatchResult && dispatchResult.requiresFallbackChoice) {
          return {
            success: true,
            emailSent: false,
            requiresFallbackChoice: true,
            graphError: dispatchResult.graphError || dispatchResult.message || 'Graph send failed',
            emailError: dispatchResult.graphError || dispatchResult.message || 'Graph send failed',
            dispatchDraft: mail,
            pdfUrl: newPdfUrl || ''
          };
        }

        if (!dispatchResult.success) {
          return {
            success: true,
            emailSent: false,
            emailError: dispatchResult.message || 'Email send failed',
            pdfUrl: newPdfUrl || ''
          };
        }
      } catch (e) {
        console.warn('Failed to send change notification: ' + e.toString());
      }
    }

    // Audit log
    try {
      const logSheet = ss.getSheetByName('QuoteLog') || ss.insertSheet('QuoteLog');
      const colModCountIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'mod count');
      let logModCount = 0;
      if (colModCountIdx !== -1 && changedItems && changedItems.length) {
        const firstIdx = changedItems[0].index;
        logModCount = Number(rows[firstIdx] && rows[firstIdx][colModCountIdx] ? rows[firstIdx][colModCountIdx] : 0) + 1;
      }
      const pdfFlag = !!newPdfUrl;
      logSheet.appendRow([new Date(), payload.quoteId || '', payload.orderId || '', editorEmail || '', JSON.stringify(changedItems), logModCount, pdfFlag]);
    } catch (e) { console.warn('Failed writing QuoteLog: ' + e.toString()); }

    // ======================
    // === STOCK INTEGRATION ===
    // ======================
    // Only the lines that really moved are handed over. Passing the whole payload
    // (which `updateQuoteWithItems` used to do) re-posted the WarehouseReceipt of
    // every line already sitting at "Received" on each save — that is what wrote
    // the duplicate Store stock entries.
    try {
      __bgq(88, "Updating stock…");
      const stockMovements = buildQuoteStockMovements_(payload, changedItems, rows, colSite);
      if (stockMovements.length > 0) {
        const stockResult = processQuoteStockUpdate(stockMovements, payload.currentUserEmail || "System");
        if (stockResult && Array.isArray(stockResult.warnings) && stockResult.warnings.length > 0) {
          console.warn("Quote stock warnings: " + stockResult.warnings.join(" | "));
        }
      }
    } catch (e) {
      console.warn('Quote stock integration failed: ' + e.toString());
    }

    if (__bgJobId) {
      try {
        bgFinishJob(__bgJobId, true, {
          pdfUrl: newPdfUrl || '',
          result: { quoteId: payload.quoteId || '', orderId: payload.orderId || '', pdfUrl: newPdfUrl || '' }
        });
      } catch (e) {}
    }
    return { success: true, pdfUrl: newPdfUrl || '' };
  } catch (e) {
    __bgqFail("Quote save failed", e);
    throw new Error('updateQuoteWithItems failed: ' + e.toString());
  } finally {
    try { if (__lockHeld) lock.releaseLock(); } catch (er) { /* ignore */ }
  }
}

/**
 * ONE-OFF REPAIR — reverse duplicated quote-driven stock movements.
 *
 * The previous stock integration re-posted the same movement on every save of a
 * quote (see the 17/09/2026 REQ-0004-WRK case: two WarehouseReceipt rows per item),
 * so StockLedger can hold 2+ identical rows for the same
 * (ItemID | TransactionType | ReferenceID). This walks the ledger, keeps the FIRST
 * posting of each group and reverses every extra row that is an exact copy of it
 * (same amount) with an opposite movement of the same type — so the ledger total
 * matches the quote again and future saves stay quiet.
 *
 * Rows it will not touch automatically (a different amount, reservation pairs,
 * unparsable location) are listed in `skipped` for a human decision.
 *
 * Usage from the Apps Script editor:
 *   reverseDuplicateQuoteReceipts();        // dry run — reports what it would do
 *   reverseDuplicateQuoteReceipts(false);   // applies the corrections
 */
function reverseDuplicateQuoteReceipts(dryRun) {
  const apply = dryRun === false;
  const report = {
    apply: apply,
    scannedLedgerRows: 0,
    quoteMovementRows: 0,
    movementGroups: 0,
    duplicatesFound: 0,
    reversed: [],
    skipped: []
  };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockLedger");
  if (!sheet) {
    console.warn("reverseDuplicateQuoteReceipts: StockLedger sheet not found.");
    return report;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return report;

  // Columns: A=LedgerID, C=ItemID, E=From, G=Change, I=TransactionType,
  //          J=ReferenceID, K=ReferenceType
  const values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  report.scannedLedgerRows = values.length;

  // Post a plain signed quantity and can therefore be reversed automatically.
  const reversibleTypes = { warehousereceipt: true, issuetosite: true };
  // A reservation is a reserve/unreserve PAIR: reversing only one half would leave
  // ReservedQty wrong, so these are reported, never reversed automatically.
  const reportOnlyTypes = { reservestock: true, unreservestock: true };

  const groups = {};
  values.forEach(function (row, i) {
    const itemId = String(row[2] || "").trim();
    const from = String(row[4] || "").trim();
    const change = Number(row[6]) || 0;
    const type = String(row[8] || "").trim();
    const typeKey = type.toLowerCase();
    const referenceId = String(row[9] || "").trim();
    const referenceType = String(row[10] || "").trim().toLowerCase();

    if (!itemId || !referenceId || referenceType !== "quote") return;
    if (!reversibleTypes[typeKey] && !reportOnlyTypes[typeKey]) return;
    report.quoteMovementRows++;

    const key = itemId.toLowerCase() + "|" + typeKey + "|" + referenceId.toLowerCase();
    if (!groups[key]) {
      groups[key] = { itemId: itemId, type: type, referenceId: referenceId, rows: [] };
    }
    groups[key].rows.push({
      sheetRow: i + 2,
      ledgerId: String(row[0] || "").trim(),
      change: change,
      from: from
    });
  });

  const describe = function (g, extra, why) {
    return g.itemId + " / " + g.referenceId + " / " + g.type +
      " / " + (extra.ledgerId || ("row " + extra.sheetRow)) + " — " + why;
  };

  Object.keys(groups).forEach(function (key) {
    const g = groups[key];
    report.movementGroups++;
    if (g.rows.length < 2) return;

    const first = g.rows[0];
    const typeKey = g.type.toLowerCase();

    for (let i = 1; i < g.rows.length; i++) {
      const extra = g.rows[i];

      if (Math.abs(extra.change - first.change) > 1e-9) {
        report.skipped.push(describe(g, extra,
          "different amount (" + extra.change + " vs " + first.change + ") — review manually"));
        continue;
      }

      if (!reversibleTypes[typeKey]) {
        report.skipped.push(describe(g, extra,
          "reservation duplicate — release/pair the reservation manually"));
        continue;
      }

      const parts = extra.from.split("/");
      if (parts.length < 2 || !String(parts[0]).trim() || !String(parts[1]).trim()) {
        report.skipped.push(describe(g, extra,
          "unparsable location '" + extra.from + "' — review manually"));
        continue;
      }

      report.duplicatesFound++;

      if (!apply) {
        report.reversed.push({
          ledgerId: extra.ledgerId,
          itemId: g.itemId,
          type: g.type,
          referenceId: g.referenceId,
          reversalChange: -extra.change,
          applied: false
        });
        continue;
      }

      try {
        updateStock(
          g.itemId,
          String(parts[0]).trim(),
          String(parts[1]).trim(),
          -extra.change,
          g.type,
          g.referenceId,
          "QuoteRepair",
          "Reversal of duplicate " + g.type + " " + extra.ledgerId + " (" + g.referenceId + ")",
          "System"
        );
        __quoteStockLedgerPostTotals = null; // next lookup must see the reversal
        report.reversed.push({
          ledgerId: extra.ledgerId,
          itemId: g.itemId,
          type: g.type,
          referenceId: g.referenceId,
          reversalChange: -extra.change,
          applied: true
        });
        console.log("Reversed duplicate " + g.type + " " + extra.ledgerId +
          " for " + g.itemId + " / " + g.referenceId + " (" + (-extra.change) + ")");
      } catch (e) {
        report.skipped.push(describe(g, extra, "reversal failed: " + e.toString()));
      }
    }
  });

  console.log(JSON.stringify(report, null, 2));
  return report;
}

// ============================================================
// PO CREATION REMINDER — requirement + approver resolvers
// The reminder body needs two pieces of data that do NOT live on
// the Quotes sheet:
//   * "Solicitado por" + "Sub Area" -> live on the requirement row
//     in Ordenes (columns "User" and "SubArea").
//   * "Approved By" -> the Quotes sheet records only the status,
//     never who set it. It is recovered from the QuoteLog audit
//     sheet (last entry for this quote that moved a line to
//     "Approved", column 4 = editor email).
// Both resolvers are best-effort: a missing sheet or column must
// never break the draft, they simply yield "".
// ============================================================

/**
 * Reads { user, subArea } for a requirement from the Ordenes sheet.
 * Headers are matched by name (same approach as getRequirementData)
 * so a column reorder does not silently shift the values.
 * @return {{user: string, subArea: string}}
 */
function resolveReqOrderMeta_(orderId) {
  const result = { user: "", subArea: "", subAreaNo: "" };
  const oid = String(orderId || "").trim();
  if (!oid) return result;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    if (!sheet) return result;

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return result;

    const colMap = {};
    values[0].forEach(function (h, i) {
      const k = String(h || "").trim();
      if (k && !(k in colMap)) colMap[k] = i;
    });
    // Positional fallbacks follow the documented Ordenes layout (ID=1, User=9).
    // SubArea / SubArea No are optional columns created later, hence name-only.
    const userIdx = colMap["User"] !== undefined ? colMap["User"] : 8;
    const subAreaIdx = colMap["SubArea"] !== undefined ? colMap["SubArea"] : -1;
    const subAreaNoIdx = colMap["SubArea No"] !== undefined ? colMap["SubArea No"] : -1;
    const idIdx = colMap["ID"] !== undefined ? colMap["ID"] : 0;

    for (let i = 1; i < values.length; i++) {
      const rowId = String(values[i][idIdx] == null ? "" : values[i][idIdx]).trim();
      if (!rowId || rowId !== oid) continue;
      result.user = userIdx === -1 ? "" : String(values[i][userIdx] == null ? "" : values[i][userIdx]).trim();
      result.subArea = subAreaIdx === -1 ? "" : String(values[i][subAreaIdx] == null ? "" : values[i][subAreaIdx]).trim();
      // The SubArea folio ("SubArea No") is what the buyer quotes back, so it
      // must travel with the name in the reminder.
      result.subAreaNo = subAreaNoIdx === -1 ? "" : String(values[i][subAreaNoIdx] == null ? "" : values[i][subAreaNoIdx]).trim();
      break;
    }
  } catch (e) {
    console.warn("resolveReqOrderMeta_ failed for " + oid + ": " + e.toString());
  }
  return result;
}

/**
 * Recovers WHO approved this quote from the QuoteLog audit sheet.
 * The log stores [date, quoteId, orderId, editorEmail, changedItemsJson,
 * modCount, pdfFlag], where changedItemsJson is an array of item diffs shaped
 * like { index, quoteId, origGeo, diffs: { status: { from, to } } }.
 *
 * Only a genuine Quoted -> Approved transition counts as "the approver": a
 * plain text search for "Approved" also matches any later save that merely
 * re-touched an already-approved row, which made the reminder show the wrong
 * person.
 *
 * Matching is done on a SET of quote ids, not one id. A card groups rows that
 * may carry different Quote IDs (a re-sent RFQ writes a fresh id per round),
 * and the card id shown in the UI is the NEWEST one — while the log recorded
 * whichever id was live when the approval happened. Matching a single id
 * therefore missed the approval whenever the two differed.
 *
 * Entries are scanned BACKWARDS so the most recent approval wins. Rows are
 * ranked: same quote id beats same requirement (a requirement can hold several
 * supplier quotes, each approved by someone different).
 *
 * @param {string|string[]} quoteIds acceptable quote ids (any match wins)
 * @return {string} the approver's email, or "" when no approval was recorded
 */
function resolveApprovedBy_(quoteIds, orderId) {
  const wanted = (Array.isArray(quoteIds) ? quoteIds : [quoteIds])
    .map(function (q) { return String(q || "").trim().toLowerCase(); })
    .filter(Boolean);
  const oid = String(orderId || "").trim();
  if (!wanted.length && !oid) return "";

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("QuoteLog");
    if (!sheet) return "";

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return "";

    // Collect every candidate first (backwards), then pick the best rank so a
    // late same-requirement entry cannot outrank an exact quote-id match.
    let bestRank = 0, bestEmail = "";
    for (let i = values.length - 1; i >= 1; i--) {
      const rowQid = String(values[i][1] == null ? "" : values[i][1]).trim().toLowerCase();
      const rowOid = String(values[i][2] == null ? "" : values[i][2]).trim();
      const editor = String(values[i][3] == null ? "" : values[i][3]).trim();
      const payload = String(values[i][4] == null ? "" : values[i][4]);
      if (!editor || !payload) continue;

      const qidMatch = rowQid && wanted.indexOf(rowQid) !== -1;
      // A consolidated requirement ref ("100123+100127") must match any part.
      const oidMatch = oid && rowOid &&
        (rowOid === oid || String(oid).split("+").some(function (p) { return p.trim() && p.trim() === rowOid; }));
      if (!qidMatch && !oidMatch) continue;

      let diffs = [];
      try {
        const parsed = JSON.parse(payload);
        diffs = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch (e) {
        continue; // Unparseable legacy row: not a reliable approval record.
      }

      const isApproval = diffs.some(function (it) {
        const st = it && it.diffs && it.diffs.status;
        if (!st) return false;
        return String(st.from || "").trim() === "Quoted" &&
               String(st.to || "").trim() === "Approved";
      });
      if (!isApproval) continue;

      // Rank 2 = exact quote-id match, rank 1 = same requirement only.
      const rank = qidMatch ? 2 : 1;
      if (rank > bestRank) { bestRank = rank; bestEmail = editor; }
      // Stop as soon as an exact match is found (we scan newest-first).
      if (bestRank === 2) break;
    }
    return bestEmail;
  } catch (e) {
    console.warn("resolveApprovedBy_ failed for " + orderId + ": " + e.toString());
  }
  return "";
}

/**
 * Timeline detail for ONE supplier quote: approval + first quotation-doc upload,
 * recovered from QuoteLog ([date, quoteId, orderId, editor, changedItemsJson]).
 * Fail-open: missing sheet/rows yield "" fields, never throws.
 */
function resolveQuoteTimelineEvents_(quoteIds, orderId, supplier) {
  const out = { approvedBy: "", approvedByName: "", approvedDate: "", approvedIso: "",
    uploadedBy: "", uploadedByName: "", uploadedDate: "", uploadedIso: "" };
  const wanted = (Array.isArray(quoteIds) ? quoteIds : [quoteIds])
    .map(function (q) { return String(q || "").trim().toLowerCase(); }).filter(Boolean);
  const oid = String(orderId || "").trim();
  if (!wanted.length && !oid) return out;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName("QuoteLog") : null;
    if (!sheet) return out;
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return out;
    const fmtLog = function (v) {
      if (Object.prototype.toString.call(v) === "[object Date]") {
        if (isNaN(v.getTime())) return { text: "", iso: "" };
        try { return { text: Utilities.formatDate(v, Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm"), iso: v.toISOString() }; }
        catch (e) { return { text: String(v), iso: "" }; }
      }
      const raw = String(v == null ? "" : v).trim();
      if (!raw) return { text: "", iso: "" };
      return { text: raw, iso: "" };
    };
    let bestRank = 0, firstUploadRow = -1;
    for (let i = values.length - 1; i >= 1; i--) {
      const rowQid = String(values[i][1] == null ? "" : values[i][1]).trim().toLowerCase();
      const rowOid = String(values[i][2] == null ? "" : values[i][2]).trim();
      const editor = String(values[i][3] == null ? "" : values[i][3]).trim();
      const payload = String(values[i][4] == null ? "" : values[i][4]);
      if (!payload) continue;
      const qidMatch = rowQid && wanted.indexOf(rowQid) !== -1;
      const oidMatch = oid && rowOid &&
        (rowOid === oid || String(oid).split("+").some(function (p) { return p.trim() && p.trim() === rowOid; }));
      if (!qidMatch && !oidMatch) continue;
      let diffs = [];
      try { const parsed = JSON.parse(payload); diffs = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []); }
      catch (e) { continue; }
      const isAppr = diffs.some(function (it) {
        const st = it && it.diffs && it.diffs.status;
        return st && String(st.from || "").trim() === "Quoted" && String(st.to || "").trim() === "Approved";
      });
      const hasUp = diffs.some(function (it) {
        const d = it && it.diffs && it.diffs.quotedDoc;
        return d && String(d.to || "").trim() !== "";
      });
      if (isAppr && editor) {
        const rank = qidMatch ? 2 : 1;
        if (rank > bestRank) {
          bestRank = rank;
          const dt = fmtLog(values[i][0]);
          out.approvedBy = editor; out.approvedDate = dt.text; out.approvedIso = dt.iso;
        }
      }
      if (hasUp) firstUploadRow = i;
    }
    if (firstUploadRow !== -1) {
      const ed = String(values[firstUploadRow][3] == null ? "" : values[firstUploadRow][3]).trim();
      const dt = fmtLog(values[firstUploadRow][0]);
      out.uploadedBy = ed; out.uploadedDate = dt.text; out.uploadedIso = dt.iso;
    }
    try {
      if (out.approvedBy) out.approvedByName = resolveUserName_(out.approvedBy);
      if (out.uploadedBy) out.uploadedByName = resolveUserName_(out.uploadedBy);
    } catch (e) { /* keep emails */ }
    if (!out.approvedByName) out.approvedByName = out.approvedBy;
    if (!out.uploadedByName) out.uploadedByName = out.uploadedBy;
  } catch (e) { console.warn("resolveQuoteTimelineEvents_ failed: " + e.toString()); }
  return out;
}

/**
 * Full date timeline of ONE requirement for the info modal. Reuses
 * getQuotesHistory() and enriches each supplier card with QuoteLog events.
 * Req approval: no Ordenes audit exists -> "" (client prints "-").
 */
function getReqQuoteTimeline(orderId) {
  const oid = String(orderId || "").trim();
  const empty = { orderId: oid, reqCreated: "", reqCreatedIso: "", reqApprovedBy: "",
    reqApprovedDate: "", reqLastModifiedBy: "", reqLastModified: "",
    reqLastModifiedIso: "", reqModCount: 0, quotes: [] };
  try {
    const all = getQuotesHistory().filter(function (r) {
      return String((r && r.orderId) || "").trim() === oid;
    });
    if (!all.length) return empty;
    const cards = {};
    all.forEach(function (r) {
      const key = [String(r.orderId || "").trim(), String(r.supplier || "").trim(),
        String(r.category || "").trim().toUpperCase()].join("|");
      if (!cards[key]) cards[key] = { supplier: r.supplier || "", quoteIds: [], rows: [] };
      const c = cards[key];
      const qid = String(r.quoteId || "").trim();
      if (qid && c.quoteIds.indexOf(qid) === -1) c.quoteIds.push(qid);
      c.rows.push(r);
    });
    let reqCreated = "", reqCreatedIso = "", reqMod = "", reqModIso = "", reqModBy = "", reqModCount = 0;
    all.forEach(function (r) {
      const cIso = String(r.reqDateIso || "").trim(), cRaw = String(r.reqDate || "").trim();
      if (cIso && (!reqCreatedIso || cIso < reqCreatedIso)) { reqCreatedIso = cIso; reqCreated = cRaw; }
      else if (!reqCreated && !reqCreatedIso && cRaw) { reqCreated = cRaw; }
      const mIso = String(r.reqLastModifiedIso || "").trim(), mRaw = String(r.reqLastModified || "").trim();
      if ((mRaw || mIso) && (!reqMod || (mIso && (!reqModIso || mIso > reqModIso)))) { reqMod = mRaw; reqModIso = mIso; }
      if (!reqModBy && r.reqLastModifiedBy) reqModBy = String(r.reqLastModifiedBy);
      if ((Number(r.reqModCount) || 0) > reqModCount) reqModCount = Number(r.reqModCount) || 0;
    });
    const quotes = Object.keys(cards).map(function (k) {
      const c = cards[k];
      const ev = resolveQuoteTimelineEvents_(c.quoteIds, oid, c.supplier);
      // Card audit: earliest created + newest modified across its rows.
      let cd = "", ci = "", cb = "", cbn = "", md = "", mi = "", mb = "", mbn = "", mc = 0;
      c.rows.forEach(function (r) {
        const cI = String(r.createdIso || "").trim();
        if ((r.createdDate || cI) && (!cd || (cI && (!ci || cI < ci)))) {
          cd = String(r.createdDate || "").trim(); ci = cI;
          cb = String(r.createdBy || "").trim(); cbn = String(r.createdByName || r.createdBy || "").trim();
        }
        const mI = String(r.lastModifiedIso || "").trim();
        if ((r.lastModifiedDate || mI) && (!md || (mI && (!mi || mI > mi)))) {
          md = String(r.lastModifiedDate || "").trim(); mi = mI;
          mb = String(r.lastModifiedBy || "").trim(); mbn = String(r.lastModifiedByName || r.lastModifiedBy || "").trim();
        }
        if ((Number(r.modCount) || 0) > mc) mc = Number(r.modCount) || 0;
      });
      return { supplier: c.supplier, quoteId: c.quoteIds.length ? c.quoteIds[c.quoteIds.length - 1] : "",
        createdDate: cd, createdBy: cbn || cb, lastModifiedDate: md,
        lastModifiedBy: mbn || mb, modCount: mc,
        uploadedDate: ev.uploadedDate, uploadedBy: ev.uploadedByName || ev.uploadedBy,
        approvedBy: ev.approvedByName || ev.approvedBy, approvedDate: ev.approvedDate };
    });
    empty.reqCreated = reqCreated; empty.reqCreatedIso = reqCreatedIso;
    empty.reqLastModifiedBy = reqModBy; empty.reqLastModified = reqMod;
    empty.reqLastModifiedIso = reqModIso; empty.reqModCount = reqModCount;
    empty.quotes = quotes;
    return empty;
  } catch (e) { console.warn("getReqQuoteTimeline failed: " + e.toString()); return empty; }
}

/**
 * Maps an editor email to the person's display name using the Users sheet.
 * Layout (per saveDataToSheet in Código.js): A UserId, B Pin, C Full Name,
 * D Email, E Phone, F Position, G Site, H Role, I Sign, J Active.
 * Headers are matched by name with the documented positional fallback so a
 * missing header row still resolves.
 * @return {string} full name, or the email itself when the user is unknown
 */
function resolveUserName_(email) {
  const mail = String(email || "").trim();
  if (!mail) return "";
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    if (!sheet) return mail;
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return mail;

    const colMap = {};
    data[0].forEach(function (h, i) {
      const k = String(h || "").trim().toLowerCase();
      if (k && !(k in colMap)) colMap[k] = i;
    });
    const emailIdx = colMap["email"] !== undefined ? colMap["email"] : 3;
    const nameIdx = colMap["name"] !== undefined ? colMap["name"]
      : (colMap["full name"] !== undefined ? colMap["full name"] : 2);

    const target = mail.toLowerCase();
    for (let i = 1; i < data.length; i++) {
      const rowMail = String(data[i][emailIdx] == null ? "" : data[i][emailIdx]).trim();
      if (rowMail.toLowerCase() !== target) continue;
      const nm = String(data[i][nameIdx] == null ? "" : data[i][nameIdx]).trim();
      return nm || mail;
    }
  } catch (e) {
    console.warn("resolveUserName_ failed for " + mail + ": " + e.toString());
  }
  return mail;
}

/** Fallback attachment name for the supplier document (no Drive access). */
function docFileNameFallback(quoteId, orderId) {
  return "Cotizacion_" + String(quoteId || orderId).replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Builds a "ReqID||GEO" -> { itemNotes, supplierNotes } index from Ordenes.
 *
 * The two per-item note columns ("Item Notes" and "Supplier Notes") live on the
 * Ordenes sheet, NOT on Quotes — they are unique per requirement row
 * (orderId + GEO). getQuotesHistory already joins them onto quote rows with
 * this exact key; the PO reminder works from raw Quotes rows, so it must do
 * the same join here.
 *
 * getRequirementsHistory() is called ONCE per invocation and memoised, so the
 * products table does not re-scan Ordenes for every line.
 * @return {{notesFor: function(string, string): {itemNotes: string, supplierNotes: string}}}
 */
function buildItemNotesIndex_() {
  const map = {};
  const notesFor = function (orderRef, geo) {
    const key = String(orderRef || "").trim() + "||" + String(geo || "").trim();
    return map[key] || { itemNotes: "", supplierNotes: "" };
  };
  try {
    (typeof getRequirementsHistory === "function" ? getRequirementsHistory() : []).forEach(function (r) {
      const order = String(r.order || "").trim();
      if (!order) return;
      const geo = String(r.geo || "").trim();
      const key = order + "||" + geo;
      // First non-empty wins (a row can be re-saved; the first note is the
      // original one), mirroring the notesByOrderGeo join in getQuotesHistory.
      const prev = map[key] || { itemNotes: "", supplierNotes: "" };
      map[key] = {
        itemNotes: String(prev.itemNotes || "").trim() || String(r.itemNotes || ""),
        supplierNotes: String(prev.supplierNotes || "").trim() || String(r.supplierNotes || ""),
      };
    });
  } catch (e) {
    console.warn("buildItemNotesIndex_ failed: " + e.toString());
  }
  return { notesFor: notesFor };
}

/**
 * Resolves both notes for ONE quote line. A consolidated quote ref
 * ("100123+100127") resolves each source requirement separately; when more
 * than one source contributes, each note is prefixed with its Req id so the
 * buyer can tell which requirement it belongs to (same convention as the
 * req_typed_notes label used elsewhere in Quote Mgmt).
 * @return {{item: string, supplier: string}} plain text (no HTML)
 */
function resolveLineNotes_(notesIndex, orderId, geo) {
  const out = { item: "", supplier: "" };
  if (!notesIndex || !notesIndex.notesFor) return out;
  const ref = String(orderId || "").trim();
  if (!ref) return out;
  const refs = typeof splitCombinedRef_ === "function" ? splitCombinedRef_(ref) : [ref];
  const itemParts = [], supplierParts = [];
  (refs || [ref]).forEach(function (r) {
    const clean = String(r || "").trim();
    if (!clean) return;
    const n = notesIndex.notesFor(clean, geo);
    if (n.itemNotes) itemParts.push({ ref: clean, text: n.itemNotes });
    if (n.supplierNotes) supplierParts.push({ ref: clean, text: n.supplierNotes });
  });
  const join = function (parts) {
    if (!parts.length) return "";
    // Only label when the line really came from more than one requirement.
    const multi = parts.length > 1;
    return parts.map(function (p) {
      return (multi ? "Req " + p.ref + ": " : "") + p.text;
    }).join(" | ");
  };
  out.item = join(itemParts);
  out.supplier = join(supplierParts);
  return out;
}

/** Renders a note cell for the HTML table: escaped, newlines preserved. */
function noteCellHtml_(value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return '<span style="color:#999;">&mdash;</span>';
  return escapeHtml_(v).replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * True when the browser can render the preview from the raw bytes itself.
 * Drive returns nothing for these, so they fall back to an icon + click-to-open.
 */
function isInlinePreviewMime_(mime) {
  return /^image\/(jpeg|png|jpg|webp|gif)$/i.test(String(mime || ""));
}

/**
 * Small data-URL thumbnail of an IMAGE attachment, so the user can confirm at
 * a glance that the right document is attached. Returns "" when the preview is
 * impossible or the image is too big to inline (Apps Script payload limits).
 */
function buildImagePreview_(blob) {
  try {
    if (!blob || typeof blob.getBytes !== "function") return "";
    if (Number(blob.getBytes().length || 0) > 3 * 1024 * 1024) return "";
    return "data:" + (blob.getContentType() || "image/jpeg") + ";base64," +
      Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    console.warn("buildImagePreview_ failed: " + e.toString());
    return "";
  }
}

/**
 * Parses the first N rows of the generated products CSV into a small grid so
 * the client can render a real mini table instead of a generic icon — this is
 * how the user confirms the CSV holds the right products.
 * maxCols caps the PREVIEW only (the attached file always keeps every
 * column); the reminder table has 9 columns and the mini-table is unreadable
 * beyond that.
 * @return {{header: string[], rows: string[][]}}
 */
function buildCsvPreview_(csvContent, maxRows, maxCols) {
  const out = { header: [], rows: [] };
  try {
    const text = String(csvContent || "").replace(/^\uFEFF/, "");
    if (!text) return out;

    // Parse the CSV as a STREAM, not line by line: a quoted field may legally
    // contain a comma AND a newline (csvCell() quotes both), so splitting on
    // physical lines first would cut a multi-line note in half and shift every
    // following column. Rows are therefore delimited by a newline seen while
    // OUTSIDE quotes.
    const cap = Number(maxCols) > 0 ? Number(maxCols) : Infinity;
    const records = [];
    let cells = [], cur = "", inQ = false;
    const endCell = function () { cells.push(cur); cur = ""; };
    const endRecord = function () { endCell(); records.push(cells); cells = []; };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
          else inQ = false;
        } else cur += ch;                                    // keeps \n inside the cell
        continue;
      }
      if (ch === '"') { inQ = true; continue; }
      if (ch === ",") { endCell(); continue; }
      if (ch === "\r") {
        if (text[i + 1] === "\n") i++;
        endRecord();
        continue;
      }
      if (ch === "\n") { endRecord(); continue; }
      cur += ch;
    }
    if (cur !== "" || cells.length) endRecord();

    const usable = records.filter(function (r) {
      return r.some(function (c) { return String(c).trim(); });
    });
    if (!usable.length) return out;

    out.header = usable[0].slice(0, cap);
    const limit = Number(maxRows) > 0 ? Number(maxRows) : 6;
    for (let i = 1; i < usable.length && out.rows.length < limit; i++) {
      out.rows.push(usable[i].slice(0, cap));
    }
  } catch (e) {
    console.warn("buildCsvPreview_ failed: " + e.toString());
  }
  return out;
}

// Preflights the PO-reminder attachments WITHOUT sending, so the client can
// tell the user up front which files will not make it (resolveMailAttachments_
// fails silently — log + skip — which would otherwise ship an email quietly
// missing its quotation document), and can also show a real preview so the
// user confirms the RIGHT file is attached before pressing Send.
// Each entry carries: label, ok, reason, kind (image|csv|pdf|file),
// previewImg (data URL, images only), csvPreview ({header, rows}), openUrl.
//   @return {Array<Object>}
function preflightPoAttachments_(attachments, csvPreviewByName) {
  const list = Array.isArray(attachments) ? attachments : [];
  const csvMap = csvPreviewByName || {};
  return list.map(function (att, i) {
    const label = String((att && (att.name || att.fileName)) || "Adjunto " + (i + 1));
    try {
      if (!att) return { label: label, ok: false, reason: "descriptor vacío", kind: "file" };
      if (att.url) {
        const fileId = getDriveFileIdFromUrl_(att.url);
        if (!fileId) return { label: label, ok: false, reason: "enlace de Drive no reconocido", kind: "file" };
        // Touch the file: throws when it was deleted or is not shared with
        // the sending account, which is exactly the failure we want to catch.
        const f = DriveApp.getFileById(fileId);
        const nm = String(f.getName() || "").trim();
        const mime = String(f.getMimeType() || "");
        const kind = isInlinePreviewMime_(mime) ? "image"
          : (/csv/i.test(mime) ? "csv" : (/pdf/i.test(mime) ? "pdf" : "file"));
        const entry = {
          label: nm || label,
          ok: true,
          reason: "",
          fileName: nm || label,
          mimeType: mime,
          kind: kind,
          openUrl: att.url,
          // Stable key the client echoes back in excludedAttachments, so an
          // untick matches the exact descriptor regardless of naming.
          exclusionKey: att.url || (nm || label),
        };
        // Images only: Drive generates no usable preview for PDFs.
        if (kind === "image") {
          try { entry.previewImg = buildImagePreview_(f.getBlob()); } catch (e2) { /* preview is best-effort */ }
        }
        return entry;
      }
      if (att.contentBase64) {
        const mime = String(att.mimeType || "");
        const kind = isInlinePreviewMime_(mime) ? "image"
          : (/csv/i.test(mime) ? "csv" : (/pdf/i.test(mime) ? "pdf" : "file"));
        // Decoded byte size: this is what actually counts against the mail
        // provider's attachment limit, and it is the only reliable way to
        // confirm whether the CSV is the file blowing the size budget.
        let bytes = 0;
        try { bytes = Utilities.base64Decode(att.contentBase64).length; } catch (e) { bytes = 0; }
        const entry = {
          label: label,
          ok: true,
          reason: "",
          fileName: label,
          mimeType: mime,
          kind: kind,
          sizeBytes: bytes,
          exclusionKey: label,
        };
        if (kind === "image") {
          entry.previewImg = "data:" + (mime || "image/jpeg") + ";base64," + String(att.contentBase64);
        }
        if (kind === "csv" && csvMap[label]) entry.csvPreview = csvMap[label];
        return entry;
      }
      return { label: label, ok: false, reason: "descriptor no soportado", kind: "file" };
    } catch (e) {
      return {
        label: label,
        ok: false,
        reason: String(e && e.message ? e.message : e),
        kind: "file",
      };
    }
  });
}

// ============================================================
// PO CREATION REMINDER — shared builder + two entry points
//   1) getPoReminderDraft(payload)  -> { success, mail, meta }   (client preview modal)
//   2) sendPoReminderEmail(payload) -> dispatch shapes           (legacy / any other caller)
//
// Both read the Quotes sheet fresh, re-guard Approved status, build the email
// body (reminder header + quote meta + current-products table + CSV attachment)
// and the attachment list. sendPoReminderEmail additionally dispatches via
// SmartDispatcher and returns the same 3 outcome shapes used by the client.
// ============================================================

function buildPoReminderMail_(payload, draftOnly) {
  payload = payload || {};
  const reqQuoteId = String(payload.quoteId || "").trim();
  const reqOrderId = String(payload.orderId || "").trim();
  const reqSupplier = String(payload.supplier || "").trim();
  if (!reqQuoteId && !reqOrderId) {
    return { success: false, message: "Missing quote reference." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Quotes");
  if (!sheet) return { success: false, message: "Quotes sheet not found." };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: false, message: "Quote not found." };

  const normHeader = function (v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  };
  const headers = data[0].map(normHeader);
  const headerByNorm = {};
  headers.forEach(function (h, i) { if (!(h in headerByNorm)) headerByNorm[h] = i; });
  const col = function () {
    for (var a = 0; a < arguments.length; a++) {
      const key = normHeader(arguments[a]);
      if (key in headerByNorm) return headerByNorm[key];
    }
    return -1;
  };

  const idx = {
    orderId: col("Ref ID", "Ref Id", "RefID", "Ref"),
    supplier: col("Proveedor", "Supplier"),
    site: col("Faena", "Site"),
    geo: col("Geo Code", "Geo", "GeoCode"),
    pn: col("P/N", "PN", "P N"),
    desc: col("Descripción", "Descripcion", "Description"),
    qty: col("Cant.", "Cant", "Qty", "Cantidad"),
    status: col("Estado", "Status"),
    quoteId: col("Quote ID", "QuoteID", "Quote Id"),
    quoteLink: col("PDF Link", "PDFLink", "Pdf Link"),
    quotedDoc: col("Quoted Doc Link", "Quoted Doc", "QuotedDoc"),
    price: col("Precio Unit.", "Precio Unit", "Price", "Unit Price"),
    total: col("Total Neto", "Total", "Total Net"),
    category: col("Category", "Categoria", "Categoría"),
    buyer: col("Comprador", "Buyer"),
    emails: col("Emails", "Email"),
  };
  if (idx.orderId === -1 || idx.quoteId === -1 || idx.status === -1) {
    return { success: false, message: "Quotes sheet is missing required columns." };
  }
  // 🔒 "Cant. Aprobado" is resolved EXACTLY, never through the fuzzy `col()` scan
  // above: those fallbacks would happily bind it to "Cant. Recibido" and swap the
  // approved figure for the received one in the buyer's order.
  idx.approvedQty = data[0].findIndex(h => String(h || "").trim().toLowerCase() === "cant. aprobado");
  const rows = data.slice(1).filter(function (row) {
    const qid = String(row[idx.quoteId] == null ? "" : row[idx.quoteId]).trim().toLowerCase();
    const oid = String(row[idx.orderId] == null ? "" : row[idx.orderId]).trim();
    const sup = String(row[idx.supplier] == null ? "" : row[idx.supplier]).trim().toLowerCase();
    if (reqQuoteId) {
      if (qid !== reqQuoteId.toLowerCase()) return false;
    } else if (oid !== reqOrderId) {
      return false;
    }
    if (reqOrderId && oid && oid !== reqOrderId) return false;
    if (reqSupplier && sup && sup !== reqSupplier.toLowerCase()) return false;
    return true;
  });
  if (!rows.length) return { success: false, message: "Quote not found." };

  // ---- Guard: dominant item status must be exactly "Approved" ----
  const STATUS_FLOW = QUOTE_ITEM_STATUSES_;
  let bestIdx = -1, best = "Pending", deletedCount = 0;
  rows.forEach(function (r) {
    const s = normalizeStatus_(String(r[idx.status] == null ? "" : r[idx.status]).trim());
    if (s === "Deleted") { deletedCount++; return; }
    const idx2 = STATUS_FLOW.indexOf(s);
    if (idx2 < 0) return;
    if (idx2 > bestIdx) { bestIdx = idx2; best = s; }
  });
  if (bestIdx === -1 && deletedCount > 0) best = "Deleted";
  if (best !== "Approved") {
    return {
      success: false,
      message: "Status guard: quote is not in Approved status (current: " + best + ").",
      dominantStatus: best,
    };
  }

  const cell = function (row, i) { return i === -1 ? "" : (row[i] == null ? "" : row[i]); };
  const txt = function (row, i) { return String(cell(row, i)).trim(); };
  const num = function (row, i) { return Number(cell(row, i)) || 0; };

  const first = rows[0];
  const quoteId = txt(first, idx.quoteId) || reqQuoteId;
  const orderId = txt(first, idx.orderId) || reqOrderId;
  const supplierName = txt(first, idx.supplier) || reqSupplier;
  const siteName = txt(first, idx.site);
  const categoryName = txt(first, idx.category);

  // Recipients: same precedence as the QuoteEdit notification —
  // persisted Emails column wins, then Comprador, then procurement alias.
  let toEmail = txt(first, idx.buyer) || "procurement@yourcompany.com";
  if (idx.emails !== -1 && txt(first, idx.emails)) toEmail = txt(first, idx.emails);

  // ---- Fresh products table (HTML) + CSV snapshot ----
  const csvCell = function (v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  let totalNet = 0;
  const trHtml = [];
  // Per-item notes (Item Notes / Supplier Notes) live on Ordenes and are joined
  // here by requirement + GEO. Built ONCE, not per line.
  const notesIndex = buildItemNotesIndex_();
  const noteCellStyle = "padding:6px 8px;border:1px solid #ddd;max-width:220px;word-wrap:break-word;overflow-wrap:break-word;";
  const csvLines = [["GEO", "P/N", "Description", "Notas", "Notas Proveedor", "Qty", "Unit Price", "Total", "Status"]];
  rows.forEach(function (row) {
    const geo = txt(row, idx.geo), pn = txt(row, idx.pn), desc = txt(row, idx.desc);
    const quotedQty = num(row, idx.qty);
    const status = txt(row, idx.status);
    // 🔒 The buyer orders the APPROVED quantity, not the quote. `Cant.` is now the
    // (frozen) quoted figure, so anything at/after Approved resolves through
    // "Cant. Aprobado"; when the manager reduced it, the quoted figure is kept
    // inline as context so nobody re-quotes the shortfall by accident.
    const isApprovedLine = isQuoteQtyFrozen_(status);
    const approvedQty = resolveEffectiveQuoteQty_(cell(row, idx.qty), cell(row, idx.approvedQty));
    const qty = isApprovedLine ? approvedQty : quotedQty;
    const reduced = isApprovedLine && approvedQty !== quotedQty;
    const qtyHtml = String(qty) + (reduced
      ? "<br><span style='color:#a06a00;font-size:.85em;'>(" + quotedQty + " cotizado)</span>"
      : "");
    const price = num(row, idx.price), total = num(row, idx.total);
    const notes = resolveLineNotes_(notesIndex, txt(row, idx.orderId), geo);
    totalNet += total;
    trHtml.push(
      "<tr>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;'>" + escapeHtml_(geo) + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;'>" + escapeHtml_(pn) + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;'>" + escapeHtml_(desc) + "</td>" +
      "<td style='" + noteCellStyle + "'>" + noteCellHtml_(notes.item) + "</td>" +
      "<td style='" + noteCellStyle + "'>" + noteCellHtml_(notes.supplier) + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;text-align:right;'>" + qtyHtml + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;text-align:right;'>" + price.toFixed(2) + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;text-align:right;'>" + total.toFixed(2) + "</td>" +
      "<td style='padding:6px 8px;border:1px solid #ddd;'>" + escapeHtml_(status) + "</td>" +
      "</tr>"
    );
    // csvCell() quotes on comma/quote/newline/semicolon, so multi-line notes
    // stay intact and round-trip correctly through Excel.
    csvLines.push([geo, pn, desc, notes.item, notes.supplier, qty, price, total, status]);
  });

  const csvContent = "\uFEFF" + csvLines.map(function (r) {
    return r.map(csvCell).join(",");
  }).join("\r\n");
  // Supplier quote documents. BOTH are attached when they are distinct:
  //   * "Quoted Doc Link" — the document the user uploaded per item.
  //   * "PDF Link"        — the generated quote PDF.
  // Previously the PDF was only used as a FALLBACK (docUrl = pdfUrl when the
  // upload was missing), so one broken/unreadable Drive file left the email
  // with no quotation document at all. Attaching both gives the buyer a
  // second copy, so a single failure no longer leaves the recipient stuck.
  // A manual pick replaces only the uploaded document; the PDF still rides
  // along as the safety net.
  let quotedDocUrl = "", pdfUrl = "";
  rows.forEach(function (row) {
    if (!quotedDocUrl) quotedDocUrl = txt(row, idx.quotedDoc);
    if (!pdfUrl) pdfUrl = txt(row, idx.quoteLink);
  });
  quotedDocUrl = String(quotedDocUrl || "").trim();
  pdfUrl = String(pdfUrl || "").trim();
  // Kept for the existing `hasDoc` / docUrl meta consumers.
  const docUrl = quotedDocUrl || pdfUrl;

  const idOf = function (u) {
    try { return getDriveFileIdFromUrl_(u) || String(u || "").trim(); }
    catch (e) { return String(u || "").trim(); }
  };
  // Same Drive file referenced by both columns must not be attached twice.
  const sameFile = quotedDocUrl && pdfUrl && idOf(quotedDocUrl) === idOf(pdfUrl);

  // JSON-safe attachment descriptors (survive google.script.run round-trips
  // for the fallback retry): Drive URL + inline base64 CSV.
  // Every entry is sent as a REAL attachment by resolveMailAttachments_
  // (Drive URL -> Drive blob, base64 -> newBlob), so the body advertises
  // them as attachments, never as links.
  // The user can untick an attachment in the preview modal. Matching is by URL
  // (or exact name for inline blobs) rather than by display name: the client
  // sends the DRIVE filename, which never matches the synthetic fallback name
  // used here, so name-based matching silently ignored the tick boxes.
  // SINGLE ATTACHMENT: the supplier quotation document only.
  // The generated quote PDF and the products CSV were removed — the quotation
  // is the only thing the buyer needs, and the products are already rendered
  // as the "Lista Productos" table in the email body itself. This also removes
  // the CSV's base64 payload from the google.script.run round-trip.
  const uploadedDocName = "Cotizacion_" + String(quoteId || orderId).replace(/[^A-Za-z0-9_-]/g, "_") + "_adjunto";
  const attachments = [];
  // Manual fallback: when the Drive document could not be resolved the user
  // picks the file locally and it is sent instead.
  const manual = payload.manualAttachment && payload.manualAttachment.contentBase64
    ? payload.manualAttachment
    : null;
  if (manual) {
    attachments.push({
      name: String(manual.name || uploadedDocName),
      contentBase64: String(manual.contentBase64),
      mimeType: String(manual.mimeType || "application/octet-stream"),
    });
  } else if (quotedDocUrl) {
    attachments.push({ url: quotedDocUrl, name: uploadedDocName });
  }

  // Real file name of the attached supplier document, so the body can name
  // the attachment instead of pointing at a link.
  let docFileName = "";
  if (docUrl && !manual) {
    try {
      const docFileId = getDriveFileIdFromUrl_(docUrl);
      if (docFileId) docFileName = String(DriveApp.getFileById(docFileId).getName() || "").trim();
    } catch (e) {
      console.warn("PO reminder: could not resolve document name: " + e.toString());
    }
  }
  if (manual) docFileName = String(manual.name || "").trim();
  if (!docFileName) docFileName = docFileNameFallback(quoteId, orderId);

  // ---- Email body ----
  const senderEmail = String(payload.currentUserEmail || "").trim() || Session.getActiveUser().getEmail() || "";
  // Requirement metadata ("Solicitado por" / "Sub Area") and the approver.
  const reqMeta = resolveReqOrderMeta_(orderId);
  const requesterName = reqMeta.user || "";
  const subAreaName = reqMeta.subArea || "";
  const subAreaNo = reqMeta.subAreaNo || "";
  // Show the approver's NAME (not the raw email) — resolved through the Users
  // sheet so the reminder reads "aprobada por Juan Pérez".
  const approvedByEmail = resolveApprovedBy_(quoteId, orderId, senderEmail);
  const approvedByName = resolveUserName_(approvedByEmail);
  const dash = function (v) { return v ? escapeHtml_(v) : "-"; };
  const headerCells = ["GEO", "P/N", "Descripción", "Notas", "Notas Proveedor", "Cant.", "Precio Unit.", "Total", "Estado"].map(function (h, i) {
    const isNote = (i === 3 || i === 4);
    return '<th style="padding:6px 8px;border:1px solid #ddd;' +
      (isNote ? "max-width:220px;word-wrap:break-word;" : "") + '">' + h + "</th>";
  }).join("");

  // Spanish internal reminder asking for the OC to be generated.
  const emailBody =
    '<div style="font-family: Arial, sans-serif; color: #333; max-width: 700px;">' +
    '<p style="margin: 0 0 10px 0;">' + PO_REMINDER_GREETING_ + "</p>" +
    '<p style="margin: 0 0 8px 0;">Junto con saludar, por favor apoyo para la generación de la OC correspondiente a la ' +
    'cotización "' + dash(quoteId) + '", de "' + dash(supplierName) + '", la cual ha sido aprobada por "' +
    dash(approvedByName) + '".</p>' +
    '<p style="margin: 0 0 12px 0;">Solicitado por "' + dash(requesterName) + '"</p>' +
    '<p style="margin: 0 0 2px 0;"><strong>Quote ID:</strong> ' + dash(quoteId) + "</p>" +
    '<p style="margin: 0 0 2px 0;"><strong>Req ID:</strong> ' + dash(orderId) + "</p>" +
    '<p style="margin: 0 0 2px 0;"><strong>Sub Area:</strong> ' + dash(subAreaName) +
    (subAreaNo ? " (" + escapeHtml_(subAreaNo) + ")" : "") + "</p>" +
    '<p style="margin: 0 0 2px 0;"><strong>Proveedor:</strong> ' + dash(supplierName) + "</p>" +
    '<p style="margin: 0 0 2px 0;"><strong>Faena:</strong> ' + dash(siteName) + "</p>" +
    '<p style="margin: 0 0 12px 0;"><strong>Categoria:</strong> ' + dash(categoryName) + "</p>" +
    '<p style="margin: 12px 0 6px 0;"><strong>Lista Productos (' + rows.length + " posiciones):</strong></p>" +
    '<table style="border-collapse:collapse;font-size:13px;" width="100%"><thead><tr style="background:#0b4f8a;color:#fff;">' +
    headerCells +
    "</tr></thead><tbody>" + trHtml.join("") + "</tbody>" +
    // colspan 8: the row spans everything up to "Total" (the last cell, Estado,
    // stays empty). It was 6 before the two note columns were added.
    '<tfoot><tr><td colspan="8" style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Total Neto: <strong>' +
    totalNet.toFixed(2) + '</strong></td><td style="border:1px solid #ddd;"></td></tr></tfoot></table>' +
    // The single attachment travels as a real file (not a link).
    '<p style="margin-top: 14px; font-size: 12px; color: #666;"><strong>Adjuntos:</strong></p>' +
    (docUrl
      ? '<p style="margin: 2px 0 0 0; font-size: 12px; color: #666;">• Documento de cotización del proveedor: ' +
        escapeHtml_(docFileName) + "</p>"
      : '<p style="margin: 2px 0 0 0; font-size: 12px; color: #a06a00;">• No se encontró un documento de cotización ' +
        "adjunto para esta cotización.</p>") +
    "</div>";

  const mail = {
    type: "PoReminder",
    refId: quoteId || orderId,
    to: toEmail,
    subject: "Recordatorio creación OC: " + (quoteId || orderId) + (supplierName ? " - " + supplierName : ""),
    body: emailBody,
    replyTo: "noreply@recon.cl",
    senderEmail: senderEmail,
    fallbackProvider: String(payload.fallbackProvider || ""),
    attachments: attachments,
  };

  // Client-modal overrides (edited To/Cc/Subject/body from the preview modal).
  // Never set on the getPoReminderDraft call, so the draft keeps sheet defaults.
  if (payload.to) mail.to = String(payload.to);
  if (payload.cc) mail.cc = String(payload.cc);
  if (payload.subject) mail.subject = String(payload.subject);
  if (payload.body) mail.body = String(payload.body);

  const meta = {
    quoteId: quoteId,
    orderId: orderId,
    supplierName: supplierName,
    siteName: siteName,
    categoryName: categoryName,
    subAreaName: subAreaName,
    subAreaNo: subAreaNo,
    requesterName: requesterName,
    approvedByName: approvedByName,
    approvedByEmail: approvedByEmail,
    senderEmail: senderEmail,
    hasDoc: Boolean(docUrl),
    docUrl: docUrl,
    docFileName: docFileName,
    pdfUrl: pdfUrl,
    rowCount: rows.length,
    totalNet: totalNet,
    toEmail: toEmail,
  };

  if (draftOnly) {
    // Preflight the descriptors: an unresolvable Drive document must surface
    // in the modal (with a manual-attach option) BEFORE anything is sent,
    // because resolveMailAttachments_ silently drops such entries at dispatch.
    // The manual file already REPLACED the broken Drive descriptor in
    // `attachments` above, so preflight sees it as a normal entry (with its
    // own kind/preview) and nothing is listed twice. Failed entries are kept
    // on purpose: they are what drives the red state + "attach manually" button.
    var attachmentStatus = preflightPoAttachments_(attachments);
    meta.attachments = attachmentStatus;
    return { success: true, mail: mail, meta: meta };
  }

  const dispatchResult = SmartDispatcher(mail);
  if (dispatchResult && dispatchResult.requiresFallbackChoice) {
    return {
      success: true,
      emailSent: false,
      requiresFallbackChoice: true,
      graphError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
      emailError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
      dispatchDraft: mail,
    };
  }
  if (!dispatchResult || !dispatchResult.success) {
    return {
      success: false,
      emailSent: false,
      message: (dispatchResult && (dispatchResult.message || dispatchResult.graphError)) || "Email send failed",
    };
  }
  // resolveMailAttachments_ records what it had to drop on the mail object, so
  // the send result can tell the user instead of the email silently arriving
  // without its quotation document / CSV.
  const attachmentFailures = Array.isArray(mail.__attachmentFailures) ? mail.__attachmentFailures : [];
  return {
    success: true,
    emailSent: true,
    service: dispatchResult.service || "",
    to: toEmail,
    attachmentFailures: attachmentFailures,
  };
}

/**
 * Returns a PO-reminders email DRAFT (no send) for the client preview modal.
 * Serializable (no live blobs) and not dispatched.
 */
function getPoReminderDraft(payload) {
  return buildPoReminderMail_(payload, true);
}

/**
 * Legacy send entry point: builds the drafts and dispatches via SmartDispatcher.
 * Kept so any other script/caller still works; the UI now uses getPoReminderDraft.
 */
function sendPoReminderEmail(payload) {
  return buildPoReminderMail_(payload, false);
}