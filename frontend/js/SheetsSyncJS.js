// ============================================================
// SheetsSyncJS.js — Google Sheets Sync & Data Migration GUI
// Tab 1: Direct Copy & Paste Import (No GCP connection required)
// Tab 2: Automated Google Sheets API Sync (Service Account JSON)
// ============================================================
(function () {
  'use strict';

  var lastPreview = null;
  var lastPaste = { key: '', text: '', preview: null, mapping: null };
  var statusCache = null;
  var currentMapping = {}; // { [pastedColIdx]: dbField }

  function el(id) { return document.getElementById(id); }

  function alertBox(kind, msg) {
    var box = el('ssAlert');
    if (!box) return;
    box.innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible fade show" role="alert">'
      + msg + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
  }

  function setBusy(btnId, busy, label) {
    var b = el(btnId);
    if (!b) return;
    b.disabled = busy;
    if (busy) {
      b.dataset.label = b.innerHTML;
      b.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> ' + (label || 'Working...');
    } else if (b.dataset.label) {
      b.innerHTML = b.dataset.label;
    }
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  // TAB 2 (API SYNC): Connection Details & Live Google API Sync
  // ============================================================
  async function loadConnection() {
    try {
      var res = await window.RECON_API.getSheetsConnection();
      var d = res.data || {};
      if (el('ssSheetId')) el('ssSheetId').value = d.sheetId || '';
      if (el('ssCredPath')) el('ssCredPath').value = d.credPath || 'api/gcp/service-account.json';
      if (el('ssSvcEmail')) el('ssSvcEmail').textContent = d.serviceAccountEmail || '—';
      var badge = el('ssConnBadge');
      if (badge) {
        var ok = d.sheetId && d.credentialsFound;
        badge.className = 'badge ' + (ok ? 'bg-success' : 'bg-warning text-dark');
        badge.textContent = ok ? 'Ready' : (!d.credentialsFound ? 'Credentials missing' : 'Sheet ID missing');
      }
      var open = el('ssOpenSheet');
      if (open) {
        if (d.sheetUrl) { open.href = d.sheetUrl; open.classList.remove('d-none'); }
        else open.classList.add('d-none');
      }
    } catch (err) {
      // In Worker mode, service-account.json is optional; don't alarm user with red banner
      var badge2 = el('ssConnBadge');
      if (badge2) {
        badge2.className = 'badge bg-secondary';
        badge2.textContent = 'Not configured';
      }
    }
    try {
      var st = await window.RECON_API.getSheetsStatus();
      var sel = el('ssSheetSelect');
      var sheets = (st.data && st.data.sheets) || [];
      if (sel && sel.options.length <= 1) {
        sheets.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.key;
          o.textContent = s.gasSheet + ' \u2192 ' + (s.dbTable || '?');
          sel.appendChild(o);
        });
      }
    } catch (err) { /* picker stays "All sheets" */ }
  }

  async function saveConnection() {
    setBusy('ssPreviewBtn', true, 'Saving...');
    try {
      var payload = {
        sheetId: el('ssSheetId') ? el('ssSheetId').value.trim() : '',
        credPath: el('ssCredPath') ? el('ssCredPath').value.trim() : ''
      };
      var raw = el('ssSvcJson') ? el('ssSvcJson').value.trim() : '';
      if (raw) payload.serviceAccountJson = raw;
      await window.RECON_API.saveSheetsConnection(payload);
      if (el('ssSvcJson')) el('ssSvcJson').value = '';
      alertBox('success', 'Connection settings saved.');
      await loadConnection();
    } catch (err) {
      alertBox('danger', 'Save failed: ' + esc(err.message));
    } finally {
      setBusy('ssPreviewBtn', false);
    }
  }

  async function test() {
    setBusy('ssTestBtn', true, 'Testing...');
    try {
      var id = el('ssSheetId') ? el('ssSheetId').value.trim() : '';
      var res = await window.RECON_API.testSheetsConnection(id || undefined);
      var d = res.data || {};
      alertBox('success', 'Connected to <b>' + esc(d.spreadsheetTitle || '?') + '</b> - '
        + (d.tabCount || 0) + ' tabs: ' + esc((d.tabs || []).slice(0, 8).join(', ')));
    } catch (err) {
      alertBox('danger', 'Connection test failed: ' + esc(err.message));
    } finally {
      setBusy('ssTestBtn', false);
    }
  }

  function renderPreview(data) {
    var box = el('ssPreviewBox');
    var confirmBtn = el('ssConfirmBtn');
    if (!box) return;
    lastPreview = data;
    var sheets = data.sheets || [data];
    var total = sheets.reduce(function (n, s) { return n + (s.total || 0); }, 0);
    var html = '<div class="p-2"><div class="alert alert-info mb-2">'
      + '<b>' + total + '</b> rows ready across <b>' + sheets.length + '</b> sheet(s). '
      + 'Review below, then click <b>Confirm Import</b>. Nothing has been written yet.</div>';
    sheets.forEach(function (s) {
      if (s.error) {
        html += '<div class="alert alert-danger py-2"><b>' + esc(s.key || '?') + '</b>: ' + esc(s.error) + '</div>';
        return;
      }
      if (s.skipped) return;
      html += '<details class="border rounded mb-2" open>'
        + '<summary class="p-2 fw-bold" style="cursor:pointer">'
        + esc(s.gasSheet || s.key) + ' to <code>' + esc(s.table || '') + '</code>'
        + ' <span class="badge bg-primary">' + (s.total || 0) + ' rows</span>'
        + ' <span class="badge bg-success">' + (s.inserts || 0) + ' new</span>'
        + ' <span class="badge bg-warning text-dark">' + (s.updates || 0) + ' updates</span>'
        + '</summary><div class="table-responsive"><table class="table table-sm table-striped mb-0"><thead><tr>';
      var cols = s.sample && s.sample.length ? Object.keys(s.sample[0]) : [];
      cols.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      (s.sample || []).forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (c) { html += '<td>' + esc(r[c]) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table></div></details>';
    });
    html += '</div>';
    box.innerHTML = html;
    if (confirmBtn) confirmBtn.classList.toggle('d-none', total === 0);
  }

  async function preview() {
    setBusy('ssPreviewBtn', true, 'Fetching...');
    if (el('ssResultCard')) el('ssResultCard').classList.add('d-none');
    try {
      var key = el('ssSheetSelect') ? el('ssSheetSelect').value : '';
      var res = await window.RECON_API.previewSheets(key || undefined);
      renderPreview(res.data || {});
    } catch (err) {
      alertBox('danger', 'Live preview failed: ' + esc(err.message));
    } finally {
      setBusy('ssPreviewBtn', false);
    }
  }

  async function confirmImport() {
    var key = el('ssSheetSelect') ? el('ssSheetSelect').value : '';
    var total = 0;
    if (lastPreview) {
      var sheets = lastPreview.sheets || [lastPreview];
      total = sheets.reduce(function (n, s) { return n + (s.total || 0); }, 0);
    }
    var ok = window.confirm('Import ' + (total ? total + ' rows' : 'data')
      + (key ? ' from sheet "' + key + '"' : ' from ALL sheets')
      + ' into the database? Existing records with the same key will be UPDATED.');
    if (!ok) return;
    setBusy('ssConfirmBtn', true, 'Importing...');
    try {
      var res = await window.RECON_API.importSheets(key || undefined);
      var d = res.data || {};
      var list = d.sheets || [d];
      var imported = list.reduce(function (n, s) { return n + (s.imported || 0); }, 0);
      var errs = [];
      list.forEach(function (s) {
        (s.errors || []).forEach(function (e) { errs.push((s.key || '') + ': ' + e.message); });
      });
      var card = el('ssResultCard');
      var rbox = el('ssResultBox');
      if (card) card.classList.remove('d-none');
      if (rbox) {
        rbox.innerHTML = '<div class="alert alert-' + (errs.length ? 'warning' : 'success') + ' mb-2">'
          + 'Imported <b>' + imported + '</b> records.'
          + (errs.length ? ' <b>' + errs.length + '</b> errors.' : '') + '</div>'
          + '<ul class="small mb-1">' + list.map(function (s) {
            return '<li><code>' + esc(s.key || '?') + '</code>: '
              + (s.skipped ? 'skipped' : (s.imported || 0) + ' rows to ' + esc(s.table || '')) + '</li>';
          }).join('') + '</ul>';
      }
      alertBox(errs.length ? 'warning' : 'success', 'Import finished: <b>' + imported + '</b> records.');
      lastPreview = null;
      if (el('ssConfirmBtn')) el('ssConfirmBtn').classList.add('d-none');
    } catch (err) {
      alertBox('danger', 'Import failed: ' + esc(err.message));
    } finally {
      var cb = el('ssConfirmBtn');
      if (cb) { cb.disabled = false; cb.innerHTML = '<i class="bi bi-check-circle"></i> Confirm Import'; }
    }
  }

  // ============================================================
  // TAB 1 (PASTE & IMPORT): Direct Paste, Mapping & Execution
  // ============================================================
  async function sheetList() {
    if (statusCache) return statusCache;
    var st = await window.RECON_API.getSheetsStatus();
    statusCache = (st.data && st.data.sheets) || [];
    return statusCache;
  }

  async function fillPastePicker() {
    var sel = el('ssPasteSheet');
    if (!sel || sel.options.length > 1) {
      if (sel) sel.addEventListener('change', showExpected);
      return;
    }
    try {
      var sheets = await sheetList();
      sheets.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.key;
        o.textContent = s.gasSheet + ' \u2192 ' + (s.dbTable || '?');
        sel.appendChild(o);
      });
      sel.addEventListener('change', showExpected);
      showExpected();
    } catch (err) { /* picker keeps placeholder */ }
  }

  function showExpected() {
    var sel = el('ssPasteSheet');
    var lbl = el('ssExpectedFor');
    var box = el('ssExpectedHeaders');
    if (!sel || !box) return;
    var key = sel.value;
    if (lbl) lbl.textContent = key || '—';
    if (!key) { box.textContent = 'Pick a sheet above to view its required columns.'; return; }
    sheetList().then(function (sheets) {
      var m = sheets.filter(function (s) { return s.key === key; })[0];
      box.textContent = m && m.expectedHeaders ? m.expectedHeaders.join('  |  ') : '—';
    });
  }

  function pasteCount() {
    var t = el('ssPasteBox') ? el('ssPasteBox').value : '';
    var n = t.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; }).length;
    var count = Math.max(0, n - 1);
    if (el('ssPasteCount')) el('ssPasteCount').textContent = String(count) + (count > 0 ? ' rows + header' : '');
  }

  // ---- Column Mapping ----
  async function loadMappingPref(key) {
    if (!key) { currentMapping = {}; return {}; }
    try {
      var res = await window.RECON_API.getColumnMapping(key);
      currentMapping = (res.data && res.data.mapping) || {};
      return currentMapping;
    } catch (e) { currentMapping = {}; return {}; }
  }

  async function saveMappingPref() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    if (!key) { alertBox('warning', 'Please select a sheet first.'); return; }
    var mapping = {};
    var selects = document.querySelectorAll('#ssMappingList select');
    selects.forEach(function (s) {
      var pi = s.dataset.pastedIdx;
      var f = s.value;
      if (f) mapping[pi] = f;
    });
    currentMapping = mapping;
    try {
      await window.RECON_API.saveColumnMapping(key, mapping);
      var span = el('ssMappingStatus');
      if (span) { span.classList.remove('d-none'); setTimeout(function(){ span.classList.add('d-none'); }, 2500); }
      alertBox('success', 'Column mapping saved for <b>' + esc(key) + '</b>. Updating preview...');
      // Automatically re-apply mapping to update preview and enable the import button immediately!
      await applyMapping();
    } catch (err) {
      alertBox('danger', 'Save mapping failed: ' + esc(err.message));
    }
  }

  function clearMappingPref() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    if (!key) return;
    currentMapping = {};
    var list = el('ssMappingList');
    if (list) list.innerHTML = '';
    var box = el('ssMappingBox');
    if (box) box.classList.add('d-none');
    try { window.RECON_API.saveColumnMapping(key, {}); } catch (e) {}
    alertBox('info', 'Mapping preference cleared.');
  }

  function renderMappingUI(pastedHeaders, expectedFields, savedMapping) {
    var list = el('ssMappingList');
    var box = el('ssMappingBox');
    if (!list || !box) return;
    list.innerHTML = '';
    if (!pastedHeaders || !pastedHeaders.length) { box.classList.add('d-none'); return; }
    var html = '';
    pastedHeaders.forEach(function (h, i) {
      var saved = (savedMapping && savedMapping[String(i)]) || '';
      // Try to auto-match if not saved
      if (!saved) {
        var lower = h.trim().toLowerCase();
        expectedFields.forEach(function(f) {
          if (f.toLowerCase() === lower || f.toLowerCase().replace(/_/g, ' ') === lower) {
            saved = f;
          }
        });
      }
      html += '<div class="col-md-6">';
      html += '<div class="p-2 bg-white rounded border d-flex align-items-center justify-content-between gap-2">';
      html += '<div class="small text-truncate" style="max-width: 50%;"><b>Col ' + (i + 1) + ':</b> <code>' + esc(h) + '</code></div>';
      html += '<div class="flex-grow-1"><select class="form-select form-select-sm" data-pasted-idx="' + i + '">';
      html += '<option value="">— skip this column —</option>';
      expectedFields.forEach(function (f) {
        var sel = (saved === f) ? 'selected' : '';
        html += '<option value="' + esc(f) + '" ' + sel + '>\u2192 ' + esc(f) + '</option>';
      });
      html += '</select></div>';
      html += '</div></div>';
    });
    list.innerHTML = html;
    box.classList.remove('d-none');
  }

  async function applyMapping() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    var text = el('ssPasteBox') ? el('ssPasteBox').value : '';
    if (!key || !text) return;
    setBusy('ssPastePreviewBtn', true, 'Applying mapping...');
    try {
      var mapping = {};
      var selects = document.querySelectorAll('#ssMappingList select');
      selects.forEach(function (s) {
        var pi = s.dataset.pastedIdx;
        var f = s.value;
        if (f) mapping[pi] = f;
      });
      currentMapping = mapping;
      var res = await window.RECON_API.previewPastedWithMap(key, text, mapping);
      var d = res.data || {};
      lastPaste = { key: key, text: text, preview: d, mapping: mapping };
      var box = el('ssPastePreview');
      var hc = d.headerCheck || {};
      var html = '';
      if (hc.ok) {
        html += '<div class="alert alert-success py-2 mb-2 d-flex align-items-center gap-2">'
          + '<i class="bi bi-check-circle-fill fs-5"></i><div>'
          + '<b>Headers validated!</b> Found <b>' + d.total + '</b> rows ('
          + d.inserts + ' new, ' + d.updates + ' updates). Review the sample rows below, then click <b>Confirm &amp; Import</b>.'
          + '</div></div>';
      } else {
        html += '<div class="alert alert-warning py-2 mb-2"><b>Header difference(s) detected: '
          + (hc.mismatches || []).length + '</b> — map your columns above and click Apply Mapping:<br><small>'
          + (hc.mismatches || []).map(function (m) {
            return 'col ' + (m.index + 1) + ': expected <code>' + esc(m.expected)
              + '</code>, got <code>' + esc(m.got) + '</code>';
          }).join('<br>') + '</small></div>';
      }
      var cols = d.sample && d.sample.length ? Object.keys(d.sample[0]) : [];
      html += '<div class="table-responsive border rounded bg-white"><table class="table table-sm table-striped mb-0"><thead><tr>';
      cols.forEach(function (c) { html += '<th class="bg-light">' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      (d.sample || []).forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (c) { html += '<td>' + esc(r[c]) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      if (box) box.innerHTML = html;

      // Update and ENABLE the big Confirm Import button!
      var cb = el('ssPasteConfirmBtn');
      if (cb) {
        if (d.total > 0) {
          cb.disabled = false;
          cb.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import ' + d.total + ' Rows to ' + esc(key);
        } else {
          cb.disabled = true;
          cb.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import to Database';
        }
      }
    } catch (err) {
      alertBox('danger', 'Mapping application failed: ' + esc(err.message));
    } finally {
      setBusy('ssPastePreviewBtn', false);
    }
  }

  function pasteClear() {
    if (el('ssPasteBox')) el('ssPasteBox').value = '';
    if (el('ssPastePreview')) el('ssPastePreview').innerHTML = '';
    var cb = el('ssPasteConfirmBtn');
    if (cb) {
      cb.disabled = true;
      cb.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import to Database';
    }
    if (el('ssPasteResultCard')) el('ssPasteResultCard').classList.add('d-none');
    lastPaste = { key: '', text: '', preview: null, mapping: null };
    pasteCount();
  }

  async function pastePreview() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    var text = el('ssPasteBox') ? el('ssPasteBox').value : '';
    if (!key) { alertBox('warning', 'Please pick which sheet you pasted first in Step 1.'); return; }
    if (!text.trim()) { alertBox('warning', 'Please paste your copied sheet data in Step 2.'); return; }
    setBusy('ssPastePreviewBtn', true, 'Checking & validating...');
    if (el('ssPasteResultCard')) el('ssPasteResultCard').classList.add('d-none');
    try {
      // Load saved mapping for this sheet BEFORE preview
      await loadMappingPref(key);
      var res = await window.RECON_API.previewPastedWithMap(key, text, currentMapping || {});
      var d = res.data || {};
      var parsedHeaders = text.split(/\r?\n/).filter(function(l){return l.trim().length>0;});
      var firstLine = parsedHeaders[0] || '';
      var delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length ? '\t' : ',';
      var pastedHeaders = firstLine.split(delim).map(function(c){return c.trim();});
      var sheetListData = await sheetList();
      var m = sheetListData.filter(function(s){return s.key===key;})[0];
      var expectedFields = m && m.expectedHeaders ? m.expectedHeaders : [];

      // Show mapping UI if there are column mismatches
      var hc = d.headerCheck || {};
      if (!hc.ok) {
        renderMappingUI(pastedHeaders, expectedFields, currentMapping);
      } else {
        var box = el('ssMappingBox');
        if (box) box.classList.add('d-none');
      }

      lastPaste = { key: key, text: text, preview: d, mapping: currentMapping };
      var box2 = el('ssPastePreview');
      var html = '';
      if (hc.ok) {
        html += '<div class="alert alert-success py-2 mb-2 d-flex align-items-center gap-2">'
          + '<i class="bi bi-check-circle-fill fs-5"></i><div>'
          + '<b>Headers validated!</b> Found <b>' + d.total + '</b> rows ('
          + d.inserts + ' new, ' + d.updates + ' updates). Review the sample rows below, then click <b>Confirm &amp; Import</b>.'
          + '</div></div>';
      } else {
        html += '<div class="alert alert-warning py-2 mb-2"><b>Header difference(s) detected: '
          + (hc.mismatches || []).length + '</b> — map your columns in Step 3 above, then click Apply Mapping:<br><small>'
          + (hc.mismatches || []).map(function (mm) {
            return 'col ' + (mm.index + 1) + ': expected <code>' + esc(mm.expected)
              + '</code>, got <code>' + esc(mm.got) + '</code>';
          }).join('<br>') + '</small></div>';
      }
      var cols = d.sample && d.sample.length ? Object.keys(d.sample[0]) : [];
      html += '<div class="table-responsive border rounded bg-white"><table class="table table-sm table-striped mb-0"><thead><tr>';
      cols.forEach(function (c) { html += '<th class="bg-light">' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      (d.sample || []).forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (c) { html += '<td>' + esc(r[c]) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      if (box2) box2.innerHTML = html;

      // Update and ENABLE the big Confirm Import button!
      var cb = el('ssPasteConfirmBtn');
      if (cb) {
        if (d.total > 0) {
          cb.disabled = false;
          cb.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import ' + d.total + ' Rows to ' + esc(key);
        } else {
          cb.disabled = true;
          cb.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import to Database';
        }
      }
    } catch (err) {
      alertBox('danger', 'Data validation failed: ' + esc(err.message));
    } finally {
      setBusy('ssPastePreviewBtn', false);
    }
  }

  async function pasteConfirm() {
    if (!lastPaste.key || !lastPaste.text) { alertBox('warning', 'Please check and validate the pasted data first.'); return; }
    var n = lastPaste.preview ? lastPaste.preview.total : 0;
    var ok = window.confirm('Are you sure you want to import ' + n + ' rows into "' + lastPaste.key + '"? Existing records will be updated.');
    if (!ok) return;
    setBusy('ssPasteConfirmBtn', true, 'Importing ' + n + ' rows to ' + lastPaste.key + '...');
    try {
      var res = await window.RECON_API.importPasted(lastPaste.key, lastPaste.text, lastPaste.mapping || currentMapping || {});
      var d = res.data || {};
      var errs = d.errors || [];
      var card = el('ssPasteResultCard');
      var rbox = el('ssPasteResultBox');
      if (card) card.classList.remove('d-none');
      if (rbox) {
        rbox.innerHTML = '<div class="alert alert-' + (errs.length ? 'warning' : 'success') + ' mb-2">'
          + '<h6 class="alert-heading fw-bold mb-1"><i class="bi bi-check-circle-fill me-1"></i>Import Completed Successfully</h6>'
          + 'Imported <b>' + (d.imported || 0) + '</b> records into table <code>' + esc(d.table || lastPaste.key) + '</code>.'
          + (errs.length ? ' <span class="badge bg-danger ms-2">' + errs.length + ' errors</span>' : '') + '</div>'
          + (errs.length ? '<ul class="small text-danger mb-0">' + errs.slice(0, 10).map(function(e) { return '<li>' + esc(e.message || JSON.stringify(e)) + '</li>'; }).join('') + '</ul>' : '');
      }
      alertBox('success', '<b>Import Complete!</b> Successfully saved <b>' + (d.imported || 0) + '</b> records into <b>' + esc(d.key || lastPaste.key) + '</b>.');
      pasteClear();
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      alertBox('danger', 'Import failed: ' + esc(err.message));
    } finally {
      var cb2 = el('ssPasteConfirmBtn');
      if (cb2) {
        cb2.disabled = true;
        cb2.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import to Database';
      }
    }
  }

  window.SheetsSync = {
    loadConnection: loadConnection,
    saveConnection: saveConnection,
    test: test,
    preview: preview,
    confirmImport: confirmImport,
    fillPastePicker: fillPastePicker,
    showExpected: showExpected,
    pasteCount: pasteCount,
    pasteClear: pasteClear,
    pastePreview: pastePreview,
    pasteConfirm: pasteConfirm,
    renderMappingUI: renderMappingUI,
    applyMapping: applyMapping,
    loadMappingPref: loadMappingPref,
    saveMappingPref: saveMappingPref,
    clearMappingPref: clearMappingPref
  };

  window.initSheetsSync = function () {
    loadConnection();
    fillPastePicker();
  };
})();
