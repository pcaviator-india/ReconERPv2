/**
 * Legacy endpoint smoke test: calls every one of the 96 GAS functions the
 * frontend uses, through POST /api/v1/legacy/:fn, and reports the outcome.
 *
 * Usage: node scripts/legacy-all-test.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3997';
const fs = require('fs');
const path = require('path');

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

const FNS = JSON.parse(fs.readFileSync(path.join(__dirname, 'gas-calls.json'), 'utf-8'));

const ARGS = require('./legacy-args.json');

async function main() {
  console.log(`--- Health: ${BASE}/api/v1/health`);
  const health = await req('GET', '/api/v1/health');
  console.log(`  ${health.status} ${JSON.stringify(health.json)}`);

  console.log('--- Login');
  const login = await req('POST', '/api/v1/auth/login', { userId: '1001', pin: '1234' });
  if (!login.json || login.json.status !== 'success') {
    console.error('  LOGIN FAILED', JSON.stringify(login.json));
    process.exit(1);
  }
  console.log('  200 status=success');
  const token = login.json.data.token;

  console.log(`--- Legacy endpoints (all ${FNS.length} GAS functions)`);
  let ok = 0, legacy = 0, bad = 0;
  for (const fn of FNS) {
    const r = await req('POST', `/api/v1/legacy/${fn}`, { args: ARGS[fn] || [] }, token);
    const isErr = r.json && r.json.status === 'error';
    const isLegacy = r.json && r.json.__legacy === true;
    if (r.status === 200 && !isErr) {
      if (isLegacy) { legacy++; console.log(`  LEGACY ${fn}`); }
      else { ok++; console.log(`  OK     ${fn}`); }
    } else {
      bad++;
      console.log(`  FAIL   ${fn} [${r.status}] ${JSON.stringify(r.json).slice(0, 160)}`);
    }
  }

  console.log('\n--- REST routes');
  const rest = [
    ['GET', '/api/v1/reference/sites'],
    ['GET', '/api/v1/reference/categories'],
    ['GET', '/api/v1/reference/validation'],
    ['GET', '/api/v1/products'],
    ['GET', '/api/v1/stock'],
    ['GET', '/api/v1/requisitions'],
    ['GET', '/api/v1/quotes'],
    ['GET', '/api/v1/system/config'],
    ['POST', '/api/v1/jobs']
  ];
  for (const [m, p] of rest) {
    const r = await req(m, p, m === 'POST' ? { jobIds: [] } : undefined, token);
    const good = r.status === 200 && !(r.json && r.json.status === 'error');
    console.log(`  ${good ? 'OK   ' : 'FAIL '} ${m} ${p} [${r.status}]`);
  }

  console.log('\n--- Static frontend');
  for (const p of ['/login.html', '/index.html', '/api.js', '/js/gas-shim.js', '/modules/AdminVal.html']) {
    const res = await fetch(`${BASE}${p}`);
    console.log(`  ${res.status === 200 ? 'OK   ' : 'FAIL '} GET ${p} [${res.status}]`);
  }

  console.log(`\nSummary: ${ok} ok, ${legacy} legacy-stub, ${bad} failed`);
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
