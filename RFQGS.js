/*
function getRFQStockMap(site) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("Stock");

  const result = {
    siteStock: {},
    bodegaStock: {}
  };

  if (!stockSheet) return result;

  const data = stockSheet.getDataRange().getValues();
  const normalizedSite = String(site || "").trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    const itemId = String(data[i][0] || "").trim();
    if (!itemId) continue;

    const locType = String(data[i][2] || "").trim();
    const locationId = String(data[i][3] || "").trim().toUpperCase();
    const available = Number(data[i][6] || 0);

    // Site/Sector stock
    if (normalizedSite && locationId === normalizedSite) {
      result.siteStock[itemId] =
        (result.siteStock[itemId] || 0) + available;
    }else if(locationId.toLowerCase()==="bodega"){
      result.bodegaStock[itemId] =
        (result.bodegaStock[itemId] || 0) + available;

    }

   
  }

  return result;
}

*/
function getRFQStockMap(site) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("Stock");

  const result = {
    siteStock: {},
    bodegaStock: {}
  };

  if (!stockSheet) return result;

  const data = stockSheet.getDataRange().getValues();
  if (data.length < 2) return result; // No data rows

  // Dynamically find columns using the header row (row 0)
  const headers = data[0].map(h => String(h).trim());
  const idxItemId = headers.indexOf("ItemID");
  const idxLocationType = headers.indexOf("LocationType");
  const idxLocationId = headers.indexOf("LocationID");
  const idxAvailableQty = headers.indexOf("AvailableQty");

  // Fallback to hardcoded indices if headers are missing for backward compatibility
  const i_itemId = idxItemId !== -1 ? idxItemId : 0;
  const i_locType = idxLocationType !== -1 ? idxLocationType : 2;
  const i_locId = idxLocationId !== -1 ? idxLocationId : 3;
  const i_avail = idxAvailableQty !== -1 ? idxAvailableQty : 6;

  const normalizedSite = String(site || "").trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const itemId = String(row[i_itemId] || "").trim();
    if (!itemId) continue;

    const locationId = String(row[i_locId] || "").trim().toUpperCase();
    const available = Number(row[i_avail] || 0);

    // Site/Sector stock
    if (normalizedSite && locationId === normalizedSite) {
      result.siteStock[itemId] = (result.siteStock[itemId] || 0) + available;
    } 
    // Bodega central stock
    else if (locationId === "STORE") {
      result.bodegaStock[itemId] = (result.bodegaStock[itemId] || 0) + available;
    }
  }

  return result;
}