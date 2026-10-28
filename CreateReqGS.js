function getBundleItems(bundleId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const bundleSheet = ss.getSheetByName("Bundle_Items");
  if (!bundleSheet) {
    throw new Error("Bundle_Items sheet not found");
  }

  const data = bundleSheet.getDataRange().getValues();
  const headers = data[0];

  const colBundle = headers.indexOf("Bundle ID");
  const colGeo = headers.indexOf("Geo Code");
  const colQty = headers.indexOf("Qty");

  if (colBundle === -1 || colGeo === -1 || colQty === -1) {
    throw new Error("Required columns missing in Bundle_Items");
  }

  const rows = data.slice(1).filter(r => {
    return String(r[colBundle]).trim() === String(bundleId).trim();
  });

  const inventory = getInventoryData();

  const result = rows.map(row => {
    const geo = String(row[colGeo] || "").trim();
    const qty = Number(row[colQty] || 1);

    const inv = inventory.find(x => {
      return String(x.geo || "").trim() === geo;
    }) || {};

    return {
      geo: geo,
      qty: qty,
      es: inv.es || "",
      en: inv.en || "",
      supplier: inv.supplier || "",
      category: inv.category || "General",
      subCategory: inv.subCategory || "",
      pn: inv.p || inv.pn || "",
      fromBundle: true,
      bundleId: bundleId
    };
  });

  return result;
}



/* ============================================================
 * REQUIREMENT NUMBER SEQUENCE (Req No.)
 * ------------------------------------------------------------
 * The Req number comes from the Config sheet ("LastReq" label in Col A,
 * the value in Col B) and is the LAST NUMBER ISSUED, so the next
 * requirement gets that value + 1.
 *
 * It is deliberately NOT derived from the Ordenes row layout: Ordenes
 * stores ONE ROW PER LINE ITEM, so a row-based number advanced by the
 * item count of every requirement (a 124-item requirement jumped the
 * sequence by 124: 1226 -> 1350). Row position is also shifted by draft
 * rows and by deleteDraftRows, which could move the sequence backwards
 * and re-issue an existing number.
 *
 * Rules enforced here:
 *  - one number per REQUIREMENT (per shipment), never per item row;
 *  - the counter is reserved and persisted BEFORE the slow PDF/row/email
 *    work, because processMassOrders has no rollback (an email failure
 *    re-throws after earlier shipments are already written). An aborted
 *    batch may burn a number - a harmless gap - but can never hand the
 *    same number to two requirements. A duplicate Req ID is worse than a
 *    gap: orchestrateRequirementPDF trashes any existing <OrderId>.pdf,
 *    so it would also destroy the other requirement's PDF and cross-link
 *    both requirements in the Quotes/RFQ screens;
 *  - the read-modify-write runs under the script lock, so two
 *    simultaneous submissions cannot both read the same value;
 *  - the counter is still checked against Ordenes Col A, so a counter
 *    that was blanked, reset or hand-edited can only move forward and
 *    skips numbers that are already in use (self-healing, no manual
 *    repair required on the hot path).
 * ============================================================ */

/**
 * Locates (or recreates) the Config cell holding the last issued Req number.
 * Addressed by its Col-A label instead of a hard-coded "B26" so inserting or
 * moving a row in the Config sheet can never silently break requirement
 * creation the way the hard-coded B15/B16 flag reads can.
 * @param {Sheet} configSheet the Config sheet
 * @return {Range} the counter cell (Col B of the "LastReq" row)
 */
function getLastReqCell_(configSheet) {
  if (!configSheet) {
    throw new Error("Config sheet not found - cannot issue the Req number.");
  }

  const lastRow = Math.max(configSheet.getLastRow(), 1);
  const colA = configSheet.getRange(1, 1, lastRow, 1).getValues();

  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0] || "").trim().toLowerCase() === "lastreq") {
      return configSheet.getRange(i + 1, 2);
    }
  }

  // Self-healing: the label was deleted or renamed. Recreate it at the end of
  // the table (value is repaired by reserveReqNumbers_) instead of failing the
  // whole requirement submission.
  const newRow = configSheet.getLastRow() + 1;
  console.warn("Config: 'LastReq' label not found - recreated at row " + newRow);
  configSheet.getRange(newRow, 1).setValue("LastReq");
  return configSheet.getRange(newRow, 2);
}

/**
 * Reads Ordenes column A ONCE and reports which Req numbers are already in use.
 * Understands "REQ-0002-SITE-CAT", the legacy plain-number ids written by the
 * old saveRequirementToSheet path, and ignores "DRAFT-" rows (drafts carry a
 * timestamp id, never a Req number).
 * @param {Sheet} sheet the Ordenes sheet
 * @return {{used: Object, max: number, rows: number}} used numbers as a lookup,
 *         the highest number found and how many id rows were scanned
 */
function scanUsedReqNumbers_(sheet) {
  const used = {};
  let max = 0;
  let rows = 0;

  if (!sheet) return { used: used, max: max, rows: rows };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { used: used, max: max, rows: rows };

  // Single-column read (not getDataRange): cheap enough to run per submission.
  const colA = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    const raw = String(colA[i][0] || "").trim();
    if (!raw || raw.toUpperCase().indexOf("DRAFT-") === 0) continue;
    rows++;

    let num = NaN;
    const reqMatch = raw.match(/^REQ-0*(\d+)/i);
    if (reqMatch) {
      num = Number(reqMatch[1]);
    } else if (/^\d+$/.test(raw)) {
      num = Number(raw); // legacy numeric Order ids
    }

    if (isFinite(num) && num > 0) {
      used[num] = true;
      if (num > max) max = num;
    }
  }

  return { used: used, max: max, rows: rows };
}

function processMassOrders(shipments) {
  console.log("Starting processMassOrders...");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const configSheet = ss.getSheetByName("Config");
  const timestamp = new Date();

  try {
    // 1. CHECK FLAGS (Email & PDF enabled status)
    const isEmailEnabled = configSheet.getRange("B16").getValue() === true;
    const isPdfEnabled = configSheet.getRange("B15").getValue() === true;
    
    console.log("Email Enabled:", isEmailEnabled, "| PDF Enabled:", isPdfEnabled);

    const results = [];

    // PRE-VALIDATION: build + duplicate-check the SubArea folios (Workshop)
    // BEFORE writing anything, so an invalid/duplicate number aborts the
    // whole request with no partial saves. Format: suffix + 7 digits
    // (e.g. "MP-" + 156 -> "MP-0000156").
    const batchFolios = {};
    shipments.forEach(function (shipment) {
      if (!shipment.subAreaNumber || !shipment.subArea) return;
      const built = buildSubAreaFolio_(shipment.site, shipment.subArea, shipment.subAreaNumber);
      if (!built) {
        throw new Error('SubArea "' + shipment.subArea + '" has no Suffix configured in the Validation sheet (Col X) - cannot generate the SubArea No.');
      }
      if (batchFolios[built.folio] || subAreaFolioExists_(built.folio)) {
        throw new Error('SubArea No ' + built.folio + ' already exists - please enter a different number.');
      }
      batchFolios[built.folio] = true;
      shipment.subAreaFolio = built.folio;
    });

    // PRE-ALLOCATION: issue one Req number per REQUIREMENT (per shipment, not
    // per item row) from the Config "LastReq" counter and persist the counter
    // right now - before any PDF, sheet write or email. processMassOrders has
    // no rollback (an email failure re-throws after earlier shipments are
    // already on the sheet), so committing the counter up front means an
    // aborted batch can only burn a number (harmless gap) and can never hand
    // the same number to two requirements.
    const reservedReqNumbers = reserveReqNumbers_(shipments.length, sheet, configSheet);
    shipments.forEach(function (shipment, i) {
      shipment.reqNumber = reservedReqNumbers[i];
    });

    shipments.forEach((shipment) => {
      try {
        // Per-item notes ("Item Notes" for the internal requirement email/PDF and
        // "Supplier Notes" for the supplier RFQ email) are available for every
        // site. Both are sanitized with cleanReqNotes_ when written below.

        // STEP 0: Get Site Suffix for Req ID
        const valSheet = ss.getSheetByName("Validation");
        let siteSuffix = "GEN";
        if (valSheet) {
          const valData = valSheet.getDataRange().getValues();
          for (let i = 1; i < valData.length; i++) {
            if (String(valData[i][0]).trim().toUpperCase() === String(shipment.site).trim().toUpperCase()) {
              siteSuffix = String(valData[i][2] || "GEN").trim();
              break;
            }
          }
        }
        
        // STEP 1: Build the Req ID from the reserved sequence number.
        // The number comes from the Config "LastReq" counter (see
        // reserveReqNumbers_), NOT from sheet.getLastRow(): Ordenes holds one
        // row per line item, so a row-based number advanced by the item count
        // of every requirement (e.g. 1226 -> 1350 after a 124-item request).
        const idNum = String(shipment.reqNumber).padStart(4, "0");
        if (!/^\d+$/.test(idNum)) {
          // Defensive: a missing reservation must never produce "REQ-undefined-".
          throw new Error("Internal error: no Req number was reserved for this requirement.");
        }
        const newOrderId = `REQ-${idNum}-${siteSuffix}-${shipment.category || "GEN"}`;
        console.log("Generated Req ID:", newOrderId);

        // STEP 2: Generate PDF with the Req ID
        const pdfUrl = orchestrateRequirementPDF(newOrderId, shipment);
        console.log("Generated PDF URL:", pdfUrl);

        // STEP 3: Prepare rows for sheet save
        // Locate the optional "SubArea", "Emails", "SubArea No", "Notes",
        // "Item Notes" and "Supplier Notes" columns in the Ordenes sheet so the
        // selected SubArea, the confirmed recipient list, the SubArea folio, the
        // user's notes (creation email body) and the per-item notes are persisted
        // (mirrors Quotes).
        let subAreaColIdx = -1;
        let emailsColIdx = -1;
        let subAreaNoColIdx = -1;
        let notesColIdx = -1;
        let itemNotesColIdx = -1;
        let supplierNotesColIdx = -1;
        let itemImagesColIdx = -1;
        try {
          const headerRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 18)).getValues()[0];
          const headerNames = headerRow.map(function (h) { return String(h || "").trim(); });
          subAreaColIdx = headerNames.indexOf("SubArea");
          emailsColIdx = headerNames.indexOf("Emails");
          subAreaNoColIdx = headerNames.indexOf("SubArea No");
        } catch (hErr) {
          console.warn("Could not read Ordenes headers for SubArea/Emails/SubArea No columns:", hErr.toString());
        }
        // These may not exist yet: the helpers create them at the end of the table
        notesColIdx = getOrdenesNotesColumn_(sheet);
        itemNotesColIdx = getOrdenesItemNotesColumn_(sheet);
        supplierNotesColIdx = getOrdenesSupplierNotesColumn_(sheet);
        itemImagesColIdx = getOrdenesItemImagesColumn_(sheet);

        const row = [
          newOrderId, timestamp, shipment.items[0].pn, shipment.items[0].geo,
          shipment.site, shipment.items[0].es || shipment.items[0].en,
          shipment.items[0].qty, "Pending", shipment.userName, "", "", "", 
          shipment.category, pdfUrl, "",
          "", new Date(), 1  // NEW: lastModifiedBy (empty), lastModifiedDate (set), modCount=1
        ];

        const rowsToSave = shipment.items.map((item) => {
          let r = [...row];
          r[2] = item.pn;
          r[3] = item.geo;
          r[5] = item.es || item.en;
          r[6] = item.qty;
          return r;
        });

        // Persist SubArea + SubArea No (folio) + the confirmed recipient
        // distribution list (user-edited "To" merged with fresh SubArea-aware
        // routing emails, same merge used by the Quotes flow) and the notes
        // typed in the preview "Additional Message (Body)" when present.
        const notesToSave = cleanReqNotes_(shipment.body);
        // Per-item notes in row order, matching rowsToSave. "Item Notes" stays
        // internal; "Supplier Notes" is the note printed in the supplier RFQ
        // (quote request) email. Both are stored for every site.
        const itemNotesToSave = (shipment.items || []).map(function (it) {
          return cleanReqNotes_(it && it.itemNotes);
        });
        const supplierNotesToSave = (shipment.items || []).map(function (it) {
          return cleanReqNotes_(it && it.supplierNotes);
        });
        // Photos attached to each line in the cart, already uploaded to Drive when
        // the user picked them. Stored as ONE comma-separated cell per row
        // ("url1, url2") in the "Item Images" column - never base64/data URLs.
        const itemImagesToSave = (shipment.items || []).map(function (it) {
          return serializeItemImages_(it && it.images);
        });
        if (subAreaColIdx >= 0 || emailsColIdx >= 0 || subAreaNoColIdx >= 0 || notesColIdx >= 0 || itemNotesColIdx >= 0 || supplierNotesColIdx >= 0 || itemImagesColIdx >= 0) {
          let routingEmails = "";
          if (emailsColIdx >= 0) {
            try {
              const routingForSave = getRequirementRouting(
                String(shipment.site || ""),
                String(shipment.category || ""),
                String(shipment.subArea || "")
              );
              if (routingForSave && routingForSave.emails && routingForSave.emails !== "procurement@yourcompany.com") {
                routingEmails = routingForSave.emails;
              }
            } catch (rErr) {
              console.warn("Routing lookup failed while persisting requirement recipients:", rErr.toString());
            }
          }
          const initialRecipients = mergeEmailRecipients_([shipment.to, routingEmails]);

          const targetWidth = Math.max(18, subAreaColIdx + 1, emailsColIdx + 1, subAreaNoColIdx + 1, notesColIdx + 1, itemNotesColIdx + 1, supplierNotesColIdx + 1, itemImagesColIdx + 1);
          rowsToSave.forEach(function (r, i) {
            while (r.length < targetWidth) r.push("");
            if (subAreaColIdx >= 0) r[subAreaColIdx] = shipment.subArea || "";
            if (emailsColIdx >= 0) r[emailsColIdx] = initialRecipients;
            if (subAreaNoColIdx >= 0) r[subAreaNoColIdx] = shipment.subAreaFolio || "";
            if (notesColIdx >= 0) r[notesColIdx] = notesToSave;
            if (itemNotesColIdx >= 0) r[itemNotesColIdx] = itemNotesToSave[i] || "";
            if (supplierNotesColIdx >= 0) r[supplierNotesColIdx] = supplierNotesToSave[i] || "";
            if (itemImagesColIdx >= 0) r[itemImagesColIdx] = itemImagesToSave[i] || "";
          });
        }

        // STEP 4: Save to Sheet
        try {
          const saveWidth = Math.max(18, subAreaColIdx + 1, emailsColIdx + 1, subAreaNoColIdx + 1, notesColIdx + 1, itemNotesColIdx + 1, supplierNotesColIdx + 1, itemImagesColIdx + 1);
          sheet.getRange(sheet.getLastRow() + 1, 1, rowsToSave.length, saveWidth).setValues(rowsToSave);
          console.log("Saved to sheet successfully for:", newOrderId);
        } catch (sheetErr) {
          throw new Error("Sheet save failed: " + sheetErr.toString());
        }

        // STEP 5: Conditional Email Sending (only if enabled)
        let emailSent = false;
        let emailService = "";
        if (isEmailEnabled) {
          // Defensive fallback: if a SubArea was selected but the "To" field is
          // empty, resolve the SubArea emails server-side.
          if (!shipment.to && shipment.subArea) {
            const subAreaFallback = resolveSubAreaRouting_(
              String(shipment.site || ""),
              String(shipment.subArea || "")
            );
            if (subAreaFallback && subAreaFallback.emails) {
              shipment.to = subAreaFallback.emails;
            }
          }
          try {
            // Get company logo for email header
            let logoHtml = "";
            try {
              const logoBase64 = getCompanyLogo();
              if (logoBase64) {
                logoHtml = `<div style="text-align: center; margin-bottom: 20px;"><img src="${logoBase64}" style="max-height: 60px; max-width: 200px;"></div>`;
              }
            } catch (logoErr) {
              console.warn("Logo fetch failed:", logoErr.toString());
            }
            
            // Build HTML email with table, signature, and message
            // FIX #3: shipment.body is already sanitized HTML from the rich-text editor
            // (bold/italic/lists/line-breaks preserved). Wrap it — do NOT escape it,
            // otherwise formatting shows as plain text in the received email.
            const htmlTable = buildHtmlTable(shipment.items);
            const signatureHtml = shipment.signature || "";
            const userMsgHtml = shipment.body || "Material Requirement Created";
            const emailHtmlBody = `
              <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                ${logoHtml}
                <div>${userMsgHtml}</div>
                <p><strong>Requirement ID:</strong> ${newOrderId}</p>
                ${shipment.subArea ? `<p><strong>SubArea:</strong> ${shipment.subArea}</p>` : ""}
                ${shipment.subAreaFolio ? `<p><strong>SubArea No:</strong> ${shipment.subAreaFolio}</p>` : ""}
                <p><strong>Category:</strong> ${shipment.category}</p>
                <p><strong>Site:</strong> ${shipment.site}</p>
                <hr>
                <h4 style="margin-top: 20px;">Items:</h4>
                ${htmlTable}
                <hr>
                ${signatureHtml ? `<div style="margin-top: 30px; border-top: 1px solid #ccc; padding-top: 15px;">${signatureHtml}</div>` : ""}
                <p style="font-size: 11px; color: #666; margin-top: 20px;">
                  This is an automated message from RECON ERP System.
                </p>
              </div>
            `;
            
            // Build email package with subject using Req ID
            const emailPackage = {
              type: "Requirement",
              refId: newOrderId,
              to: shipment.to || "",
              cc: shipment.cc || "",
              subject: `Requirement: ${newOrderId}`,
              body: emailHtmlBody,
              pdfUrl: pdfUrl,
              replyTo: Session.getActiveUser().getEmail(),
              senderEmail: (shipment.currentUserEmail && String(shipment.currentUserEmail).trim()) || Session.getActiveUser().getEmail()
            };

            // Send email via SmartDispatcher
            const emailResult = SmartDispatcher(emailPackage);

            if (emailResult && emailResult.requiresFallbackChoice) {
              results.push({
                orderId: newOrderId,
                reqId: newOrderId,
                pdfUrl: pdfUrl,
                emailSent: false,
                emailService: "",
                requiresFallbackChoice: true,
                graphError: emailResult.graphError || emailResult.message || "Graph send failed",
                dispatchDraft: emailPackage,
              });
              return;
            }
            
            if (emailResult.success) {
              emailSent = true;
              emailService = emailResult.service;
              console.log("Email sent successfully via:", emailService);
            } else {
              console.warn("Email sending failed:", emailResult.message);
              throw new Error("Email send failed: " + emailResult.message);
            }
          } catch (emailErr) {
            console.error("Email error for " + newOrderId + ":", emailErr.toString());
            throw new Error("Email sending failed - Request aborted: " + emailErr.toString());
          }
        }

        // STEP 6: Prepare result object
        results.push({ 
          orderId: newOrderId, 
          reqId: newOrderId,
          pdfUrl: pdfUrl,
          emailSent: emailSent,
          emailService: emailService || "N/A"
        });

      } catch (itemErr) {
        console.error("Error processing shipment:", itemErr.toString());
        throw itemErr; // Re-throw to abort entire batch if one shipment fails email
      }
    });

    return { success: true, data: results };
  } catch (e) {
    console.error("CRITICAL ERROR: " + e.toString());
    return { success: false, message: e.toString() };
  }
}


/**
 * SAVE DRAFT - Saves requirement as draft to Ordenes sheet
 * Drafts get Estado="Draft" and a temporary DRAFT-XXX ID
 * No PDF generated, no email sent
 */
function saveDraft(shipments) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ordenes");
  const timestamp = new Date();

  try {
    const draftId = "DRAFT-" + timestamp.getTime();

    shipments.forEach((shipment) => {
      // Column indices are resolved once per shipment (the helper creates the
      // "Notes" column on first use) and reused for every draft row.
      const headerRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 18)).getValues()[0];
      const headerNames = headerRow.map(function (h) { return String(h || "").trim(); });
      const subAreaColIdx = headerNames.indexOf("SubArea");
      const emailsColIdx = headerNames.indexOf("Emails");
      const subAreaNoColIdx = headerNames.indexOf("SubArea No");
      // "Notes" keeps the draft's "Additional Message (Body)" so a draft
      // re-opened (and later the View/Edit Requirement screen) still shows it.
      // "Item Notes" / "Supplier Notes" keep both per-item notes the same way.
      const notesColIdx = getOrdenesNotesColumn_(sheet);
      const itemNotesColIdx = getOrdenesItemNotesColumn_(sheet);
      const supplierNotesColIdx = getOrdenesSupplierNotesColumn_(sheet);
      // Photos attached to the line in the cart. Stored as ONE comma-separated
      // cell per row so a draft keeps its attachments when re-opened.
      const itemImagesColIdx = getOrdenesItemImagesColumn_(sheet);
      const notesToSave = cleanReqNotes_(shipment.body);

      const rowsToSave = shipment.items.map((item) => {
        const row = [
          draftId, timestamp, item.pn, item.geo, shipment.site,
          item.es || item.en, item.qty, "Draft", shipment.userName,
          "", "", "", shipment.category, "", "", "", new Date(), 1
        ];

        const targetWidth = Math.max(18, subAreaColIdx + 1, emailsColIdx + 1, subAreaNoColIdx + 1, notesColIdx + 1, itemNotesColIdx + 1, supplierNotesColIdx + 1, itemImagesColIdx + 1);
        while (row.length < targetWidth) row.push("");

        if (subAreaColIdx >= 0) row[subAreaColIdx] = shipment.subArea || "";
        if (emailsColIdx >= 0) row[emailsColIdx] = shipment.to || "";
        if (subAreaNoColIdx >= 0) row[subAreaNoColIdx] = shipment.subAreaFolio || "";
        if (notesColIdx >= 0) row[notesColIdx] = notesToSave;
        if (itemNotesColIdx >= 0) row[itemNotesColIdx] = cleanReqNotes_(item && item.itemNotes);
        if (supplierNotesColIdx >= 0) row[supplierNotesColIdx] = cleanReqNotes_(item && item.supplierNotes);
        if (itemImagesColIdx >= 0) row[itemImagesColIdx] = serializeItemImages_(item && item.images);

        return row;
      });

      const saveWidth = Math.max(18, rowsToSave[0].length);
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToSave.length, saveWidth).setValues(rowsToSave);
    });

    console.log("Draft saved successfully:", draftId);
    return { success: true, draftId: draftId };
  } catch (e) {
    console.error("Error saving draft: " + e.toString());
    return { success: false, message: e.toString() };
  }
}


/**
 * GET DRAFTS - Retrieves all drafts from Ordenes sheet
 * Returns array of draft objects grouped by draft ID
 */
function getDrafts() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");

    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => { colMap[String(h).trim()] = i; });

    const drafts = {};

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const orderId = String(row[0] || "").trim();
      const estado = String(row[colMap["Estado"] !== undefined ? colMap["Estado"] : 7] || "").trim();

      if (orderId.startsWith("DRAFT-") && estado === "Draft") {
        if (!drafts[orderId]) {
          drafts[orderId] = {
            draftId: orderId,
            fecha: row[1] ? new Date(row[1]).toISOString() : "",
            site: row[colMap["Faena"] !== undefined ? colMap["Faena"] : 4] || "",
            user: row[colMap["User"] !== undefined ? colMap["User"] : 8] || "",
            category: row[colMap["Category"] !== undefined ? colMap["Category"] : 12] || "General",
            subArea: row[colMap["SubArea"]] || "",
            emails: row[colMap["Emails"]] || "",
            subAreaNo: row[colMap["SubArea No"]] || "",
            notes: row[colMap["Notes"]] || "",
            items: []
          };
        }

        drafts[orderId].items.push({
          pn: row[colMap["P/N"] !== undefined ? colMap["P/N"] : 2] || "",
          geo: row[colMap["Geo Code"] !== undefined ? colMap["Geo Code"] : 3] || "",
          desc: row[colMap["Desc Es"] !== undefined ? colMap["Desc Es"] : 5] || "",
          es: row[colMap["Desc Es"] !== undefined ? colMap["Desc Es"] : 5] || "",
          qty: row[colMap["Cantidad"] !== undefined ? colMap["Cantidad"] : 6] || 0,
          itemNotes: row[colMap["Item Notes"]] || "",
          supplierNotes: row[colMap["Supplier Notes"]] || "",
          // Attached photos come back as the raw comma-separated cell; the client
          // splits it back into an array of {url,name} on loadDraft().
          images: row[colMap["Item Images"]] || ""
        });
      }
    }

    return Object.values(drafts).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  } catch (e) {
    console.error("Error getting drafts: " + e.toString());
    return [];
  }
}


/**
 * DELETE DRAFT ROWS - Deletes all rows belonging to a specific draft
 * Used when finalizing a draft (before re-adding as a real requirement)
 */
function deleteDraftRows(draftId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");

    if (!sheet) return { success: false, message: "Ordenes sheet not found" };

    const data = sheet.getDataRange().getValues();
    const rowsToDelete = [];

    for (let i = 1; i < data.length; i++) {
      const orderId = String(data[i][0] || "").trim();
      if (orderId === draftId) {
        rowsToDelete.push(i + 1);
      }
    }

    if (rowsToDelete.length === 0) {
      return { success: false, message: "Draft not found" };
    }

    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    console.log("Deleted " + rowsToDelete.length + " rows for draft: " + draftId);
    return { success: true, deletedCount: rowsToDelete.length };
  } catch (e) {
    console.error("Error deleting draft rows: " + e.toString());
    return { success: false, message: e.toString() };
  }
}


// ============================================================
// ITEM IMAGE ATTACHMENTS (Create Req cart)
// ------------------------------------------------------------
// Each cart line can carry one or more photos. They are uploaded to Drive the
// MOMENT the user picks them (not at submit time) so:
//   - the Ordenes "Item Images" cell only ever holds Drive URLs;
//   - the payload sent to processMassOrders stays tiny (a big order with many
//     photos would otherwise blow the google.script.run ~50 MB payload limit);
//   - the user immediately sees whether a photo actually stuck.
//
// Payload: { site, files: [{ name, mimeType, base64 }] }
// Returns: { success: true, urls: [...] } | { success: false, error }
// ============================================================

var REQ_IMAGES_MAX_FILES_PER_CALL = 8;
var REQ_IMAGES_MAX_FILES_PER_ITEM = 8;

/**
 * Resolves (creating as needed) the folder that stores requirement item images:
 * <spreadsheet parent>/Req/<Site>/Images - the same "Req/<Site>" tree the
 * requirement PDFs already live in (see orchestrateRequirementPDF), so photos
 * sit next to the PDF they relate to.
 * @param {string} site Project site name
 * @return {Folder} target folder
 */
function getReqImagesFolder_(site) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  var parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  var reqFolder = shared_getOrCreateFolder(parentFolder, "Req");
  var siteName = String(site || "").trim() || "General";
  var siteFolder = shared_getOrCreateFolder(reqFolder, siteName);
  return shared_getOrCreateFolder(siteFolder, "Images");
}

/**
 * Uploads the images attached to ONE cart line to Drive and returns their URLs.
 * Mirrors uploadQuoteAttachment (QuoteMgmtGS.js): the client downscales/re-encodes
 * to JPEG, the server stores the blob as-is and shares it view-by-link.
 * Each file is stored separately (one URL per photo) - they are NOT repackaged
 * into a PDF, because the requirement screen shows them as a thumbnail strip.
 * @param {{site: string, files: Array<{name: string, mimeType: string, base64: string}>}} payload
 * @return {{success: boolean, urls: Array<string>, error?: string}}
 */
function uploadRequirementItemImages(payload) {
  var created = [];
  try {
    if (!payload || !Array.isArray(payload.files) || payload.files.length === 0) {
      return { success: false, error: "No file content provided." };
    }
    if (payload.files.length > REQ_IMAGES_MAX_FILES_PER_CALL) {
      return { success: false, error: "Too many files in one upload (max " + REQ_IMAGES_MAX_FILES_PER_CALL + ")." };
    }

    var folder = getReqImagesFolder_(payload.site);
    var stamp = new Date().getTime();
    var urls = [];

    for (var i = 0; i < payload.files.length; i++) {
      var f = payload.files[i];
      if (!f || !f.base64) continue;

      var raw = String(f.base64 || "");
      // Tolerate a full data URL being sent by mistake (take the payload half).
      var commaAt = raw.indexOf(",");
      if (raw.indexOf("data:") === 0 && commaAt !== -1) raw = raw.substring(commaAt + 1);
      if (!raw) continue;

      var mime = String(f.mimeType || "image/jpeg").toLowerCase();
      var ext = mime.indexOf("png") !== -1 ? ".png" : (mime.indexOf("webp") !== -1 ? ".webp" : ".jpg");

      // Original name (sans extension) + index + timestamp so re-uploads of the
      // same photo never overwrite each other or a previous requirement's file.
      var baseName = sanitizeFileName_(String(f.name || "image").replace(/\.[^.]+$/, "").trim() || "image");
      var fileName = baseName + "_" + stamp + "_" + (i + 1) + ext;

      var blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, fileName);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      created.push(file);
      urls.push(file.getUrl());
    }

    if (!urls.length) {
      return { success: false, error: "No readable image content was provided." };
    }

    console.log("uploadRequirementItemImages: stored " + urls.length + " image(s) for site " + payload.site);
    return { success: true, urls: urls };
  } catch (e) {
    // Never leave orphaned half-batches in Drive: a failure on file N trashes
    // the files already created so the folder does not accumulate junk.
    created.forEach(function (f) {
      try { f.setTrashed(true); } catch (e2) { /* ignore */ }
    });
    console.warn("uploadRequirementItemImages failed: " + e.toString());
    return { success: false, error: String(e) };
  }
}


/**
 * Backend Helper for the Preview Modal
 */
function getRoutingPreview(site, category, userEmail, subArea) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Call existing routing logic (SubArea overrides category emails when provided)
    const routing = getRequirementRouting(site, category, subArea || "");

    // 2. INTEGRATE SIGNATURE: Fetch the signature for the current user
    const signatureHtml = getUserSignature(userEmail);

    return {
      routing: {
        // Empty when routing found nobody: leave "To" blank so the user has to pick
        // a recipient, instead of pre-filling a bogus "No email found" chip trio.
        emails: routing.emails || "",
        suffix: routing.suffix || "GEN",
      },
      subArea: subArea || "",
      signature: signatureHtml,
    };
  } catch (e) {
    throw new Error("Preview Failed: " + e.toString());
  }
}


/**
 * Issues the next `count` Req numbers from the Config "LastReq" counter and
 * persists the new value (see the REQUIREMENT NUMBER SEQUENCE block above).
 * The script lock covers only the counter read-modify-write, so the slow PDF
 * and email work never holds it.
 * @param {number} count one number per shipment (requirement)
 * @param {Sheet} sheet Ordenes sheet (duplicate guard)
 * @param {Sheet} configSheet Config sheet holding the "LastReq" counter
 * @return {number[]} the reserved numbers, in submission order
 */
function reserveReqNumbers_(count, sheet, configSheet) {
  const total = Number(count) || 0;
  if (total <= 0) return []; // nothing to create: never burn a number

  const cell = getLastReqCell_(configSheet);
  const lock = LockService.getScriptLock();

  // Deliberate deviation from the Quotes writer (Código.js continues without
  // the lock when it is busy): ID allocation must never run unlocked, or two
  // concurrent submissions issue the same Req number. Fail fast with a retry
  // message instead - the user loses a click, not a requirement.
  let locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
  } catch (lockErr) {
    throw new Error(
      "Another requirement is being created right now - please try again in a few seconds. (" + lockErr + ")"
    );
  }

  try {
    const scan = scanUsedReqNumbers_(sheet);
    const rawValue = cell.getValue();
    let current = Math.floor(Number(rawValue));

    // Repair a blank / hand-typed text / cleared counter from the sheet so we
    // never emit "REQ-NaN-..." or silently restart the sequence from 1.
    if (!isFinite(current) || current <= 0) {
      current = scan.max;
      console.warn(
        "Config 'LastReq' was blank or not a number (" + rawValue + ") - rebased to " + current + " from Ordenes."
      );
    }

    // A counter pointing below what has already been issued can only ever move
    // forward, so a hand-edited value cannot resurrect a used number.
    if (scan.max > current) {
      console.warn(
        "Config 'LastReq' (" + current + ") is below the highest issued Req number (" + scan.max + ") - continuing from " + scan.max + "."
      );
      current = scan.max;
    }

    const numbers = [];
    let candidate = current;
    const guardMax = total + 200000;
    for (let guard = 0; numbers.length < total && guard < guardMax; guard++) {
      candidate++;
      if (scan.used[candidate]) continue; // never reuse an issued number
      numbers.push(candidate);
    }
    if (numbers.length < total) {
      throw new Error("Unable to allocate " + total + " Req number(s) after " + candidate + ".");
    }

    cell.setValue(numbers[numbers.length - 1]);
    SpreadsheetApp.flush();

    console.log(
      "Reserved Req numbers [" + numbers.join(", ") + "] - Config 'LastReq' " + current + " -> " +
      numbers[numbers.length - 1]
    );
    return numbers;
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

/**
 * READ-ONLY diagnostic: shows the counter and what would be issued next,
 * without touching anything. Run from the Apps Script editor to verify the
 * sequence before/after creating requirements.
 */
function peekNextReqNumber() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cell = getLastReqCell_(ss.getSheetByName("Config"));
    const scan = scanUsedReqNumbers_(ss.getSheetByName("Ordenes"));
    const raw = cell.getValue();
    const counter = Math.floor(Number(raw));
    const base = isFinite(counter) && counter > 0 ? Math.max(counter, scan.max) : scan.max;

    return {
      success: true,
      configCell: cell.getA1Notation(),
      configValue: raw,
      highestIssuedInOrdenes: scan.max,
      scannedIdRows: scan.rows,
      nextReqNumber: base + 1,
      counterIsInSync: base === scan.max,
      unusedNumbers: isFinite(counter) && counter > 0 ? Math.max(0, counter - scan.max) : 0
    };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

/**
 * ADMIN / MAINTENANCE: re-syncs the Config "LastReq" counter with what has
 * actually been issued. Run from the Apps Script editor after hand-editing or
 * deleting rows in Ordenes, or when adopting the counter.
 *
 * By default it only ever RAISES the counter. A counter that is ahead of the
 * highest issued number is not an error - it just means unused numbers
 * (gaps), and gaps are harmless while duplicates are not - so it is left
 * alone and the function only reports. Pass force = true to also pull an
 * ahead-of-time counter back down to the highest issued number, which
 * reclaims those gaps. That is safe in both directions: reserveReqNumbers_
 * independently clamps to the highest issued number, so even a hand-lowered
 * counter can never re-issue a number that is already in use.
 *
 * Always inspect the returned object: `updated` says whether anything was
 * written, `configCell` says WHICH cell was read/written (B26 only when the
 * "LastReq" label really sits in A26), and `reason` explains a no-op.
 *
 * @param {boolean} [force] write the highest issued number even when the
 *        counter is already at or above it
 * @return {Object} report { success, updated, forced, configCell,
 *         previousValue, lastReq, nextReqNumber, highestIssuedInOrdenes,
 *         unusedNumbers, scannedIdRows, reason }
 */
function resyncLastReqNumber(force) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const scan = scanUsedReqNumbers_(ss.getSheetByName("Ordenes"));
    const cell = getLastReqCell_(ss.getSheetByName("Config"));
    const configCell = cell.getA1Notation();
    const previousRaw = cell.getValue();
    const previous = Math.floor(Number(previousRaw));

    if (scan.max <= 0) {
      return {
        success: false,
        updated: false,
        configCell: configCell,
        configValue: previousRaw,
        message: "No REQ-#### numbers were found in Ordenes column A - counter left untouched."
      };
    }

    const stale = !isFinite(previous) || previous <= 0 || scan.max > previous;

    if (!stale && !force) {
      return {
        success: true,
        updated: false,
        forced: false,
        configCell: configCell,
        previousValue: previous,
        lastReq: previous,
        nextReqNumber: previous + 1,
        highestIssuedInOrdenes: scan.max,
        unusedNumbers: previous - scan.max,
        scannedIdRows: scan.rows,
        reason:
          "READ-ONLY: the counter (" + previous + ") in " + configCell + " is at or above the highest Req number in Ordenes (" +
          scan.max + "), so there is nothing broken to repair." +
          (previous > scan.max
            ? " It is " + (previous - scan.max) + " number(s) ahead - harmless gaps."
            : "") +
          " Run resyncLastReqNumber(true) to force it down to " + scan.max + "."
      };
    }

    cell.setValue(scan.max);
    SpreadsheetApp.flush();
    console.log(
      "resyncLastReqNumber" + (!stale && force ? " (forced)" : "") + ": cell " + configCell +
      " " + previousRaw + " -> " + scan.max
    );

    return {
      success: true,
      updated: true,
      forced: !stale && force === true,
      configCell: configCell,
      previousValue: previousRaw,
      lastReq: scan.max,
      nextReqNumber: scan.max + 1,
      highestIssuedInOrdenes: scan.max,
      unusedNumbers: 0,
      scannedIdRows: scan.rows,
      reason: stale
        ? "Counter was blank/invalid or below the highest issued Req number - raised to " + scan.max + "."
        : "Forced write: counter pulled back to the highest issued Req number, gaps reclaimed."
    };
  } catch (e) {
    console.error("resyncLastReqNumber failed: " + e);
    return { success: false, updated: false, message: String(e) };
  }
}


function dispatchEmailWithProvider(mailDraft, provider) {
  const draft = Object.assign({}, mailDraft || {});
  draft.forceGraph = false;
  draft.fallbackProvider = provider;
  return SmartDispatcher(draft);
}




/**
 * Get available stock for CreateReq module
 * - Site users → only their site
 * - Main office users → Main + All Sectors combined
 */
function getAvailableStockForCreateReq(itemId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("Stock");
  if (!stockSheet) return 0;

  const data = stockSheet.getDataRange().getValues();
  let totalAvailable = 0;

  const key = normalizeLocationId_(itemId);
  const canonicalType = normalizeLocationType_(LOCATION_TYPE_SECTOR);

  for (let i = 1; i < data.length; i++) {
    if (normalizeLocationId_(data[i][0]) !== key) continue;         // ItemID
    if (normalizeLocationType_(data[i][2]) !== canonicalType) continue; // LocationType
    totalAvailable += Number(data[i][6]) || 0;                     // AvailableQty (col G)
  }

  return totalAvailable;
}



/**
 * Fetches a live map of item quantities filtered by a specific site/location.
 * If no site is provided, it aggregates all accessible main and sector inventory as a baseline.
 * * @param {string} site The selected site/faena name from the frontend UI
 * @return {Object} A lookup dictionary of { itemId: availableQty }
 */
function getLiveStockMap(site) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("Stock");
  const stockMap = {};
  
  if (!stockSheet) return stockMap;

  const data = stockSheet.getDataRange().getValues();
  const hasSiteFilter = site && String(site).trim() !== "";
  const normalizedSite = hasSiteFilter ? normalizeLocationId_(site) : "";
  const canonicalType = normalizeLocationType_(LOCATION_TYPE_SECTOR);

  // Loop through rows skipping the header row
  for (let i = 1; i < data.length; i++) {
    const itemId = normalizeLocationId_(data[i][0]);   // ItemID (Column A)
    if (!itemId) continue;

    const locType = normalizeLocationType_(data[i][2]); // LocationType (Column C)
    const locationId = normalizeLocationId_(data[i][3]); // LocationID / Sector name (Column D)
    const available = Number(data[i][6]) || 0;           // AvailableQty (Column G)

    if (hasSiteFilter) {
      // Rule: If the Site is not empty, use the stock of said Site
      if (locationId === normalizedSite) {
        stockMap[itemId] = (stockMap[itemId] || 0) + available;
      }
    } else {
      // Fallback: no site selected yet (Admin/Office view) -> every sector.
      // All locations are sectors, so this is simply the canonical type.
      if (locType === canonicalType) {
        stockMap[itemId] = (stockMap[itemId] || 0) + available;
      }
    }
  }

  return stockMap;
}