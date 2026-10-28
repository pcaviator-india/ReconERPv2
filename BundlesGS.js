function getBundles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const bundleSheet = ss.getSheetByName("Bundles");
  const itemSheet = ss.getSheetByName("Bundle_Items");

  if (!bundleSheet || !itemSheet) {
    throw new Error("Required sheets missing");
  }

  const bundleData = bundleSheet.getDataRange().getValues();
  const itemData = itemSheet.getDataRange().getValues();

  const bHeaders = bundleData[0];
  const iHeaders = itemData[0];

  const colId = bHeaders.indexOf("Bundle ID");
  const colName = bHeaders.indexOf("Bundle Name");
  const colActive = bHeaders.indexOf("Active");

  const iColBundle = iHeaders.indexOf("Bundle ID");

  // count items per bundle
  const itemCountMap = {};

  itemData.slice(1).forEach(r => {
    const id = r[iColBundle];
    if (!id) return;
    itemCountMap[id] = (itemCountMap[id] || 0) + 1;
  });

  return bundleData.slice(1).map(r => {
    const id = r[colId];

    return {
      bundleId: id,
      name: r[colName],
      isActive: String(r[colActive]).toUpperCase() === "TRUE",
      itemCount: itemCountMap[id] || 0
    };
  });
}



function getBundleDetails(bundleId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const bundleSheet = ss.getSheetByName("Bundles");
  const itemSheet = ss.getSheetByName("Bundle_Items");

  const bData = bundleSheet.getDataRange().getValues();
  const iData = itemSheet.getDataRange().getValues();

  const bHeaders = bData[0];
  const iHeaders = iData[0];

  const bIdCol = bHeaders.indexOf("Bundle ID");
  const bNameCol = bHeaders.indexOf("Bundle Name");
  const bActiveCol = bHeaders.indexOf("Active");

  const iBundleCol = iHeaders.indexOf("Bundle ID");
  const iGeoCol = iHeaders.indexOf("Geo Code");
  const iQtyCol = iHeaders.indexOf("Qty");

  // find bundle
  const bundleRow = bData.slice(1).find(r => String(r[bIdCol]) === String(bundleId));

  if (!bundleRow) {
    throw new Error("Bundle not found");
  }

  // items
  const items = iData.slice(1)
    .filter(r => String(r[iBundleCol]) === String(bundleId))
    .map(r => ({
      geo: r[iGeoCol],
      qty: Number(r[iQtyCol] || 1)
    }));

  return {
    bundle: {
      bundleId,
      name: bundleRow[bNameCol],
      isActive: String(bundleRow[bActiveCol]).toUpperCase() === "TRUE"
    },
    items
  };
}

function saveBundle(payload) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const bundleSheet = ss.getSheetByName("Bundles");
    const itemSheet = ss.getSheetByName("Bundle_Items");

    const bundleData = bundleSheet.getDataRange().getValues();
    const headers = bundleData[0];

    const colId = headers.indexOf("Bundle ID");
    const colName = headers.indexOf("Bundle Name");
    const colActive = headers.indexOf("Active");

    const bundleId = payload.bundleId;
    const name = payload.name;
    const isActive = payload.isActive;
    const items = payload.items || [];

    // check if exists
    const existingIndex = bundleData.slice(1)
      .findIndex(r => String(r[colId]) === String(bundleId));

    if (existingIndex === -1) {
      // CREATE
      bundleSheet.appendRow([bundleId, name, isActive]);
    } else {
      // UPDATE
      const row = existingIndex + 2;
      bundleSheet.getRange(row, colName + 1).setValue(name);
      bundleSheet.getRange(row, colActive + 1).setValue(isActive);
    }

    // DELETE OLD ITEMS
    const itemData = itemSheet.getDataRange().getValues();
    const iHeaders = itemData[0];

    const iBundleCol = iHeaders.indexOf("Bundle ID");

    const remaining = itemData.filter((r, idx) => {
      if (idx === 0) return true;
      return String(r[iBundleCol]) !== String(bundleId);
    });

    itemSheet.clearContents();
    itemSheet.getRange(1, 1, remaining.length, remaining[0].length)
      .setValues(remaining);

    // ADD NEW ITEMS
    const newRows = items.map(i => [
      bundleId,
      i.geo,
      i.qty
    ]);

    if (newRows.length > 0) {
      itemSheet.getRange(
        itemSheet.getLastRow() + 1,
        1,
        newRows.length,
        newRows[0].length
      ).setValues(newRows);
    }

    return { success: true };

  } finally {
    lock.releaseLock();
  }
}


function deleteBundle(bundleId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const bundleSheet = ss.getSheetByName("Bundles");
  const itemSheet = ss.getSheetByName("Bundle_Items");

  // delete bundle
  const bData = bundleSheet.getDataRange().getValues();
  const bHeaders = bData[0];
  const bIdCol = bHeaders.indexOf("Bundle ID");

  const filteredBundles = bData.filter((r, i) => {
    if (i === 0) return true;
    return String(r[bIdCol]) !== String(bundleId);
  });

  bundleSheet.clearContents();
  bundleSheet.getRange(1, 1, filteredBundles.length, filteredBundles[0].length)
    .setValues(filteredBundles);

  // delete items
  const iData = itemSheet.getDataRange().getValues();
  const iHeaders = iData[0];
  const iBundleCol = iHeaders.indexOf("Bundle ID");

  const filteredItems = iData.filter((r, i) => {
    if (i === 0) return true;
    return String(r[iBundleCol]) !== String(bundleId);
  });

  itemSheet.clearContents();
  itemSheet.getRange(1, 1, filteredItems.length, filteredItems[0].length)
    .setValues(filteredItems);

  return { success: true };
}
