// ============================================================
// gas-shim.js — google.script.run compatibility layer
// Routes legacy GAS server-function calls to the REST API
// (RECON_API) or, when unmapped, to POST /api/v1/legacy/:fn.
// Loaded BEFORE all module scripts in index.html.
// ============================================================
(function () {
  'use strict';

  var API_BASE = null;
  function apiBase() {
    if (!API_BASE) API_BASE = window.RECON_API_BASE_URL || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '/api/v1' : 'https://recon-erp-api.reconerp.workers.dev/api/v1');
    return API_BASE;
  }

  function apiGet(path) {
    return RECON_API._request(path, 'GET');
  }

  function storedUser() {
    try { return JSON.parse(sessionStorage.getItem('recon_user_secure')); } catch (e) { return null; }
  }

  // Boolean coercion for config flags ("TRUE"/"1"/true → true; defaults otherwise)
  function flag(v, def) {
    if (v === undefined || v === null || v === '') return def;
    var s = String(v).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return def;
  }

  // ---- Mapped handlers (GAS function name → Promise<result>) ----
  var handlers = {
    // Dynamic module page load — was getModuleHtml on the server (read X.html)
    getModuleHtml: function (name) {
      var file = name.indexOf('Val') === 0 ? 'AdminVal' : name;
      return fetch('modules/' + file + '.html').then(function (r) {
        if (!r.ok) throw new Error('Module not found: ' + name);
        return r.text();
      });
    },

    // Legacy login overlay inside index.html → POST /auth/login
    verifyUserLogin: function (userId, pin) {
      return RECON_API.login(userId, pin).then(function (res) {
        if (res.status === 'success' && res.data && res.data.token) {
          return { success: true, user: res.data.user };
        }
        return { success: false, message: res.message || 'Login failed' };
      }).catch(function (err) {
        return { success: false, message: err.message };
      });
    },

    // GAS shape: {categories:[{name,email}], subCategories:[{name,parent}],
    //   brands:[string], suppliers:[{name,email}], sites:[{name,email,suffix}],
    //   currencies:[{name,symbol}], subAreas:[{name,email,site,suffix}]}
    getValidationData: function () {
      return apiGet('/reference/validation').then(function (res) {
        var d = res.data || {};
        var catMap = {};
        (d.categories || []).forEach(function (c) { catMap[c.id] = c.name; });
        return {
          categories: (d.categories || []).map(function (c) { return { name: c.name, email: c.email || '' }; }),
          subCategories: (d.subCategories || []).map(function (s) { return { name: s.name, parent: catMap[s.category_id] || '' }; }),
          brands: (d.brands || []).map(function (b) { return b.name; }),
          suppliers: (d.suppliers || []).map(function (s) { return { name: s.name, email: s.email || '' }; }),
          sites: (d.sites || []).map(function (s) { return { name: s.name, email: s.email || '', suffix: s.code || '' }; }),
          currencies: (d.currencies || []).map(function (c) { return { name: c.name, symbol: c.symbol || '' }; }),
          subAreas: (d.subAreas || []).map(function (s) { return { name: s.name, email: '', site: 'Workshop', suffix: '' }; })
        };
      });
    },

    // [{name, email, suffix}]
    getSiteData: function () {
      return apiGet('/reference/sites').then(function (res) {
        return (res.data || []).map(function (s) {
          return { name: s.name, email: s.email || '', suffix: s.code || '' };
        });
      });
    },

    // GAS used Session.getActiveUser().email → site; JWT world: read stored user
    getAutoSelectedSite: function () {
      var u = storedUser();
      return Promise.resolve((u && u.site) || '');
    },

    // Mega-fetch used by Admin tables + boot config flags
    getAdminData: function () {
      return Promise.all([apiGet('/reference/validation'), apiGet('/system/config')]).then(function (r) {
        var d = r[0].data || {};
        var cfg = r[1].data || {};
        var catMap = {};
        (d.categories || []).forEach(function (c) { catMap[c.id] = c.name; });
        return {
          sites: (d.sites || []).map(function (s) { return { name: s.name, suffix: s.code || '' }; }),
          categories: (d.categories || []).map(function (c) { return { name: c.name, email: c.email || '' }; }),
          subCats: (d.subCategories || []).map(function (s) { return { parent: catMap[s.category_id] || '', name: s.name }; }),
          brands: (d.brands || []).map(function (b) { return { name: b.name }; }),
          suppliers: (d.suppliers || []).map(function (s) { return { name: s.name, email: s.email || '' }; }),
          users: [], // TODO: /admin/users endpoint (never expose PINs to client)
          people: [], // TODO: people table
          quoPdfEnabled: flag(cfg.quoPdfEnabled, false),
          quoEmailEnabled: flag(cfg.quoEmailEnabled, false),
          reqPdfEnabled: flag(cfg.reqPdfEnabled, false),
          reqEmailEnabled: flag(cfg.reqEmailEnabled, false),
          quoteEmailPending: flag(cfg.quoteEmailPending, true),
          quoteEmailQuoted: flag(cfg.quoteEmailQuoted, true),
          quoteEmailApproved: flag(cfg.quoteEmailApproved, true),
          quoteEmailSent: flag(cfg.quoteEmailSent, false),
          quoteEmailReceived: flag(cfg.quoteEmailReceived, false),
          quoteEmailDespatched: flag(cfg.quoteEmailDespatched, false),
          quoteEmailFinalReceived: flag(cfg.quoteEmailFinalReceived, false)
        };
      });
    },

    // Dashboard + Stock module — array of stock rows in the GAS shape
    // (ItemID, ProductName, LocationID, Quantity, RackId, ...).
    // NOTE: /stock returns raw DB columns (item_id, location_id, ...),
    // so the legacy adapter is used to preserve the GAS field names.
    getFullStockData: function () {
      return legacyCall('getFullStockData', []);
    },

    // Dashboard + ViewEditReq history — GAS-shaped rows (one per item,
    // newest first) via the legacy adapter; field names match
    // Código.js getRequirementsHistory() exactly.
    getRequirementsHistory: function () {
      return legacyCall('getRequirementsHistory', []);
    },

    // Boot-critical list consumers — unmapped tables fall back to legacy stubs
    getPeople: function () { return legacyCall('getPeople', []); },
    getAllActiveAssignments: function () { return legacyCall('getAllActiveAssignments', []); }
  };

  // ---- Legacy fallback: POST /api/v1/legacy/:fn {args:[...]} ----
  // Server responds with the raw GAS-style return value, or
  // {__legacy:true} when the function has no implementation yet.
  function legacyCall(fnName, args) {
    var headers = { 'Content-Type': 'application/json' };
    var token = (window.RECON_API && RECON_API.getToken && RECON_API.getToken()) ||
      (sessionStorage.getItem('recon_auth_token') || localStorage.getItem('recon_auth_token'));
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return fetch(apiBase() + '/legacy/' + fnName, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ args: args || [] })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status + ' on ' + fnName));
        if (j && j.__legacy) {
          console.warn('[gas-shim] unimplemented server function (returning null): ' + fnName);
          return null;
        }
        return j;
      });
    });
  }

  // ---- Chainable google.script.run emulation ----
  function makeRunner() {
    var successCb = null;
    var failureCb = null;
    // Assigned after the Proxy is built. The handler methods must return the
    // PROXY, not the raw target, or the chained method lookup
    // (.withSuccessHandler(cb).someFn()) happens on the plain object and
    // yields "someFn is not a function".
    var proxy;

    var runner = {
      withSuccessHandler: function (cb) { successCb = cb; return proxy; },
      withFailureHandler: function (cb) { failureCb = cb; return proxy; },
      withUserObject: function () { return proxy; }
    };

    proxy = new Proxy(runner, {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        // Never pretend to be thenable (avoid Promise assimilation traps)
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined;
        }
        // Any other property = server function call
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var fnName = prop;
          var s = successCb;
          var f = failureCb;
          successCb = null; // GAS resets handlers after each call
          failureCb = null;

          var promise = handlers[fnName]
            ? Promise.resolve().then(function () { return handlers[fnName].apply(null, args); })
            : legacyCall(fnName, args);

          promise.then(function (result) {
            if (s) s(result);
          }, function (err) {
            console.error('[gas-shim] ' + fnName + ' failed:', err);
            if (f) f(err);
          });
          return proxy;
        };
      }
    });

    return proxy;
  }

  window.google = window.google || { script: {} };
  Object.defineProperty(window.google.script, 'run', {
    get: function () { return makeRunner(); },
    configurable: true
  });

  console.log('[gas-shim] google.script.run shim active → ' + apiBase());
})();
