// ================================================================
// SiteTransferJS.js — Intra Site Transfer Module Logic
// Follows the CreateReq search + cart pattern for adding items.
// ================================================================

(function () {

  let sites = [];
  let people = [];
  let vehicles = [];
  let fullInventory = [];   // all products (for search)
  let liveStockMap = {};    // item_id -> qty at selected source site
  let cart = [];            // items ready to despatch
  let transfers = [];
  let selectedReceiveTransferId = null;
  let allowNoStock = false; // checkbox: allow adding items without source stock

  // =====================
  // LOCAL UTILITIES
  // =====================
  function safeApi(fn) {
    return fn().catch(function (err) {
      console.warn('[SiteTransfer] API call failed:', err.message);
      return { data: [] };
    });
  }

  function extractData(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.data) return res.data;
    return [];
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showAlert(message, type) {
    const alertDiv = document.getElementById('stAlert');
    if (!alertDiv) return;
    alertDiv.className = 'alert alert-' + type + ' mb-3';
    alertDiv.classList.remove('d-none');
    alertDiv.textContent = message;
    setTimeout(function () { alertDiv.classList.add('d-none'); }, 5000);
  }

  // =====================
  // INIT
  // =====================
  window.initSiteTransferModule = function () {
    cart = [];
    selectedReceiveTransferId = null;
    const tbody = document.getElementById('stItemsBody');
    if (tbody) tbody.innerHTML = '';
    const recvForm = document.getElementById('stReceiveForm');
    if (recvForm) recvForm.classList.add('d-none');

    loadReferenceData().then(() => {
      renderSites();
      renderDrivers();
      renderVehicles();
      loadInventory();
      loadTransfers();
      loadReceiveTransfers();
      if (typeof updateUI === 'function') updateUI();
    });

    applyRoleUI();

    // Wire up search
    const searchBox = document.getElementById('stItemSearch');
    if (searchBox) {
      searchBox.addEventListener('input', function () {
        searchItems();
      });
    }

    // Wire up allow-no-stock checkbox
    const cb = document.getElementById('stAllowNoStock');
    if (cb) {
      cb.addEventListener('change', function () {
        allowNoStock = cb.checked;
      });
    }

    if (typeof updateUI === 'function') updateUI();
  };

  // =====================
  // REFERENCE DATA
  // =====================
  async function loadReferenceData() {
    try {
      const [sitesRes, peopleRes, vehiclesRes] = await Promise.all([
        safeApi(() => RECON_API.getSites()),
        safeApi(() => RECON_API.getPeople()),
        safeApi(() => RECON_API.getVehicles())
      ]);

      sites = extractData(sitesRes) || [];
      people = extractData(peopleRes) || [];
      vehicles = extractData(vehiclesRes) || [];

      console.log('[SiteTransfer] sites:', sites.length, 'people:', people.length, 'vehicles:', vehicles.length);
    } catch (err) {
      console.error('[SiteTransfer] Load reference data error:', err);
      showAlert('Failed to load reference data: ' + err.message, 'danger');
    }
  }

  async function loadInventory() {
    try {
      const res = await safeApi(() => RECON_API.getProducts({ limit: 1000 }));
      fullInventory = extractData(res) || [];
      console.log('[SiteTransfer] inventory loaded:', fullInventory.length);
    } catch (err) {
      console.error('[SiteTransfer] Load inventory error:', err);
      fullInventory = [];
    }
  }

  async function searchProductsServer(query) {
    try {
      const res = await safeApi(() => RECON_API.getProducts({ search: query, limit: 50 }));
      return extractData(res) || [];
    } catch (err) {
      console.error('[SiteTransfer] Search products error:', err);
      return [];
    }
  }

  function renderSites() {
    const fromSel = document.getElementById('stFromSite');
    const toSel = document.getElementById('stToSite');

    if (!fromSel || !toSel) return;

    const options = sites.map(function (s) {
      return '<option value="' + s.id + '">' + escapeHtml(s.name) + ' (' + escapeHtml(s.code || '') + ')</option>';
    }).join('');

    fromSel.innerHTML = '<option value="">' + i18n('st_select_from_site', 'Select from site') + '</option>' + options;
    toSel.innerHTML = '<option value="">' + i18n('st_select_to_site', 'Select to site') + '</option>' + options;

    // Lock from site for USER role to their assigned site
    const user = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
    if (user && user.role && String(user.role).toLowerCase() === 'user' && user.site) {
      const siteObj = sites.find(function (s) {
        return s.name === user.site || s.code === user.site || String(s.id) === String(user.site);
      });
      if (siteObj) {
        fromSel.value = siteObj.id;
        fromSel.disabled = true;
        const help = document.getElementById('stFromSiteHelp');
        if (help) help.textContent = 'Locked to your assigned site: ' + escapeHtml(siteObj.name);
      }
    }

    // When source site changes, reload stock for that site
    fromSel.addEventListener('change', function () {
      loadSourceStock(fromSel.value);
    });
  }

  async function loadSourceStock(siteId) {
    if (!siteId) {
      liveStockMap = {};
      return;
    }
    try {
      const res = await safeApi(() => RECON_API.getStock({ site: siteId, limit: 1000 }));
      const stockList = extractData(res) || [];
      liveStockMap = {};
      stockList.forEach(function (s) {
        liveStockMap[s.item_id] = Number(s.quantity || 0);
      });
      console.log('[SiteTransfer] source stock loaded for site', siteId, ':', Object.keys(liveStockMap).length, 'items');
    } catch (err) {
      console.error('[SiteTransfer] Load source stock error:', err);
      liveStockMap = {};
    }
  }

  function renderDrivers() {
    const sel = document.getElementById('stDriver');
    if (!sel) return;
    const options = people.map(function (p) {
      return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + (p.department ? ' - ' + escapeHtml(p.department) : '') + '</option>';
    }).join('');
    sel.innerHTML = '<option value="">' + i18n('st_select_driver', 'Select driver') + '</option>' + options;
  }

  function renderVehicles() {
    const sel = document.getElementById('stVehicle');
    if (!sel) return;
    const options = vehicles.map(function (v) {
      return '<option value="' + v.id + '">' + escapeHtml(v.vehicle_number) + (v.license_plate ? ' (' + escapeHtml(v.license_plate) + ')' : '') + '</option>';
    }).join('');
    sel.innerHTML = '<option value="">' + i18n('st_select_vehicle', 'Select vehicle') + '</option>' + options;
  }

  // =====================
  // SEARCH + CART (CreateReq pattern)
  // =====================
  async function searchItems() {
    const searchBox = document.getElementById('stItemSearch');
    const tbody = document.getElementById('stSearchResults');
    if (!searchBox || !tbody) return;

    const query = searchBox.value.trim();
    if (!query || query.length < 2) {
      tbody.innerHTML = '';
      return;
    }

    // Show loading state
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Searching...</td></tr>';

    try {
      const matches = await searchProductsServer(query);

      if (matches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No items found.</td></tr>';
        return;
      }

      tbody.innerHTML = matches.map(function (i) {
        const stockQty = liveStockMap[i.id] !== undefined ? liveStockMap[i.id] : 0;
        const inCart = cart.some(function (c) { return c.item_id === i.id; });
        const stockBadge = stockQty > 0 ? 'text-success' : 'text-danger';
        const canAdd = stockQty > 0 || allowNoStock;
        const addDisabled = (!canAdd && !inCart) ? 'disabled' : '';

        return '<tr>' +
          '<td data-label="Geo" class="fw-bold text-primary">' + escapeHtml(i.geo || '') + '</td>' +
          '<td data-label="P/N">' + escapeHtml(i.pn || '') + '</td>' +
          '<td data-label="Description"><small>' + escapeHtml(i.name || i.description || '') + '</small></td>' +
          '<td data-label="Source Stock" id="st_stock_' + i.id + '" class="' + stockBadge + ' fw-bold">' + stockQty + '</td>' +
          '<td data-label="Qty"><input type="number" id="st_q_' + i.id + '" value="1" min="1" class="form-control form-control-sm" style="width:70px"></td>' +
          '<td data-label="Add"><button class="btn btn-sm ' + (canAdd ? 'btn-primary' : 'btn-outline-secondary') + '" ' + addDisabled + ' onclick="addItemToCart(' + i.id + ')"><i class="bi bi-' + (inCart ? 'cart-check' : 'plus') + '"></i></button></td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      console.error('[SiteTransfer] Search error:', err);
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Search failed.</td></tr>';
    }
  }

  async function addItemToCart(itemId) {
    let item = fullInventory.find(function (i) { return i.id === itemId; });

    // If item not in local cache, fetch from server
    if (!item) {
      try {
        const res = await RECON_API.getProductByGeo(itemId);
        if (res.status === 'success' && res.data) {
          item = res.data;
          // Add to local cache for future use
          fullInventory.push(item);
        } else {
          showAlert('Product not found.', 'danger');
          return;
        }
      } catch (err) {
        showAlert('Failed to load product: ' + err.message, 'danger');
        return;
      }
    }

    const stockQty = liveStockMap[itemId] !== undefined ? liveStockMap[itemId] : 0;

    if (stockQty <= 0 && !allowNoStock) {
      showAlert('Item has no stock at source site. Enable "Add items without stock" to override.', 'warning');
      return;
    }

    const qtyInput = document.getElementById('st_q_' + itemId);
    const qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

    if (stockQty > 0 && qty > stockQty && !allowNoStock) {
      showAlert('Requested qty exceeds available stock (' + stockQty + ').', 'warning');
      return;
    }

    // Check if already in cart
    const existing = cart.findIndex(function (c) { return c.item_id === itemId; });
    if (existing >= 0) {
      cart[existing].quantity_sent += qty;
    } else {
      cart.push({
        item_id: itemId,
        geo: item.geo,
        pn: item.pn,
        name: item.name || item.description || '',
        quantity_sent: qty,
        unit_cost: 0,
        notes: '',
        stock_id: null
      });
    }

    renderCart();
    document.getElementById('stItemSearch').value = '';
    document.getElementById('stSearchResults').innerHTML = '';
  }

  function renderCart() {
    const tbody = document.getElementById('stItemsBody');
    if (!tbody) return;

    if (cart.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No items in cart.</td></tr>';
      return;
    }

    tbody.innerHTML = cart.map(function (it, idx) {
      const stockQty = liveStockMap[it.item_id] !== undefined ? liveStockMap[it.item_id] : 0;
      const overStock = stockQty > 0 && it.quantity_sent > stockQty && !allowNoStock;
      return '<tr>' +
        '<td data-label="Item"><strong>' + escapeHtml(it.geo || '') + '</strong><br><small class="text-muted">' + escapeHtml(it.pn || '') + ' - ' + escapeHtml(it.name || '') + '</small></td>' +
        '<td data-label="Qty Sent" class="text-end">' +
        '<input type="number" class="form-control form-control-sm" value="' + it.quantity_sent + '" min="1" onchange="updateCartQty(' + idx + ', this.value)">' +
        '</td>' +
        '<td data-label="Unit Cost" class="text-end">' +
        '<input type="number" class="form-control form-control-sm" value="' + (it.unit_cost || 0) + '" min="0" step="0.01" onchange="updateCartCost(' + idx + ', this.value)">' +
        '</td>' +
        '<td data-label="Notes"><input type="text" class="form-control form-control-sm" value="' + escapeHtml(it.notes || '') + '" placeholder="Notes" onchange="updateCartNotes(' + idx + ', this.value)"></td>' +
        '<td data-label="Stock" class="text-end ' + (overStock ? 'text-danger' : 'text-muted') + '">' + stockQty + (overStock ? ' (exceeds)' : '') + '</td>' +
        '<td data-label="Action" class="text-end">' +
        '<button class="btn btn-outline-danger btn-sm" onclick="removeFromCart(' + idx + ')"><i class="bi bi-trash"></i></button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function updateCartQty(idx, val) {
    if (cart[idx]) cart[idx].quantity_sent = parseInt(val, 10) || 0;
    renderCart();
  }

  function updateCartCost(idx, val) {
    if (cart[idx]) cart[idx].unit_cost = parseFloat(val) || 0;
  }

  function updateCartNotes(idx, val) {
    if (cart[idx]) cart[idx].notes = val || '';
  }

  function removeFromCart(idx) {
    cart.splice(idx, 1);
    renderCart();
  }

  function clearCart() {
    cart = [];
    renderCart();
  }

  // =====================
  // SAVE DRAFT / DESPATCH
  // =====================
  async function saveDraft() {
    const fromSite = document.getElementById('stFromSite').value;
    const toSite = document.getElementById('stToSite').value;
    const driver = document.getElementById('stDriver').value || null;
    const vehicle = document.getElementById('stVehicle').value || null;
    const despatchNo = document.getElementById('stDespatchNo').value.trim();
    const notes = document.getElementById('stNotes').value.trim();

    if (!fromSite || !toSite || !despatchNo) {
      showAlert('From site, to site, and despatch no are required.', 'warning');
      return;
    }

    if (cart.length === 0) {
      showAlert('Add at least one item to cart.', 'warning');
      return;
    }

    const itemPayload = cart.map(function (it) {
      return {
        item_id: it.item_id,
        stock_id: it.stock_id,
        quantity_sent: it.quantity_sent,
        unit_cost: it.unit_cost,
        notes: it.notes
      };
    });

    try {
      const res = await RECON_API.createSiteTransfer({
        from_site_id: parseInt(fromSite, 10),
        to_site_id: parseInt(toSite, 10),
        driver_id: driver,
        vehicle_id: vehicle,
        despatch_no: despatchNo,
        notes: notes,
        items: itemPayload
      });

      if (res.status === 'success') {
        showAlert('Transfer draft created: ' + res.data.transfer_no, 'success');
        clearCreateForm();
        loadTransfers();
      } else {
        showAlert(res.message || 'Failed to create transfer', 'danger');
      }
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  async function despatch() {
    const fromSite = document.getElementById('stFromSite').value;
    const toSite = document.getElementById('stToSite').value;
    const driver = document.getElementById('stDriver').value || null;
    const vehicle = document.getElementById('stVehicle').value || null;
    const despatchNo = document.getElementById('stDespatchNo').value.trim();
    const notes = document.getElementById('stNotes').value.trim();

    if (!fromSite || !toSite || !despatchNo) {
      showAlert('From site, to site, and despatch no are required.', 'warning');
      return;
    }

    if (cart.length === 0) {
      showAlert('Add at least one item to cart.', 'warning');
      return;
    }

    const itemPayload = cart.map(function (it) {
      return {
        item_id: it.item_id,
        stock_id: it.stock_id,
        quantity_sent: it.quantity_sent,
        unit_cost: it.unit_cost,
        notes: it.notes
      };
    });

    try {
      const res = await RECON_API.createSiteTransfer({
        from_site_id: parseInt(fromSite, 10),
        to_site_id: parseInt(toSite, 10),
        driver_id: driver,
        vehicle_id: vehicle,
        despatch_no: despatchNo,
        notes: notes,
        items: itemPayload
      });

      if (res.status !== 'success') {
        showAlert(res.message || 'Failed to create transfer', 'danger');
        return;
      }

      const transferId = res.data.id;

      const despRes = await RECON_API.despatchSiteTransfer(transferId, {
        start_date: new Date().toISOString()
      });

      if (despRes.status === 'success') {
        showAlert('Transfer despatched: ' + res.data.transfer_no, 'success');
        clearCreateForm();
        loadTransfers();
        loadReceiveTransfers();
      } else {
        showAlert(despRes.message || 'Failed to despatch', 'danger');
      }
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  function clearCreateForm() {
    cart = [];
    renderCart();
    document.getElementById('stDespatchNo').value = '';
    document.getElementById('stNotes').value = '';
    document.getElementById('stItemSearch').value = '';
    document.getElementById('stSearchResults').innerHTML = '';
  }

  // =====================
  // VIEW TRANSFERS
  // =====================
  async function loadTransfers() {
    try {
      const res = await RECON_API.getSiteTransfers();
      transfers = (res && res.data) ? res.data : (res || []);
      renderTransfersTable(transfers);
    } catch (err) {
      console.error('Load transfers error:', err);
      showAlert('Failed to load transfers: ' + err.message, 'danger');
    }
  }

  function renderTransfersTable(list) {
    const tbody = document.getElementById('stViewBody');
    const empty = document.getElementById('stViewEmpty');

    if (!list || list.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.classList.remove('d-none');
      return;
    }

    if (empty) empty.classList.add('d-none');

    const statusBadge = {
      draft: 'secondary',
      despatched: 'warning',
      in_transit: 'info',
      received: 'success',
      cancelled: 'danger'
    };

    tbody.innerHTML = list.map(function (t) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(t.transfer_no) + '</strong></td>' +
        '<td>' + escapeHtml(t.despatch_no) + '</td>' +
        '<td>' + escapeHtml(t.from_site_name) + '</td>' +
        '<td>' + escapeHtml(t.to_site_name) + '</td>' +
        '<td>' + escapeHtml(t.driver_name || '-') + '</td>' +
        '<td>' + escapeHtml(t.vehicle_number || '-') + '</td>' +
        '<td class="text-end">' + (t.item_count || '-') + '</td>' +
        '<td class="text-end">' + (t.total_sent || 0) + '</td>' +
        '<td class="text-end">' + (t.total_received || 0) + '</td>' +
        '<td><span class="badge bg-' + (statusBadge[t.status] || 'secondary') + '">' + escapeHtml(t.status) + '</span></td>' +
        '<td>' + (t.created_at ? new Date(t.created_at).toLocaleDateString() : '-') + '</td>' +
        '<td class="text-end">' +
        '<button class="btn btn-outline-primary btn-sm me-1" onclick="viewTransferDetails(\'' + t.id + '\')" title="View details"><i class="bi bi-eye"></i></button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function applyViewFilters() {
    const search = document.getElementById('stViewSearch').value.toLowerCase();
    const status = document.getElementById('stViewStatus').value;
    const dateFrom = document.getElementById('stViewDateFrom').value;
    const dateTo = document.getElementById('stViewDateTo').value;

    const filtered = transfers.filter(function (t) {
      if (search && !(t.transfer_no && t.transfer_no.toLowerCase().includes(search)) &&
          !(t.despatch_no && t.despatch_no.toLowerCase().includes(search))) {
        return false;
      }
      if (status && t.status !== status) return false;
      if (dateFrom && t.created_at && t.created_at < dateFrom) return false;
      if (dateTo && t.created_at && t.created_at > dateTo) return false;
      return true;
    });

    renderTransfersTable(filtered);
  }

  function viewTransferDetails(transferId) {
    const t = transfers.find(function (x) { return x.id === transferId; });
    if (t) {
      showAlert('Transfer ' + escapeHtml(t.transfer_no) + ' - Status: ' + escapeHtml(t.status) + ' - Sent: ' + (t.total_sent || 0) + ' - Received: ' + (t.total_received || 0), 'info');
    }
  }

  // =====================
  // RECEIVE TRANSFER
  // =====================
  async function loadReceiveTransfers() {
    try {
      const res = await RECON_API.getSiteTransfers();
      const list = (res && res.data) ? res.data : (res || []);

      const user = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
      const userRole = String(user.role || '').toLowerCase();
      const userSite = user.site;

      const pending = list.filter(function (t) {
        if (t.status !== 'despatched' && t.status !== 'in_transit') return false;
        if (userRole === 'user' && userSite && String(t.to_site_id) !== userSite) return false;
        return true;
      });

      renderReceiveTable(pending);
    } catch (err) {
      console.error('Load receive transfers error:', err);
    }
  }

  function renderReceiveTable(list) {
    const tbody = document.getElementById('stReceiveBody');
    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No transfers awaiting receive.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (t) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(t.transfer_no) + '</strong></td>' +
        '<td>' + escapeHtml(t.despatch_no) + '</td>' +
        '<td>' + escapeHtml(t.from_site_name) + '</td>' +
        '<td>' + escapeHtml(t.driver_name || '-') + '</td>' +
        '<td class="text-end">' + (t.item_count || '-') + '</td>' +
        '<td class="text-end">' + (t.total_sent || 0) + '</td>' +
        '<td class="text-end">' + (t.total_received || 0) + '</td>' +
        '<td>' + (t.start_date ? new Date(t.start_date).toLocaleDateString() : '-') + '</td>' +
        '<td class="text-end">' +
        '<button class="btn btn-outline-primary btn-sm" onclick="selectReceiveTransfer(\'' + t.id + '\')" title="Receive"><i class="bi bi-box-arrow-in-left"></i></button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function selectReceiveTransfer(transferId) {
    const t = transfers.find(function (x) { return x.id === transferId; });
    if (!t) {
      RECON_API.getSiteTransfer(transferId).then(function (res) {
        if (res.status === 'success') openReceiveForm(res.data);
      });
    } else {
      openReceiveForm(t);
    }
  }

  function openReceiveForm(transfer) {
    selectedReceiveTransferId = transfer.id;

    document.getElementById('stRecvTransferNo').value = transfer.transfer_no;
    document.getElementById('stRecvDespatchNo').value = transfer.despatch_no;
    document.getElementById('stRecvFromSite').value = transfer.from_site_name;
    document.getElementById('stReceiveForm').classList.remove('d-none');

    RECON_API.getSiteTransfer(transfer.id).then(function (res) {
      if (res.status === 'success') {
        renderReceiveItems(res.data.items || []);
      }
    }).catch(function (err) {
      showAlert('Failed to load transfer items: ' + err.message, 'danger');
    });
  }

  function renderReceiveItems(itemList) {
    const tbody = document.getElementById('stRecvItemsBody');
    if (!itemList || itemList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No items.</td></tr>';
      return;
    }

    tbody.innerHTML = itemList.map(function (it) {
      const defaultReceived = it.quantity_sent || 0;
      return '<tr>' +
        '<td>' + escapeHtml(it.product_name || it.geo || '') + '</td>' +
        '<td class="text-end">' + (it.quantity_sent || 0) + '</td>' +
        '<td class="text-end">' +
        '<input type="number" class="form-control form-control-sm st-recv-qty" min="0" max="' + (it.quantity_sent || 0) + '" value="' + defaultReceived + '" data-item-id="' + it.id + '" onchange="updateRecvQty(this)">' +
        '</td>' +
        '<td class="text-end">' + (it.quantity_discrepancy || 0) + '</td>' +
        '</tr>';
    }).join('');
  }

  function updateRecvQty(el) {
    // stored in DOM; read on confirm
  }

  function cancelReceive() {
    selectedReceiveTransferId = null;
    document.getElementById('stReceiveForm').classList.add('d-none');
  }

  async function confirmReceive() {
    if (!selectedReceiveTransferId) return;

    const recvItems = [];
    const rows = document.querySelectorAll('.st-recv-qty');
    rows.forEach(function (el) {
      recvItems.push({
        id: el.getAttribute('data-item-id'),
        quantity_received: parseInt(el.value, 10) || 0
      });
    });

    try {
      const res = await RECON_API.receiveSiteTransfer(selectedReceiveTransferId, {
        items: recvItems
      });

      if (res.status === 'success') {
        showAlert('Transfer received successfully.', 'success');
        selectedReceiveTransferId = null;
        document.getElementById('stReceiveForm').classList.add('d-none');
        loadTransfers();
        loadReceiveTransfers();
      } else {
        showAlert(res.message || 'Failed to receive transfer', 'danger');
      }
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  // =====================
  // UTILITIES
  // =====================
  function applyRoleUI() {
    const user = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
    const role = String(user.role || '').toLowerCase();

    const perms = JSON.parse(localStorage.getItem('recon_user_permissions') || '{}');
    const stPerm = perms && perms.site_transfer;
    if (stPerm && stPerm.can_edit === 0) {
      const btns = document.querySelectorAll('#stCreate button');
      btns.forEach(function (b) { b.disabled = true; });
    }
  }

  // Expose public API
  window.SiteTransfer = {
    init: window.initSiteTransferModule,
    refresh: function () { loadTransfers(); loadReceiveTransfers(); },
    searchItems: searchItems,
    addItemToCart: addItemToCart,
    removeFromCart: removeFromCart,
    updateCartQty: updateCartQty,
    updateCartCost: updateCartCost,
    updateCartNotes: updateCartNotes,
    saveDraft: saveDraft,
    despatch: despatch,
    loadTransfers: loadTransfers,
    applyViewFilters: applyViewFilters,
    viewTransferDetails: viewTransferDetails,
    loadReceiveTransfers: loadReceiveTransfers,
    selectReceiveTransfer: selectReceiveTransfer,
    cancelReceive: cancelReceive,
    confirmReceive: confirmReceive,
    updateRecvQty: updateRecvQty,
    clearCart: clearCart
  };

})();