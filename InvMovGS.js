const MOVEMENTS_SHEET = "Inv_Movement"; 
const STATUS_SHEET = "ItemStatus";
const HSE_SIGN_SHEET = "HSE_Signatures";
const PEOPLE_SHEET = "People";

function bulkIssueItems(payload) {

  const ss = SpreadsheetApp.getActiveSpreadsheet(); 
  const mov = ss.getSheetByName(MOVEMENTS_SHEET); 

  const ts = new Date(); 
  const movementId = generateMovementId(); 

  const itemCondition = payload.condition || "Consumable";

  // Split cart: positive qty = normal issue, negative qty = exchange /
  // unused return (converted to proper RETURN rows so stock, status and
  // active assignments stay consistent).
  const allItems = payload.items || [];
  const issueItems = allItems.filter(item => Number(item.qty) > 0);
  const returnItems = allItems.filter(item => Number(item.qty) < 0);

  // ---------- NORMAL ISSUE LINES ----------
  issueItems.forEach(item => {

    mov.appendRow([
      movementId, 
      ts, 
      item.geo, 
      "ISSUE",  
      item.qty, 
      payload.person,  
      payload.sector || "",  
      payload.maquina || "", 
      payload.generador || "",  
      payload.vehiculo || "", 
      itemCondition,        
      payload.comments || "",  
      payload.userSite || "" 
    ]);

    updateStatus(
      item.geo, 
      "IN_USE", 
      payload.person, 
      payload.sector, 
      ts,
      itemCondition 
    );

  });

  // ---------- NEGATIVE LINES: ADD BACK TO STOCK ----------
  // Logged as RETURN rows (positive qty) for the same person. Stock is
  // credited to the user's site; item status returns to IN_STORE. No
  // HSE signature is required for returned items.
  returnItems.forEach(item => {

    const returnQty = Math.abs(Number(item.qty)) || 0;
    if (returnQty <= 0) return;

    mov.appendRow([
      movementId,
      ts,
      item.geo,
      "RETURN",
      returnQty,
      payload.person,
      payload.sector || "",
      payload.maquina || "",
      payload.generador || "",
      payload.vehiculo || "",
      "Good",
      "[Exchange/Return via Issue] " + (payload.comments || ""),
      payload.userSite || ""
    ]);

    updateStatus(
      item.geo,
      "IN_STORE",
      "",
      "STORE",
      ts,
      "Good"
    );

  });

  console.log("Bulk issue : ", payload.isHSE);

if (payload.isHSE && payload.hseItems && payload.hseItems.length > 0) {
    console.log("Starting HSE signature queueing for movement: " + movementId);

    try {
      const hseSheet = getOrCreateHSESignaturesSheet();

      const person = getPersonById(payload.personId);
      const workerRut = person ? person.rut : "N/A";
      const workerName = person ? person.name : (payload.person || "UNKNOWN");

      // QUEUE the HSE signature for background PDF generation. The PDF is
      // generated/saved to Drive asynchronously via processPendingHSEPDFs()
      // so the user can continue issuing without waiting on the PDF.
      hseSheet.appendRow([
        movementId,                                   // MovementID
        workerRut,                                    // WorkerID
        workerName,                                   // WorkerName
        payload.fingerprintBase64 || "",              // FingerprintBase64
        payload.matchScore || 0,                      // MatchScore
        ts,                                           // MatchTimestamp
        payload.hseItems.length,                      // ItemsCount
        "",                                           // PDFDriveLink (filled when background processing completes)
        "PENDING",                                    // Status
        JSON.stringify(payload.hseItems)              // HSEItemsJSON (for PDF reconstruction)
      ]);

      console.log("HSE signature queued for RUT: " + workerRut + " (movement " + movementId + ")");
    } catch (e) {
      console.error("HSE Queue Error: " + e.toString());
    }
  }

  // Stock: deduct issued items from the user's site
  if (issueItems.length > 0) {
    processInventoryMovement({
      ...payload,
      items: issueItems,
      movementId: movementId,
      userName: payload.person || "System"   
    }, "ISSUE");
  }

  // Stock: credit returned (negative) items back to the user's site
  if (returnItems.length > 0) {
    const absReturnItems = returnItems.map(item => ({
      ...item,
      qty: Math.abs(Number(item.qty)) || 0
    })).filter(item => item.qty > 0);

    if (absReturnItems.length > 0) {
      processInventoryMovement({
        ...payload,
        items: absReturnItems,
        movementId: movementId,
        userName: payload.person || "System"
      }, "RETURN");
    }
  }

  return {
    success: true,
    message: issueItems.length > 0
      ? ("Bulk issue completed" + (returnItems.length > 0 ? " (" + returnItems.length + " item(s) added back)" : ""))
      : "Return via issue completed (" + returnItems.length + " item(s) added back)"
  };
}

function bulkReturnItems(payload) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mov = ss.getSheetByName(MOVEMENTS_SHEET);

  const ts = new Date();
  const movementId = generateMovementId();

  payload.items.forEach(item => {

    mov.appendRow([
      movementId,
      ts,
      item.geo,
      "RETURN",
      item.qty,
      payload.person,
      payload.sector || "",
      payload.maquina || "",
      payload.generador || "",
      payload.vehiculo || "",
      "Good",
      payload.comments || "",
      payload.userSite || ""
    ]);

    updateStatus(
      item.geo,
      "IN_STORE",
      "",
      "STORE",
      ts,
      "Good"
    );

  });

  const stockResult = processInventoryMovement({
    ...payload,
    movementId: movementId,
    userName: payload.person || "System"
  }, "RETURN");

  
  return {
    success: true,
    message: "Bulk return completed"
  };
}


function getOrCreateHSESignaturesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HSE_SIGN_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(HSE_SIGN_SHEET);
    sheet.appendRow([
      "MovementID",
      "WorkerID",
      "WorkerName",
      "FingerprintBase64",
      "MatchScore",
      "MatchTimestamp",
      "ItemsCount",
      "PDFDriveLink",
      "Status",
      "HSEItemsJSON"
    ]);
  } else {
    // Ensure the required columns exist (backwards compatibility with older sheets)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const ensureHeader = (header, insertAt) => {
      if (headers.indexOf(header) === -1) {
        sheet.getRange(1, insertAt).setValue(header);
      }
    };
    ensureHeader("PDFDriveLink", 8);
    ensureHeader("Status", 9);
    ensureHeader("HSEItemsJSON", 10);
  }

  return sheet;
}

/**
 * BACKGROUND PROCESSOR: Reads all PENDING HSE rows, generates the PDF,
 * saves it to Drive, and updates the row with the Drive link + DONE status.
 *
 * This is meant to be called fire-and-forget from the frontend after the
 * issuing completes, so the user never has to wait for PDF generation.
 */
function processPendingHSEPDFs() {
  const hseSheet = getOrCreateHSESignaturesSheet();
  const data = hseSheet.getDataRange().getValues();

  if (data.length < 2) {
    console.log("No HSE signature rows to process.");
    return { success: true, processed: 0 };
  }

  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => { colMap[String(h).trim()] = i; });

  const idxMovement = colMap["MovementID"];
  const idxWorkerId = colMap["WorkerID"];
  const idxWorkerName = colMap["WorkerName"];
  const idxFingerprint = colMap["FingerprintBase64"];
  const idxScore = colMap["MatchScore"];
  const idxTimestamp = colMap["MatchTimestamp"];
  const idxItemsCount = colMap["ItemsCount"];
  const idxPdfLink = colMap["PDFDriveLink"];
  const idxStatus = colMap["Status"] !== undefined ? colMap["Status"] : 8;
  const idxItemsJson = colMap["HSEItemsJSON"] !== undefined ? colMap["HSEItemsJSON"] : 9;

  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[idxStatus] || "").trim().toUpperCase();

    if (status !== "PENDING") continue;

    const movementId = String(row[idxMovement] || "");
    const workerRut = String(row[idxWorkerId] || "");
    const workerName = String(row[idxWorkerName] || "");
    const fingerprintBase64 = String(row[idxFingerprint] || "");
    const matchScore = Number(row[idxScore]) || 0;
    const timestamp = row[idxTimestamp] instanceof Date ? row[idxTimestamp] : new Date(row[idxTimestamp]);

    let hseItems = [];
    try {
      const rawItems = String(row[idxItemsJson] || "").trim();
      if (rawItems) {
        hseItems = JSON.parse(rawItems);
      }
    } catch (e) {
      console.error("Failed to parse HSEItemsJSON for movement " + movementId + ": " + e.toString());
      hseItems = [];
    }

    try {
      // Mark as processing to avoid duplicate attempts on concurrent runs
      hseSheet.getRange(i + 1, idxStatus + 1).setValue("PROCESSING");

      const pdfData = {
        movementId: movementId,
        timestamp: timestamp,
        workerName: workerName,
        workerRut: workerRut,
        fingerprintBase64: fingerprintBase64,
        matchScore: matchScore,
        hseItems: hseItems
      };

      const pdfBlob = generateHSEReceiptPDF(pdfData);
      const driveLink = saveHSEPDFToDrive(movementId, workerRut, workerName, pdfBlob);

      // Update the row with the Drive link and mark as DONE
      hseSheet.getRange(i + 1, idxPdfLink + 1).setValue(driveLink);
      hseSheet.getRange(i + 1, idxStatus + 1).setValue("DONE");

      processed++;
      console.log("HSE PDF generated in background for movement: " + movementId);
    } catch (e) {
      console.error("HSE PDF background processing failed for movement " + movementId + ": " + e.toString());
      // Reset to PENDING so it can be retried on the next run
      hseSheet.getRange(i + 1, idxStatus + 1).setValue("PENDING");
    }
  }

  console.log("processPendingHSEPDFs finished. Processed: " + processed);
  return { success: true, processed: processed };
}

function getPersonById(personId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PEOPLE_SHEET);

  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(personId) || String(data[i][1]) === String(personId)) {
      return {
        id: data[i][0],
        name: data[i][1],
        department: data[i][2],
        active: data[i][3],
        sector: data[i][4],
        rut: data[i][6],
        biometricTemplate: data[i][7] || ""
      };
    }
  }

  return null;
}

/*
function getPeople() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PEOPLE_SHEET);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();

  return data.slice(1).map(r => ({
    id: r[0],
    name: r[1],
    department: r[2],
    active: r[3],
    sector: r[4],
    rut: r[6],
    email: r[8],
  }));
}
*/

function getPeople() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PEOPLE_SHEET);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();

  // 1. Map the data just like you were doing before
  const peopleArray = data.slice(1).map(r => ({
    id: r[0],
    name: r[1],
    department: r[2],
    active: r[3],
    sector: r[4],
    rut: r[6],
    email: r[8],
  }));

  // 2. Sort the array alphabetically by name before returning it
  return peopleArray.sort((a, b) => {
    const nameA = String(a.name || "").toLowerCase();
    const nameB = String(b.name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function updateStatus(barcode, statusVal, holder, sector, ts, condition) {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(STATUS_SHEET);

  if (!sheet) {
    throw new Error("ItemStatus sheet not found");
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const rowBarcode = String(data[i][0] || "").trim();

    if (rowBarcode === String(barcode).trim()) {

      sheet.getRange(i + 1, 2, 1, 5).setValues([[
        statusVal,
        holder,
        sector,
        ts,
        condition
      ]]);

      return;
    }
  }

  sheet.appendRow([
    barcode,
    statusVal,
    holder,
    sector,
    ts,
    condition
  ]);
}

function generateMovementId() {
  return "MOV-" + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyyMMdd-HHmmss"
  );
}



function getAllActiveAssignments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); 
  const mov = ss.getSheetByName(MOVEMENTS_SHEET); 

  if (!mov) return []; 
  const data = mov.getDataRange().getValues(); 
  if (data.length < 2) return []; 
  const map = {}; 

  data.slice(1).forEach(r => {
    const movementId = r[0] || ""; 
    const timestamp  = r[1] ? new Date(r[1]).toLocaleString() : ""; 
    const geo        = String(r[2] || "").trim(); 
    const action     = String(r[3] || "").trim().toUpperCase(); 
    const qty        = parseFloat(r[4]) || 0; 
    const person     = String(r[5] || "").trim().toUpperCase(); 
    const condition  = String(r[10] || "").trim().toUpperCase(); 

    if (action === "ISSUE" && condition === "CONSUMABLE") {
      return;
    }

    if (!geo || !person) return; 

    const key = `${person}__${geo}`; 

    if (!map[key]) {
      map[key] = {
        geo, 
        person, 
        issued: 0, 
        returned: 0, 
        active: 0, 
        sector: "", 
        maquina: "", 
        generador: "", 
        vehiculo: "", 
        movementId: "", 
        timestamp: "" 
      };
    }

    map[key].movementId = movementId; 
    map[key].timestamp = timestamp; 
    map[key].sector = String(r[6] || "").trim(); 
    map[key].maquina = String(r[7] || "").trim(); 
    map[key].generador = String(r[8] || "").trim(); 
    map[key].vehiculo = String(r[9] || "").trim(); 

    if (action === "ISSUE") {
      map[key].issued += qty; 
    } else if (action === "RETURN") {
      map[key].returned += qty; 
    }
    map[key].active = map[key].issued - map[key].returned; 
  });

  const results = Object.values(map).filter(x => x.active > 0); 
  console.log("Found active assignments:", results.length); 
  return results; 
}

function getActiveAssignments(person) {
  const normalizedPerson = String(person || "") 
    .trim() 
    .replace(/\s+/g, " ") 
    .toUpperCase(); 

  if (!person) return []; 
  const ss = SpreadsheetApp.getActiveSpreadsheet(); 
  const movSheet = ss.getSheetByName(MOVEMENTS_SHEET); 

  if (!movSheet) {
    throw new Error("Inv_Movement sheet not found"); 
  }
  const data = movSheet.getDataRange().getValues(); 
  const rows = data.slice(1); 
  const balances = {}; 

  rows.forEach(row => {
    const movementId = row[0]; 
    const timestamp = row[1]; 
    const geo = String(row[2] || "").trim(); 
    const action = String(row[3] || "").trim().toUpperCase(); 
    const qty = Number(row[4]) || 0; 
    const rowPerson = String(row[5] || "").trim().replace(/\s+/g, " ").toUpperCase(); 
    const sector = String(row[6] || "").trim(); 
    const maquina = String(row[7] || "").trim(); 
    const generador = String(row[8] || "").trim(); 
    const vehiculo = String(row[9] || "").trim(); 
    const condition = String(row[10] || "").trim().toUpperCase(); 

    if (rowPerson !== normalizedPerson) return; 
    if (!geo) return; 

    if (action === "ISSUE" && condition === "CONSUMABLE") {
      return;
    }

    if (!balances[geo]) {
      balances[geo] = { 
        geo: geo, 
        issued: 0, 
        returned: 0, 
        active: 0, 
        sector, 
        maquina, 
        generador, 
        vehiculo, 
        movementId: movementId, 
        timestamp: timestamp 
      };
    }

    balances[geo].movementId = movementId; 
    balances[geo].timestamp = timestamp; 
    balances[geo].sector = sector; 
    balances[geo].maquina = maquina; 
    balances[geo].generador = generador; 
    balances[geo].vehiculo = vehiculo; 

    if (action === "ISSUE") {
      balances[geo].issued += qty; 
    }
    if (action === "RETURN") {
      balances[geo].returned += qty; 
    }
    balances[geo].active = balances[geo].issued - balances[geo].returned; 
  });

  const activeItems = Object.values(balances).filter(item => item.active > 0); 
  const masterSheet = ss.getSheetByName("Master"); 
  if (!masterSheet) return activeItems; 

  const masterData = masterSheet.getDataRange().getValues(); 
  const masterRows = masterData.slice(1); 
  const masterMap = {}; 

  masterRows.forEach(r => {
    const geo = String(r[0] || "").trim(); 
    masterMap[geo] = { 
      pn: r[1] || "", 
      category: r[2] || "", 
      sub_categoria: r[3] || "", 
      marca: r[4] || "", 
      en: r[5] || "", 
      es: r[6] || "", 
      un: r[7] || "" 
    };
  });

  activeItems.forEach(item => {
    const m = masterMap[item.geo]; 
    if (m) {
      Object.assign(item, m); 
    }
  });
  return activeItems; 
}




function saveImageToDrive(base64Data, rut) {
  var folders = DriveApp.getFoldersByName("Employees");
  var folder;
  
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder("Employees");
  }
  
  var splitData = base64Data.split(",");
  var contentType = splitData[0].match(/:(.*?);/)[1];
  var data = Utilities.base64Decode(splitData[1]);
  
  var blob = Utilities.newBlob(data, contentType, rut + ".png");
  var file = folder.createFile(blob);
  
  return file.getId(); 
}

// ====== SINGLE PERSON SAVE FIXED INDEX ======
function savePerson(payload) {
  let imageFileId = "";
  if (payload.biometricTemplate && payload.biometricTemplate.startsWith("data:image")) {
     imageFileId = saveImageToDrive(payload.biometricTemplate, payload.rut);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PEOPLE_SHEET);
  const data = sheet.getDataRange().getValues();

  if (payload.id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(payload.id)) {
        // Target 8 columns from column 2 (B) to 9 (I)
        sheet.getRange(i + 1, 2, 1, 8).setValues([[
          payload.name,
          payload.department,
          payload.active,      
          payload.sector, // Column E: Default Sector
          payload.notes,  // Column F: Notes
          payload.rut,    // Column G: RUT
          payload.biometricTemplate, // Column H: BiometricTemplate
          payload.email || ""        // Column I: Email
        ]]);
        return { success: true, message: "Person updated successfully" };
      }
    }
  }

  const id = "RD-" + new Date().getTime();
  sheet.appendRow([
    id,
    payload.name,
    payload.department,
    true,                
    payload.sector,  // Column E: Default Sector
    payload.notes,   // Column F: Notes
    payload.rut,     // Column G: RUT
    payload.biometricTemplate, // Column H: BiometricTemplate
    payload.email || ""        // Column I: Email
  ]);

  return { success: true, message: "Person added successfully" };
}

// ====== BULK PERSON SAVE FIXED INDEX ======
function bulkSavePeople(payloadArray, mode) {
  if (!payloadArray || !Array.isArray(payloadArray) || payloadArray.length === 0) {
    return { success: false, message: "No person entries found." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PEOPLE_SHEET);
  
  const data = sheet.getDataRange().getValues();
  const rutMap = {};
  
  if (mode === "upsert" && data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      const existingRut = String(data[i][6]).trim(); // Column G is index 6
      if (existingRut) {
        rutMap[existingRut] = i + 1;
      }
    }
  }

  let baseTimestamp = new Date().getTime();
  const rowsToAppend = [];
  let updateCount = 0;

  payloadArray.forEach((person, index) => {
    let isActive = true;
    if (person.active) {
      const statusStr = person.active.trim().toLowerCase();
      if (statusStr === "false" || statusStr === "inactive") isActive = false;
    }

    const targetRow = person.rut ? rutMap[person.rut] : null;

    if (mode === "upsert" && targetRow) {
      sheet.getRange(targetRow, 2, 1, 8).setValues([[
        person.name || "",
        person.department || "",
        isActive,
        person.sector || "", // Column E: Default Sector
        person.notes || "",  // Column F: Notes
        person.rut || "",    // Column G: RUT
        person.biometricTemplate || "", // Column H: BiometricTemplate
        person.email || ""   // Column I: Email
      ]]);
      updateCount++;
    } else {
      const customId = "RD-" + (baseTimestamp + index);
      rowsToAppend.push([
        customId,
        person.name || "",
        person.department || "",
        isActive,
        person.sector || "", // Column E: Default Sector
        person.notes || "",  // Column F: Notes
        person.rut || "",    // Column G: RUT
        person.biometricTemplate || "", // Column H: BiometricTemplate
        person.email || ""   // Column I: Email
      ]);
    }
  });

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, 9).setValues(rowsToAppend);
  }

  let summaryMessage = "";
  if (rowsToAppend.length > 0) summaryMessage += `${rowsToAppend.length} new profiles added. `;
  if (updateCount > 0) summaryMessage += `${updateCount} profiles updated successfully.`;

  return { success: true, message: summaryMessage || "Done." };
}

function togglePersonStatus(id, newStatus) {

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName(PEOPLE_SHEET);

  const data =
    sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    if (String(data[i][0]) === String(id)) {

      sheet
        .getRange(i + 1, 4)
        .setValue(newStatus);

      return {
        success: true,
        message:
          newStatus
            ? "Person activated"
            : "Person deactivated"
      };
    }
  }

  return {
    success: false,
    message: "Person not found"
  };
}



function getMovementValidation() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Movement_Val");

  if (!sheet) {
    throw new Error("Movement_Val sheet not found");
  }

  const data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return {
      Sector: [],
      Maquina: [],
      Generador: [],
      Vehiculo: []
    };
  }

  const headers = data[0];

  const colIndex = {
    Sector: headers.indexOf("Sector"),
    Maquina: headers.indexOf("Maquina"),
    Generador: headers.indexOf("Generador"),
    Vehiculo: headers.indexOf("Vehiculo")
  };

  const result = {
    Sector: new Set(),
    Maquina: new Set(),
    Generador: new Set(),
    Vehiculo: new Set()
  };

  for (let i = 1; i < data.length; i++) {

    const row = data[i];

    if (colIndex.Sector !== -1 && row[colIndex.Sector])
      result.Sector.add(String(row[colIndex.Sector]).trim());

    if (colIndex.Maquina !== -1 && row[colIndex.Maquina])
      result.Maquina.add(String(row[colIndex.Maquina]).trim());

    if (colIndex.Generador !== -1 && row[colIndex.Generador])
      result.Generador.add(String(row[colIndex.Generador]).trim());

    if (colIndex.Vehiculo !== -1 && row[colIndex.Vehiculo])
      result.Vehiculo.add(String(row[colIndex.Vehiculo]).trim());

  }

  return {
    Sector: [...result.Sector],
    Maquina: [...result.Maquina],
    Generador: [...result.Generador],
    Vehiculo: [...result.Vehiculo]
  };
}

/*
function processInventoryMovement(payload, action) {
  if (!payload || !payload.items || payload.items.length === 0) {
    return { success: false, message: "No items" };
  }

  const userName = payload.userName || "System";
  const sector = payload.sector || "Unknown";
  const movementId = payload.movementId || "MOV-" + new Date().getTime();
  let results = [];

  payload.items.forEach(item => {
    const itemId = item.geo || item.barcode;

    if (action === "ISSUE") {
      const deduct = updateStock(
        itemId,
        LOCATION_TYPE_SECTOR,
        "Store",
        -item.qty,
        "InternalMove",
        movementId,
        "InvMov",
        `Issued to ${payload.person || 'Person'} / Sector: ${sector}`,
        userName,
        sector
      );
      results.push(deduct);
    } 
    else if (action === "RETURN") {
      const add = updateStock(
        itemId,
        LOCATION_TYPE_SECTOR,
        "Store",
        item.qty,
        "InternalMove",
        movementId,
        "InvMov",
        `Returned from ${payload.person || 'Person'} / Sector: ${sector}`,
        userName,
        sector
      );
      results.push(add);
    }
  });

  console.log(`Processed ${action} movement with ${results.length} items`);
  return { success: true, processed: results.length };
} */


function processInventoryMovement(payload, action) {

  if (!payload || !payload.items || payload.items.length === 0) {
    return {
      success: false,
      message: "No items"
    };
  }

  const userName = payload.userName || "System";

  // Destination selected in the sector dropdown
  const targetSector = payload.sector || "Unknown";

  // Source location of the logged-in user
  const userSite = payload.userSite;

  if (!userSite || String(userSite).trim() === "") {
    throw new Error(
      "CRITICAL: Inventory movement canceled. " +
      "The user's active operating site is undefined."
    );
  }

  const movementId =
    payload.movementId ||
    "MOV-" + new Date().getTime();

  const results = [];

  payload.items.forEach(item => {

    const itemId = item.geo || item.barcode;
    const qty = Number(item.qty) || 0;

    if (!itemId || qty <= 0) {
      console.warn(
        `Skipping invalid item: ${itemId} | Qty: ${qty}`
      );
      return;
    }

    // ==========================================================
    // ISSUE
    //
    // Deducts ONLY from the logged-in user's site (userSite).
    // The selected sector is metadata only (movement record,
    // ledger comment) — it is NEVER a stock location, because
    // issued items travel with the employee across sites.
    //
    // Passing userSite as the sector arg forces the SAME-LOCATION
    // path in updateStock() => single clean -qty adjustment.
    // ==========================================================

    if (action === "ISSUE") {

      const result = updateStock(
        itemId,
        LOCATION_TYPE_SECTOR,
        userSite,
        -qty,
        "InternalMove",
        movementId,
        "InvMov",
        `Issued to ${payload.person || "Person"} ` +
        `(Sector: ${targetSector})`,
        userName,
        userSite
      );

      results.push(result);
    }

    // ==========================================================
    // RETURN
    //
    // Credits ONLY the logged-in user's site (userSite).
    // The sector is metadata only. Previously this deducted from
    // the sector and added to the site (transfer), which broke
    // when sector == site (return deducted instead of adding).
    //
    // Passing userSite as the sector arg forces the SAME-LOCATION
    // path in updateStock() => single clean +qty adjustment.
    // ==========================================================

    else if (action === "RETURN") {

      const result = updateStock(
        itemId,
        LOCATION_TYPE_SECTOR,
        userSite,
        qty,
        "InternalMove",
        movementId,
        "InvMov",
        `Returned by ${payload.person || "Person"} ` +
        `(Sector: ${targetSector})`,
        userName,
        userSite
      );

      results.push(result);
    }

    else {
      throw new Error(
        `Invalid inventory movement action: ${action}`
      );
    }
  });

  console.log(
    `Processed ${action} movement with ` +
    `${results.length} inventory transactions`
  );

  return {
    success: true,
    processed: results.length,
    movementId: movementId,
    results: results
  };
}


// updateStock function removed - using canonical version from StockGS.js




function getAllDailyMovements() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(MOVEMENTS_SHEET);

    if (!sheet) {
      throw new Error(
        'Sheet "' + MOVEMENTS_SHEET + '" was not found.'
      );
    }

    const data = sheet.getDataRange().getValues();

    console.log("getAllDailyMovements()");
    console.log("Spreadsheet: " + ss.getName());
    console.log("Sheet: " + sheet.getName());
    console.log("Rows found: " + data.length);

    if (data.length <= 1) {
      console.log("No movement rows found.");
      return [];
    }

    const timezone = Session.getScriptTimeZone();
    const results = [];

    // ----- Build inventory lookup: geo -> {en, es} descriptions -----
    const invMap = {};
    try {
      const masterSheet = ss.getSheetByName("Master");
      if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        // Master columns: 0=geo, 1=pn, 2=category, 3=subcat, 4=brand, 5=en/desc, 6=es/desc
        for (let i = 1; i < masterData.length; i++) {
          const geo = String(masterData[i][0] || "").trim();
          if (geo) {
            invMap[geo] = {
              en: String(masterData[i][5] || ""),
              es: String(masterData[i][6] || "")
            };
          }
        }
      }
    } catch (e) {
      console.error("Error loading inventory descriptions: " + e.toString());
    }

    // ----- Build HSE PDF link lookup: movementId -> PDFDriveLink -----
    const hseMap = {};
    try {
      const hseSheet = ss.getSheetByName(HSE_SIGN_SHEET);
      if (hseSheet) {
        const hseData = hseSheet.getDataRange().getValues();
        if (hseData.length > 1) {
          const headers = hseData[0];
          const colMap = {};
          headers.forEach(function(h, i) { colMap[String(h).trim()] = i; });
          const idxMovement = colMap["MovementID"];
          const idxPdfLink = colMap["PDFDriveLink"];
          const idxStatus = colMap["Status"];
          for (let i = 1; i < hseData.length; i++) {
            const row = hseData[i];
            const movementId = String(row[idxMovement] || "").trim();
            const status = String(row[idxStatus] || "").trim().toUpperCase();
            const pdfLink = String(row[idxPdfLink] || "").trim();
            if (movementId && status === "DONE" && pdfLink) {
              hseMap[movementId] = pdfLink;
            }
          }
        }
      }
    } catch (e) {
      console.error("Error loading HSE PDF links: " + e.toString());
    }

    // Skip header
    for (let i = 1; i < data.length; i++) {

      const row = data[i];

      const movementId = String(row[0] || "").trim();
      const rawTimestamp = row[1];

      // Ignore completely empty rows
      if (!movementId || !rawTimestamp) {
        continue;
      }

      const rowDate = new Date(rawTimestamp);

      if (isNaN(rowDate.getTime())) {
        console.log(
          "Invalid timestamp at row " + (i + 1) + ": " + rawTimestamp
        );
        continue;
      }

      // IMPORTANT:
      // Convert Date to STRING before sending through google.script.run
      const dateStr = Utilities.formatDate(
        rowDate,
        timezone,
        "yyyy-MM-dd"
      );

      const timeStr = Utilities.formatDate(
        rowDate,
        timezone,
        "HH:mm:ss"
      );

      // ISO-like timestamp, but generated in the script timezone
      const timestampStr = Utilities.formatDate(
        rowDate,
        timezone,
        "yyyy-MM-dd'T'HH:mm:ss"
      );

      const inv = invMap[String(row[2] || "").trim()] || {};

      results.push({
        movementId: movementId,
        timestamp: timestampStr,
        dateStr: dateStr,
        timeStr: timeStr,

        itemGeo: String(row[2] || ""),
        type: String(row[3] || "").toUpperCase(),
        qty: Number(row[4]) || 0,

        person: String(row[5] || ""),
        sector: String(row[6] || ""),
        maquina: String(row[7] || ""),
        generador: String(row[8] || ""),
        vehiculo: String(row[9] || ""),

        condition: String(row[10] || ""),
        comments: String(row[11] || ""),

        // Site: col 13. Old rows are backfilled directly in the sheet (manual one-time pass).
        site: String(row[12] || "").trim(),

        descEn: inv.en || "",
        descEs: inv.es || "",
        pdfLink: hseMap[movementId] || ""
      });
    }

    // Newest first
    results.sort(function(a, b) {
      return b.timestamp.localeCompare(a.timestamp);
    });

    console.log("Returning movements: " + results.length);

    return results;

  } catch (err) {

    console.error(
      "Error in getAllDailyMovements: " + err.toString()
    );

    throw new Error(
      "getAllDailyMovements failed: " + err.message
    );
  }
}