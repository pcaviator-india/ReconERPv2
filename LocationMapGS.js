/**
 * FILE: LocationMapGS.gs
 * Description: Backend logic for managing Rack Configurations and Item Locations.
 */

// --- CONSTANTS (Sheet Names) ---
const SHEET_RACK_CONFIG = 'RackConfig';
const SHEET_ITEM_LOCATION_MAP = 'ItemLocationMap';
const SHEET_MASTER_ITEMS = 'Master';
const SHEET_MOVEMENT_VAL = 'Movement_Val';

/**
 * Gets distinct LocationIDs (Sectors) from Movement_Val sheet, Column A.
 * Returns: Array of unique non-empty strings.
 */
function getSectors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_MOVEMENT_VAL);
    if (!sheet) {
      Logger.log('Movement_Val sheet not found.');
      return [];
    }

    const data = sheet.getDataRange().getValues();
    const sectors = [];
    for (let i = 1; i < data.length; i++) {
      const val = String(data[i][0] || '').trim();
      if (val && sectors.indexOf(val) === -1) {
        sectors.push(val);
      }
    }
    return sectors;
  } catch (error) {
    Logger.log('Error in getSectors: ' + error.toString());
    return [];
  }
}

/**
 * Gets all data from the RackConfig sheet.
 * Returns: Array of objects representing rack definitions.
 */
function getRackConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_RACK_CONFIG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_RACK_CONFIG);
      const headers = [['LocationID', 'RackID', 'HasSides', 'NoOfShelves']];
      sheet.getRange(1, 1, 1, 4).setValues(headers);
      return [];
    }

    const values = sheet.getDataRange().getValues();
    if (values.length > 0) {
      values.shift();
      return values.map(row => ({
        locationId: row[0],
        rackId: row[1],
        hasSides: String(row[2]).toLowerCase() === 'yes',
        noOfShelves: parseInt(row[3], 10)
      }));
    }
    return [];
  } catch (error) {
    Logger.log('Error in getRackConfig: ' + error.toString());
    return [];
  }
}

/**
 * Gets all item IDs from the Master sheet.
 * Returns: Array of item IDs.
 */
function getAllItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_MASTER_ITEMS);
    if (!sheet) {
      Logger.log('Master sheet not found.');
      return [];
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const itemIndex = headers.indexOf('GEO Code');

    if (itemIndex === -1) {
      Logger.log('ItemID column not found in Master sheet.');
      return [];
    }

    return data.slice(1).map(row => row[itemIndex]);
  } catch (error) {
    Logger.log('Error in getAllItems: ' + error.toString());
    return [];
  }
}

/**
 * Searches items in Master sheet by GEO Code (case-insensitive partial match).
 * Returns: Array of matching item IDs.
 */
function searchItems(query) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_MASTER_ITEMS);
    if (!sheet) {
      Logger.log('Master sheet not found.');
      return [];
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const itemIndex = headers.indexOf('GEO Code');

    if (itemIndex === -1) {
      Logger.log('ItemID column not found in Master sheet.');
      return [];
    }

    const q = query.toLowerCase();
    const results = [];
    for (let i = 1; i < data.length; i++) {
      const itemId = String(data[i][itemIndex] || '');
      if (itemId.toLowerCase().indexOf(q) !== -1) {
        results.push(itemId);
      }
    }
    return results.slice(0, 50);
  } catch (error) {
    Logger.log('Error in searchItems: ' + error.toString());
    return [];
  }
}

/**
 * Saves a new rack configuration.
 */
function saveNewRack(config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_RACK_CONFIG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_RACK_CONFIG);
      const headers = [['LocationID', 'RackID', 'HasSides', 'NoOfShelves']];
      sheet.getRange(1, 1, 1, 4).setValues(headers);
    }

    sheet.appendRow([
      config.locationId,
      config.rackId,
      config.hasSides ? 'Yes' : 'No',
      config.noOfShelves
    ]);
  } catch (error) {
    Logger.log('Error in saveNewRack: ' + error.toString());
  }
}

/**
 * Gets existing item assignments for a specific location.
 * Returns: Array of item IDs currently assigned to that location/rack/side/shelf.
 */
function getExistingAssignments(locationId, rackId, sideCode, shelfLevel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_ITEM_LOCATION_MAP);
    if (!sheet) {
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const items = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === locationId && row[1] === rackId && row[2] === sideCode && row[3] == shelfLevel) {
        items.push(row[4]);
      }
    }
    return items;
  } catch (error) {
    Logger.log('Error in getExistingAssignments: ' + error.toString());
    return [];
  }
}

/**
 * Saves multiple item assignments in bulk by updating or overwriting rows cleanly.
 */
function saveBulkAssignments(assignments) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let sheet = ss.getSheetByName(SHEET_ITEM_LOCATION_MAP);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_ITEM_LOCATION_MAP);
      const headers = [['LocationID', 'RackID', 'SideCode', 'ShelfLevel', 'ItemID']];
      sheet.getRange(1, 1, 1, 5).setValues(headers);
    }

    const data = sheet.getDataRange().getValues();
    
    assignments.forEach(assign => {
      const loc = String(assign.locationId).trim().toLowerCase();
      const item = String(assign.itemID).trim().toLowerCase();
      let foundIndex = -1;
      
      // Look for an existing mapping record row entry matching this combination
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim().toLowerCase() === loc && String(data[i][4]).trim().toLowerCase() === item) {
          foundIndex = i + 1; // Convert 0-indexed loop to 1-indexed spreadsheet row
          break;
        }
      }
      
      if (assign.rackID === "" && assign.sideCode === "" && assign.shelfLevel === "") {
        // VACATE: Delete the matching row completely if it exists to remove it from the shelf
        if (foundIndex !== -1) {
          sheet.deleteRow(foundIndex);
          // Reload local loop data tracking representation to keep indexes balanced
          data.splice(foundIndex - 1, 1);
        }
      } else {
        // ASSIGN: Update existing row or append a fresh one if it doesn't exist
        if (foundIndex !== -1) {
          sheet.getRange(foundIndex, 1, 1, 4).setValues([[assign.locationId, assign.rackID, assign.sideCode, assign.shelfLevel]]);
        } else {
          const newRow = [assign.locationId, assign.rackID, assign.sideCode, assign.shelfLevel, assign.itemID];
          sheet.appendRow(newRow);
          data.push(newRow); // Dynamically update data footprint track representation
        }
      }
    });
  } catch (error) {
    Logger.log('Error in saveBulkAssignments: ' + error.toString());
  }
}


/**
 * Gets items with stock available at a specific LocationID combined with their shelf allocations.
 * Returns: Array of objects { itemID, productName, quantity, availableQty, rackID, sideCode, shelfLevel }
 */
function getItemsByLocation(locationId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Check Stock sheet first for availability
  let stockSheet = ss.getSheetByName("Stock");
  if (!stockSheet) {
    Logger.log('Stock sheet not found.');
    return [];
  }

  const stockData = stockSheet.getDataRange().getValues();
  if (stockData.length <= 1) return [];

  // Find stock header indices
  const headers = stockData[0];
  const itemIndex = headers.indexOf("ItemID") !== -1 ? headers.indexOf("ItemID") : 0;
  const nameIndex = headers.indexOf("ProductName") !== -1 ? headers.indexOf("ProductName") : 1;
  const locIndex = headers.indexOf("LocationID") !== -1 ? headers.indexOf("LocationID") : 3;
  const qtyIndex = headers.indexOf("Quantity") !== -1 ? headers.indexOf("Quantity") : 4;
  const availIndex = headers.indexOf("AvailableQty") !== -1 ? headers.indexOf("AvailableQty") : 6;

  // 2. Read existing assignments from ItemLocationMap to map things up
  let mapSheet = ss.getSheetByName(SHEET_ITEM_LOCATION_MAP);
  const assignmentsMap = {}; // Key: LocationID + "_" + ItemID
  
  if (mapSheet) {
    const mapData = mapSheet.getDataRange().getValues();
    for (let j = 1; j < mapData.length; j++) {
      const mRow = mapData[j];
      const mLoc  = String(mRow[0] || '').trim().toLowerCase();
      const mItem = String(mRow[4] || '').trim().toLowerCase();
      
      // Store the layout definitions using a composite key mapping match
      assignmentsMap[mLoc + "_" + mItem] = {
        rackID: mRow[1] || "",
        sideCode: mRow[2] || "",
        shelfLevel: mRow[3] || ""
      };
    }
  }

  // 3. Filter items by LocationID and cross-reference layouts
  const filteredItems = [];
  const normalizedLocId = String(locationId).toLowerCase().trim();

  for (let i = 1; i < stockData.length; i++) {
    const row = stockData[i];
    if (String(row[locIndex]).toLowerCase().trim() === normalizedLocId) {
      const qty = Number(row[qtyIndex]) || 0;
      const avail = Number(row[availIndex]) || 0;
      
      if (avail > 0) {
        const itemIDStr = String(row[itemIndex]).trim();
        const mapKey = normalizedLocId + "_" + itemIDStr.toLowerCase();
        
        // Lookup if this item has an assignment record on our map
        const placement = assignmentsMap[mapKey] || { rackID: "", sideCode: "", shelfLevel: "" };

        filteredItems.push({
          itemID: itemIDStr,
          productName: row[nameIndex] || "",
          quantity: qty,
          availableQty: avail,
          rackID: placement.rackID,
          sideCode: placement.sideCode,
          shelfLevel: placement.shelfLevel
        });
      }
    }
  }

  return filteredItems;
}

/**
 * Searches items by LocationID and query (partial match on ItemID or Name)
 */
function searchItemsByLocation(locationId, query) {
  const allItems = getItemsByLocation(locationId);
  
  if (!query || query.trim() === "") {
    return allItems;
  }

  const q = query.toLowerCase();
  return allItems.filter(item => 
    String(item.itemID).toLowerCase().includes(q) ||
    String(item.productName).toLowerCase().includes(q)
  );
}