// ============================================================
// CONTROL COMBUSTIBLE (Mochilas multi-tank system)
// ============================================================

window.fuelPurchaseHistory = [];
window.fuelMochilas = [];           // cached mochila list
window.fuelActiveTank = null;       // active mochila object

// Cache for dropdown data
window.fuelDropdownCache = {
  sites: [],
  movementVal: { Vehiculo: [], Generador: [], Maquina: [] },
  people: []
};

function ccEl(id) { return document.getElementById(id); }

function isElevatedUser() {
  try {
    const u = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
    const r = String(u.role || '').toLowerCase();
    return r === 'admin' || r === 'manager';
  } catch (e) { return false; }
}

// ============================================================
// INIT
// ============================================================

window.initControlCombustible = async function () {
  try {
    const elevated = isElevatedUser();

    // Show admin button for admin/manager
    const adminBtn = ccEl('cc_admin_btn');
    if (adminBtn && elevated) adminBtn.classList.remove('d-none');

    // Load all data in parallel
    const [sitesRes, movementValRes, peopleRes, mochilaRes] = await Promise.all([
      window.RECON_API.getSites(),
      window.RECON_API.getMovementValidation(),
      window.RECON_API.getPeople(),
      window.RECON_API.getFuelTanks()
    ]);

    window.fuelDropdownCache.sites = (sitesRes.data || []).map(s => s.name).filter(Boolean);

    if (movementValRes) {
      window.fuelDropdownCache.movementVal.Vehiculo = movementValRes.Vehiculo || [];
      window.fuelDropdownCache.movementVal.Generador = movementValRes.Generador || [];
      window.fuelDropdownCache.movementVal.Maquina = movementValRes.Maquina || [];
    }

    window.fuelDropdownCache.people = (peopleRes || []).filter(p => p.active === true);

    // Store mochilas
    const tanks = (mochilaRes && mochilaRes.data) ? mochilaRes.data : (Array.isArray(mochilaRes) ? mochilaRes : []);
    window.fuelMochilas = tanks.filter(t => t.is_active !== 0);

    // Handle no-mochila state
    if (!window.fuelMochilas.length) {
      const noAlert = ccEl('cc_no_mochila_alert');
      const mainContent = ccEl('cc_main_content');
      if (noAlert) {
        try {
          const u = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
          const site = u.site || 'su faena';
          ccEl('cc_no_mochila_msg').textContent =
            `Su faena (${site}) no tiene mochilas registradas actualmente. Contacte a Bodega Central o Administración para habilitar una mochila.`;
        } catch (e) {}
        noAlert.classList.remove('d-none');
      }
      if (mainContent) mainContent.classList.add('d-none');
      if (ccEl('cc_mochila_subtitle')) ccEl('cc_mochila_subtitle').textContent = 'Sin mochilas registradas';
      return;
    }

    // Populate mochila selector
    populateMochilaSelector();
    populateEntryTankSelector();

    // Set active mochila to first by default
    window.fuelActiveTank = window.fuelMochilas[0];
    updateSubtitle();

    populateProyectoDropdown();
    populateAssetTypeDropdown();
    updateAssetDropdown();

    await refreshFuelHistory();
    refreshBalance();
    loadFuelPurchaseData();
    setupModalListeners();

    ccEl('fuel_proyecto')?.focus();

  } catch (err) {
    console.error('Error initializing Control Combustible:', err);
    Swal.fire('Error', 'Error al inicializar Control Combustible: ' + err.message, 'error');
  }
};

// ============================================================
// MOCHILA SELECTOR
// ============================================================

function populateMochilaSelector() {
  const sel = ccEl('cc_mochila_select');
  if (!sel) return;
  sel.innerHTML = window.fuelMochilas.map(t => {
    const label = `${t.name} — ${t.site} (${t.tank_code})`;
    return `<option value="${t.id}">${label}</option>`;
  }).join('');
  if (window.fuelMochilas.length > 0) sel.value = window.fuelMochilas[0].id;
}

function populateEntryTankSelector() {
  const sel = ccEl('fuel_entry_tank');
  if (!sel) return;
  sel.innerHTML = window.fuelMochilas.map(t => {
    return `<option value="${t.id}">${t.name} (${t.site})</option>`;
  }).join('');
  if (window.fuelMochilas.length > 0) sel.value = window.fuelMochilas[0].id;
}

function onMochilaChange() {
  const sel = ccEl('cc_mochila_select');
  if (!sel) return;
  const id = parseInt(sel.value, 10);
  window.fuelActiveTank = window.fuelMochilas.find(t => t.id === id) || window.fuelMochilas[0];
  updateSubtitle();
  refreshBalance();
  refreshFuelHistory();
}

function updateSubtitle() {
  const sub = ccEl('cc_mochila_subtitle');
  if (!sub || !window.fuelActiveTank) return;
  const t = window.fuelActiveTank;
  sub.textContent = `${t.name} · ${t.site} · ${t.tank_code}`;
}

// ============================================================
// BALANCE
// ============================================================

function refreshBalance() {
  const tankId = window.fuelActiveTank ? window.fuelActiveTank.id : null;
  window.RECON_API.getFuelBalance(tankId)
    .then(res => {
      const data = (res && typeof res === 'object' && res.balance !== undefined) ? res : (res && res.data ? res.data : res);
      const balance = Number(data && data.balance !== undefined ? data.balance : (data || 0)) || 0;
      const bought = Number(data && data.totalBought !== undefined ? data.totalBought : 0) || 0;
      const used = Number(data && data.totalUsed !== undefined ? data.totalUsed : 0) || 0;

      if (ccEl('fuel_balance_display')) ccEl('fuel_balance_display').textContent = balance.toFixed(2) + ' L';
      if (ccEl('cc_total_bought')) ccEl('cc_total_bought').textContent = bought.toFixed(2) + ' L';
      if (ccEl('cc_total_used')) ccEl('cc_total_used').textContent = used.toFixed(2) + ' L';

      // Capacity bar
      const tank = window.fuelActiveTank;
      const cap = tank ? Number(tank.capacity_liters) : 0;
      if (cap > 0) {
        const pct = Math.min(100, Math.max(0, Math.round((balance / cap) * 100)));
        if (ccEl('cc_capacity_wrap')) ccEl('cc_capacity_wrap').classList.remove('d-none');
        if (ccEl('cc_capacity_lbl')) ccEl('cc_capacity_lbl').textContent = cap.toLocaleString() + ' L';
        if (ccEl('cc_capacity_bar')) {
          ccEl('cc_capacity_bar').style.width = pct + '%';
          ccEl('cc_capacity_bar').className = 'progress-bar ' + (pct < 20 ? 'bg-danger' : pct < 50 ? 'bg-warning' : 'bg-success');
        }
      } else {
        if (ccEl('cc_capacity_wrap')) ccEl('cc_capacity_wrap').classList.add('d-none');
      }
    })
    .catch(err => console.error('Error refreshing balance:', err));
}

// ============================================================
// DROPDOWNS
// ============================================================

function populateProyectoDropdown() {
  const select = ccEl('fuel_proyecto');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Seleccione Proyecto</option>';
  window.fuelDropdownCache.sites.forEach(site => {
    const opt = document.createElement('option');
    opt.value = site;
    opt.textContent = site;
    select.appendChild(opt);
  });
  if (currentValue && window.fuelDropdownCache.sites.includes(currentValue)) {
    select.value = currentValue;
  }
}

function populateAssetTypeDropdown() {
  const select = ccEl('fuel_asset_type');
  if (!select) return;
  const types = ['Vehiculo', 'Generador', 'Maquina'];
  const labels = { 'Vehiculo': 'Vehículo', 'Generador': 'Generador', 'Maquina': 'Maquinaria' };
  select.innerHTML = '<option value="">Seleccione...</option>';
  types.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = labels[type];
    select.appendChild(opt);
  });
}

function updateAssetDropdown() {
  const type = ccEl('fuel_asset_type')?.value;
  const assetSelect = ccEl('fuel_asset_id');
  if (!assetSelect) return;
  const currentValue = assetSelect.value;
  assetSelect.innerHTML = '<option value="">Seleccione...</option>';
  if (type && window.fuelDropdownCache.movementVal[type]) {
    window.fuelDropdownCache.movementVal[type].forEach(item => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      assetSelect.appendChild(opt);
    });
  }
  if (currentValue && window.fuelDropdownCache.movementVal[type]?.includes(currentValue)) {
    assetSelect.value = currentValue;
  }
}

// ============================================================
// ODOMETER VALIDATION
// ============================================================

async function validateOdometer(assetId, tipoActivo, km) {
  if (!assetId || !km || !tipoActivo) return { valid: true };
  try {
    const res = await window.RECON_API.getLastFuelEntry(assetId);
    const lastKmVal = (res && res.data && res.data.lastKm !== undefined) ? res.data.lastKm
      : (res && res.lastKm !== undefined ? res.lastKm : null);
    if (lastKmVal !== null && lastKmVal !== undefined) {
      const lastKm = Number(lastKmVal);
      const currentKm = Number(km);
      if (currentKm < lastKm) {
        return {
          valid: false,
          message: `El ${tipoActivo === 'Generador' ? 'horómetro' : 'kilometraje'} (${currentKm}) no puede ser menor al último registro (${lastKm}) para este activo.`
        };
      }
    }
  } catch (err) {
    console.error('Could not validate odometer:', err);
  }
  return { valid: true };
}

// ============================================================
// SAVE FUEL ENTRY
// ============================================================

async function saveFuelEntry(btnElement) {
  const user = (() => { try { return JSON.parse(localStorage.getItem('recon_user_secure') || '{}'); } catch (e) { return {}; } })();

  const proyecto = ccEl('fuel_proyecto')?.value;
  const tipoActivo = ccEl('fuel_asset_type')?.value;
  const assetId = ccEl('fuel_asset_id')?.value;
  const litros = ccEl('fuel_litros')?.value;
  const km = ccEl('fuel_km')?.value;
  const nombreInput = (ccEl('fuel_nombre_input')?.value || '').trim();
  const tankId = parseInt(ccEl('fuel_entry_tank')?.value || (window.fuelActiveTank ? window.fuelActiveTank.id : 1), 10);

  if (!proyecto || !tipoActivo || !assetId || !nombreInput) {
    Swal.fire('Error', 'Por favor complete todos los campos (incluyendo el nombre)', 'error');
    return;
  }

  const odometerValidation = await validateOdometer(assetId, tipoActivo, km);
  if (!odometerValidation.valid) {
    Swal.fire('Validación Fallida', odometerValidation.message, 'error');
    return;
  }

  const person = resolveFuelPerson(nombreInput);
  if (!person) {
    Swal.fire('Persona No Encontrada', 'No se encontró la persona con ese nombre o ID.', 'error');
    return;
  }

  const tankObj = window.fuelMochilas.find(t => t.id === tankId) || window.fuelActiveTank;
  const tankLabel = tankObj ? tankObj.name : 'Mochila';

  const assetLabel = { 'Vehiculo': 'vehículo', 'Generador': 'generador', 'Maquina': 'maquinaria' }[tipoActivo] || 'activo';
  const odometerLabel = tipoActivo === 'Generador' ? 'Horómetro' : 'Kilometraje';

  const data = {
    tank_id: tankId,
    proyecto,
    tipoActivo,
    assetId,
    cantidadLitro: litros,
    liters: litros,
    kilometraje: km,
    odometer_km: km,
    nombre: person.name,
    driver: person.name,
    personId: person.id,
    userEmail: user ? user.email : 'n/a',
    user_email: user ? user.email : 'n/a'
  };

  Swal.fire({
    title: 'Confirmar Registro',
    html: `
      <div class="text-start">
        <p><strong>Mochila:</strong> ${tankLabel}</p>
        <p><strong>Proyecto:</strong> ${proyecto}</p>
        <p><strong>Tipo de Activo:</strong> ${assetLabel} (${assetId})</p>
        <p><strong>Litros:</strong> ${litros}</p>
        <p><strong>${odometerLabel}:</strong> ${km}</p>
        <p><strong>Persona:</strong> ${person.name} (${person.id})</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, Guardar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#28a745',
    cancelButtonColor: '#6c757d'
  }).then((confirmed) => {
    if (!confirmed.isConfirmed) return;
    executeSaveFuelEntry(data, btnElement);
  });
}

function executeSaveFuelEntry(data, btnElement) {
  const btn = btnElement || ccEl('btn_save_fuel_entry');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Guardando...';
  }

  window.RECON_API.saveFuelEntry(data)
    .then(res => {
      if (res && (res.status === 'success' || res.success === true)) {
        Swal.fire('¡Guardado!', 'Registro exitoso', 'success');
        if (ccEl('fuel_litros')) ccEl('fuel_litros').value = '';
        if (ccEl('fuel_km')) ccEl('fuel_km').value = '';
        if (ccEl('fuel_nombre_input')) ccEl('fuel_nombre_input').value = '';
        refreshFuelHistory();
        refreshBalance();
      } else {
        throw new Error((res && (res.message || res.error)) || 'Error al guardar');
      }
    })
    .catch(err => {
      Swal.fire('Error', err.message || 'Ocurrió un error al guardar.', 'error');
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Guardar Registro';
      }
    });
}

// ============================================================
// FUEL HISTORY
// ============================================================

window.fuelHistoryCache = [];
window.fuelPeopleCache = [];

function parseFuelDate(str) {
  if (!str) return new Date(0);
  const s = String(str).trim();
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dm) {
    return new Date(parseInt(dm[3], 10), parseInt(dm[2], 10) - 1, parseInt(dm[1], 10),
      parseInt(dm[4] || 0, 10), parseInt(dm[5] || 0, 10), parseInt(dm[6] || 0, 10));
  }
  const ym = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ym) {
    return new Date(parseInt(ym[1], 10), parseInt(ym[2], 10) - 1, parseInt(ym[3], 10),
      parseInt(ym[4] || 0, 10), parseInt(ym[5] || 0, 10), parseInt(ym[6] || 0, 10));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function formatFuelDate(str) {
  const d = parseFuelDate(str);
  if (!d || isNaN(d.getTime()) || d.getTime() === 0) return String(str || '');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

window.refreshFuelHistory = async function () {
  try {
    const tankId = window.fuelActiveTank ? window.fuelActiveTank.id : null;
    const [peopleRes, historyRes] = await Promise.all([
      window.RECON_API.getPeople(),
      window.RECON_API.getFuelHistory(tankId)
    ]);
    const people = (peopleRes || []).filter(p => p.active === true);
    window.fuelPeopleCache = people;

    // Normalize: getFuelHistory now returns array directly (from /fuel/history) or legacy positional
    let data = historyRes || [];
    if (!Array.isArray(data)) data = [];

    window.fuelHistoryCache = data.sort((a, b) => parseFuelDate(b[0]).getTime() - parseFuelDate(a[0]).getTime());

    // Populate people filter
    const select = ccEl('f_person');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = '<option value="">Todas</option>' +
        people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      if (currentVal) select.value = currentVal;
    }

    applyFilters();
  } catch (err) {
    console.error('Error refreshing fuel history:', err);
  }
};

function renderTable(data) {
  const tbody = document.querySelector('#fuel_table tbody');
  if (!tbody) return;
  const pList = window.fuelPeopleCache || [];
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    // r[6] = driver/nombre, r[7] = userEmail, r[8] = tank_name
    const personMatch = pList.find(p => String(p.id) === String(r[6]) || String(p.name).toLowerCase() === String(r[6]).toLowerCase());
    const displayName = personMatch ? personMatch.name : (r[6] || '');
    const dateFormatted = formatFuelDate(r[0]);
    const tankCol = r[8] || '';
    return `<tr>
      <td>${dateFormatted}</td>
      <td>${r[1] || ''}</td>
      <td>${r[2] || ''}</td>
      <td>${r[3] || ''}</td>
      <td>${r[4] !== undefined && r[4] !== null ? r[4] : ''}</td>
      <td>${r[5] !== undefined && r[5] !== null ? r[5] : ''}</td>
      <td>${displayName}</td>
      <td>${r[7] || ''}</td>
      <td><span class="badge bg-warning text-dark">${tankCol}</span></td>
    </tr>`;
  }).join('');
}

function applyFilters() {
  const dateFrom = ccEl('f_date_from')?.value || '';
  const dateTo = ccEl('f_date_to')?.value || '';
  const project = (ccEl('f_project')?.value || '').trim().toLowerCase();
  const patente = (ccEl('f_patente')?.value || '').trim().toLowerCase();
  const person = (ccEl('f_person')?.value || '').trim();

  const people = window.fuelPeopleCache || [];
  const selectedPerson = person ? people.find(p => String(p.id) === String(person)) : null;

  const filtered = (window.fuelHistoryCache || []).filter(r => {
    let matchDate = true;
    if (dateFrom || dateTo) {
      const d = parseFuelDate(r[0]);
      if (d && !isNaN(d.getTime()) && d.getTime() !== 0) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        const rowDate = `${y}-${mo}-${dy}`;
        if (dateFrom && rowDate < dateFrom) matchDate = false;
        if (dateTo && rowDate > dateTo) matchDate = false;
      }
    }
    const matchProj = !project || String(r[1] || '').toLowerCase().includes(project);
    const matchPatente = !patente || String(r[3] || '').toLowerCase().includes(patente);
    let matchPerson = true;
    if (person) {
      const driverStr = String(r[6] || '').trim().toLowerCase();
      const personId = String(person).toLowerCase();
      const personName = selectedPerson ? String(selectedPerson.name || '').toLowerCase() : '';
      matchPerson = driverStr === personId ||
        (personName && (driverStr === personName || driverStr.includes(personName) || personName.includes(driverStr)));
    }
    return matchDate && matchProj && matchPatente && matchPerson;
  });

  renderTable(filtered);
}

function clearFilters() {
  ['f_date_from', 'f_date_to', 'f_project', 'f_patente', 'f_person'].forEach(id => {
    const el = ccEl(id);
    if (el) el.value = '';
  });
  applyFilters();
}

// ============================================================
// FUEL PURCHASE / RECEPTION
// ============================================================

function loadFuelPurchaseData() {
  const tankId = window.fuelActiveTank ? window.fuelActiveTank.id : null;
  window.RECON_API.getFuelPurchaseHistory(tankId)
    .then(data => {
      // Normalize: new API returns objects, legacy returns objects too
      let arr = data || [];
      if (!Array.isArray(arr)) arr = [];
      window.fuelPurchaseHistory = arr;
      populateSupplierFilter(arr);
      loadFuelPurchaseHistory();
    })
    .catch(err => console.error('Error loading fuel purchase history:', err));
}

function loadFuelPurchaseHistory() {
  const dateFrom = ccEl('fuel_purchase_date_from')?.value || '';
  const dateTo = ccEl('fuel_purchase_date_to')?.value || '';
  const supplier = ccEl('fuel_purchase_supplier')?.value || '';
  const invoice = (ccEl('fuel_purchase_invoice')?.value || '').trim().toLowerCase();
  const tbody = ccEl('fuel_purchase_history_body');
  if (!tbody) return;

  let data = window.fuelPurchaseHistory || [];

  data = data.filter(row => {
    if (dateFrom || dateTo) {
      const rowDate = new Date(row.fechaISO || row.fecha || '');
      if (dateFrom) { const fromDate = new Date(dateFrom); if (rowDate < fromDate) return false; }
      if (dateTo) { const toDate = new Date(dateTo); toDate.setHours(23, 59, 59, 999); if (rowDate > toDate) return false; }
    }
    if (supplier && row.proveedor !== supplier) return false;
    if (invoice && !(row.factura || '').toLowerCase().includes(invoice)) return false;
    return true;
  });

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay registros</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${row.fecha || ''}</td>
      <td>${row.proveedor || ''}</td>
      <td>${row.litros || ''}</td>
      <td>${row.factura || ''}</td>
      <td>${row.usuario || ''}</td>
      <td><span class="badge bg-warning text-dark">${row.tank_name || ''}</span></td>
    </tr>
  `).join('');
}

function populateSupplierFilter(data) {
  const supplierSelect = ccEl('fuel_purchase_supplier');
  if (!supplierSelect) return;
  const suppliers = [...new Set(data.map(row => row.proveedor).filter(s => s && s.trim() !== ''))];
  supplierSelect.innerHTML = `<option value="">Todos</option>` +
    suppliers.sort().map(proveedor => `<option value="${proveedor}">${proveedor}</option>`).join('');
}

function setupModalListeners() {
  const fuelReceptionModal = ccEl('modalFuelReception');
  if (fuelReceptionModal && !fuelReceptionModal.dataset.historyListener) {
    fuelReceptionModal.addEventListener('shown.bs.modal', function () {
      // Populate mochila select in modal
      populateReceptionMochilaSelect();
      loadFuelPurchaseHistory();
    });
    ccEl('fuel_purchase_date_from')?.addEventListener('change', loadFuelPurchaseHistory);
    ccEl('fuel_purchase_date_to')?.addEventListener('change', loadFuelPurchaseHistory);
    ccEl('fuel_purchase_supplier')?.addEventListener('change', loadFuelPurchaseHistory);
    ccEl('fuel_purchase_invoice')?.addEventListener('input', loadFuelPurchaseHistory);
    fuelReceptionModal.dataset.historyListener = 'true';
  }
}

function populateReceptionMochilaSelect() {
  const sel = ccEl('rec_mochila_select');
  if (!sel) return;
  sel.innerHTML = window.fuelMochilas.map(t => {
    return `<option value="${t.id}">${t.name} (${t.site})</option>`;
  }).join('');
  if (window.fuelActiveTank) sel.value = window.fuelActiveTank.id;
}

function saveFuelPurchase(btnElement) {
  const proveedor = ccEl('rec_proveedor')?.value?.trim();
  const litros = ccEl('rec_litros')?.value?.trim();
  const factura = ccEl('rec_factura')?.value?.trim();
  const tankId = parseInt(ccEl('rec_mochila_select')?.value || (window.fuelActiveTank ? window.fuelActiveTank.id : 1), 10);

  if (!proveedor || !litros) {
    Swal.fire('Error', 'Por favor ingrese al menos Proveedor y Litros.', 'error');
    return;
  }

  const data = {
    tank_id: tankId,
    proveedor,
    litros,
    factura,
    userName: window.currentUser ? window.currentUser.name : 'Unknown',
    user_name: window.currentUser ? window.currentUser.name : 'Unknown'
  };

  const btn = btnElement || ccEl('btn_save_fuel_purchase');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Guardando...';
  }

  window.RECON_API.saveFuelPurchase(data)
    .then(res => {
      const modalEl = ccEl('modalFuelReception');
      if (modalEl) { const modal = bootstrap.Modal.getInstance(modalEl); if (modal) modal.hide(); }
      if (ccEl('rec_proveedor')) ccEl('rec_proveedor').value = '';
      if (ccEl('rec_litros')) ccEl('rec_litros').value = '';
      if (ccEl('rec_factura')) ccEl('rec_factura').value = '';
      Swal.fire('Éxito', 'Compra de combustible registrada en Mochila', 'success');
      refreshBalance();
      loadFuelPurchaseData();
    })
    .catch(err => {
      Swal.fire('Error', err.message || 'No se pudo guardar la compra.', 'error');
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Guardar Recepción';
      }
    });
}

// ============================================================
// ADMIN MOCHILAS MODAL
// ============================================================

async function openAdminMochilas() {
  // Refresh mochilas list
  try {
    const res = await window.RECON_API.getFuelTanks();
    window.fuelMochilas = ((res && res.data) ? res.data : (Array.isArray(res) ? res : [])).filter(t => true);

    renderAdminMochilasList();

    // Populate site select
    const siteSel = ccEl('new_mochila_site');
    if (siteSel) {
      siteSel.innerHTML = '<option value="">Seleccione sitio...</option>' +
        window.fuelDropdownCache.sites.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    const modal = new bootstrap.Modal(ccEl('modalAdminMochilas'));
    modal.show();
  } catch (e) {
    Swal.fire('Error', 'No se pudo cargar mochilas: ' + e.message, 'error');
  }
}

function renderAdminMochilasList() {
  const container = ccEl('admin_mochilas_list');
  if (!container) return;
  if (!window.fuelMochilas || !window.fuelMochilas.length) {
    container.innerHTML = '<p class="text-muted">No hay mochilas registradas.</p>';
    return;
  }
  container.innerHTML = `
    <h6 class="fw-bold mb-2">Mochilas Registradas</h6>
    <table class="table table-sm table-bordered">
      <thead class="table-light">
        <tr><th>ID</th><th>Sitio</th><th>Código</th><th>Nombre</th><th>Capacidad (L)</th><th>Tipo</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>
        ${window.fuelMochilas.map(t => `
          <tr class="${t.is_active ? '' : 'table-secondary text-muted'}">
            <td>${t.id}</td>
            <td>${t.site}</td>
            <td>${t.tank_code}</td>
            <td>${t.name}</td>
            <td>${Number(t.capacity_liters).toLocaleString()}</td>
            <td>${t.fuel_type || 'Diesel'}</td>
            <td><span class="badge ${t.is_active ? 'bg-success' : 'bg-secondary'}">${t.is_active ? 'Activa' : 'Inactiva'}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-${t.is_active ? 'danger' : 'success'}"
                onclick="toggleMochilaActive(${t.id}, ${t.is_active ? 0 : 1})">
                ${t.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function toggleMochilaActive(id, newActive) {
  try {
    await window.RECON_API.updateFuelTank(id, { is_active: newActive });
    const res = await window.RECON_API.getFuelTanks();
    window.fuelMochilas = ((res && res.data) ? res.data : (Array.isArray(res) ? res : []));
    renderAdminMochilasList();
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}

async function submitNewMochila() {
  const site = ccEl('new_mochila_site')?.value;
  const tank_code = (ccEl('new_mochila_code')?.value || '').trim();
  const name = (ccEl('new_mochila_name')?.value || '').trim();
  const capacity_liters = ccEl('new_mochila_cap')?.value;
  const fuel_type = ccEl('new_mochila_fuel')?.value || 'Diesel';

  if (!site || !tank_code || !name) {
    Swal.fire('Error', 'Sitio, Código y Nombre son requeridos.', 'error');
    return;
  }

  try {
    await window.RECON_API.createFuelTank({ site, tank_code, name, capacity_liters, fuel_type });

    // Clear fields
    if (ccEl('new_mochila_code')) ccEl('new_mochila_code').value = '';
    if (ccEl('new_mochila_name')) ccEl('new_mochila_name').value = '';
    if (ccEl('new_mochila_cap')) ccEl('new_mochila_cap').value = '';

    // Refresh list
    const res = await window.RECON_API.getFuelTanks();
    window.fuelMochilas = ((res && res.data) ? res.data : (Array.isArray(res) ? res : []));
    renderAdminMochilasList();

    // Refresh selectors in main view
    populateMochilaSelector();
    populateEntryTankSelector();

    Swal.fire('¡Registrado!', 'Mochila creada exitosamente.', 'success');
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}

// ============================================================
// PEOPLE AUTOCOMPLETE
// ============================================================

function populatePeopleDropdown() {} // people handled via autocomplete

function getFuelPersonMatches(query) {
  const normalized = normalizeText(query).trim();
  if (normalized.length < 2) return [];
  const searchWords = normalized.split(/\s+/);
  return (window.fuelDropdownCache.people || []).filter(p => {
    const name = normalizeText(p.name);
    const id = normalizeText(p.id);
    const rut = normalizeText(p.rut);
    const nameMatch = searchWords.every(word => name.includes(word));
    return id.includes(normalized) || rut.includes(normalized) || nameMatch;
  }).slice(0, 50);
}

function updateFuelPersonSuggestions() {
  const query = ccEl('fuel_nombre_input')?.value || '';
  const resultsElement = ccEl('fuel_nombre_results');
  const matches = getFuelPersonMatches(query);
  if (!resultsElement) return;
  window.fuelPersonSuggestionIndex = -1;
  if (query.trim().length < 2) {
    resultsElement.style.display = 'none';
    resultsElement.innerHTML = '';
    return;
  }
  resultsElement.innerHTML = matches.map((person, index) => {
    return `<button type="button" data-index="${index}" class="list-group-item list-group-item-action" onclick="selectFuelPerson('${String(person.id).replace(/'/g, "\\'")}', '${String(person.name).replace(/'/g, "\\'")}')">${person.id} | ${person.name}</button>`;
  }).join('');
  resultsElement.style.display = matches.length > 0 ? 'block' : 'none';
}

function handleFuelPersonKeyDown(event) {
  const resultsElement = ccEl('fuel_nombre_results');
  if (!resultsElement || resultsElement.style.display === 'none') return;
  const items = Array.from(resultsElement.querySelectorAll('.list-group-item'));
  if (!items.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const current = typeof window.fuelPersonSuggestionIndex === 'number' ? window.fuelPersonSuggestionIndex : -1;
    const nextIndex = event.key === 'ArrowDown' ? Math.min(current + 1, items.length - 1) : Math.max(current - 1, 0);
    window.fuelPersonSuggestionIndex = nextIndex;
    highlightFuelPersonSuggestion(nextIndex);
  } else if (event.key === 'Enter') {
    const selectedIndex = window.fuelPersonSuggestionIndex >= 0 ? window.fuelPersonSuggestionIndex : 0;
    const selected = items[selectedIndex];
    if (selected) { event.preventDefault(); selected.click(); }
  } else if (event.key === 'Escape') {
    hideFuelPersonSuggestions();
  }
}

function highlightFuelPersonSuggestion(index) {
  const resultsElement = ccEl('fuel_nombre_results');
  if (!resultsElement) return;
  Array.from(resultsElement.querySelectorAll('.list-group-item')).forEach((item, idx) => {
    if (idx === index) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }
    else item.classList.remove('active');
  });
}

function selectFuelPerson(id, name) {
  const input = ccEl('fuel_nombre_input');
  const resultsElement = ccEl('fuel_nombre_results');
  if (input) input.value = `${id} | ${name}`;
  if (resultsElement) { resultsElement.style.display = 'none'; resultsElement.innerHTML = ''; }
}

function hideFuelPersonSuggestions() {
  const resultsElement = ccEl('fuel_nombre_results');
  if (resultsElement) { resultsElement.style.display = 'none'; resultsElement.innerHTML = ''; }
}

function resolveFuelPerson(value) {
  const people = window.fuelDropdownCache.people || [];
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const byId = people.find(p => String(p.id).toLowerCase() === normalized.toLowerCase());
  if (byId) return byId;
  const byNameExact = people.find(p => String(p.name).toLowerCase() === normalized.toLowerCase());
  if (byNameExact) return byNameExact;
  const byCombined = people.find(p => `${p.id} | ${p.name}`.toLowerCase() === normalized.toLowerCase());
  if (byCombined) return byCombined;
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ============================================================
// EXPORT FUNCTIONS
// ============================================================

function getFilteredTableData() {
  const tbody = document.querySelector('#fuel_table tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  return rows.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText));
}

function exportToExcel() {
  const data = getFilteredTableData();
  const headers = ['Fecha', 'Proyecto', 'Tipo', 'ID/Patente', 'Litros', 'KM', 'Nombre', 'Usuario', 'Mochila'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  XLSX.utils.book_append_sheet(wb, ws, 'Combustible');
  XLSX.writeFile(wb, 'Reporte_Combustible.xlsx');
}

function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const data = getFilteredTableData();
  doc.text('Reporte de Combustible', 14, 15);
  doc.autoTable({
    head: [['Fecha', 'Proyecto', 'Tipo', 'ID', 'Litros', 'KM', 'Nombre', 'Usuario', 'Mochila']],
    body: data,
    startY: 20
  });
  doc.save('Reporte_Combustible.pdf');
}

function exportToCSV() {
  const data = getFilteredTableData();
  const headers = ['Fecha', 'Proyecto', 'Tipo', 'ID/Patente', 'Litros', 'KM', 'Nombre', 'Usuario', 'Mochila'];
  let csvContent = headers.join(',') + '\n';
  data.forEach(row => { csvContent += row.map(field => `"${field}"`).join(',') + '\n'; });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'Reporte_Combustible.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyToClipboard() {
  const data = getFilteredTableData();
  const headers = ['Fecha', 'Proyecto', 'Tipo', 'ID/Patente', 'Litros', 'KM', 'Nombre', 'Usuario', 'Mochila'];
  let tsvContent = headers.join('\t') + '\n';
  data.forEach(row => { tsvContent += row.join('\t') + '\n'; });
  navigator.clipboard.writeText(tsvContent)
    .then(() => Swal.fire('Copiado!', 'Datos copiados al portapapeles', 'success'))
    .catch(() => Swal.fire('Error', 'No se pudo copiar al portapapeles', 'error'));
}
