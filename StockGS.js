// =============================================
// StockGS.gs - Core Stock Management Functions
// =============================================

/**
 * CANONICAL LOCATION TYPE
 * ------------------------
 * Store, Workshop and every drilling site are the SAME kind of place: a sector.
 * There is no Main/Workshop/Site hierarchy in this business, so "LocationType"
 * is a single constant and never varies per module.
 *
 * Do NOT hardcode "Main" / "Location" / "Site" anywhere else. Use this constant
 * so every module (Quotes, Scanner, InvMov, ...) writes and reads the same rows;
 * a second spelling silently creates duplicate rows for one physical sector.
 */
const LOCATION_TYPE_SECTOR = "Sector";

/** Normalize a location/site name for comparison (trim + case-insensitive). */
function normalizeLocationId_(locationId) {
  return String(locationId == null ? "" : locationId).trim().toUpperCase();
}

/** Normalize a location type for comparison (trim + case-insensitive). */
function normalizeLocationType_(locationType) {
  return String(locationType == null ? "" : locationType).trim().toUpperCase();
}

/**
 * Main function to update stock levels
 * @param {string} itemId - GEO Code or Part Number
 * @param {string} locationType - Always LOCATION_TYPE_SECTOR ("Sector"). Store,
 *   Workshop and every drilling site are the same kind of place; never vary this.
 * @param {string} locationId - The sector/site name, e.g. "Store", "Workshop",
 *   "Manto Verde". Must not be empty.
 * @param {number} qtyChange - Positive or negative quantity
 * @param {string} transactionType - e.g. "StockCount", "WarehouseReceipt", "IssueToSite", "ReturnFromSite", "InternalMove",
 *                                   "ReserveStock", "UnreserveStock".
 *                                   "ReserveStock"/"UnreserveStock" only earmark stock:
 *                                   they move ReservedQty and never physical Quantity.
 * @param {string} referenceId - QuoteID, MovementID, CountID, etc.
 * @param {string} referenceType - "Quote", "InvMov", "StockCount", etc.
 * @param {string} comments - Optional comments
 * @param {string} userName - Pass the current user from client side
 */
function updateStock(
  itemId,
  locationType,
  locationId,
  qtyChange,
  transactionType,
  referenceId,
  referenceType,
  comments = "",
  userName = "System",
  sector
) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const stockSheet = ss.getSheetByName("Stock");
  const ledgerSheet = ss.getSheetByName("StockLedger");

  if (!stockSheet || !ledgerSheet) {
    throw new Error(
      "Stock or StockLedger sheet not found. Please check sheet names."
    );
  }

  const now = new Date();

  const productName = getProductName(itemId);

  // Every location is a sector. Guard here so a caller can never silently
  // retype a movement and create a second row for the same physical sector.
  if (normalizeLocationType_(locationType) !== LOCATION_TYPE_SECTOR.toUpperCase()) {
    console.warn(
      `updateStock called with non-canonical locationType "${locationType}" ` +
      `for ${itemId} / ${locationId} — coercing to "${LOCATION_TYPE_SECTOR}". ` +
      `Callers should use LOCATION_TYPE_SECTOR.`
    );
    locationType = LOCATION_TYPE_SECTOR;
  }

  // An empty sector would previously fall back to "Main" and land the movement
  // in the Store row. Fail loudly instead of corrupting another sector.
  if (!String(locationId == null ? "" : locationId).trim()) {
    throw new Error(
      `Invalid stock movement for item ${itemId}: locationId (sector) is required.`
    );
  }

  const sourceLocation = String(locationId).trim();
  const destinationLocation = String(sector || sourceLocation).trim();

  const change = Number(qtyChange) || 0;

  if (change === 0) {
    throw new Error(
      `Invalid stock movement for item ${itemId}: quantity change is 0.`
    );
  }

  // ============================================================
  // CASE 0:
  // RESERVATIONS (ReserveStock / UnreserveStock)
  //
  // A reservation only EARMARKS stock, it never moves physical stock:
  //   ReservedQty (F)  += change
  //   AvailableQty (G)  = Quantity (E) - ReservedQty (F)
  //
  // Posting reservations through the physical path (which this used to do) meant
  // that a "Pending" save inflated Quantity, and the later WarehouseReceipt
  // inflated it again => the same goods counted twice.
  // ============================================================

  if (isReservationTransaction_(transactionType)) {

    const stockRow = findStockRow(
      stockSheet,
      itemId,
      locationType,
      sourceLocation
    );

    let reservedCurrentQty = 0;
    let reservedOnHandQty = 0;

    if (stockRow) {
      reservedOnHandQty =
        Number(stockSheet.getRange(stockRow, 5).getValue()) || 0;
      reservedCurrentQty =
        Number(stockSheet.getRange(stockRow, 6).getValue()) || 0;
    }

    // Never let a release push the reservation below zero: releasing a
    // reservation that was never taken must not create "available" stock.
    const newReservedQty = Math.max(0, reservedCurrentQty + change);
    const newReservedAvailable = reservedOnHandQty - newReservedQty;

    // ------------------------------------------------------------
    // UPDATE STOCK (ReservedQty + AvailableQty only)
    // ------------------------------------------------------------

    if (stockRow) {

      // ReservedQty
      stockSheet.getRange(stockRow, 6).setValue(newReservedQty);

      // AvailableQty = Quantity - ReservedQty
      stockSheet.getRange(stockRow, 7).setValue(newReservedAvailable);

      // LastUpdated
      stockSheet.getRange(stockRow, 8).setValue(now);

      // UpdatedBy
      stockSheet.getRange(stockRow, 9).setValue(userName);

    } else {

      // Create the stock row without changing physical Quantity.
      stockSheet.appendRow([
        itemId,
        productName,
        locationType,
        sourceLocation,
        reservedOnHandQty,
        newReservedQty,
        newReservedAvailable,
        now,
        userName
      ]);
    }

    // ------------------------------------------------------------
    // LEDGER
    // ------------------------------------------------------------

    const reservedLedgerId =
      "LED-" +
      Utilities.formatDate(
        now,
        Session.getScriptTimeZone(),
        "yyyyMMddHHmmssSSS"
      );

    ledgerSheet.appendRow([
      reservedLedgerId,
      now,
      itemId,
      productName,

      // Location From
      locationType + "/" + sourceLocation,

      // Location To
      locationType + "/" + destinationLocation,

      // Signed adjustment
      change,

      // New reserved quantity
      newReservedQty,

      transactionType,
      referenceId,
      referenceType,
      userName,
      (comments ? comments + " | " : "") +
        "Reserved " + newReservedQty + " / Available " + newReservedAvailable,
      ""
    ]);

    console.log(
      `Stock reservation | ` +
      `${itemId} | ` +
      `${sourceLocation} | ` +
      `Reserved: ${reservedCurrentQty} -> ${newReservedQty} | ` +
      `Available: ${newReservedAvailable}`
    );

    return {
      success: true,
      itemId: itemId,
      newQuantity: newReservedAvailable,
      sourceQuantity: newReservedAvailable,
      destinationQuantity: newReservedAvailable,
      newReservedQty: newReservedQty
    };
  }

  // ============================================================
  // CASE 1:
  // SAME SOURCE AND DESTINATION
  //
  // Used for stock counts / stock adjustments.
  //
  // Example:
  // Current = 10
  // Change  = -2
  // New    = 8
  //
  // Negative stock is allowed.
  // ============================================================

  if (String(sourceLocation) === String(destinationLocation)) {

    const stockRow = findStockRow(
      stockSheet,
      itemId,
      locationType,
      sourceLocation
    );

    let currentQty = 0;
    let reservedQty = 0;

    if (stockRow) {
      currentQty =
        Number(stockSheet.getRange(stockRow, 5).getValue()) || 0;
      reservedQty =
        Number(stockSheet.getRange(stockRow, 6).getValue()) || 0;
    }

    // IMPORTANT:
    // Use signed change directly.
    // Negative stock is allowed.
    const newQty = currentQty + change;

    // Available stock is whatever is not earmarked by a reservation
    // (reserved stock can never be handed out).
    const newAvailableQty = newQty - reservedQty;

    // ------------------------------------------------------------
    // UPDATE STOCK
    // ------------------------------------------------------------

    if (stockRow) {

      // Quantity
      stockSheet.getRange(stockRow, 5).setValue(newQty);

      // AvailableQty = Quantity - ReservedQty
      stockSheet.getRange(stockRow, 7).setValue(newAvailableQty);

      // LastUpdated
      stockSheet.getRange(stockRow, 8).setValue(now);

      // UpdatedBy
      stockSheet.getRange(stockRow, 9).setValue(userName);

    } else {

      // Create new stock row
      stockSheet.appendRow([
        itemId,
        productName,
        locationType,
        sourceLocation,
        newQty,
        0,
        newAvailableQty,
        now,
        userName
      ]);
    }

    // ------------------------------------------------------------
    // LEDGER
    // ------------------------------------------------------------

    const ledgerId =
      "LED-" +
      Utilities.formatDate(
        now,
        Session.getScriptTimeZone(),
        "yyyyMMddHHmmssSSS"
      );

    ledgerSheet.appendRow([
      ledgerId,
      now,
      itemId,
      productName,

      // Location From
      locationType + "/" + sourceLocation,

      // Location To
      locationType + "/" + destinationLocation,

      // Signed adjustment
      change,

      // New quantity
      newQty,

      transactionType,
      referenceId,
      referenceType,
      userName,
      comments,
      ""
    ]);

    console.log(
      `Stock adjustment | ` +
      `${itemId} | ` +
      `${sourceLocation} | ` +
      `Old: ${currentQty} | ` +
      `Change: ${change} | ` +
      `New: ${newQty}`
    );

    return {
      success: true,
      itemId: itemId,
      newQuantity: newQty,
      newAvailableQty: newAvailableQty,
      sourceQuantity: newQty,
      destinationQuantity: newQty
    };
  }

  // ============================================================
  // CASE 2:
  // DIFFERENT SOURCE AND DESTINATION
  //
  // INVENTORY MOVEMENT
  //
  // Example:
  //
  // Store      = 0
  // Workshop   = 0
  // qtyChange  = -2
  //
  // RESULT:
  //
  // Store      = -2
  // Workshop   = 2
  //
  // ============================================================

  const transferQty = Math.abs(change);

  // ============================================================
  // SOURCE
  // ============================================================

  const sourceRow = findStockRow(
    stockSheet,
    itemId,
    locationType,
    sourceLocation
  );

  let sourceCurrentQty = 0;
  let sourceReservedQty = 0;

  if (sourceRow) {
    sourceCurrentQty =
      Number(stockSheet.getRange(sourceRow, 5).getValue()) || 0;
    sourceReservedQty =
      Number(stockSheet.getRange(sourceRow, 6).getValue()) || 0;
  }

  // IMPORTANT:
  //
  // DO NOT use Math.max().
  //
  // The source quantity must respect the signed movement.
  //
  // Example:
  // 0 + (-2) = -2
  //
  const sourceNewQty =
    sourceCurrentQty + change;

  // Available at the source is whatever is not earmarked.
  const sourceAvailableQty = sourceNewQty - sourceReservedQty;

  // ============================================================
  // DESTINATION
  // ============================================================

  const destinationRow = findStockRow(
    stockSheet,
    itemId,
    locationType,
    destinationLocation
  );

  let destinationCurrentQty = 0;
  let destinationReservedQty = 0;

  if (destinationRow) {
    destinationCurrentQty =
      Number(
        stockSheet.getRange(destinationRow, 5).getValue()
      ) || 0;
    destinationReservedQty =
      Number(
        stockSheet.getRange(destinationRow, 6).getValue()
      ) || 0;
  }

  // Destination receives the positive movement quantity.
  //
  // Example:
  // 0 + 2 = 2
  //
  const destinationNewQty =
    destinationCurrentQty + transferQty;

  // Available at the destination is whatever is not earmarked.
  const destinationAvailableQty = destinationNewQty - destinationReservedQty;

  // ============================================================
  // UPDATE SOURCE
  // ============================================================

  if (sourceRow) {

    stockSheet.getRange(sourceRow, 5).setValue(sourceNewQty);
    stockSheet.getRange(sourceRow, 7).setValue(sourceAvailableQty);
    stockSheet.getRange(sourceRow, 8).setValue(now);
    stockSheet.getRange(sourceRow, 9).setValue(userName);

  } else {

    // Source row doesn't exist.
    // Create it with the resulting quantity,
    // which may be negative.

    stockSheet.appendRow([
      itemId,
      productName,
      locationType,
      sourceLocation,
      sourceNewQty,
      0,
      sourceAvailableQty,
      now,
      userName
    ]);
  }

  // ============================================================
  // UPDATE DESTINATION
  // ============================================================

  if (destinationRow) {

    stockSheet.getRange(destinationRow, 5).setValue(destinationNewQty);
    stockSheet.getRange(destinationRow, 7).setValue(destinationAvailableQty);
    stockSheet.getRange(destinationRow, 8).setValue(now);
    stockSheet.getRange(destinationRow, 9).setValue(userName);

  } else {

    stockSheet.appendRow([
      itemId,
      productName,
      locationType,
      destinationLocation,
      destinationNewQty,
      0,
      destinationAvailableQty,
      now,
      userName
    ]);
  }

  // ============================================================
  // STOCK LEDGER
  // ============================================================

  const ledgerId =
    "LED-" +
    Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      "yyyyMMddHHmmssSSS"
    );

  ledgerSheet.appendRow([
    ledgerId,
    now,
    itemId,
    productName,

    // SOURCE
    locationType + "/" + sourceLocation,

    // DESTINATION
    locationType + "/" + destinationLocation,

    // IMPORTANT:
    // Keep the signed movement.
    //
    // ISSUE:
    // -2
    //
    // RETURN:
    // -2 from the return source
    //
    change,

    // IMPORTANT:
    // This is the NEW quantity at the destination.
    destinationNewQty,

    transactionType,
    referenceId,
    referenceType,
    userName,
    comments,
    ""
  ]);

  console.log(
    `Inventory transfer | ` +
    `${itemId} | ` +
    `${sourceLocation} -> ${destinationLocation} | ` +
    `Change: ${change} | ` +
    `Source: ${sourceCurrentQty} -> ${sourceNewQty} | ` +
    `Destination: ${destinationCurrentQty} -> ${destinationNewQty}`
  );

  return {
    success: true,
    itemId: itemId,
    newQuantity: destinationNewQty,
    newAvailableQty: destinationAvailableQty,
    sourceQuantity: sourceNewQty,
    sourceAvailableQty: sourceAvailableQty,
    destinationQuantity: destinationNewQty,
    destinationAvailableQty: destinationAvailableQty
  };
}


/**
 * Reservation transactions only EARMARK stock (ReservedQty) and must never touch
 * physical Quantity. Everything else is a real, physical stock movement.
 */
function isReservationTransaction_(transactionType) {
  const t = String(transactionType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return t === "reservestock" || t === "unreservestock";
}

/**
 * Find stock row by Item + Sector.
 *
 * Matching is trim + case-insensitive on BOTH columns, so "store", "Store " and
 * "STORE" all resolve to the same row instead of each appending a new one.
 *
 * The old `(!locationId && data[i][3] == "Main")` fallback is deliberately gone:
 * it made an empty sector silently resolve to the Store row and write another
 * sector's stock into it. An empty location must not match anything.
 *
 * @param {Sheet} sheet
 * @param {string} itemId
 * @param {string} locationType  Canonical location type (LOCATION_TYPE_SECTOR).
 * @param {string} locationId    Sector/site name. Required, must be non-empty.
 * @param {Array<Array>} [cachedData] Optional pre-read getDataRange() values.
 *        Pass this when looping many items to avoid re-reading the whole sheet
 *        on every call. It is safe as long as no row is inserted during the loop
 *        (updateStock only appends when the row is genuinely missing).
 * @return {number|null} 1-based sheet row number, or null when not found.
 */
function findStockRow(sheet, itemId, locationType, locationId, cachedData) {
  const sectorId = normalizeLocationId_(locationId);
  if (!sectorId) return null;

  const type = normalizeLocationType_(locationType) || LOCATION_TYPE_SECTOR.toUpperCase();
  const key = normalizeLocationId_(itemId);

  const data = cachedData || sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    if (
      normalizeLocationId_(data[i][0]) === key &&
      normalizeLocationType_(data[i][2]) === type &&
      normalizeLocationId_(data[i][3]) === sectorId
    ) {
      return i + 1;
    }
  }

  return null;
}

/** Helper: Get Product Name from Master sheet */
function getProductName(itemId) {
  const master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master");
  if (!master) return "Unknown Product";

  const data = master.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == itemId || data[i][1] == itemId) {   // GEO Code (A) or Part Number (B)
      return data[i][5] || data[i][4] || "Unknown";       // Desc En (adjust index if needed)
    }
  }
  return "Unknown Product";
}

/**
 * Get current available stock
 */
function getAvailableStock(itemId, locationType = LOCATION_TYPE_SECTOR, locationId = "Store") {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock");
  if (!sheet) return 0;

  const key = normalizeLocationId_(itemId);
  const type = normalizeLocationType_(locationType);
  const sectorId = normalizeLocationId_(locationId);
  if (!key || !sectorId) return 0;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeLocationId_(data[i][0]) === key &&
        normalizeLocationType_(data[i][2]) === type &&
        normalizeLocationId_(data[i][3]) === sectorId) {
      return Number(data[i][6]) || 0;   // AvailableQty (G)
    }
  }
  return 0;
}

/**
 * Get full stock data for dashboard - Fixed Date Handling with Rack/Location info
 */
function getFullStockData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Stock");
  
  if (!sheet) {
    console.error("Stock sheet not found!");
    return [];
  }

  // Get ItemLocationMap data for rack/shelf/side info
  let itemLocationData = [];
  try {
    const locMapSheet = ss.getSheetByName("ItemLocationMap");
    if (locMapSheet) {
      const mapValues = locMapSheet.getDataRange().getValues();
      if (mapValues.length > 1) {
        const headers = mapValues[0];
        itemLocationData = mapValues.slice(1).map(row => ({
          locationId: row[headers.indexOf("LocationID")] || row[0],
          rackId: row[headers.indexOf("RackID")] || row[1],
          sideCode: row[headers.indexOf("SideCode")] || row[2],
          shelfLevel: row[headers.indexOf("ShelfLevel")] || row[3],
          itemId: row[headers.indexOf("ItemID")] || row[4]
        }));
      }
    }
  } catch (e) {
    console.log("Could not load ItemLocationMap:", e);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    let lastUpdated = row[headers.indexOf("LastUpdated")] || row[7] || "";
    if (lastUpdated instanceof Date) {
      lastUpdated = lastUpdated.toISOString();
    }

    // Find matching location map entry for this stock item
    const locMapEntry = itemLocationData.find(entry => 
      String(entry.locationId).toLowerCase() === String(row[headers.indexOf("LocationID")] || row[3]).toLowerCase() &&
      String(entry.itemId) === (row[headers.indexOf("ItemID")] || row[0])
    );

    result.push({
      ItemID: row[headers.indexOf("ItemID")] || row[0] || "",
      ProductName: row[headers.indexOf("ProductName")] || row[1] || "",
      LocationType: row[headers.indexOf("LocationType")] || row[2] || "",
      LocationID: row[headers.indexOf("LocationID")] || row[3] || "",
      Quantity: Number(row[headers.indexOf("Quantity")] || row[4] || 0),
      ReservedQty: Number(row[headers.indexOf("ReservedQty")] || row[5] || 0),
      AvailableQty: Number(row[headers.indexOf("AvailableQty")] || row[6] || 0),
      LastUpdated: lastUpdated,
      UpdatedBy: row[headers.indexOf("UpdatedBy")] || row[8] || "",
      RackId: locMapEntry?.rackId || "",
      SideCode: locMapEntry?.sideCode ? String(locMapEntry.sideCode) : null,
      ShelfLevel: locMapEntry?.shelfLevel || ""
    });
  }

  console.log(`Loaded ${result.length} stock rows for dashboard`);
  return result;
}