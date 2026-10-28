/**
 * viewEditReqGS.js
 * Backend operations for Requirement Viewing, Editing, and Item-Level Status Management
 */

/**
 * Retrieves full details for a single Order ID, including per-item statuses.
 * @param {string|number} orderId
 * @returns {Object|null}
 */
function getRequirementDetailsById(orderId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => { colMap[String(h).trim()] = i; });

    const cleanOrderId = String(orderId).trim();
    const items = [];
    let headerInfo = null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowOrderId = String(row[colMap["Order"] || 0]).trim();

      if (rowOrderId === cleanOrderId) {
        if (!headerInfo) {
          headerInfo = {
            orderId: cleanOrderId,
            fecha: row[colMap["Fecha/Hora"] || 1] ? row[colMap["Fecha/Hora"] || 1].toLocaleString() : "",
            faena: row[colMap["Faena"] || 4] || "",
            user: row[colMap["User"] || 11] || row[colMap["User"] || 8] || "",
            category: row[colMap["Category"] || 12] || "General",
            pdfUrl: row[colMap["Req PDF Link"] || 10] || "",
            subArea: row[colMap["SubArea"]] || "",
            subAreaNo: row[colMap["SubArea No"]] || "",
            createdBy: row[colMap["User"] || 11] || "",
            notes: (colMap["Notes"] !== undefined ? row[colMap["Notes"]] : "") || "",
            modifiedBy: row[colMap["lastModifiedBy"]] || "",
            modifiedDate: row[colMap["lastModifiedDate"]] || "",
            modCount: row[colMap["modCount"]] || 1
          };
        }

        items.push({
          rowIndex: i + 1,
          pn: row[colMap["P/N"] || 2] || "",
          geo: row[colMap["Geo Code"] || 3] || "",
          desc: row[colMap["Desc Es"] || 5] || "",
          es: row[colMap["Desc Es"] || 5] || "",
          cant: row[colMap["Cantidad"] || 6] || 0,
          qty: row[colMap["Cantidad"] || 6] || 0,
          itemNotes: (colMap["Item Notes"] !== undefined ? row[colMap["Item Notes"]] : "") || "",
          estado: row[colMap["Estado"] || 7] || "Pending" // Per-item status
        });
      }
    }

    if (!headerInfo) return null;

    return {
      header: headerInfo,
      items: items
    };
  } catch (e) {
    console.error("Error in getRequirementDetailsById: " + e.toString());
    return null;
  }
}

/**
 * Updates individual item status for specific rows of a Requirement
 * @param {string|number} orderId
 * @param {Array<{pn: string, geo: string, estado: string}>} itemStatusUpdates
 * @returns {Object}
 */
function updateItemStatuses(orderId, itemStatusUpdates) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ordenes");
    const data = sheet.getDataRange().getValues();

    const headers = data[0];
    const colMap = {};
    headers.forEach((h, i) => { colMap[String(h).trim()] = i; });

    const statusColIdx = colMap["Estado"] !== undefined ? colMap["Estado"] : 7;
    const cleanOrderId = String(orderId).trim();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const rowOrderId = String(data[i][colMap["Order"] || 0]).trim();
      if (rowOrderId === cleanOrderId) {
        const rowPn = String(data[i][colMap["P/N"] || 2]).trim();
        const rowGeo = String(data[i][colMap["Geo Code"] || 3]).trim();

        // Match incoming item updates by P/N or Geo Code
        const match = itemStatusUpdates.find(u => 
          (u.geo && String(u.geo).trim() === rowGeo) || 
          (u.pn && String(u.pn).trim() === rowPn)
        );

        if (match && match.estado) {
          sheet.getRange(i + 1, statusColIdx + 1).setValue(match.estado);
          updatedCount++;
        }
      }
    }

    return { success: true, updatedItems: updatedCount };
  } catch (e) {
    console.error("Error updating item statuses: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Updates a full requirement with item-level statuses
 * @param {string|number} orderId
 * @param {Object} header - Header info (faena, userName)
 * @param {Array} items - Array of items with geo, pn, desc, cant, estado, es, en
 * @param {string} [customRecipient] - Optional custom recipient email
 * @returns {Object}
 */
function updateRequirementOnSheetWithItemStatuses(orderId, header, items, customRecipient, jobId) {
  // Background-job progress (best-effort): when the client fires this as a
  // fire-and-forget call, jobId lets the floating bubble poll live progress
  // on a separate google.script.run channel while the user keeps working.
  // Accepts jobId as 5th arg OR header._jobId for backward compat.
  var __bgJobId = jobId || (header && header._jobId) || null;
  function __bg(pct, step) { try { if (__bgJobId) bgUpdateJob(__bgJobId, pct, step); } catch (e) {} }
  __bg(8, "Loading requirement…");
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

  console.log("DEBUG: Found", matchingRows.length, "rows for Order ID:", orderId);

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

  // Per-item notes ("Item Notes"): resolved lazily so the column is created on
  // first use, and read back for the regenerated PDF when the caller (non
  // manager) did not send any value.
  let itemNotesColIdx = -1;
  let storedItemNotes = {};
  try {
    itemNotesColIdx = getOrdenesItemNotesColumn_(sheet);
    storedItemNotes = getItemNotesByOrder_(orderId);
  } catch (notesErr) {
    console.warn("DEBUG updateRequirementOnSheetWithItemStatuses: item notes unavailable:", notesErr.toString());
  }

  // Supplier-facing notes ("Supplier Notes"): resolved lazily so the column is
  // created on first use. Written only when the caller (Admin/Manager editing in
  // the Approve Requirement screen) actually sent the field; otherwise the
  // stored note is preserved. These notes travel to the supplier RFQ email.
  let supplierNotesColIdx = -1;
  try {
    supplierNotesColIdx = getOrdenesSupplierNotesColumn_(sheet);
  } catch (supplierNotesErr) {
    console.warn("DEBUG updateRequirementOnSheetWithItemStatuses: supplier notes unavailable:", supplierNotesErr.toString());
  }

  // Stored per-item photos ("Item Images"): read back for the regenerated PDF
  // and the update email (the edit modal never sends images). Never written
  // here — the full rowData rewrite below already preserves the column.
  let storedItemImages = {};
  try {
    storedItemImages = getItemImagesByOrder_(orderId);
  } catch (imagesErr) {
    console.warn("DEBUG updateRequirementOnSheetWithItemStatuses: item images unavailable:", imagesErr.toString());
  }

  // Create PDF with updated requirement BEFORE sheet update
  let pdfUrl = "";
  // Hoisted: the SAME enriched items feed the PDF above AND the update email
  // below, so both keep the per-item notes and photos even though the edit
  // modal only ever sends status/notes/qty fields.
  let itemsForPdf = items || [];
  try {
    __bg(25, "Building PDF…");
    itemsForPdf = (items || []).map(function (it) {
      const geo = String((it && it.geo) || "").trim();
      const notes = (it && it.itemNotes !== undefined)
        ? it.itemNotes
        : (storedItemNotes[geo] || "");
      // Photos: the edit modal never sends them, so fall back to the stored
      // "Item Images" cell — otherwise the regenerated PDF loses its "Photo N"
      // links and the update email loses its Images column on every edit.
      const images = (it && it.images !== undefined)
        ? it.images
        : (storedItemImages[geo] || "");
      return Object.assign({}, it, { itemNotes: notes, images: images });
    });
    const shipmentData = {
      orderId: orderId,
      category: originalCategory,
      site: header.faena,
      items: itemsForPdf,
      createdBy: originalCreator,
      modifiedBy: currentUserName,
      userName: originalCreator,
      modCount: newModCount
    };
    pdfUrl = orchestrateRequirementPDF(orderId, shipmentData);
    console.log("DEBUG updateRequirementOnSheetWithItemStatuses: PDF created successfully:", pdfUrl);
    __bg(55, "PDF ready — saving to sheet…");
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

      // Per-item notes (Workshop): written only when the caller actually sent
      // the field (Admin / Manager editing in the Approve Requirement screen).
      // Everyone else sends `undefined`, so the stored note is preserved.
      if (itemNotesColIdx >= 0 && item.itemNotes !== undefined) {
        rowData[itemNotesColIdx] = cleanReqNotes_(item.itemNotes);
        console.log("DEBUG:   Set Item Notes to: " + rowData[itemNotesColIdx]);
      }

      // Supplier-facing note: written only when the caller actually sent the
      // field (Admin / Manager editing in the Approve Requirement screen).
      // Everyone else sends `undefined`, so the stored note is preserved.
      if (supplierNotesColIdx >= 0 && item.supplierNotes !== undefined) {
        rowData[supplierNotesColIdx] = cleanReqNotes_(item.supplierNotes);
        console.log("DEBUG:   Set Supplier Notes to: " + rowData[supplierNotesColIdx]);
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
    try { if (__bgJobId) bgFinishJob(__bgJobId, false, { step: "Sheet save failed", error: sheetErr.toString() }); } catch (e) {}
    throw sheetErr;
  }
  __bg(70, "Sheet saved — sending email…");

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
      // Enriched items (stored notes + photos merged in above) so the update
      // email's table matches the original requirement email.
      items: itemsForPdf,
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
      __bg(92, "Email sent — wrapping up…");

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

  return (function __finish(result) {
    try {
      if (__bgJobId) {
        if (result && result.requiresConfirmation) {
          bgFinishJob(__bgJobId, false, { step: "Needs recipient confirmation", error: result.message || "confirm recipients" });
        } else {
          bgFinishJob(__bgJobId, true, {
            pdfUrl: pdfUrl,
            emailSent: result ? result.emailSent : undefined,
            result: { orderId: orderId, pdfUrl: pdfUrl }
          });
        }
      }
    } catch (e) {}
    return result;
  })({
    success: true,
    orderId: orderId,
    category: originalCategory,
    ...emailStatus
  });
}

/**
 * Wrapper function to update a full requirement and notify recipients
 */

/**
 * Job-compatible wrapper for the requirement approve/edit save.
 * Runs the fast sheet write, then the slow PDF/email/stock in the
 * background; reports progress through bgUpdateJob/bgFinishJob.
 */
function viewEdit_UpdateRequirementBg(orderId, header, items, customRecipient) {
  return viewEdit_UpdateRequirement(orderId, header, items, customRecipient);
}
