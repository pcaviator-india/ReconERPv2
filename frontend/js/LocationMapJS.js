// --- GLOBAL VARIABLES ---
let sectors = [];
let rackConfigs = [];
let selectedItems = new Set(); 

// --- EXPLICIT MODULE INITIALIZATION ---
window.initRackLocationModule = function() {
    console.log("Initializing Rack & Location Module...");
    
    // Core Programmatic Execution: Force cleanup tab panel configurations securely on module loading
    const configTabBtn = document.getElementById('config-tab');
    if (configTabBtn) {
        const firstTabInstance = new bootstrap.Tab(configTabBtn);
        firstTabInstance.show();
    }

    // Bind Bootstrap dynamic tab shift hooks safely to initialize data refresh routines
    const assignTabEl = document.getElementById('assign-tab');
    if (assignTabEl && !assignTabEl.dataset.hookAttached) {
        assignTabEl.addEventListener('shown.bs.tab', function () {
            onLocationChange();
        });
        assignTabEl.dataset.hookAttached = "true";
    }

    // Load Sectors via Google Apps Script Context API
    google.script.run
        .withSuccessHandler(function(data) {
            sectors = Array.isArray(data) ? data : [];
            populateSectorDropdown('configLocationSelect');
            populateSectorDropdown('assignLocationSelect');
            
            if(sectors.length > 0) {
                const assignDropdown = document.getElementById('assignLocationSelect');
                if(assignDropdown) {
                    assignDropdown.value = sectors[0];
                    onLocationChange();
                }
            }
            // Apply site lock for USER role
            if (window.currentUser && window.currentUser.site) {
              window.applySiteLock('assignLocationSelect', window.currentUser.site);
              window.applySiteLock('configLocationSelect', window.currentUser.site);
            }
        })
        .withFailureHandler(function(err) { console.error('Failed to retrieve sectors:', err); })
        .getSectors();

    // Sync Active Rack Layout Structures Configuration Mapping Table Matrix Cache
    google.script.run
        .withSuccessHandler(function(data) { 
            rackConfigs = Array.isArray(data) ? data : []; 
            updateTargetLocationsDropdowns();
        })
        .getRackConfig();

    // Attach form execution confirmation intercept listeners securely
    const configForm = document.getElementById('rackConfigForm');
    if (configForm && !configForm.dataset.listenerAttached) {
        configForm.addEventListener('submit', handleRackSubmit);
        configForm.dataset.listenerAttached = "true";
    }
};

// --- CONTROLLER DOCK ELEMENT PIPELINES ---

function onLocationChange() {
    selectedItems.clear();
    updateTargetLocationsDropdowns();
    loadUnassignedItems();
    loadShelfInventory();
}

function updateTargetLocationsDropdowns() {
    const selectedLocation = document.getElementById('assignLocationSelect').value;
    const rackSelect = document.getElementById('assignRackSelect');
    if (!rackSelect) return;
    
    while (rackSelect.options.length > 1) { rackSelect.remove(1); }
    resetSidesAndShelves();

    if (!selectedLocation) return;
    const filteredRacks = rackConfigs.filter(r => String(r.locationId).trim() === String(selectedLocation).trim());

    filteredRacks.forEach(rack => {
        const opt = document.createElement('option');
        opt.value = rack.rackId;
        opt.textContent = rack.rackId;
        rackSelect.appendChild(opt);
    });
}

function updateSidesAndShelvesDropdowns() {
    const selectedLocation = document.getElementById('assignLocationSelect').value;
    const selectedRackId = document.getElementById('assignRackSelect').value;
    
    const sideSelect = document.getElementById('assignSideSelect');
    const shelfSelect = document.getElementById('assignShelfSelect');
    if (!sideSelect || !shelfSelect) return;

    while (sideSelect.options.length > 1) { sideSelect.remove(1); }
    while (shelfSelect.options.length > 1) { shelfSelect.remove(1); }

    if (!selectedLocation || !selectedRackId) {
        loadShelfInventory();
        return;
    }

    const activeConfig = rackConfigs.find(r => 
        String(r.locationId).trim() === String(selectedLocation).trim() && 
        String(r.rackId).trim() === String(selectedRackId).trim()
    );
    
    if (!activeConfig) return;
    const sideVal = activeConfig.hasSides;
    const hasSidesNormalized = (sideVal === true || String(sideVal).toUpperCase() === 'TRUE' || String(sideVal).toLowerCase() === 'yes');

    if (hasSidesNormalized) {
        sideSelect.add(new Option("1", "1"));
        sideSelect.add(new Option("2", "2"));
    } else {
        sideSelect.add(new Option("1", "1"));
    }

    const numShelves = parseInt(activeConfig.noOfShelves) || 1;
    for (let i = 0; i < numShelves; i++) {
        const letterRow = String.fromCharCode(65 + i); 
        shelfSelect.add(new Option(letterRow, letterRow));
    }
    loadShelfInventory();
}

function resetSidesAndShelves() {
    const sideSelect = document.getElementById('assignSideSelect');
    const shelfSelect = document.getElementById('assignShelfSelect');
    if (sideSelect) while (sideSelect.options.length > 1) { sideSelect.remove(1); }
    if (shelfSelect) while (shelfSelect.options.length > 1) { shelfSelect.remove(1); }
}

function clearTargetDropdownSelections() {
    document.getElementById('assignRackSelect').selectedIndex = 0;
    resetSidesAndShelves();
    loadShelfInventory();
}

function populateSectorDropdown(elementId) {
    const select = document.getElementById(elementId);
    if (!select || sectors.length === 0) return;
    while (select.options.length > 1) { select.remove(1); }
    sectors.forEach(sec => {
        const opt = document.createElement('option');
        opt.value = sec; opt.textContent = sec;
        select.appendChild(opt);
    });
}

// --- DYNAMIC DATA RENDERING: SPLIT VIEW LAYOUT ENGINES ---

function loadUnassignedItems() {
    const locationId = document.getElementById("assignLocationSelect").value;
    if (!locationId) {
        renderUnassignedItems([]);
        toggleSearchSection(false);
        return;
    }
    toggleSearchSection(true);
    const searchQuery = (document.getElementById("itemSearchInput").value || "").toLowerCase().trim();

    // Query backend to pull only items belonging to Sector that lack coordinates
    google.script.run
        .withSuccessHandler(function(items) {
            // Filter list array client side to verify shelf parameters are empty or unassigned
            const unassignedItems = items.filter(item => !item.rackID || item.rackID === "" || item.rackID === "General");
            renderUnassignedItems(unassignedItems);
            document.getElementById('unassignedCountBadge').innerText = unassignedItems.length + ' ' + i18n("storage_items");
        })
        .searchItemsByLocation(locationId, searchQuery);
}

function loadShelfInventory() {
    const container = document.getElementById("shelfInventoryContainer");
    const loc = document.getElementById("assignLocationSelect").value;
    const rack = document.getElementById("assignRackSelect").value;
    const side = document.getElementById("assignSideSelect").value;
    const lvl = document.getElementById("assignShelfSelect").value;

    if (!loc || !rack || !side || !lvl) {
        container.innerHTML = `
            <div class="text-center p-5 text-muted">
                <i class="bi bi-info-circle fs-2"></i>
                <p class="mt-2">${i18n("storage_select_rack_side_level")}</p>
            </div>`;
        document.getElementById('shelfCountBadge').innerText = `0 ${i18n("storage_items")}`;
        return;
    }

    container.innerHTML = `<div class="text-center p-5 text-secondary"><div class="spinner-border spinner-border-sm me-2"></div>${i18n("storage_reading_shelf_contents")}</div>`;

    // Query server backend for row matching exact location coordinates matrix mapping criteria
    google.script.run
        .withSuccessHandler(function(items) {
            if (!items) items = [];
            
            const shelfContent = items.filter(item => {
                // Safely extract and normalize properties to prevent crashes on null/undefined rows
                const itemRack = item.rackID ? String(item.rackID).trim().toUpperCase() : "";
                const itemSide = item.sideCode ? String(item.sideCode).trim() : "";
                const itemLvl  = item.shelfLevel ? String(item.shelfLevel).trim().toUpperCase() : "";

                return itemRack === String(rack).trim().toUpperCase() &&
                       itemSide === String(side).trim() &&
                       itemLvl  === String(lvl).trim().toUpperCase();
            });
            
            renderShelfInventory(shelfContent);
            document.getElementById('shelfCountBadge').innerText = shelfContent.length + ' ' + i18n("storage_items");
        })
        .withFailureHandler(function(err) {
            console.error("Error loading shelf inventory:", err);
            container.innerHTML = `<div class="text-center p-5 text-danger"><i class="bi bi-exclamation-triangle fs-2"></i><p class="mt-2">${i18n("storage_error_loading_shelf_data")}</p></div>`;
        })
        .searchItemsByLocation(loc, "");
}

function renderUnassignedItems(items) {
    const container = document.getElementById("unassignedItemsContainer");
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = `<div class="text-center p-5 text-muted"><i class="bi bi-emoji-smile fs-2"></i><p class="mt-2">${i18n("storage_all_coordinates_assigned")}</p></div>`;
        return;
    }
    let html = `<div class="list-group list-group-flush">`;
    items.forEach(item => {
        const isChecked = selectedItems.has(item.itemID);
        html += `
            <label class="list-group-item d-flex align-items-center p-3 justify-content-between cursor-pointer border-bottom">
                <div class="d-flex align-items-center">
                    <input class="form-check-input me-3 mt-0 flex-shrink-0" type="checkbox" value="${item.itemID}" ${isChecked ? 'checked' : ''} onchange="toggleItemCheck('${item.itemID}')">
                    <div>
                        <span class="fw-bold text-dark d-block">${item.itemID}</span>
                        <small class="text-muted text-wrap d-block" style="max-width:340px;">${item.productName || i18n("storage_no_description")}</small>
                    </div>
                </div>
                <span class="badge bg-secondary-subtle text-secondary rounded-pill border">${i18n("storage_stocked")}</span>
            </label>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

function renderShelfInventory(items) {
    const container = document.getElementById("shelfInventoryContainer");
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = `<div class="text-center p-5 text-muted"><i class="bi bi-folder-minus fs-2"></i><p class="mt-2">${i18n("storage_empty_shelf_slot")}</p></div>`;
        return;
    }
    let html = `<div class="list-group list-group-flush">`;
    items.forEach(item => {
        const safeName = encodeURIComponent(item.productName || i18n("storage_no_name"));
        html += `
            <div class="list-group-item d-flex justify-content-between align-items-center p-3 border-bottom bg-light-subtle">
                <div style="max-width:75%;">
                    <span class="fw-bold text-success d-block"><i class="bi bi-box me-1"></i> ${item.itemID}</span>
                    <small class="text-muted d-block text-truncate" style="max-width:300px;">${item.productName || i18n("storage_no_name")}</small>
                </div>
                <button onclick="vacateItemFromShelf('${item.itemID}', '${safeName}')" class="btn btn-sm btn-outline-danger btn-sm border-0" title="${i18n("storage_remove_from_shelf_title")}"><i class="bi bi-trash3-fill"></i> ${i18n("storage_remove")}</button>
            </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

function toggleItemCheck(itemId) {
    if (selectedItems.has(itemId)) { selectedItems.delete(itemId); } 
    else { selectedItems.add(itemId); }
}

function clearSelection() {
    selectedItems.clear();
    loadUnassignedItems();
}

function toggleSearchSection(enable) {
    const section = document.getElementById('searchSection');
    if (!section) return;
    section.style.opacity = enable ? '1' : '0.5';
    section.style.pointerEvents = enable ? 'auto' : 'none';
}

// --- CORE ACTION CONTEXT PIPELINES: SAVE & VACATE TRANSACTIONS ---

function saveAssignments() {
    if (selectedItems.size === 0) {
        alert(i18n('storage_select_items_alert'));
        return;
    }
    const loc = document.getElementById("assignLocationSelect").value;
    const rack = document.getElementById("assignRackSelect").value;
    const side = document.getElementById("assignSideSelect").value;
    const lvl = document.getElementById("assignShelfSelect").value;

    if (!loc || !rack || !side || !lvl) {
        alert(i18n('storage_select_full_target_coordinates_alert'));
        return;
    }

    let assignments = [];
    selectedItems.forEach(itemID => {
        assignments.push({ itemID: itemID, locationId: loc, rackID: rack, sideCode: side, shelfLevel: lvl });
    });

    google.script.run
        .withSuccessHandler(function() {
            selectedItems.clear();
            loadUnassignedItems();
            loadShelfInventory();
        })
        .withFailureHandler(function(err) {       alert(i18n("storage_failed_shelf_write")); })
        .saveBulkAssignments(assignments);
}

function vacateItemFromShelf(itemId, encodedName) {
    const loc = document.getElementById("assignLocationSelect").value;
    if (!loc) return;
    
    // Structure an assignment payload where rack parameters are reset to clear shelf attributes
    let clearPayload = [{ itemID: itemId, locationId: loc, rackID: "", sideCode: "", shelfLevel: "" }];

    google.script.run
        .withSuccessHandler(function() {
            loadUnassignedItems();
            loadShelfInventory();
        })
        .withFailureHandler(function(err) { console.error("Error vacating placement item row:", err); })
        .saveBulkAssignments(clearPayload);
}

function handleRackSubmit(e) {
    e.preventDefault();
    const locSelect = document.getElementById('configLocationSelect');
    const rackInput = document.getElementById('configRackId');
    const sidesSelect = document.getElementById('configHasSides');
    const shelvesInput = document.getElementById('configShelves');

    if (!locSelect || !rackInput || !sidesSelect || !shelvesInput) return;
    const config = {
        locationId: locSelect.value,
        rackId: rackInput.value,
        hasSides: sidesSelect.value === 'Yes' ? 'Yes' : 'No',
        noOfShelves: parseInt(shelvesInput.value)
    };

    google.script.run
        .withSuccessHandler(function() {
            alert(i18n("msg_saved"));
            document.getElementById('rackConfigForm').reset();
            google.script.run
                .withSuccessHandler(function(data) { 
                    rackConfigs = Array.isArray(data) ? data : []; 
                    updateTargetLocationsDropdowns();
                })
                .getRackConfig();
        })
        .saveNewRack(config);
}

// Attach Search Filter Routine Change Event Keyups safely
let searchTimeout;
const searchInputEl = document.getElementById("itemSearchInput");
if (searchInputEl) {
    searchInputEl.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadUnassignedItems, 350);
    });
}
