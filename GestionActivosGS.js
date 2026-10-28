/**
 * Target Sheet: Movement_Val
 * Col B: Maquinaria | Col C: Generadores | Col D: Vehículos
 */

function getSheetColForType(assetType) {
  switch (assetType) {
    case 'maquinaria': return 2;   // Col B
    case 'generadores': return 3;  // Col C
    case 'vehiculos': return 4;    // Col D
    default: throw new Error('Tipo de activo no válido.');
  }
}

/**
 * Helper to check if role is authorized (admin or manager)
 */
function isAuthorizedRole(userRole) {
  return userRole === 'admin' || userRole === 'manager';
}

/**
 * Retrieves assets for the selected tab from Movement_Val
 */
function getAssetsData(assetType) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Movement_Val");
  
  if (!sheet) return [];
  
  const colIndex = getSheetColForType(assetType);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  // Read column starting from Row 2 (skipping header)
  const rangeValues = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  const result = [];
  
  rangeValues.forEach((row, idx) => {
    const val = String(row[0] || '').trim();
    if (val !== '') {
      result.push({
        _rowIndex: idx + 2, // Sheet row index
        name: val
      });
    }
  });
  
  return result;
}

/**
 * Saves (Create or Update) an asset in Movement_Val
 */
function saveAsset(assetType, assetData, isEdit, userRole) {
  // Security Enforcement: Server-side check (admin or manager for editing)
  if (isEdit && !isAuthorizedRole(userRole)) {
    throw new Error('Acceso denegado: Solo usuarios con rol Admin o Manager pueden editar registros.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Movement_Val");

  if (!sheet) {
    throw new Error('La hoja "Movement_Val" no existe.');
  }

  const colIndex = getSheetColForType(assetType);
  const nameValue = String(assetData.name || '').trim();

  if (!nameValue) {
    throw new Error('El nombre o identificador no puede estar vacío.');
  }

  if (isEdit && assetData._rowIndex) {
    // Edit existing cell
    sheet.getRange(assetData._rowIndex, colIndex).setValue(nameValue);
  } else {
    // Add new asset: Find first empty row in this specific column or append
    const lastRow = sheet.getLastRow();
    let targetRow = 0;

    if (lastRow > 1) {
      const colValues = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
      for (let i = 0; i < colValues.length; i++) {
        if (String(colValues[i][0] || '').trim() === '') {
          targetRow = i + 2;
          break;
        }
      }
    }

    if (targetRow === 0) {
      targetRow = Math.max(lastRow + 1, 2);
    }

    sheet.getRange(targetRow, colIndex).setValue(nameValue);
  }

  return true;
}

/**
 * Deletes (Clears cell) an asset record
 */
function deleteAsset(assetType, rowIndex, userRole) {
  // Security Enforcement: Server-side check (admin or manager for deleting)
  if (!isAuthorizedRole(userRole)) {
    throw new Error('Acceso denegado: Solo usuarios con rol Admin o Manager pueden eliminar registros.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Movement_Val");

  if (sheet && rowIndex) {
    const colIndex = getSheetColForType(assetType);
    sheet.getRange(rowIndex, colIndex).clearContent();
    return true;
  }
  throw new Error('No se pudo encontrar el registro a eliminar.');
}

