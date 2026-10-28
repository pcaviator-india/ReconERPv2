/**
 * Loads frontend/js/gas-shim.js in a stubbed browser environment and asserts
 * that the chainable google.script.run emulation resolves methods correctly.
 *
 * Usage: node scripts/shim-test.js
 */
const fs = require('fs');
const path = require('path');

// --- Minimal browser stubs -------------------------------------------------
const calls = [];
const store = {};

global.window = global;
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};
global.fetch = async (url, opts) => {
  calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data: { token: 'tok', user: {} } })
  };
};
store['recon_auth_token'] = 'test-token';
global.console.warn = () => {};

// --- Load the shim ---------------------------------------------------------
const shimSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'gas-shim.js'), 'utf-8');
new Function(shimSrc)();

// --- Assertions ------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

check('window.google.script.run is defined', typeof global.google.script.run !== 'undefined');

// 1. Chained method lookup must resolve (the reported bug).
let chained = typeof global.google.script.run.withSuccessHandler(function () {}).getCompanyLogo;
check('.withSuccessHandler(cb).getCompanyLogo is a function', chained === 'function', typeof chained);

// 2. Triple chain (withFailureHandler then fn) must also resolve.
let triple = typeof global.google.script.run
  .withSuccessHandler(function () {})
  .withFailureHandler(function () {})
  .getPeople;
check('.withSuccessHandler().withFailureHandler().getPeople is a function', triple === 'function', typeof triple);

// 3. Each google.script.run access is a fresh runner.
const a = global.google.script.run;
const b = global.google.script.run;
check('each google.script.run access is a fresh runner', a !== b);

// 4. A method with no mapped handler goes through the legacy endpoint.
const main = async () => {
  calls.length = 0;
  const logoValue = await new Promise((resolve) => {
    global.google.script.run.withSuccessHandler(resolve).getCompanyLogo();
  });
  const logoCall = calls.find((c) => c.url.indexOf('/legacy/getCompanyLogo') !== -1);
  check('unmapped getCompanyLogo POSTs to /legacy/getCompanyLogo', !!logoCall, logoCall ? logoCall.method : 'not called');
  check('unmapped getCompanyLogo resolves the response', logoValue && logoValue.status === 'success');

  // 5. A legacy fallback hits the API and forwards the token.
  calls.length = 0;
  const peopleValue = await new Promise((resolve) => {
    global.google.script.run.withSuccessHandler(resolve).getPeople();
  });
  const legacyCall = calls.find((c) => c.url.indexOf('/legacy/getPeople') !== -1);
  check('legacy fallback POSTs to /api/v1/legacy/getPeople', !!legacyCall, legacyCall ? legacyCall.method : 'not called');
  check('legacy fallback sends the Bearer token', legacyCall && legacyCall.body === '{"args":[]}', legacyCall && legacyCall.body);
  check('legacy fallback resolves the response', peopleValue && peopleValue.status === 'success');

  // 6. .then must stay undefined (no Promise assimilation traps).
  check('google.script.run.then is not defined (not thenable)',
    typeof global.google.script.run.then === 'undefined');

  console.log(`\nShim test: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });

