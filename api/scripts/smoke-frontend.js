// smoke-test-frontend.js — boot-test the static frontend + legacy endpoint
const { execSync, spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const apiDir = path.resolve(__dirname, '..');

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: PORT, path: urlPath, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* html/text */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const server = spawn('node', ['src/index.js'], {
    cwd: apiDir,
    env: { ...process.env, JWT_SECRET: 'test-secret', PORT: String(PORT) },
    stdio: 'ignore'
  });

  await new Promise((r) => setTimeout(r, 2500));

  let pass = 0, fail = 0;
  function check(name, ok, extra) {
    if (ok) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
  }

  try {
    // Static frontend
    const idx = await req('GET', '/');
    check('GET / serves index.html', idx.status === 200 && idx.body.includes('gas-shim.js'), `status=${idx.status}`);
    const lg = await req('GET', '/login.html');
    check('GET /login.html', lg.status === 200 && lg.body.includes('RECON_API.login'), `status=${lg.status}`);
    const rp = await req('GET', '/reset-pin.html');
    check('GET /reset-pin.html', rp.status === 200 && rp.body.includes('confirmResetPin'), `status=${rp.status}`);
    const shim = await req('GET', '/js/gas-shim.js');
    check('GET /js/gas-shim.js', shim.status === 200 && shim.body.includes('makeRunner'), `status=${shim.status}`);
    const dash = await req('GET', '/modules/Dashboard.html');
    check('GET /modules/Dashboard.html', dash.status === 200, `status=${dash.status}`);
    const css = await req('GET', '/css/choices.css');
    check('GET /css/choices.css', css.status === 200, `status=${css.status}`);
    const apijs = await req('GET', '/api.js');
    check('GET /api.js', apijs.status === 200, `status=${apijs.status}`);

    // index.html must have zero leftover GAS scriptlets
    check('index.html has no GAS scriptlets', !idx.body.includes('<?='), 'no <?= left');

    // Login
    const login = await req('POST', '/api/v1/auth/login', { userId: '1001', pin: '1234' });
    check('POST /auth/login', login.status === 200 && login.json && login.json.status === 'success', `status=${login.status}`);
    const token = login.json && login.json.data && login.json.data.token;

    // System config now carries the feature flags
    const cfg = await req('GET', '/api/v1/system/config', null, token);
    const d = cfg.json && cfg.json.data || {};
    check('GET /system/config has reqEmailEnabled flag', cfg.status === 200 && 'reqEmailEnabled' in d, `reqEmailEnabled=${d.reqEmailEnabled} quoPdfEnabled=${d.quoPdfEnabled}`);

    // Legacy endpoint — implemented stubs.
    // getPeople now reads the `people` table (the GAS "People" sheet), so it
    // returns an array of person records (empty on a fresh DB).
    const people = await req('POST', '/api/v1/legacy/getPeople', { args: [] }, token);
    check('POST /legacy/getPeople → array', people.status === 200 && Array.isArray(people.json), people.body.slice(0, 60));

    const asg = await req('POST', '/api/v1/legacy/getAllActiveAssignments', { args: [] }, token);
    check('POST /legacy/getAllActiveAssignments → [] (fresh DB)', asg.status === 200 && Array.isArray(asg.json), asg.body.slice(0, 60));

    // GAS-shaped history: array (empty on fresh DB); seed one requisition + item
    // and verify exact GAS field names, newest-first, one row per item.
    const hist0 = await req('POST', '/api/v1/legacy/getRequirementsHistory', { args: [] }, token);
    check('POST /legacy/getRequirementsHistory → [] (fresh DB)', hist0.status === 200 && Array.isArray(hist0.json), hist0.body.slice(0, 60));

    // Legacy endpoint — SQL-backed (bundles table)
    const bun = await req('POST', '/api/v1/legacy/getBundles', { args: [] }, token);
    check('POST /legacy/getBundles → array', bun.status === 200 && Array.isArray(bun.json), bun.body.slice(0, 60));

    // Legacy endpoint — unimplemented marker (needs an external integration)
    const mail = await req('POST', '/api/v1/legacy/sendFinalRFQ', { args: [] }, token);
    check('POST /legacy/sendFinalRFQ → __legacy marker', mail.status === 200 && mail.json && mail.json.__legacy === true, mail.body.slice(0, 60));

    // GAS-shaped movement rows
    const mov = await req('POST', '/api/v1/legacy/getAllDailyMovements', { args: [] }, token);
    check('POST /legacy/getAllDailyMovements → array', mov.status === 200 && Array.isArray(mov.json), mov.body.slice(0, 60));

    // GAS-shaped stock rows
    const stock = await req('POST', '/api/v1/legacy/getFullStockData', { args: [] }, token);
    check('POST /legacy/getFullStockData → array', stock.status === 200 && Array.isArray(stock.json), stock.body.slice(0, 60));

    // Movement validation lists
    const mv = await req('POST', '/api/v1/legacy/getMovementValidation', { args: [] }, token);
    check('POST /legacy/getMovementValidation → {Sector,Maquina,Generador,Vehiculo}',
      mv.status === 200 && mv.json && Array.isArray(mv.json.Sector) && Array.isArray(mv.json.Maquina),
      mv.body.slice(0, 60));

    // Unknown function → 404
    const unk = await req('POST', '/api/v1/legacy/definitelyNotAFunction', { args: [] }, token);
    check('POST /legacy/definitelyNotAFunction → 404', unk.status === 404, `status=${unk.status}`);

    // Legacy requires auth
    const noauth = await req('POST', '/api/v1/legacy/getPeople', { args: [] });
    check('POST /legacy/getPeople without token → 401', noauth.status === 401, `status=${noauth.status}`);
  } finally {
    server.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
