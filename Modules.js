function extractCategoriesAndSubcategories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Get source and target sheets
  const masterSheet = ss.getSheetByName("Master");
  const validationSheet = ss.getSheetByName("Validation");
  
  if (!masterSheet || !validationSheet) {
    Logger.log("Error: Please check that both 'Master' and 'Validation' sheets exist.");
    return;
  }

  // Column C = Column index 3 (Category)
  // Column D = Column index 4 (Sub categoria)
  const CATEGORY_COL_INDEX = 3;     // Column C
  const SUB_CATEGORY_COL_INDEX = 4; // Column D
  const START_ROW = 2;              // Assuming Row 1 contains headers

  const lastRow = masterSheet.getLastRow();
  if (lastRow < START_ROW) return; // Exit if no data rows present

  // Fetch all values from sheet "Master"
  const masterData = masterSheet.getRange(
    START_ROW, 
    1, 
    lastRow - START_ROW + 1, 
    masterSheet.getLastColumn()
  ).getValues();

  // ----------------------------------------------------
  // PASS 1: Build a lookup map of known Subcategory -> Category mappings
  // ----------------------------------------------------
  const knownCategoryMap = new Map();

  masterData.forEach(row => {
    const parent = row[CATEGORY_COL_INDEX - 1] ? String(row[CATEGORY_COL_INDEX - 1]).trim() : "";
    const sub = row[SUB_CATEGORY_COL_INDEX - 1] ? String(row[SUB_CATEGORY_COL_INDEX - 1]).trim() : "";

    if (sub !== "" && parent !== "") {
      const subKey = sub.toUpperCase();
      if (!knownCategoryMap.has(subKey)) {
        knownCategoryMap.set(subKey, parent);
      }
    }
  });

  // ----------------------------------------------------
  // PASS 2: Extract unique pairs applying resolution rules
  // ----------------------------------------------------
  const uniquePairsMap = new Map();

  masterData.forEach(row => {
    let parent = row[CATEGORY_COL_INDEX - 1] ? String(row[CATEGORY_COL_INDEX - 1]).trim() : "";
    const sub = row[SUB_CATEGORY_COL_INDEX - 1] ? String(row[SUB_CATEGORY_COL_INDEX - 1]).trim() : "";

    if (sub !== "") {
      const subKey = sub.toUpperCase();

      // Rule 1: Subcategory "EPP" is always "Operaciones"
      if (subKey === "EPP") {
        parent = "Operaciones";
      } 
      // Rule 2: If category is missing, check if this subcategory was mapped elsewhere in the sheet
      else if (parent === "") {
        if (knownCategoryMap.has(subKey)) {
          parent = knownCategoryMap.get(subKey); // Adopt the known parent category (e.g., DDH -> Operaciones)
        } else {
          parent = "General"; // Rule 3: Fallback if subcategory was never given a category anywhere
        }
      }

      const pairKey = `${parent}____${sub}`;
      if (!uniquePairsMap.has(pairKey)) {
        uniquePairsMap.set(pairKey, [parent, sub]);
      }
    }
  });

  const outputData = Array.from(uniquePairsMap.values());

  if (outputData.length === 0) {
    Logger.log("No category data found in columns C and D.");
    return;
  }

  // 3. Output to "Validation" sheet starting at Column H (Column 8)
  const targetStartRow = 1;
  const targetStartCol = 8; // Column 8 = H (H: Parent Category, I: Sub Category)

  // Write Headers to Row 1 (Cols H & I)
  validationSheet.getRange(targetStartRow, targetStartCol, 1, 2).setValues([
    ["Parent Category", "Sub Category"]
  ]);

  // Clear previous data in columns H & I below the header row
  const maxRows = validationSheet.getMaxRows();
  if (maxRows > 1) {
    validationSheet.getRange(2, targetStartCol, maxRows - 1, 2).clearContent();
  }

  // Insert extracted unique pairs
  validationSheet.getRange(2, targetStartCol, outputData.length, 2).setValues(outputData);
}