console.log("Global inventory size: " + (window.fullInventory || []).length);
let currentPage = 1;
const rowsPerPage = 50;
var retryCount = 0;

window.initProductsModule = function() {

  // Use static string - i18n is not available due to missing i18n.html (404 error)
  window.showStatus("Loading inventory...");

  // UI setup happens immediately
  attemptDropdownPopulation();
  //window.applyCategoryLock('filterCategory');

  // If we have data already, just show it. 
  // If not, and we aren't already syncing, start the Turbo Sync.
  if (window.fullInventory.length > 0) {
    window.renderProducts();
    // Notify main app that inventory sync didnt work
          if (typeof window.hideStatus === "function") {
            window.hideStatus();
            console.log("✅ Inventory Sync not done - Status bar hidden");
          }
  } else if (!window.isSyncing) {
    console.log("🚀 Initializing Global Turbo Sync...");
    window.isSyncing = true;
    
    // Lane 1: Rows 2 to 10,000
    startLanedSync(2, 5000, 10000);      
    // Lane 2: Rows 10002 to 20,000
    startLanedSync(10002, 5000, 20000);  
    // Lane 3: Rows 20002 to End
    startLanedSync(20002, 5000, 99999); 
  }
};

function startLanedSync(startRow, chunkSize, stopAtRow) {
  // Reset isSyncing flag globally if this is the start
  window.isSyncing = true;
  window.bundlesLoaded = false;
  google.script.run
    .withSuccessHandler(function(response) {
      //if (!response || !response.data) return;
      // SCOPE FIX: Define it as a local constant here
      //const lines = response.data.split("\n");
      const lines = response.data ? response.data.split("\n") : [];
      const currentChunk = lines.filter(function(l) { return l.trim() !== ""; }).map(function(line, index) {
        try {
          var row = JSON.parse(line);
          return {
            type: "item",
            id: String(row[0] || ""),
            geo: String(row[0] || ""),
            pn: String(row[1] || ""),
            category: String(row[2] || ""),
            sub_categoria: String(row[3] || ""),
            marca: String(row[4] || ""),
            en: String(row[5] || ""),
            es: String(row[6] || ""),
            un: String(row[7] || ""),
            stock: Number(row[10]) || 0,
            costo_clp: Number(row[12]) || 0,
            proveedor: String(row[13] || "")
          };
        } catch(e) { 
          return null; 
        }
      }).filter(function(i) { return i !== null && i.geo !== ""; });

      // Add to global window object explicitly
      window.fullInventory = (window.fullInventory || []).concat(currentChunk);
      
      // Only render on the last chunk of each lane (when nextRow === -1)
      if (typeof window.renderProducts === 'function' && response.nextRow === -1) {
        window.renderProducts();
      }

      console.log(
        "SYNC CHECK:",
        "nextRow=", response.nextRow,
        "stopAtRow=", stopAtRow
      );
      if (response.nextRow !== -1 && response.nextRow <= stopAtRow) {
        setTimeout(function() {
          startLanedSync(response.nextRow, chunkSize, stopAtRow);
        }, 10);
        updateSyncStatus(window.fullInventory.length, response.total);
      } else {
        updateSyncStatus(window.fullInventory.length, response.total, true);

        google.script.run
          .withSuccessHandler(function(bundles) {
                        
            if (!window.bundlesLoaded){
              window.bundlesLoaded = true;

              bundles.forEach(function(bundle) {

                  window.fullInventory.push({
                    type: "bundle",
                    id:bundle.bundleId,
                    isBundle: true,
                    bundleId: bundle.bundleId,

                    geo: bundle.bundleId,
                    pn: "",

                    es: bundle.es,
                    en: bundle.en || bundle.es,

                    category: "Bundle",
                    sub_categoria: "",

                    stock: 0,
                    costo_clp: 0,
                    proveedor: "Bundle"
                  });

              });
            }
          
          window.isSyncing = false;

          console.log("Bundles added:", bundles.length);

          // Notify main app that inventory sync is complete
          if (typeof window.hideStatus === "function") {
            window.hideStatus();
            console.log("✅ Inventory Sync Completed - Status bar hidden");
          }
          })
          .getBundlesForSearch();
      
      }
    })
    .withFailureHandler(function(err) {
      handleSyncFailure(startRow, chunkSize, stopAtRow, err);
      
    })
    .getInventoryChunk(startRow, chunkSize);
}

function handleSyncFailure(startRow, chunkSize, stopAtRow, error) {
  if (retryCount < 5) {
    retryCount++;
    console.warn("Retry " + retryCount + " for row " + startRow);
    setTimeout(function() { 
      startLanedSync(startRow, chunkSize, stopAtRow); 
    }, 2000);
  } else {
    isSyncing = false;
    const label = document.getElementById('paginationInfo');
    if (label) label.innerText = i18n('inv_sync_stalled');
  }
}

function updateSyncStatus(current, total, finished) {
  const info = document.getElementById('paginationInfo');
  if (info) {
    info.innerText = finished ? `Total: ${total}` : `Loading: ${current} / ${total}...`;
  }
}


 

  window.renderProducts = function() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  // 1. Grab values from the dropdowns your existing code already populated
  const search = document.getElementById('prodSearch')?.value.toLowerCase() || "";
  const catF   = document.getElementById('filterCategory')?.value || "";
  const subF   = document.getElementById('filterSubCategory')?.value || "";
  const brandF = document.getElementById('filterBrand')?.value || "";
  const suppF  = document.getElementById('filterSupplier')?.value || "";

  // 2. Filter the Turbo Sync inventory
  const searchTerms = search ? search.split(/\s+/).filter(term => term.length > 0) : [];
  let filtered = (window.fullInventory || []).filter(i => {
    // Search logic (Geo, PN, EN, ES, Brand) — ALL search terms must be present somewhere
    const combinedSearch = (
      String(i.geo) + 
      String(i.pn || '') + 
      String(i.en || '') + 
      String(i.es || '') + 
      String(i.marca || '')
    ).toLowerCase();

    const matchS = !search || searchTerms.every(term => combinedSearch.includes(term));
    const matchC = !catF || (i.category || "").toUpperCase() === catF.toUpperCase();
    const matchSub = !subF || i.sub_categoria === subF;
    const matchB = !brandF || i.marca === brandF;
    const matchSupp = !suppF || i.proveedor === suppF;

    return matchS && matchC && matchSub && matchB && matchSupp;
  });

  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  tbody.innerHTML = paginated.map(item => `
    <tr>
      <td class="fw-bold text-primary">${item.geo}</td>
      
      <td>${item.pn || ''}</td>
      
      <td><small>${item.category || ''}</small></td>
      
      <td><small>${item.sub_categoria || ''}</small></td>
      
      <td>${item.marca || ''}</td>
      
      <td>
        <div class="small fw-bold text-dark">${item.en || ''}</div>
        <div class="small text-muted italic">${item.es || ''}</div>
      </td>
      
      <td class="text-center">${item.un || ''}</td>
      
      <td class="text-center fw-bold ${item.stock <= 0 ? 'text-danger' : 'text-success'}">
        ${item.stock || 0}
      </td>

      <td><small>${item.costo_clp || 0}</small></td>

      <td><small>${item.proveedor || ''}</small></td>

      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary admin-only" onclick="window.editProduct('${item.geo}')">
          <i class="bi bi-pencil"></i>
        </button>
      </td>
    </tr>`).join('');
  
  if (typeof window.renderPaginationControls === 'function') {
    window.renderPaginationControls(Math.ceil(filtered.length / rowsPerPage), filtered.length);
  }
};

  window.editProduct = function(gCode) {
    const item = fullInventory.find(i => i.geo == gCode);
    if (!item) return;

    // Mapping to index.txt modal IDs
    document.getElementById('form_geo').value = item.geo;
    document.getElementById('form_geo').readOnly = true;
    document.getElementById('form_pn').value = item.pn || "";
    document.getElementById('form_un').value = item.un || "";
    document.getElementById('form_cat').value = item.category || "";
    document.getElementById('form_subcat').value = item.sub_categoria || "";
    document.getElementById('form_brand').value = item.marca || "";
    document.getElementById('form_supplier').value = item.proveedor || "";
    document.getElementById('form_min').value = item.min || 0;
    document.getElementById('form_max').value = item.max || 0;
    document.getElementById('form_cost_clp').value = item.costo_clp || 0;
    
    // RESTORED: Both English and Spanish descriptions
    document.getElementById('form_desc_en').value = item.en || "";
    document.getElementById('form_desc_es').value = item.es || "";

    new bootstrap.Modal(document.getElementById('productModal')).show();
  };

  window.saveProduct = function() {
    const data = {
      geo: document.getElementById('form_geo').value,
      pn: document.getElementById('form_pn').value,
      en: document.getElementById('form_desc_en').value,
      es: document.getElementById('form_desc_es').value,
      category: document.getElementById('form_cat').value,
      sub_categoria: document.getElementById('form_subcat').value,
      marca: document.getElementById('form_brand').value,
      proveedor: document.getElementById('form_supplier').value,
      un: document.getElementById('form_un').value,
      costo_clp: document.getElementById('form_cost_clp').value,
      min: document.getElementById('form_min').value,
      max: document.getElementById('form_max').value
    };

    const saveBtn = document.querySelector('#productModal .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...'; }

    google.script.run.withSuccessHandler(() => {
      const modal = bootstrap.Modal.getInstance(document.getElementById('productModal'));
      if (modal) modal.hide();
      // Instead of re-syncing everything, update the item locally
      var idx = (window.fullInventory || []).findIndex(function(i) { return i.geo === data.geo; });
      if (idx !== -1) {
        Object.assign(window.fullInventory[idx], data);
      }
      window.renderProducts();
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Changes'; }
    }).updateInventoryItem(data);
  };

  window.openAddProductModal = function() {
    document.getElementById('productForm').reset();
    document.getElementById('form_geo').readOnly = false;
    new bootstrap.Modal(document.getElementById('productModal')).show();
  };

  window.handleSearchInput = () => { currentPage = 1; window.renderProducts(); };
  window.changePage = (p) => { currentPage = p; window.renderProducts(); };

  function renderPaginationControls(totalPages, totalItems) {
    const container = document.getElementById('paginationControls');
    document.getElementById('paginationInfo').innerText = `Total: ${totalItems}`;
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
        html += `<button type="button" class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-secondary'} btn-sm mx-1" onclick="window.changePage(${i})">${i}</button>`;
      }
    }
    container.innerHTML = html;
  }
