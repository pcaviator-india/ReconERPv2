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
    var hasHdr = el('ssHasHeaderRow') ? el('ssHasHeaderRow').checked : true;
    var n = t.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; }).length;
    var count = hasHdr ? Math.max(0, n - 1) : n;
    if (el('ssPasteCount')) {
      el('ssPasteCount').textContent = String(count) + (hasHdr ? ' data rows + 1 header' : ' data rows (no header)');
    }
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
      var cleanH = String(h || '').trim();
      var normH = cleanH.toLowerCase().replace(/[\s\-_()\/]/g, '');

      var fieldOptions = (expectedFields || []).map(function(f) {
        if (typeof f === 'object' && f !== null) {
          return { label: f.header || f.dbField, value: f.dbField || f.header };
        }
        var s = String(f);
        return { label: s, value: s.toLowerCase().replace(/[\s\-_()\/]/g, '') || s };
      });

      if (!saved) {
        for (var j = 0; j < fieldOptions.length; j++) {
          var fo = fieldOptions[j];
          var normL = fo.label.toLowerCase().replace(/[\s\-_()\/]/g, '');
          var normV = fo.value.toLowerCase().replace(/[\s\-_()\/]/g, '');
          if (normH === normL || normH === normV) {
            saved = fo.value;
            break;
          }
        }
      }

      html += '<div class="col-md-6">';
      html += '<div class="p-2 bg-white rounded border d-flex align-items-center justify-content-between gap-2">';
      html += '<div class="small text-truncate" style="max-width: 45%;"><b>Col ' + (i + 1) + ':</b> <code>' + esc(cleanH) + '</code></div>';
      html += '<div class="flex-grow-1"><select class="form-select form-select-sm" data-pasted-idx="' + i + '">';
      html += '<option value="">— skip this column —</option>';
      fieldOptions.forEach(function (fo) {
        var isSel = (saved === fo.value || saved === fo.label || String(saved).toLowerCase() === fo.value.toLowerCase() || String(saved).toLowerCase() === fo.label.toLowerCase()) ? 'selected' : '';
        html += '<option value="' + esc(fo.value) + '" ' + isSel + '>\u2192 ' + esc(fo.label) + ' (' + esc(fo.value) + ')</option>';
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
      var hasHdr = el('ssHasHeaderRow') ? el('ssHasHeaderRow').checked : true;
      var res = await window.RECON_API.previewPastedWithMap(key, text, mapping, hasHdr);
      var d = res.data || {};
      lastPaste = { key: key, text: text, preview: d, mapping: mapping, hasHeaderRow: hasHdr };
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
      var hasHdr = el('ssHasHeaderRow') ? el('ssHasHeaderRow').checked : true;
      var res = await window.RECON_API.previewPastedWithMap(key, text, currentMapping || {}, hasHdr);
      var d = res.data || {};
      var parsedHeaders = text.split(/\r?\n/).filter(function(l){return l.trim().length>0;});
      var firstLine = parsedHeaders[0] || '';
      var delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length ? '\t' : ',';
      var pastedHeaders = firstLine.split(delim).map(function(c){return c.trim();});
      var sheetListData = await sheetList();
      var m = sheetListData.filter(function(s){return s.key===key;})[0];
      var expectedFields = m && (m.fields || m.expectedHeaders) ? (m.fields || m.expectedHeaders) : [];

      // Show mapping UI if there are column mismatches
      var hc = d.headerCheck || {};
      if (!hc.ok) {
        renderMappingUI(pastedHeaders, expectedFields, currentMapping);
      } else {
        var box = el('ssMappingBox');
        if (box) box.classList.add('d-none');
      }

      lastPaste = { key: key, text: text, preview: d, mapping: currentMapping, hasHeaderRow: hasHdr };
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

    var hasHdr = lastPaste.hasHeaderRow !== undefined ? lastPaste.hasHeaderRow : (el('ssHasHeaderRow') ? el('ssHasHeaderRow').checked : true);
    var mapping = lastPaste.mapping || currentMapping || {};

    // Split text into lines
    var allLines = lastPaste.text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (!allLines.length) { alertBox('warning', 'No data rows found.'); return; }

    var headerLine = hasHdr ? allLines[0] : null;
    var dataLines = hasHdr ? allLines.slice(1) : allLines;
    var totalRows = dataLines.length;

    if (totalRows === 0) { alertBox('warning', 'No data rows to import.'); return; }

    // Batch settings (100 rows per batch ensures Cloudflare Workers subrequest limits are never hit)
    var BATCH_SIZE = 100;
    var batches = [];
    for (var i = 0; i < totalRows; i += BATCH_SIZE) {
      batches.push(dataLines.slice(i, i + BATCH_SIZE));
    }

    var progressCard = el('ssPasteProgressCard');
    var progressTitle = el('ssProgressTitle');
    var progressDetail = el('ssProgressDetail');
    var progressBarFill = el('ssProgressBarFill');
    var resultCard = el('ssPasteResultCard');
    var resultBox = el('ssPasteResultBox');

    if (progressCard) progressCard.classList.remove('d-none');
    if (resultCard) resultCard.classList.add('d-none');

    var totalImported = 0;
    var allErrors = [];
    var lastTable = lastPaste.key;

    setBusy('ssPasteConfirmBtn', true, 'Importing...');

    try {
      for (var b = 0; b < batches.length; b++) {
        var chunk = batches[b];
        var chunkText = headerLine ? [headerLine].concat(chunk).join('\n') : chunk.join('\n');
        var processedSoFar = Math.min((b + 1) * BATCH_SIZE, totalRows);
        var pct = Math.round((processedSoFar / totalRows) * 100);

        if (progressTitle) progressTitle.innerHTML = '<i class="bi bi-arrow-repeat me-1 spin"></i> Processing batch ' + (b + 1) + ' of ' + batches.length + '...';
        if (progressDetail) progressDetail.textContent = processedSoFar + ' / ' + totalRows + ' rows (' + pct + '%)';
        if (progressBarFill) {
          progressBarFill.style.width = pct + '%';
          progressBarFill.textContent = pct + '%';
        }
        setBusy('ssPasteConfirmBtn', true, 'Batch ' + (b + 1) + '/' + batches.length + ' (' + pct + '%)...');

        var res = await window.RECON_API.importPasted(lastPaste.key, chunkText, mapping, Boolean(headerLine));
        var d = res.data || {};
        totalImported += (d.imported || 0);
        if (d.table) lastTable = d.table;
        if (d.errors && d.errors.length) {
          allErrors = allErrors.concat(d.errors);
        }
      }

      if (progressCard) progressCard.classList.add('d-none');
      if (resultCard) resultCard.classList.remove('d-none');
      if (resultBox) {
        resultBox.innerHTML = '<div class="alert alert-' + (allErrors.length ? 'warning' : 'success') + ' mb-2">'
          + '<h6 class="alert-heading fw-bold mb-1"><i class="bi bi-check-circle-fill me-1"></i>Import Completed Successfully</h6>'
          + 'Successfully imported <b>' + totalImported + '</b> records into table <code>' + esc(lastTable) + '</code>.'
          + (allErrors.length ? ' <span class="badge bg-danger ms-2">' + allErrors.length + ' errors</span>' : '') + '</div>'
          + (allErrors.length ? '<ul class="small text-danger mb-0">' + allErrors.slice(0, 10).map(function(e) { return '<li>' + esc(e.message || JSON.stringify(e)) + '</li>'; }).join('') + '</ul>' : '');
      }
      alertBox('success', '<b>Import Complete!</b> Successfully saved <b>' + totalImported + '</b> records into <b>' + esc(lastPaste.key) + '</b> in ' + batches.length + ' batches.');
      pasteClear();
      if (resultCard) resultCard.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      if (progressCard) progressCard.classList.add('d-none');
      alertBox('danger', 'Import failed during batch processing: ' + esc(err.message));
    } finally {
      var cb2 = el('ssPasteConfirmBtn');
      if (cb2) {
        cb2.disabled = true;
        cb2.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-1"></i> 2. Confirm &amp; Import to Database';
      }
    }
  }

  // ============================================================
  // TAB 2: GOOGLE SHEETS LIVE SYNC STUDIO
  // ============================================================
  var studioState = {
    schemas: null,
    currentSheetKey: 'ordenes',
    currentSheetData: null, // { sheetName, headers, sampleRows, totalRows }
    activeMapping: {},      // { [header]: targetField }
    sheetId: '1CVxPVeaO-WIV1YsSFYUawOk4UxL2pWCwCbKEFoBiSaM'
  };

  async function studioInit() {
    try {
      var savedId = localStorage.getItem('recon_sheets_sync_sheet_id');
      if (savedId) {
        studioState.sheetId = savedId;
        if (el('ssStudioSheetId')) el('ssStudioSheetId').value = savedId;
      }
      var res = await window.RECON_API.getSchemaDefinitions();
      if (res && res.data) {
        studioState.schemas = res.data;
      }
      studioOnTabSelected();
    } catch (err) {
      console.warn('Could not load schema definitions:', err);
    }
  }

  function studioSaveSheetId() {
    var input = el('ssStudioSheetId');
    if (!input) return;
    var id = input.value.trim();
    if (!id) {
      alertBox('warning', 'Please enter a valid Google Spreadsheet ID.');
      return;
    }
    studioState.sheetId = id;
    localStorage.setItem('recon_sheets_sync_sheet_id', id);
    alertBox('success', 'Spreadsheet ID saved successfully.');
  }

  function studioOnTabSelected() {
    var sel = el('ssStudioSheetSelect');
    if (!sel) return;
    var key = sel.value;
    studioState.currentSheetKey = key;
    studioState.currentSheetData = null;
    studioState.activeMapping = {};

    var infoEl = el('ssStudioSheetInfo');
    var mapperCard = el('ssStudioMapperCard');
    var previewCard = el('ssStudioPreviewCard');
    var syncCard = el('ssStudioSyncCard');

    if (mapperCard) mapperCard.classList.add('d-none');
    if (previewCard) previewCard.classList.add('d-none');
    if (syncCard) syncCard.classList.add('d-none');

    if (!key || !studioState.schemas || !studioState.schemas[key]) {
      if (infoEl) infoEl.textContent = '';
      return;
    }

    var def = studioState.schemas[key];
    if (infoEl) {
      infoEl.innerHTML = '<span class="badge bg-light text-dark border me-1"><i class="bi bi-file-earmark-spreadsheet me-1 text-success"></i>Tab: <b>' + esc(def.gasSheet) + '</b></span>'
        + '<span class="badge bg-light text-dark border"><i class="bi bi-database me-1 text-primary"></i>Target: <b>' + (def.isSplit ? esc(def.parentTable) + ' + ' + esc(def.childTable) : esc(def.table)) + '</b></span>';
    }
  }

  async function studioFetchColumns() {
    var sel = el('ssStudioSheetSelect');
    var key = sel ? sel.value : '';
    if (!key) {
      alertBox('warning', 'Please select a Google Sheet tab first.');
      return;
    }
    var sheetIdInput = el('ssStudioSheetId');
    var sheetId = (sheetIdInput ? sheetIdInput.value.trim() : '') || studioState.sheetId;
    if (!sheetId) {
      alertBox('warning', 'Please provide a valid Google Spreadsheet ID.');
      return;
    }

    if (!studioState.schemas) {
      try {
        var schemaRes = await window.RECON_API.getSchemaDefinitions();
        studioState.schemas = schemaRes.data;
      } catch (e) {
        alertBox('danger', 'Could not load schema definitions: ' + esc(e.message));
        return;
      }
    }

    var def = studioState.schemas[key];
    if (!def) {
      alertBox('danger', 'Unknown schema configuration for ' + key);
      return;
    }

    setBusy('ssStudioFetchBtn', true, 'Fetching...');
    try {
      var res = await window.RECON_API.fetchRemoteSheet(sheetId, def.gasSheet);
      var data = res.data;
      studioState.currentSheetKey = key;
      studioState.currentSheetData = data;

      // Determine initial mapping:
      // 1. Saved in localStorage?
      var savedPref = null;
      try {
        var rawPref = localStorage.getItem('recon_sheetsync_mapping_' + key);
        if (rawPref) savedPref = JSON.parse(rawPref);
      } catch (e) {}

      var mapping = {};
      var defaultMapping = def.defaultMapping || {};

      data.headers.forEach(function (h) {
        var trimmed = (h || '').trim();
        if (savedPref && savedPref[trimmed] !== undefined) {
          mapping[trimmed] = savedPref[trimmed];
        } else if (defaultMapping[trimmed]) {
          mapping[trimmed] = defaultMapping[trimmed];
        } else {
          // Case-insensitive match check
          var matchedKey = Object.keys(defaultMapping).find(function (k) {
            return k.toLowerCase() === trimmed.toLowerCase();
          });
          if (matchedKey) {
            mapping[trimmed] = defaultMapping[matchedKey];
          } else {
            mapping[trimmed] = '';
          }
        }
      });

      studioState.activeMapping = mapping;
      studioRenderMapperUI();

      var mapperCard = el('ssStudioMapperCard');
      if (mapperCard) mapperCard.classList.remove('d-none');
      var syncCard = el('ssStudioSyncCard');
      if (syncCard) {
        syncCard.classList.remove('d-none');
        var syncTitle = el('ssStudioSyncTitle');
        var syncDesc = el('ssStudioSyncDesc');
        if (syncTitle) syncTitle.textContent = 'Ready to Sync: ' + def.gasSheet;
        if (syncDesc) syncDesc.innerHTML = 'Found <b>' + data.totalRows + ' rows</b> with <b>' + data.headers.length + ' columns</b> in tab <code>' + esc(def.gasSheet) + '</code>. Review mappings above, preview if desired, then click below to execute live sync.';
      }
      var alertResult = el('ssStudioResultAlert');
      if (alertResult) alertResult.classList.add('d-none');

      alertBox('success', 'Successfully fetched <b>' + data.headers.length + ' columns</b> and <b>' + data.totalRows + ' rows</b> from Google Sheet <code>' + esc(def.gasSheet) + '</code>.');
    } catch (err) {
      alertBox('danger', 'Failed to fetch Google Sheet: ' + esc(err.message));
    } finally {
      setBusy('ssStudioFetchBtn', false);
    }
  }

  function studioRenderMapperUI() {
    var def = studioState.schemas[studioState.currentSheetKey];
    var data = studioState.currentSheetData;
    var tbody = el('ssStudioMapperTbody');
    if (!tbody || !def || !data) return;

    var subtitle = el('ssStudioMapperSubtitle');
    if (subtitle) {
      subtitle.innerHTML = 'Tab: <b>' + esc(def.gasSheet) + '</b> • Total Rows in Sheet: <b>' + data.totalRows + '</b>';
    }

    var optionsHtml = '<option value="">-- Ignore this column --</option>';
    if (def.isSplit) {
      optionsHtml += '<optgroup label="📋 Parent Table: ' + esc(def.parentTable) + '">';
      (def.parentFields || []).forEach(function (f) {
        optionsHtml += '<option value="parent.' + esc(f.field) + '">' + esc(f.label) + (f.required ? ' *' : '') + ' [parent.' + esc(f.field) + ']</option>';
      });
      optionsHtml += '</optgroup>';
      optionsHtml += '<optgroup label="📦 Child Items: ' + esc(def.childTable) + '">';
      (def.childFields || []).forEach(function (f) {
        optionsHtml += '<option value="child.' + esc(f.field) + '">' + esc(f.label) + (f.required ? ' *' : '') + ' [child.' + esc(f.field) + ']</option>';
      });
      optionsHtml += '</optgroup>';
    } else {
      optionsHtml += '<optgroup label="🗄️ Database Table: ' + esc(def.table) + '">';
      (def.fields || []).forEach(function (f) {
        optionsHtml += '<option value="' + esc(f.field) + '">' + esc(f.label) + (f.required ? ' *' : '') + ' [' + esc(f.field) + ']</option>';
      });
      optionsHtml += '</optgroup>';
    }

    var sampleRow0 = data.sampleRows && data.sampleRows[0] ? data.sampleRows[0] : [];
    var sampleRow1 = data.sampleRows && data.sampleRows[1] ? data.sampleRows[1] : sampleRow0;

    var rowsHtml = '';
    data.headers.forEach(function (header, idx) {
      var trimmed = (header || '').trim();
      var mappedVal = studioState.activeMapping[trimmed] || '';
      var sampleVal = sampleRow0[idx] !== undefined && sampleRow0[idx] !== '' ? sampleRow0[idx] : (sampleRow1[idx] !== undefined ? sampleRow1[idx] : '');

      var isMapped = Boolean(mappedVal);
      var rowClass = isMapped ? '' : 'table-light text-muted';

      rowsHtml += '<tr class="' + rowClass + '">';
      // Sheet Column
      rowsHtml += '<td><span class="badge bg-secondary me-2">#' + idx + '</span><b class="text-dark">' + esc(header) + '</b></td>';
      // Sample Data
      rowsHtml += '<td><code class="text-secondary small bg-light p-1 rounded d-inline-block text-truncate" style="max-width: 240px;" title="' + esc(sampleVal) + '">' + esc(sampleVal || '<empty>') + '</code></td>';
      // Arrow
      rowsHtml += '<td class="text-center text-muted"><i class="bi bi-arrow-right"></i></td>';
      // Database Target Field Select
      rowsHtml += '<td>';
      rowsHtml += '<select class="form-select form-select-sm studio-mapper-select" data-col-idx="' + idx + '" data-header="' + esc(trimmed) + '" onchange="window.SheetsSyncStudio.onMappingChange(this)">';
      rowsHtml += optionsHtml;
      rowsHtml += '</select>';
      rowsHtml += '</td>';
      rowsHtml += '</tr>';
    });

    tbody.innerHTML = rowsHtml;

    // Apply values
    var selects = tbody.querySelectorAll('.studio-mapper-select');
    selects.forEach(function (selEl) {
      var h = selEl.dataset.header;
      if (studioState.activeMapping[h]) {
        selEl.value = studioState.activeMapping[h];
      }
    });
  }

  function studioOnMappingChange(selEl) {
    var header = selEl.dataset.header;
    var val = selEl.value;
    studioState.activeMapping[header] = val;
    var row = selEl.closest('tr');
    if (row) {
      if (val) row.classList.remove('table-light', 'text-muted');
      else row.classList.add('table-light', 'text-muted');
    }
  }

  function studioSaveMappingPref() {
    var key = studioState.currentSheetKey;
    if (!key) return;
    localStorage.setItem('recon_sheetsync_mapping_' + key, JSON.stringify(studioState.activeMapping));
    alertBox('success', 'Mapping preference for <b>' + esc(key) + '</b> saved successfully!');
  }

  function studioResetDefaultMapping() {
    var key = studioState.currentSheetKey;
    var def = studioState.schemas && studioState.schemas[key];
    if (!def || !studioState.currentSheetData) return;

    localStorage.removeItem('recon_sheetsync_mapping_' + key);
    var mapping = {};
    var defaultMapping = def.defaultMapping || {};

    studioState.currentSheetData.headers.forEach(function (h) {
      var trimmed = (h || '').trim();
      if (defaultMapping[trimmed]) {
        mapping[trimmed] = defaultMapping[trimmed];
      } else {
        var matchedKey = Object.keys(defaultMapping).find(function (k) {
          return k.toLowerCase() === trimmed.toLowerCase();
        });
        mapping[trimmed] = matchedKey ? defaultMapping[matchedKey] : '';
      }
    });

    studioState.activeMapping = mapping;
    studioRenderMapperUI();
    alertBox('info', 'Reset column mappings to original defaults.');
  }

  async function studioGeneratePreview() {
    var key = studioState.currentSheetKey;
    var def = studioState.schemas && studioState.schemas[key];
    var data = studioState.currentSheetData;
    if (!def || !data) return;

    var previewCard = el('ssStudioPreviewCard');
    var previewBody = el('ssStudioPreviewBody');
    if (previewCard) previewCard.classList.remove('d-none');
    if (previewBody) previewBody.innerHTML = '<div class="text-center py-4"><span class="spinner-border spinner-border-sm text-primary me-2"></span> Transforming sample rows...</div>';

    try {
      var res = await window.RECON_API.previewTransformed(key, data.headers, data.sampleRows, studioState.activeMapping);
      var previewData = res.data;

      if (!previewData || !previewData.records || !previewData.records.length) {
        previewBody.innerHTML = '<div class="alert alert-warning mb-0"><i class="bi bi-exclamation-triangle me-2"></i>No records were generated from the sample rows. Please verify your column mappings.</div>';
        return;
      }

      var html = '';
      if (def.isSplit) {
        html += '<div class="mb-2 text-muted small">Showing preview of <b>' + previewData.records.length + ' structured parent records</b> transformed from flat rows:</div>';
        html += '<div class="d-flex flex-column gap-3">';

        previewData.records.slice(0, 3).forEach(function (rec, idx) {
          var p = rec.parent || {};
          var items = rec.items || [];
          var groupKey = p[def.groupKeyField] || ('Parent #' + (idx + 1));

          html += '<div class="card border shadow-none">';
          html += '<div class="card-header bg-light d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">';
          html += '<div>';
          html += '<span class="badge bg-primary fs-6 me-2"><i class="bi bi-folder2-open me-1"></i>' + esc(groupKey) + '</span>';
          if (p.status) html += '<span class="badge bg-info text-dark me-2">' + esc(p.status) + '</span>';
          if (p.requested_by || p.supplier) html += '<span class="small text-muted me-2"><i class="bi bi-person me-1"></i>' + esc(p.requested_by || p.supplier) + '</span>';
          if (p.created_at) html += '<span class="small text-muted"><i class="bi bi-calendar3 me-1"></i>' + esc(p.created_at) + '</span>';
          html += '</div>';
          html += '<span class="badge bg-secondary">' + items.length + ' Line Items</span>';
          html += '</div>';

          html += '<div class="card-body p-0">';
          if (items.length === 0) {
            html += '<div class="p-3 text-muted small">No line items mapped for this record.</div>';
          } else {
            html += '<div class="table-responsive"><table class="table table-sm table-striped align-middle mb-0">';
            html += '<thead class="table-light"><tr><th style="width: 25%;">GEO Code</th><th style="width: 20%;">P/N</th><th style="width: 15%;">Quantity</th><th>Description / Notes</th></tr></thead>';
            html += '<tbody>';
            items.forEach(function (it) {
              html += '<tr>';
              html += '<td><b class="text-primary">' + esc(it.geo || it.geo_code || '—') + '</b></td>';
              html += '<td><code>' + esc(it.pn || '—') + '</code></td>';
              html += '<td><span class="badge bg-secondary">' + esc(it.quantity_requested || it.quantity || it.qty || 1) + '</span></td>';
              html += '<td class="small text-muted">' + esc(it.item_notes || it.description_es || '—') + '</td>';
              html += '</tr>';
            });
            html += '</tbody></table></div>';
          }
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      } else {
        html += '<div class="mb-2 text-muted small">Showing preview of <b>' + previewData.records.length + ' normalized rows</b> for table <code>' + esc(def.table) + '</code>:</div>';
        html += '<div class="table-responsive"><table class="table table-sm table-bordered table-hover align-middle mb-0">';
        html += '<thead class="table-light"><tr>';
        var firstRec = previewData.records[0] || {};
        var fieldKeys = Object.keys(firstRec);
        fieldKeys.forEach(function (fk) {
          html += '<th>' + esc(fk) + '</th>';
        });
        html += '</tr></thead><tbody>';
        previewData.records.slice(0, 5).forEach(function (rec) {
          html += '<tr>';
          fieldKeys.forEach(function (fk) {
            html += '<td><span class="small">' + esc(rec[fk] !== undefined ? rec[fk] : '—') + '</span></td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      }

      previewBody.innerHTML = html;
      previewCard.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      previewBody.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle me-2"></i>Failed to generate preview: ' + esc(err.message) + '</div>';
    }
  }

  async function studioExecuteSync() {
    var key = studioState.currentSheetKey;
    var def = studioState.schemas && studioState.schemas[key];
    var data = studioState.currentSheetData;
    var sheetIdInput = el('ssStudioSheetId');
    var sheetId = (sheetIdInput ? sheetIdInput.value.trim() : '') || studioState.sheetId;

    if (!key || !def || !data) {
      alertBox('warning', 'Please fetch the sheet columns before executing sync.');
      return;
    }

    var confirmMsg = 'Are you ready to sync all ' + (data.totalRows || 'records') + ' rows from Google Sheet tab "' + def.gasSheet + '" into Cloudflare D1?';
    if (!confirm(confirmMsg)) return;

    var execBtn = el('ssStudioExecBtn');
    var progressBox = el('ssStudioProgressBox');
    var progressBar = el('ssStudioProgressBar');
    var progressStatus = el('ssStudioProgressStatus');
    var progressPct = el('ssStudioProgressPct');
    var resultAlert = el('ssStudioResultAlert');

    if (execBtn) execBtn.disabled = true;
    if (progressBox) progressBox.classList.remove('d-none');
    if (resultAlert) resultAlert.classList.add('d-none');

    if (progressStatus) progressStatus.innerHTML = '<i class="bi bi-cloud-arrow-down spin me-1"></i> Fetching entire tab from Google Sheets & transforming records...';
    if (progressBar) { progressBar.style.width = '35%'; progressBar.textContent = '35%'; }
    if (progressPct) progressPct.textContent = '35%';

    try {
      var res = await window.RECON_API.syncRemoteTab(sheetId, key, studioState.activeMapping);
      var result = res.data || {};

      if (progressBar) { progressBar.style.width = '100%'; progressBar.textContent = '100%'; }
      if (progressPct) progressPct.textContent = '100%';
      if (progressStatus) progressStatus.innerHTML = '<i class="bi bi-check-circle-fill text-success me-1"></i> Sync Complete!';

      var resultHtml = '<div class="alert alert-' + ((result.errors && result.errors.length) ? 'warning' : 'success') + ' shadow-sm border">';
      resultHtml += '<h5 class="alert-heading fw-bold mb-2"><i class="bi bi-check-circle-fill me-2"></i>Sync Completed Successfully</h5>';
      resultHtml += '<p class="mb-2">Processed Google Sheet tab: <b>' + esc(result.sheetName || def.gasSheet) + '</b> (<b>' + (result.totalRowsProcessed || data.totalRows) + ' rows</b>).</p>';
      resultHtml += '<div class="d-flex gap-3 flex-wrap my-2">';
      if (result.isSplit) {
        resultHtml += '<div class="p-2 bg-white rounded border"><small class="text-muted d-block">Parent Records Created/Updated</small><b class="fs-5 text-primary">' + (result.importedParents || 0) + '</b> <span class="badge bg-light text-dark border">' + esc(def.parentTable) + '</span></div>';
        resultHtml += '<div class="p-2 bg-white rounded border"><small class="text-muted d-block">Child Line Items Imported</small><b class="fs-5 text-success">' + (result.importedChildren || 0) + '</b> <span class="badge bg-light text-dark border">' + esc(def.childTable) + '</span></div>';
      } else {
        resultHtml += '<div class="p-2 bg-white rounded border"><small class="text-muted d-block">Records Upserted</small><b class="fs-5 text-success">' + (result.importedRecords || 0) + '</b> <span class="badge bg-light text-dark border">' + esc(def.table) + '</span></div>';
      }
      resultHtml += '</div>';

      if (result.errors && result.errors.length) {
        resultHtml += '<div class="mt-2 small text-danger"><b>Warnings / Errors (' + result.errors.length + '):</b><ul class="mb-0">';
        result.errors.slice(0, 5).forEach(function (e) {
          resultHtml += '<li>' + esc(e.message || JSON.stringify(e)) + '</li>';
        });
        resultHtml += '</ul></div>';
      }
      resultHtml += '</div>';

      if (resultAlert) {
        resultAlert.innerHTML = resultHtml;
        resultAlert.classList.remove('d-none');
        resultAlert.scrollIntoView({ behavior: 'smooth' });
      }

      alertBox('success', '<b>Sync Completed!</b> ' + (result.isSplit ? (result.importedParents + ' parents and ' + result.importedChildren + ' child items') : (result.importedRecords + ' records')) + ' successfully imported into D1.');
    } catch (err) {
      if (resultAlert) {
        resultAlert.innerHTML = '<div class="alert alert-danger shadow-sm"><i class="bi bi-x-circle-fill me-2"></i><b>Sync Failed:</b> ' + esc(err.message) + '</div>';
        resultAlert.classList.remove('d-none');
      }
      alertBox('danger', 'Sync failed: ' + esc(err.message));
    } finally {
      if (execBtn) execBtn.disabled = false;
    }
  }

  window.SheetsSyncStudio = {
    init: studioInit,
    saveSheetId: studioSaveSheetId,
    onTabSelected: studioOnTabSelected,
    fetchColumns: studioFetchColumns,
    renderMapperUI: studioRenderMapperUI,
    onMappingChange: studioOnMappingChange,
    saveMappingPref: studioSaveMappingPref,
    resetDefaultMapping: studioResetDefaultMapping,
    generatePreview: studioGeneratePreview,
    executeSync: studioExecuteSync
  };

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
    studioInit();
  };
})();
