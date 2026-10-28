// ============================================================
// SheetsSyncJS.js — Google Sheets Sync GUI
// Flow: load connection -> Fetch & Preview (dry-run) -> confirm -> import.
// Uses RECON_API (api.js): getSheetsStatus/Connection, saveSheetsConnection,
// testSheetsConnection, previewSheets, importSheets.
// ============================================================
(function () {
  'use strict';

  var lastPreview = null;

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
      b.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ' + (label || 'Working...');
    } else if (b.dataset.label) {
      b.innerHTML = b.dataset.label;
    }
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
      alertBox('danger', 'Failed to load connection: ' + esc(err.message));
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
      alertBox('success', 'Connection saved.');
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
      alertBox('danger', 'Preview failed: ' + esc(err.message));
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
      + ' into the local database? Existing records with the same key will be UPDATED.');
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

  // ---- Option 4: paste-import (no Google connection) ----
  var lastPaste = { key: '', text: '', preview: null };
  var statusCache = null;

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
        o.textContent = s.gasSheet + ' to ' + (s.dbTable || '?');
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
    if (!key) { box.textContent = 'Pick a sheet to see its expected columns.'; return; }
    sheetList().then(function (sheets) {
      var m = sheets.filter(function (s) { return s.key === key; })[0];
      box.textContent = m && m.expectedHeaders ? m.expectedHeaders.join('  |  ') : '—';
    });
  }



  function pasteCount() {
    var t = el('ssPasteBox') ? el('ssPasteBox').value : '';
    var n = t.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; }).length;
    if (el('ssPasteCount')) el('ssPasteCount').textContent = String(Math.max(0, n - 1)) + ' + header';
  }

  // ---- Column Mapping ----
  var currentMapping = {}; // { [pastedColIdx]: dbField }

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
    if (!key) { alertBox('warning', 'Pick a sheet first.'); return; }
    // Rebuild mapping from the DOM selects
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
      if (span) { span.classList.remove('d-none'); setTimeout(function(){ span.classList.add('d-none'); }, 2000); }
      alertBox('success', 'Column mapping saved for ' + key + '.');
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
      html += '<div class="row g-2 align-items-center mb-2">';
      html += '<div class="col-auto"><small class="text-muted"><b>Col ' + (i + 1) + ':</b> <code>' + esc(h) + '</code></small></div>';
      html += '<div class="col"><select class="form-select form-select-sm" data-pasted-idx="' + i + '">';
      html += '<option value="">— skip —</option>';
      expectedFields.forEach(function (f) {
        var sel = (saved === f) ? 'selected' : '';
        html += '<option value="' + esc(f) + '" ' + sel + '>' + esc(f) + '</option>';
      });
      html += '</select></div>';
      html += '</div>';
    });
    list.innerHTML = html;
    box.classList.remove('d-none');
  }

  async function applyMapping() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    var text = el('ssPasteBox') ? el('ssPasteBox').value : '';
    if (!key || !text) return;
    setBusy('ssPastePreviewBtn', true, 'Re-checking...');
    try {
      // Rebuild mapping from DOM
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
        html += '<div class="alert alert-success py-2 mb-2">Headers match — <b>' + d.total
          + '</b> rows (' + d.inserts + ' new, ' + d.updates + ' updates). Review sample, then Confirm Import.</div>';
      } else {
        html += '<div class="alert alert-warning py-2 mb-2"><b>Header check: '
          + (hc.mismatches || []).length + ' difference(s)</b> — use column mapping above to fix:<br><small>'
          + (hc.mismatches || []).map(function (m) {
            return 'col ' + (m.index + 1) + ': expected <code>' + esc(m.expected)
              + '</code>, got <code>' + esc(m.got) + '</code>';
          }).join('<br>') + '</small></div>';
      }
      var cols = d.sample && d.sample.length ? Object.keys(d.sample[0]) : [];
      html += '<div class="table-responsive border rounded"><table class="table table-sm table-striped mb-0"><thead><tr>';
      cols.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      (d.sample || []).forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (c) { html += '<td>' + esc(r[c]) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      if (box) box.innerHTML = html;
      var cb = el('ssPasteConfirmBtn');
      if (cb) cb.classList.toggle('d-none', !(d.total > 0));
      // Re-render mapping UI if there are still mismatches, so user can keep adjusting
      try {
        var sheetListData2 = await sheetList();
        var m2 = sheetListData2.filter(function(s){return s.key===key;})[0];
        var expectedFields2 = m2 && m2.expectedHeaders ? m2.expectedHeaders : [];
        var hc2 = d.headerCheck || {};
        if (!hc2.ok) {
          var parsedHeaders2 = text.split(/\r?\n/).filter(function(l){return l.trim().length>0;});
          var firstLine2 = parsedHeaders2[0] || '';
          var delim2 = (firstLine2.match(/\t/g) || []).length >= (firstLine2.match(/,/g) || []).length ? '\t' : ',';
          var pastedHeaders2 = firstLine2.split(delim2).map(function(c){return c.trim();});
          renderMappingUI(pastedHeaders2, expectedFields2, currentMapping || {});
        } else {
          var boxMap = el('ssMappingBox');
          if (boxMap) boxMap.classList.add('d-none');
        }
      } catch (e) {
        // Non-fatal: mapping UI refresh failed, but preview table is already shown
        console.warn('[SheetsSync] mapping UI refresh skipped:', e);
      }
    } catch (err) {
      alertBox('danger', 'Re-check failed: ' + esc(err.message));
    } finally {
      setBusy('ssPastePreviewBtn', false);
    }
  }

//__PASTE2__

  function pasteClear() {
    if (el('ssPasteBox')) el('ssPasteBox').value = '';
    if (el('ssPastePreview')) el('ssPastePreview').innerHTML = '';
    if (el('ssPasteConfirmBtn')) el('ssPasteConfirmBtn').classList.add('d-none');
    lastPaste = { key: '', text: '', preview: null };
    pasteCount();
  }

//__PASTE2__
  async function pastePreview() {
    var key = el('ssPasteSheet') ? el('ssPasteSheet').value : '';
    var text = el('ssPasteBox') ? el('ssPasteBox').value : '';
    if (!key) { alertBox('warning', 'Pick which sheet you pasted first.'); return; }
    if (!text.trim()) { alertBox('warning', 'Paste the copied sheet first.'); return; }
    setBusy('ssPastePreviewBtn', true, 'Checking...');
    try {
      // Load saved mapping for this sheet BEFORE preview so we can send it
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
      // Show mapping UI if there are mismatches
      var hc = d.headerCheck || {};
      if (!hc.ok) {
        renderMappingUI(pastedHeaders, expectedFields, currentMapping);
      } else {
        var box = el('ssMappingBox');
        if (box) box.classList.add('d-none');
      }
      lastPaste = { key: key, text: text, preview: d };
      var box2 = el('ssPastePreview');
      var html = '';
      if (hc.ok) {
        html += '<div class="alert alert-success py-2 mb-2">Headers match — <b>' + d.total
          + '</b> rows (' + d.inserts + ' new, ' + d.updates + ' updates). Review sample, then Confirm Import.</div>';
      } else {
        html += '<div class="alert alert-warning py-2 mb-2"><b>Header check: '
          + (hc.mismatches || []).length + ' difference(s)</b> — map columns below to fix:<br><small>'
          + (hc.mismatches || []).map(function (mm) {
            return 'col ' + (mm.index + 1) + ': expected <code>' + esc(mm.expected)
              + '</code>, got <code>' + esc(mm.got) + '</code>';
          }).join('<br>') + '</small></div>';
      }
      var cols = d.sample && d.sample.length ? Object.keys(d.sample[0]) : [];
      html += '<div class="table-responsive border rounded"><table class="table table-sm table-striped mb-0"><thead><tr>';
      cols.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      (d.sample || []).forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (c) { html += '<td>' + esc(r[c]) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      if (box2) box2.innerHTML = html;
      var cb = el('ssPasteConfirmBtn');
      if (cb) cb.classList.toggle('d-none', !(d.total > 0));
    } catch (err) {
      alertBox('danger', 'Paste check failed: ' + esc(err.message));
    } finally {
      setBusy('ssPastePreviewBtn', false);
    }
  }

  async function pasteConfirm() {
    if (!lastPaste.key || !lastPaste.text) { alertBox('warning', 'Check the pasted data first.'); return; }
    var n = lastPaste.preview ? lastPaste.preview.total : 0;
    var ok = window.confirm('Import ' + n + ' rows into "' + lastPaste.key + '"? Same-key records will be UPDATED.');
    if (!ok) return;
    setBusy('ssPasteConfirmBtn', true, 'Importing...');
    try {
      var res = await window.RECON_API.importPasted(lastPaste.key, lastPaste.text, lastPaste.mapping || currentMapping || {});
      var d = res.data || {};
      var errs = d.errors || [];
      var card = el('ssResultCard');
      var rbox = el('ssResultBox');
      if (card) card.classList.remove('d-none');
      if (rbox) {
        rbox.innerHTML = '<div class="alert alert-' + (errs.length ? 'warning' : 'success') + ' mb-2">'
          + 'Pasted import into <code>' + esc(d.key || '') + '</code>: <b>'
          + (d.imported || 0) + '</b> records.</div>';
      }
      alertBox('success', 'Import finished: <b>' + (d.imported || 0) + '</b> records.');
      pasteClear();
    } catch (err) {
      alertBox('danger', 'Import failed: ' + esc(err.message));
    } finally {
      var cb2 = el('ssPasteConfirmBtn');
      if (cb2) { cb2.disabled = false; cb2.innerHTML = '<i class="bi bi-check-circle"></i> Confirm Import'; }
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

  window.initSheetsSync = function () { loadConnection(); fillPastePicker(); };
})();
