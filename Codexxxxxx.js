// Code.gs - Google Apps Script Deployment
// This module serves the RECON ERP application as a web app.

/**
 * Serve the main landing page (Index.html)
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve inventory movement page
 */
function invMov() {
  return HtmlService.createHtmlOutputFromFile('InvMov')
    .setTitle('Inventory Movement - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve dashboard page
 */
function dashboard() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Dashboard - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve quote management page
 */
function quoteMgmt() {
  return HtmlService.createHtmlOutputFromFile('QuoteMgmt')
    .setTitle('Quote Management - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve products page
 */
function products() {
  return HtmlService.createHtmlOutputFromFile('Products')
    .setTitle('Products - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve scan / scanner page
 */
function scanner() {
  return HtmlService.createHtmlOutputFromFile('Scanner')
    .setTitle('Scanner - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve quote report page
 */
function quoteReport() {
  return HtmlService.createHtmlOutputFromFile('QuoteReport')
    .setTitle('Quote Report - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve import inventory page
 */
function importInv() {
  return HtmlService.createHtmlOutputFromFile('ImportInv')
    .setTitle('Import Inventory - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve lifecycle report page
 */
function lifecycleReport() {
  return HtmlService.createHtmlOutputFromFile('LifecycleReport')
    .setTitle('Lifecycle Report - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve location map page
 */
function locationMap() {
  return HtmlService.createHtmlOutputFromFile('LocationMap')
    .setTitle('Location Map - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve MovScanner page (daily movements)
 */
function dailyMovements() {
  return HtmlService.createHtmlOutputFromFile('MovScanner')
    .setTitle('Daily Movements - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve OpSphere page
 */
function opSphere() {
  return HtmlService.createHtmlOutputFromFile('OpSphere')
    .setTitle('OpSphere - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve OpSphere React page
 */
function opSphereReact() {
  return HtmlService.createHtmlOutputFromFile('OpSphereReact')
    .setTitle('OpSphere - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve quote template page
 */
function quoteTemplate() {
  return HtmlService.createHtmlOutputFromFile('Quote_Template')
    .setTitle('Quote Template - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve request template page
 */
function reqTemplate() {
  return HtmlService.createHtmlOutputFromFile('REQ_Template')
    .setTitle('Request Template - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve request creation page
 */
function createReq() {
  return HtmlService.createHtmlOutputFromFile('CreateReq')
    .setTitle('Create Requirement - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve stock page
 */
function stock() {
  return HtmlService.createHtmlOutputFromFile('Stock')
    .setTitle('Stock Page - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve admin validation page
 */
function adminVal() {
  return HtmlService.createHtmlOutputFromFile('AdminVal')
    .setTitle('Admin Validation - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve Azure test page
 */
function azureTest() {
  return HtmlService.createHtmlOutputFromFile('AzureTest')
    .setTitle('Azure Test - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve bundle page
 */
function bundles() {
  return HtmlService.createHtmlOutputFromFile('Bundles')
    .setTitle('Bundles - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve control combustible page
 */
function controlCombustible() {
  return HtmlService.createHtmlOutputFromFile('ControlCombustible')
    .setTitle('Control Combustible - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve create bulk PO MAC page
 */
function createBulkPOMAC() {
  return HtmlService.createHtmlOutputFromFile('CreateBulkPOMAC')
    .setTitle('Create Bulk PO - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve create PIN page
 */
function editPin() {
  return HtmlService.createHtmlOutputFromFile('EditPin')
    .setTitle('Edit PIN - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve gestion activos page
 */
function gestionActivos() {
  return HtmlService.createHtmlOutputFromFile('GestionActivos')
    .setTitle('Gestión Activos - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Serve request view/edit page
 */
function viewEditReq() {
  return HtmlService.createHtmlOutputFromFile('ViewEditReqJS')
    .setTitle('View/Edit Request - RECON ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

/**
 * Handle API calls (proxy to backend or direct Cloud Functions)
 */
function doPost(e) {
  // Proxy POST requests to a backend service
  const payload = JSON.parse(e.postData.contents);
  
  try {
    // Example: forward to a Google Cloud Function or Firebase function
    const response = fetch(
      'https://your-backend-endpoint.com/api',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    
    return ContentService.createTextOutput(JSON.stringify(response.json()))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(500);
  }
}

/**
 * Handle GET requests for API routes
 */
function doGetForAPI(e) {
  const params = new URLSearchParams(e.parameter);
  const path = params.get('path') || '';
  
  try {
    // Forward to backend or handle directly
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(500);
  }
}
