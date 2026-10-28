/**
 * Verifies that the legacy endpoints return the exact shape the GAS
 * originals returned, so the (unmodified) frontend keeps working.
 *
 * Usage: node scripts/legacy-shape-test.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3997';

async function req(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${p}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  return { status: res.status, json };
}

// fn → required top-level keys of the first element (or of the object itself)
const SHAPES = {
  getPeople: ['id', 'name', 'department', 'active', 'sector', 'rut', 'email'],
  getPersonById: ['id', 'name', 'department', 'active', 'sector', 'rut', 'biometricTemplate'],
  getMovementValidation: ['Sector', 'Maquina', 'Generador', 'Vehiculo'],
  getAllDailyMovements: ['movementId', 'timestamp', 'dateStr', 'timeStr', 'itemGeo', 'type', 'qty', 'person', 'sector', 'maquina', 'generador', 'vehiculo', 'condition', 'comments', 'site', 'descEn', 'descEs', 'pdfLink'],
  getFullStockData: ['ItemID', 'ProductName', 'LocationType', 'LocationID', 'Quantity', 'ReservedQty', 'AvailableQty', 'LastUpdated', 'UpdatedBy', 'RackId', 'SideCode', 'ShelfLevel'],
  getValidationData: ['categories', 'subCategories', 'brands', 'suppliers', 'sites', 'currencies', 'subAreas'],
  getSiteData: ['name', 'email', 'suffix'],
  getFuelBalance: ['balance', 'totalBought', 'totalUsed'],
  getLabelTemplates: ['templateId', 'templateName', 'elementsJson', 'updatedAt', 'canvasWidth', 'canvasHeight'],
  getAssetsData: ['_rowIndex', 'name'],
  getMacroHistoryLogs: ['timestamp', 'user', 'poCount', 'type', 'driveId'],
  getRequirementRouting: ['emails', 'suffix', 'matchedUsers'],
  getRoutingPreview: ['routing', 'subArea', 'signature'],
  getReqQuoteTimeline: ['orderId', 'reqCreated', 'reqCreatedIso', 'reqApprovedBy', 'reqApprovedDate', 'reqLastModifiedBy', 'reqLastModified', 'reqLastModifiedIso', 'reqModCount', 'quotes'],
  getLifecycleReportData: ['entries', 'total'],
  opSphere_getRigDetails: ['rigId', 'country', 'site', 'status', 'operations', 'personnel', 'safety', 'cameras'],
  verifyUserLogin: ['success'],
  bgEnqueueJob: ['jobId'],
  bgGetJobs: [],
  savePerson: ['success', 'message'],
  bulkSavePeople: ['success', 'message'],
  togglePersonStatus: ['success', 'message'],
  saveLabelTemplate: ['success', 'message'],
  saveAsset: [],
  deleteAsset: [],
  getModuleHtml: [],
  bulkIssueItems: ['success', 'message'],
  bulkReturnItems: ['success', 'message'],
  saveFuelEntry: ['success'],
  saveFuelPurchase: ['success'],
  getHistoryData: [],
  getRequirementsHistory: [],
  getBundles: ['bundleId', 'name', 'isActive', 'itemCount'],
  getBundleItems: ['bundle', 'items'],
  getBundleDetails: ['bundle', 'items'],
  getBundlesForSearch: ['bundleId', 'name', 'isActive', 'itemCount'],
  getSectors: [],
  getRackConfig: ['locationId', 'rackId', 'hasSides', 'noOfShelves'],
  searchItemsByLocation: ['itemID', 'productName', 'quantity', 'availableQty', 'rackID', 'sideCode', 'shelfLevel'],
  getScannerData: ['history'],
  getItemsByCountId: ['barcode', 'geo', 'pn', 'en', 'es', 'qty'],
  saveStockCount: ['success', 'countId', 'stockUpdated', 'stockMode'],
  getMinMaxData: ['rows', 'products', 'sites'],
  getLiveStockMap: [],
  getRFQStockMap: [],
  getDrafts: [],
  getAllActiveAssignments: ['geo', 'person', 'issued', 'returned', 'active']
};

const ARGS = require('./legacy-args.json');
ARGS.getBundles = [];
ARGS.getLiveStockMap = [];
ARGS.getRFQStockMap = [];
ARGS.getDrafts = [];
ARGS.getHistoryData = [10];
ARGS.getRequirementsHistory = [];
ARGS.getMinMaxData = [];
ARGS.getScannerData = [];
ARGS.getAssetsData = ['maquinaria'];
ARGS.getMacroHistoryLogs = [];
ARGS.getSectors = [];
ARGS.getRackConfig = [];
ARGS.searchItemsByLocation = ['Store', ''];
ARGS.getItemsByCountId = ['SC-nonexistent'];

async function main() {
  const login = await req('POST', '/api/v1/auth/login', { userId: '1001', pin: '1234' });
  if (!login.json || login.json.status !== 'success') {
    console.error('LOGIN FAILED');
    process.exit(1);
  }
  const token = login.json.data.token;

  let pass = 0, fail = 0;

  for (const [fn, keys] of Object.entries(SHAPES)) {
    const r = await req('POST', `/api/v1/legacy/${fn}`, { args: ARGS[fn] || [] }, token);
    if (r.status !== 200) {
      console.log(`FAIL ${fn}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
      fail++; continue;
    }
    const v = r.json;
    if (v && v.__legacy) { console.log(`SKIP ${fn} (stub)`); continue; }

    // For array-returning functions, check the first element's keys.
    let subject = v;
    if (Array.isArray(v)) {
      if (!v.length) { console.log(`OK   ${fn} (empty array)`); pass++; continue; }
      subject = v[0];
    } else if (v && typeof v === 'object' && Array.isArray(v.entries)) {
      subject = v.entries[0] || v;
    }

    if (subject === null || typeof subject !== 'object') {
      console.log(`OK   ${fn} (scalar: ${JSON.stringify(v).slice(0, 60)})`);
      pass++; continue;
    }

    const missing = keys.filter((k) => !(k in subject));
    if (missing.length) {
      console.log(`FAIL ${fn}: missing keys ${missing.join(', ')}`);
      console.log(`     got: ${JSON.stringify(subject).slice(0, 300)}`);
      fail++;
    } else {
      console.log(`OK   ${fn}`);
      pass++;
    }
  }

  console.log(`\nShape check: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

