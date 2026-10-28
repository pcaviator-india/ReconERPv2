// OpSphereGS.gs - Database-driven Backend for OpSphere module
// All functions are prefixed with 'opSphere_' to avoid namespace collisions

/**
 * Automatically creates and populates the database sheets if they don't exist.
 * RUN THIS FUNCTION ONCE in the Apps Script editor to set up your sheets automatically!
 */
function opSphere_initializeDatabaseSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Sheet Definitions (Name: [Headers])
  const sheetDefs = {
    "Op_Rigs": ["Country", "Site", "RigId", "Status", "Lat", "Lng", "LastReport"],
    "Op_Personnel": ["RigId", "Name", "Role"],
    "Op_Operations": ["RigId", "Date", "Description"],
    "Op_Safety_Cameras": ["RigId", "SafetyScore", "Incidents", "LastIncident", "Cam1_Status", "Cam2_Status", "Cam3_Status"]
  };
  
  for (const [sheetName, headers] of Object.entries(sheetDefs)) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      
      // Auto-format header row
      sheet.getRange(1, 1, 1, headers.length)
           .setBackground("#1e293b") // Dark slate background
           .setFontColor("#ffffff")
           .setFontWeight("bold")
           .setHorizontalAlignment("center");
      
      // Add sample data to get started
      if (sheetName === "Op_Rigs") {
        sheet.appendRow(["USA", "Texas", "Rig-A1", "active", 31.9686, -99.9018, "2026-07-14"]);
        sheet.appendRow(["USA", "Texas", "Rig-B2", "maintenance", 32.7767, -96.7970, "2026-07-10"]);
        sheet.appendRow(["USA", "Alaska", "Rig-C3", "active", 61.2181, -149.9003, "2026-07-13"]);
        sheet.appendRow(["Canada", "Alberta", "Rig-D4", "active", 53.5444, -113.4909, "2026-07-12"]);
        sheet.appendRow(["Canada", "Alberta", "Rig-E5", "offline", 51.0486, -114.0708, "2026-07-01"]);
        sheet.appendRow(["Saudi Arabia", "Eastern Province", "Rig-F6", "active", 26.3351, 50.1533, "2026-07-14"]);
      } else if (sheetName === "Op_Personnel") {
        sheet.appendRow(["Rig-A1", "John Doe", "Drilling Engineer"]);
        sheet.appendRow(["Rig-A1", "Jane Smith", "Safety Officer"]);
        sheet.appendRow(["Rig-B2", "Mike Johnson", "Rig Manager"]);
        sheet.appendRow(["Rig-D4", "Alice Fletcher", "Geologist"]);
      } else if (sheetName === "Op_Operations") {
        sheet.appendRow(["Rig-A1", "2026-07-10", "Routine maintenance completed"]);
        sheet.appendRow(["Rig-A1", "2026-07-05", "Drilling depth threshold reached at 4,500m"]);
        sheet.appendRow(["Rig-B2", "2026-07-12", "Replacing drill bit assembly"]);
      } else if (sheetName === "Op_Safety_Cameras") {
        sheet.appendRow(["Rig-A1", 98, 0, "None", "online", "online", "offline"]);
        sheet.appendRow(["Rig-B2", 85, 1, "2026-05-12 Crane Malfunction", "online", "offline", "offline"]);
        sheet.appendRow(["Rig-C3", 100, 0, "None", "online", "online", "online"]);
      }
      
      sheet.autoResizeColumns(1, headers.length);
    }
  }
}

/**
 * Dynamically builds and returns the hierarchical structural data:
 * country -> site -> rig details
 */
function opSphere_getHierarchy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Op_Rigs");
  
  // Safety fallback if database setup hasn't been executed
  if (!sheet) {
    opSphere_initializeDatabaseSheets();
    return opSphere_getHierarchy();
  }
  
  const data = sheet.getDataRange().getValues();
  const hierarchy = {};
  
  // Skip row index 0 (Headers)
  for (let i = 1; i < data.length; i++) {
    const [country, site, rigId, status, lat, lng, lastReport] = data[i];
    
    if (!country || !site || !rigId) continue;
    
    if (!hierarchy[country]) {
      hierarchy[country] = {};
    }
    if (!hierarchy[country][site]) {
      hierarchy[country][site] = {};
    }
    
    hierarchy[country][site][rigId] = {
      status: String(status).toLowerCase(),
      lat: Number(lat),
      lng: Number(lng),
      lastReport: String(lastReport)
    };
  }
  
  return hierarchy;
}

/**
 * Returns deep-dive structural information for a selected rig.
 * Dynamically queries Op_Personnel, Op_Operations, and Op_Safety_Cameras.
 */
function opSphere_getRigDetails(country, site, rigId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Default fallback structure in case details row is missing
  const details = {
    rigId: rigId,
    country: country,
    site: site,
    status: "unknown",
    operations: [],
    personnel: [],
    safety: { safetyScore: 100, incidents: 0, lastIncident: "None" },
    cameras: [
      { id: "cam1", name: "Main Rig Floor", status: "offline" },
      { id: "cam2", name: "Derrick Substructure", status: "offline" },
      { id: "cam3", name: "Generator Bay", status: "offline" }
    ]
  };

  // 2. Fetch Status directly from Master Rigs sheet
  const rigsSheet = ss.getSheetByName("Op_Rigs");
  if (rigsSheet) {
    const rigsData = rigsSheet.getDataRange().getValues();
    for (let i = 1; i < rigsData.length; i++) {
      if (rigsData[i][2] === rigId) {
        details.status = String(rigsData[i][3]).toLowerCase();
        break;
      }
    }
  }

  // 3. Query Personnel from "Op_Personnel" sheet
  const personnelSheet = ss.getSheetByName("Op_Personnel");
  if (personnelSheet) {
    const personnelData = personnelSheet.getDataRange().getValues();
    for (let i = 1; i < personnelData.length; i++) {
      const [pRigId, name, role] = personnelData[i];
      if (pRigId === rigId) {
        details.personnel.push({ name: name, role: role });
      }
    }
  }

  // 4. Query Operations from "Op_Operations" sheet
  const operationsSheet = ss.getSheetByName("Op_Operations");
  if (operationsSheet) {
    const opsData = operationsSheet.getDataRange().getValues();
    for (let i = 1; i < opsData.length; i++) {
      const [oRigId, date, description] = opsData[i];
      if (oRigId === rigId) {
        details.operations.push({
          date: Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), "yyyy-MM-dd"),
          description: description
        });
      }
    }
  }

  // 5. Query Safety Metrics and Camera Statuses
  const safetySheet = ss.getSheetByName("Op_Safety_Cameras");
  if (safetySheet) {
    const safetyData = safetySheet.getDataRange().getValues();
    for (let i = 1; i < safetyData.length; i++) {
      const [sRigId, score, incidents, lastIncident, cam1, cam2, cam3] = safetyData[i];
      if (sRigId === rigId) {
        details.safety = {
          safetyScore: Number(score),
          incidents: Number(incidents),
          lastIncident: String(lastIncident)
        };
        details.cameras = [
          { id: "cam1", name: "Main Rig Floor", status: String(cam1).toLowerCase() },
          { id: "cam2", name: "Derrick Substructure", status: String(cam2).toLowerCase() },
          { id: "cam3", name: "Generator Bay", status: String(cam3).toLowerCase() }
        ];
        break;
      }
    }
  }

  return details;
}

/**
 * Returns a list of all unique country names in our sheets.
 */
function opSphere_getCountries() {
  const hierarchy = opSphere_getHierarchy();
  return Object.keys(hierarchy);
}


function getCesiumToken() {
  // Pulls the value you saved under the key 'CESIUM_ION_TOKEN'
  return PropertiesService.getScriptProperties().getProperty('CESIUM_ION_TOKEN');
}