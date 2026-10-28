var ScannerModule = (function() {
  let currentSessionItems = [];
  let currentQty = "";
  let currentActiveItem = null;
  let currentLocation = "";
  if (typeof window.t === 'undefined') {
    window.t = (key) => (typeof getI18nText === 'function' ? getI18nText(key) : (typeof i18n === 'function' ? i18n(key) : key));
  }
  var t = window.t;

  function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  }

  function updateLocationUI() {
    const select = document.getElementById('scannerLocationSelect');
    if (!select) return;
    select.value = currentLocation || "";
  }

  function createScannedItem(found, barcode) {
    const geo = String((found && found.geo) || "").trim();
    const pn = String((found && found.pn) || "").trim();
    const en = String((found && found.en) || "").trim();
    const es = String((found && found.es) || "").trim();
    const displayName = en || es || t('scanner_item_found');

    return {
      barcode: barcode,
      geo: geo,
      pn: pn,
      en: en,
      es: es,
      name: displayName,
    };
  }


  function populateScannerLocationOptions() {
    const select = document.getElementById('scannerLocationSelect');
    if (!select) return;
    const placeholder = t('scanner_select_location', 'Select location');
    const loadingLabel = t('scanner_loading_locations', 'Loading locations...');
    let options = `<option value="">${placeholder}</option>`;
    const cache = window.CachedDataVal;

    if (cache && Array.isArray(cache.sites) && cache.sites.length) {
      options += cache.sites.map(site => {
        const name = String(site.name || site).trim();
        const suffix = String(site.suffix || '').trim();
        const label = suffix ? `${name} (${suffix})` : name;
        return `<option value="${name}">${label}</option>`;
      }).join('');
    } else if (typeof window.loadValidationCache === 'function') {
      options = `<option value="">${loadingLabel}</option>`;
      window.loadValidationCache();
    }

    select.innerHTML = options;
    if (currentLocation) select.value = currentLocation;
  }


  // ─── Filter UI helpers ──────────────────────────────────────────────────────

  function populateScannerFilterSiteOptions() {
    const select = document.getElementById('scannerFilterSite');
    if (!select) return;
    const cache = window.CachedDataVal;

    if (cache && Array.isArray(cache.sites) && cache.sites.length) {
      const currentVal = select.value;
      select.innerHTML = `<option value="all">${t('scanner_filter_all_sites', 'All Sites')}</option>` +
        cache.sites.map(site => {
          const name = String(site.name || site).trim();
          const suffix = String(site.suffix || '').trim();
          const label = suffix ? `${name} (${suffix})` : name;
          return `<option value="${name}">${label}</option>`;
        }).join('');
      // Preserve selection if possible
      if ([...select.options].some(o => o.value === currentVal)) {
        select.value = currentVal;
      }
    }
  }

  function getFilterValues() {
    return {
      site: document.getElementById('scannerFilterSite')?.value || 'all',
      from: document.getElementById('scannerFilterFrom')?.value || '',
      to: document.getElementById('scannerFilterTo')?.value || ''
    };
  }

  function showFilterNotice(site, from, to) {
    const banner = document.getElementById('scanner-filter-notice');
    const textEl = document.getElementById('scanner-filter-text');
    if (!banner || !textEl) return;

    const parts = [];
    if (site && site !== 'all') parts.push(site);
    if (from) parts.push(from);
    if (to) parts.push(to);

    if (parts.length === 0) {
      banner.classList.add('d-none');
      textEl.innerText = '';
      return;
    }

    banner.classList.remove('d-none');
    const siteLabel = site && site !== 'all' ? site : t('scanner_filter_all_sites', 'All Sites');
    let msg;
    if (from || to) {
      msg = t('scanner_filter_notice', 'Showing counts for {site} from {from} to {to}');
      msg = msg.replace('{site}', siteLabel).replace('{from}', from || '-').replace('{to}', to || '-');
    } else {
      msg = t('scanner_filter_notice_all', 'Showing all counts');
      msg = msg.replace('{site}', siteLabel);
    }
    textEl.innerHTML = msg;
  }

  function applyFilters() {
    refreshDashboardTable();
  }

  function clearFilters() {
    const siteEl = document.getElementById('scannerFilterSite');
    const fromEl = document.getElementById('scannerFilterFrom');
    const toEl = document.getElementById('scannerFilterTo');
    if (siteEl) siteEl.value = 'all';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    showFilterNotice('all', '', '');
    refreshDashboardTable();
  }


  // ─── Pagination ──────────────────────────────────────────────────────────────

  const SCANNER_PAGE_SIZE = 15;
  let scannerCurrentPage = 1;
  let scannerFilteredHistory = [];


  function renderPagination() {
    const foot = document.getElementById('countHistoryFoot');
    if (!foot) return;
    const total = scannerFilteredHistory.length;
    if (total === 0) { foot.innerHTML = ''; return; }

    const totalPages = Math.ceil(total / SCANNER_PAGE_SIZE);
    const page = Math.min(scannerCurrentPage, totalPages);
    const start = (page - 1) * SCANNER_PAGE_SIZE + 1;
    const end = Math.min(page * SCANNER_PAGE_SIZE, total);

    let html = `<tr><td colspan="5" class="text-center py-2">`;
    html += `<small class="text-muted me-2">${t('scanner_page_info', 'Page')} ${page} ${t('scanner_of', 'of')} ${totalPages} &middot; ${start}&ndash;${end} ${t('scanner_of_total', 'of')} ${total}</small>`;

    // Prev
    html += `<button class="btn btn-sm btn-outline-secondary me-1 ${page <= 1 ? 'disabled' : ''}" onclick="ScannerModule.goToPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>&lsaquo; ${t('scanner_prev', 'Prev')}</button>`;

    // Page number buttons (compact range)
    const range = getPageRange(page, totalPages);
    html += `<div class="d-flex gap-1 justify-content-center flex-wrap ms-2 me-2">`;
    for (const p of range) {
      const active = p === page ? 'active bg-primary text-white' : '';
      html += `<button class="btn btn-sm btn-outline-secondary pagination-page ${active}" onclick="ScannerModule.goToPage(${p})">${p}</button>`;
    }
    html += `</div>`;

    // Next
    html += `<button class="btn btn-sm btn-outline-secondary ms-1 ${page >= totalPages ? 'disabled' : ''}" onclick="ScannerModule.goToPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>${t('scanner_next', 'Next')} &rsaquo;</button>`;

    html += `</td></tr>`;
    foot.innerHTML = html;
  }

  function getPageRange(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = [];
    pages.push(1);
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  function goToPage(page) {
    if (page < 1 || page > Math.ceil(scannerFilteredHistory.length / SCANNER_PAGE_SIZE)) return;
    scannerCurrentPage = page;
    renderDashboardRows();
    renderPagination();
  }

  function renderDashboardRows() {
    const historyBody = document.getElementById('countHistoryBody');
    if (!historyBody) return;

    const start = (scannerCurrentPage - 1) * SCANNER_PAGE_SIZE;
    const pageRows = scannerFilteredHistory.slice(start, start + SCANNER_PAGE_SIZE);

    historyBody.innerHTML = pageRows.map(row => {
      const countId = row[0];
      const dateVal = row[1] ? new Date(row[1]) : null;
      const dateStr = (dateVal && !isNaN(dateVal.getTime())) ? dateVal.toLocaleDateString() : t('scanner_unknown');
      const locationText = row[4] || '';

      return `
        <tr>
          <td>${dateStr}</td>
          <td>${row[2] || t('scanner_unknown')}</td>
          <td>${locationText}</td>
          <td><span class="badge bg-success">${row[3] || t('scanner_completed')}</span></td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-danger" title="${t('scanner_pdf')}" onclick="ScannerModule.exportData('${countId}', 'pdf')"><i class="bi bi-file-pdf"></i></button>
              <button class="btn btn-outline-success" title="${t('scanner_excel')}" onclick="ScannerModule.exportData('${countId}', 'excel')"><i class="bi bi-file-earmark-excel"></i></button>
              <button class="btn btn-outline-primary" title="${t('scanner_csv')}" onclick="ScannerModule.exportData('${countId}', 'csv')"><i class="bi bi-filetype-csv"></i></button>
              <button class="btn btn-outline-secondary" title="${t('scanner_copy')}" onclick="ScannerModule.exportData('${countId}', 'copy')"><i class="bi bi-clipboard"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Clear tfoot if no rows (shouldn't happen but safety)
    const foot = document.getElementById('countHistoryFoot');
    if (foot && pageRows.length === 0) foot.innerHTML = '';
  }


  function updateSessionUI() {
    const list = document.getElementById('sessionItemsList');
    if (list) {
      list.innerHTML = currentSessionItems.slice().reverse().map((item, index) => {
        // Calculate the actual index in the un-reversed array for correct deletion
        const actualIndex = currentSessionItems.length - 1 - index;
        return `
          <tr>
            <td>
              <div class="fw-bold text-dark">${item.geo || item.barcode}</div>
              <div class="text-muted small" style="font-size:0.72rem;">${item.pn ? `PN: ${item.pn}` : ''}</div>
              <div class="small text-dark">EN: ${item.en || '---'}</div>
              <div class="small text-dark">ES: ${item.es || '---'}</div>
              <div class="text-muted small" style="font-size:0.7rem;">${item.barcode}</div>
            </td>
            <td class="text-end align-middle">
              <span class="fw-bold text-primary me-2">x${item.qty}</span>
              <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="ScannerModule.removeItem(${actualIndex})" title="${t('scanner_remove_item', 'Remove')}">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

/*
  function refreshDashboardTable() {
    const historyBody = document.getElementById('countHistoryBody');
    if (!historyBody) return;

    google.script.run.withSuccessHandler(function(data) {
      if (!data || !data.history) return;

      historyBody.innerHTML = data.history.map(row => {
        const countId = row[0]; // SC-ID
        const dateVal = row[1] ? new Date(row[1]) : null;
        const dateStr = (dateVal && !isNaN(dateVal.getTime())) ? dateVal.toLocaleDateString() : t('scanner_unknown');
        const locationText = row[4] || '';
        
        return `
          <tr>
            <td>${dateStr}</td>
            <td>${row[2] || t('scanner_unknown')}</td>
            <td>${locationText}</td>
            <td><span class="badge bg-success">${row[3] || t('scanner_completed')}</span></td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-danger" title="${t('scanner_pdf')}" onclick="ScannerModule.exportData('${countId}', 'pdf')"><i class="bi bi-file-pdf"></i></button>
                <button class="btn btn-outline-success" title="${t('scanner_excel')}" onclick="ScannerModule.exportData('${countId}', 'excel')"><i class="bi bi-file-earmark-excel"></i></button>
                <button class="btn btn-outline-primary" title="${t('scanner_csv')}" onclick="ScannerModule.exportData('${countId}', 'csv')"><i class="bi bi-filetype-csv"></i></button>
                <button class="btn btn-outline-secondary" title="${t('scanner_copy')}" onclick="ScannerModule.exportData('${countId}', 'copy')"><i class="bi bi-clipboard"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="5" class="text-center text-muted">${t('scanner_no_history')}</td></tr>`;
    }).getScannerData();
  }
*/

function refreshDashboardTable() {
    const historyBody = document.getElementById('countHistoryBody');
    if (!historyBody) return;

    // Read filter values from UI
    const filters = getFilterValues();

    google.script.run.withSuccessHandler(function(data) {
      if (!data || !data.history) {
        scannerFilteredHistory = [];
        scannerCurrentPage = 1;
        historyBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">${t('scanner_no_history')}</td></tr>`;
        renderPagination();
        return;
      }

      // 1. Get current site from window.currentUser or localStorage fallback
      let userSite = window.currentUser ? window.currentUser.site : null;
      if (!userSite) {
        try {
          const secureData = JSON.parse(localStorage.getItem("recon_user_secure") || "{}");
          userSite = secureData.site || null;
        } catch (e) {
          console.error(e);
        }
      }

      // 2. Build combined filter: UI filters take precedence, then user site, then all
      let filteredHistory = data.history;

      // 2a. Date range filter (from/to — inclusive on both ends, whole-day)
      if (filters.from || filters.to) {
        const fromDate = filters.from ? new Date(filters.from + "T00:00:00") : null;
        const toDate = filters.to ? new Date(filters.to + "T23:59:59") : null;
        filteredHistory = filteredHistory.filter(row => {
          const rowDate = row[1] ? new Date(row[1]) : null;
          if (!rowDate || isNaN(rowDate.getTime())) return false;
          if (fromDate && rowDate < fromDate) return false;
          if (toDate && rowDate > toDate) return false;
          return true;
        });
      }

      // 2b. Site filter (UI dropdown)
      if (filters.site && filters.site !== 'all') {
        const siteFilter = filters.site.trim().toLowerCase();
        filteredHistory = filteredHistory.filter(row => {
          const rowLocation = String(row[4] || '').trim().toLowerCase();
          return rowLocation === siteFilter;
        });
      } else if (userSite) {
        // 2c. Fallback: filter by user's assigned site when no UI site filter is active
        filteredHistory = filteredHistory.filter(row => {
          const rowLocation = String(row[4] || '').trim().toLowerCase();
          return rowLocation === String(userSite).trim().toLowerCase();
        });
      }

      // Store filtered results for pagination
      scannerFilteredHistory = filteredHistory;
      scannerCurrentPage = 1;

      // 3. Show filter notice banner
      showFilterNotice(filters.site, filters.from, filters.to);

      // 4. Render with pagination
      if (filteredHistory.length === 0) {
        historyBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">${t('scanner_no_data_in_range', 'No counts in selected range')}</td></tr>`;
        renderPagination();
        return;
      }

      renderDashboardRows();
      renderPagination();
    }).getScannerData(filters.from, filters.to);
  }

  function handleScan(barcode) {
    if (!barcode) return;
    barcode = barcode.trim().toUpperCase();
    if (typeof fullInventory === 'undefined') return;

    const found = fullInventory.find(item => 
      String(item.pn || "").toUpperCase() === barcode || 
      String(item.geo || "").toUpperCase() === barcode
    );

    const scannedItem = createScannedItem(found, barcode);
    const itemName = scannedItem.name || t('scanner_unknown_item');
    const existingIndex = currentSessionItems.findIndex(i => i.barcode === barcode);
    
    currentActiveItem = scannedItem;
    currentQty = "";
    
    safeSetText('displayBarcode', barcode);
    safeSetText('displayName', itemName);
    safeSetText('displayGeo', scannedItem.geo || '---');
    safeSetText('displayPn', scannedItem.pn || '---');
    safeSetText('displayEn', scannedItem.en || '---');
    safeSetText('displayEs', scannedItem.es || '---');
    safeSetText('displayQty', '0');
    
    const card = document.getElementById('activeItemCard');
    const badge = document.getElementById('duplicateBadge');
    if (card && badge) {
      if (existingIndex > -1) {
        card.classList.add('duplicate-active');
        badge.classList.remove('d-none');
      } else {
        card.classList.remove('duplicate-active');
        badge.classList.add('d-none');
      }
    }
  }

  return {
    init: function() {
      // Populate filter site dropdown before first render
      populateScannerFilterSiteOptions();
      setTimeout(refreshDashboardTable, 200);
    },
    start: function() {
      const dash = document.getElementById('scannerDashboard');
      const active = document.getElementById('activeScanner');
      if (dash) dash.style.display = 'none';
      if (active) active.style.display = 'block';

      // Draft Check
      const draft = localStorage.getItem("scanner_draft_items");
      if (draft) {
        Swal.fire({
          title: t('scanner_draft_found'),
          text: t('scanner_continue_previous'),
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: t('scanner_yes_resume'),
          cancelButtonText: t('scanner_start_fresh')
        }).then((result) => {
          if (result.isConfirmed) {
            this.loadDraft();
          } else {
            this.clearDraft();
            currentSessionItems = [];
            updateSessionUI();
          }
        });
      } else {
        currentSessionItems = [];
        currentLocation = "";
        updateSessionUI();
        updateLocationUI();
      }
      
      // Bind Scanner
      const trigger = document.getElementById('hiddenScanTrigger');
      if (trigger && !trigger.dataset.bound) {
        trigger.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleScan(trigger.value);
            trigger.value = "";
          }
        });
        trigger.dataset.bound = "true";
      }
      populateScannerLocationOptions();
      const locationSelect = document.getElementById('scannerLocationSelect');
      if (locationSelect && !locationSelect.dataset.bound) {
        locationSelect.addEventListener('change', () => {
          currentLocation = locationSelect.value;
        });
        locationSelect.dataset.bound = 'true';
      }
      // Bind Stock Mode selector – updates the helper description text
      const stockModeSelect = document.getElementById('scannerStockMode');
      if (stockModeSelect && !stockModeSelect.dataset.bound) {
        stockModeSelect.addEventListener('change', () => {
          const desc = document.getElementById('scannerModeDesc');
          if (desc) {
            desc.innerText = stockModeSelect.value === 'add'
              ? t('scanner_mode_add_desc', 'Counted quantity will be added to existing stock')
              : t('scanner_mode_replace_desc', 'Counted quantity will overwrite existing stock');
          }
        });
        stockModeSelect.dataset.bound = 'true';
      }
      // Apply site lock for USER role
      if (window.currentUser && window.currentUser.site) {
        window.applySiteLock('scannerLocationSelect', window.currentUser.site);
      }
      this.reset();
    },
    reset: function() {
      currentActiveItem = null;
      currentQty = "";
      currentLocation = currentLocation || "";
      safeSetText('displayBarcode', t('scanner_ready_scan'));
      safeSetText('displayName', '---');
      safeSetText('displayGeo', '---');
      safeSetText('displayPn', '---');
      safeSetText('displayEn', '---');
      safeSetText('displayEs', '---');
      safeSetText('displayQty', '0');
      const card = document.getElementById('activeItemCard');
      if (card) card.classList.remove('duplicate-active');
      const badge = document.getElementById('duplicateBadge');
      if (badge) badge.classList.add('d-none');
      const trigger = document.getElementById('hiddenScanTrigger');
      if (trigger) trigger.focus();
      updateLocationUI();
    },
    loadDraft: function() {
      const saved = localStorage.getItem("scanner_draft_items");
      if (saved) {
        const savedObj = JSON.parse(saved);
        currentSessionItems = savedObj.items || [];
        currentLocation = savedObj.location || "";
        updateSessionUI();
        updateLocationUI();
        Swal.fire(t('scanner_restored'), `${currentSessionItems.length} ${t('scanner_items_loaded')}`, 'success');
      }
    },
    saveAsDraft: function() {
      if (currentSessionItems.length === 0) return;
      localStorage.setItem("scanner_draft_items", JSON.stringify({ items: currentSessionItems, location: currentLocation }));
      Swal.fire({ title: t('scanner_draft_saved'), icon: 'success', timer: 1500, showConfirmButton: false });
      this.cancel();
    },
    clearDraft: function() {
      localStorage.removeItem("scanner_draft_items");
    },
    cancel: function() {
      document.getElementById('scannerDashboard').style.display = 'block';
      document.getElementById('activeScanner').style.display = 'none';
      refreshDashboardTable();
    },
    press: function(n) {
      if (n === 'C') currentQty = currentQty.slice(0, -1);
      else if (currentQty.length < 8) currentQty += n;
      safeSetText('displayQty', currentQty || "0");
    },
    commit: function() {
      if (!currentActiveItem || !currentQty || currentQty === "0") {
        Swal.fire(t('msg_error'), t('scanner_scan_qty_warning'), 'warning');
        return;
      }
      const qty = parseInt(currentQty);
      const idx = currentSessionItems.findIndex(i => i.barcode === currentActiveItem.barcode);
      if (idx > -1) {
        const existing = currentSessionItems[idx];
        currentSessionItems[idx] = {
          ...existing,
          ...currentActiveItem,
          qty: (Number(existing.qty) || 0) + qty,
        };
      } else {
        currentSessionItems.push({ ...currentActiveItem, qty: qty });
      }
      
      updateSessionUI();
      this.reset();
    },
    removeItem: function(index) {
      if (index > -1 && index < currentSessionItems.length) {
        currentSessionItems.splice(index, 1);
        updateSessionUI();
      }
    },
    save: function() {
      if (currentSessionItems.length === 0) return;

      // Extract name from your secure session object
      const secureData = localStorage.getItem("recon_user_secure");
      let userName = 'Unknown User';
      if (secureData) {
        try {
          const userObj = JSON.parse(secureData);
          userName = userObj.name || 'Unknown User';
        } catch (e) { console.error(e); }
      }
      
      if (!currentLocation) {
        Swal.fire(t('msg_error'), t('scanner_select_location_required', 'Please select a location'), 'warning');
        return;
      }

      const stockMode = (document.getElementById('scannerStockMode') || {}).value || 'replace';

      Swal.fire({
        title: t('scanner_finish_save'),
        text: `${t('scanner_recording_count_for')} ${userName}`,
        icon: 'question',
        showCancelButton: true
      }).then((res) => {
        if (res.isConfirmed) {
          // Immediately disable the save button to prevent double-clicks
          const saveBtn = document.getElementById('btn_save_scanner');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.6';
            saveBtn.style.cursor = 'not-allowed';
          }

          google.script.run
            .withSuccessHandler((result) => {
              // Re-enable button (though clearDraft/cancel resets the view)
              if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
              }

              if (result && result.stockUpdated) {
                Swal.fire(t('scanner_saved'), 'Stock levels updated successfully', 'success');
              } else {
                Swal.fire(t('scanner_saved'), '', 'success');
              }
              this.clearDraft();
              this.cancel();
            })
            .withFailureHandler((err) => {
              console.error(err);
              
              // Re-enable button on failure so user can try again
              if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
              }

              Swal.fire(i18n('msg_error'), i18n('msg_sys_error'), 'warning');
            })
            .saveStockCount({ 
              items: currentSessionItems, 
              userName: userName, 
              location: currentLocation,
              stockMode: stockMode
            });
        }
      });
    },
    exportData: function(countId, format) {
      Swal.fire({ title: t('scanner_preparing_data'), allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

      google.script.run.withSuccessHandler((items) => {
        Swal.close();
        if (!items || items.length === 0) {
          Swal.fire(t('msg_error'), t('scanner_no_items_record'), 'error');
          return;
        }

        const headers = ["Barcode", "Geocode", "Product Number", "Desc EN", "Desc ES", "Quantity"];
        const rows = items.map(it => [it.barcode, it.geo || "", it.pn || "", it.en || it.name || "", it.es || "", it.qty]);

        // 1. COPY TO CLIPBOARD (COMMA SEPARATED)
        if (format === 'copy') {
          const csvText = [headers, ...rows].map(r => r.join(",")).join("\n");
          
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(csvText).then(() => {
              Swal.fire(t('scanner_copied'), t('scanner_data_copied_csv'), 'success');
            });
          } else {
            // Fallback for non-secure contexts
            const textArea = document.createElement("textarea");
            textArea.value = csvText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            Swal.fire(t('scanner_copied'), t('scanner_data_copied_fallback'), 'success');
          }
        } 
        
        // 2. CSV DOWNLOAD
        else if (format === 'csv') {
          let csvContent = "\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          link.setAttribute("download", `${countId}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

        // 3. EXCEL DOWNLOAD (Using SheetJS)
        else if (format === 'excel') {
          if (typeof XLSX === 'undefined') {
             Swal.fire(t('scanner_library_missing'), t('scanner_excel_missing'), 'error');
             return;
          }
          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
          XLSX.utils.book_append_sheet(wb, ws, t('scanner_inventory_sheet'));
          XLSX.writeFile(wb, `${countId}.xlsx`);
        }

        // 4. PDF DOWNLOAD (Fixing the Uncaught Error)
        else if (format === 'pdf') {
          try {
            // Use window namespaces to ensure visibility in GAS iframe
            const jsPDF = window.jspdf?.jsPDF;
            const hasAutoTable = typeof window.autoTable === 'function' || !!window.jspdf?.autoTable;

            if (!jsPDF || !hasAutoTable) {
              Swal.fire({
                icon: 'error',
                title: t('scanner_pdf_error'),
                text: t('scanner_pdf_missing_libs'),
                confirmButtonText: 'OK'
              });
              return;
            }

            const doc = new jsPDF();
            
            doc.setFontSize(16);
            doc.text(t('scanner_stock_count_report'), 14, 15);
            doc.setFontSize(10);
            doc.text(`ID: ${countId}`, 14, 22);
            doc.text(`${t('scanner_generated')} ${new Date().toLocaleString()}`, 14, 27);

            doc.autoTable({
              head: [headers],
              body: rows,
              startY: 35,
              theme: 'grid',
              headStyles: { fillColor: [41, 128, 185] }
            });

            doc.save(`${countId}.pdf`);
          } catch (err) {
            console.error("PDF Error:", err);
            Swal.fire(t('scanner_pdf_error'), t('scanner_pdf_missing_libs'), 'error');
          }
        }
      }).getItemsByCountId(countId);
    }
  };
})();
