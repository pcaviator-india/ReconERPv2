/**
 * SCANNER MODULE BACKEND
 */

function ensureStockCountItemsSheet(ss) {
  const headers = ["CountID", "Barcode", "Geo", "ProductNumber", "DescEN", "DescES", "Quantity", "Date"];
  let sheet = ss.getSheetByName("StockCountItems");

  if (!sheet) {
    sheet = ss.insertSheet("StockCountItems");
    sheet.appendRow(headers);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return sheet;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const needsUpdate = headers.some((header, index) => String(existingHeaders[index] || "") !== header);
  if (needsUpdate) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function getScannerData(startDateStr, endDateStr) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const countSheet = getOrCreateSheet(ss, "StockCounts", ["CountID", "Date", "UserName", "Status", "Location"]);
    const lastRow = countSheet.getLastRow();
    
    let history = [];
    
    if (lastRow > 1) {
      const numRows = lastRow - 1;
      // Fetch ALL rows (not just last 15) so we can sort by date properly
      const rawData = countSheet.getRange(2, 1, numRows, 5).getValues();
      
      // Map and convert Date objects to ISO strings for safe transmission
      history = rawData.map(row => {
        return [
          row[0], // ID
          row[1] instanceof Date ? row[1].toISOString() : row[1], // Convert Date to ISO String
          row[2], // User
          row[3], // Status
          row[4]  // Location
        ];
      });

      // Sort by date descending (newest first) so the most recent counts appear at the top
      history.sort((a, b) => {
        const dateA = a[1] instanceof Date ? a[1] : new Date(a[1]);
        const dateB = b[1] instanceof Date ? b[1] : new Date(b[1]);
        return dateB - dateA; // Descending: newest first
      });

      // Apply date range filter if provided (inclusive on both ends)
      if (startDateStr || endDateStr) {
        const fromDate = startDateStr ? new Date(startDateStr + "T00:00:00") : null;
        const toDate = endDateStr ? new Date(endDateStr + "T23:59:59") : null;
        history = history.filter(row => {
          const rowDate = row[1] instanceof Date ? row[1] : new Date(row[1]);
          if (!rowDate || isNaN(rowDate.getTime())) return false;
          if (fromDate && rowDate < fromDate) return false;
          if (toDate && rowDate > toDate) return false;
          return true;
        });
      }

      // Take the most recent 50 entries (increased from 15 to show more history)
      history = history.slice(0, 50);
    }

    const result = { history: history };
    console.log("Returning to frontend:", JSON.stringify(result));
    return result;

  } catch (e) {
    console.error("Scanner Backend Error: " + e.toString());
    return { history: [] };
  }
}

// Ensure your helper function returns the sheet object
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function saveStockCount(sessionData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const countSheet = getOrCreateSheet(ss, "StockCounts", ["CountID", "Date", "UserName", "Status", "Location"]);
  const itemsSheet = ensureStockCountItemsSheet(ss);
  
  const countId = "SC-" + new Date().getTime();
  sessionData.countId = countId;   // Attach for stock ledger

  // Save Count Header
  countSheet.appendRow([countId, new Date(), sessionData.userName, "Completed", sessionData.location || ""]);

  // Save Count Items
  const rows = sessionData.items.map(item => [
    countId,
    item.barcode,
    item.geo || "",
    item.pn || "",
    item.en || item.name || "",
    item.es || "",
    item.qty,
    new Date()
  ]);
  
  if (rows.length > 0) {
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  }

  // === NEW: Update Stock ===
  const stockResult = processStockCount(sessionData);

  return { 
    success: true, 
    countId: countId,
    stockUpdated: stockResult.success,
    stockMode: sessionData.stockMode || "replace"
  };
}

function getItemsByCountId(countId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureStockCountItemsSheet(ss);
  const data = sheet.getDataRange().getValues();
  
  // Filter rows matching the CountID (Column A)
  return data.filter(row => row[0] === countId).map(row => {
    if (row.length >= 8) {
      return {
        barcode: row[1],
        geo: row[2],
        pn: row[3],
        en: row[4],
        es: row[5],
        qty: row[6]
      };
    }

    return {
      barcode: row[1],
      geo: "",
      pn: "",
      en: row[2],
      es: "",
      qty: row[3]
    };
  });
}

/**
 * Process Stock Count
 * Saves the selected location exactly as provided.
 * stockMode: "add" (default, backward-compatible) → counted qty is ADDED to current stock.
 *            "replace" → counted qty REPLACES current stock (delta = counted − current).
 */
function processStockCount(sessionData) {
  if (!sessionData || !sessionData.items || sessionData.items.length === 0) {
    return { success: false, message: "No items" };
  }

  console.log(sessionData);

  const locationId = String(sessionData.location || "").trim();
  // Store, Workshop and every drilling site are all the same kind of place: a
  // sector. Using the shared constant keeps stock counts writing to the SAME
  // row as quotes/inventory movements instead of creating a second row for the
  // same physical sector (which showed up as duplicate stock).
  const locationType = LOCATION_TYPE_SECTOR;
  const userName = sessionData.userName || "System";

  // Refuse to post a count without a sector. Previously this fell back to "Main"
  // and silently overwrote the Store row with another sector's count.
  if (!locationId) {
    return {
      success: false,
      message: "A location (sector) must be selected before saving the stock count."
    };
  }

  // Default to "add" so existing callers (which don't send stockMode) keep current behavior
  const stockMode = String(sessionData.stockMode || "add").toLowerCase() === "replace"
    ? "replace"
    : "add";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("Stock");

  const results = [];

  // Read the Stock sheet ONCE for the whole count. findStockRow() re-reads the
  // entire sheet on every call, which meant one full getDataRange() per scanned
  // item. Safe here because updateStock() only appends when a row is genuinely
  // missing, and every item in a count is distinct.
  const stockData = stockSheet ? stockSheet.getDataRange().getValues() : null;

  sessionData.items.forEach(item => {
    let qtyChange = Number(item.qty) || 0;

    // In REPLACE mode, convert the counted qty into a delta against current stock
    if (stockMode === "replace" && stockSheet) {
      const existingRow = findStockRow(stockSheet, item.barcode, locationType, locationId, stockData);
      let currentQty = 0;
      if (existingRow) {
        currentQty = Number(stockSheet.getRange(existingRow, 5).getValue()) || 0;
      }
      qtyChange = qtyChange - currentQty; // delta needed to reach counted value

      // If the counted qty matches the current stock, no update is needed.
      // Skip updateStock to avoid the "quantity change is 0" error — replace mode
      // with an unchanged qty is a valid no-op, not an error.
      if (qtyChange === 0) {
        results.push({
          success: true,
          itemId: item.barcode,
          newQuantity: currentQty,
          sourceQuantity: currentQty,
          skipped: true,
          reason: "Counted qty matches current stock — no change needed"
        });
        return;
      }
    }

    const result = updateStock(
      item.barcode,
      locationType,
      locationId,
      qtyChange,
      "StockCount",
      sessionData.countId || "Manual",
      "StockCount",
      `Stock Count (${stockMode}) - ${locationId}`,
      userName,
      locationId
    );

    results.push(result);
  });

  console.log(
    `Stock Count (${stockMode}) → ${locationId} | ${results.length} items`
  );

  return {
    success: true,
    processed: results.length
  };
}