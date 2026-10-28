let rawParsedMatrix = [];
  let uniquePoListMissingCategories = [];
  let macroWizardModalInstance = null;
  
// Pre-defined column allocations (Zero-Indexed based on your file)
let columnIndexes = { 
  date: 0,     // Col 1
  invoice: 4,  // Col 5
  desc: 5,     // Col 6
  item: 6,     // Col 7
  vendor: 8,   // Col 9
  qty: 9,      // Col 10
  cost: 11     // Col 12
};

  window.initCreateBulkPOMACModule = function() {
    console.log("Initializing Bulk PO Macro Module...");
    const modalElement = document.getElementById('macroWizardModal');
    if (modalElement) {
      macroWizardModalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);
    }
    resetWizard();
    loadHistoryLogTable();
    setupModuleEventListeners();
  };

  window.openMacroWizard = function() {
    resetWizard();
    switchPanel('a');
    if (macroWizardModalInstance) macroWizardModalInstance.show();
  };

  function setupModuleEventListeners() {
    const fileInput = document.getElementById('csv-file-loader');
    if (fileInput) fileInput.onchange = handleFileSelect;
  }

  function resetWizard() {
  document.getElementById('csv-raw-input').value = "";
  document.getElementById('csv-file-loader').value = null;
  document.getElementById('delimiter-selector').value = "auto";
  
  // ADD THIS LINE TO RESET THE DATE SELECTOR
  document.getElementById('user-date-format-selector').value = "auto_clean";
  
  document.getElementById('preview-grid-box').style.display = "none";
  document.getElementById('category-mapping-container').innerHTML = "";
  rawParsedMatrix = [];
  uniquePoListMissingCategories = [];
  columnIndexes = { date: 0, invoice: 4, desc: 5, item: 6, vendor: 8, qty: 9, cost: 11 };
}

  function switchPanel(panelKey) {
    document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');
    const targetPanel = document.getElementById('panel-step-' + panelKey);
    if (targetPanel) targetPanel.style.display = 'block';
  }

  function detectDelimiter(textRow) {
    const sel = document.getElementById('delimiter-selector').value;
    if (sel !== 'auto') return sel === '\\t' ? '\t' : sel;

    let commaCount = (textRow.match(/,/g) || []).length;
    let semiCount = (textRow.match(/;/g) || []).length;
    let tabCount = (textRow.match(/\t/g) || []).length;

    if (tabCount > commaCount && tabCount > semiCount) return '\t';
    if (semiCount > commaCount) return ';';
    return ',';
  }

  function updateLivePreview() {
    const rawText = document.getElementById('csv-raw-input').value;
    const previewBox = document.getElementById('preview-grid-box');
    const tableElement = document.getElementById('live-preview-table');

    if (!rawText.trim()) {
      previewBox.style.display = "none";
      return;
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l !== "");
    if (lines.length === 0) return;

    const delimiter = detectDelimiter(lines[0]);
    const previewRows = lines.slice(0, 3).map(l => l.split(delimiter));

    let html = "<tbody>";
    previewRows.forEach((row, rIdx) => {
      html += `<tr class="${rIdx === 0 ? 'table-secondary fw-bold' : ''}">`;
      row.forEach(cell => {
        html += `<td>${cell.replace(/^["']|["']$/g, '').trim() || '&nbsp;'}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody>";

    tableElement.innerHTML = html;
    previewBox.style.display = "block";
  }

  /**
   * Safe processing route evaluating if a standard string layout or a binary spreadsheet was selected
   */
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    if (extension === 'xlsx' || extension === 'xls') {
      // Route through SheetJS binary extraction array parser
      reader.onload = function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to standard Tab-Separated string values to populate preview matrix natively
        const tsvOutput = XLSX.utils.sheet_to_txt(worksheet);
        document.getElementById('delimiter-selector').value = "\\t";
        document.getElementById('csv-raw-input').value = tsvOutput;
        updateLivePreview();
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Native CSV/Text reading route
      reader.onload = function(evt) { 
        document.getElementById('csv-raw-input').value = evt.target.result;
        updateLivePreview();
      };
      reader.readAsText(file);
    }
  }

  function processIngestedInput() {
    const rawText = document.getElementById('csv-raw-input').value.trim();
    if (!rawText) {
      alert("Please provide valid source data.");
      return;
    }

    const lines = rawText.split('\n').filter(row => row.trim() !== "");
    const delimiter = detectDelimiter(lines[0]);

    rawParsedMatrix = lines.map(row => 
      row.split(delimiter).map(cell => cell.replace(/^["']|["']$/g, '').trim())
    );

    let headers = rawParsedMatrix[0].map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
    
    // Header Auto-Detection logic matches
    let dateIdx = headers.findIndex(h => h.includes('date') || h.includes('fecha'));
    let invIdx  = headers.findIndex(h => h.includes('inv') || h.includes('factura') || h.includes('control') || h.includes('num') || h.includes('po'));
    let venIdx  = headers.findIndex(h => h.includes('vendor') || h.includes('prov') || h.includes('mprov'));
    let itmIdx  = headers.findIndex(h => h.includes('item') || h.includes('cod') || h.includes('art'));
    let dscIdx  = headers.findIndex(h => h.includes('desc') || h.includes('detal') || h.includes('nombr') || h.includes('text'));
    let qtyIdx  = headers.findIndex(h => h.includes('qty') || h.includes('cant') || h.includes('quant'));
    let cstIdx  = headers.findIndex(h => h.includes('cost') || h.includes('val') || h.includes('precio'));

    if (dscIdx === -1) dscIdx = 5; 

    // If auto-detection finds all fields natively, skip step 1B mapper screen
    if (dateIdx !== -1 && invIdx !== -1 && venIdx !== -1 && itmIdx !== -1 && qtyIdx !== -1 && cstIdx !== -1) {
      columnIndexes = { date: dateIdx, invoice: invIdx, vendor: venIdx, item: itmIdx, desc: dscIdx, qty: qtyIdx, cost: cstIdx };
      groupUniquePOs();
    } else {
      populateColumnMapperSelectors();
      switchPanel('mappers');
    }
  }

  function populateColumnMapperSelectors() {
    // FIXED: Added 'date' to the field loop array so it populates the UI drop-down element options
    const fields = ['date', 'invoice', 'vendor', 'item', 'desc', 'qty', 'cost'];
    const sampleHeaders = rawParsedMatrix[0];
    
    fields.forEach(f => {
      const select = document.getElementById('map-col-' + f);
      if (select) {
        select.innerHTML = sampleHeaders.map((h, idx) => `<option value="${idx}">Column ${idx + 1} (${h || 'Blank'})</option>`).join('');
      }
    });
    
    // FIXED: Pre-selects your explicit default indices right inside the dropdown elements
    if(document.getElementById('map-col-date'))    document.getElementById('map-col-date').value = "0";
    if(document.getElementById('map-col-invoice')) document.getElementById('map-col-invoice').value = "4";
    if(document.getElementById('map-col-desc'))    document.getElementById('map-col-desc').value = "5";
    if(document.getElementById('map-col-item'))    document.getElementById('map-col-item').value = "6";
    if(document.getElementById('map-col-vendor'))  document.getElementById('map-col-vendor').value = "8";
    if(document.getElementById('map-col-qty'))     document.getElementById('map-col-qty').value = "9";
    if(document.getElementById('map-col-cost'))    document.getElementById('map-col-cost').value = "11";
  }

function processMappedColumns() {
    // FIXED: Pulls the confirmed dropdown selection for the new Date field
    columnIndexes.date    = parseInt(document.getElementById('map-col-date').value);
    columnIndexes.invoice = parseInt(document.getElementById('map-col-invoice').value);
    columnIndexes.vendor  = parseInt(document.getElementById('map-col-vendor').value);
    columnIndexes.item    = parseInt(document.getElementById('map-col-item').value);
    columnIndexes.desc    = parseInt(document.getElementById('map-col-desc').value);
    columnIndexes.qty     = parseInt(document.getElementById('map-col-qty').value);
    columnIndexes.cost    = parseInt(document.getElementById('map-col-cost').value);
    
    groupUniquePOs();
  }

  function groupUniquePOs() {
  let missingMapSet = new Set();
  for (let i = 1; i < rawParsedMatrix.length; i++) {
    let invNum = rawParsedMatrix[i][columnIndexes.invoice];
    if (invNum) missingMapSet.add(invNum.toString().trim());
  }
  uniquePoListMissingCategories = Array.from(missingMapSet);

  if (uniquePoListMissingCategories.length > 0) {
    renderCategoryMappingRows();
    switchPanel('b');
  } else {
    validateCacheStep();
  }
}

  function renderCategoryMappingRows() {
    const container = document.getElementById('category-mapping-container');
    
    // Fetch currencies from your validation sheet global cache
    const currencyCache = (window.CachedDataVal && window.CachedDataVal.currencies) || [];
    
    // Generate the dynamic options string (Defaulting to USD if found, otherwise the first option)
    let currencyOptionsHtml = currencyCache.map(curr => {
      const isDefault = curr.name === 'USD' ? 'selected' : '';
      return `<option value="${curr.name}" ${isDefault}>${curr.name} (${curr.symbol})</option>`;
    }).join('');

    // Fallback if cache array is completely empty
    if (!currencyOptionsHtml) {
      currencyOptionsHtml = '<option value="USD" selected>USD</option><option value="CLP">CLP</option>';
    }

    // Build UI grid layout featuring headers and matching row pairs
    let tableHtml = `
      <div class="row mb-2 fw-bold border-bottom pb-1 text-secondary small">
        <div class="col-sm-4">Invoice / PO Reference</div>
        <div class="col-sm-4">Category Assignment</div>
        <div class="col-sm-4">Currency (Moneda)</div>
      </div>
    `;

    tableHtml += uniquePoListMissingCategories.map(po => `
      <div class="row mb-2 align-items-center po-mapping-row" data-po="${po}">
        <div class="col-sm-4 text-truncate fw-bold font-monospace small">${po}</div>
        <div class="col-sm-4">
          <select class="form-select form-select-sm po-category-dropdown">
            <option value="OPS">Operations</option>
            <option value="MAINT">Maintenance</option>
          </select>
        </div>
        <div class="col-sm-4">
          <select class="form-select form-select-sm po-currency-dropdown">
            ${currencyOptionsHtml}
          </select>
        </div>
      </div>
    `).join('');

    container.innerHTML = tableHtml;
  }

function validateCacheStep() {
  const inventoryArray = window.fullInventory || [];
  const inventoryLookupMap = {};
  
  // FIXING ISSUE 2: Clean white spaces from both sides of the sync stream item payload object values
  inventoryArray.forEach(function(item) {
    if (item && item.geo) {
      var cleanGeoKey = item.geo.toString().replace(/[\s\t\r\n]/g, '').toUpperCase();
      inventoryLookupMap[cleanGeoKey] = item;
    }
  });

  let validCount = 0;
  let badRowsList = [];

  for (let i = 1; i < rawParsedMatrix.length; i++) {
    let itemCode = rawParsedMatrix[i][columnIndexes.item];
    if (!itemCode) continue;
    
    var cleanItemCode = itemCode.toString().replace(/[\s\t\r\n]/g, '').toUpperCase();

    if (cleanItemCode === "SPECIAL" || inventoryLookupMap[cleanItemCode]) {
      validCount++;
    } else {
      badRowsList.push(`Row ${i+1}: Item Code [${itemCode}] not verified inside system database cache.`);
    }
  }

  // UI reporting conditions logic...
  const reportBox = document.getElementById('validation-report-summary');
  const flaggedBox = document.getElementById('flagged-items-box');
  if (badRowsList.length > 0) {
    if (reportBox) {
      reportBox.className = "alert alert-warning small";
      reportBox.innerHTML = `<strong>Validation Alert:</strong> Verified <b>${validCount}</b> rows cleanly. <b>${badRowsList.length}</b> mismatches dropped out.`;
    }
    document.getElementById('flagged-items-list').innerHTML = badRowsList.join('<br>');
    flaggedBox.style.display = "block";
  } else {
    if (reportBox) {
      reportBox.className = "alert alert-success small";
      reportBox.innerHTML = `<strong>Data Verification Passed:</strong> All <b>${validCount}</b> rows verified against master record.`;
    }
    flaggedBox.style.display = "none";
  }
  switchPanel('c');
}

function executeCompilationPipeline() {
    const btn = document.getElementById('btn-compile-execution');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Processing and Compiling File Link Target...";
    }

    // Collect both Category and Currency per Invoice row
    let selectedCategories = {};
    document.querySelectorAll('.po-mapping-row').forEach(row => {
      const poKey = row.getAttribute('data-po');
      const categoryVal = row.querySelector('.po-category-dropdown').value;
      const currencyVal = row.querySelector('.po-currency-dropdown').value;
      
      selectedCategories[poKey] = {
        category: categoryVal,
        currency: currencyVal
      };
    });

    const exportOptionMode = document.querySelector('input[name="exportOptionMode"]:checked').value;
    const userSelectedDateFormat = document.getElementById('user-date-format-selector').value;

    const inventoryArray = window.fullInventory || [];
    const cachedInventoryMap = {};
    
    inventoryArray.forEach(function(item) {
      if (item && item.geo) {
        var cleanGeoKey = item.geo.toString().replace(/[\s\t\r\n]/g, '').toUpperCase();
        cachedInventoryMap[cleanGeoKey] = true;
      }
    });

    google.script.run.withSuccessHandler(function(response) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Compile, Save, and Download File";
      }
      if (response.success) {
        if (macroWizardModalInstance) macroWizardModalInstance.hide();
        loadHistoryLogTable(); 
        window.open(response.downloadUrl, '_blank');
      } else {
        alert("Pipeline Processing Interrupted: " + response.msg);
      }
    }).processAndSaveBulkPO(rawParsedMatrix, selectedCategories, cachedInventoryMap, exportOptionMode, columnIndexes, userSelectedDateFormat);
  }

  function loadHistoryLogTable() {
    google.script.run.withSuccessHandler(function(logs) {
      const tbody = document.getElementById('history-log-tbody');
      if (!tbody) return;
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted p-3">No historical tracking runs logged yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td>${l.timestamp}</td>
          <td>${l.user}</td>
          <td><span class="badge bg-secondary">${l.poCount} POs</span></td>
          <td><span class="text-uppercase small font-monospace">${l.type}</span></td>
          <td><button class="btn btn-sm btn-outline-success" onclick="triggerDirectDownload('${l.driveId}')">💾 Download</button></td>
        </tr>
      `).join('');
    }).getMacroHistoryLogs();
  }

  function triggerDirectDownload(fileId) {
    google.script.run.withSuccessHandler(function(url) { if (url) window.open(url, '_blank'); }).getDownloadUrlById(fileId);
  }
