let currentValType = '';
let currentValData = [];
let _valFilterDebounce = null;

// Configuration for each module
const valConfig = {
  'Sites': { title: 'Faenas / Sites', cols: ['Name', 'Suffix'], keys: ['name', 'suffix'] },
  'Categories': { title: 'Categories', cols: ['Name', 'Email'], keys: ['name', 'email'] }, 
  'SubCats': { title: 'Sub Categories', cols: ['Parent', 'Name'], keys: ['parent', 'name'] },
  'Brands': { title: 'Brands', cols: ['Name'], keys: ['name'] }, 
  'Suppliers': { title: 'Suppliers', cols: ['Name', 'Email'], keys: ['name', 'email'] },
  'Users': { 
    title: 'User Management', 
    cols: ['ID', 'PIN', 'Name', 'Email', 'Position', 'Site', 'Role', 'Active'], 
    keys: ['userId', 'pin', 'name', 'email', 'position', 'site', 'role', 'active'] 
  },
  'SystemConfig': { 
      title: 'System Feature Toggles', 
      cols: ['Feature Name', 'Enabled (TRUE/FALSE)'], 
      keys: ['feature', 'status'] 
  }
};

window.initValidationModule = function(type) {
  currentValType = type || 'Sites'; 
  console.log("Starting Module for:", currentValType);
  
  const config = valConfig[currentValType];
  if (!config) {
    console.error("Configuration missing for type: " + currentValType);
    return;
  }

  const addBtn = document.querySelector('button[onclick="openValModal()"]');
  if (addBtn) {
    addBtn.style.display = (currentValType === 'SystemConfig') ? 'none' : 'block';
  }

  document.getElementById('valTitle').innerText = config.title;
  document.getElementById('valSubtitle').innerText = "Manage " + config.title + " settings";
  
  let headHtml = '<tr>';
  config.cols.forEach(col => headHtml += `<th>${col}</th>`);
  headHtml += '<th class="text-end">Actions</th></tr>';
  document.getElementById('valTableHead').innerHTML = headHtml;

  // Reset and configure filter bar visibility
  _resetValFilters();
  const isSystemConfig = (currentValType === 'SystemConfig');
  const filterBar = document.getElementById('valFilterBar');
  if (filterBar) filterBar.style.display = isSystemConfig ? 'none' : 'flex';

  const siteWrap = document.getElementById('valFilterSiteWrap');
  const activeWrap = document.getElementById('valFilterActiveWrap');
  if (siteWrap) siteWrap.style.display = (currentValType === 'Users') ? 'block' : 'none';
  if (activeWrap) activeWrap.style.display = (currentValType === 'Users') ? 'block' : 'none';

  forceConfigRefresh();
};

function refreshValTable() {
  const tbody = document.getElementById('valTableBody');
  tbody.innerHTML = `<tr><td colspan="10" class="text-center">${i18n('msg_loading_data')}</td></tr>`;

  google.script.run
    .withSuccessHandler(function(allData) {
      const configArray = [
        { feature: 'reqEmailEnabled', status: allData.reqEmailEnabled ? "TRUE" : "FALSE" },
        { feature: 'reqPdfEnabled', status: allData.reqPdfEnabled ? "TRUE" : "FALSE" },
        { feature: 'quoEmailEnabled', status: allData.quoEmailEnabled ? "TRUE" : "FALSE" },
        { feature: 'quoPdfEnabled', status: allData.quoPdfEnabled ? "TRUE" : "FALSE" },
        // Per-status flags for the "Quote Updated" notification.
        { feature: 'quoteEmailPending', status: allData.quoteEmailPending ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailQuoted', status: allData.quoteEmailQuoted ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailApproved', status: allData.quoteEmailApproved ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailSent', status: allData.quoteEmailSent ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailReceived', status: allData.quoteEmailReceived ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailDespatched', status: allData.quoteEmailDespatched ? "TRUE" : "FALSE" },
        { feature: 'quoteEmailFinalReceived', status: allData.quoteEmailFinalReceived ? "TRUE" : "FALSE" }
      ];

      window.globalConfig = configArray;

      const dataMap = {
        'Sites': allData.sites,
        'Categories': allData.categories,
        'SubCats': allData.subCats,
        'Brands': allData.brands,
        'Suppliers': allData.suppliers,
        'Users': allData.users,
        'SystemConfig': configArray
      };
      
      currentValData = dataMap[currentValType] || [];
      
      // Populate site dropdown for Users filter
      _populateValFilterSites(allData.sites || []);
      
      renderValRows();
      
      window.cachedCategories = allData.categories || [];
      window.cachedSites = allData.sites || [];
      window.cachedPeople = allData.people || []; // <-- Centralized Roster mapping cache added here
    })
    .withFailureHandler(function(err) {
      console.error("GAS Server Error:", err);
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">${i18n('msg_error')}: ${err.message}</td></tr>`;
    })
    .getAdminData();
}

function renderValRows(data) {
  const config = valConfig[currentValType];
  const tbody = document.getElementById('valTableBody');
  const rows = data || currentValData;

  // Update filter count badge
  const countEl = document.getElementById('valFilterCount');
  if (countEl) {
    if (rows.length !== currentValData.length) {
      countEl.innerText = `Showing ${rows.length} of ${currentValData.length}`;
    } else {
      countEl.innerText = currentValData.length ? `${currentValData.length} items` : '';
    }
  }

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${config.cols.length + 1}" class="text-center text-muted py-3">${i18n('msg_no_items')}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item, idx) => {
    // Find the real index in currentValData for edit actions
    const realIdx = currentValData.indexOf(item);
    let row = '<tr>';
    config.keys.forEach(key => {
      let val = (item && typeof item === 'object') ? (item[key] || "") : item;
      row += `<td>${val}</td>`;
    });
    row += `
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary shadow-sm" onclick="openValModal(${realIdx})">
          <i class="bi bi-pencil"></i>
        </button>
      </td></tr>`;
    return row;
  }).join('');
}

// ─── Filter Helpers ───────────────────────────────────────────────────────────

function _resetValFilters() {
  const searchInput = document.getElementById('valSearchInput');
  const siteSelect  = document.getElementById('valFilterSite');
  const activeSelect = document.getElementById('valFilterActive');
  if (searchInput)  searchInput.value  = '';
  if (siteSelect)   siteSelect.value   = '';
  if (activeSelect) activeSelect.value = '';
  const countEl = document.getElementById('valFilterCount');
  if (countEl) countEl.innerText = '';
}

function _populateValFilterSites(sites) {
  const sel = document.getElementById('valFilterSite');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- All Sites --</option>' +
    sites.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  sel.value = current; // preserve selection across refreshes
}

function applyValFilters() {
  const config = valConfig[currentValType];
  if (!config) return;

  const searchText   = (document.getElementById('valSearchInput')?.value  || '').toLowerCase().trim();
  const siteFilter   = (document.getElementById('valFilterSite')?.value   || '').toLowerCase().trim();
  const activeFilter = (document.getElementById('valFilterActive')?.value || '').trim();

  let filtered = currentValData;

  // 1. Text search — all space-separated terms must match somewhere in the row's visible keys
  if (searchText) {
    const terms = searchText.split(/\s+/).filter(t => t.length > 0);
    filtered = filtered.filter(item => {
      const searchable = config.keys
        .map(k => (item && typeof item === 'object') ? String(item[k] || '') : String(item || ''))
        .join(' ')
        .toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }

  // 2. Site dropdown (Users only)
  if (currentValType === 'Users' && siteFilter) {
    filtered = filtered.filter(item =>
      String(item.site || '').toLowerCase() === siteFilter
    );
  }

  // 3. Active-status dropdown (Users only)
  if (currentValType === 'Users' && activeFilter !== '') {
    filtered = filtered.filter(item =>
      String(item.active || '0') === activeFilter
    );
  }

  renderValRows(filtered);
}

// Attach event listeners once the DOM is ready
(function bindValFilterEvents() {
  function _bind() {
    const searchInput  = document.getElementById('valSearchInput');
    const siteSelect   = document.getElementById('valFilterSite');
    const activeSelect = document.getElementById('valFilterActive');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_valFilterDebounce);
        _valFilterDebounce = setTimeout(applyValFilters, 250);
      });
    }
    if (siteSelect)   siteSelect.addEventListener('change',   applyValFilters);
    if (activeSelect) activeSelect.addEventListener('change', applyValFilters);
  }

  // Google Apps Script HtmlService loads the body after script tags run,
  // so bind on DOMContentLoaded as well as immediately in case DOM is already ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bind);
  } else {
    _bind();
  }
})();
// Global programmatic event listener for Employee select mapping matrix
window.handleUserEmployeeChange = function(payloadString) {
  if (!payloadString) {
    document.getElementById('val_input_name').value = '';
    document.getElementById('val_input_email').value = '';
    document.getElementById('val_input_position').value = '';
    return;
  }
  
  const tokens = payloadString.split('|');
  document.getElementById('val_input_name').value = tokens[0] || '';
  document.getElementById('val_input_email').value = tokens[1] || '';
  document.getElementById('val_input_position').value = tokens[2] || '';
};

window.openValModal = function(index = -1) {
  const config = valConfig[currentValType];
  const item = (index > -1) ? currentValData[index] : {};
  document.getElementById('valModalTitle').innerText = (index === -1 ? 'Add ' : 'Edit ') + currentValType;
  
  let formHtml = `<input type="hidden" id="editIdx" value="${index}">`;

  // Inject Employee Dropdown selection context if we are in User Creation (Add Mode)
 // Inject Employee Dropdown selection context if we are in User Creation (Add Mode)
if (currentValType === 'Users' && index === -1) {
  const activeUserEmails = currentValData.map(u => String(u.email).toLowerCase().trim());
  const eligibleRoster = (window.cachedPeople || []).filter(p => p.name && !activeUserEmails.includes(String(p.email).toLowerCase().trim()));

  eligibleRoster.sort((a, b) => a.name.localeCompare(b.name));
  
  formHtml += `
    <div class="mb-3 bg-light p-3 border rounded">
      <label class="form-label fw-bold text-primary">Link Account to Roster Profile</label>
      <select id="user_employee_select" class="form-select border-primary" onchange="handleUserEmployeeChange(this.value)">
        <option value="">-- Choose Employee --</option>
          ${eligibleRoster.map(p => `
            <option value="${p.name}|${p.email}|${p.department}">
              ${p.name} ${p.rut ? `[${p.rut}]` : ''}
            </option>
          `).join('')}
      </select>
    </div>`;
}

  config.keys.forEach((key, i) => {
    const label = config.cols[i];
    let val = (item && typeof item === 'object') ? (item[key] || '') : (item || '');

    // Set placeholder token for IDs during instantiation phase
    if (currentValType === 'Users' && key === 'userId' && index === -1) {
      val = "Auto-generated";
    }

    // 1. DROPDOWN: Parent Category for Sub-Categories
    if (currentValType === 'SubCats' && key === 'parent') {
      formHtml += `<div class="mb-3">
        <label class="form-label fw-bold">${label}</label>
        <select id="val_input_${key}" class="form-select">
          <option value="">-- Select Parent --</option>
          ${(window.cachedCategories || []).map(c => `<option value="${c.name}" ${c.name === val ? 'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>`;
    } 
    // 2. DROPDOWN: Strict System Authorized Capital Roles Matrix (FIXED CASE)
    else if (currentValType === 'Users' && key === 'role') {
      const roles = ['ADMIN', 'MANAGER', 'OFFICE', 'USER'];
      formHtml += `<div class="mb-3">
        <label class="form-label fw-bold">${label}</label>
        <select id="val_input_${key}" class="form-select">
          ${roles.map(r => `<option value="${r}" ${String(val).toUpperCase() === r ? 'selected':''}>${r}</option>`).join('')}
        </select>
      </div>`;
    }
    // 3. DROPDOWN: Site Selection for Users
    else if (currentValType === 'Users' && key === 'site') {
      formHtml += `<div class="mb-3">
        <label class="form-label fw-bold">${label}</label>
        <select id="val_input_${key}" class="form-select">
          <option value="">-- Select Site --</option>
          ${(window.cachedSites || []).map(s => `<option value="${s.name}" ${s.name === val ? 'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>`;
    }
    // 4. TOGGLE: Active Status for Users
    else if (currentValType === 'Users' && key === 'active') {
      formHtml += `<div class="mb-3">
        <label class="form-label fw-bold">${label}</label>
        <select id="val_input_${key}" class="form-select">
          <option value="1" ${val == "1" ? 'selected':''}>Active</option>
          <option value="0" ${val == "0" ? 'selected':''}>Inactive</option>
        </select>
      </div>`;
    }
    else if (currentValType === 'SystemConfig' && key === 'status') {
      formHtml += `<div class="mb-3">
        <label class="form-label fw-bold">${label}</label>
        <select id="val_input_${key}" class="form-select">
          <option value="TRUE" ${val == "TRUE" ? 'selected':''}>TRUE (Enabled)</option>
          <option value="FALSE" ${val == "FALSE" ? 'selected':''}>FALSE (Disabled)</option>
        </select>
      </div>`;
    }
    // 5. DEFAULT & LOCKED MASTERS HANDLING
    else {
      // Guard Lockout: Prevent typing override on fields mapped from Roster Data
      const coreUserKeys = ['userId', 'name', 'email', 'position'];
      const isReadOnly = (currentValType === 'Users' && coreUserKeys.includes(key)) ? 'readonly bg-light text-muted' : '';
      
      formHtml += `
        <div class="mb-3">
          <label class="form-label fw-bold">${label}</label>
          <input type="text" id="val_input_${key}" class="form-control" value="${val}" ${isReadOnly}>
        </div>`;
    }
  });

  document.getElementById('valModalBody').innerHTML = formHtml;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('valModal')).show();
};

window.saveValItem = function() {
  const config = valConfig[currentValType];
  const idx = document.getElementById('editIdx').value;
  const btn = document.querySelector('#valModal .btn-primary');
  
  let oldIdentifier = null;
  if (idx !== "-1" && currentValData[idx]) {
    const item = currentValData[idx];
    if (currentValType === 'SystemConfig') {
      oldIdentifier = item.feature; 
    } else {
      oldIdentifier = (currentValType === 'Users') ? item.userId : (item.name || item);
    }
  }

  const newData = {};
  config.keys.forEach(key => {
    const input = document.getElementById('val_input_' + key);
    if (input) newData[key] = input.value.trim();
  });

  if (currentValType === 'SystemConfig') {
    const isTruthy = newData.status === "1" || String(newData.status).toUpperCase() === "TRUE";
    newData.status = isTruthy ? 1 : 0; 
  }

  btn.innerText = i18n('loading');
  btn.disabled = true;

  google.script.run
    .withSuccessHandler(function(res) {
      btn.innerText = i18n('btn_save');
      btn.disabled = false;
      if (res.success) {
        bootstrap.Modal.getInstance(document.getElementById('valModal')).hide();
        window.initValidationModule(currentValType); 
      } else {
        alert(i18n('msg_error') + ": " + res.message);
      }
    })
    .updateValidationItem(currentValType, oldIdentifier, newData); 
};

window.forceConfigRefresh = function() {
  const btn = document.getElementById('btnRefreshCache');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Syncing...';

  google.script.run
    .withSuccessHandler(function(allData) {
      window.globalConfig = window.globalConfig || {};
      window.globalConfig.systemConfig = allData.systemConfig;
      refreshValTable();
    //  alert("System Cache Updated from Spreadsheet!");
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Sync Cache';
    })
    .getAdminData();
};
