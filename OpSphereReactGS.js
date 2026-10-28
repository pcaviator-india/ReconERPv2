/**
 * @OnlyCurrentDoc
 */
// OpSphereReact.gs - Backend for React-based OpSphere module
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
        sheet.appendRow(["Norway", "North Sea", "Rig-G7", "active", 59.5, 2.8, "2026-07-13"]);
        sheet.appendRow(["Brazil", "Santos Basin", "Rig-H8", "maintenance", -24.5, -42.8, "2026-07-11"]);
      } else if (sheetName === "Op_Personnel") {
        sheet.appendRow(["Rig-A1", "J. Rodriguez", "Toolpusher"]);
        sheet.appendRow(["Rig-A1", "M. Chen", "Driller"]);
        sheet.appendRow(["Rig-A1", "A. Kowalski", "Mud Engineer"]);
        sheet.appendRow(["Rig-B2", "S. Okafor", "Derrickhand"]);
        sheet.appendRow(["Rig-B2", "R. Patel", "Motorman"]);
        sheet.appendRow(["Rig-C3", "K. Johansson", "Roughneck"]);
        sheet.appendRow(["Rig-D4", "A. Fletcher", "Geologist"]);
        sheet.appendRow(["Rig-F6", "H. Al-Rashid", "Rig Manager"]);
      } else if (sheetName === "Op_Operations") {
        sheet.appendRow(["Rig-A1", "2026-07-15", "Routine maintenance completed on mud pumps"]);
        sheet.appendRow(["Rig-A1", "2026-07-14", "Drilling resumed at 3,240m depth"]);
        sheet.appendRow(["Rig-A1", "2026-07-13", "Casing cemented successfully at 2,800m"]);
        sheet.appendRow(["Rig-A1", "2026-07-12", "BOP stack tested - all functions nominal"]);
        sheet.appendRow(["Rig-A1", "2026-07-11", "New drill bit installed - PDC 8.5\""]);
        sheet.appendRow(["Rig-B2", "2026-07-12", "Replacing drill bit assembly"]);
        sheet.appendRow(["Rig-C3", "2026-07-13", "Directional drilling survey completed"]);
      } else if (sheetName === "Op_Safety_Cameras") {
        sheet.appendRow(["Rig-A1", 98, 0, "None", "online", "online", "offline"]);
        sheet.appendRow(["Rig-B2", 85, 1, "2026-05-12 Crane Malfunction", "online", "offline", "offline"]);
        sheet.appendRow(["Rig-C3", 100, 0, "None", "online", "online", "online"]);
        sheet.appendRow(["Rig-D4", 92, 0, "None", "online", "online", "online"]);
        sheet.appendRow(["Rig-F6", 95, 0, "None", "online", "online", "online"]);
      }
      
      sheet.autoResizeColumns(1, headers.length);
    }
  }
}

/**
 * Dynamically builds and returns the hierarchical structural data:
 * country -> site -> rig details
 * Called by the frontend to populate the globe
 */
function opSphere_getHierarchy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Op_Rigs");
  
  // Safe execution pattern without recursive loops
  if (!sheet) {
    opSphere_initializeDatabaseSheets();
    sheet = ss.getSheetByName("Op_Rigs");
    if (!sheet) {
      throw new Error("Failed to access initialized database repository mapping layer.");
    }
  }
  
  return opSphere_getHierarchyFromSheet(sheet);
}

/**
 * Internal helper to extract hierarchy from a sheet
 */
function opSphere_getHierarchyFromSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  const hierarchy = {};
  
  // Skip row index 0 (Headers)
  for (let i = 1; i < data.length; i++) {
    const [country, site, rigId, status, lat, lng, lastReport] = data[i];
    
    if (!country || !site || !rigId) continue;
    
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (isNaN(latitude) || isNaN(longitude)) {
      console.warn(`Invalid coordinates for rig ${rigId}: lat=${lat}, lng=${lng}`);
      continue;
    }
    
    if (!hierarchy[country]) {
      hierarchy[country] = {};
    }
    if (!hierarchy[country][site]) {
      hierarchy[country][site] = {};
    }
    
    hierarchy[country][site][rigId] = {
      status: String(status).toLowerCase(),
      lat: latitude,
      lng: longitude,
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
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
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

    // 1. Fetch Status directly from Master Rigs sheet
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

    // 2. Query Personnel from "Op_Personnel" sheet
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

    // 3. Query Operations from "Op_Operations" sheet
    const operationsSheet = ss.getSheetByName("Op_Operations");
    if (operationsSheet) {
      const opsData = operationsSheet.getDataRange().getValues();
      const timeZone = Session.getScriptTimeZone();
      
      for (let i = 1; i < opsData.length; i++) {
        const [oRigId, date, description] = opsData[i];
        if (oRigId === rigId) {
          let formattedDate = "";
          try {
            if (date instanceof Date && !isNaN(date.getTime())) {
              formattedDate = Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
            } else if (date) {
              const parsedDate = new Date(date);
              formattedDate = (!isNaN(parsedDate.getTime())) ? 
                Utilities.formatDate(parsedDate, timeZone, "yyyy-MM-dd") : String(date);
            }
          } catch (e) {
            formattedDate = String(date);
          }
          
          details.operations.push({
            date: formattedDate,
            description: description
          });
        }
      }
    }

    // 4. Query Safety Metrics and Camera Statuses
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
  } catch (error) {
    console.error(`Error in opSphere_getRigDetails for ${rigId}:`, error);
    return {
      error: true,
      message: error.toString(),
      rigId: rigId,
      country: country,
      site: site
    };
  }
}

/**
 * High-performance extraction tool to pull unique countries
 */
function opSphere_getCountries() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Op_Rigs");
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  const countries = new Set();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      countries.add(String(data[i][0]).trim());
    }
  }
  return Array.from(countries);
}

/**
 * Returns the Cesium Ion token securely from Script Properties.
 */
function opSphere_getCesiumToken() {
  return PropertiesService.getScriptProperties().getProperty('CESIUM_ION_TOKEN');
}