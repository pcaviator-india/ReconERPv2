const LOG_SHEET_NAME = "MacroHistoryLog"; 

function processAndSaveBulkPO(csvData, selectedCategories, cachedInventory, fileExportOption, columnIndexes, userDateFormat) {
  try {
    var ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
    var parentFolder = ssFile.getParents().next();
    var subFolders = parentFolder.getFoldersByName("Exports");
    var targetFolder = subFolders.hasNext() ? subFolders.next() : parentFolder;

    var errors = [];
    var poGroups = {};
    
    var dteIdx = columnIndexes.date;
    var invIdx = columnIndexes.invoice; 
    var vIdx = columnIndexes.vendor;
    var iIdx = columnIndexes.item;
    var dIdx = columnIndexes.desc;
    var qIdx = columnIndexes.qty;
    var cIdx = columnIndexes.cost;

    // --- 1. DATA PARSING AND SANITIZATION LOOP ---
    for (var i = 1; i < csvData.length; i++) {
      var row = csvData[i];
      if (!row || row.length <= Math.max(dteIdx, invIdx, vIdx, iIdx, qIdx, cIdx) || !row[invIdx]) continue;
      
      var rawDate = row[dteIdx].toString().trim();
      var invNum  = row[invIdx].toString().trim();
      var vendor  = row[vIdx].toString().trim();
      var item    = row[iIdx].toString().trim();
      var qty     = row[qIdx].toString().trim();
      var cost    = row[cIdx].toString().trim();
      var desc    = (row[dIdx] || "Non-Catalog Item Entry").toString().trim();
      
      var cleanItemUpper = item.toString().replace(/[\s\t\r\n]/g, '').toUpperCase();
      if (cleanItemUpper !== "SPECIAL" && !cachedInventory[cleanItemUpper]) {
        errors.push({ row: i + 1, invoice: invNum, item: item, reason: "Mismatched system master registration code rules." });
        continue; 
      }
      
      var cleanGPDate = formatToDDMMYYYY(rawDate, userDateFormat);
      var baseCost = cost.toString().replace(/[\$\s,]/g, '');
      var integerCost = baseCost.split('.')[0]; 
      
      if (!poGroups[invNum]) {
        // Unpack composite payload properties safely
        var mappedConfig = selectedCategories[invNum] || {};
        var assignedCategory = (typeof mappedConfig === 'object') ? (mappedConfig.category || "OPS") : "OPS";
        var assignedCurrency = (typeof mappedConfig === 'object') ? (mappedConfig.currency || "USD") : "USD";

        poGroups[invNum] = { 
          vendor: vendor, 
          category: assignedCategory,
          currency: assignedCurrency, 
          docDate: cleanGPDate, 
          items: [] 
        };
      }
      
      poGroups[invNum].items.push({ item: item, qty: qty, cost: integerCost, desc: desc });
    }
    
    if (Object.keys(poGroups).length === 0) {
      return { success: false, msg: "No valid transaction data rows compiled successfully.", errors: errors };
    }
    
    // --- 2. BUILD THE ARTIFACT CONTENTS ---
    var macroContentText = buildMacroContent(poGroups);
    var csvContentText   = buildFlatCsvContent(poGroups); // <-- Places currency at the end of the line
    
    var baseFileName = "GP_Bulk_Batch_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
    var archiveName = baseFileName + ".zip";
    
    // --- 3. BUNDLE BOTH FILES INTO A SINGLE ZIP ARCHIVE ---
    var macroBlob = Utilities.newBlob(macroContentText, "text/plain", baseFileName + ".mac");
    var csvBlob   = Utilities.newBlob(csvContentText, "text/csv", baseFileName + "_DataExchange.csv");
    
    var zipBlob = Utilities.zip([macroBlob, csvBlob], archiveName);
    var savedFile = targetFolder.createFile(zipBlob);
    
    savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    logMacroGeneration(Object.keys(poGroups).length, "Dual Engine Export Bundle (MAC + CSV)", savedFile.getId());
    
    return { 
      success: true, 
      downloadUrl: savedFile.getDownloadUrl(), 
      fileName: archiveName, 
      totalPOs: Object.keys(poGroups).length, 
      errors: errors 
    };
  } catch (err) {
    return { success: false, msg: "Backend Failure Pipeline Crash: " + err.toString() };
  }
}

/**
 * GENERATES CSV MATRIX WITH NEW "CURRENCY" HEADER AT THE ABSOLUTE END
 */
function buildFlatCsvContent(poGroups) {
  var csvRows = [];
  
  // FIXED: "Currency" placed safely at index 8 (the very end)
  csvRows.push("InvoiceNumber,Category,DocDate,VendorID,ItemNumber,Description,QtyOrdered,UnitCost,Currency");
  
  for (var invNum in poGroups) {
    var po = poGroups[invNum];
    for (var j = 0; j < po.items.length; j++) {
      var itm = po.items[j];
      
      var safeDesc = itm.desc.replace(/"/g, '""');
      if (safeDesc.search(/("|,|\n)/) != -1) {
        safeDesc = '"' + safeDesc + '"';
      }
      
      // FIXED: Kept existing indices 0-7 untouched, currency appended at index 8
      var rowStr = [
        invNum,       // 0
        po.category,  // 1
        po.docDate,   // 2
        po.vendor,    // 3
        itm.item,     // 4
        safeDesc,     // 5
        itm.qty,      // 6
        itm.cost,     // 7
        po.currency   // 8 (The very end)
      ].join(",");
      csvRows.push(rowStr);
    }
  }
  return csvRows.join("\r\n");
}

/**
 * PARSES INPUT STRINGS CONDITIONALLY BASED ON EXPLICIT USER LAYOUT APPROVAL
 */
function formatToDDMMYYYY(dateStr, userDateFormat) {
  // If user selected "Auto-Detect / Keep Original", strip formatting characters but leave position orders untouched
  if (userDateFormat === "auto_clean") {
    return dateStr.replace(/[^0-9]/g, '');
  }

  var parts = dateStr.split(/[\/\-\s.]/);
  
  if (parts.length >= 3) {
    var p1 = parts[0].toString();
    var p2 = parts[1].toString();
    var p3 = parts[2].toString();
    
    // Normalize ISO Year-First (YYYY-MM-DD or YYYY-DD-MM) layout cases safely
    if (p1.length === 4) { 
      var year = p1; 
      var month = (userDateFormat === "MMDDYYYY") ? p2 : p3; 
      var day = (userDateFormat === "MMDDYYYY") ? p3 : p2;
    } else {
      var year = p3;
      var month = (userDateFormat === "MMDDYYYY") ? p1 : p2;
      var day = (userDateFormat === "MMDDYYYY") ? p2 : p1;
    }
    
    if (day.length === 1) day = "0" + day;
    if (month.length === 1) month = "0" + month;
    
    return day + month + year;
  }
  
  // Handling un-delimited flat numbers sequence fallback
  var cleanStr = dateStr.replace(/[^0-9]/g, '');
  if (cleanStr.length === 7) cleanStr = "0" + cleanStr;
  
  if (cleanStr.length === 8) {
    var segmentA = cleanStr.substring(0, 2);
    var segmentB = cleanStr.substring(2, 4);
    var segmentY = cleanStr.substring(4, 8);
    
    if (userDateFormat === "MMDDYYYY") {
      // Input is Month-First, re-arrange fields cleanly to Day-First for GP
      return segmentB + segmentA + segmentY;
    } else {
      // Input is already Day-First, bypass rearranging fields completely
      return segmentA + segmentB + segmentY;
    }
  }
  
  return cleanStr; 
}

/**
 * GENERATES A CLEAN RE-PARSABLE CSV MATRIX FOR PYTHON AUTOMATION DEPLOYMENT
 
function buildFlatCsvContent(poGroups) {
  var csvRows = [];
  // Standardized schema columns headers
  csvRows.push("InvoiceNumber,Category,DocDate,VendorID,ItemNumber,Description,QtyOrdered,UnitCost");
  
  for (var invNum in poGroups) {
    var po = poGroups[invNum];
    for (var j = 0; j < po.items.length; j++) {
      var itm = po.items[j];
      
      // Escape commas in descriptions to prevent parsing dropouts
      var safeDesc = itm.desc.replace(/"/g, '""');
      if (safeDesc.search(/("|,|\n)/) != -1) {
        safeDesc = '"' + safeDesc + '"';
      }
      
      var rowStr = [
        invNum,
        po.category,
        po.docDate,
        po.vendor,
        itm.item,
        safeDesc,
        itm.qty,
        itm.cost
      ].join(",");
      csvRows.push(rowStr);
    }
  }
  return csvRows.join("\r\n");
}
*/

/**
 * STANDARD MACRO WRITER NATIVE INTERMEDIARY GP ACTIONS
 */
function buildMacroContent(poGroups) {
  var lines = [];
  lines.push("# DEXVERSION=18.00.0028.000 2 2");
  
  var groupKeys = Object.keys(poGroups);
  
  for (var i = 0; i < groupKeys.length; i++) {
    var invNum = groupKeys[i];
    var po = poGroups[invNum];
    
    lines.push("CheckActiveWin dictionary 'default'  form 'POP_PO_Entry' window 'POP_PO_Entry' ");
    lines.push("  ClickHit field 'PO Type' item 1 "); 
    lines.push("  MoveTo field Hold ");
    lines.push("  MoveTo field 'PO Number' ");
    lines.push("  MoveTo field 'Buyer ID' ");
    lines.push("  TypeTo field 'Buyer ID' , '" + po.category + "'");
    lines.push("  MoveTo field 'Document Date' ");
    lines.push("  TypeTo field 'Document Date' , '" + po.docDate + "'");
    lines.push("  MoveTo field 'Allow SO Commitments' ");
    lines.push("  MoveTo field 'Vendor ID' ");
    lines.push("  TypeTo field 'Vendor ID' , '" + po.vendor + "'");
    lines.push("  MoveTo field 'Vendor Name' ");
    
    for (var j = 0; j < po.items.length; j++) {
      var lineIdx = j + 1;
      var itm = po.items[j];
      
      lines.push("  TransLinePrepare scrollwin 'Line_Scroll' ");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Item Number' ");
      lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Item Number' , '" + itm.item + "'");
      
      if (itm.item.toString().trim().toUpperCase() === "SPECIAL") {
        lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Item Description' ");
        lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Item Description' , '" + itm.desc + "'");
      }
      
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'U Of M' ");
      lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'U Of M' , 'EACH'");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'QTY Ordered' ");
      lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'QTY Ordered' , '" + itm.qty + "'");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Unit Cost' ");
      lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Unit Cost' , '" + itm.cost + "'");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Location Code' ");
      lines.push("  TypeTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Location Code' , 'STORE'");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'QTY Canceled' ");
      lines.push("  MoveTo line " + lineIdx + " scrollwin 'Line_Scroll' field 'Extended Cost' ");
    }
    
    if (i === groupKeys.length - 1) {
      lines.push("  CommandExec dictionary 'default'  form 'POP_PO_Entry' command 'Save Button_w_POP_PO_Entry_f_POP_PO_Entry'");
    }
  }
  
  return lines.join("\r\n");
}

function logMacroGeneration(poCount, type, driveId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(["Timestamp", "User Email", "Total PO Transactions Compiled", "Export Architecture Variant Type", "Google Drive File Identity Key"]);
    }
    sheet.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"), Session.getActiveUser().getEmail(), poCount, type, driveId]);
  } catch(e) {}
}

function getMacroHistoryLogs() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var logs = [];
  for (var i = data.length - 1; i >= 1; i--) {
    logs.push({
      timestamp: Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
      user: data[i][1], poCount: data[i][2], type: data[i][3], driveId: data[i][4]
    });
  }
  return logs;
}

function getDownloadUrlById(fileId) {
  return DriveApp.getFileById(fileId).getDownloadUrl();
}