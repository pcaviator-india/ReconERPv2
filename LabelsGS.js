// Save or update a label template
function saveLabelTemplate(templateData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Labels");
  
  // Create the sheet if it doesn't exist yet
  if (!sheet) {
    sheet = ss.insertSheet("Labels");
    sheet.appendRow([
      "TemplateID", 
      "TemplateName", 
      "ElementsJSON", 
      "UpdatedAt",
      "CanvasWidth",
      "CanvasHeight"
    ]);
  } else {
    // Make sure the new columns exist on older sheets
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    if (headers.indexOf("CanvasWidth") === -1) {
      sheet.getRange(1, headers.length + 1).setValue("CanvasWidth");
    }
    if (headers.indexOf("CanvasHeight") === -1) {
      // Re-read headers in case we just added CanvasWidth
      const updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      sheet.getRange(1, updatedHeaders.length + 1).setValue("CanvasHeight");
    }
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Find column indexes safely
  const colTemplateId   = headers.indexOf("TemplateID") + 1;
  const colTemplateName = headers.indexOf("TemplateName") + 1;
  const colElementsJson = headers.indexOf("ElementsJSON") + 1;
  const colUpdatedAt    = headers.indexOf("UpdatedAt") + 1;
  const colCanvasWidth  = headers.indexOf("CanvasWidth") + 1;
  const colCanvasHeight = headers.indexOf("CanvasHeight") + 1;
  
  let rowIndex = -1;
  
  // Check if template already exists (by ID)
  for (let i = 1; i < data.length; i++) {
    if (data[i][colTemplateId - 1] === templateData.templateId) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const timestamp = new Date();
  const width  = templateData.canvasWidth  || "";
  const height = templateData.canvasHeight || "";
  
  if (rowIndex > -1) {
    // Update existing row
    sheet.getRange(rowIndex, colTemplateName).setValue(templateData.templateName);
    sheet.getRange(rowIndex, colElementsJson).setValue(templateData.elementsJson);
    sheet.getRange(rowIndex, colUpdatedAt).setValue(timestamp);
    
    if (colCanvasWidth > 0)  sheet.getRange(rowIndex, colCanvasWidth).setValue(width);
    if (colCanvasHeight > 0) sheet.getRange(rowIndex, colCanvasHeight).setValue(height);
  } else {
    // Append new row – build array dynamically based on column order
    const newRow = [];
    newRow[colTemplateId - 1]   = templateData.templateId || Utilities.getUuid();
    newRow[colTemplateName - 1] = templateData.templateName;
    newRow[colElementsJson - 1] = templateData.elementsJson;
    newRow[colUpdatedAt - 1]    = timestamp;
    
    if (colCanvasWidth > 0)  newRow[colCanvasWidth - 1]  = width;
    if (colCanvasHeight > 0) newRow[colCanvasHeight - 1] = height;
    
    sheet.appendRow(newRow);
  }
  
  return { success: true, message: "Template saved successfully!" };
}

// Fetch all templates or a specific template by ID
// Fetch all templates or a specific template by ID
function getLabelTemplates(templateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Labels");
  
  if (!sheet) return templateId ? null : [];
  
  const data = sheet.getDataRange().getValues();
  
  if (!data || data.length <= 1) {
    return templateId ? null : [];
  }
  
  const headers = data[0];
  const rows = data.slice(1);
  
  // Find column indexes
  const idxId     = headers.indexOf("TemplateID");
  const idxName   = headers.indexOf("TemplateName");
  const idxJson   = headers.indexOf("ElementsJSON");
  const idxDate   = headers.indexOf("UpdatedAt");
  const idxWidth  = headers.indexOf("CanvasWidth");
  const idxHeight = headers.indexOf("CanvasHeight");
  
  const templates = rows
    .filter(row => row[idxId]) // skip empty rows
    .map(row => ({
      templateId:   row[idxId],
      templateName: row[idxName] || "Untitled Template",
      elementsJson: row[idxJson],
      updatedAt:    row[idxDate] ? new Date(row[idxDate]).toISOString() : new Date().toISOString(),
      canvasWidth:  idxWidth  > -1 ? row[idxWidth]  : null,
      canvasHeight: idxHeight > -1 ? row[idxHeight] : null
    }));
  
  if (templateId) {
    return templates.find(t => t.templateId === templateId) || null;
  }
  
  return templates;
}

/*

function saveTemplateJSON() {
    const jsonString = JSON.stringify(canvas.toJSON());
    
    const templateData = {
        templateId: currentTemplateId || "template_" + Date.now(), // Unique ID or existing ID
        templateName: document.getElementById('template-name-input')?.value || "Default Label",
        elementsJson: jsonString
    };

    // Call the Google Apps Script backend function
    google.script.run
        .withSuccessHandler(function(response) {
            alert(response.message);
        })
        .withFailureHandler(function(error) {
            console.error("Failed to save template:", error);
            alert("Error saving template.");
        })
        .saveLabelTemplate(templateData);
}


function loadTemplateFromSheet(templateId) {
    // Call the Google Apps Script backend function to fetch from the "Labels" sheet
    google.script.run
        .withSuccessHandler(function(template) {
            if (template && template.elementsJson) {
                // Load the JSON string back into your Fabric.js canvas
                canvas.loadFromJSON(template.elementsJson, function() {
                    canvas.renderAll();
                    console.log("Template loaded successfully from Labels sheet!");
                });
            } else {
                alert("Template not found.");
            }
        })
        .withFailureHandler(function(error) {
            console.error("Failed to load template:", error);
        })
        .getLabelTemplates(templateId);
}

*/
function deleteLabelTemplate(templateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Labels");
  if (!sheet) return { success: false, message: "Labels sheet not found." };
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === templateId) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "Template deleted successfully." };
    }
  }
  return { success: false, message: "Template ID not found." };
}
