const IMPORT_LOG_SHEET =
  'Invoice_Import_Log';

const IMPORT_ALIAS_SHEET =
  'Supplier_Item_Alias';

const COMPRAS_SHEET =
  'Compras';

// =========================
// SAVE IMPORT
// =========================
function saveImportedInvoice(payload) {
  return processInvoiceImport(payload);
}

function processInvoiceImport(payload) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const compras = ss.getSheetByName(COMPRAS_SHEET);
  const logSheet = ss.getSheetByName(IMPORT_LOG_SHEET);
  const aliasSheet = ss.getSheetByName(IMPORT_ALIAS_SHEET);

  const importId = generateImportId();
  const ts = new Date();

  // =========================
  // 1. DUPLICATE CHECK
  // =========================
  const isDuplicate = checkDuplicateInvoice(
    payload.supplier,
    payload.invoiceNo,
    logSheet
  );

  if (isDuplicate) {
    return {
      success: false,
      message: "Duplicate invoice detected. Import blocked."
    };
  }

  // =========================
  // 2. NORMALIZE LINES
  // =========================
  const lines = payload.lines || [];

  const comprasRows = [];
  const logRows = [];

  lines.forEach((line, index) => {

    const geo = line.matchedGeo || "";
    const desc = line.matchedDescription || line.rawDesc || line.description || "";

    // =========================
    // COMPRAS ROW
    // =========================
    comprasRows.push([
      ts,                         // DOCUMENT DATE
      "",                         // PO Number
      "",                         // RCT
      "",                         // EP
      payload.invoiceNo,          // Invoice
      desc,                       // Item Description
      geo,                        // Barcode (or GEO ref)
      payload.supplier,           // Supplier
      line.qty || 1,              // QTY
      "",                         // UNIT COST-USD
      "",                         // unit cost CLP
      "",                         // Unit Cost-CLP
      "",                         // Extended Cost-USD
      "",                         // Extended cost CLP
      "",                         // Qty Deliver
      "",                         // Back Order
      "",                         // ETA
      "IMPORTED"                  // Document Status
    ]);

    // =========================
    // LOG ROW
    // =========================
    logRows.push([
      importId,
      payload.supplier,
      payload.invoiceNo,
      index + 1,
      line.raw || desc,
      line.suggestedGeo || "",
      geo,
      (line.suggestedGeo !== geo),
      Session.getActiveUser().getEmail(),
      ts
    ]);

    // =========================
    // LEARNING UPDATE
    // =========================
    if (geo) {
      updateSupplierAlias({
        supplier: payload.supplier,
        rawText: line.raw || desc,
        geo: geo,
        confidence: line.matchScore || 0
      });
    }

  });

  // =========================
  // 3. BATCH WRITE (IMPORTANT)
  // =========================
  if (comprasRows.length) {
    compras
      .getRange(compras.getLastRow() + 1, 1, comprasRows.length, comprasRows[0].length)
      .setValues(comprasRows);
  }

  if (logRows.length) {
    logSheet
      .getRange(logSheet.getLastRow() + 1, 1, logRows.length, logRows[0].length)
      .setValues(logRows);
  }

  return {
    success: true,
    message: "Invoice imported successfully",
    importId: importId
  };
}

function checkDuplicateInvoice(supplier, invoiceNo, logSheet) {

  const data = logSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const rowSupplier = data[i][1];
    const rowInvoice = data[i][2];

    if (
      rowSupplier === supplier &&
      rowInvoice === invoiceNo
    ) {
      return true;
    }
  }

  return false;
}



// =========================
// LEARNING MEMORY
// =========================
function updateSupplierAlias(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(IMPORT_ALIAS_SHEET);

  const rows = sheet.getDataRange().getValues();

  const supplier = normalizeImportText(data.supplier);
  const text = normalizeImportText(data.rawText);

  for (let i = 1; i < rows.length; i++) {

    const rSupplier = normalizeImportText(rows[i][0]);
    const rText = normalizeImportText(rows[i][1]);
    const rGeo = String(rows[i][3] || "");

    if (
      rSupplier === supplier &&
      rText === text &&
      rGeo === data.geo
    ) {

      // update usage count
      sheet.getRange(i + 1, 5).setValue(Number(rows[i][4] || 0) + 1);

      // last used
      sheet.getRange(i + 1, 6).setValue(new Date());

      return;
    }
  }

  // new entry
  sheet.appendRow([
    data.supplier,
    data.rawText,
    "",
    data.geo,
    1,
    new Date(),
    data.confidence || 0
  ]);
}

// =========================
// NORMALIZE
// =========================
function normalizeImportText(text) {

  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

}

// =========================
// IMPORT ID
// =========================
function generateImportId() {

  return 'IMP-' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

}

function extractInvoicePDFText(payload) {

  try {

    const blob = Utilities.newBlob(
      Utilities.base64Decode(payload.base64),
      "application/pdf",
      payload.fileName
    );

    // TEMP PDF FILE
    const pdfFile =
      DriveApp.createFile(blob);

    // OCR CONVERT TO GOOGLE DOC
    const resource = {
      title: payload.fileName,
      mimeType: MimeType.GOOGLE_DOCS
    };

    const converted =
      Drive.Files.copy(
        resource,
        pdfFile.getId(),
        {
          ocr: true
        }
      );

    // READ OCR TEXT
    const doc =
      DocumentApp.openById(converted.id);

    const text =
      doc.getBody().getText();

    // CLEANUP
    DriveApp.getFileById(pdfFile.getId()).setTrashed(true);
    DriveApp.getFileById(converted.id).setTrashed(true);

    return {
      success: true,
      text: text
    };

  } catch(err) {

    return {
      success: false,
      message: err.toString()
    };

  }

}