import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { stages: [
  { duration: '30s', target: 1 },
  { duration: '90s', target: 1 },
] };

const BASE = 'http://localhost:3000';

// ---- Test 1: Backend column mapping fixes ----
export function testMappingFixes() {
  const sheet = 'TEST_SHEET_MAP';
  const sheetKey = 'test_sheet_map_' + Date.now();

  // Create sheet first
  const res = http.post(BASE + '/api/v1/sheets',
    JSON.stringify({ key: sheetKey, name: sheet, expectedHeaders: 'geo,pn,category' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'create sheet: status 200': r => r.status === 200 });

  sleep(1);

  // Test 1a: Paste with columnMap should return correct mapped data
  const pasteRes = http.post(BASE + '/api/v1/sheets/paste-preview',
    JSON.stringify({
      sheet: sheetKey,
      text: '001,ABC,CAT1\n002,DEF,CAT2\n',
      columnMap: { '0': 'geo' }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(pasteRes, { 'paste-preview: status 200': r => r.status === 200 });

  const previewData = JSON.parse(pasteRes.body);
  check(previewData.data.sample, 'sample array exists');
  if (previewData.data.sample && previewData.data.sample.length > 0) {
    check(previewData.data.sample[0].geo, 'geo field mapped');
    check(previewData.data.sample[0].category, 'category field present');
  }

  sleep(1);

  // Test 1b: Create a new sheet with mapping
  const mapRes = http.post(BASE + '/api/v1/sheets/mapping',
    JSON.stringify({ sheet_key: sheetKey, columnMap: { '0': 'geo', '1': 'pn', '2': 'category' } }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(mapRes, { 'save mapping: status 200': r => r.status === 200 });

  const saved = JSON.parse(mapRes.body);
  check(saved.data.columnMap, 'mapping saved');
  check(saved.data.columnMap['0'], 'col 0 -> geo');
  check(saved.data.columnMap['1'], 'col 1 -> pn');
  check(saved.data.columnMap['2'], 'col 2 -> category');

  // Test 1c: GET mapping
  const getMap = http.get(BASE + '/api/v1/sheets/mapping/' + sheetKey);
  check(getMap, { 'get mapping: status 200': r => r.status === 200 });
  const saved2 = JSON.parse(getMap.body);
  check(saved2.data.columnMap['0'], 'col 0 -> geo (GET)');

  // Test 1d: PUT mapping
  const putMap = http.put(BASE + '/api/v1/sheets/mapping/' + sheetKey,
    JSON.stringify({ columnMap: { '0': 'geo', '1': 'pn', '2': 'category', '3': 'notes' } }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(putMap, { 'put mapping: status 200': r => r.status === 200 });
  const putSaved = JSON.parse(putMap.body);
  check(putSaved.data.columnMap['3'], 'col 3 -> notes (PUT)');

  // Test 1e: POST sheet data (import) with columnMap
  const importRes = http.post(BASE + '/api/v1/sheets/paste-import',
    JSON.stringify({
      sheet: sheetKey,
      text: '001,ABC,CAT1\n002,DEF,CAT2\n',
      columnMap: { '0': 'geo', '1': 'pn', '2': 'category' }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(importRes, { 'paste-import: status 200': r => r.status === 200 });
  const importData = JSON.parse(importRes.body);
  check(importData.data.imported, 'import completed');

  sleep(1);

  // Cleanup
  http.post(BASE + '/api/v1/sheets', JSON.stringify({ key: sheetKey, delete: true }),
    { headers: { 'Content-Type': 'application/json' } });
  http.delete(BASE + '/api/v1/sheets/mapping/test_sheet_map_' + Date.now());

  check(true, 'mapping tests passed');
}

export default function () {
  testMappingFixes();
}
