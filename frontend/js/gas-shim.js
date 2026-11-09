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
    var localHost = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (!API_BASE) API_BASE = window.RECON_API_BASE_URL ||
      (localHost ? 'http://localhost:3000/api/v1' : 'https://recon-erp-api.reconerp.workers.dev/api/v1');
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
          RECON_API.setToken(res.data.token);
          return { success: true, user: res.data.user, data: res.data };
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
      var requests = Promise.all([apiGet('/reference/validation'), apiGet('/system/config'), apiGet('/users')]);
      var timeout = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Admin data request timed out')); }, 15000);
      });
      return Promise.race([requests, timeout]).then(function (r) {
        var d = r[0].data || {};
        var cfg = r[1].data || {};
        var users = r[2].data || [];
        var catMap = {};
        (d.categories || []).forEach(function (c) { catMap[c.id] = c.name; });
        return {
          sites: (d.sites || []).map(function (s) { return { name: s.name, suffix: s.code || '' }; }),
          categories: (d.categories || []).map(function (c) { return { name: c.name, email: c.email || '' }; }),
          subCats: (d.subCategories || []).map(function (s) { return { parent: catMap[s.category_id] || '', name: s.name }; }),
          brands: (d.brands || []).map(function (b) { return { name: b.name }; }),
          suppliers: (d.suppliers || []).map(function (s) { return { name: s.name, email: s.email || '' }; }),
          users: users,
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
    getAllActiveAssignments: function () { return legacyCall('getAllActiveAssignments', []); },

    // Control Combustible — movement validation lists (Sector, Vehiculo, Generador, Maquina)
    getMovementValidation: function () { return legacyCall('getMovementValidation', []); },

    // Control Combustible — get last fuel entry for odometer validation
    getLastFuelEntry: function (assetId) { return legacyCall('getLastFuelEntry', [assetId]); },

    // Control Combustible — save fuel entry
    saveFuelEntry: function (data) { return legacyCall('saveFuelEntry', [data]); },

    // Control Combustible — fuel history and balance
    getFuelHistory: function () { return legacyCall('getFuelHistory', []); },
    getFuelBalance: function () { return legacyCall('getFuelBalance', []); },
    getFuelPurchaseHistory: function () { return legacyCall('getFuelPurchaseHistory', []); },
    saveFuelPurchase: function (data) { return legacyCall('saveFuelPurchase', [data]); },

    // Quote Report module — flat rows (one per quote item) matching GAS getHistoryData shape
    getHistoryData: function () {
      return RECON_API.getQuotes({ limit: 1000 }).then(function (res) {
        var quotes = (res && res.data) || [];
        var rows = [];
        quotes.forEach(function (q) {
          var items = [];
          try { items = JSON.parse(q.items_json || '[]'); } catch (e) { items = []; }
          var supplier = q.supplier_name || '';
          var faena = q.req_site || q.site || '';
          var orderId = q.requisition_no || '';
          var quoteId = q.quote_no || '';
          var refCotiz = q.ref_cotiz || '';
          var quoteLink = q.pdf_url || '';
          var currency = q.currency || 'CLP';
          var exchangeRate = Number(q.exchange_rate) || 1;
          var quotedDocUrl = q.quoted_doc_url || '';

          items.forEach(function (it) {
            var status = it.status || q.status || 'Pending';
            var geo = it.geo || '';
            var pn = it.pn || '';
            var desc = it.description_es || it.description_en || '';
            var qty = Number(it.quantity || it.approved_qty || it.received_qty || 0);
            var price = Number(it.unit_price || 0);
            var total = Number(it.total_price || 0);
            var category = it.category || '';
            var subCategory = it.sub_category || '';
            var supplierQuoteNo = it.supplier_quote_no || refCotiz || '';

            rows.push({
              orderId: orderId,
              timestamp: q.updated_at || q.created_at || '',
              timestampIso: q.updated_at || q.created_at || '',
              supplier: supplier,
              faena: faena,
              geo: geo,
              pn: pn,
              desc: desc,
              cant: qty,
              estado: status,
              quoteId: quoteId,
              refCotiz: refCotiz,
              quoteLink: quoteLink,
              supplierQuoteNo: supplierQuoteNo,
              quotedDocUrl: quotedDocUrl,
              currency: currency,
              exchangeRate: exchangeRate,
              price: price,
              total: total,
              category: category,
              subCategory: subCategory,
              emails: q.emails || ''
            });
          });
        });
        return rows;
      });
    },

    // Lifecycle Report module — combines requirements + quotes into lifecycle entries
    getLifecycleReportData: function () {
      return Promise.all([
        RECON_API.getRequisitions({ limit: 1000 }),
        RECON_API.getQuotes({ limit: 1000 })
      ]).then(function (results) {
        var reqRes = results[0];
        var quoteRes = results[1];
        var reqRows = (reqRes && reqRes.data) || [];
        var quoteRows = (quoteRes && quoteRes.data) || [];

        function clean(v) { return String(v || '').trim(); }

        function normalizeStage(s) {
          if (!s) return '';
          var x = String(s || '').toLowerCase();
          if ((x.includes('not') && x.includes('quot')) || x.includes('no cotiz') || x.includes('sin cotiz')) return 'Not Quoted';
          if (x.includes('final')) return 'Final Received';
          if (x.includes('po') || x.includes('orden') || x.includes('ordered') || x.includes('comprad')) return 'PO Created';
          if (x.includes('approv') || x.includes('aprob')) return 'Approved';
          if (x.includes('despatch') || x.includes('despach')) return 'Despatched';
          if (x.includes('received') || x.includes('recib')) return 'Received';
          if (x.includes('quot') || x.includes('cotiz')) return 'Quoted';
          if (x.includes('rfq') || x.includes('sent')) return 'Sent';
          if (x.includes('pend')) return 'Pending';
          return s;
        }

        function splitCombinedRef(rawOrderId) {
          if (!rawOrderId) return [];
          return rawOrderId.split('+').map(function (s) { return clean(s); }).filter(Boolean);
        }

        var reqMap = {};
        reqRows.forEach(function (r) {
          var orderId = clean(r.requisition_no || r.orderId || r.order);
          if (!orderId) return;
          reqMap[orderId] = reqMap[orderId] || {
            orderId: orderId,
            createdDate: r.created_at || '',
            site: r.site || r.req_site || '',
            category: r.category || '',
            creator: r.requested_by || '',
            items: [],
            quoteIds: new Set(),
            suppliers: new Set(),
            lastUpdated: r.updated_at || r.created_at || ''
          };

          var reqItems = [];
          try { reqItems = JSON.parse(r.items_json || '[]'); } catch (e) { reqItems = []; }

          reqItems.forEach(function (it) {
            reqMap[orderId].items.push({
              pn: it.pn || '',
              geo: it.geo || '',
              desc: it.description_es || it.description_en || '',
              qty: Number(it.quantity || 0),
              estado: it.status || 'Pending',
              pdfUrl: '',
              quotes: []
            });
          });
        });

        quoteRows.forEach(function (q) {
          var rawOrderId = clean(q.requisition_no || q.ref_cotiz || '');
          if (!rawOrderId) return;

          splitCombinedRef(rawOrderId).forEach(function (orderId) {
            reqMap[orderId] = reqMap[orderId] || {
              orderId: orderId,
              createdDate: '',
              site: q.req_site || q.site || '',
              category: q.category || '',
              creator: '',
              items: [],
              quoteIds: new Set(),
              suppliers: new Set(),
              lastUpdated: q.updated_at || q.created_at || ''
            };

            var req = reqMap[orderId];
            if (q.quote_no) req.quoteIds.add(q.quote_no);
            if (q.supplier_name) req.suppliers.add(q.supplier_name);

            var quoteItems = [];
            try { quoteItems = JSON.parse(q.items_json || '[]'); } catch (e) { quoteItems = []; }

            quoteItems.forEach(function (qi) {
              var qiGeo = qi.geo || '';
              var matched = req.items.find(function (it) { return it.geo === qiGeo && it.pn === (qi.pn || ''); });
              if (!matched) {
                matched = {
                  pn: qi.pn || '',
                  geo: qiGeo,
                  desc: qi.description_es || qi.description_en || '',
                  qty: Number(qi.quantity || 0),
                  estado: qi.status || q.status || 'Pending',
                  pdfUrl: q.pdf_url || '',
                  quotes: []
                };
                req.items.push(matched);
              }
              matched.quotes.push({
                estado: qi.status || q.status || 'Pending',
                status: qi.status || q.status || 'Pending',
                timestampIso: q.updated_at || q.created_at || '',
                timestamp: q.updated_at || q.created_at || '',
                total: Number(qi.total_price || 0)
              });
            });

            try {
              var qTime = q.updated_at ? new Date(q.updated_at) : q.created_at ? new Date(q.created_at) : null;
              if (qTime) {
                var ts = qTime.toISOString();
                if (!req.lastUpdated || new Date(req.lastUpdated) < qTime) req.lastUpdated = ts;
              }
            } catch (e) { }
          });
        });

        var entries = Object.keys(reqMap).map(function (orderId) {
          var req = reqMap[orderId];
          var isStore = clean(req.site).toLowerCase() === 'store';
          var aggregatedStages = new Set();
          var totalQuotedValue = 0;

          req.items.forEach(function (it) {
            var itemStage = 'Pending';
            if (it.quotes && it.quotes.length) {
              var latest = it.quotes[0];
              var latestTime = latest.timestampIso ? new Date(latest.timestampIso).getTime() : latest.timestamp ? new Date(latest.timestamp).getTime() : 0;
              for (var j = 1; j < it.quotes.length; j++) {
                var cand = it.quotes[j];
                var candTime = cand.timestampIso ? new Date(cand.timestampIso).getTime() : cand.timestamp ? new Date(cand.timestamp).getTime() : 0;
                if (candTime > latestTime) {
                  latest = cand;
                  latestTime = candTime;
                }
              }
              itemStage = latest.estado || latest.status || itemStage;
              totalQuotedValue += Number(latest.total || 0) || 0;
            }
            var norm = normalizeStage(itemStage);
            if (isStore && (norm === 'Final Received' || norm === 'Despatched')) {
              norm = 'Received';
            }
            aggregatedStages.add(norm || itemStage || 'Pending');
            it.lastKnownStage = norm || itemStage;
          });

          var precedence = ['Final Received', 'PO Created', 'Despatched', 'Approved', 'Quoted', 'Sent', 'Pending', 'Not Quoted', 'Created'];
          var reqStage = 'Created';
          for (var p = 0; p < precedence.length; p++) {
            if (Array.from(aggregatedStages).some(function (s) { return s === precedence[p]; })) {
              reqStage = precedence[p];
              break;
            }
          }
          if (isStore && (reqStage === 'Final Received' || reqStage === 'Despatched')) {
            reqStage = 'Received';
          }

          var quoteIdsArr = Array.from(req.quoteIds || []);
          var suppliersArr = Array.from(req.suppliers || []);

          return {
            orderId: req.orderId,
            createdDate: req.createdDate,
            site: req.site,
            category: req.category,
            creator: req.creator,
            items: req.items,
            quotesCount: quoteIdsArr.length,
            quoteIds: quoteIdsArr,
            supplierCount: suppliersArr.length,
            suppliers: suppliersArr,
            totalQuoted: totalQuotedValue,
            stage: reqStage,
            currentStage: reqStage,
            lastUpdated: req.lastUpdated || req.createdDate || ''
          };
        });

        entries.sort(function (a, b) {
          var ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          var tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          return tb - ta;
        });

        return entries;
      });
    }
  };

  // ---- Legacy fallback: POST /api/v1/legacy/:fn {args:[...]} ----
  // Server responds with the raw GAS-style return value, or
  // {__legacy:true} when the function has no implementation yet.
  function legacyCall(fnName, args) {
    var headers = { 'Content-Type': 'application/json' };
    var token = (window.RECON_API && RECON_API.getToken && RECON_API.getToken()) ||
      (sessionStorage.getItem((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'recon_auth_token_local' : 'recon_auth_token') ||
        localStorage.getItem((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'recon_auth_token_local' : 'recon_auth_token'));
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
