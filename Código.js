/** * WEB APP ENTRY POINT */

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getUserEmail() {
  return Session.getActiveUser().getEmail();
}
function getServiceUrl() {
  return ScriptApp.getService().getUrl();
}
// ============================================
// SINGLE DOGET - REMOVED DUPLICATE
// ============================================
function doGet(e) {

  if (e.parameter.page === 'mov_scanner') {
    return HtmlService.createHtmlOutputFromFile('MovScanner')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("RECON ERP")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 1. Handle browser preflight CORS checks
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
}

// 2. Ensure your doPost responses include the CORS header
function doPost(e) {
  try {
    // 1. Log incoming request for debugging
    Logger.log("Received payload: " + (e ? e.postData.contents : "No postData"));

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No payload received in postData");
    }

    // 2. Parse request body
    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;
    var payload = requestData.payload;

    // 3. Route to your existing action handlers
    var responseData = handleRequestAction(action, payload); // Replace with your actual handler function

    // 4. Return success JSON
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: responseData
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    // 5. Catch ALL errors and return JSON so CORS doesn't break
    Logger.log("doPost Error: " + error.toString());
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString(),
      stack: error.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getModuleHtml(moduleName) {
  try {
    var fileName = moduleName.indexOf("Val") === 0 ? "AdminVal" : moduleName;

    // Use a template so that <?!= include(...) ?> works
    var template = HtmlService.createTemplateFromFile(fileName);

    return template
      .evaluate()
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .getContent();
  } catch (e) {
    console.error("Template Error: " + e.message);
    return (
      "<div style='color:red; padding:20px; background:#fff1f1; border:1px solid red;'>" +
      "<h4>⚠️ Error in " +
      moduleName +
      " or its Included Files</h4>" +
      "<p><b>Message:</b> " +
      e.message +
      "</p>" +
      "<p>Check for syntax errors (missing brackets, etc.) in your JS file.</p></div>"
    );
  }
}

// ============================================
// FIXED: getValidationData() - NOW INCLUDES ALL DATA
// ============================================
function getValidationData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Validation");
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  const categories = [];
  const parCategories = [];
  const subCategories = [];
  const brands = [];
  const suppliers = [];
  const sites = [];
  const currencies = [];
  const subAreas = [];
  const subAreaKeys = new Set();

  for (let i = 1; i < data.length; i++) {
    // Col A (0): Faena/Sites
    if (data[i][0]) {
      sites.push({
        name: data[i][0],
        email: data[i][1] || "",
        suffix: data[i][2] || "",
      });
    }

    // Col F (5): Categories, Col G (6): Email
    if (data[i][5]) {
      categories.push({
        name: data[i][5],
        email: data[i][6] || "",
      });
    }

    // Col H (7): parCategories
    if (data[i][7]) {
      parCategories.push(data[i][7]);
    }

    // Col I (8): SubCategories
    if (data[i][8]) {
      subCategories.push({
        name: data[i][8],
        parent: data[i][7],
      });
    }

    // Col K (10): Brands
    if (data[i][10]) {
      brands.push(data[i][10]);
    }

    // Col P (15): Suppliers, Col Q (16): Email Pro
    if (data[i][15]) {
      suppliers.push({
        name: data[i][15],
        email: data[i][16] || "",
      });
    }

    // Col S (18): Currency, Col T (19): Symbol
    if (data[i][18]) {
      currencies.push({
        name: data[i][18],
        symbol: data[i][19] || "",
      });
    }

    // Col V (21): SubArea, Col W (22): Emails SubArea, Col X (23): Suffix.
    // SubAreas belong to the "Workshop" site (the only site that has them),
    // regardless of what may appear in Col A on those rows.
    if (data[i][21]) {
      const subAreaName = String(data[i][21]).trim();
      const subAreaKey = normalizeUserMatch_("workshop") + "|" + normalizeUserMatch_(subAreaName);
      if (!subAreaKeys.has(subAreaKey)) {
        subAreaKeys.add(subAreaKey);
        subAreas.push({
          name: subAreaName,
          email: String(data[i][22] || "").trim(),
          site: "Workshop",
          suffix: String(data[i][23] || "").trim(),
        });
      }
    }
  }

  return {
    categories: categories,
    subCategories: subCategories,
    brands: brands,
    suppliers: suppliers,
    sites: sites,
    currencies: currencies,
    subAreas: subAreas,
  };
}

/**
 * Updates or Adds an item to the Validation sheet
 */
function updateValidationItem(type, oldIdentifier, newData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log("Updating " + type + " for: " + oldIdentifier);

  if (type === "SystemConfig") {
    const sheet = ss.getSheetByName("Config");
    const data = sheet.getDataRange().getValues();

    // Create a mapping to bridge the Code Name to the Sheet Name
    const nameMap = {
      reqEmailEnabled: "Req Email",
      reqPdfEnabled: "Req PDF",
      quoEmailEnabled: "Quo Email",
      quoPdfEnabled: "Quo PDF",
      // Per-status flags for the "Quote Updated" notification. Same TRUE/FALSE
      // shape as the toggles above, so Admin > System Flags renders them as
      // dropdowns. Read server-side by label in getQuoteEmailStatusFlags_().
      quoteEmailPending: "Quote Email Pending",
      quoteEmailQuoted: "Quote Email Quoted",
      quoteEmailApproved: "Quote Email Approved",
      quoteEmailSent: "Quote Email Sent",
      quoteEmailReceived: "Quote Email Received",
      quoteEmailDespatched: "Quote Email Despatched",
      quoteEmailFinalReceived: "Quote Email Final Received",
    };

    // Convert "reqEmailEnabled" into "Req Email"
    const sheetTargetName = nameMap[oldIdentifier] || oldIdentifier;
    const searchTarget = String(sheetTargetName).trim().toLowerCase();

    for (let i = 0; i < data.length; i++) {
      const cellValue = String(data[i][0]).trim().toLowerCase();

      if (cellValue === searchTarget) {
        // Update Column B with the 1 or 0
        sheet.getRange(i + 1, 2).setValue(newData.status);
        return { success: true };
      }
    }
    return {
      success: false,
      message: "Feature not found in Sheet: " + sheetTargetName,
    };
  }

  if (type === "Users") {
    const sheet = ss.getSheetByName("Users");
    const data = sheet.getDataRange().getValues();
    
    let rowIdx = -1;
    if (oldIdentifier) {
      rowIdx = data.findIndex((r) =>
        String(r[0]).trim().toUpperCase() === String(oldIdentifier).trim().toUpperCase()
      );
    }

    if (rowIdx > -1) {
      // ===== EDIT MODE PROFILE SAVE =====
      const rowData = [
        oldIdentifier,                 // Column A: User Id (Preserve Original 4-digit key)
        newData.pin,                   // Column B: Pin
        newData.name,                  // Column C: Full Name
        newData.email,                 // Column D: Email
        data[rowIdx][4] || "",         // Column E: Phone (Preserve Existing string array parameters)
        newData.position,              // Column F: Position (Mapped from Employee Roster Department)
        newData.site,                  // Column G: Site
        newData.role,                  // Column H: Role
        data[rowIdx][8] || "",         // Column I: Sign Link (Preserved during Edit executions)
        newData.active                 // Column J: Active Status
      ];
      
      sheet.getRange(rowIdx + 1, 1, 1, 10).setValues([rowData]);
    } else {
      // ===== ADD MODE SEQUENTIAL GENERATION =====
      let highestId = 1000;
      
      // Look through data rows starting after the header to compute next numerical identifier
      for (let i = 1; i < data.length; i++) {
        let numericId = parseInt(data[i][0], 10);
        if (!isNaN(numericId) && numericId > highestId) {
          highestId = numericId;
        }
      }
      
      const assignedNewId = String(highestId + 1);
      
      const rowData = [
        assignedNewId,                 // Column A: Computed User Id (1001, 1002, etc.)
        newData.pin,                   // Column B: Pin
        newData.name,                  // Column C: Full Name
        newData.email,                 // Column D: Email
        "",                            // Column E: Phone Placeholder
        newData.position,              // Column F: Position
        newData.site,                  // Column G: Site
        newData.role,                  // Column H: Role
        "",                            // Column I: Sign Link Placeholder
        newData.active                 // Column J: Active Status
      ];
      
      sheet.appendRow(rowData);
    }
    return { success: true };
  }

  const sheet = ss.getSheetByName("Validation");
  const data = sheet.getDataRange().getValues();

  // Mapping: Sites(A=0), Categories(F=5), SubCats(I=8), Brands(K=10), Suppliers(P=15)
  const config = {
    Sites: 0,
    Categories: 5,
    SubCats: 8,
    Brands: 10,
    Suppliers: 15,
  };
  const startCol = config[type];
  let rowIndex = -1;

  if (oldIdentifier) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][startCol]) === String(oldIdentifier)) {
        rowIndex = i + 1;
        break;
      }
    }
  }

  if (rowIndex === -1) {
    for (let i = 1; i < data.length; i++) {
      if (!data[i][startCol]) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) rowIndex = data.length + 1;
  }

  // Column numbers for getRange (1-based): H=8, I=9, K=11, P=16, Q=17
  if (type === "Brands") {
    sheet.getRange(rowIndex, 11).setValue(newData.name);
  } else if (type === "SubCats") {
    sheet
      .getRange(rowIndex, 8, 1, 2)
      .setValues([[newData.parent, newData.name]]);
  } else if (type === "Suppliers") {
    sheet
      .getRange(rowIndex, 16, 1, 2)
      .setValues([[newData.name, newData.email]]);
  } else if (type === "Sites") {
    sheet
      .getRange(rowIndex, 1, 1, 3)
      .setValues([[newData.name, "", newData.suffix]]);
  } else if (type === "Categories") {
    sheet.getRange(rowIndex, 6).setValue(newData.name);
  }

  return { success: true };
}

/** * PDF GENERATION & FOLDER LOGIC */
function generateProfessionalPDF(poData, targetFolder) {
  let html = HtmlService.createTemplateFromFile("PO_Template").getRawContent();

  const logoFileId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
  try {
    const blob = DriveApp.getFileById(logoFileId).getBlob();
    const base64Logo =
      "data:" +
      blob.getContentType() +
      ";base64," +
      Utilities.base64Encode(blob.getBytes()).replace(/(\r\n|\n|\r)/gm, "");
    html = html.replace("{{LOGO_BASE64}}", base64Logo);
  } catch (e) {
    html = html.replace("{{LOGO_BASE64}}", "");
  }

  html = html
    .replace("{{PO_NO}}", poData.poId || "")
    .replace("{{DATE}}", poData.date || "")
    .replace("{{PROMISED}}", poData.date || "")
    .replace("{{SUPPLIER_NAME}}", poData.supplier || "")
    .replace("{{SUPPLIER_RUT}}", poData.supplierRut || "")
    .replace("{{SUPPLIER_ADDRESS}}", poData.supplierAddress || "")
    .replace("{{CURRENCY}}", poData.moneda || "CLP")
    .replace("{{TERMS}}", poData.condicionPago || "")
    .replace(
      "{{NOTES}}",
      (poData.comments || "") + " " + (poData.numCotizacion || ""),
    );

  let rowsHtml = "";
  poData.items.forEach((item, index) => {
    rowsHtml += `<tr>
      <td style="text-align:center;">${index + 1}</td>
      <td>${item.pn || ""}</td>
      <td>${item.desc || ""}</td>
      <td style="text-align:center;">${item.qty || 0}</td>
      <td style="text-align:right;">${Number(item.price || 0).toLocaleString("es-CL")}</td>
      <td style="text-align:right;">${(item.qty * item.price).toLocaleString("es-CL")}</td>
    </tr>`;
  });
  html = html.replace("{{TABLE_ROWS}}", rowsHtml);

  html = html
    .replace("{{SUBTOTAL}}", poData.subtotal.toLocaleString("es-CL"))
    .replace("{{IVA}}", poData.iva.toLocaleString("es-CL"))
    .replace("{{TOTAL}}", poData.total.toLocaleString("es-CL"));

  const blob = Utilities.newBlob(
    html,
    "text/html",
    "PO_" + poData.poId + ".html",
  );
  const pdfFile = targetFolder.createFile(blob.getAs("application/pdf"));
  pdfFile.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW,
  );

  return pdfFile.getUrl();
}

/** * GENERATE REQ PDF
 * Repurposed from your PO logic to handle ES/EN descriptions and GeoCodes
 */
function generateRequirementPDF(orderId, shipment, date, folder) {
  try {
    let htmlTemplate = HtmlService.createTemplateFromFile("REQ_Template");
    let html = htmlTemplate.getRawContent();

    // Logo Logic
    const logoFileId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
    try {
      const blob = DriveApp.getFileById(logoFileId).getBlob();
      const base64Logo =
        "data:" +
        blob.getContentType() +
        ";base64," +
        Utilities.base64Encode(blob.getBytes());
      html = html.replace("{{LOGO_BASE64}}", base64Logo);
    } catch (err) {
      console.warn("Logo failed, using empty: " + err.toString());
      html = html.replace("{{LOGO_BASE64}}", "");
    }

    // SubArea name + folio (Workshop): from the shipment or stored on the Ordenes row
    let subAreaName = String(shipment.subArea || "").trim();
    let subAreaNo = String(shipment.subAreaFolio || "").trim();
    if (!subAreaName || !subAreaNo) {
      try {
        const storedCols = getSubAreaColsByOrderId_(orderId);
        if (!subAreaName) subAreaName = storedCols.subArea;
        if (!subAreaNo) subAreaNo = storedCols.subAreaNo;
      } catch (folioErr) { /* keep defaults */ }
    }

    // Replacements
    html = html
      .replace(/{{REQ_NO}}/g, orderId)
      .replace(/{{DATE}}/g, date)
      .replace(/{{SITE}}/g, shipment.site)
      .replace(/{{USER}}/g, shipment.userName || "")
      .replace(/{{CATEGORY}}/g, shipment.category || "")
      .replace(/{{NOTES}}/g, shipment.body || "N/A")
      .replace(/{{SUBAREA_NAME}}/g, subAreaName || "-")
      .replace(/{{SUBAREA_NO}}/g, subAreaNo || "-");

    let rowsHtml = "";
    shipment.items.forEach((item, index) => {
      const esDesc = String(item.es || "").trim();
      const enDesc = String(item.en || "").trim();
      const qtyValue = item.qty || item.cant || "";
      console.log(`DEBUG generateRequirementPDF: Item ${index}: qty=${item.qty}, cant=${item.cant}, final qtyValue=${qtyValue}`);
      rowsHtml += `<tr>
        <td style="text-align:center;">${index + 1}</td>
        <td>${item.pn || ""}</td>
        <td>${item.geo || ""}</td>
        <td><strong>${esDesc || ""}</strong><br><small style="color:#666;">${enDesc || ""}</small></td>
        <td style="text-align:center;">${qtyValue}</td>
        <td style="font-size:10px;">${cleanReqNotes_(item.itemNotes) || "-"}${reqPdfImagesLinks_(item)}</td>
      </tr>`;
    });
    console.log("DEBUG generateRequirementPDF: Generated rowsHtml =", rowsHtml.substring(0, 500));
    html = html.replace("{{TABLE_ROWS}}", rowsHtml);

    // Create the PDF
    const blob = Utilities.newBlob(html, "text/html", orderId + ".html");
    const pdfFile = folder.createFile(blob.getAs("application/pdf"));
    pdfFile.setName(orderId + ".pdf");
    pdfFile.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW,
    );

    return pdfFile.getUrl();
  } catch (e) {
    console.error("PDF GENERATION FAILED: " + e.toString());
    return "";
  }
}

/**
 * DEPRECATED / UNUSED LEGACY PATH (kept for reference, no caller anywhere).
 * It derives its Order id from Math.max(column A) and writes plain numeric
 * ids, which bypasses the Config "LastReq" sequence used by requirement
 * creation (see reserveReqNumbers_ in CreateReqGS.js). If this is ever
 * re-enabled it MUST be routed through reserveReqNumbers_, otherwise it can
 * hand out numbers that the requirement flow already issued.
 */
function saveRequirementToSheet(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const config = ss.getSheetByName("Config");
  const values = sheet.getDataRange().getValues();

  // Read Flags from Config
  const isPdfEnabled = config.getRange("B15").getValue() === true;
  const isEmailEnabled = config.getRange("B16").getValue() === true;

  let lastOrderId = 1000;
  if (values.length > 1) {
    lastOrderId = Math.max(...values.slice(1).map((r) => Number(r[0]) || 0));
  }
  const newOrderId = lastOrderId + 1;
  const fechaStr = Utilities.formatDate(
    new Date(),
    "GMT-4",
    "dd/MM/yyyy HH:mm",
  );

  // 1. Generate PDF only if B15 is TRUE
  let pdfUrl = "";
  if (isPdfEnabled) {
    // We repurpose your professional PDF logic here
    pdfUrl = generateProfessionalPDF_ForReq(newOrderId, data, fechaStr);
  }

  // 2. Prepare Rows (Following your 12-column structure)
  const rowsToAdd = data.items.map((item) => [
    newOrderId, // Col 1: ID
    fechaStr, // Col 2: Date
    item.pn, // Col 3: P/N
    item.geo, // Col 4: Geo
    data.faena, // Col 5: Site
    item.es || item.desc, // Col 6: Description (Prefer ES)
    item.qty, // Col 7: Qty
    "Pending", // Col 8: Status
    "", // Col 9
    "", // Col 10
    pdfUrl, // Col 11: Link (Matches your UI logic)
    data.user || "", // Col 12: User
  ]);

  sheet
    .getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 12)
    .setValues(rowsToAdd);

  // 3. Send Email via Graph only if email is enabled
  if (isEmailEnabled && data.emailTo) {
    SmartDispatcher({
      type: "Requirement",
      refId: data.orderId || "",
      to: data.emailTo,
      subject: data.subject,
      body: data.body + (pdfUrl ? `<br><br><b>PDF:</b> <a href="${pdfUrl}">View Requirement</a>` : ""),
      replyTo: data.replyTo || "noreply@recon.cl",
      senderEmail: data.senderEmail || data.replyTo || "",
      pdfUrl: pdfUrl || "",
    });
  }

  return { success: true, orderId: newOrderId, pdfUrl: pdfUrl };
}

function getSiteData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Validation");
    const data = sheet
      .getRange("A2:C" + Math.max(sheet.getLastRow(), 5))
      .getValues();
    return data
      .map((row) => ({
        name: row[0] ? String(row[0]).trim() : "",
        email: row[1] ? String(row[1]).trim() : "",
        suffix: row[2] ? String(row[2]).trim() : "",
      }))
      .filter((item) => item.name !== "");
  } catch (e) {
    Logger.log("Error in getSiteData: " + e);
    return [];
  }
}

// ============================================
// FIXED: getInventoryData() - STANDARDIZED KEYS
// ============================================
function getInventoryData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Master");
  const data = sheet.getDataRange().getValues();

  data.shift();

  return data
    .map((row, index) => ({
      id: index,
      geo: String(row[0] || ""), // Changed from 'g' to 'geo'
      pn: String(row[1] || ""), // Changed from 'p' to 'pn'
      category: String(row[2] || ""),
      sub_categoria: String(row[3] || ""),
      marca: String(row[4] || ""),
      en: String(row[5] || ""), // Keep 'en' for English
      es: String(row[6] || ""), // Keep 'es' for Spanish
      un: String(row[7] || ""),
      min: Number(row[8]) || 0,
      max: Number(row[9]) || 0,
      stock: Number(row[10]) || 0,
      stock_fuera: Number(row[11]) || 0,
      costo_clp: Number(row[12]) || 0,
      proveedor: String(row[13] || ""),
      eta: String(row[14] || ""),
    }))
    .filter((i) => i.geo || i.pn);
}

function getAutoSelectedSite() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Validation");
    if (!sheet) return "";

    const data = sheet.getRange("A2:B" + sheet.getLastRow()).getValues();

    const match = data.find(
      (row) => String(row[1]).toLowerCase().trim() === userEmail,
    );

    return match ? match[0] : "";
  } catch (e) {
    return "";
  }
}

function getRecipientsByCategory(category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Validation");
  const data = sheet.getRange("F2:G" + sheet.getLastRow()).getValues();

  const match = data.find(
    (row) =>
      row[0].toString().toLowerCase().trim() === category.toLowerCase().trim(),
  );

  return match ? match[1] : "admin@company.com";
}

function getQuoteConfigFlags_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = ss.getSheetByName("Config");

  return {
    quoPdfEnabled: config ? config.getRange("B18").getValue() === true : false,
    quoEmailEnabled: config
      ? config.getRange("B19").getValue() === true
      : false,
  };
}

/**
 * Read a TRUE/FALSE flag out of the Config sheet BY LABEL (scan Col A, take
 * Col B) instead of a hard-coded cell address, so inserting or reordering rows
 * can never silently repoint the flag at the wrong setting.
 *
 * @param {string} label exact Col-A label (case/whitespace insensitive)
 * @param {boolean} dflt value returned when the row is missing or blank
 * @return {boolean}
 */
function configFlagByLabel_(label, dflt) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName("Config") : null;
    if (!sheet) {
      console.warn("configFlagByLabel_: 'Config' sheet not found — using default for '" + label + "'.");
      return !!dflt;
    }

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const data = sheet.getRange(1, 1, lastRow, 2).getValues();
    const key = String(label || "").trim().toLowerCase();

    for (let i = 0; i < data.length; i++) {
      const rowLabel = String(data[i][0] == null ? "" : data[i][0]).trim().toLowerCase();
      if (rowLabel !== key) continue;
      const raw = data[i][1];
      // Blank cell = not configured yet -> keep the documented default.
      if (raw === null || raw === undefined || String(raw).trim() === "") return !!dflt;
      // configTruthy_ (QuoteMgmtGS.js) understands booleans, 1/0 (what the
      // Admin screen writes) and text such as "TRUE".
      return configTruthy_(raw);
    }

    console.warn("configFlagByLabel_: row '" + label + "' not found in Config — using default.");
    return !!dflt;
  } catch (e) {
    console.warn("configFlagByLabel_ failed for '" + label + "': " + e);
    return !!dflt;
  }
}

function sanitizeFileName_(value) {
  return (
    String(value || "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Quote"
  );
}

function escapeHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildQuoteItems_(details, itemsOverride) {
  // Use itemsOverride when it actually carries rows; otherwise fall back to
  // details.items. An EMPTY array must NOT shadow details.items: [] is truthy,
  // so the old `itemsOverride || details.items` test let a caller-supplied []
  // silently blank out a perfectly good item list - that is what made PDF_ONLY
  // return "No supplier items were provided for this RFQ".
  const itemsList = (Array.isArray(itemsOverride) && itemsOverride.length > 0)
    ? itemsOverride
    : ((details && details.items) || itemsOverride || []);
  if (!Array.isArray(itemsList)) return [];

  const normalized = itemsList.map(function (item) {
    return {
      geo: String(item.geo || "").trim(),
      pn: String(item.pn || item.p || "").trim(),
      es: String(item.es || item.req_desc || item.desc || "").trim(),
      en: String(item.en || "").trim(),
      qty: Number(item.qty || 0),
      supplier: String(item.supplier || (details && details.supplier) || "").trim(),
      category: String(item.category || (details && details.category) || "General").trim(),
      subCategory: String(item.subCategory || "").trim(),
    };
  });

  // 🔒 FIX: previously this hard-dropped every line whose `geo` was blank
  // (`.filter(item => item.geo !== "")`). The supplier/internal email bodies
  // are rendered from the RAW deficit/bodega arrays (no geo filter), so any
  // line that was missing a `geo` (or whose source field was named differently)
  // silently vanished from the Quotes sheet and the PDF while still appearing
  // in the email preview — producing the "only 1 row / no rows saved but the
  // document looks fine" symptom. We now only drop a line when it is genuinely
  // empty (no geo AND no part number AND no description), so a real quote line
  // is never lost just because one optional key is blank.
  return normalized.filter(function (item) {
    return item.geo !== "" || item.pn !== "" || item.es !== "" || item.en !== "";
  });
}

function getQuoteTargetFolder_(siteName, supplierName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssFile = DriveApp.getFileById(ss.getId());
  const parentFolder = ssFile.getParents().next();
  const quoFolder = shared_getOrCreateFolder(parentFolder, "Quo");
  const siteFolder = shared_getOrCreateFolder(
    quoFolder,
    sanitizeFileName_(siteName || "General"),
  );
  return shared_getOrCreateFolder(
    siteFolder,
    sanitizeFileName_(supplierName || "Supplier"),
  );
}

function getQuoteArchiveFolder_(siteName, supplierName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssFile = DriveApp.getFileById(ss.getId());
  const parentFolder = ssFile.getParents().next();
  const quoFolder = shared_getOrCreateFolder(parentFolder, "Quo");
  const obsoleteRoot = shared_getOrCreateFolder(quoFolder, "Obsolete");
  const siteFolder = shared_getOrCreateFolder(
    obsoleteRoot,
    sanitizeFileName_(siteName || "General"),
  );
  return shared_getOrCreateFolder(
    siteFolder,
    sanitizeFileName_(supplierName || "Supplier"),
  );
}

/**
 * Extracts a Google Drive file id from a Drive URL.
 *
 * Only http(s) Drive URLs are accepted. Previously this ran
 * /[-\w]{25,}/ over ANY string, which silently mis-parsed a
 * "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..." payload as the id
 * "4gHYSUNDX1BST0JTEUAAQEAAAHIAAAAAA". DriveApp.getFileById then threw,
 * and resolveMailAttachments_ swallowed the error, so the quotation
 * document was silently dropped from the email. Data URLs are rejected up
 * front instead of being fed to Drive.
 *
 * @param {string} url
 * @return {string} the file id, or "" when the input is not a Drive URL
 */
function getDriveFileIdFromUrl_(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  // Inline data must never reach the Drive id matcher.
  if (/^data:/i.test(value)) return "";
  // A Drive link is always http(s); anything else (blob:, file:, relative
  // path, stray text) cannot yield a usable id.
  if (!/^https?:\/\//i.test(value)) return "";
  const match = value.match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function archiveQuotePdf_(pdfUrl, quoteData) {
  try {
    const fileId = getDriveFileIdFromUrl_(pdfUrl);
    if (!fileId) return { success: false, archivedUrl: "" };

    const file = DriveApp.getFileById(fileId);
    const archiveFolder = getQuoteArchiveFolder_(
      quoteData.site || quoteData.faena || "General",
      quoteData.supplier || "Supplier",
    );

    const sourceName = String(file.getName() || quoteData.quoteFileName || quoteData.quoteId || "Quote")
      .replace(/\.pdf$/i, "")
      .trim() || "Quote";
    const stamped = Utilities.formatDate(
      new Date(),
      "GMT-4",
      "yyyyMMdd_HHmmss",
    );
    let version = 1;
    let archivedName = `${sourceName}_${stamped}_v${version}.pdf`;
    while (archiveFolder.getFilesByName(archivedName).hasNext()) {
      version += 1;
      archivedName = `${sourceName}_${stamped}_v${version}.pdf`;
    }

    file.setName(archivedName);
    file.moveTo(archiveFolder);

    return { success: true, archivedUrl: file.getUrl(), archivedName: archivedName };
  } catch (e) {
    console.warn("Quote PDF archive failed: " + e.toString());
    return { success: false, archivedUrl: "" };
  }
}

function getQuoteSupplierInfo_(supplierName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Proveedor");
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    const targetName = String(supplierName || "")
      .trim()
      .toLowerCase();
    const row = data.slice(1).find(function (item) {
      return (
        String(item[0] || "")
          .trim()
          .toLowerCase() === targetName
      );
    });

    if (!row) return {};

    return {
      name: row[0] || supplierName || "",
      rut: row[1] || "",
      address: row[2] || "",
      email: row[3] || "",
      paymentTerms: row[4] || "",
    };
  } catch (e) {
    return {};
  }
}

function normalizeHeaderKey_(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getHeaderIndex_(headers, candidates) {
  const normalized = headers.map(function (header) {
    return normalizeHeaderKey_(header);
  });

  for (let i = 0; i < candidates.length; i++) {
    const candidate = normalizeHeaderKey_(candidates[i]);
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }

  return -1;
}

function getQuoteLastPriceFromCompras_(geo, pn) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Compras");
    if (!sheet) return 0;

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return 0;

    const headers = data[0];
    const geoIdx = getHeaderIndex_(headers, ["Geo Code", "Geo", "GEO Code"]);
    const priceIdx = getHeaderIndex_(headers, [
      "unit cost clp",
      "Unit cost CLP",
      "Precio Unit.",
      "Precio Unit",
      "Unit Price",
      "Uni Price",
      "Price",
    ]);

    if (priceIdx === -1) return 0;

    const targetGeo = String(geo || "")
      .trim()
      .toLowerCase();

    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      // Geo Code is the authoritative key (never blank); P/N may be blank, so
      // it is intentionally NOT used for matching — Geo-only exact match.
      const rowGeo = geoIdx !== -1
        ? String(row[geoIdx] || "")
          .trim()
          .toLowerCase()
        : "";
      const price =
        Number(
          String(row[priceIdx] || 0)
            .toString()
            .replace(/[^0-9.\-]/g, ""),
        ) || 0;

      if (!price) continue;

      // Strict Geo match only: blank rows or wildcard matches are never
      // accepted (prevents a stale price bleeding onto unrelated items).
      if (targetGeo && rowGeo && rowGeo === targetGeo) {
        return price;
      }
    }

    return 0;
  } catch (e) {
    return 0;
  }
}

function generateQuotePDF(quoteData, targetFolder) {
  try {
    if (!quoteData || !targetFolder) {
      throw new Error("Missing quoteData or targetFolder");
    }
    console.log("=== PDF GEN START ===");
    console.log("quoteData.quoteId:", quoteData.quoteId);
    console.log("quoteData.supplier:", quoteData.supplier);
    console.log("quoteData.items.length:", quoteData.items?.length);

    const logoFileId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
    const supplierInfo = getQuoteSupplierInfo_(quoteData.supplier);
    console.log("supplierInfo retrieved:", !!supplierInfo);

    const quoteDate = Utilities.formatDate(
      new Date(),
      "GMT-4",
      "dd-MMM-yy",
    ).toUpperCase();
    const promisedDate = quoteData.promisedDate
      ? Utilities.formatDate(
        new Date(quoteData.promisedDate),
        "GMT-4",
        "dd-MMM-yy",
      ).toUpperCase()
      : quoteDate;
    const buyerName = quoteData.comprador || quoteData.preparedBy || "";
    const currency = "CLP";

    let subtotal = 0;
    const itemRows = (quoteData.items || [])
      .map(function (item, index) {
        const unitPrice = Number(item.price || item.unitPrice || 0);
        const lineTotal = unitPrice > 0 ? unitPrice * Number(item.qty || 0) : 0;
        if (unitPrice > 0) subtotal += lineTotal;

        const unitPriceHtml =
          unitPrice > 0 ? `${unitPrice.toLocaleString("es-CL")}` : "";
        const lineTotalHtml =
          lineTotal > 0 ? `${lineTotal.toLocaleString("es-CL")}` : "";
        const itemDescription = String(
          item.es || item.desc || item.en || "",
        ).trim();

        return `
        <tr>
          <td style="text-align:center;">${index + 1}</td>
          <td style="text-align:center;">${escapeHtml_(item.geo || "")}</td>
          <td style="text-align:center;">${escapeHtml_(item.pn || "")}</td>
          <td style="text-align:center;">${escapeHtml_(itemDescription)}</td>
          <td style="text-align:center;">EA</td>
          <td style="text-align:center;">${item.qty || 0}</td>
          <td style="text-align:right;">${unitPriceHtml ? `$ ${unitPriceHtml}` : ""}</td>
          <td style="text-align:right;">${lineTotalHtml ? `$ ${lineTotalHtml}` : ""}</td>
        </tr>`;
      })
      .join("");

    console.log("itemRows count:", (quoteData.items || []).length);

    const subtotalHtml =
      subtotal > 0 ? `$ ${subtotal.toLocaleString("es-CL")}` : "";
    const discountHtml = quoteData.discount
      ? `$ ${Number(quoteData.discount).toLocaleString("es-CL")}`
      : "";
    const freightHtml = quoteData.freight
      ? `$ ${Number(quoteData.freight).toLocaleString("es-CL")}`
      : "";
    const ivaHtml = quoteData.ivaTotal
      ? `$ ${Number(quoteData.ivaTotal).toLocaleString("es-CL")}`
      : "";
    const totalValue = Math.max(
      0,
      subtotal -
      Number(quoteData.discount || 0) +
      Number(quoteData.freight || 0) +
      Number(quoteData.ivaTotal || 0),
    );
    const totalHtml =
      totalValue > 0 ? `$ ${totalValue.toLocaleString("es-CL")}` : subtotalHtml;

    try {
      const blob = DriveApp.getFileById(logoFileId).getBlob();
      const base64Logo =
        "data:" +
        blob.getContentType() +
        ";base64," +
        Utilities.base64Encode(blob.getBytes()).replace(/(\r\n|\n|\r)/gm, "");
      var logoHtml = `<img src="${base64Logo}" style="max-height: 72px; max-width: 240px;">`;
    } catch (logoErr) {
      console.warn("Logo failed: " + logoErr.toString());
      var logoHtml = "";
    }

    console.log("Creating template...");
    const template = HtmlService.createTemplateFromFile("Quote_Template");
    console.log("Template created, setting values...");
    template.LOGO_BASE64 = logoHtml;
    template.QUOTE_ID = escapeHtml_(quoteData.quoteId);
    template.QUOTE_DATE = escapeHtml_(quoteDate);
    template.PROMISED_DATE = escapeHtml_(promisedDate);
    template.BUYER = escapeHtml_(buyerName);
    template.CURRENCY = "CLP";
    template.SUPPLIER_NAME = escapeHtml_(
      supplierInfo.name || quoteData.supplier || "",
    );
    template.SUPPLIER_ADDRESS = escapeHtml_(supplierInfo.address || "");
    template.SUPPLIER_RUT = escapeHtml_(supplierInfo.rut || "");
    template.SUPPLIER_EMAIL = escapeHtml_(supplierInfo.email || "");
    template.SUPPLIER_TERMS = escapeHtml_(supplierInfo.paymentTerms || "");
    template.SHIPPING_METHOD = escapeHtml_(quoteData.shippingMethod || "");
    template.PAYMENT_TERMS = escapeHtml_(
      quoteData.condicionPago || supplierInfo.paymentTerms || "",
    );
    template.TERMS = escapeHtml_(quoteData.terms || "");
    template.REQ_BY = escapeHtml_(buyerName);
    template.PAGE_NO = "1";
    template.ITEM_ROWS =
      itemRows || `<tr><td colspan="8" class="center">No items</td></tr>`;
    template.NOTES = escapeHtml_(
      quoteData.comments ||
      quoteData.notes ||
      `COTIZACIÓN N°${quoteData.quoteId}`,
    );
    template.SUBTOTAL = subtotalHtml;
    template.DISCOUNT = discountHtml;
    template.FREIGHT = freightHtml;
    template.IVA = ivaHtml;
    template.TOTAL = totalHtml;
    template.SIGNATURE_NAME = escapeHtml_(buyerName);

    console.log("Evaluating template...");
    const html = template.evaluate().getContent();
    console.log("HTML generated, length: " + html.length);
    /*
    console.log("Creating blob and PDF file...");
    const blob = Utilities.newBlob(
      html,
      "text/html",
      quoteData.quoteId + ".html",
    );
    const pdfFile = targetFolder.createFile(blob.getAs("application/pdf"));
    console.log("PDF file created: " + pdfFile.getId());
    */

    console.log("Creating PDF from TEMPLATE HTML...");

    // 1. Create HTML file from template (safe step)
    const htmlBlob = Utilities.newBlob(
      html,
      MimeType.HTML,
      quoteData.quoteId + ".html"
    );

    const htmlFile = targetFolder.createFile(htmlBlob);

    // 2. Convert HTML file to PDF (Drive engine)
    const pdfBlob = htmlFile.getAs(MimeType.PDF);

    if (!pdfBlob || pdfBlob.getBytes().length === 0) {
      throw new Error("PDF conversion failed from template HTML");
    }

    const pdfFile = targetFolder.createFile(pdfBlob);

    // 3. cleanup temp HTML
    htmlFile.setTrashed(true);

    // 4. finalize
    pdfFile.setName((quoteData.quoteFileName || quoteData.quoteId) + ".pdf");
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    console.log("PDF CREATED:", pdfFile.getUrl());

    //return pdfFile.getUrl(); 

    const finalUrl = pdfFile.getUrl();
    console.log("PDF created successfully: " + finalUrl);
    console.log("=== PDF GEN END (SUCCESS) ===");
    return finalUrl;
  } catch (e) {
    console.error("=== PDF GEN END (FAILED) ===");
    console.error("QUOTE PDF GENERATION FAILED: " + e.toString());
    console.error("Stack: " + e.stack);
    console.error("Line number: " + e.lineNumber);
    return "";
  }
}

/**
 * Sanitize one or more email lists into validated Graph recipient objects.
 * FIX #2: previously SmartDispatcher split ONLY on commas, so a missing comma
 * ("a@x.com b@x.com") or a single typo produced an invalid address object and
 * Graph rejected the ENTIRE sendMail (one bad address = no email at all).
 * Now: split on comma/semicolon/whitespace/newline, strip "Name <mail>" wrappers,
 * dedupe, validate each address, and DROP invalid ones (returned separately so
 * callers can warn instead of failing the whole batch).
 */
function sanitizeGraphRecipients_(raw) {
  var EMAIL_RE = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]{2,}$/;
  var lists = Array.isArray(raw) ? raw : [raw];
  var seen = {};
  var valid = [];
  var invalid = [];
  lists.forEach(function(list) {
    String(list || '').split(/[,;\s\n\r\t]+/).forEach(function(piece) {
      var s = String(piece || '').trim().replace(/^["'<\(\[]+|[\]"'>\)\]]+$/g, '');
      var m = s.match(/<([^<>@\s]+@[^<>\s]+)>/);
      if (m) s = m[1];
      s = String(s || '').trim();
      if (!s) return;
      // Skip placeholder fallbacks used by routing
      if (s.toLowerCase() === 'procurement@yourcompany.com') return;
      var key = s.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      if (EMAIL_RE.test(s)) {
        valid.push({ emailAddress: { address: s } });
      } else {
        invalid.push(s);
      }
    });
  });
  return { valid: valid, invalid: invalid };
}

/**
 * Merge one or more comma/semicolon separated email lists into a single,
 * de-duplicated comma-separated string (ignoring the fallback placeholder).
 */
function mergeEmailRecipients_(emailLists) {
  const seen = {};
  const result = [];
  (Array.isArray(emailLists) ? emailLists : [emailLists]).forEach(function (list) {
    String(list || "")
      .split(/[,;]+/)
      .forEach(function (rawEmail) {
        const email = String(rawEmail || "").trim();
        if (!email || email.toLowerCase() === "procurement@yourcompany.com") return;
        const key = email.toLowerCase();
        if (!seen[key]) {
          seen[key] = true;
          result.push(email);
        }
      });
  });
  return result.join(", ");
}

function saveQuoteToSheet(quoteData, pdfUrl) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Quotes");

  const headers = [
    "Ref ID",
    "Fecha",
    "Proveedor",
    "Faena",
    "Geo Code",
    "P/N",
    "Descripción",
    "Cant.",
    "Precio Unit.",
    "Total Neto",
    "Quote ID",
    "Ref Cotiz.",
    "Estado",
    "PDF Link",
    "Fecha Acordada",
    "Comprador",
    "Moneda",
    "Comments",
    "IVA INC",
    "Condicion Pago",
    "Category",
    "SubCategory",
    // Metadata columns
    "Created By",
    "Created Date",
    "Last Modified By",
    "Last Modified Date",
    "Mod Count",
    "Emails",
    "Quoted Doc Link",
    "Tipo Cambio",
  ];

  if (!sheet) {
    sheet = ss.insertSheet("Quotes");
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  ensureSheetHasHeaders_(sheet, headers);

  const timestamp = Utilities.formatDate(
    new Date(),
    "GMT-4",
    "dd/MM/yyyy HH:mm",
  );
  const quoteSite = String(quoteData.site || quoteData.faena || "");
  const quoteId = String(quoteData.quoteId || quoteData.refCotiz || "");
  const refCotiz = String(quoteData.refCotiz || "");
  const quoteStatus = String(quoteData.status || "Pending");
  const quotePdfUrl = String(pdfUrl || quoteData.pdfUrl || "");
  const quoteFechaAcordada = String(
    quoteData.fechaAcordada || quoteData.promisedDate || "",
  );
  const quoteBuyer = String(
    quoteData.comprador || quoteData.buyer || quoteData.userName || "",
  );
  const quoteCurrency = String(quoteData.currency || "CLP");
  const quoteComments = String(quoteData.comments || quoteData.body || "");
  const quoteIvaInc = String(quoteData.ivaInc || quoteData.iva || "Neto");
  const quoteCondicionPago = String(
    quoteData.condicionPago || quoteData.paymentTerms || "",
  );
  const createdBy = String(
    quoteData.createdBy || quoteData.currentUserEmail || quoteData.replyTo || "",
  );
  const createdDate = quoteData.createdDate instanceof Date
    ? quoteData.createdDate
    : new Date();
  const lastModifiedBy = String(
    quoteData.lastModifiedBy || quoteData.currentUserEmail || quoteData.replyTo || "",
  );
  const lastModifiedDate = quoteData.lastModifiedDate instanceof Date
    ? quoteData.lastModifiedDate
    : new Date();
  const modCount = Number(quoteData.modCount || 1) || 1;
  const emails = String(quoteData.initialRecipients || quoteData.emails || "").trim();
  const rows = (quoteData.items || []).map(function (item) {
    return [
      String(quoteData.orderId || ""),
      timestamp,
      String(quoteData.supplier || ""),
      quoteSite,
      String(item.geo || ""),
      String(item.pn || ""),
      String(item.es || item.en || ""),
      item.qty || 0,
      Number(item.price || 0),
      Number(item.lineTotal || 0),
      quoteId,
      refCotiz,
      quoteStatus,
      quotePdfUrl,
      quoteFechaAcordada,
      quoteBuyer,
      quoteCurrency,
      quoteComments,
      quoteIvaInc,
      quoteCondicionPago,
      String(item.category || quoteData.category || "General"),
      String(item.subCategory || ""),
      // Metadata values
      createdBy,
      Utilities.formatDate(createdDate, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      lastModifiedBy,
      Utilities.formatDate(lastModifiedDate, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      modCount,
      emails,
      String(item.quotedDocUrl || quoteData.quotedDocUrl || ""),
      // Tipo Cambio (exchange rate) — metadata only; blank until set in the edit modal.
      String(quoteData.exchangeRate || item.exchangeRate || ""),
    ];
  });

  if (rows.length > 0) {
    const lock = LockService.getScriptLock();
    let locked = false;
    try {
      lock.waitLock(30000);
      locked = true;
    } catch (lockErr) {
      // Do NOT abort a quote that is otherwise complete (PDF + email) just
      // because the lock is briefly busy. Fall through and append without it.
      console.warn(
        "Quotes sheet lock unavailable, appending without lock: " + lockErr,
      );
    }

    try {
      // Header alignment is ensured while holding the lock so concurrent quote
      // writes never race on column layout.
      ensureSheetHasHeaders_(sheet, headers);
      const firstRow = sheet.getLastRow() + 1;
      sheet.getRange(firstRow, 1, rows.length, headers.length).setValues(rows);
      SpreadsheetApp.flush();
    } catch (writeErr) {
      // The PDF was already generated before this call. A failed/blanked sheet
      // write must never silently drop the quote, so retry line-by-line with
      // appendRow (queue-safe) as a fallback. This is the real fix for the
      // "PDF fine but 0 rows / only 1 row saved" symptom under contention.
      console.warn(
        "Quotes setValues batch write failed, retrying with appendRow: " + writeErr,
      );
      try {
        rows.forEach(function (row) {
          sheet.appendRow(row);
        });
        SpreadsheetApp.flush();
      } catch (fallbackErr) {
        console.error("Quotes sheet appendRow fallback failed: " + fallbackErr);
        if (locked) {
          try { lock.releaseLock(); } catch (e) {}
        }
        return { success: false, rowsWritten: 0, error: String(fallbackErr) };
      }
    } finally {
      if (locked) {
        try { lock.releaseLock(); } catch (e) {}
      }
    }
  }

  return { success: true, rowsWritten: rows.length };
}

function updateQuoteSheetStatus_(quoteId, newStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Quotes");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0].map(function (value) {
    return String(value || "").trim();
  });
  const quoteIdIdx = headers.indexOf("Quote ID");
  const statusIdx = headers.indexOf("Estado");

  if (quoteIdIdx === -1 || statusIdx === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][quoteIdIdx]).trim() === String(quoteId).trim()) {
      sheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
    }
  }
}



/**
 * Aggregator for Requirement -> Quote lifecycle.
 * Returns an array of entries merging Ordenes + Quotes keyed by Order/Ref ID.
 */
/**
 * ---- REPAIR 2: collapse duplicate quote blocks ---------------------------------
 *
 * saveQuoteToSheet() used to run BEFORE the send step in sendFinalRFQ(), so any
 * send that failed (or was retried) left a full block of rows behind and the
 * retry appended a second, identical block under a brand-new Quote ID
 * (timestamp + UUID). The Quotes UI then showed the same requirement twice.
 *
 * A block is only treated as a duplicate when it is an exact content match of
 * another block for the SAME (Ref ID + supplier) AND every row involved is still
 * blank/"Pending". Approved / Quoted history is NEVER touched - those are real
 * business records. The oldest block is kept; later ones are marked
 * Estado = "Deleted", which hides them from every view that filters deleted rows
 * and is trivially reversible (set the cell back to "Pending").
 *
 * Run from the Apps Script editor:
 *   repairQuoteDuplicates()                        // report only (default)
 *   repairQuoteDuplicates({ dryRun: false })       // mark later blocks Deleted
 *   repairQuoteDuplicates({ dryRun: false, hardDelete: true }) // remove rows
 *   repairQuoteDuplicates({ matchOn: "geo" })      // looser: same GEO set only
 *
 * @param {{dryRun:(boolean|undefined), hardDelete:(boolean|undefined),
 *          matchOn:(string|undefined)}} options
 * @return {Object} report describing every block it would touch
 */
/**
 * ---- REPAIR 1: backfill the Quotes "Category" column ----------------------------
 *
 * Legacy rows were written with the literal "Uncategorized" whenever a GEO had
 * no category on the Master sheet, even though Ordenes (column M) already held
 * the category chosen in the assignment dialog when the requirement was created.
 * getPendingRequirementsForRFQ() now prefers Ordenes, but that only fixes NEW
 * rows - this backfills the ones already sitting in the Quotes sheet.
 *
 * Scope is deliberately conservative: only rows whose Category is a "general"
 * token (blank / Uncategorized / General / Sin categoria / ...) are touched.
 * A category a user typed in by hand is never overwritten.
 *
 * Run from the Apps Script editor:
 *   repairQuoteCategories()                      // report only (default)
 *   repairQuoteCategories({ dryRun: false })     // write the corrections
 *
 * @param {{dryRun:(boolean|undefined)}} options
 * @return {{dryRun:boolean, scanned:number, changed:number, applied:boolean,
 *           samples:Array, error:(string|undefined)}}
 */
function repairQuoteCategories(options) {
  const opts = options || {};
  const dryRun = opts.dryRun !== false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Quotes");
  if (!sheet) return { dryRun: dryRun, scanned: 0, changed: 0, applied: false, samples: [], error: "No Quotes sheet" };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { dryRun: dryRun, scanned: 0, changed: 0, applied: false, samples: [] };

  const headers = data[0].map(function (v) { return String(v || "").trim(); });
  const refIdx = headers.indexOf("Ref ID");
  const geoIdx = headers.indexOf("Geo Code");
  const catIdx = headers.indexOf("Category");
  if (refIdx === -1 || catIdx === -1) {
    return { dryRun: dryRun, scanned: 0, changed: 0, applied: false, samples: [],
             error: "Quotes sheet is missing the Ref ID / Category column" };
  }

  // Ordenes column M (index 12) = category assigned at requirement creation.
  const ordenesCatByRef = {};
  try {
    (getRequirementsHistory() || []).forEach(function (req) {
      const ref = String(req.order || "").trim();
      const cat = String(req.category || "").trim();
      if (!ref || !cat || isGeneralCategoryValue_(cat)) return;
      if (!ordenesCatByRef[ref]) ordenesCatByRef[ref] = cat;
    });
  } catch (e) { console.warn("repairQuoteCategories: Ordenes read failed: " + e); }

  // Master column C = product category. Fallback only, never the first choice.
  const masterCatByGeo = {};
  try {
    (getInventoryData() || []).forEach(function (it) {
      const geo = String(it.geo || "").trim();
      const cat = String(it.category || "").trim();
      if (geo && cat && !isGeneralCategoryValue_(cat)) masterCatByGeo[geo] = cat;
    });
  } catch (e) { console.warn("repairQuoteCategories: Master read failed: " + e); }

  // Ref ID may be combined ("100123+100127") - try each source requirement.
  const resolveFor = function (refId, geo) {
    const masterCat = masterCatByGeo[geo] || "";
    const parts = splitCombinedRef_(refId);
    for (let i = 0; i < parts.length; i++) {
      const ordenesCat = ordenesCatByRef[parts[i]];
      if (ordenesCat) return resolveRequirementCategory_(ordenesCat, masterCat);
    }
    return resolveRequirementCategory_("", masterCat);
  };

  const samples = [];
  const updates = [];
  let scanned = 0;
  let changed = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const refId = String(row[refIdx] == null ? "" : row[refIdx]).trim();
    if (!refId) continue;
    scanned++;

    const current = String(row[catIdx] == null ? "" : row[catIdx]).trim();
    // Hand-set categories are left alone - only "general" tokens are repaired.
    if (!isGeneralCategoryValue_(current)) continue;

    const geo = geoIdx === -1 ? "" : String(row[geoIdx] == null ? "" : row[geoIdx]).trim();
    const resolved = resolveFor(refId, geo);
    if (!resolved || resolved === current) continue;

    changed++;
    updates.push({ row: r + 1, col: catIdx + 1, value: resolved });
    if (samples.length < 25) {
      samples.push({ row: r + 1, refId: refId, geo: geo, from: current || "(blank)", to: resolved });
    }
  }

  if (!dryRun && updates.length) {
    const lock = LockService.getScriptLock();
    let locked = false;
    try { lock.waitLock(30000); locked = true; } catch (e) { console.warn("repairQuoteCategories: proceeding without lock"); }
    try {
      updates.forEach(function (u) { sheet.getRange(u.row, u.col).setValue(u.value); });
      SpreadsheetApp.flush();
    } finally {
      if (locked) { try { lock.releaseLock(); } catch (e) {} }
    }
  }

  console.log("repairQuoteCategories dryRun=" + dryRun + " scanned=" + scanned + " changed=" + changed);
  return { dryRun: dryRun, scanned: scanned, changed: changed, applied: !dryRun && updates.length > 0, samples: samples };
}

function repairQuoteDuplicates(options) {
  const opts = options || {};
  const dryRun = opts.dryRun !== false;
  const hardDelete = opts.hardDelete === true;
  // "values" (default) demands identical GEO + Cant. + Precio + Total.
  // "geo" only demands the same set of GEOs (use if a retry re-priced items).
  const matchOn = String(opts.matchOn || "values").toLowerCase() === "geo" ? "geo" : "values";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Quotes");
  if (!sheet) return { dryRun: dryRun, duplicates: 0, groups: [], error: "No Quotes sheet" };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 2) return { dryRun: dryRun, duplicates: 0, groups: [] };

  const headers = data[0].map(function (v) { return String(v || "").trim(); });
  const col = function (name) { return headers.indexOf(name); };
  const refIdx = col("Ref ID");
  const supIdx = col("Proveedor");
  const geoIdx = col("Geo Code");
  const qtyIdx = col("Cant.");
  const priceIdx = col("Precio Unit.");
  const totIdx = col("Total Neto");
  const qidIdx = col("Quote ID");
  const fechaIdx = col("Fecha");
  const stIdx = col("Estado");

  const needed = { refIdx: refIdx, supIdx: supIdx, geoIdx: geoIdx, qidIdx: qidIdx, fechaIdx: fechaIdx, stIdx: stIdx };
  const missing = Object.keys(needed).filter(function (k) { return needed[k] === -1; });
  if (missing.length) {
    return { dryRun: dryRun, duplicates: 0, groups: [], error: "Quotes sheet missing columns: " + missing.join(", ") };
  }

  // (Ref ID || supplier) -> Quote ID -> physical row indexes (0-based, excl. header)
  const blocks = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const ref = String(row[refIdx] || "").trim();
    const qid = String(row[qidIdx] || "").trim();
    if (!ref || !qid) continue;
    const key = ref + " || " + String(row[supIdx] || "").trim();
    blocks[key] = blocks[key] || {};
    blocks[key][qid] = blocks[key][qid] || [];
    blocks[key][qid].push(r);
  }

  const cell = function (row, i) { return i === -1 ? "" : String(row[i] == null ? "" : row[i]).trim(); };
  const num = function (row, i) { return i === -1 ? 0 : Number(row[i]) || 0; };

  // Content fingerprint of one block. Sorted so row order cannot defeat matching.
  const signatureOf = function (rows) {
    const parts = rows.map(function (r) {
      const row = data[r];
      const geo = cell(row, geoIdx);
      if (matchOn === "geo") return geo;
      return [geo, num(row, qtyIdx), num(row, priceIdx), num(row, totIdx)].join("~");
    });
    return parts.filter(Boolean).sort().join(";");
  };

  // Only blank/Pending rows may ever be collapsed - approved/quoted history is
  // a real business record and must survive untouched.
  const isPendingBlock = function (rows) {
    return rows.every(function (r) {
      const st = cell(data[r], stIdx).toLowerCase();
      return st === "" || st === "pending";
    });
  };

  const timeOf = function (rows) {
    const v = data[rows[0]][fechaIdx];
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  const groups = [];
  const victimRows = [];

  Object.keys(blocks).forEach(function (key) {
    const byQid = blocks[key];
    const qids = Object.keys(byQid);
    if (qids.length < 2) return;

    const bySig = {};
    qids.forEach(function (qid) {
      const rows = byQid[qid];
      if (!isPendingBlock(rows)) return;
      const sig = signatureOf(rows);
      if (!sig) return;
      (bySig[sig] = bySig[sig] || []).push({ qid: qid, rows: rows });
    });

    Object.keys(bySig).forEach(function (sig) {
      const dups = bySig[sig];
      if (dups.length < 2) return;
      dups.sort(function (a, b) { return timeOf(a.rows) - timeOf(b.rows); });
      const keeper = dups[0];
      const dropped = dups.slice(1);
      dropped.forEach(function (d) { d.rows.forEach(function (r) { victimRows.push(r); }); });
      groups.push({
        key: key,
        matchOn: matchOn,
        rowsPerBlock: keeper.rows.length,
        kept: { quoteId: keeper.qid, firstRow: keeper.rows[0] + 1 },
        dropped: dropped.map(function (d) {
          return {
            quoteId: d.qid,
            firstRow: d.rows[0] + 1,
            rowNumbers: d.rows.map(function (r) { return r + 1; }),
          };
        }),
      });
    });
  });

  if (!dryRun && victimRows.length) {
    const lock = LockService.getScriptLock();
    let locked = false;
    try { lock.waitLock(30000); locked = true; } catch (e) { console.warn("repairQuoteDuplicates: proceeding without lock"); }
    try {
      if (hardDelete) {
        victimRows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) {
          sheet.deleteRow(r + 1);
        });
      } else {
        victimRows.forEach(function (r) { sheet.getRange(r + 1, stIdx + 1).setValue("Deleted"); });
      }
      SpreadsheetApp.flush();
    } finally {
      if (locked) { try { lock.releaseLock(); } catch (e) {} }
    }
  }

  console.log("repairQuoteDuplicates dryRun=" + dryRun + " matchOn=" + matchOn +
    " duplicateRows=" + victimRows.length + " groups=" + groups.length);
  return {
    dryRun: dryRun,
    hardDelete: hardDelete,
    matchOn: matchOn,
    duplicateRows: victimRows.length,
    groups: groups,
  };
}

function getLifecycleReportData(params) {

  try {
    const reqRows = getRequirementsHistory() || [];
    const quoteRows = getQuotesHistory() || [];

    function clean(v) {
      return String(v || "").trim();
    }

    function normalizeStage(s) {
      if (!s) return "";
      const x = String(s || "").toLowerCase();
      // "Not Quoted" must be caught BEFORE the bare "quot" check, otherwise a
      // supplier-didn't-quote line misreads as "Quoted" in the lifecycle view.
      if ((x.includes("not") && x.includes("quot")) || x.includes("no cotiz") || x.includes("sin cotiz")) return "Not Quoted";
      if (x.includes("final")) return "Final Received";
      if (x.includes("po") || x.includes("orden") || x.includes("ordered") || x.includes("comprad")) return "PO Created";
      if (x.includes("approv") || x.includes("aprob")) return "Approved";
      if (x.includes("despatch") || x.includes("despach")) return "Despatched";
      if (x.includes("received") || x.includes("recib")) return "Received";
      if (x.includes("quot") || x.includes("cotiz")) return "Quoted";
      if (x.includes("rfq") || x.includes("sent")) return "Sent";
      if (x.includes("pend")) return "Pending";
      return s;
    }

    // Build requirement map: orderId -> { meta, items: [] }
    const reqMap = {};
    reqRows.forEach(function (r) {
      const orderId = clean(r.order || r.orderId || r.orderId) || clean(r.order);
      if (!orderId) return;
      reqMap[orderId] = reqMap[orderId] || {
        orderId: orderId,
        createdDate: r.fecha || r.timestamp || "",
        site: r.faena || r.site || "",
        category: r.category || "",
        creator: r.user || "",
        items: [],
        quoteIds: new Set(),
        suppliers: new Set(),
        lastUpdated: r.fecha || "",
      };

      reqMap[orderId].items.push({
        pn: r.pn || "",
        geo: r.geo || "",
        desc: r.desc || "",
        qty: r.cant || 0,
        estado: r.estado || r.estado || "",
        pdfUrl: r.pdfUrl || r.pdf || "",
        quotes: [],
      });
    });

    // Attach quote rows to requirement items
    quoteRows.forEach(function (q) {
      const rawOrderId = clean(q.orderId || q.refCotiz || q.order || "");
      if (!rawOrderId) return;
      // Consolidated quotes carry combined refs ("A+B"): attach the quote row
      // to EVERY source requirement so the lifecycle report stays accurate.
      splitCombinedRef_(rawOrderId).forEach(function (orderId) {
      // ensure reqMap entry
      reqMap[orderId] = reqMap[orderId] || {
        orderId: orderId,
        createdDate: "",
        site: q.faena || "",
        category: q.category || "",
        creator: "",
        items: [],
        quoteIds: new Set(),
        suppliers: new Set(),
        lastUpdated: q.timestampIso || q.timestamp || "",
      };

      const req = reqMap[orderId];
      // record quote id and supplier
      if (q.quoteId) req.quoteIds.add(clean(q.quoteId));
      if (q.supplier) req.suppliers.add(clean(q.supplier));

      // try to match to an existing item by geo or pn
      let matched = null;
      const qGeo = clean(q.geo || q.geoCode || q.geoCode);
      const qPn = clean(q.pn || q.pn || "");
      for (let i = 0; i < req.items.length; i++) {
        const it = req.items[i];
        if (it.geo && qGeo && clean(it.geo) === qGeo) {
          matched = it;
          break;
        }
        if (it.pn && qPn && clean(it.pn) === qPn) {
          matched = it;
          break;
        }
      }

      // if no match, create a synthetic item entry
      if (!matched) {
        matched = { pn: q.pn || "", geo: q.geo || "", desc: q.desc || "", qty: q.cant || 0, estado: "", pdfUrl: q.quoteLink || "", quotes: [] };
        req.items.push(matched);
      }

      // attach quote item
      matched.quotes = matched.quotes || [];
      matched.quotes.push(q);

      // update lastUpdated
      try {
        const qTime = q.timestampIso ? new Date(q.timestampIso) : q.timestamp ? new Date(q.timestamp) : null;
        if (qTime) {
          const ts = qTime.toISOString();
          if (!req.lastUpdated || new Date(req.lastUpdated) < qTime) req.lastUpdated = ts;
        }
      } catch (e) { }
      }); // end splitCombinedRef_ loop
    });

    // Build response entries
    const entries = Object.keys(reqMap).map(function (orderId) {
      const req = reqMap[orderId];
      // STORE detection: orders destined for Store have "Received" as final status
      const isStore = clean(req.site).toLowerCase() === "store";
      // compute per-item last-known status
      let aggregatedStages = new Set();
      let totalQuotedValue = 0;
      req.items.forEach(function (it) {
        let itemStage = "Pending";
        if (it.quotes && it.quotes.length) {
          // find latest quote item by timestamp
          let latest = it.quotes[0];
          let latestTime = latest.timestampIso ? new Date(latest.timestampIso).getTime() : latest.timestamp ? new Date(latest.timestamp).getTime() : 0;
          for (let j = 1; j < it.quotes.length; j++) {
            const cand = it.quotes[j];
            const candTime = cand.timestampIso ? new Date(cand.timestampIso).getTime() : cand.timestamp ? new Date(cand.timestamp).getTime() : 0;
            if (candTime > latestTime) {
              latest = cand;
              latestTime = candTime;
            }
          }
          itemStage = latest.estado || latest.status || itemStage;
          totalQuotedValue += Number(latest.total || latest.total || 0) || 0;
        }
        let norm = normalizeStage(itemStage);
        // For STORE orders, cap the item status at "Received"
        if (isStore && (norm === "Final Received" || norm === "Despatched")) {
          norm = "Received";
        }
        aggregatedStages.add(norm || itemStage || "Pending");
        it.lastKnownStage = norm || itemStage;
      });

      // Determine requirement-level stage by precedence
      const precedence = ["Final Received", "PO Created", "Despatched", "Approved", "Quoted", "Sent", "Pending", "Not Quoted", "Created"];
      let reqStage = "Created";
      for (let p = 0; p < precedence.length; p++) {
        if ([...aggregatedStages].some(s => s === precedence[p])) {
          reqStage = precedence[p];
          break;
        }
      }
      // For STORE orders, cap the requirement-level status at "Received"
      if (isStore && (reqStage === "Final Received" || reqStage === "Despatched")) {
        reqStage = "Received";
      }

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
        lastUpdated: req.lastUpdated || req.createdDate || "",
      };
    });

    // sort by lastUpdated desc
    entries.sort(function (a, b) {
      const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
      const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
      return tb - ta;
    });

    return entries;
  } catch (e) {
    console.error("Lifecycle aggregator error: " + e.toString());
    return [];
  }
}

function getUserSignature(userEmail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    //const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const userSheet = ss.getSheetByName("Users");
    const configSheet = ss.getSheetByName("Config");

    const userData = userSheet.getDataRange().getValues();
    const normalizedEmail = String(userEmail || Session.getActiveUser().getEmail() || "")
      .trim()
      .toLowerCase();
    console.log("DEBUG getUserSignature: Searching for email:", normalizedEmail, "in Users sheet with", userData.length, "rows");

    const userRow = userData.find(
      (row) => String(row[3] || "").trim().toLowerCase() === normalizedEmail,
    );
    console.log("DEBUG getUserSignature: User row found?", userRow ? "YES" : "NO");
    if (userRow) {
      console.log("DEBUG getUserSignature: User name:", userRow[2], "Sign file ID:", userRow[8]);
    }

    const defaultSignId = configSheet.getRange("B12").getValue();
    console.log("DEBUG getUserSignature: Default sign ID from config:", defaultSignId);

    const finalImageId = userRow && userRow[8] ? userRow[8] : defaultSignId;
    console.log("DEBUG getUserSignature: Final image ID to use:", finalImageId);

    let imageSrc = "";
    try {
      const file = DriveApp.getFileById(finalImageId);
      const blob = file.getBlob();
      const fileSizeKB = blob.getBytes().length / 1024;
      console.log("DEBUG getUserSignature: File size:", fileSizeKB.toFixed(2), "KB");

      // If file is large (>100KB), use Drive URL to avoid email body size limits
      if (fileSizeKB > 100) {
        imageSrc = "https://drive.google.com/uc?export=view&id=" + finalImageId;
        console.log("DEBUG getUserSignature: File too large for base64, using Drive URL");
      } else {
        // For small files, embed as base64
        const base64String = Utilities.base64Encode(blob.getBytes());
        imageSrc = "data:" + blob.getContentType() + ";base64," + base64String;
        console.log("DEBUG getUserSignature: File loaded successfully, base64 encoded");
      }
    } catch (err) {
      console.warn("DEBUG getUserSignature: Failed to load file, using Drive URL:", err.toString());
      imageSrc = "https://drive.google.com/uc?export=view&id=" + finalImageId;
    }

    const name = userRow && userRow[2] ? userRow[2] : (normalizedEmail || "RECON User");
    const pos = userRow && userRow[5] ? userRow[5] : "";
    const site = userRow && userRow[6] ? userRow[6] : "Chile";
    const emailText = userRow && userRow[3] ? userRow[3] : normalizedEmail;

    // Set width to 180px for a standard signature size
    return `
      <div style="font-family: Arial, sans-serif; margin-top: 15px; line-height: 1.2;">
        <img src="${imageSrc}" style="width: 120px; height: auto; display: block; margin-bottom: 8px;" alt="RECON Logo">
        <div style="border-left: 2px solid #198754; padding-left: 10px; margin-top: 5px;">
          <strong style="font-size: 14px; color: #333;">${name}</strong><br>
          <span style="font-size: 12px; color: #666;">${pos} | ${site}</span><br>
          <span style="font-size: 11px; color: #198754;">${emailText}</span>
        </div>
      </div>
    `;
  } catch (e) {
    console.error("DEBUG getUserSignature: EXCEPTION:", e.toString());
    return "<div><strong>RECON Drilling</strong></div>";
  }
}

/**
 * SHARED HELPER: Builds the HTML table with merged EN/ES descriptions
 */
/**
 * SHARED HELPER: Builds the Email Table with both EN and ES descriptions
 */
function buildHtmlTable(items) {
  // Per-item notes travel with the requirement email (internal routing
  // recipients only). Kept as a column so the layout stays predictable.
  const notesText = function (item) {
    const s = cleanReqNotes_(item && item.itemNotes);
    return s || "&mdash;";
  };

  // Per-item photos attached in the Create Req cart (Drive URLs uploaded when
  // picked). Column renders only when at least one line has photos, mirroring
  // the conditional Notes logic below. `shipment.items` carries `images` as an
  // array of {url,name} (cart) or the comma-separated "Item Images" cell
  // string (re-loaded drafts) — accept both. Stored URLs come from
  // file.getUrl() (".../file/d/FILEID/view..."); thumbnails use the Drive
  // thumbnail endpoint so the photos render inline in the email, each wrapped
  // in a link to the full file for click-through.
  const showImagesCol = (items || []).some(function (it) {
    return reqItemImageUrls_(it).length > 0;
  });
  const imagesCell = function (item) {
    const urls = reqItemImageUrls_(item);
    if (!urls.length) return "&mdash;";
    const thumbs = urls.map(function (u) {
      const id = reqDriveFileId_(u);
      const thumb = id
        ? ("https://drive.google.com/thumbnail?id=" + id + "&sz=w200")
        : u;
      return '<a href="' + u + '" target="_blank" rel="noopener">' +
        '<img src="' + thumb + '" alt="item image" loading="lazy" ' +
        'style="width:64px;height:64px;object-fit:cover;border:1px solid #ddd;border-radius:4px;margin:1px;vertical-align:middle;">' +
        '</a>';
    }).join("");
    return '<span style="white-space:nowrap;">' + thumbs + '</span>';
  };

  let tableRows = items
    .map((item) => {
      const esDesc = String(item.es || "").trim() || "";
      const enDesc = String(item.en || "").trim() || "";
      const descDisplay = esDesc && enDesc
        ? `<strong>${esDesc}</strong><br><span style="font-size: 10px; color: #666;">${enDesc}</span>`
        : `<strong>${esDesc || enDesc || "---"}</strong>`;

      return `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px;">${item.geo}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${item.pn}</td>
        <td style="border: 1px solid #ddd; padding: 8px; font-size: 11px;">${descDisplay}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.qty}</td>
        <td style="border: 1px solid #ddd; padding: 8px; font-size: 11px;">${notesText(item)}</td>
        ${showImagesCol ? `<td style="border: 1px solid #ddd; padding: 8px; font-size: 11px;">${imagesCell(item)}</td>` : ""}
      </tr>`;
    })
    .join("");

  return `<table style="border-collapse: collapse; width: 100%; font-family: sans-serif; font-size: 13px;">
            <thead style="background: #f8f9fa;">
              <tr>
                <th style="border: 1px solid #ddd; padding: 8px;">Geo</th>
                <th style="border: 1px solid #ddd; padding: 8px;">P/N</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Description</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Qty</th>
                <th style="border: 1px solid #ddd; padding: 8px;">Notes</th>
                ${showImagesCol ? `<th style="border: 1px solid #ddd; padding: 8px;">Images</th>` : ""}
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>`;
}


/**
* Shared logic to handle folder creation and PDF generation for Requirement
*/
function orchestrateRequirementPDF(orderId, shipment) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ssFile = DriveApp.getFileById(ss.getId());
    const parentFolder = ssFile.getParents().next();

    // 1. Get/Create "Req" folder
    let reqFolder = parentFolder.getFoldersByName("Req").hasNext()
      ? parentFolder.getFoldersByName("Req").next()
      : parentFolder.createFolder("Req");

    // 2. Get/Create Site folder
    let siteFolder = reqFolder.getFoldersByName(shipment.site).hasNext()
      ? reqFolder.getFoldersByName(shipment.site).next()
      : reqFolder.createFolder(shipment.site);

    // 3. Clean up old PDF if it exists (prevents multiple versions of the same Order ID)
    const existingFiles = siteFolder.getFilesByName(orderId + ".pdf");
    while (existingFiles.hasNext()) {
      existingFiles.next().setTrashed(true);
    }

    // 4. Generate the PDF
    return generateRequirementPDF(
      orderId,
      shipment,
      new Date().toLocaleString(),
      siteFolder
    );
  } catch (e) {
    console.error("Orchestration failed for " + orderId + ": " + e.toString());
    return ""; // Return empty string so the spreadsheet doesn't crash
  }
}



/**
 * HELPER: Build Email Body with Modification Metadata
 * Shows creation info + modification info if edited
 * UPDATED: Added editorEmail parameter for signature inclusion
 */
function buildEmailWithMetadata(data, editorEmail) {
  // Format dates
  const createdDateStr = data.createdDate instanceof Date
    ? data.createdDate.toLocaleString()
    : String(data.createdDate);

  const modifiedDateStr = data.modifiedDate instanceof Date
    ? data.modifiedDate.toLocaleString()
    : String(data.modifiedDate);

  // Build request history section
  let historyHtml = `
    <h3 style="color: #333; margin: 20px 0 10px 0; font-size: 14px;">REQUEST HISTORY</h3>
    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; font-size: 12px; line-height: 1.6;">
      <p><strong>Created by:</strong> ${data.createdBy}</p>
      <p><strong>Created on:</strong> ${createdDateStr}</p>
  `;

  // Add modification info if count > 1
  if (data.modCount > 1) {
    historyHtml += `
      <hr style="border: none; border-top: 1px solid #ddd; margin: 10px 0;">
      <p><strong>Last Modified by:</strong> ${data.modifiedBy}</p>
      <p><strong>Modified on:</strong> ${modifiedDateStr}</p>
      <p><strong>Modification:</strong> #${data.modCount} (updated ${data.modCount} ${data.modCount === 1 ? 'time' : 'times'})</p>
    `;
  }

  historyHtml += `
    </div>
  `;

  // Build items table. Per-item notes + photos travel with the requirement
  // (they are part of the original requirement email), so they must survive the
  // update email too — previously both were dropped here and the "UPDATED
  // ITEMS" table lost its Notes/Images columns.
  const itemsTable = buildHtmlTable(data.items.map(item => ({
    geo: item.geo,
    pn: item.pn,
    es: item.es || "",
    en: item.en || "",
    qty: item.qty || item.cant || 0,  // Handle both qty and cant, default to 0
    itemNotes: item.itemNotes || "",
    images: item.images || ""
  })));

  // Get signature if editorEmail provided
  let signatureHtml = "";
  if (editorEmail) {
    try {
      console.log("DEBUG buildEmailWithMetadata: Fetching signature for email:", editorEmail);
      signatureHtml = getUserSignature(editorEmail);
      console.log("DEBUG buildEmailWithMetadata: Signature HTML length:", signatureHtml.length, "First 100 chars:", signatureHtml.substring(0, 100));
    } catch (sigErr) {
      console.warn("Could not fetch signature for " + editorEmail + ":", sigErr.toString());
    }
  } else {
    console.warn("DEBUG buildEmailWithMetadata: editorEmail is empty, skipping signature");
  }

  return `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2 style="color: #0066cc; margin: 20px 0 10px 0; font-size: 16px;">
        ${data.modCount > 1 ? 'REQUIREMENT UPDATE' : 'MATERIAL REQUIREMENT'}
      </h2>
      
      <div style="margin: 15px 0; font-size: 12px;">
        <p><strong>Requirement ID:</strong> ${data.orderId}</p>
        <p><strong>Category:</strong> ${data.category}</p>
        <p><strong>Site:</strong> ${data.site}</p>
      </div>

      ${historyHtml}

      <h3 style="color: #333; margin: 20px 0 10px 0; font-size: 14px;">UPDATED ITEMS</h3>
      ${itemsTable}

      <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #666;">
        <p>This is an automated notification from RECON ERP System.</p>
      </div>

      ${signatureHtml ? `<div style="margin-top: 30px; border-top: 1px solid #ccc; padding-top: 15px;">${signatureHtml}</div>` : ""}
    </div>
  `;
}


/**
 * PROCESS MASS ORDERS - 15 COLUMN VERSION
 * NEW FLOW: Create Req ID → Generate PDF → Save to Sheet → Conditional Email Sending
 */


/**
 * Parse an Ordenes "Fecha" cell into a Date.
 *
 * The main creation flow (CreateReqGS) writes a real Date object, but the legacy
 * mass-orders path writes the stamp as text in "dd/MM/yyyy HH:mm" form. Handing
 * that string to new Date() would read it as US M/D (and fail outright for days
 * > 12), so the day-first pattern is parsed explicitly.
 */
function parseRequirementDate_(value) {
  if (value === null || value === undefined) return null;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const asDate = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0));
    return isNaN(asDate.getTime()) ? null : asDate;
  }
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getRequirementsHistory() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");

    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return [];

    // Tag each row with its physical sheet row number (1-based; row 1 is the
    // header) BEFORE filtering, so the edit modal can pair each item back to
    // the exact row on save. The history is returned newest-first below, so
    // the server must NOT pair items to rows by array index (it used to,
    // which wrote each item's Geo/P/N/Desc onto the wrong row).
    const cleanData = data
      .slice(1)
      .map((row, idx) => ({ row: row, rowNum: idx + 2 }))
      .filter((entry) => entry.row[0] !== "" && entry.row[0] !== null)
      .filter((entry) => {
        // Exclude drafts from history view
        const estado = String(entry.row[7] || "").trim();
        return estado !== "Draft" && !String(entry.row[0] || "").trim().startsWith("DRAFT-");
      });

    // Header-aware lookup of the optional "SubArea" / "Emails" / "SubArea No"
    // and "Notes" columns, plus the requirement AUDIT columns
    // ("lastModifiedBy" / "lastModifiedDate" / "modCount") written by CreateReqGS
    // at creation and by every requirement edit since. The audit headers are
    // matched case-insensitively AND with the spaced spelling ("Last Modified By"),
    // because the sheet has existed in both forms; a -1 index simply means the
    // column is missing (legacy sheet / never edited) and the consumer shows "-".
    const headers = data[0];
    let subAreaIdx = -1;
    let emailsIdx = -1;
    let subAreaNoIdx = -1;
    let notesIdx = -1;
    let itemNotesIdx = -1;
    let supplierNotesIdx = -1;
    let itemImagesIdx = -1;
    let lastModByIdx = -1;
    let lastModDateIdx = -1;
    let modCountIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const headerName = String(headers[i] || "").trim();
      const headerKey = headerName.toLowerCase();
      if (headerName === "SubArea") subAreaIdx = i;
      if (headerName === "Emails") emailsIdx = i;
      if (headerName === "SubArea No") subAreaNoIdx = i;
      if (headerName === "Notes") notesIdx = i;
      if (headerKey === "item notes") itemNotesIdx = i;
      if (headerKey === "supplier notes") supplierNotesIdx = i;
      if (headerKey === "item images") itemImagesIdx = i;
      if (headerKey === "lastmodifiedby" || headerKey === "last modified by") lastModByIdx = i;
      if (headerKey === "lastmodifieddate" || headerKey === "last modified date") lastModDateIdx = i;
      if (headerKey === "modcount" || headerKey === "mod count") modCountIdx = i;
    }

    // Requirement audit date cells arrive either as a real Date (CreateReqGS
    // stamps new Date()) or as the "yyyy-MM-dd HH:mm:ss" text ViewEditReqGS
    // writes. Both are normalized to { text, iso }: `text` is the display value
    // (dd-MM-yyyy HH:mm in the script timezone, or the original string when it
    // cannot be parsed) and `iso` is a sortable timestamp for the client.
    const auditDate_ = function (v) {
      if (Object.prototype.toString.call(v) === "[object Date]") {
        if (isNaN(v.getTime())) return { text: "", iso: "" };
        return {
          text: Utilities.formatDate(v, Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm"),
          iso: v.toISOString(),
        };
      }
      const raw = String(v == null ? "" : v).trim();
      if (!raw) return { text: "", iso: "" };
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) return { text: raw, iso: "" };
      return {
        text: Utilities.formatDate(parsed, Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm"),
        iso: parsed.toISOString(),
      };
    };

    return cleanData
      .map((entry) => {
        const row = entry.row;
        // Machine-readable requirement date next to the locale string: consumers
        // that must sort or format the Req date (e.g. the Quote Mgmt requirement
        // header) cannot rely on toLocaleString(), which is locale dependent.
        const reqDate = parseRequirementDate_(row[1]);
        const reqDateValid = !!reqDate;
        // Single parse of the requirement audit date (text + iso computed once).
        const reqLastMod = lastModDateIdx >= 0
          ? auditDate_(row[lastModDateIdx])
          : { text: "", iso: "" };
        return {
          rowNum: entry.rowNum,
          order: row[0] || "N/A",
          fecha: row[1] ? row[1].toLocaleString() : "",
          fechaIso: reqDateValid ? reqDate.toISOString() : "",
          pn: row[2] || "",
          geo: row[3] || "",
          faena: row[4] || "",
          desc: row[5] || "",
          cant: row[6] || 0,
          estado: row[7] || "Pending",
          user: row[8],
          category: row[12] || "General",
          pdfUrl: row[13] || "",
          subArea: subAreaIdx >= 0 ? (row[subAreaIdx] || "") : "",
          emails: emailsIdx >= 0 ? (row[emailsIdx] || "") : "",
          subAreaNo: subAreaNoIdx >= 0 ? (row[subAreaNoIdx] || "") : "",
          notes: notesIdx >= 0 ? (row[notesIdx] || "") : "",
          // Per-item notes (unique to this requirement row: Order + Geo)
          itemNotes: itemNotesIdx >= 0 ? (row[itemNotesIdx] || "") : "",
          // Supplier-facing notes ("Supplier Notes" column): printed in the
          // supplier RFQ (quote request) email only.
          supplierNotes: supplierNotesIdx >= 0 ? (row[supplierNotesIdx] || "") : "",
          // Per-item photos ("Item Images" column): comma-separated Drive URLs
          // uploaded from the Create Req cart. Returned as the raw cell string;
          // consumers normalize with reqItemImageUrls_ / normalizeCartImages.
          images: itemImagesIdx >= 0 ? (row[itemImagesIdx] || "") : "",
          // Requirement AUDIT trail (last requirement edit). Joined onto the
          // Quote Mgmt requirement header's info ("i") timeline: an untouched
          // requirement reports its creation values (CreateReqGS stamps
          // lastModifiedDate at creation; lastModifiedBy stays blank until the
          // first edit) and a legacy sheet without these columns reports "-".
          reqLastModifiedBy: lastModByIdx >= 0 ? String(row[lastModByIdx] || "").trim() : "",
          reqLastModified: reqLastMod.text,
          reqLastModifiedIso: reqLastMod.iso,
          reqModCount: modCountIdx >= 0 ? (Number(row[modCountIdx]) || 0) : 0,
        };
      })
      .reverse();
  } catch (e) {
    console.error("Critical Server Error: " + e.message);
    return [];
  }
}

function generateExportFile(data, type) {
  try {
    const headers = [
      "Order #",
      "Date",
      "Faena",
      "Geo Code",
      "P/N",
      "Description",
      "Qty",
      "Status",
    ];
    let content = headers.join(",") + "\n";
    if (!data || !data.length) {
      const fileNameEmpty = `RECON_${String(type || 'EXPORT').toUpperCase()}_${new Date().getTime()}.csv`;
      const emptyFile = DriveApp.createFile(fileNameEmpty, content, MimeType.CSV);
      emptyFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return emptyFile.getDownloadUrl().replace("?e=download", "");
    }

    data.forEach((r) => {
      const rowOrder = r.order || r.orderId || "";
      const rowDate = r.fecha || r.timestamp || "";
      const rowSite = r.faena || r.site || "";
      const rowGeo = r.geo || "";
      const rowPn = r.pn || "";
      const rowDesc = String(r.desc || r.description || "").replace(/"/g, '""');
      const rowQty = Number(r.cant || r.qty || 0) || 0;
      const rowStatus = r.estado || r.status || "";

      content += `${rowOrder},${rowDate},${rowSite},${rowGeo},${rowPn},"${rowDesc}",${rowQty},"${rowStatus}"\n`;
    });

    const fileName = `RECON_${String(type || 'EXPORT').toUpperCase()}_${new Date().getTime()}.csv`;
    const file = DriveApp.createFile(fileName, content, MimeType.CSV);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return file.getDownloadUrl().replace("?e=download", "");
  } catch (e) {
    throw new Error("Export failed: " + e.message);
  }
}

function master_ExportToDrive(data, headers, keys, moduleName, format) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const parentFolder = DriveApp.getFileById(ss.getId()).getParents().next();

    const exportsFolder = shared_getOrCreateFolder(parentFolder, "Exports");
    const targetFolder = shared_getOrCreateFolder(exportsFolder, moduleName);

    const dateStr = Utilities.formatDate(
      new Date(),
      "GMT-4",
      "yyyy-MM-dd_HH-mm",
    );
    const baseName = `${moduleName}_${dateStr}`;
    let blob;

    if (format === "CSV") {
      let csvContent = "\uFEFF" + headers.join(",") + "\n";
      data.forEach((row) => {
        const line = keys.map(
          (key) => `"${String(row[key] || "").replace(/"/g, '""')}"`,
        );
        csvContent += line.join(",") + "\n";
      });
      blob = Utilities.newBlob(csvContent, MimeType.CSV, baseName + ".csv");
    } else if (format === "EXCEL") {
      blob = internal_generateExcelBlob(data, headers, keys, baseName);
    } else if (format === "PDF") {
      blob = internal_generatePdfBlob(
        data,
        headers,
        keys,
        moduleName,
        baseName,
      );
    }

    const file = targetFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { fileName: file.getName(), url: file.getUrl() };
  } catch (e) {
    throw new Error(e.toString());
  }
}

function internal_generatePdfBlob(data, headers, keys, moduleName, baseName) {
  const logoId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
  let logoBase64 = "";
  try {
    const logoBlob = DriveApp.getFileById(logoId).getBlob();
    logoBase64 =
      "data:" +
      logoBlob.getContentType() +
      ";base64," +
      Utilities.base64Encode(logoBlob.getBytes());
  } catch (e) {
    console.warn("Logo fetch failed");
  }

  let dateRangeText = "All Dates";
  if (data.length > 0) {
    const dates = data
      .map((item) => new Date(item.fecha))
      .filter((d) => !isNaN(d));
    if (dates.length > 0) {
      const minDate = new Date(Math.min.apply(null, dates));
      const maxDate = new Date(Math.max.apply(null, dates));
      const fmt = (d) => Utilities.formatDate(d, "GMT-4", "dd/MM/yyyy");
      dateRangeText =
        fmt(minDate) === fmt(maxDate)
          ? fmt(minDate)
          : fmt(minDate) + " - " + fmt(maxDate);
    }
  }

  const timestamp = Utilities.formatDate(
    new Date(),
    "GMT-4",
    "dd/MM/yyyy HH:mm",
  );

  const STATUS_COLORS = {
    'Created': '#f8f9fa',
    'Pending': '#fff3cd',
    'RFQ Issued': '#dbeafe',
    'Quoted': '#d1e7dd',
    'Approved': '#cfe2ff',
    'PO Created': '#fff4e6',
    'Final Received': '#e6ffed'
  };

  function normalizeStage(s) {
    if (!s) return 'Created';
    const x = String(s || '').toLowerCase();
    if (x.includes('final') || x.includes('received') || x.includes('recib')) return 'Final Received';
    if (x.includes('po') || x.includes('orden') || x.includes('ordered') || x.includes('comprad')) return 'PO Created';
    if (x.includes('approv') || x.includes('aprob')) return 'Approved';
    if (x.includes('quot') || x.includes('cotiz')) return 'Quoted';
    if (x.includes('rfq') || x.includes('sent')) return 'RFQ Issued';
    if (x.includes('pend')) return 'Pending';
    return 'Created';
  }

  function findStageKey(keys) {
    const candidates = ['ItemStage', 'itemStage', 'QuoteStage', 'quoteStage', 'ReqStage', 'reqStage', 'stage', 'Stage', 'estado', 'status'];
    for (const c of candidates) {
      const idx = keys.findIndex(k => k === c || (k && k.toLowerCase && k.toLowerCase() === c.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const stageKeyIndex = findStageKey(keys);

  let html = `
    <html>
    <head>
      <style>
        body { font-family: sans-serif; color: #333; margin: 20px; }
        .header { display: flex; border-bottom: 2px solid #444; padding-bottom: 10px; margin-bottom: 10px; }
        .logo { height: 50px; }
        .info { flex-grow: 1; text-align: right; }
        .date-range-bar { background: #f8f9fa; padding: 5px 10px; border: 1px solid #dee2e6; font-size: 10pt; margin-bottom: 15px; font-weight: bold; }
        h2 { margin: 0; color: #1a73e8; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; }
        th { background-color: #1a73e8; color: white; border: 1px solid #bdc1c6; padding: 8px; font-size: 10pt; text-align: left; }
        td { border: 1px solid #bdc1c6; padding: 6px; font-size: 9pt; vertical-align: top; }
        .footer { margin-top: 30px; font-size: 8pt; color: #70757a; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        ${logoBase64 ? `<img src="${logoBase64}" class="logo">` : "<div></div>"}
        <div class="info">
          <h2>${moduleName} Report</h2>
          <p style="margin:0;">Generated: ${timestamp}</p>
        </div>
      </div>
      
      <div class="date-range-bar">
        Period: ${dateRangeText}
      </div>

      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>`;

  data.forEach((row) => {
    let rowStyle = '';
    if (stageKeyIndex !== -1) {
      const raw = row[keys[stageKeyIndex]] || "";
      const norm = normalizeStage(raw || '');
      const col = STATUS_COLORS[norm] || STATUS_COLORS['Created'];
      rowStyle = ` style="background-color:${col}; color:#000;"`;
    }

    html += '<tr>' + keys.map((key) => {
      const raw = row[key] || "";
      return `<td${rowStyle}>${raw}</td>`;
    }).join('') + '</tr>';
  });

  html += `</tbody></table>
      <div class="footer">ERP System Internal Document - Confidential</div>
    </body></html>`;

  return HtmlService.createHtmlOutput(html)
    .getAs("application/pdf")
    .setName(baseName + ".pdf");
}

/**
 * GENERATE HSE RECEIPT PDF WITH FINGERPRINT SIGNATURE
 * Includes: MovementID, date, worker name, HSE items only, embedded fingerprint image, match badge
 */
function generateHSEReceiptPDF(movementData) {
  try {
    const logoFileId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
    let logoBase64 = "";

    try {
      const blob = DriveApp.getFileById(logoFileId).getBlob();
      logoBase64 = "data:" + blob.getContentType() + ";base64," +
        Utilities.base64Encode(blob.getBytes()).replace(/(\r\n|\n|\r)/gm, "");
    } catch (e) {
      console.warn("Logo load failed, continuing without: " + e.toString());
    }

    const ts = movementData.timestamp;
    const dateStr = ts instanceof Date ? Utilities.formatDate(ts, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(ts);
    const fingerprintBase64 = movementData.fingerprintBase64 || "";
    const matchScore = movementData.matchScore || 0;

    console.log(matchScore, " Match Score");

    // Test the fingerprint content
    console.log("Fingerprint Type: " + typeof movementData.fingerprintBase64);
    console.log("Fingerprint Length: " + (movementData.fingerprintBase64 ? movementData.fingerprintBase64.length : "NULL"));

    // Check for the prefix
    if (movementData.fingerprintBase64) {
      console.log("Starts with data prefix: " + movementData.fingerprintBase64.substring(0, 30));
    }

    let itemsTableHtml = "";
    if (movementData.hseItems && movementData.hseItems.length > 0) {
      movementData.hseItems.forEach((item, index) => {
        itemsTableHtml += `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 5px; text-align: center;">${index + 1}</td>
            <td style="padding: 5px;">${item.geo || ""}</td>
            <td style="padding: 5px;">${item.en || item.es || ""}</td>
            <td style="padding: 5px; text-align: center;">${item.qty || 0}</td>
          </tr>
        `;
      });
    }

    const matchBadgeColor = matchScore >= 60 ? "#27ae60" : "#c0392b";
    const matchText = matchScore >= 60 ? "VERIFIED" : "FAILED";

    let fingerprintHtml = "";
    if (fingerprintBase64) {
      fingerprintHtml = `
        <div style="text-align: center; border: 1px solid #ccc; padding: 10px;">
          <p>BIOMETRIC SIGNATURE</p>
          <img src="${movementData.fingerprintBase64}" style="width: 50px;">
          <p><strong>Worker:</strong> ${movementData.workerName}</p>
          <p><strong>RUT:</strong> ${movementData.workerRut}</p>
          <p>Match Score: ${movementData.matchScore}/1000</p>
        </div>
      `;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          
          body { font-family: Arial, sans-serif; margin: 10px; color: #333; }
          .header { text-align: center; margin-bottom: 10px; border-bottom: 3px solid #0066cc; padding-bottom: 15px; }
          .logo { max-width: 80px; margin-bottom: 10px; }
          .title { font-size: 24px; font-weight: bold; color: #0066cc; margin: 10px 0; }
          .receipt-info { display: flex; justify-content: space-between; margin: 15px 0; font-size: 13px; }
          .receipt-item { flex: 1; }
          .receipt-item strong { color: #0066cc; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10px; }
          th { background-color: #0066cc; color: white; padding: 6px; text-align: left; }
          td { padding: 4px; }
          tr:nth-child(even) { background-color: #f5f5f5; }
          .footer { position: fixed; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; text-align: center; font-size: 11px; color: #666; }
          .hse-badge { display: inline-block; background-color: #e74c3c; color: white; padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          ${logoBase64 ? '<img src="' + logoBase64 + '" class="logo" alt="Logo">' : ''}
          <div class="title">ENTREGA DE EPP</div>
        </div>
        
        <div class="receipt-info">
          <div class="receipt-item">
            <strong>ID Movimiento:</strong><br>${movementData.movementId || ""}
          </div>
          <div class="receipt-item">
            <strong>Fecha/Hora:</strong><br>${dateStr}
          </div>
          <div class="receipt-item">
            <strong>Empleado:</strong><br>${movementData.workerName || ""}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 5%;">No.</th>
              <th style="width: 25%;">Codigo Producto</th>
              <th style="width: 45%;">Descripcion</th>
              <th style="width: 25%; text-align: center;">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            ${itemsTableHtml}
          </tbody>
          <tfoot>
            <tr><td>
              
            </td></tr>
          </tfoot>
        </table>

          <div class="footer">
                ${fingerprintHtml}
                <p>Por medio de mi huella digital, confirmo la recepcion de elementos de seguridad.</p>
                <p>CONFORME LA LEY VIGENTE</p>
                <p>Artículo 184 del Código del Trabajo, la Ley N°16.744 (Art. 68) y el Decreto Supremo N°594 (Art. 53 y 54).</p>

              </div>
        
      </body>
      </html>
    `;

    const blob = Utilities.newBlob(html, "text/html", "HSE_Receipt_" + movementData.movementId + ".html");
    return blob.getAs("application/pdf");
  } catch (e) {
    console.error("HSE PDF Generation Error: " + e.toString());
    throw e;
  }
}

/*
<div class="footer">
          ${fingerprintHtml}
          <p>Este documento sirve como prueba legal de la emisión de equipos HSE.</p>
          <p>Generado por RECON ERP System - ${dateStr}</p>
        </div>

*/

/**
 * SAVE HSE PDF TO DRIVE
 * Creates folder structure: HSE/[WorkerID]_[WorkerName]/ and stores PDF
 */
function saveHSEPDFToDrive(movementId, workerID, workerName, pdfBlob) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const file = DriveApp.getFileById(ss.getId());

    const parents = file.getParents();
    if (!parents.hasNext()) {
      throw new Error("Spreadsheet is not inside a folder.");
    }
    const parentFolder = parents.next();

    console.log("HSE pdf generation started");
    // Build path: HSE/[WorkerID]_[WorkerName]
    const hseFolder = shared_getOrCreateFolder(parentFolder, "HSE");
    const workerFolderName = workerID + "_" + workerName;
    const workerFolder = shared_getOrCreateFolder(hseFolder, workerFolderName);

    // Create file
    const fileName = "HSE_Receipt_" + movementId + ".pdf";
    const pdfFile = workerFolder.createFile(pdfBlob);
    pdfFile.setName(fileName);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const driveLink = pdfFile.getUrl();
    return driveLink;
  } catch (e) {
    console.error("HSE PDF Drive Storage Error: " + e.toString());
    throw e;
  }
}

/**
 * GET HSE ITEMS FROM CART
 * Filters cart items to return only HSE sub-category items
 */
function getHSEItemsFromCart(cartItems) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName("Master");
    const masterData = masterSheet.getDataRange().getValues();

    // Col C = Category, Col D = Sub Categoria
    const hseItems = [];

    cartItems.forEach(cartItem => {
      const cartGeo = String(cartItem.geo || "").trim().toUpperCase();

      // Find item in Master sheet
      for (let i = 1; i < masterData.length; i++) {
        const masterGeo = String(masterData[i][0] || "").trim().toUpperCase();
        if (masterGeo === cartGeo) {
          const category = String(masterData[i][2] || "").trim();
          const subCategory = String(masterData[i][3] || "").trim();

          if (category === "Operations" && subCategory === "HSE") {
            hseItems.push({
              geo: cartItem.geo,
              en: masterData[i][5] || "",
              es: masterData[i][6] || "",
              qty: cartItem.qty,
              category: category,
              sub_categoria: subCategory
            });
          }
          break;
        }
      }
    });

    return hseItems;
  } catch (e) {
    console.error("Get HSE Items Error: " + e.toString());
    return [];
  }
}

function shared_getOrCreateFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function internal_generateExcelBlob(data, headers, keys, baseName) {
  // Create temporary spreadsheet and populate with data
  const ss = SpreadsheetApp.create(baseName + '_tmp');
  const sheet = ss.getActiveSheet();
  try {
    sheet.setName('Report');
  } catch (e) { }

  // Write headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Prepare rows in the same key order
  const rows = data.map(function (row) {
    return keys.map(function (k) { return row[k] || ''; });
  });

  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // Determine stage column index
  const stageCandidates = ['ItemStage', 'itemStage', 'QuoteStage', 'quoteStage', 'ReqStage', 'reqStage', 'stage', 'Stage', 'estado', 'status'];
  let stageIndex = -1;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] || '';
    if (stageCandidates.indexOf(k) !== -1 || stageCandidates.indexOf((k || '').toString().toLowerCase()) !== -1) { stageIndex = i; break; }
  }

  const STATUS_COLORS = {
    'Created': '#f8f9fa',
    'Pending': '#fff3cd',
    'RFQ Issued': '#dbeafe',
    'Quoted': '#d1e7dd',
    'Approved': '#cfe2ff',
    'PO Created': '#fff4e6',
    'Final Received': '#e6ffed'
  };

  function normalizeStage(s) {
    if (!s) return 'Created';
    const x = String(s || '').toLowerCase();
    if (x.includes('final') || x.includes('received') || x.includes('recib')) return 'Final Received';
    if (x.includes('po') || x.includes('orden') || x.includes('ordered') || x.includes('comprad')) return 'PO Created';
    if (x.includes('approv') || x.includes('aprob')) return 'Approved';
    if (x.includes('quot') || x.includes('cotiz')) return 'Quoted';
    if (x.includes('rfq') || x.includes('sent')) return 'RFQ Issued';
    if (x.includes('pend')) return 'Pending';
    return 'Created';
  }

  // Apply background colors per row based on stage column
  if (stageIndex !== -1 && rows.length) {
    for (let r = 0; r < rows.length; r++) {
      const raw = rows[r][stageIndex] || '';
      const norm = normalizeStage(raw);
      const col = STATUS_COLORS[norm] || STATUS_COLORS['Created'];
      try {
        sheet.getRange(r + 2, 1, 1, headers.length).setBackground(col);
      } catch (e) {/* ignore */ }
    }
  }

  // Format
  sheet.setFrozenRows(1);
  for (let c = 1; c <= headers.length; c++) {
    try { sheet.autoResizeColumn(c); } catch (e) { }
  }

  SpreadsheetApp.flush(); // Force changes to be written before conversion
  const file = DriveApp.getFileById(ss.getId());

  let blob;
  try {
    const exportUrl =
      'https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(ss.getId()) +
      '/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const response = UrlFetchApp.fetch(exportUrl, {
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() === 200) {
      blob = response.getBlob().setName(baseName + '.xlsx');
    } else {
      throw new Error(
        'Drive export failed: ' + response.getResponseCode() + ' - ' + response.getContentText(),
      );
    }
  } catch (exportErr) {
    try {
      blob = file.getAs(MimeType.MICROSOFT_EXCEL).setName(baseName + '.xlsx');
    } catch (fallbackErr) {
      throw new Error(
        'Excel export failed: ' + exportErr.toString() + ' / fallback: ' + fallbackErr.toString(),
      );
    }
  }

  // Trash the temporary spreadsheet
  try { file.setTrashed(true); } catch (e) { }

  return blob;
}

/**
 * updateRequirementOnSheet - Main function to update requirement and send email
 * Detects if email recipients are missing and returns requiresConfirmation flag
 */
function updateRequirementOnSheet(orderId, header, items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  const headers = data[0];
  const columnMap = {};
  // Trim header keys so lookups ("P/N", "Geo Code", ...) match readers that trim
  headers.forEach((h, i) => { columnMap[String(h).trim()] = i; });

  // Find ALL rows with this Order ID (not just first)
  const matchingRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][columnMap["Order"]] == orderId) {
      matchingRows.push({ rowNum: i + 1, dataIndex: i });
    }
  }

  if (matchingRows.length === 0) {
    throw new Error("Requirement #" + orderId + " not found");
  }

  console.log("DEBUG: Found", matchingRows.length, "rows for Order ID:", orderId);

  // Get current user info from webapp login (not Gmail Session)
  const currentUserName = header?.userName || Session.getActiveUser().getEmail().split("@")[0];
  const editorEmail = getUserEmailFromCache(currentUserName) || "";
  console.log("DEBUG updateRequirementOnSheet: currentUserName =", currentUserName);
  console.log("DEBUG updateRequirementOnSheet: editorEmail =", editorEmail);
  const firstRowDataIndex = matchingRows[0].dataIndex;
  const originalCreator = data[firstRowDataIndex][columnMap["User"]];
  const originalCategory = data[firstRowDataIndex][columnMap["Category"]];
  const originalSubArea = String(data[firstRowDataIndex][columnMap["SubArea"]] || "").trim();
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // Update modification tracking (get from first row)
  const currentModCount = data[firstRowDataIndex][columnMap["modCount"]] || 0;
  const newModCount = currentModCount + 1;

  // Create PDF with updated requirement BEFORE sheet update
  let pdfUrl = "";
  try {
    const shipmentData = {
      orderId: orderId,
      category: originalCategory,
      site: header.faena,
      items: items || [],
      createdBy: originalCreator,
      modifiedBy: currentUserName,
      userName: originalCreator,
      modCount: newModCount
    };
    pdfUrl = orchestrateRequirementPDF(orderId, shipmentData);
    console.log("DEBUG updateRequirementOnSheet: PDF created successfully:", pdfUrl);
  } catch (pdfErr) {
    console.error("DEBUG updateRequirementOnSheet: PDF creation failed:", pdfErr.toString());
    // Continue without PDF - don't fail the edit operation
  }

  const updates = {
    [columnMap["lastModifiedBy"]]: currentUserName,
    [columnMap["lastModifiedDate"]]: timestamp,
    [columnMap["modCount"]]: newModCount
  };

  // Persist the edited "Emails" distribution list from the edit modal when
  // provided (mirrors Quotes: the confirmed list lives on the row for future
  // re-sends). A cleared/empty input leaves the stored list untouched.
  const editedEmails = (header && typeof header.emails === "string" && String(header.emails).trim() !== "")
    ? mergeEmailRecipients_([header.emails])
    : "";
  if (editedEmails && columnMap["Emails"] !== undefined) {
    updates[columnMap["Emails"]] = editedEmails;
  }

  // Add PDF URL to updates if PDF column exists and URL was created
  if (pdfUrl && columnMap["Req PDF Link"] !== undefined) {
    updates[columnMap["Req PDF Link"]] = pdfUrl;
  }

  console.log("DEBUG: columnMap keys:", Object.keys(columnMap));
  console.log("DEBUG: updates to apply:", updates);
  console.log("DEBUG: items array:", JSON.stringify(items));

  // Pair each client item to the physical sheet row it came from via rowNum
  // (carried by the edit modal). The history/modal list is newest-first, so
  // index pairing wrote every item's Geo/P/N/Desc onto the WRONG row — and
  // the truthy P/N guard then left a stale/foreign P/N on P/N-less rows.
  // Falls back to legacy index pairing for callers that send no rowNum.
  const itemsByRowNum = {};
  let itemsHaveRowNum = false;
  (items || []).forEach(function (it) {
    if (it && it.rowNum !== undefined && it.rowNum !== null && String(it.rowNum) !== "") {
      itemsByRowNum[Number(it.rowNum)] = it;
      itemsHaveRowNum = true;
    }
  });

  // Apply updates to ALL matching rows
  const updateRequests = [];
  matchingRows.forEach((row, idx) => {
    const rowData = data[row.dataIndex];

    // Apply modification tracking updates to all rows
    Object.keys(updates).forEach(colIndex => {
      if (updates[colIndex] !== undefined) {
        rowData[colIndex] = updates[colIndex];
      }
    });

    // Update item-specific columns for this row if a matching item exists
    const item = itemsHaveRowNum ? itemsByRowNum[row.rowNum] : (items && items[idx]);
    if (item) {
      console.log(`DEBUG: Updating row ${row.rowNum} with item:`, JSON.stringify(item));

      // Update standard item columns
      if (columnMap["Cantidad"] !== undefined && item.cant) {
        rowData[columnMap["Cantidad"]] = item.cant;
        console.log(`DEBUG:   Set Cantidad to ${item.cant}`);
      }
      if (columnMap["Desc Es"] !== undefined && item.es) {
        rowData[columnMap["Desc Es"]] = item.es;
        console.log(`DEBUG:   Set Desc Es to ${item.es}`);
      }
      // Written even when empty so a corrupted/foreign P/N can be cleared
      if (columnMap["P/N"] !== undefined && item.pn !== undefined && item.pn !== null) {
        rowData[columnMap["P/N"]] = item.pn;
        console.log(`DEBUG:   Set P/N to ${item.pn}`);
      }
      if (columnMap["Geo Code"] !== undefined && item.geo) {
        rowData[columnMap["Geo Code"]] = item.geo;
        console.log(`DEBUG:   Set Geo Code to ${item.geo}`);
      }
    }

    updateRequests.push({ range: sheet.getRange(row.rowNum, 1, 1, rowData.length), values: [rowData] });
    console.log(`DEBUG: Updated row ${row.rowNum} (data index ${row.dataIndex})`);
  });

  console.log(`DEBUG: Applied updates to ${matchingRows.length} rows`);

  try {
    updateRequests.forEach(req => {
      req.range.setValues(req.values);
    });
    console.log("DEBUG: Sheet update successful for all rows");
  } catch (sheetErr) {
    console.error("DEBUG: Sheet update failed:", sheetErr.toString());
    throw sheetErr;
  }


  // Email handling
  let emailStatus = {};

  try {
    // Get site name from header
    const siteName = header.faena || "";

    // Recipients (mirrors Quotes): the newest edited "Emails" (edit modal)
    // wins, then the list persisted at creation (including manually added
    // emails), then fresh routing (SubArea-aware) when nothing is stored.
    const storedEmails = String(
      (columnMap["Emails"] !== undefined ? data[firstRowDataIndex][columnMap["Emails"]] : "") || ""
    ).trim();
    let recipients = editedEmails || storedEmails;
    if (!recipients) {
      const routing = getRequirementRouting(siteName, originalCategory, originalSubArea);
      recipients = routing.emails;
    }

    // CHECK: If recipients is fallback email, return requiresConfirmation flag
    if (recipients === "procurement@yourcompany.com") {
      return {
        success: true,
        orderId: orderId,
        category: originalCategory,
        requiresConfirmation: true,
        recipientWarning: true,
        message: `No recipients configured for category "${originalCategory}". Please specify an email.`
      };
    }

    // Build email - get first row data for dates
    const firstRowData = data[firstRowDataIndex];
    const emailHtmlBody = buildEmailWithMetadata({
      orderId: orderId,
      items: items || [],
      createdBy: originalCreator,
      createdDate: firstRowData[columnMap["Fecha/Hora"]],
      modifiedBy: currentUserName,
      modifiedDate: timestamp,
      modCount: newModCount,
      category: originalCategory,
      site: header.faena
    }, editorEmail);

    // Determine subject based on editor
    let subjectLine = `Requirement: ${orderId} - UPDATED (Self)`;
    if (originalCreator !== currentUserName) {
      subjectLine = `Requirement: ${orderId} - MODIFIED by ${currentUserName}`;
    }

    // Parse recipient emails
    const recipientEmails = recipients
      ? recipients.split(",").map(e => e.trim()).filter(e => e)
      : [];

    // CC original creator if different from current user
    let ccEmail = "";
    if (originalCreator !== currentUserName) {
      const creatorEmail = getUserEmailFromCache(originalCreator);
      if (creatorEmail && creatorEmail.includes("@")) {
        ccEmail = creatorEmail;
        console.log("DEBUG updateRequirementOnSheet: Found CC email:", ccEmail);
      } else {
        console.log("DEBUG updateRequirementOnSheet: Could not find email for:", originalCreator);
      }
    }

    console.log("DEBUG updateRequirementOnSheet - Recipients:", recipients);
    console.log("DEBUG updateRequirementOnSheet - Parsed emails:", recipientEmails);
    console.log("DEBUG updateRequirementOnSheet - CC email:", ccEmail);

    // If no recipients and no CC, log warning
    if (recipientEmails.length === 0 && !ccEmail) {
      console.warn("WARNING: No recipients and no CC - email will not be sent");
      emailStatus = {
        emailSent: false,
        emailService: "",
        emailError: "No recipients configured"
      };
    } else {
      // Send email via SmartDispatcher
      const dispatchMail = {
        type: "Requirement",
        refId: orderId,
        to: recipientEmails.join(","),
        cc: ccEmail,
        subject: subjectLine,
        body: emailHtmlBody,
        replyTo: "noreply@recon.cl",
        senderEmail: editorEmail || Session.getActiveUser().getEmail()
      };

      const dispatchResult = SmartDispatcher(dispatchMail);

      if (dispatchResult && dispatchResult.requiresFallbackChoice) {
        emailStatus = {
          emailSent: false,
          emailService: "",
          requiresFallbackChoice: true,
          graphError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
          dispatchDraft: dispatchMail,
          emailError: dispatchResult.graphError || dispatchResult.message || "Graph send failed"
        };
      } else {
        emailStatus = {
          emailSent: dispatchResult.success,
          emailService: dispatchResult.service || "",
          emailCc: ccEmail
        };
      }
    }
  } catch (emailErr) {
    console.warn("Email send failed:", emailErr.toString());
    emailStatus = {
      emailSent: false,
      emailService: "",
      emailError: emailErr.toString()
    };
  }

  return {
    success: true,
    orderId: orderId,
    category: originalCategory,
    ...emailStatus
  };
}

/**
 * updateRequirementOnSheetWithRecipient - Same as updateRequirementOnSheet but with custom recipient email
 * Used when user confirms email recipient in modal
 */
function updateRequirementOnSheetWithRecipient(orderId, header, items, customRecipientEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  const headers = data[0];
  const columnMap = {};
  // Trim header keys so lookups ("P/N", "Geo Code", ...) match readers that trim
  headers.forEach((h, i) => { columnMap[String(h).trim()] = i; });

  // Find ALL rows with this Order ID (not just first)
  const matchingRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][columnMap["Order"]] == orderId) {
      matchingRows.push({ rowNum: i + 1, dataIndex: i });
    }
  }

  if (matchingRows.length === 0) {
    throw new Error("Requirement #" + orderId + " not found");
  }

  console.log("DEBUG updateRequirementOnSheetWithRecipient: Found", matchingRows.length, "rows for Order ID:", orderId);

  // Get current user info from webapp login (not Gmail Session)
  const currentUserName = header?.userName || Session.getActiveUser().getEmail().split("@")[0];
  const editorEmail = getUserEmailFromCache(currentUserName) || "";
  console.log("DEBUG updateRequirementOnSheetWithRecipient: currentUserName =", currentUserName);
  console.log("DEBUG updateRequirementOnSheetWithRecipient: editorEmail =", editorEmail);
  const firstRowDataIndex = matchingRows[0].dataIndex;
  const originalCreator = data[firstRowDataIndex][columnMap["User"]];
  const originalCategory = data[firstRowDataIndex][columnMap["Category"]];
  const siteName = header.faena || "";
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // Update modification tracking (get from first row)
  const currentModCount = data[firstRowDataIndex][columnMap["modCount"]] || 0;
  const newModCount = currentModCount + 1;

  // Create PDF with updated requirement BEFORE sheet update
  let pdfUrl = "";
  // Enrich the items with the stored per-item notes + photos before anything is
  // built from them: the edit modal sends neither (and `undefined` must keep
  // whatever the sheet already holds), so without this merge the regenerated
  // PDF loses its notes/"Photo N" links and the update email loses its
  // Notes/Images columns. Both the PDF (below) and the email (further down)
  // consume the SAME list.
  let itemsForDocs = items || [];
  try {
    const storedNotes = getItemNotesByOrder_(orderId);
    const storedImages = getItemImagesByOrder_(orderId);
    itemsForDocs = (items || []).map(function (it) {
      const geo = String((it && it.geo) || "").trim();
      const notes = (it && it.itemNotes !== undefined && it.itemNotes !== null)
        ? it.itemNotes
        : (storedNotes[geo] || "");
      const images = (it && it.images !== undefined && it.images !== null)
        ? it.images
        : (storedImages[geo] || "");
      return Object.assign({}, it, { itemNotes: notes, images: images });
    });
  } catch (mergeErr) {
    console.warn("updateRequirementOnSheetWithRecipient: doc item merge failed: " + mergeErr.toString());
  }
  try {
    const shipmentData = {
      orderId: orderId,
      category: originalCategory,
      site: siteName,
      items: itemsForDocs,
      createdBy: originalCreator,
      modifiedBy: currentUserName,
      modCount: newModCount
    };
    pdfUrl = orchestrateRequirementPDF(orderId, shipmentData);
    console.log("DEBUG updateRequirementOnSheetWithRecipient: PDF created successfully:", pdfUrl);
  } catch (pdfErr) {
    console.error("DEBUG updateRequirementOnSheetWithRecipient: PDF creation failed:", pdfErr.toString());
    // Continue without PDF - don't fail the edit operation
  }

  const updates = {
    [columnMap["lastModifiedBy"]]: currentUserName,
    [columnMap["lastModifiedDate"]]: timestamp,
    [columnMap["modCount"]]: newModCount
  };

  // Persist the edited "Emails" distribution list from the edit modal when
  // provided (mirrors Quotes: the confirmed list lives on the row for future
  // re-sends). A cleared/empty input leaves the stored list untouched.
  const editedEmails = (header && typeof header.emails === "string" && String(header.emails).trim() !== "")
    ? mergeEmailRecipients_([header.emails])
    : "";
  if (editedEmails && columnMap["Emails"] !== undefined) {
    updates[columnMap["Emails"]] = editedEmails;
  }

  // Add PDF URL to updates if PDF column exists and URL was created
  if (pdfUrl && columnMap["Req PDF Link"] !== undefined) {
    updates[columnMap["Req PDF Link"]] = pdfUrl;
  }

  console.log("DEBUG updateRequirementOnSheetWithRecipient: updates to apply:", updates);
  console.log("DEBUG updateRequirementOnSheetWithRecipient: items array:", JSON.stringify(items));

  // Pair each client item to the physical sheet row it came from via rowNum
  // (carried by the edit modal); index pairing is wrong because the
  // history/modal list is newest-first. Falls back to legacy index pairing
  // for callers that send no rowNum.
  const itemsByRowNum = {};
  let itemsHaveRowNum = false;
  (items || []).forEach(function (it) {
    if (it && it.rowNum !== undefined && it.rowNum !== null && String(it.rowNum) !== "") {
      itemsByRowNum[Number(it.rowNum)] = it;
      itemsHaveRowNum = true;
    }
  });

  // Apply updates to ALL matching rows
  const updateRequests = [];
  matchingRows.forEach((row, idx) => {
    const rowData = data[row.dataIndex];

    // Apply modification tracking updates to all rows
    Object.keys(updates).forEach(colIndex => {
      if (updates[colIndex] !== undefined) {
        rowData[colIndex] = updates[colIndex];
      }
    });

    // Update item-specific columns for this row if a matching item exists
    const item = itemsHaveRowNum ? itemsByRowNum[row.rowNum] : (items && items[idx]);
    if (item) {
      console.log(`DEBUG updateRequirementOnSheetWithRecipient: Updating row ${row.rowNum} with item:`, JSON.stringify(item));

      // Update standard item columns
      if (columnMap["Cantidad"] !== undefined && item.cant) {
        rowData[columnMap["Cantidad"]] = item.cant;
      }
      if (columnMap["Desc Es"] !== undefined && item.es) {
        rowData[columnMap["Desc Es"]] = item.es;
      }
      // Written even when empty so a corrupted/foreign P/N can be cleared
      if (columnMap["P/N"] !== undefined && item.pn !== undefined && item.pn !== null) {
        rowData[columnMap["P/N"]] = item.pn;
      }
      if (columnMap["Geo Code"] !== undefined && item.geo) {
        rowData[columnMap["Geo Code"]] = item.geo;
      }
    }

    updateRequests.push({ range: sheet.getRange(row.rowNum, 1, 1, rowData.length), values: [rowData] });
  });

  console.log(`DEBUG updateRequirementOnSheetWithRecipient: Applied updates to ${matchingRows.length} rows`);

  try {
    updateRequests.forEach(req => {
      req.range.setValues(req.values);
    });
    console.log("DEBUG updateRequirementOnSheetWithRecipient: Sheet update successful");
  } catch (sheetErr) {
    console.error("DEBUG updateRequirementOnSheetWithRecipient: Sheet update failed:", sheetErr.toString());
    throw sheetErr;
  }


  // Email handling with custom recipient
  let emailStatus = {};

  try {
    const rowData = data[firstRowDataIndex];
    const siteName = rowData[columnMap["Faena"]];

    // Build email with custom recipient
    const emailHtmlBody = buildEmailWithMetadata({
      orderId: orderId,
      // Enriched items (stored notes + photos merged in above) so the update
      // email's table matches the original requirement email.
      items: itemsForDocs,
      createdBy: originalCreator,
      createdDate: rowData[columnMap["Fecha/Hora"]],
      modifiedBy: currentUserName,
      modifiedDate: timestamp,
      modCount: newModCount,
      category: originalCategory,
      site: siteName
    }, editorEmail);

    // Determine subject based on editor
    let subjectLine = `Requirement: ${orderId} - UPDATED (Self)`;
    if (originalCreator !== currentUserName) {
      subjectLine = `Requirement: ${orderId} - MODIFIED by ${currentUserName}`;
    }

    console.log("DEBUG updateRequirementOnSheetWithRecipient: customRecipientEmail =", customRecipientEmail);

    // Use custom recipient email directly
    const recipientEmails = customRecipientEmail ? [customRecipientEmail] : [];
    console.log("DEBUG updateRequirementOnSheetWithRecipient: recipientEmails array:", JSON.stringify(recipientEmails));
    console.log("DEBUG updateRequirementOnSheetWithRecipient: recipientEmails length:", recipientEmails.length);
    console.log("DEBUG updateRequirementOnSheetWithRecipient: recipientEmails.join result:", recipientEmails.join(","));

    // CC original creator if different from current user
    let ccEmail = "";
    if (originalCreator !== currentUserName) {
      const creatorEmail = getUserEmailFromCache(originalCreator);
      if (creatorEmail && creatorEmail.includes("@")) {
        ccEmail = creatorEmail;
        console.log("DEBUG updateRequirementOnSheetWithRecipient: Found CC email:", ccEmail);
      } else {
        console.log("DEBUG updateRequirementOnSheetWithRecipient: Could not find email for:", originalCreator);
      }
    }
    console.log("DEBUG updateRequirementOnSheetWithRecipient: ccEmail =", ccEmail);

    console.log("DEBUG updateRequirementOnSheetWithRecipient: About to call SmartDispatcher");
    console.log("  to:", recipientEmails.join(","));
    console.log("  cc:", ccEmail);
    console.log("  subject:", subjectLine);

    // Send email via SmartDispatcher
    const dispatchMail = {
      type: "Requirement",
      refId: orderId,
      to: recipientEmails.join(","),
      cc: ccEmail,
      subject: subjectLine,
      body: emailHtmlBody,
      replyTo: "noreply@recon.cl",
      senderEmail: editorEmail || Session.getActiveUser().getEmail()
    };

    const dispatchResult = SmartDispatcher(dispatchMail);

    console.log("DEBUG updateRequirementOnSheetWithRecipient: SmartDispatcher returned:", JSON.stringify(dispatchResult));
    console.log("DEBUG updateRequirementOnSheetWithRecipient: dispatchResult.success:", dispatchResult.success);
    console.log("DEBUG updateRequirementOnSheetWithRecipient: dispatchResult.service:", dispatchResult.service);

    if (dispatchResult && dispatchResult.requiresFallbackChoice) {
      emailStatus = {
        emailSent: false,
        emailService: "",
        requiresFallbackChoice: true,
        graphError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
        dispatchDraft: dispatchMail,
        emailError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
        emailCc: ccEmail
      };
    } else {
      emailStatus = {
        emailSent: dispatchResult.success,
        emailService: dispatchResult.service || "",
        emailCc: ccEmail
      };
    }
    console.log("DEBUG updateRequirementOnSheetWithRecipient: Final emailStatus object:", JSON.stringify(emailStatus));
  } catch (emailErr) {
    console.error("DEBUG updateRequirementOnSheetWithRecipient: Email catch block:", emailErr.toString());
    console.warn("Email send failed:", emailErr.toString());
    emailStatus = {
      emailSent: false,
      emailService: "",
      emailError: emailErr.toString()
    };
  }

  return {
    success: true,
    orderId: orderId,
    category: originalCategory,
    site: header.faena,
    ...emailStatus
  };
}

/**
 * updateRequirementOnSheetWithItemStatuses - Updates requirement with item-level statuses
 * Handles per-item status (Pending, Approved, Deleted) instead of single header status
 * @param {string|number} orderId
 * @param {Object} header - Header info (faena, userName)
 * @param {Array} items - Array of items with geo, pn, cant, es, en, estado
 * @returns {Object}
 */
function updateRequirementOnSheetWithItemStatuses(orderId, header, items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const data = sheet.getDataRange().getValues();

  const headers = data[0];
  const columnMap = {};
  // Trim header keys so lookups ("P/N", "Geo Code", ...) match readers that trim
  headers.forEach((h, i) => { columnMap[String(h).trim()] = i; });

  // Find ALL rows with this Order ID (not just first)
  const matchingRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][columnMap["Order"]] == orderId) {
      matchingRows.push({ rowNum: i + 1, dataIndex: i });
    }
  }

  if (matchingRows.length === 0) {
    throw new Error("Requirement #" + orderId + " not found");
  }

  console.log("DEBUG updateRequirementOnSheetWithItemStatuses: Found", matchingRows.length, "rows for Order ID:", orderId);

  // Get current user info from webapp login (not Gmail Session)
  const currentUserName = header?.userName || Session.getActiveUser().getEmail().split("@")[0];
  const editorEmail = getUserEmailFromCache(currentUserName) || "";
  console.log("DEBUG updateRequirementOnSheetWithItemStatuses: currentUserName =", currentUserName);
  console.log("DEBUG updateRequirementOnSheetWithItemStatuses: editorEmail =", editorEmail);
  const firstRowDataIndex = matchingRows[0].dataIndex;
  const originalCreator = data[firstRowDataIndex][columnMap["User"]];
  const originalCategory = data[firstRowDataIndex][columnMap["Category"]];
  const originalSubArea = String(data[firstRowDataIndex][columnMap["SubArea"]] || "").trim();
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // Update modification tracking (get from first row)
  const currentModCount = data[firstRowDataIndex][columnMap["modCount"]] || 0;
  const newModCount = currentModCount + 1;

  // Create PDF with updated requirement BEFORE sheet update
  let pdfUrl = "";
  try {
    const shipmentData = {
      orderId: orderId,
      category: originalCategory,
      site: header.faena,
      items: items || [],
      createdBy: originalCreator,
      modifiedBy: currentUserName,
      userName: originalCreator,
      modCount: newModCount
    };
    pdfUrl = orchestrateRequirementPDF(orderId, shipmentData);
    console.log("DEBUG updateRequirementOnSheetWithItemStatuses: PDF created successfully:", pdfUrl);
  } catch (pdfErr) {
    console.error("DEBUG updateRequirementOnSheetWithItemStatuses: PDF creation failed:", pdfErr.toString());
    // Continue without PDF - don't fail the edit operation
  }

  const updates = {
    [columnMap["lastModifiedBy"]]: currentUserName,
    [columnMap["lastModifiedDate"]]: timestamp,
    [columnMap["modCount"]]: newModCount
  };

  // Persist the edited "Emails" distribution list from the edit modal when
  // provided (mirrors Quotes: the confirmed list lives on the row for future
  // re-sends). A cleared/empty input leaves the stored list untouched.
  const editedEmails = (header && typeof header.emails === "string" && String(header.emails).trim() !== "")
    ? mergeEmailRecipients_([header.emails])
    : "";
  if (editedEmails && columnMap["Emails"] !== undefined) {
    updates[columnMap["Emails"]] = editedEmails;
  }

  // Add PDF URL to updates if PDF column exists and URL was created
  if (pdfUrl && columnMap["Req PDF Link"] !== undefined) {
    updates[columnMap["Req PDF Link"]] = pdfUrl;
  }

  console.log("DEBUG: columnMap keys:", Object.keys(columnMap));
  console.log("DEBUG: updates to apply:", updates);
  console.log("DEBUG: items array:", JSON.stringify(items));

  // Pair each client item to the physical sheet row it came from via rowNum
  // (carried by the edit modal); index pairing is wrong because the
  // history/modal list is newest-first. Falls back to legacy index pairing
  // for callers that send no rowNum.
  const itemsByRowNum = {};
  let itemsHaveRowNum = false;
  (items || []).forEach(function (it) {
    if (it && it.rowNum !== undefined && it.rowNum !== null && String(it.rowNum) !== "") {
      itemsByRowNum[Number(it.rowNum)] = it;
      itemsHaveRowNum = true;
    }
  });

  // Apply updates to ALL matching rows
  const updateRequests = [];
  matchingRows.forEach((row, idx) => {
    const rowData = data[row.dataIndex];

    // Apply modification tracking updates to all rows
    Object.keys(updates).forEach(colIndex => {
      if (updates[colIndex] !== undefined) {
        rowData[colIndex] = updates[colIndex];
      }
    });

    // Update item-specific columns for this row if a matching item exists
    const item = itemsHaveRowNum ? itemsByRowNum[row.rowNum] : (items && items[idx]);
    if (item) {
      console.log(`DEBUG: Updating row ${row.rowNum} with item:`, JSON.stringify(item));

      // Update standard item columns
      if (columnMap["Cantidad"] !== undefined && item.cant) {
        rowData[columnMap["Cantidad"]] = item.cant;
        console.log(`DEBUG:   Set Cantidad to ${item.cant}`);
      }
      if (columnMap["Desc Es"] !== undefined && item.es) {
        rowData[columnMap["Desc Es"]] = item.es;
        console.log(`DEBUG:   Set Desc Es to ${item.es}`);
      }
      // Written even when empty so a corrupted/foreign P/N can be cleared
      if (columnMap["P/N"] !== undefined && item.pn !== undefined && item.pn !== null) {
        rowData[columnMap["P/N"]] = item.pn;
        console.log(`DEBUG:   Set P/N to ${item.pn}`);
      }
      if (columnMap["Geo Code"] !== undefined && item.geo) {
        rowData[columnMap["Geo Code"]] = item.geo;
        console.log(`DEBUG:   Set Geo Code to ${item.geo}`);
      }
      // NEW: Update item-level status (Estado)
      if (columnMap["Estado"] !== undefined && item.estado) {
        rowData[columnMap["Estado"]] = item.estado;
        console.log(`DEBUG:   Set Estado to ${item.estado}`);
      }
    }

    updateRequests.push({ range: sheet.getRange(row.rowNum, 1, 1, rowData.length), values: [rowData] });
    console.log(`DEBUG: Updated row ${row.rowNum} (data index ${row.dataIndex})`);
  });

  console.log(`DEBUG: Applied updates to ${matchingRows.length} rows`);

  try {
    updateRequests.forEach(req => {
      req.range.setValues(req.values);
    });
    console.log("DEBUG: Sheet update successful for all rows");
  } catch (sheetErr) {
    console.error("DEBUG: Sheet update failed:", sheetErr.toString());
    throw sheetErr;
  }


  // Email handling
  let emailStatus = {};

  try {
    // Get site name from header
    const siteName = header.faena || "";

    // Recipients (mirrors Quotes): the newest edited "Emails" (edit modal)
    // wins, then the list persisted at creation (including manually added
    // emails), then fresh routing (SubArea-aware) when nothing is stored.
    const storedEmails = String(
      (columnMap["Emails"] !== undefined ? data[firstRowDataIndex][columnMap["Emails"]] : "") || ""
    ).trim();
    let recipients = editedEmails || storedEmails;
    if (!recipients) {
      const routing = getRequirementRouting(siteName, originalCategory, originalSubArea);
      recipients = routing.emails;
    }

    // CHECK: If recipients is fallback email, return requiresConfirmation flag
    if (recipients === "procurement@yourcompany.com") {
      return {
        success: true,
        orderId: orderId,
        category: originalCategory,
        requiresConfirmation: true,
        recipientWarning: true,
        message: `No recipients configured for category "${originalCategory}". Please specify an email.`
      };
    }

    // Build email - get first row data for dates
    const firstRowData = data[firstRowDataIndex];
    const emailHtmlBody = buildEmailWithMetadata({
      orderId: orderId,
      items: items || [],
      createdBy: originalCreator,
      createdDate: firstRowData[columnMap["Fecha/Hora"]],
      modifiedBy: currentUserName,
      modifiedDate: timestamp,
      modCount: newModCount,
      category: originalCategory,
      site: header.faena
    }, editorEmail);

    // Determine subject based on editor
    let subjectLine = `Requirement: ${orderId} - UPDATED (Self)`;
    if (originalCreator !== currentUserName) {
      subjectLine = `Requirement: ${orderId} - MODIFIED by ${currentUserName}`;
    }

    // Parse recipient emails
    const recipientEmails = recipients
      ? recipients.split(",").map(e => e.trim()).filter(e => e)
      : [];

    // CC original creator if different from current user
    let ccEmail = "";
    if (originalCreator !== currentUserName) {
      const creatorEmail = getUserEmailFromCache(originalCreator);
      if (creatorEmail && creatorEmail.includes("@")) {
        ccEmail = creatorEmail;
        console.log("DEBUG updateRequirementOnSheetWithItemStatuses: Found CC email:", ccEmail);
      } else {
        console.log("DEBUG updateRequirementOnSheetWithItemStatuses: Could not find email for:", originalCreator);
      }
    }

    console.log("DEBUG updateRequirementOnSheetWithItemStatuses - Recipients:", recipients);
    console.log("DEBUG updateRequirementOnSheetWithItemStatuses - Parsed emails:", recipientEmails);
    console.log("DEBUG updateRequirementOnSheetWithItemStatuses - CC email:", ccEmail);

    // If no recipients and no CC, log warning
    if (recipientEmails.length === 0 && !ccEmail) {
      console.warn("WARNING: No recipients and no CC - email will not be sent");
      emailStatus = {
        emailSent: false,
        emailService: "",
        emailError: "No recipients configured"
      };
    } else {
      // Send email via SmartDispatcher
      const dispatchMail = {
        type: "Requirement",
        refId: orderId,
        to: recipientEmails.join(","),
        cc: ccEmail,
        subject: subjectLine,
        body: emailHtmlBody,
        replyTo: "noreply@recon.cl",
        senderEmail: editorEmail || Session.getActiveUser().getEmail()
      };

      const dispatchResult = SmartDispatcher(dispatchMail);

      if (dispatchResult && dispatchResult.requiresFallbackChoice) {
        emailStatus = {
          emailSent: false,
          emailService: "",
          requiresFallbackChoice: true,
          graphError: dispatchResult.graphError || dispatchResult.message || "Graph send failed",
          dispatchDraft: dispatchMail,
          emailError: dispatchResult.graphError || dispatchResult.message || "Graph send failed"
        };
      } else {
        emailStatus = {
          emailSent: dispatchResult.success,
          emailService: dispatchResult.service || "",
          emailCc: ccEmail
        };
      }
    }
  } catch (emailErr) {
    console.warn("Email send failed:", emailErr.toString());
    emailStatus = {
      emailSent: false,
      emailService: "",
      emailError: emailErr.toString()
    };
  }

  return {
    success: true,
    orderId: orderId,
    category: originalCategory,
    ...emailStatus
  };
}

/**
 * Get email address for a user by looking up in the Users sheet cache
 * Searches by username/name in column A or B, returns email from column D
 * Returns empty string if not found
 */
function getUserEmailFromCache(userName) {
  console.log("DEBUG getUserEmailFromCache: ENTER function with userName:", userName);
  try {
    if (!userName || userName.trim() === "") {
      console.log("DEBUG getUserEmailFromCache: userName is empty, returning empty string");
      return "";
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName("Users");
    if (!usersSheet) {
      console.warn("Users sheet not found");
      return "";
    }

    const data = usersSheet.getDataRange().getValues();
    const normalizedSearch = userName.toLowerCase().trim();
    console.log("DEBUG getUserEmailFromCache: Looking for user:", userName, "->", normalizedSearch);

    // Find user by name in column C (Full Name), return email from column D
    for (let i = 1; i < data.length; i++) {
      const fullName = String(data[i][2] || "").toLowerCase().trim();  // Column C (index 2)

      if (i < 5) {
        console.log(`DEBUG getUserEmailFromCache: Row ${i} - Full Name: "${fullName}", Email: "${data[i][3]}"`);
      }

      if (fullName === normalizedSearch) {
        // Return email from column D (index 3)
        const email = String(data[i][3] || "").trim();
        console.log("DEBUG getUserEmailFromCache: Found user! Email:", email);
        return email;
      }
    }

    console.warn("User not found in Users sheet:", userName, "searched:", normalizedSearch);
    return "";
  } catch (err) {
    console.error("Error in getUserEmailFromCache:", err.toString());
    return "";
  }
}



function updateInventoryItem(item) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Master");
  const data = sheet.getDataRange().getValues();
  const geoCode = item.geo; // Changed from item.g

  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == geoCode) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) rowIndex = data.length + 1;

  const rowValues = [
    item.geo, // A - Changed from item.g
    item.pn, // B - Changed from item.p
    item.category, // C
    item.sub_categoria, // D
    item.marca, // E
    item.en, // F
    item.es, // G
    item.un, // H
    item.min, // I
    item.max, // J
    "", // K
    "", // L
    item.costo_clp, // M - Changed from item.costo
    item.proveedor, // N
    item.eta, // O
  ];

  sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  Logger.log("✅ Inventory item updated: " + geoCode);
  return { success: true, row: rowIndex };
}

// Tokens that mean "no real category has been assigned". Mirrors
// window.GENERAL_TOKENS in CreateReqJS.html / RFQJS.html so the server and the
// client agree on what counts as uncategorized.
const GENERAL_CATEGORY_TOKENS_ = [
  "", "general", "generica", "generico", "sin categoria",
  "sin cat", "uncategorized", "varios", "n/a", "na", "none", "-",
];

function isGeneralCategoryValue_(cat) {
  return GENERAL_CATEGORY_TOKENS_.indexOf(String(cat || "").trim().toLowerCase()) !== -1;
}

/**
 * Resolves the category shown for a requirement line on the RFQ page.
 *
 * The Ordenes "Category" column is authoritative: processMassOrders writes
 * shipment.category there (CreateReqGS.js) and it is the value the
 * category-assignment dialog collected at requirement creation - it is also
 * embedded in the Req ID (REQ-0750-GEN-MANTENIMIENTO).
 *
 * Master column C is only a FALLBACK, for legacy rows whose Ordenes category is
 * blank. Previously this function read Master exclusively and defaulted to the
 * literal "Uncategorized", so any GEO with a blank/missing Master category was
 * split out into a second RFQ category card and a second Quotes group - even
 * though Ordenes already carried the correct category. That produced one
 * requirement appearing as a "16-item" quote plus an "Uncategorized" remainder.
 *
 * @param {string} ordenesCategory category from the Ordenes row (item.category)
 * @param {string} masterCategory  category from the Master sheet (official.category)
 * @return {string} never blank, never "Uncategorized"
 */
function resolveRequirementCategory_(ordenesCategory, masterCategory) {
  const fromOrdenes = String(ordenesCategory || "").trim();
  if (!isGeneralCategoryValue_(fromOrdenes)) return fromOrdenes;
  const fromMaster = String(masterCategory || "").trim();
  if (!isGeneralCategoryValue_(fromMaster)) return fromMaster;
  return "General";
}

function getPendingRequirementsForRFQ(site, statusFilter) {
  const allHistory = getRequirementsHistory();
  const masterData = getInventoryData();

  const masterMap = new Map();
  masterData.forEach((item) => {
    // We add 'supplier' to the map retrieval
    masterMap.set(item.geo, {
      en: item.en,
      es: item.es,
      supplier: item.proveedor,
      category: item.category,
      subCategory: item.sub_categoria,
    });
  });

  // statusFilter: "Approved" (default) | "All" (everything except Pending, i.e.
  // requirements still awaiting approval are excluded) | any specific status
  // word (Quoted, Sent, Received, Despatched, ...).
  const statusKey = String(statusFilter || "Approved").trim().toLowerCase();
  let pending;
  if (statusKey === "all") {
    pending = allHistory.filter(
      (item) =>
        item.estado &&
        !item.estado.toString().toLowerCase().includes("pend"),
    );
  } else {
    pending = allHistory.filter(
      (item) =>
        item.estado && item.estado.toString().toLowerCase().includes(statusKey),
    );
  }
  if (site) {
    pending = pending.filter((item) => item.faena === site);
  }

  // Existing quotes per requirement item (for the "additional quote" flow):
  // lets the UI show which suppliers already quoted each GEO and block
  // re-selecting the same supplier for the same item.
  const quotesByOrderGeo = {};
  try {
    (getQuotesHistory() || []).forEach(function (q) {
      if (String(q.estado || "").toLowerCase() === "deleted") return;
      const key = String(q.orderId || "").trim() + "||" + String(q.geo || "").trim();
      (quotesByOrderGeo[key] = quotesByOrderGeo[key] || []).push({
        supplier: q.supplier || "",
        quoteId: q.quoteId || "",
        status: q.estado || "",
      });
    });
  } catch (e) {
    console.warn("RFQ quote-info join failed: " + e);
  }

  const groupedReqs = {};
  pending.forEach((item) => {
    if (!groupedReqs[item.order]) {
      groupedReqs[item.order] = {
        id: item.order,
        date: item.fecha,
        site: item.faena,
        subArea: item.subArea || "",
        status: item.estado || "",
        items: [],
      };
    }

    const official = masterMap.get(item.geo) || {
      en: "",
      es: "",
      supplier: "",
      category: "",
      subCategory: "",
    };
    groupedReqs[item.order].items.push({
      p: item.pn || "",
      geo: item.geo || "",
      // Capture both descriptions clearly
      es: (official.es || "").toString().trim(),
      en: (official.en || "").toString().trim(),
      // Keep the raw requirement description as a safety reference
      req_desc: (item.desc || "").toString().trim(),
      qty: item.cant || 0,
      supplier: official.supplier || "",
      category: resolveRequirementCategory_(item.category, official.category),
      subCategory: official.subCategory || "",
      quotedBy: quotesByOrderGeo[
        String(item.order || "").trim() + "||" + String(item.geo || "").trim()
      ] || [],
      // Item notes are unique to each requirement, so the Req ID travels with
      // the note: consolidated rows can render "Req 100123: <note>".
      reqItemNotes: [
        {
          ref: String(item.order || "").trim(),
          notes: String(item.itemNotes || ""),
        },
      ],
      // Supplier-facing notes travel the same way. These are the ONLY per-item
      // notes printed in the supplier RFQ email ("Item Notes" stays internal).
      reqSupplierNotes: [
        {
          ref: String(item.order || "").trim(),
          notes: String(item.supplierNotes || ""),
        },
      ],
      // Per-item photos (Ordenes "Item Images": comma-separated Drive URLs).
      // Kept per source Req (raw cell string) so the RFQ table, the preview and
      // the supplier email can render the requester's attachments. The client
      // unions them when several requirements are consolidated onto one GEO.
      images: String(item.images || ""),
    });
  });

  return Object.values(groupedReqs);
}

function getItemsByOrderId(orderId) {
  const allHistory = getRequirementsHistory();
  return allHistory.filter((item) => item.order === orderId);
}

/**
 * PHASE 3: Helper to render email body with conditional item tables
 * Renders single or dual tables depending on showDeficit/showInStock flags
 */
function buildRFQEmailBody_(baseBody, deficitItems, inStockItems, options) {
  options = options || {};
  const showDeficit = options.showDeficit !== false;
  const showInStock = options.showInStock !== false;

  let emailHtml = String(baseBody || "").replace(/\n/g, "<br>");

  // ---- Supplier Notes (per item) -----------------------------------------
  // "Supplier Notes" is typed per item in the Create Req cart and stored on the
  // Ordenes "Supplier Notes" column. It is the ONLY per-item note a supplier may
  // see ("Item Notes" stays internal). The column is rendered only when at least
  // one item carries a note, so emails without supplier notes stay unchanged.
  const supplierNotesText = function (item) {
    if (!item) return "";
    const parts = [];
    if (Array.isArray(item.reqSupplierNotes)) {
      item.reqSupplierNotes.forEach(function (n) {
        const note = cleanReqNotes_(n && n.notes);
        if (!note) return;
        const ref = String((n && n.ref) || "").trim();
        parts.push(ref ? ref + ": " + note : note);
      });
    }
    if (!parts.length) {
      const single = cleanReqNotes_(item.supplierNotes);
      if (single) parts.push(single);
    }
    return parts.join(" | ");
  };
  const hasSupplierNotes = function (items) {
    return (items || []).some(function (it) { return supplierNotesText(it) !== ""; });
  };
  const supplierNotesThHtml = '<th style="padding:8px; border:1px solid #999; text-align:left;">Notas / Notes (Proveedor)</th>';
  const showSupplierNotesDeficit = showDeficit && hasSupplierNotes(deficitItems);
  // NOTE: the in-stock table is only ever sent to INTERNAL users (scenarios A/B),
  // so "Supplier Notes" is deliberately not added there.

  // Per-item photos attached in the Create Req cart (Ordenes "Item Images").
  // Rendered as linked Drive thumbnails in the deficit (supplier-facing) table
  // and in the internal in-stock table, but ONLY when at least one line carries
  // a photo — imageless RFQs keep byte-identical bodies. Files are link-shared
  // view-only at upload time, so the supplier can open the full photo.
  const imagesThHtml = '<th style="padding:8px; border:1px solid #999; text-align:left;">Images</th>';
  const showImagesDeficit = showDeficit && (deficitItems || []).some(function (it) {
    return reqItemImageUrls_(it).length > 0;
  });
  const showImagesInStock = showInStock && (inStockItems || []).some(function (it) {
    return reqItemImageUrls_(it).length > 0;
  });

  // Render Deficit Items table (if applicable)
  if (showDeficit && deficitItems && deficitItems.length > 0) {
    const deficitTableHtml = `
      <br><br>
      <h3 style="color:#d9534f; font-size:14px; font-weight:bold;">Items Requiring Purchase</h3>
      <table style="width:100%; border-collapse:collapse; margin:15px 0; font-size:12px; font-family: Arial, sans-serif;">
        <tr style="background:#f0f0f0; border:1px solid #999;">
          <th style="padding:8px; border:1px solid #999; text-align:left;">GEO Code</th>
          <th style="padding:8px; border:1px solid #999; text-align:left;">P/N</th>
          <th style="padding:8px; border:1px solid #999; text-align:left;">Descripción / Description</th>
          <th style="padding:8px; border:1px solid #999; text-align:center;">Cant.</th>
          ${showSupplierNotesDeficit ? supplierNotesThHtml : ""}
          ${showImagesDeficit ? imagesThHtml : ""}
        </tr>
        ${deficitItems
        .map(
          (item) => `<tr style="border:1px solid #999;">
          <td style="padding:6px; border:1px solid #999;">${item.geo}</td>
          <td style="padding:6px; border:1px solid #999;"><strong>${item.pn || item.p || ""}</strong></td>
          <td style="padding:6px; border:1px solid #999;">
            <div style="font-weight:bold; color:#000;">${item.es || item.req_desc || "N/A"}</div>
            <div style="color:#666; font-size:11px; font-style: italic;">${item.en || ""}</div>
          </td>
          <td style="padding:6px; border:1px solid #999; text-align:center;"><strong>${item.qty}</strong></td>
          ${showSupplierNotesDeficit ? '<td style="padding:6px; border:1px solid #999; font-size:11px;">' + supplierNotesText(item) + '</td>' : ""}
          ${showImagesDeficit ? '<td style="padding:6px; border:1px solid #999; font-size:11px;">' + reqImagesCellHtml_(item, 56) + '</td>' : ""}
        </tr>`,
        )
        .join("")}
      </table>`;
    emailHtml += deficitTableHtml;
  }

  // Render In-Stock Items table (if applicable)
  if (showInStock && inStockItems && inStockItems.length > 0) {
    const inStockTableHtml = `
      <br><br>
      <h3 style="color:#5cb85c; font-size:14px; font-weight:bold;">Items Available in Stock</h3>
      <table style="width:100%; border-collapse:collapse; margin:15px 0; font-size:12px; font-family: Arial, sans-serif;">
        <tr style="background:#f0f0f0; border:1px solid #999;">
          <th style="padding:8px; border:1px solid #999; text-align:left;">GEO Code</th>
          <th style="padding:8px; border:1px solid #999; text-align:left;">P/N</th>
          <th style="padding:8px; border:1px solid #999; text-align:left;">Descripción / Description</th>
          <th style="padding:8px; border:1px solid #999; text-align:center;">Cant.</th>
          ${showImagesInStock ? imagesThHtml : ""}
        </tr>
        ${inStockItems
        .map(
          (item) => `<tr style="border:1px solid #999;">
          <td style="padding:6px; border:1px solid #999;">${item.geo}</td>
          <td style="padding:6px; border:1px solid #999;"><strong>${item.pn || item.p || ""}</strong></td>
          <td style="padding:6px; border:1px solid #999;">
            <div style="font-weight:bold; color:#000;">${item.es || item.req_desc || "N/A"}</div>
            <div style="color:#666; font-size:11px; font-style: italic;">${item.en || ""}</div>
          </td>
          <td style="padding:6px; border:1px solid #999; text-align:center;"><strong>${item.qty}</strong></td>
          ${showImagesInStock ? '<td style="padding:6px; border:1px solid #999; font-size:11px;">' + reqImagesCellHtml_(item, 56) + '</td>' : ""}
        </tr>`,
        )
        .join("")}
      </table>`;
    emailHtml += inStockTableHtml;
  }

  return emailHtml;
}

/**
 * Modify email body greeting from supplier-specific to generic for users
 * Replaces "Estimado [name]," at start with "Equipo,"
 */
function personalizeBodyForUsers_(body) {
  if (!body) return body;
  // Replace "Estimado [anything]," at start with "Equipo,"
  return String(body).replace(/^([\s]*Estimado\s+[^,]*,)/i, "Equipo,");
}

/**
 * Splits a combined Ref ID ("100123+100127") into its source requirement IDs.
 * Plain single refs pass through unchanged (returns [ref]).
 */
function splitCombinedRef_(refId) {
  return String(refId || "")
    .split("+")
    .map(function (id) { return String(id || "").trim(); })
    .filter(Boolean);
}

function sendFinalRFQ(details) {

  try {
    
  const flags = getQuoteConfigFlags_();

  // =====================================================
  // PHASE 2: EXTRACT AND CLASSIFY ITEMS
  // =====================================================
  const deficitItems = details.deficitItems || [];
  const bodegaItems = details.bodegaItems || [];
  const hasInStockItems = deficitItems.length === 0 ? false : (bodegaItems.length > 0);

  console.log("PHASE 2 - Stock Classification:", {
    deficitCount: deficitItems.length,
    bodegaCount: bodegaItems.length,
    hasInStockItems: hasInStockItems
  });

  // Determine scenario:
  // Scenario A: Mixed inventory (both deficit & in-stock)
  // Scenario B: All in-stock (zero deficit)
  // Scenario C: All out of stock (zero in-stock)
  const isScenarioA = deficitItems.length > 0 && bodegaItems.length > 0;
  const isScenarioB = deficitItems.length === 0 && bodegaItems.length > 0;
  const isScenarioC = deficitItems.length > 0 && bodegaItems.length === 0;

  console.log("PHASE 2 - Scenario:", {
    isScenarioA: isScenarioA,
    isScenarioB: isScenarioB,
    isScenarioC: isScenarioC
  });

  // Use deficit items for PDF generation (base quoteItems).
  // 🛎️ FIX (PDF_ONLY mode): details.deficitItems / details.bodegaItems are only
  // populated by the EMAIL_AND_PDF payload - the PDF_ONLY payload never sent
  // them, so both were []. `bodegaItems` (an empty array) was then handed to
  // buildQuoteItems_() and, being truthy, it blanked out details.items, making
  // every PDF_ONLY send fail with "No supplier items were provided for this RFQ".
  // Fall through to details.items so any payload shape still yields a quote.
  const quoteItems = buildQuoteItems_(
    details,
    deficitItems.length > 0
      ? deficitItems
      : (bodegaItems.length > 0 ? bodegaItems : (details.items || []))
  );

  if (!quoteItems.length) {
    return {
      success: false,
      message: "No supplier items were provided for this RFQ.",
    };
  }

  // 🔒 FIX: CC routing must reflect the REAL categories in this quote, never a
  // fallback "General". Collect the distinct categories across ALL items involved
  // (deficit + in-stock) so category staff for every product are CC'd.
  const routingCategories = Array.from(new Set(
    (deficitItems.concat(bodegaItems))
      .map(function (it) { return String(it.category || "").trim(); })
      .filter(Boolean)
  )).sort();
  const routingCategoriesText = routingCategories.length > 0
    ? routingCategories.join(", ")
    : String(details.category || "").trim();

  const orderId = String(details.orderId || details.refId || "PENDING");
  console.log("first 2 sendfinalrfq, ", details.orderId);

  // Consolidated RFQ support: details.orderIds carries every source requirement
  // ("100123+100127" style combined refs are split as a fallback). Single-req
  // RFQs simply get a one-element list.
  const orderIds = (Array.isArray(details.orderIds) && details.orderIds.length)
    ? details.orderIds.map(function (id) { return String(id || "").trim(); }).filter(Boolean)
    : splitCombinedRef_(orderId);
  // Ref ID written on the Quotes sheet: combined when the quote consolidates
  // several requirements, plain single ref otherwise.
  const refIdForQuote = orderIds.length > 1 ? orderIds.join("+") : (orderIds[0] || orderId);

  // Persist any supplier notes the user edited in the RFQ items table. Only items
  // that explicitly carry `supplierNotes` were touched in the UI (see the client
  // setRfqSupplierNotes), so untouched requirements are never rewritten and the
  // "Supplier Notes" column is only created when a note is actually set. Runs on
  // SEND only (this function), matching the "save on send" contract.
  try {
    persistRfqSupplierNotes_(details, orderIds);
  } catch (noteErr) {
    console.warn("sendFinalRFQ: supplier notes persist failed: " + noteErr.toString());
  }

  const quoteId = String(
    details.quoteId ||
    `RFQ-${orderId}-${Utilities.formatDate(new Date(), "GMT-4", "yyyyMMdd-HHmmss")}-${Utilities.getUuid()}`,
  );

  const supplierInfo = getQuoteSupplierInfo_(String(details.supplier || ""));

  const quoteData = {
    orderId: refIdForQuote,
    // Consolidated RFQ traceability: list the source requirements in Comments
    orderIds: orderIds,
    quoteId: quoteId,
    quoteFileName: sanitizeFileName_(quoteId),
    supplier: String(details.supplier || "N/A"),
    site: String(details.site || ""),
    category: String(details.category || "General"),
    comprador: String(
      details.userName || details.comprador || details.replyTo || "",
    ),
    createdBy: String(details.currentUserEmail || details.replyTo || Session.getActiveUser().getEmail() || ""),
    createdDate: new Date(),
    lastModifiedBy: String(details.currentUserEmail || details.replyTo || Session.getActiveUser().getEmail() || ""),
    lastModifiedDate: new Date(),
    currency: "CLP",
    comments: String(details.comments || ""),
    condicionPago: String(
      details.condicionPago || supplierInfo.paymentTerms || "",
    ),
    ivaInc: String(details.ivaInc || "Neto"),
    refCotiz: "",
    status: "Pending",
    items: quoteItems,
  };

  // Traceability: consolidated quotes record their source requirements in Comments
  if (orderIds.length > 1) {
    quoteData.comments = ("[Consolidated Reqs: " + orderIds.join("+") + "] " + quoteData.comments).trim();
  }

  console.log("STEP 1 - items before pricing:", JSON.stringify(quoteData.items));

  quoteData.items = quoteData.items.map(function (item, i) {
    try {
      const qty = Number(item.qty || item.cant || 0);
      const geo = item.geo || "";
      const pn = item.pn || item.p || "";

      let price = 0;

      if (geo) {
        try {
          price = Number(getQuoteLastPriceFromCompras_(geo, pn) || 0);
        } catch (e) {
          console.warn("Price fetch failed:", geo, pn, e);
          price = 0;
        }
      }

      return {
        ...item,
        qty: qty,
        pn: pn,
        price: price,
        total: price * qty,
        lineTotal: price * qty,
      };
    } catch (err) {
      console.error("Item processing failed:", item, err);
      return {
        ...item,
        price: 0,
        total: 0,
      };
    }
  });

  const targetFolder = getQuoteTargetFolder_(
    quoteData.site,
    quoteData.supplier
  );

  console.log("PDF ITEMS:", JSON.stringify(quoteData.items));

  // =====================================================
  // PHASE 4: PDF GENERATION (CONDITIONAL)
  // =====================================================
  // PDF is generated for Scenarios A (users), B (users), and C (supplier+users)
  // PDF contains all items (deficit + in-stock combined)
  let pdfUrl = null;
  let pdfLinkHtml = "";

  // Only generate PDF if email is enabled
  if (flags.quoEmailEnabled === true) {
    pdfUrl = generateQuotePDF(quoteData, targetFolder);

    if (!pdfUrl || typeof pdfUrl !== "string" || pdfUrl.trim() === "") {
      throw new Error("PDF generation failed - invalid or empty URL returned");
    }

    pdfLinkHtml = `<br><br><b>PDF:</b> <a href="${pdfUrl}" target="_blank">View Quote</a>`;
  }

  // =====================================================
  // SAVE TO SHEET (PROTECTED)
  // =====================================================
  // 🔒 FIX #4: Persist EVERY email involved in this quote creation (supplier TO
  // + internal CC + category routing list) so that later editing / updation emails
  // for the same quote reuse the exact same distribution list.

  const toRecipients = String(details.to || details.initialRecipientEmails || details.replyTo || details.currentUserEmail || '').trim();
  const ccRecipients = String(details.cc || '').trim();
  let routingEmailsForQuote = "";
  try {
    const routingForQuote = getRequirementRouting(details.site || '', routingCategoriesText, String(details.subArea || ''));
    if (routingForQuote && routingForQuote.emails && routingForQuote.emails !== 'procurement@yourcompany.com') {
      routingEmailsForQuote = routingForQuote.emails;
    }
  } catch (err) {
    console.warn('Routing lookup failed while persisting quote recipients: ' + err.toString());
  }
  // Determine which emails to save in the sheet:
  // - If supplierEmail is explicitly provided, exclude it from saved emails
  // - Only save CC + routing emails (these are internal distribution lists)
  const supplierEmailToExclude = String(details.supplierEmail || '').trim().toLowerCase();
  let emailsForSheet = mergeEmailRecipients_([ccRecipients, routingEmailsForQuote]);
  
  // Remove supplier email from saved list if present (defensive check)
  if (supplierEmailToExclude) {
    const emailList = emailsForSheet.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const filteredEmails = emailList.filter(e => e !== supplierEmailToExclude);
    emailsForSheet = filteredEmails.join(', ');
  }
  
  quoteData.initialRecipients = emailsForSheet;

  quoteData.ccEmails = ccRecipients;  // kept for reference / future use
  // Pre-uploaded quote document (attached from the RFQ preview card) is stamped
  // onto the newly created quote rows ("Quoted Doc Link" column).
  const rfqAttachmentUrl = String(details.attachmentUrl || "").trim();
  if (rfqAttachmentUrl) {
    quoteData.quotedDocUrl = rfqAttachmentUrl;
  }
  // 🛎️ FIX (duplicate quote blocks): saveQuoteToSheet() used to run HERE, before
  // any send had actually happened. Every failure downstream - the PDF_ONLY
  // throw below, a missing user-email list, a SmartDispatcher error, or the
  // outer catch - therefore left a complete block of orphan rows behind, and the
  // user's retry appended a SECOND identical block under a brand-new Quote ID
  // (timestamp + UUID). That is precisely the duplicated 16-row blocks seen on
  // the Quotes sheet.
  //
  // The write is now DEFERRED and executed exactly once, on a success path,
  // immediately before updateQuoteSheetStatus_() stamps those rows.
  let quotePersisted = false;
  const persistQuote_ = function () {
    if (quotePersisted) return;
    quotePersisted = true;
    saveQuoteToSheet(quoteData, pdfUrl, emailsForSheet);
  };

  const emailEnabled = flags.quoEmailEnabled === true;

  // =====================================================
  // PDF ONLY FLOW
  // =====================================================
  if (details.mode === "PDF_ONLY") {
    if (!pdfUrl) {
      throw new Error("PDF_ONLY mode failed: PDF not generated");
    }

    persistQuote_();
    updateQuoteSheetStatus_(quoteId, "Pending");

    const itemGeos =
      details.itemGeos ||
      quoteData.items.map(function (item) {
        return item.geo;
      });

    updateQuotedStatus(orderId, quoteId, itemGeos);
    updateOrdenesWithQuote(orderId, quoteId, itemGeos);

    return {
      success: true,
      service: "PDF",
      message: "PDF generated successfully. Email is Disabled by system",
      pdfUrl: pdfUrl,
    };
  }

  // =====================================================
  // EMAIL DISABLED FLOW
  // =====================================================
  if (!emailEnabled) {
    persistQuote_();
    updateQuoteSheetStatus_(quoteId, "Pending");

    const itemGeos =
      details.itemGeos ||
      quoteData.items.map(function (item) {
        return item.geo;
      });

    updateQuotedStatus(orderId, quoteId, itemGeos);
    updateOrdenesWithQuote(orderId, quoteId, itemGeos);
    return {
      success: true,
      service: "Saved",
      message: "Quote saved. Email disabled by Config.",
      pdfUrl: pdfUrl,
    };
  }

  // =====================================================
  // EMAIL FLOW - PHASE 5: CONDITIONAL EMAIL DISPATCH
  // =====================================================
  const senderEmail = String(
    details.currentUserEmail || details.replyTo || Session.getActiveUser().getEmail() || "",
  ).trim();
  let signatureHtml = "";
  if (senderEmail) {
    try {
      signatureHtml = getUserSignature(senderEmail);
    } catch (sigErr) {
      console.warn("RFQ signature lookup failed for " + senderEmail + ": " + sigErr.toString());
    }
  }

  const baseBody = String(details.body || "");
  const subject = String(details.subject || "No Subject");

  // Scenario A: MIXED INVENTORY - Send split emails
  if (isScenarioA) {
    console.log("SCENARIO A: Mixed inventory - sending split emails");

    // EMAIL 1: Supplier (deficit items only, NO PDF)
    const supplierEmailBody = buildRFQEmailBody_(baseBody, deficitItems, [], {
      showDeficit: true,
      showInStock: false
    });

    const supplierEmailPackage = {
      type: "RFQ",
      refId: String(details.orderId || "PENDING"),
      to: String(details.to || ""),
      cc: "", // No CC for supplier in split scenario
      subject: subject,
      body: supplierEmailBody + (signatureHtml ? `<br><br>${signatureHtml}` : ""),
      supplier: String(details.supplier || "N/A"),
      replyTo: String(details.replyTo || Session.getActiveUser().getEmail()),
      senderEmail: senderEmail,
      fallbackProvider: String(details.fallbackProvider || ""),
      pdfUrl: "" // NO PDF for supplier
    };

    console.log("Dispatching Supplier Email (Scenario A)...");
    const supplierResult = SmartDispatcher(supplierEmailPackage);

    // EMAIL 2: Users (all items - deficit + in-stock, WITH PDF)
    const routing = getRequirementRouting(details.site || "", routingCategoriesText, String(details.subArea || ""));
    let userEmails = routing.emails || "";

    // If routing returned fallback, use CC field from form instead
    if (userEmails === "procurement@yourcompany.com" || userEmails.trim() === "") {
      userEmails = String(details.cc || "").trim();
    }

    // If still empty, abort and ask user
    if (!userEmails) {
      return {
        success: false,
        message: "No user emails found from Users sheet. Please add emails in the CC field and try again."
      };
    }

    const personalizedBaseBody = personalizeBodyForUsers_(baseBody);
    const userEmailBody = buildRFQEmailBody_(personalizedBaseBody, deficitItems, bodegaItems, {
      showDeficit: true,
      showInStock: true
    });

    const userEmailPackage = {
      type: "RFQ",
      refId: String(details.orderId || "PENDING"),
      to: userEmails,
      cc: "", // No CC for users in split scenario
      subject: subject + " [Stock Available]",
      body: userEmailBody + pdfLinkHtml + (signatureHtml ? `<br><br>${signatureHtml}` : ""),
      supplier: String(details.supplier || "N/A"),
      replyTo: String(details.replyTo || Session.getActiveUser().getEmail()),
      senderEmail: senderEmail,
      fallbackProvider: String(details.fallbackProvider || ""),
      pdfUrl: pdfUrl
    };

    console.log("Dispatching User Email (Scenario A)...");
    const userResult = SmartDispatcher(userEmailPackage);

    // Log both emails and update status
    if (supplierResult && supplierResult.success) {
      console.log("Supplier email sent successfully");
    } else {
      console.warn("Supplier email dispatch returned:", supplierResult);
    }

    if (userResult && userResult.success) {
      console.log("User email sent successfully");
      persistQuote_();
      updateQuoteSheetStatus_(quoteId, "Pending");

      const itemGeos = details.itemGeos || quoteData.items.map(function (item) {
        return item.geo;
      });

      updateQuotedStatus(orderId, quoteId, itemGeos);
      updateOrdenesWithQuote(orderId, quoteId, itemGeos);

      return {
        success: true,
        service: "Split Emails (Graph/Brevo)",
        message: "RFQ split emails sent: deficit to supplier, all items to users.",
        pdfUrl: pdfUrl,
        emailsSent: 2
      };
    } else {
      return {
        success: false,
        message: "User email dispatch failed: " + (userResult ? userResult.message || userResult.error : "Unknown error")
      };
    }
  }

  // Scenario B: ALL IN STOCK - Send only to users
  if (isScenarioB) {
    console.log("SCENARIO B: All in-stock - sending email to users only");

    const routing = getRequirementRouting(details.site || "", routingCategoriesText, String(details.subArea || ""));
    let userEmails = routing.emails || "";

    // If routing returned fallback, use CC field from form instead
    if (userEmails === "procurement@yourcompany.com" || userEmails.trim() === "") {
      userEmails = String(details.cc || "").trim();
    }

    // If still empty, abort and ask user
    if (!userEmails) {
      return {
        success: false,
        message: "No user emails found from Users sheet. Please add emails in the CC field and try again."
      };
    }

    const personalizedBaseBody = personalizeBodyForUsers_(baseBody);
    const userEmailBody = buildRFQEmailBody_(personalizedBaseBody, [], bodegaItems, {
      showDeficit: false,
      showInStock: true
    });

    const userEmailPackage = {
      type: "RFQ",
      refId: String(details.orderId || "PENDING"),
      to: userEmails,
      cc: "",
      subject: subject + " [Fulfilled from Stock]",
      body: userEmailBody + pdfLinkHtml + (signatureHtml ? `<br><br>${signatureHtml}` : ""),
      supplier: String(details.supplier || "N/A"),
      replyTo: String(details.replyTo || Session.getActiveUser().getEmail()),
      senderEmail: senderEmail,
      fallbackProvider: String(details.fallbackProvider || ""),
      pdfUrl: pdfUrl
    };

    console.log("Dispatching User Email (Scenario B)...");
    const userResult = SmartDispatcher(userEmailPackage);

    if (userResult && userResult.success) {
      persistQuote_();
      updateQuoteSheetStatus_(quoteId, "Pending");

      const itemGeos = details.itemGeos || quoteData.items.map(function (item) {
        return item.geo;
      });

      updateQuotedStatus(orderId, quoteId, itemGeos);
      updateOrdenesWithQuote(orderId, quoteId, itemGeos);

      return {
        success: true,
        service: "Graph/Brevo",
        message: "All items fulfilled from stock. Email sent to users only.",
        pdfUrl: pdfUrl,
        emailsSent: 1
      };
    } else {
      return {
        success: false,
        message: "User email dispatch failed: " + (userResult ? userResult.message || userResult.error : "Unknown error")
      };
    }
  }

  // Scenario C: ALL OUT OF STOCK - Send single email to supplier + users CC
  if (isScenarioC) {
    console.log("SCENARIO C: All out of stock - sending single email to supplier + users");

    const routing = getRequirementRouting(details.site || "", routingCategoriesText, String(details.subArea || ""));
    let userEmails = routing.emails || "";

    // If routing returned fallback, use CC field from form instead
    if (userEmails === "procurement@yourcompany.com" || userEmails.trim() === "") {
      userEmails = String(details.cc || "").trim();
    }

    // If no emails available for CC, it's OK in Scenario C - just send to supplier
    if (!userEmails) {
      console.warn("No user emails found for CC - will send only to supplier");
      userEmails = "";
    }

    const emailBody = buildRFQEmailBody_(baseBody, deficitItems, [], {
      showDeficit: true,
      showInStock: false
    });

    const emailPackage = {
      type: "RFQ",
      refId: String(details.orderId || "PENDING"),
      to: String(details.to || ""),
      cc: userEmails,
      subject: subject,
      body: emailBody + (signatureHtml ? `<br><br>${signatureHtml}` : ""),
      supplier: String(details.supplier || "N/A"),
      replyTo: String(details.replyTo || Session.getActiveUser().getEmail()),
      senderEmail: senderEmail,
      fallbackProvider: String(details.fallbackProvider || ""),
      pdfUrl: "" // No PDF link in supplier email (internal PDF still generated + saved)
    };

    console.log("Dispatching Email (Scenario C)...");
    const result = SmartDispatcher(emailPackage);

    if (result && result.success) {
      persistQuote_();
      updateQuoteSheetStatus_(quoteId, "Pending");

      const itemGeos = details.itemGeos || quoteData.items.map(function (item) {
        return item.geo;
      });

      updateQuotedStatus(orderId, quoteId, itemGeos);
      updateOrdenesWithQuote(orderId, quoteId, itemGeos);

      return {
        success: true,
        service: result.service || "Graph/Brevo",
        message: "RFQ email sent to supplier with users CC (all items out of stock).",
        pdfUrl: pdfUrl,
        emailsSent: 1
      };
    } else {
      return {
        success: false,
        message: result.message || result.error || "Unknown Dispatch Error"
      };
    }
  }

  // Fallback: should not reach here, but handle edge case
  return {
    success: false,
    message: "Unable to determine email scenario. Check item stock classification."
  };

  } catch (e) {
    console.error("sendFinalRFQ Error: " + e.toString());
    return {
      success: false,
      message: "Backend Crash: " + e.toString(),
    };
  }
}


function updateQuotedStatus(orderId, quoteStatus, itemGeos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    if (!sheet) {
      Logger.log("❌ Ordenes sheet not found");
      return;
    }

    const data = sheet.getDataRange().getValues();
    const statusText = String(quoteStatus || "");
    // Consolidated RFQ: orderId may be "A+B" — update EVERY source requirement.
    const orderIdStrs = Array.isArray(orderId) ? orderId.map(String) : splitCombinedRef_(orderId);

    Logger.log(
      `🔍 updateQuotedStatus: Looking for orderIds=${JSON.stringify(orderIdStrs)}, geos=${JSON.stringify(itemGeos)}, status=${statusText}`,
    );

    let updateCount = 0;

    for (let i = 1; i < data.length; i++) {
      const rowOrder = String(data[i][0] || "").trim();
      const rowGeo = String(data[i][3] || "").trim();

      if (
        orderIdStrs.indexOf(rowOrder) !== -1 &&
        itemGeos &&
        itemGeos.indexOf(rowGeo) !== -1
      ) {
        Logger.log(
          `  ✓ Updating row ${i + 1}: Order=${rowOrder}, Geo=${rowGeo}`,
        );
        // Append mode: "Quoted | Q1, Q2" so the user sees every quote id for
        // this requirement while keeping the "Quoted" keyword for filters
        // (getPendingRequirementsForRFQ uses includes("quoted"), and
        // normalizeStage maps quot/cotiz -> Quoted).
        const existingStatus = String(data[i][7] || "").trim();
        let newStatus;
        if (/^quoted\s*\|/i.test(existingStatus)) {
          // Already in "Quoted | ..." form: append only if this quote id is new.
          newStatus = existingStatus.includes(statusText)
            ? existingStatus
            : existingStatus + ", " + statusText;
        } else if (existingStatus.includes(statusText) && existingStatus) {
          // Legacy rows where Estado holds the bare quote id (previous bug):
          // normalize to the prefixed form.
          newStatus = "Quoted | " + existingStatus;
        } else {
          // Fresh quote (Approved/empty/any other state): overwrite with the
          // prefixed form. Quoted is the forward lifecycle step after Approved.
          newStatus = "Quoted | " + statusText;
        }
        sheet.getRange(i + 1, 8).setValue(newStatus);
        // Keep the in-memory copy in sync so a second GEO of the same row
        // set processed later in this loop sees the updated value.
        data[i][7] = newStatus;
        updateCount++;
      }
    }

    SpreadsheetApp.flush();
    Logger.log(
      `✅ Success: Updated ${updateCount} rows in Ordenes sheet with quote status ${statusText}.`,
    );
  } catch (e) {
    Logger.log(
      "❌ Error in updateQuotedStatus: " + e.message + " | Stack: " + e.stack,
    );
  }
}




function updateOrdenesWithQuote(orderId, quoteId, itemGeos) {

  console.log("ORDER UPDATE START");
  console.log("orderId:", orderId);
  console.log("quoteId:", quoteId);
  console.log("itemGeos:", itemGeos);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");

  if (!sheet) throw new Error("Ordenes sheet not found");

  const data = sheet.getDataRange().getValues();

  const header = data[0];
  const geoCol = header.indexOf("Geo Code");
  const orderCol = header.indexOf("Order");
  const quoteCol = header.indexOf("Quote ID");

  console.log("HEADERS:", header);
  console.log("geoCol:", geoCol, "orderCol:", orderCol, "quoteCol:", quoteCol);

  if (geoCol === -1 || orderCol === -1 || quoteCol === -1) {
    throw new Error("Missing required columns in Ordenes sheet");
  }

  // Consolidated RFQ: orderId may be "A+B" — append the quote to EVERY source
  // requirement's rows.
  const orderIdStrs = Array.isArray(orderId) ? orderId.map(String) : splitCombinedRef_(orderId);

  for (let i = 1; i < data.length; i++) {
    const rowOrderId = String(data[i][orderCol]);
    const geo = String(data[i][geoCol]);

    if (orderIdStrs.indexOf(rowOrderId) !== -1 && itemGeos.includes(geo)) {

      let existing = String(data[i][quoteCol] || "");

      // 🔥 IMPORTANT: append, don't overwrite
      if (!existing.includes(quoteId)) {
        existing = existing ? existing + "," + quoteId : quoteId;
      }

      sheet.getRange(i + 1, quoteCol + 1).setValue(existing);
    }
  }

  return { success: true };
}

///////////////////////////////////////////////////////////////////////
// Login Function

function verifyUserLogin(userId, pin) {
  try {
    const activeEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("Users");
    const data = userSheet.getDataRange().getValues();

    // Headers: A:UserId, B:Pin, C:FullName, D:Email, E:Phone, F:Position, G:Site, H:Role, I:SignLink, J:Active
    // Find user by ID
    const userRow = data.find((row) => String(row[0]) === String(userId));

    if (!userRow) return { success: false, message: "User ID not found." };

    // 1. Check Active Status (Col J / Index 9)
    if (String(userRow[9]) !== "1") {
      return { success: false, message: "This account is inactive." };
    }

    // 2. Check PIN (Col B / Index 1)
    if (String(userRow[1]) !== String(pin)) {
      return { success: false, message: "Incorrect PIN." };
    }

    // 3. Security Cross-Check (Google Email)
    //if (userRow[3].toLowerCase() !== activeEmail) {
    //  return { success: false, message: "Unauthorized: Badge/ID does not match your Google login." };
    //}

    // If all pass, return the Session Object
    return {
      success: true,
      user: {
        name: userRow[2],
        email: userRow[3],
        phone: userRow[4],
        position: userRow[5],
        site: userRow[6],
        role: userRow[7],
        signLink: userRow[8],
      },
    };
  } catch (e) {
    return { success: false, message: "Server Error: " + e.message };
  }
}

//////////////////////////////////////////////////

function getAdminData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const valSheet = ss.getSheetByName("Validation");
  const userSheet = ss.getSheetByName("Users");
  const configSheet = ss.getSheetByName("Config"); // Access Config

  console.log("Fetching Admin Data...");

  if (!userSheet) {
    console.warn("Users sheet missing. Creating it now.");
    ss.insertSheet("Users");
    const headers = [
      "User ID",
      "PIN",
      "Name",
      "Email",
      "Phone",
      "Position",
      "Site",
      "Role",
      "SignLink",
      "Active",
    ];
    ss.getSheetByName("Users")
      .getRange(1, 1, 1, headers.length)
      .setValues([headers]);
  }

  const valData = valSheet.getDataRange().getValues();
  const userData = ss.getSheetByName("Users").getDataRange().getValues();
  const rows = valData.slice(1);

  const allPeople = getPeople();
  const activePeople = allPeople.filter(p => {
    return p.name && (p.active === true || String(p.active).toUpperCase() === "TRUE");
  });


  const result = {
    sites: rows.filter((r) => r[0]).map((r) => ({ name: r[0], suffix: r[2] })),
    categories: rows
      .filter((r) => r[5])
      .map((r) => ({
        name: r[5],
        email: r[6] || "",
      })),
    subCats: rows
      .filter((r) => r[8])
      .map((r) => ({ parent: r[7], name: r[8] })),
    // FIX: Column K is Index 10
    brands: rows.filter((r) => r[10]).map((r) => ({ name: r[10] })),
    suppliers: rows
      .filter((r) => r[15])
      .map((r) => ({ name: r[15], email: r[16] })),
    users: userData
      .slice(1)
      .filter((r) => r[0])
      .map((r) => ({
        userId: String(r[0]),
        pin: String(r[1]),
        name: r[2],
        email: r[3],
        phone: r[4],
        position: r[5],
        site: r[6],
        role: r[7],
        active: String(r[9]),
        defaultSignId: configSheet.getRange("B12").getValue(),
      })),
      people: activePeople,

    quoPdfEnabled: configSheet.getRange("B18").getValue(), // Check if True/False
    quoEmailEnabled: configSheet.getRange("B19").getValue(),
    reqPdfEnabled: configSheet.getRange("B15").getValue(), // Check if True/False
    reqEmailEnabled: configSheet.getRange("B16").getValue(),

    // Per-status flags for the "Quote Updated" notification. Read BY LABEL
    // (not a fixed cell) so inserting Config rows cannot silently repoint
    // them. Each falls back to its documented default when the row is missing
    // or blank, matching the fail-open behaviour of getQuoteEmailStatusFlags_().
    quoteEmailPending: configFlagByLabel_("Quote Email Pending", true),
    quoteEmailQuoted: configFlagByLabel_("Quote Email Quoted", true),
    quoteEmailApproved: configFlagByLabel_("Quote Email Approved", true),
    quoteEmailSent: configFlagByLabel_("Quote Email Sent", false),
    quoteEmailReceived: configFlagByLabel_("Quote Email Received", false),
    quoteEmailDespatched: configFlagByLabel_("Quote Email Despatched", false),
    quoteEmailFinalReceived: configFlagByLabel_("Quote Email Final Received", false),
  };

  console.log(
    "Found " +
    result.users.length +
    " users and " +
    result.brands.length +
    " brands.",
  );
  return result;
}

/**
 * Finds all relevant recipients for a requirement email
 * @param {string} siteName - The site selected in the dropdown
 * @param {string} categoryName - The category of the items
 * @return {object} { emails: "a@b.com, c@d.com", suffix: "XYZ" }
 */
/**
 * GETS ROUTING DATA (EMAILS + SUFFIX)
 */
/**
 * Helper to show the user who will receive the email BEFORE sending
 */


/**
 * UPDATED ROUTING: Case-insensitive and Trimmed
 */
function markQuoteDeleted(orderId, supplier, category) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Quotes");
    if (!sheet) return { success: false, message: "Quotes sheet not found" };
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, message: "No data" };

    const headers = data[0].map((h) => String(h || "").trim());
    const idxOrder = headers.indexOf("Ref ID");
    const idxSupplier = headers.indexOf("Proveedor");
    const idxCategory = headers.indexOf("Category");
    const idxStatus = headers.indexOf("Estado");

    if (
      idxOrder === -1 ||
      idxSupplier === -1 ||
      idxCategory === -1 ||
      idxStatus === -1
    ) {
      return { success: false, message: "Missing headers" };
    }

    let changed = 0;
    for (let r = 1; r < data.length; r++) {
      if (
        String(data[r][idxOrder]).trim() === String(orderId).trim() &&
        String(data[r][idxSupplier]).trim() === String(supplier).trim() &&
        String(data[r][idxCategory]).trim() === String(category).trim()
      ) {
        sheet.getRange(r + 1, idxStatus + 1).setValue("Deleted");
        changed++;
      }
    }
    return { success: true, changed: changed };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}


// Helper to find matching group row by orig or current geo/pn
function findMatchingRowIndex(item) {
  for (let i = 0; i < groupRows.length; i++) {
    const sheetRow = groupRows[i];

    // Skip if we already updated this row in this execution
    if (usedRowIndexes.has(sheetRow.rowIndex)) continue;

    // Get the Geo Code from the sheet
    const sheetGeo = String(sheetRow.values[idx.geo] || "").trim().toLowerCase();

    // Get the Original Geo (what it was before editing) and Current Geo from the item
    const itemOrigGeo = String(item.origGeo || "").trim().toLowerCase();
    const itemCurrGeo = String(item.geo || "").trim().toLowerCase();

    // Match only on Geo Code
    // We check against itemOrigGeo in case the user is renaming the Geo Code itself
    if (sheetGeo === itemOrigGeo || sheetGeo === itemCurrGeo) {
      return sheetRow.rowIndex;
    }
  }
  return -1;
}

// Ensure a sheet contains the specified header names (appends missing headers at the end)
function ensureSheetHasHeaders_(sheet, requiredHeaders) {
  if (!sheet || !Array.isArray(requiredHeaders) || requiredHeaders.length === 0) return;
  const data = sheet.getDataRange().getValues();
  const headers = data && data[0] ? data[0].map(h => String(h || '').trim()) : [];
  const toAdd = [];
  requiredHeaders.forEach(h => {
    const exists = headers.some(existing => String(existing || '').trim().toLowerCase() === String(h || '').trim().toLowerCase());
    if (!exists) toAdd.push(h);
  });
  if (toAdd.length === 0) return;
  // Append missing headers at the end of header row
  const newHeaders = headers.concat(toAdd);
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
}

function getQuoteChangeFieldLabel_(fieldName) {
  const labels = {
    status: 'Status',
    qty: 'Quantity',
    price: 'Unit Price',
    total: 'Line Total',
    pn: 'P/N',
    geo: 'Geo Code',
  };
  return labels[String(fieldName || '').toLowerCase()] || fieldName;
}

function formatQuoteChangeValue_(fieldName, value) {
  const key = String(fieldName || '').toLowerCase();
  if (value === null || value === undefined || value === '') return '-';

  if (key === 'price' || key === 'total') {
    const num = Number(value);
    if (!isNaN(num)) {
      return '$ ' + num.toLocaleString('es-CL');
    }
  }

  if (key === 'qty') {
    const numQty = Number(value);
    if (!isNaN(numQty)) {
      return String(numQty);
    }
  }

  return String(value);
}

function buildQuoteChangeSummaryHtml_(changedItems) {
  if (!Array.isArray(changedItems) || changedItems.length === 0) {
    return '<p style="margin: 0; color: #666;">No detailed changes were detected.</p>';
  }

  let html = '';

  changedItems.forEach(function (change) {
    const diffs = change && change.diffs ? change.diffs : {};
    const geoCode = escapeHtml_(change && change.origGeo ? change.origGeo : 'N/A');

    html += '<div style="margin-top: 14px;">';
    html += '<div style="font-weight: 600; margin-bottom: 6px; color: #333;">Item: ' + geoCode + '</div>';
    html += '<table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 12px;">';
    html += '<thead><tr>';
    html += '<th style="border:1px solid #ddd; background:#f7f7f7; padding:6px; text-align:left;">Field</th>';
    html += '<th style="border:1px solid #ddd; background:#f7f7f7; padding:6px; text-align:left;">Before</th>';
    html += '<th style="border:1px solid #ddd; background:#f7f7f7; padding:6px; text-align:left;">After</th>';
    html += '</tr></thead><tbody>';

    Object.keys(diffs).forEach(function (field) {
      const diff = diffs[field] || {};
      const label = escapeHtml_(getQuoteChangeFieldLabel_(field));
      const fromVal = escapeHtml_(formatQuoteChangeValue_(field, diff.from));
      const toVal = escapeHtml_(formatQuoteChangeValue_(field, diff.to));

      html += '<tr>';
      html += '<td style="border:1px solid #ddd; padding:6px;">' + label + '</td>';
      html += '<td style="border:1px solid #ddd; padding:6px; color:#a94442;">' + fromVal + '</td>';
      html += '<td style="border:1px solid #ddd; padding:6px; color:#2e7d32;">' + toVal + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
  });

  return html;
}





/**
 * ROUTING HELPERS: Normalize to lowercase + accent-insensitive for matching.
 */
function normalizeUserMatch_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Resolves routing for a SubArea from the Validation sheet:
 * - Col V = SubArea, Col W = Emails SubArea.
 * SubAreas belong to the "Workshop" site only. The SubArea name is matched by
 * name regardless of the row's Col A; the Workshop site suffix is still read
 * from Col A + Col C. Returns null when the site is not "Workshop", the
 * SubArea is unknown, or it has no emails, so the caller can fall back to
 * category-based routing.
 */
function resolveSubAreaRouting_(siteName, subAreaName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const valSheet = ss.getSheetByName("Validation");
  if (!valSheet) return null;

  const sName = String(siteName || "").trim();
  const saName = String(subAreaName || "").trim();
  if (!sName || !saName) return null;

  // SubAreas exist only for the "Workshop" site.
  if (normalizeUserMatch_(sName) !== normalizeUserMatch_("workshop")) return null;

  const valData = valSheet.getDataRange().getValues();
  let suffix = "REQ";

  for (let i = 1; i < valData.length; i++) {
    const rowSite = String(valData[i][0] || "").trim();
    const rowSa = String(valData[i][21] || "").trim();

    // Capture the Workshop site suffix (first matching site row wins)
    if (normalizeUserMatch_(rowSite) === normalizeUserMatch_("workshop") && valData[i][2]) {
      suffix = String(valData[i][2]).trim();
    }

    // Match the SubArea by name (Col V); it belongs to the Workshop site
    // even if the row's Col A is empty or holds something else.
    if (normalizeUserMatch_(rowSa) === normalizeUserMatch_(saName)) {
      const emailsRaw = String(valData[i][22] || "").trim();
      if (!emailsRaw) return null; // matched but no emails -> fall back

      const emails = emailsRaw
        .split(/[,;]+/)
        .map(function (t) { return String(t).trim(); })
        .filter(Boolean)
        .filter(function (e, ix, arr) { return arr.indexOf(e) === ix; })
        .join(", ");

      if (emails) {
        return {
          emails: emails,
          suffix: suffix,
          subArea: saName,
          matchedUsers: [],
        };
      }
      return null;
    }
  }

  return null;
}

/**
 * Builds the SubArea folio for Workshop requirements (e.g. "MP-0000156"):
 * - Validation sheet Col V = SubArea, Col X = Suffix (e.g. "MP-").
 * - Folio = suffix (normalized to end with "-") + 7-digit padded number.
 * Returns { folio, suffix } or null when the site is not "Workshop", the
 * SubArea is unknown, the number is invalid, or no suffix is configured.
 */
function buildSubAreaFolio_(siteName, subAreaName, number) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const valSheet = ss.getSheetByName("Validation");
  if (!valSheet) return null;

  const sName = String(siteName || "").trim();
  const saName = String(subAreaName || "").trim();
  const numRaw = String(number || "").trim();
  if (!sName || !saName || !numRaw) return null;

  // SubAreas exist only for the "Workshop" site.
  if (normalizeUserMatch_(sName) !== normalizeUserMatch_("workshop")) return null;

  const numInt = Number(numRaw);
  if (!Number.isInteger(numInt) || numInt <= 0 || numInt > 9999999) return null;

  const valData = valSheet.getDataRange().getValues();
  for (let i = 1; i < valData.length; i++) {
    const rowSa = String(valData[i][21] || "").trim();
    if (normalizeUserMatch_(rowSa) !== normalizeUserMatch_(saName)) continue;

    const rawSuffix = String(valData[i][23] || "").trim();
    if (!rawSuffix) return null; // matched but no suffix configured
    const suffix = rawSuffix.endsWith("-") ? rawSuffix : rawSuffix + "-";
    return {
      folio: suffix + String(numInt).padStart(7, "0"),
      suffix: suffix,
    };
  }
  return null;
}

/**
 * Returns true when the given SubArea folio already exists in the Ordenes
 * "SubArea No" column (duplicate protection for manually entered numbers).
 */
function subAreaFolioExists_(folio) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  if (!sheet || !folio) return false;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;

  const headers = data[0];
  let folioIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim() === "SubArea No") {
      folioIdx = i;
      break;
    }
  }
  if (folioIdx === -1) return false;

  const needle = String(folio).trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][folioIdx] || "").trim().toUpperCase() === needle) return true;
  }
  return false;
}

/**
 * Compacts the sanitized HTML the user typed at creation time
 * ("Additional Message (Body)" in the CreateReq preview) into the value we
 * persist in the Ordenes "Notes" column, so it can be shown as notes in
 * View/Edit Requirement.
 * - keeps the same basic formatting allowlist used by the email body
 * - strips the outer wrapper added by the client (formatBodyForEmail)
 * - returns "" when there is nothing meaningful to store
 */
function cleanReqNotes_(html) {
  try {
    let s = String(html == null ? "" : html);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    s = s.replace(/javascript\s*:/gi, "");
    // Remove tags outside the allowlist but keep their inner text
    s = s.replace(/<\/?([a-zA-Z0-9]+)(\s[^<>]*)?>/g, function (m, tag) {
      const t = String(tag).toLowerCase();
      if (["b", "strong", "i", "em", "u", "br", "p", "div", "ul", "ol", "li", "span", "font"].indexOf(t) !== -1) return m;
      return "";
    });
    // Drop the client wrapper <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    s = s.replace(/^\s*<div[^>]*style="[^"]*font-family:\s*Arial[^"]*"[^>]*>/i, "").replace(/<\/div>\s*$/i, "");
    // Collapse empty paragraphs / trailing breaks
    s = s.replace(/(<p[^>]*>\s*(&nbsp;|\s)*<\/p>\s*)+/gi, "").replace(/<br\s*\/?>\s*$/i, "");
    s = s.replace(/(&nbsp;)+/gi, " ").replace(/[ \t]+\n/g, "\n").trim();
    // The internal placeholder used when the preview had no real notes
    const plain = s.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
    if (!plain || plain.toLowerCase() === "internal requirement generated") return "";
    if (!s || /^<br\s*\/?>$/i.test(s)) return "";
    return s;
  } catch (e) {
    console.warn("cleanReqNotes_ failed: " + e.toString());
    return String(html == null ? "" : html).slice(0, 2000);
  }
}

/**
 * Header-aware lookup of a column on the Ordenes sheet. Creates the column at
 * the end of the table when it does not exist yet (same pattern as QuoteMgmtGS).
 * @param {Sheet} sheet Ordenes sheet instance
 * @param {string} headerName Exact header text to find/create (e.g. "Notes")
 * @return {number} 0-based column index, or -1 when unavailable
 */
function ensureOrdenesColumn_(sheet, headerName) {
  try {
    const name = String(headerName || "").trim();
    if (!name) return -1;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = sheet || ss.getSheetByName("Ordenes");
    if (!sh) return -1;

    const lastCol = Math.max(sh.getLastColumn(), 1);
    const headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const needle = name.toLowerCase();
    for (let i = 0; i < headerRow.length; i++) {
      if (String(headerRow[i] || "").trim().toLowerCase() === needle) return i;
    }

    // Not found -> create it right after the last used column
    sh.insertColumnAfter(lastCol);
    sh.getRange(1, lastCol + 1).setValue(name);
    console.log("Added new '" + name + "' column to Ordenes at position " + (lastCol + 1));
    return lastCol; // 0-based index of the newly created column
  } catch (e) {
    console.warn("Could not resolve Ordenes '" + headerName + "' column: " + e.toString());
    return -1;
  }
}

/**
 * Header-aware lookup of the Ordenes "Notes" column (holds the notes/body the
 * user typed when creating the requirement).
 * @param {Sheet} [sheet] Optional Ordenes sheet instance
 * @return {number} 0-based column index, or -1 when unavailable
 */
function getOrdenesNotesColumn_(sheet) {
  return ensureOrdenesColumn_(sheet, "Notes");
}

/**
 * Header-aware lookup of the Ordenes "Item Notes" column (per item, per
 * requirement notes typed in the Create Req cart for Workshop sites).
 * @param {Sheet} [sheet] Optional Ordenes sheet instance
 * @return {number} 0-based column index, or -1 when unavailable
 */
function getOrdenesItemNotesColumn_(sheet) {
  return ensureOrdenesColumn_(sheet, "Item Notes");
}

/**
 * Header-aware lookup of the Ordenes "Supplier Notes" column (per item, per
 * requirement notes typed in the Create Req cart). These are the notes that are
 * printed in the supplier RFQ (quote request) email — never in the internal
 * requirement email/PDF, which only carries "Item Notes".
 * @param {Sheet} [sheet] Optional Ordenes sheet instance
 * @return {number} 0-based column index, or -1 when unavailable
 */
function getOrdenesSupplierNotesColumn_(sheet) {
  return ensureOrdenesColumn_(sheet, "Supplier Notes");
}

/**
 * Header-aware lookup of the Ordenes "Item Images" column (per-item photos
 * attached in the Create Req cart).
 *
 * STORAGE FORMAT: ONE CELL PER REQUIREMENT ROW holding the Drive URLs of every
 * image attached to that line item, COMMA SEPARATED ("url1, url2"). A Drive file
 * URL never contains a comma, so the cell stays unambiguously splittable while
 * remaining human-readable straight from the sheet (no formula, no JSON blob).
 * JSON was the alternative if file names ever need to be paired with the URLs.
 * @param {Sheet} [sheet] Optional Ordenes sheet instance
 * @return {number} 0-based column index, or -1 when unavailable
 */
function getOrdenesItemImagesColumn_(sheet) {
  return ensureOrdenesColumn_(sheet, "Item Images");
}

/**
 * Serializes the images attached to one cart/requirement item into the single
 * "Item Images" cell value. Accepts either the array of {url,name} objects kept
 * in the cart or an already-serialized string (re-sent drafts).
 * @param {*} images Item images (array of objects/strings, or a string)
 * @return {string} comma-separated Drive URLs, or "" when there are none
 */
function serializeItemImages_(images) {
  try {
    if (!images) return "";
    var list = images;
    if (typeof images === "string") {
      list = images.split(/\s*,\s*/);
    }
    if (!Array.isArray(list)) return "";
    var urls = [];
    list.forEach(function (im) {
      if (!im) return;
      var u = (typeof im === "string") ? im : String(im.url || "");
      u = String(u).trim();
      // Keep only real http(s) URLs; anything else (base64 blobs, "data:...") is
      // rejected up front rather than bloating the sheet cell.
      if (/^https?:\/\//i.test(u) && urls.indexOf(u) === -1) urls.push(u);
    });
    return urls.join(", ");
  } catch (e) {
    console.warn("serializeItemImages_ failed: " + e.toString());
    return "";
  }
}

/**
 * Extracts the Drive file ID from a stored "Item Images" URL. Handles the
 * file.getUrl() shape (".../file/d/FILEID/view..."), open?id= links, and the
 * thumbnail endpoint itself. Returns "" when no ID can be found.
 * @param {string} url Stored image URL
 * @return {string} Drive file ID, or ""
 */
function reqDriveFileId_(url) {
  try {
    var u = String(url || "").trim();
    if (!u) return "";
    var m = u.match(/\/file\/d\/([-\w]{10,})/i);
    if (m && m[1]) return m[1];
    m = u.match(/[?&](?:id|ids)=([-\w]{10,})/i);
    if (m && m[1]) return m[1];
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * Normalizes the images attached to one requirement item into an array of
 * Drive URLs. Accepts the cart shape (array of {url,name} or strings) and the
 * serialized "Item Images" cell (comma-separated string). Only http(s) URLs
 * survive; anything else (base64 blobs, "data:...") is dropped.
 * @param {*} item Requirement item, or the raw images value itself
 * @return {Array<string>} deduplicated Drive URLs, possibly empty
 */
function reqItemImageUrls_(item) {
  try {
    var raw = (item && typeof item === "object" && !Array.isArray(item) && item.images !== undefined)
      ? item.images
      : item;
    if (raw == null) return [];
    var list = raw;
    if (typeof raw === "string") list = raw.split(/\s*,\s*/);
    if (!Array.isArray(list)) return [];
    var urls = [];
    list.forEach(function (im) {
      if (!im) return;
      var u = (typeof im === "string") ? im : String(im.url || "");
      u = String(u).trim();
      if (/^https?:\/\//i.test(u) && urls.indexOf(u) === -1) urls.push(u);
    });
    return urls;
  } catch (e) {
    return [];
  }
}

/**
 * Builds the photo-links fragment appended under Item Notes in the requirement
 * PDF. External Drive images do not reliably rasterize through the server-side
 * HTML->PDF conversion, so the PDF shows small numbered "Photo N" links (one
 * per attached image) instead of inline thumbnails — the actual photos render
 * inline in the requirement email, and both the email and this PDF link back
 * to the full Drive file. Returns "" when the line has no photos so imageless
 * PDFs look exactly as before. Callers pass the raw requirement item
 * ({images} array) or an already-serialized comma-separated URL string.
 * @param {*} item Requirement item (or the raw images value itself)
 * @return {string} HTML fragment, or ""
 */
function reqPdfImagesLinks_(item) {
  try {
    var urls = reqItemImageUrls_(item);
    if (!urls.length) return "";
    var links = urls.map(function (u, i) {
      return '<a href="' + u + '" target="_blank" style="color:#0d6efd;">Photo ' + (i + 1) + '</a>';
    }).join(" &middot; ");
    return '<br><span style="font-size:9px;color:#666;">Photos: ' + links + '</span>';
  } catch (e) {
    return "";
  }
}

/**
 * SHARED EMAIL HELPER: thumbnail cell for a requirement item's photos.
 * Renders one small linked thumbnail per attached Drive image (or the plain
 * "&mdash;" placeholder when the line has none) so any email table can show the
 * requester's attachments with identical markup. Uses the Drive thumbnail
 * endpoint because the stored file.getUrl() view page is HTML, not image bytes.
 * @param {*} item Requirement item ({images}) or the raw images value itself
 * @param {number} [px] Thumbnail size in px (default 64)
 * @return {string} HTML fragment (never null)
 */
function reqImagesCellHtml_(item, px) {
  try {
    var size = Number(px) || 64;
    var urls = reqItemImageUrls_(item);
    if (!urls.length) return "&mdash;";
    var thumbs = urls.map(function (u) {
      var id = reqDriveFileId_(u);
      var thumb = id ? ("https://drive.google.com/thumbnail?id=" + id + "&sz=w" + (size * 2)) : u;
      var fallback = id
        ? " onerror=\"if(this.dataset.fb){this.style.visibility='hidden';}else{this.dataset.fb='1';this.src='https://drive.google.com/uc?export=view&id=" + id + "';}\""
        : "";
      return '<a href="' + u + '" target="_blank" rel="noopener">' +
        '<img src="' + thumb + '" alt="item image" loading="lazy"' + fallback + ' ' +
        'style="width:' + size + 'px;height:' + size + 'px;object-fit:cover;border:1px solid #ddd;border-radius:4px;margin:1px;vertical-align:middle;">' +
        '</a>';
    }).join("");
    return '<span style="white-space:nowrap;">' + thumbs + '</span>';
  } catch (e) {
    console.warn("reqImagesCellHtml_ failed: " + e.toString());
    return "&mdash;";
  }
}

/**
 * Reads the stored per-item notes for one requirement.
 * Keyed by Geo Code because item notes are unique to each requirement row.
 * @param {string} orderId
 * @return {Object} { GEO: notes }
 */
function getItemNotesByOrder_(orderId) {
  const map = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    if (!sheet) return map;

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return map;

    const headers = data[0];
    let orderIdx = -1;
    let geoIdx = -1;
    let notesIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || "").trim().toLowerCase();
      if (h === "order") orderIdx = i;
      if (h === "geo code" || h === "geo") geoIdx = i;
      if (h === "item notes") notesIdx = i;
    }
    if (orderIdx === -1 || geoIdx === -1 || notesIdx === -1) return map;

    const needle = String(orderId || "").trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][orderIdx] || "").trim() !== needle) continue;
      const geo = String(data[i][geoIdx] || "").trim();
      if (geo) map[geo] = String(data[i][notesIdx] || "");
    }
  } catch (e) {
    console.warn("getItemNotesByOrder_ failed for " + orderId + ": " + e.toString());
  }
  return map;
}

/**
 * Reads the stored per-item photos ("Item Images" cell) for one requirement.
 * Keyed by Geo Code, mirroring getItemNotesByOrder_. Used when a requirement is
 * re-saved (View/Edit) so the regenerated PDF and the update email keep the
 * photo links even though the edit modal never sends the images back.
 * @param {string} orderId
 * @return {Object} { GEO: comma-separated Drive URLs }
 */
function getItemImagesByOrder_(orderId) {
  const map = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    if (!sheet) return map;

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return map;

    const headers = data[0];
    let orderIdx = -1;
    let geoIdx = -1;
    let imagesIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || "").trim().toLowerCase();
      if (h === "order") orderIdx = i;
      if (h === "geo code" || h === "geo") geoIdx = i;
      if (h === "item images") imagesIdx = i;
    }
    if (orderIdx === -1 || geoIdx === -1 || imagesIdx === -1) return map;

    const needle = String(orderId || "").trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][orderIdx] || "").trim() !== needle) continue;
      const geo = String(data[i][geoIdx] || "").trim();
      const cell = String(data[i][imagesIdx] || "").trim();
      if (geo && cell) map[geo] = cell;
    }
  } catch (e) {
    console.warn("getItemImagesByOrder_ failed for " + orderId + ": " + e.toString());
  }
  return map;
}

/**
 * Persists the supplier notes the user edited in the RFQ items table onto the
 * Ordenes "Supplier Notes" column (one cell per requirement row = Req ID + GEO).
 * Called on SEND (from sendFinalRFQ) so an edit only lands once the RFQ actually
 * goes out. Only items carrying an explicit `supplierNotes` value are written -
 * the RFQ items table sets that field ONLY when the user edited the line, so
 * untouched requirements keep their stored notes and the column is not created
 * for requirements that never use it.
 * @param {Object} details RFQ payload (items / deficitItems + orderId)
 * @param {Array<string>} orderIds source requirement IDs (consolidation aware)
 */
function persistRfqSupplierNotes_(details, orderIds) {
  const srcItems = (Array.isArray(details && details.items) && details.items.length)
    ? details.items
    : (Array.isArray(details && details.deficitItems) ? details.deficitItems : []);

  const edits = {};
  srcItems.forEach(function (it) {
    if (!it || it.supplierNotes === undefined) return; // not edited -> leave stored value
    const geo = String(it.geo || "").trim();
    if (!geo) return;
    edits[geo.toUpperCase()] = cleanReqNotes_(it.supplierNotes);
  });
  if (Object.keys(edits).length === 0) return;

  const refs = (Array.isArray(orderIds) && orderIds.length)
    ? orderIds.map(function (r) { return String(r || "").trim(); }).filter(Boolean)
    : splitCombinedRef_(String((details && details.orderId) || ""));
  if (!refs.length) return;
  const refSet = {};
  refs.forEach(function (r) { refSet[r] = true; });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  if (!sheet) return;

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let orderIdx = -1;
  let geoIdx = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || "").trim().toLowerCase();
    if (h === "order") orderIdx = i;
    if (h === "geo code" || h === "geo") geoIdx = i;
  }
  if (orderIdx === -1 || geoIdx === -1) return;

  // Creates the "Supplier Notes" column on first use (same helper the Create Req
  // flow and the Approve Requirement screen use).
  const notesIdx = getOrdenesSupplierNotesColumn_(sheet);
  if (notesIdx < 0) return;

  const data = sheet.getDataRange().getValues();
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const order = String(data[i][orderIdx] || "").trim();
    if (!refSet[order]) continue;
    const geo = String(data[i][geoIdx] || "").trim().toUpperCase();
    if (!(geo in edits)) continue;
    const current = String(data[i][notesIdx] == null ? "" : data[i][notesIdx]);
    if (current === edits[geo]) continue; // no-op, avoid needless writes
    sheet.getRange(i + 1, notesIdx + 1).setValue(edits[geo]);
    updated++;
  }
  if (updated) {
    console.log("persistRfqSupplierNotes_: updated " + updated + " Ordenes row(s) for ref(s) " + refs.join("+"));
  }
}

/**
 * Reads the stored SubArea name + folio ("SubArea" / "SubArea No") for a
 * requirement Order ID. Used to keep both visible on PDFs regenerated after
 * edits.
 */
function getSubAreaColsByOrderId_(orderId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  if (!sheet) return { subArea: "", subAreaNo: "" };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { subArea: "", subAreaNo: "" };

  const headers = data[0];
  let subAreaIdx = -1;
  let folioIdx = -1;
  let orderIdx = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").trim();
    if (h === "SubArea") subAreaIdx = i;
    if (h === "SubArea No") folioIdx = i;
    if (h === "Order") orderIdx = i;
  }
  if (subAreaIdx === -1 && folioIdx === -1) return { subArea: "", subAreaNo: "" };

  const needle = String(orderId || "").trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][orderIdx] || "").trim() === needle) {
      return {
        subArea: subAreaIdx >= 0 ? String(data[i][subAreaIdx] || "").trim() : "",
        subAreaNo: folioIdx >= 0 ? String(data[i][folioIdx] || "").trim() : "",
      };
    }
  }
  return { subArea: "", subAreaNo: "" };
}

function getRequirementRouting(siteName, categoryName, subAreaName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sName = String(siteName || "").trim();

  // OPTIONAL SubArea routing override (Validation sheet Col V = SubArea,
  // Col W = Emails SubArea). When a SubArea is provided (e.g. for the
  // "Workshop" site) its emails REPLACE the category-based recipients
  // computed from the Users sheet below. Falls back to category routing if
  // the SubArea is unknown or has no emails configured.
  const subAreaRequested = String(subAreaName || "").trim();
  if (subAreaRequested) {
    const subAreaRouting = resolveSubAreaRouting_(sName, subAreaRequested);
    if (subAreaRouting) {
      return subAreaRouting;
    }
    console.warn(
      '[getRequirementRouting] SubArea "' + subAreaRequested + '" for site "' + sName +
      '" not found or has no emails; falling back to category routing.'
    );
  }

  // 1. Suffix Lookup (still uses Site to identify the project code)
  const valSheet = ss.getSheetByName("Validation");
  let suffix = "REQ";
  if (valSheet) {
    const valData = valSheet.getDataRange().getValues();
    for (let i = 1; i < valData.length; i++) {
      if (normalizeUserMatch_(valData[i][0]) === normalizeUserMatch_(sName)) {
        suffix = valData[i][2] || "REQ";
        break;
      }
    }
  }

  // 2. Email Lookup (Users sheet) - header aware so we never read the wrong
  //    column. Canonical layout (AdminVal):
  //    ID, PIN, Name, Email, Position, Site, Role, Active
  const userSheet = ss.getSheetByName("Users");
  let emails = [];

  if (userSheet) {
    const userData = userSheet.getDataRange().getValues();
    const headersUser = userData.length > 0
      ? userData[0].map(function (h) { return normalizeUserMatch_(h); })
      : [];

    const findUserCol = function (names, fallbackIdx) {
      const wanted = Array.isArray(names) ? names : [names];
      for (let ix = 0; ix < wanted.length; ix++) {
        const hit = headersUser.indexOf(wanted[ix]);
        if (hit !== -1) return hit;
      }
      return fallbackIdx;
    };

    // 🔒 FIX: "Position" is the user's category — never assume a fixed column.
    const colEmail     = findUserCol(["email"], 3);
    const colPosition  = findUserCol(["position", "category"], 4);
    const colRole      = findUserCol(["role"], 6);
    const colActive    = findUserCol(["active", "activo"], 7);

    // Accepted categories: may be empty (General), a single category, or a
    // comma/semicolon-separated list collected from the actual quote items.
    const cTokens = String(categoryName || "")
      .split(/[,;]+/)
      .map(function (t) { return normalizeUserMatch_(t); })
      .filter(Boolean);

    const GENERAL_CATEGORIES = [
      "general", "generica", "generico", "sin categoria",
      "sin cat", "uncategorized", "varios",
    ];
    const isGeneralRequest = cTokens.length === 0 ||
      cTokens.every(function (t) { return GENERAL_CATEGORIES.indexOf(t) !== -1; });
    // In General mode only explicit General-ish categories are accepted; in a
    // specific-category RFQ the user Position must match one of the accepted cats.
    const acceptedCats = isGeneralRequest ? GENERAL_CATEGORIES : cTokens;

    for (let j = 1; j < userData.length; j++) {
      const uEmail   = String(userData[j][colEmail] || "").trim();
      const uCat     = normalizeUserMatch_(userData[j][colPosition]);
      const uRole    = normalizeUserMatch_(userData[j][colRole]);
      const uActive  = normalizeUserMatch_(userData[j][colActive]);

      // 🔒 FIX: users without a Position (category) are never added to the CC list.
      if (!uCat) continue;

      const categoryMatches = acceptedCats.indexOf(uCat) !== -1;
      const roleMatches =
        uRole === "office" || uRole === "admin" || uRole === "manager";
      const activeMatches =
        uActive === "1" || uActive === "true" || uActive === "yes";

      if (categoryMatches && roleMatches && activeMatches) {
        if (uEmail && emails.indexOf(uEmail) === -1) {
          emails.push(uEmail);
        }
      }
    }
  }

  return {
    emails: emails.length > 0 ? emails.join(", ") : "procurement@yourcompany.com",
    suffix: suffix,
    matchedUsers: emails,
  };
}




// ============================================
// EMAIL SUGGESTIONS (for autocomplete in To/CC chip fields)
// Combines: People sheet (company-domain filtered) + Suppliers + Microsoft Graph directory
// ============================================

function getCompanyEmailDomains() {
  return ['recondrilling.com'];
}

function isCompanyEmail(email) {
  if (!email) return false;
  const domains = getCompanyEmailDomains();
  const lower = String(email).toLowerCase().trim();
  return domains.some(function(d) { return lower.endsWith('@' + d.toLowerCase()); });
}

// ============================================
// EMAIL SUGGESTIONS (continued)
// ============================================

function searchGraphDirectory(term) {
  if (!term || String(term).trim().length < 2) return [];
  const t = String(term).trim();

  try {
    const creds = getAzureGraphCredentials_();
    const accessToken = getMicrosoftGraphToken(creds);

    // Search by displayName startswith
    const nameEndpoint =
      'https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,\'' + t.replace(/'/g, "\\'") + "')" +
      '&$select=displayName,mail,mailNickname&$top=10&$orderby=displayName';

    const nameOptions = {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    };

    const nameResp = UrlFetchApp.fetch(nameEndpoint, nameOptions);
    const nameCode = nameResp.getResponseCode();
    const nameData = JSON.parse(nameResp.getContentText());

    const results = [];

    if (nameCode === 200 && nameData.value) {
      nameData.value.forEach(function(u) {
        const mail = String(u.mail || u.mailNickname || '').toLowerCase().trim();
        if (mail && isCompanyEmail(mail)) {
          results.push({
            displayName: String(u.displayName || '').trim(),
            email: mail
          });
        }
      });
    }

    // Also try exact mail match
    if (t.indexOf('@') !== -1 && results.length === 0) {
      const mailEndpoint =
        'https://graph.microsoft.com/v1.0/users?$filter=mail eq \'' + t.replace(/'/g, "\\'") + "'" +
        '&$select=displayName,mail&$top=5';

      const mailOptions = {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Accept': 'application/json'
        },
        muteHttpExceptions: true
      };

      const mailResp = UrlFetchApp.fetch(mailEndpoint, mailOptions);
      const mailCode = mailResp.getResponseCode();
      const mailData = JSON.parse(mailResp.getContentText());

      if (mailCode === 200 && mailData.value) {
        mailData.value.forEach(function(u) {
          const mailAddr = String(u.mail || '').toLowerCase().trim();
          if (mailAddr && isCompanyEmail(mailAddr)) {
            results.push({
              displayName: String(u.displayName || '').trim(),
              email: mailAddr
            });
          }
        });
      }
    }

    return results.slice(0, 10);
  } catch (e) {
    console.warn('Graph directory search failed:', e.toString());
    return [];
  }
}

// ============================================
// END EMAIL SUGGESTIONS
// ============================================

function getEmailSuggestions(searchTerm) {
  if (!searchTerm || String(searchTerm).trim().length === 0) return [];

  const term = String(searchTerm).trim().toLowerCase();
  const results = [];
  const seen = {};

  const addResult = function(displayName, email, source) {
    if (!email || !displayName) return;
    const key = email.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(seen, key)) return;
    seen[key] = true;
    results.push({
      label: displayName + ' <' + email + '>',
      value: email,
      source: source
    });
  };

  // 1. People sheet (company domain emails only)
  try {
    const people = getPeople() || [];
    people.forEach(function(p) {
      if (!p || !p.email) return;
      const email = String(p.email).toLowerCase().trim();
      if (!isCompanyEmail(email)) return;
      const name = String(p.name || '').trim();
      if (!name) return;
      if (name.toLowerCase().indexOf(term) !== -1 || email.indexOf(term) !== -1) {
        addResult(name, email, 'people');
      }
    });
  } catch (e) {
    console.warn('People sheet suggestion lookup failed:', e.toString());
  }

  // 2. Suppliers (from Validation sheet directly)
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const valSheet = ss.getSheetByName('Validation');
    let suppliers = [];
    if (valSheet) {
      const valData = valSheet.getDataRange().getValues();
      for (let i = 1; i < valData.length; i++) {
        if (valData[i][15]) {
          suppliers.push({ name: String(valData[i][15] || '').trim(), email: String(valData[i][16] || '').trim() });
        }
      }
    }
    suppliers.forEach(function(s) {
      if (!s || !s.email) return;
      const email = String(s.email).toLowerCase().trim();
      if (!email) return;
      const name = String(s.name || '').trim();
      if (!name) return;
      if (name.toLowerCase().indexOf(term) !== -1 || email.indexOf(term) !== -1) {
        addResult(name, email, 'supplier');
      }
    });
  } catch (e) {
    console.warn('Supplier suggestion lookup failed:', e.toString());
  }

  // 3. Microsoft Graph directory (company emails only)
  try {
    const graphResults = searchGraphDirectory(searchTerm);
    graphResults.forEach(function(u) {
      addResult(u.displayName || u.email, u.email, 'graph');
    });
  } catch (e) {
    console.warn('Graph suggestion lookup failed:', e.toString());
  }

  // Sort: Graph first (canonical names), then People, then Suppliers
  const sourceOrder = { graph: 1, people: 2, supplier: 3 };
  results.sort(function(a, b) {
    const sa = sourceOrder[a.source] || 99;
    const sb = sourceOrder[b.source] || 99;
    if (sa !== sb) return sa - sb;
    return (a.label || '').localeCompare(b.label || '');
  });

  return results.slice(0, 10);
}

function getCompanyLogo() {
  try {
    const logoFileId = "1DqBJCUuFzontoeRt8Lh6yhLYifo60uRC";
    const file = DriveApp.getFileById(logoFileId);
    const blob = file.getBlob();

    // Convert to Base64 so it's embedded directly in the HTML
    const base64String = Utilities.base64Encode(blob.getBytes());
    return "data:" + blob.getContentType() + ";base64," + base64String;
  } catch (e) {
    console.error("Logo Error: " + e.message);
    return null;
  }
}



/**
 * GLOBAL helper for server-side stage normalization.
 */
function normalizeStage(s) {
  if (!s) return "Created";
  const x = String(s).toLowerCase();
  // "Not Quoted" must be caught BEFORE the bare 'quot' check (see the client
  // twins): the supplier-didn't-quote state must never read as "Quoted".
  if ((x.includes("not") && x.includes("quot")) || x.includes("no cotiz") || x.includes("sin cotiz")) return "Not Quoted";
  if (x.includes("final") || x.includes("received") || x.includes("recib")) return "Final Received";
  if (x.includes("po") || x.includes("orden") || x.includes("ordered") || x.includes("comprad")) return "PO Created";
  if (x.includes("approv") || x.includes("aprob")) return "Approved";
  if (x.includes("quot") || x.includes("cotiz")) return "Quoted";
  if (x.includes("rfq") || x.includes("sent")) return "RFQ Issued";
  if (x.includes("pend")) return "Pending";
  return "Created";
}

/**
 * Universal Traffic Controller for all ERP Emails
 */
/**
 * Universal Dispatcher for all ERP emails.
 * Handles Quota Management, Service Switching, and Logging.
 */
// Resolves mail.attachments (array of { url } or { name, contentBase64, mimeType })
// into Blobs for the Graph/Google/Brevo lanes. Never throws: a broken entry is
// logged and skipped so a bad link cannot block the email itself.
//
// Failures are no longer only logged. They are also recorded on
// mail.__attachmentFailures (array of { label, reason }) so the caller can
// tell the user that an attachment was dropped. Previously a missing
// quotation document or CSV produced NO error and NO visible sign — the email
// simply arrived without it. The return value is unchanged (an array of
// blobs), so all existing lanes keep working untouched.
function resolveMailAttachments_(mail) {
  const list = mail && Array.isArray(mail.attachments) ? mail.attachments : [];
  const out = [];
  const failures = [];
  const record = function (att, i, reason) {
    const label = String((att && (att.name || att.fileName)) || ("attachment_" + (i + 1)));
    console.warn("mail.attachments[" + i + "] (" + label + "): " + reason);
    failures.push({ label: label, reason: reason });
  };
  list.forEach(function (att, i) {
    try {
      if (!att) { record(att, i, "descriptor vacío"); return; }
      if (att.url) {
        const fileId = getDriveFileIdFromUrl_(att.url);
        if (!fileId) { record(att, i, "enlace no es una URL de Drive"); return; }
        // DriveApp.File is NOT a Blob: it has getBlob(), not getBytes(). The
        // mail lanes call getBytes()/getName() on these, so normalize to a real
        // Blob here. Returning the File directly made the Graph lane throw
        // "b.getBytes is not a function", which aborted the WHOLE attachment
        // map and silently dropped every file in the message.
        const file = DriveApp.getFileById(fileId);
        const blob = typeof file.getBlob === "function" ? file.getBlob() : file;
        out.push(Utilities.newBlob(
          blob.getBytes(),
          String(file.getMimeType() || file.getContentType() || "application/octet-stream"),
          // Prefer the REAL Drive filename. att.name is only a synthetic
          // fallback: using it first renamed the supplier's document to a
          // generic, extension-less name that collided with the quote PDF.
          String(file.getName() || att.name || ("attachment_" + (i + 1)))
        ));
        return;
      }
      if (att.contentBase64) {
        const bytes = Utilities.base64Decode(att.contentBase64);
        // A truncated/empty payload decodes to 0 bytes: attaching it would
        // send a corrupt file, so report it instead.
        if (!bytes || !bytes.length) { record(att, i, "contenido vacío o truncado"); return; }
        out.push(Utilities.newBlob(
          bytes,
          att.mimeType || "application/octet-stream",
          att.name || ("attachment_" + (i + 1))
        ));
        return;
      }
      record(att, i, "descriptor no soportado");
    } catch (e) {
      record(att, i, String(e && e.message ? e.message : e));
    }
  });
  if (mail && typeof mail === "object") mail.__attachmentFailures = failures;
  return out;
}

/**
 * SmartDispatcher — sends via Microsoft Graph API only.
 * Brevo and Gmail/MailApp fallbacks have been removed.
 */
function SmartDispatcher(mail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("Log");

  try {
    const sender = String(mail.senderEmail || mail.from || mail.replyTo || "").trim();
    if (!sender) throw new Error("Graph sender email missing — set senderEmail, from, or replyTo on the mail object.");

    const creds = getAzureGraphCredentials_();
    const accessToken = getMicrosoftGraphToken(creds);
    const graphEndpoint =
      "https://graph.microsoft.com/v1.0/users/" +
      encodeURIComponent(sender) +
      "/sendMail";

    let bodyContent = String(mail.body || "");
    if (mail.pdfUrl && String(mail.pdfUrl).trim() !== "") {
      bodyContent +=
        '<br><br><p style="font-size:12px;color:#666;"><strong>PDF Link:</strong> <a href="' +
        String(mail.pdfUrl) +
        '" target="_blank">Download PDF</a></p>';
    }

    const messagePayload = {
      message: {
        subject: String(mail.subject || ""),
        body: { contentType: "HTML", content: bodyContent },
        toRecipients: sanitizeGraphRecipients_(mail.to).valid,
        ccRecipients: sanitizeGraphRecipients_(mail.cc).valid,
        bccRecipients: sanitizeGraphRecipients_(mail.bcc).valid,
      },
      saveToSentItems: true,
    };

    // Attachments
    try {
      const graphAtts = resolveMailAttachments_(mail);
      if (graphAtts.length) {
        const mapped = [];
        graphAtts.forEach(function (b, ai) {
          try {
            const bytes = b.getBytes();
            if (!bytes || !bytes.length) { console.warn("Graph attachment[" + ai + "] empty — skipped"); return; }
            mapped.push({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: b.getName() || ("attachment_" + (ai + 1)),
              contentBytes: Utilities.base64Encode(bytes),
            });
          } catch (oneErr) {
            console.warn("Graph attachment[" + ai + "] skipped: " + oneErr.toString());
          }
        });
        if (mapped.length) messagePayload.message.attachments = mapped;
      }
    } catch (attErr) {
      console.warn("Failed to add Graph attachments: " + attErr.toString());
    }

    var skipped = sanitizeGraphRecipients_(mail.to).invalid
      .concat(sanitizeGraphRecipients_(mail.cc).invalid)
      .concat(sanitizeGraphRecipients_(mail.bcc).invalid);
    if (!messagePayload.message.toRecipients.length) {
      throw new Error(
        "No valid 'To' recipients. Skipped invalid: " +
        (skipped.length ? skipped.join(", ") : String(mail.to || "(empty)"))
      );
    }
    if (skipped.length) {
      console.warn("SmartDispatcher: skipped invalid email(s): " + skipped.join(", "));
    }

    const gresp = UrlFetchApp.fetch(graphEndpoint, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(messagePayload),
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
      muteHttpExceptions: true,
    });

    const responseCode = gresp.getResponseCode();
    if (responseCode === 202) {
      logSheet.appendRow([new Date(), mail.type, mail.refId, mail.to, mail.subject, "Graph", "Success", "GRAPH-OK"]);
      return { success: true, service: "Graph" };
    } else {
      throw new Error("Graph API Error: " + responseCode + " " + gresp.getContentText());
    }
  } catch (e) {
    try {
      logSheet.appendRow([new Date(), mail.type, mail.refId, mail.to, mail.subject, "ERROR", "Failed", e.toString()]);
    } catch (_) {}
    return { success: false, message: e.toString() };
  }
}



/**
 * Fetches inventory in chunks to prevent timeouts.
 * Returns a raw 2D array (no keys) for maximum compression.
 */
function getInventoryChunk(startRow, chunkSize) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Master");
    const lastRow = sheet.getLastRow();

    if (startRow > lastRow) {
      return { data: "", total: lastRow - 1, nextRow: -1 };
    }

    const remaining = lastRow - startRow + 1;
    const numRows = Math.min(chunkSize, remaining);

    // Fetch columns 1 to 15
    const values = sheet.getRange(startRow, 1, numRows, 15).getValues();

    // Convert to safe JSON strings per line to avoid transmission errors
    const serialized = values
      .map(function (row) {
        return JSON.stringify(row);
      })
      .join("\n");

    return {
      data: serialized,
      total: lastRow - 1,
      nextRow: startRow + numRows > lastRow ? -1 : startRow + numRows,
    };
  } catch (e) {
    console.error("Backend Error: " + e.toString());
    return null;
  }
}

function refreshSystemConfig() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config");
    const data = configSheet.getDataRange().getValues();

    // Logic to convert Sheet rows into a clean JSON object
    const newConfig = {};
    data.forEach((row) => {
      newConfig[row[0]] = row[1]; // Assumes Col A is Key, Col B is Value
    });

    return { success: true, config: newConfig };
  } catch (e) {
    return { success: false, message: e.message };
  }
}


//barcode scann
function processScan(barcode, qty) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Inventory_Logs"); // Or your specific sheet

  // Append the scan as a new row to keep a history
  sheet.appendRow([new Date(), barcode, qty, "User_Name"]);

  // Optional: Update your "Master" stock levels here if needed
  return "Success";
}


function getBundlesForSearch() {
  console.log("Bundle function started");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Bundles");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  console.log("Rows found:", data.length);
  console.log("First rows:", JSON.stringify(data.slice(0, 5)));
  const colId = headers.indexOf("Bundle ID");
  const colName = headers.indexOf("Bundle Name");
  const colActive = headers.indexOf("Active");

  return data.slice(1)
    .filter(r => String(r[colActive]).toUpperCase() === "TRUE")
    .map(r => {
      return {
        id: r[colId],
        type: "bundle",
        bundleId: r[colId],
        label: "📦 BUNDLE - " + r[colName],
        es: "📦 BUNDLE - " + r[colName],
        searchText: (r[colName] || "").toLowerCase()
      };
    });
}