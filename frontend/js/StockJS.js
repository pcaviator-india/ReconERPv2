var StockModule = (function() {

  let allStock = [];

  function loadStockData() {
    google.script.run
      .withSuccessHandler(function(data) {
        allStock = data || [];

        // 1. Populate full location options for admins first
        populateLocationOptions();

        // 2. Apply site lock for USER role immediately
        if (window.currentUser && window.currentUser.site) {
          window.applySiteLock('locationFilter', window.currentUser.site);
          
          // 3. Force-filter the stock data for restricted users so they only see their site
          const userSite = window.currentUser.site.toLowerCase();
          allStock = allStock.filter(item => {
            const itemLocation = (item.LocationID || item.location || "").toLowerCase();
            return itemLocation === userSite;
          });
        }

        // 4. Render tables and summary cards using the correctly scoped data
        renderStockTable(allStock);
        renderSummaryCards(allStock);
      })
      .withFailureHandler(function(err) {
        console.error(err);
        Swal.fire(i18n("msg_error"), i18n("msg_sys_error"), "error");
      })
      .getFullStockData();
}

  // Helper to find product details from window.fullInventory cache
  function getInventoryDetails(itemId) {
    if (!window.fullInventory || !Array.isArray(window.fullInventory)) {
      return { pn: '', es: '' };
    }
    const match = window.fullInventory.find(inv => inv.id === itemId || inv.geo === itemId);
    return {
      pn: match ? match.pn || '' : '',
      es: match ? match.es || '' : ''
    };
  }

  function renderStockTable(stockList) {
    const tbody = document.getElementById("stockBody");
    if (!tbody) return;

    // Helper to format rack/location display
    const formatRackLocation = (rackId, shelfLevel, sideCode) => {
      let result = "";
      
      if (rackId && shelfLevel) {
        result = `${rackId}-${shelfLevel}`;
        if (sideCode !== null && sideCode !== "") {
          result += ` (${sideCode})`;
        }
      } else if (rackId || shelfLevel) {
        // Show partial info if available
        const parts = [];
        if (rackId) parts.push(rackId);
        if (shelfLevel) parts.push(`Shelf ${shelfLevel}`);
        result = parts.join(" ");
      }
      
      return result || "-";
    };

    tbody.innerHTML = stockList.map(item => {
      const invDetails = getInventoryDetails(item.ItemID);
      return `
        <tr>
          <td><strong>${item.ItemID || ''}</strong></td>
          <td>${invDetails.pn || ''}</td>
          <td>${item.ProductName || ''}</td>
          <td><small class="text-muted">${invDetails.es || ''}</small></td>
          <td><span class="badge bg-secondary">${item.LocationType || ''}</span></td>
          <td>${item.LocationID || ''}</td>
          <td>${formatRackLocation(item.RackId, item.ShelfLevel, item.SideCode)}</td>
          <td class="text-end fw-bold">${Number(item.Quantity || 0).toLocaleString()}</td>
          <td class="text-end fw-bold text-success">${Number(item.AvailableQty || 0).toLocaleString()}</td>
          <td class="small text-muted">
            ${item.LastUpdated ? new Date(item.LastUpdated).toLocaleString() : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderSummaryCards(stockList) {
    const container = document.getElementById("stockSummary");
    if (!container) return;

    const totalItems = stockList.length;
    const totalQty = stockList.reduce((sum, item) => sum + Number(item.Quantity || 0), 0);

    container.innerHTML = `
      <div class="col-md-4">
        <div class="card shadow-sm text-center p-3">
          <h5 class="text-muted">Total Items</h5>
          <h2 class="fw-bold">${totalItems}</h2>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card shadow-sm text-center p-3">
          <h5 class="text-muted">Total Quantity</h5>
          <h2 class="fw-bold">${totalQty.toLocaleString()}</h2>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card shadow-sm text-center p-3">
          <h5 class="text-muted">Main Warehouse</h5>
          <h2 class="fw-bold text-primary">${stockList.filter(i => i.LocationID === "Store").reduce((sum, i) => sum + Number(i.Quantity || 0), 0).toLocaleString()}</h2>
        </div>
      </div>
    `;
  }

  function filterStock() {
    const searchInput = document.getElementById("stockSearch");
    const locationSelect = document.getElementById("locationFilter");

    const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const locationId = locationSelect ? locationSelect.value.trim() : "";

    let filtered = allStock;

    // 1. Search Filter — split into individual terms, ALL must be present somewhere in the item's fields
    if (search) {
        const searchTerms = search.split(/\s+/).filter(term => term.length > 0);
        filtered = filtered.filter(item => {
            const invDetails = getInventoryDetails(item.ItemID);
            const searchableText = [
                (item.ItemID || ""),
                (item.ProductName || ""),
                (invDetails.pn || ""),
                (invDetails.es || "")
            ].join(" ").toLowerCase();

            return searchTerms.every(term => searchableText.includes(term));
        });
    }

    // 2. Location Filter (Ignored if empty or set to common 'all' keywords)
    if (locationId && locationId !== "all" && locationId !== "todos" && locationId !== "null") {
        filtered = filtered.filter(item => {
            // Fallback check in case your data property name varies slightly
            const itemLocation = item.LocationID || item.location || item.ubicacion || "";
            return itemLocation.toString().toLowerCase() === locationId.toLowerCase();
        });
    }

    renderStockTable(filtered);
}

  return {
    init: function() {
      loadStockData();
    },
    refresh: function() {
      loadStockData();
    },
    filterStock: filterStock,
    exportStock: function() {
      if (!allStock || allStock.length === 0) {
        Swal.fire("No Data", "No stock data to export", "warning");
        return;
      }

      // Check if XLSX is available
      if (typeof XLSX === "undefined") {
        Swal.fire({
          title: "Library Loading",
          text: "Please wait a moment and try again...",
          icon: "info",
          timer: 1500,
          showConfirmButton: false
        });
        setTimeout(() => this.exportStock(), 1200); // Retry once
        return;
      }

      try {
        const exportData = allStock.map(item => {
          const invDetails = getInventoryDetails(item.ItemID);
          return {
            "Item ID": item.ItemID || "",
            "Product Number": invDetails.pn || "",
            "Product Name": item.ProductName || "",
            "Description (ES)": invDetails.es || "",
            "Location Type": item.LocationType || "",
            "Location": item.LocationID || "",
            "Rack/Location": (() => {
              let result = "";
              if (item.RackId && item.ShelfLevel) {
                result = `${item.RackId}-${item.ShelfLevel}`;
                if (item.SideCode !== null && item.SideCode !== "") {
                  result += ` (${item.SideCode})`;
                }
              } else if (item.RackId || item.ShelfLevel) {
                const parts = [];
                if (item.RackId) parts.push(item.RackId);
                if (item.ShelfLevel) parts.push(`Shelf ${item.ShelfLevel}`);
                result = parts.join(" ");
              }
              return result || "-";
            })(),
            "Total Quantity": Number(item.Quantity || 0),
            "Available Quantity": Number(item.AvailableQty || 0),
            "Last Updated": item.LastUpdated ? new Date(item.LastUpdated).toLocaleString() : ""
          };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);

        // Improve column widths to fit new fields
        ws['!cols'] = [
          { wch: 15 }, { wch: 15 }, { wch: 35 }, { wch: 30 }, 
          { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 22 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Stock_Report");

        const fileName = `Stock_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, fileName);

      } catch (e) {
        console.error("Export Error:", e);
        Swal.fire("Export Failed", "An unexpected error occurred", "error");
      }
    },
  };
})();

function populateLocationOptions() {
  const select = document.getElementById('locationFilter');
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
}
