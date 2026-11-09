window.fuelPurchaseHistory = [];

// Cache for dropdown data
window.fuelDropdownCache = {
  sites: [],
  movementVal: { Vehiculo: [], Generador: [], Maquina: [] },
  people: []
};

window.initControlCombustible = async function () {
  try {
    const [sitesRes, movementValRes, peopleRes] = await Promise.all([
      window.RECON_API.getSites(),
      window.RECON_API.getMovementValidation(),
      window.RECON_API.getPeople()
    ]);

    window.fuelDropdownCache.sites = (sitesRes.data || []).map(s => s.name).filter(Boolean);

    if (movementValRes) {
      window.fuelDropdownCache.movementVal.Vehiculo = movementValRes.Vehiculo || [];
      window.fuelDropdownCache.movementVal.Generador = movementValRes.Generador || [];
      window.fuelDropdownCache.movementVal.Maquina = movementValRes.Maquina || [];
    }

    window.fuelDropdownCache.people = (peopleRes || []).filter(p => p.active === true);

    populateProyectoDropdown();
    populateAssetTypeDropdown();
    updateAssetDropdown();

    populatePeopleDropdown();

    refreshFuelHistory();
    refreshBalance();
    loadFuelPurchaseData();

    setupModalListeners();

    document.getElementById('fuel_proyecto')?.focus();

  } catch (err) {
    console.error('Error initializing Control Combustible:', err);
    Swal.fire('Error', 'Failed to initialize: ' + err.message, 'error');
  }
};

function populateProyectoDropdown() {
  const select = document.getElementById('fuel_proyecto');
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
  const select = document.getElementById('fuel_asset_type');
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
  const type = document.getElementById('fuel_asset_type')?.value;
  const assetSelect = document.getElementById('fuel_asset_id');
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

async function validateOdometer(assetId, tipoActivo, km) {
  if (!assetId || !km || !tipoActivo) return { valid: true };
  try {
    console.log('validateOdometer: checking assetId:', assetId, 'km:', km);
    const res = await window.RECON_API.getLastFuelEntry(assetId);
    console.log('validateOdometer response:', res);
    const lastKmVal = (res && res.data && res.data.lastKm !== undefined) ? res.data.lastKm : (res && res.lastKm !== undefined ? res.lastKm : null);
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

function populatePeopleDropdown() {
}

function setupModalListeners() {
  const fuelReceptionModal = document.getElementById('modalFuelReception');
  if (fuelReceptionModal && !fuelReceptionModal.dataset.historyListener) {
    fuelReceptionModal.addEventListener('shown.bs.modal', function () {
      loadFuelPurchaseHistory();
    });
    document.getElementById('fuel_purchase_date_from')?.addEventListener('change', loadFuelPurchaseHistory);
    document.getElementById('fuel_purchase_date_to')?.addEventListener('change', loadFuelPurchaseHistory);
    document.getElementById('fuel_purchase_supplier')?.addEventListener('change', loadFuelPurchaseHistory);
    document.getElementById('fuel_purchase_invoice')?.addEventListener('input', loadFuelPurchaseHistory);
    fuelReceptionModal.dataset.historyListener = "true";
  }
}

async function saveFuelEntry(btnElement) {
  console.log('=== saveFuelEntry START ===');
  const user = JSON.parse(localStorage.getItem("recon_user_secure"));
  console.log('User:', user);

  // Get values
  const proyecto = document.getElementById('fuel_proyecto')?.value;
  const tipoActivo = document.getElementById('fuel_asset_type')?.value;
  const assetId = document.getElementById('fuel_asset_id')?.value;
  const litros = document.getElementById('fuel_litros')?.value;
  const km = document.getElementById('fuel_km')?.value;
  const nombreInput = document.getElementById('fuel_nombre_input')?.value.trim();

  console.log('Form values:', { proyecto, tipoActivo, assetId, litros, km, nombreInput });

  // Basic validation
  if (!proyecto || !tipoActivo || !assetId || !nombreInput) {
    console.log('Validation failed: missing fields');
    Swal.fire('Error', 'Por favor complete todos los campos (incluyendo el nombre)', 'error');
    return;
  }

  // Validate odometer/horometer
  console.log('Calling validateOdometer...');
  const odometerValidation = await validateOdometer(assetId, tipoActivo, km);
  console.log('validateOdometer result:', odometerValidation);
  if (!odometerValidation.valid) {
    Swal.fire('Validación Fallida', odometerValidation.message, 'error');
    return;
  }

  console.log('Resolving person...');
  const person = resolveFuelPerson(nombreInput);
  console.log('Resolved person:', person);
  if (!person) {
    Swal.fire('Persona No Encontrada', 'No se encontró la persona con ese nombre o ID.', 'error');
    return;
  }

  // Prepare data BEFORE confirmation dialog
  const data = {
    proyecto: proyecto,
    tipoActivo: tipoActivo,
    assetId: assetId,
    cantidadLitro: litros,
    kilometraje: km,
    nombre: person.name,
    personId: person.id,
    userEmail: user ? user.email : 'n/a'
  };

  console.log('Data to save:', data);

  // Confirmation before execution
  const assetLabel = { 'Vehiculo': 'vehículo', 'Generador': 'generador', 'Maquina': 'maquinaria' }[tipoActivo] || 'activo';
  const odometerLabel = tipoActivo === 'Generador' ? 'Horómetro' : 'Kilometraje';

  Swal.fire({
    title: 'Confirmar Registro',
    html: `
      <div class="text-start">
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
    console.log('Swal confirmed:', confirmed.isConfirmed);
    if (!confirmed.isConfirmed) {
      return;
    }

    executeSaveFuelEntry(data, btnElement);
  });
}

function executeSaveFuelEntry(data, btnElement) {
  const btn = btnElement || document.getElementById('btn_save_fuel_entry');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Guardando...';
  }

  window.RECON_API.saveFuelEntry(data)
    .then(res => {
      console.log('saveFuelEntry response:', res);
      if (res && (res.status === 'success' || res.success === true)) {
        Swal.fire('¡Guardado!', 'Registro exitoso', 'success');

        // Clear the form
        document.getElementById('fuel_litros').value = '';
        document.getElementById('fuel_km').value = '';
        document.getElementById('fuel_nombre_input').value = '';

        refreshFuelHistory();
        refreshBalance();
      } else {
        throw new Error((res && (res.message || res.error)) || 'Error al guardar');
      }
    })
    .catch(err => {
      console.error('saveFuelEntry error:', err);
      // Show more detailed error
      const msg = err.message || (err.response && err.response.data && err.response.data.message) || 'Ocurrió un error al guardar.';
      Swal.fire('Error', msg, 'error');
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Guardar Registro';
      }
    });
}

// ============================================================
// FUEL HISTORY FUNCTIONS (Updated for API)
// ============================================================

window.fuelHistoryCache = [];
window.fuelPeopleCache = [];

function parseFuelDate(str) {
  if (!str) return new Date(0);
  const s = String(str).trim();
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dm) {
    return new Date(parseInt(dm[3], 10), parseInt(dm[2], 10) - 1, parseInt(dm[1], 10), parseInt(dm[4] || 0, 10), parseInt(dm[5] || 0, 10), parseInt(dm[6] || 0, 10));
  }
  const ym = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ym) {
    return new Date(parseInt(ym[1], 10), parseInt(ym[2], 10) - 1, parseInt(ym[3], 10), parseInt(ym[4] || 0, 10), parseInt(ym[5] || 0, 10), parseInt(ym[6] || 0, 10));
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
    const [peopleRes, historyRes] = await Promise.all([
      window.RECON_API.getPeople(),
      window.RECON_API.getFuelHistory()
    ]);
    const people = (peopleRes || []).filter(p => p.active === true);
    window.fuelPeopleCache = people;
    const data = historyRes || [];

    // Save to cache sorted newest first
    window.fuelHistoryCache = data.sort((a, b) => parseFuelDate(b[0]).getTime() - parseFuelDate(a[0]).getTime());

    // Populate people filter dropdown
    const select = document.getElementById('f_person');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = '<option value="">Todas</option>' +
        people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      if (currentVal) select.value = currentVal;
    }

    applyFilters();
  } catch (err) {
    console.error('Error refreshing fuel history:', err);
    Swal.fire('Error', 'Failed to load fuel history: ' + err.message, 'error');
  }
};

function refreshBalance() {
  window.RECON_API.getFuelBalance()
    .then(res => {
      const el = document.getElementById('fuel_balance_display');
      if (el && res && res.balance !== undefined) {
        el.innerText = res.balance.toFixed(2) + ' L';
      }
    })
    .catch(err => console.error('Error refreshing balance:', err));
}

function setLastWeekDefaults() {
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);

  const formatDate = (d) => d.toISOString().split('T')[0];

  const fromEl = document.getElementById('f_date_from');
  const toEl = document.getElementById('f_date_to');
  if (fromEl) fromEl.value = formatDate(lastWeek);
  if (toEl) toEl.value = formatDate(today);
  applyFilters();
}

function renderTable(data, people) {
  const tbody = document.querySelector('#fuel_table tbody');
  if (!tbody) return;
  const pList = people || window.fuelPeopleCache || [];
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay registros que coincidan con los filtros</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const personMatch = pList.find(p => String(p.id) === String(r[6]) || String(p.name).toLowerCase() === String(r[6]).toLowerCase());
    const displayName = personMatch ? personMatch.name : (r[6] || '');
    const dateFormatted = formatFuelDate(r[0]);
    return `<tr>
      <td>${dateFormatted}</td>
      <td>${r[1] || ''}</td>
      <td>${r[2] || ''}</td>
      <td>${r[3] || ''}</td>
      <td>${r[4] !== undefined && r[4] !== null ? r[4] : ''}</td>
      <td>${r[5] !== undefined && r[5] !== null ? r[5] : ''}</td>
      <td>${displayName}</td>
      <td>${r[7] || ''}</td>
    </tr>`;
  }).join('');
}

function applyFilters() {
  const dateFrom = document.getElementById('f_date_from')?.value || '';
  const dateTo = document.getElementById('f_date_to')?.value || '';
  const project = (document.getElementById('f_project')?.value || '').trim().toLowerCase();
  const patente = (document.getElementById('f_patente')?.value || '').trim().toLowerCase();
  const person = (document.getElementById('f_person')?.value || '').trim();

  const people = window.fuelPeopleCache || [];
  const selectedPerson = person ? people.find(p => String(p.id) === String(person)) : null;

  const filtered = (window.fuelHistoryCache || []).filter(r => {
    let matchDate = true;
    if (dateFrom || dateTo) {
      const d = parseFuelDate(r[0]);
      if (d && !isNaN(d.getTime()) && d.getTime() !== 0) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const rowDate = `${y}-${m}-${day}`;
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

  renderTable(filtered, people);
}

function clearFilters() {
  const fromEl = document.getElementById('f_date_from');
  const toEl = document.getElementById('f_date_to');
  const projEl = document.getElementById('f_project');
  const patEl = document.getElementById('f_patente');
  const persEl = document.getElementById('f_person');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  if (projEl) projEl.value = '';
  if (patEl) patEl.value = '';
  if (persEl) persEl.value = '';
  applyFilters();
}

// ============================================================
// FUEL PURCHASE HISTORY (Reception Modal)
// ============================================================

window.fuelPurchaseHistory = [];

function loadFuelPurchaseData() {
  window.RECON_API.getFuelPurchaseHistory()
    .then(data => {
      window.fuelPurchaseHistory = data || [];
      console.log("Data from getFuelPurchaseHistory", data);
      populateSupplierFilter(data);
      loadFuelPurchaseHistory();
      console.log("fuel purchase history retrieved successfully");
    })
    .catch(err => {
      console.error("Error loading fuel purchase history:", err);
    });
}

function loadFuelPurchaseHistory() {
  const dateFrom = document.getElementById('fuel_purchase_date_from')?.value || '';
  const dateTo = document.getElementById('fuel_purchase_date_to')?.value || '';
  const supplier = document.getElementById('fuel_purchase_supplier')?.value || '';
  const invoice = document.getElementById('fuel_purchase_invoice')?.value.trim().toLowerCase() || '';
  const tbody = document.getElementById('fuel_purchase_history_body');
  if (!tbody) return;

  let data = window.fuelPurchaseHistory || [];

  data = data.filter(row => {
    // Date
    if (dateFrom || dateTo) {
      const rowDate = new Date(row.fechaISO);
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        if (rowDate < fromDate) return false;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        if (rowDate > toDate) return false;
      }
    }
    // Supplier
    if (supplier && row.proveedor !== supplier) return false;
    // Invoice
    if (invoice && !(row.factura || '').toLowerCase().includes(invoice)) return false;
    return true;
  });

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted" data-i18n="no_records">
          No hay registros
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${row.fecha || ''}</td>
      <td>${row.proveedor || ''}</td>
      <td>${row.litros || ''}</td>
      <td>${row.factura || ''}</td>
      <td>${row.usuario || ''}</td>
    </tr>
  `).join('');
}

function populateSupplierFilter(data) {
  const supplierSelect = document.getElementById('fuel_purchase_supplier');
  if (!supplierSelect) return;

  const suppliers = [
    ...new Set(
      data
        .map(row => row.proveedor)
        .filter(s => s && s.trim() !== '')
    )
  ];

  supplierSelect.innerHTML = `
    <option value="">Todos</option>
  `;

  suppliers.sort().forEach(proveedor => {
    supplierSelect.innerHTML += `
      <option value="${proveedor}">
        ${proveedor}
      </option>
    `;
  });
}

// ============================================================
// PEOPLE AUTOCOMPLETE
// ============================================================

function populatePeopleDropdown() {
  // People are already cached in fuelDropdownCache.people from init
  // The suggestions are handled by updateFuelPersonSuggestions()
}

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
  const query = document.getElementById('fuel_nombre_input')?.value || '';
  const resultsElement = document.getElementById('fuel_nombre_results');
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
  if (matches.length > 0) {
    resultsElement.style.display = 'block';
  } else {
    resultsElement.style.display = 'none';
  }
}

function handleFuelPersonKeyDown(event) {
  const resultsElement = document.getElementById('fuel_nombre_results');
  if (!resultsElement || resultsElement.style.display === 'none') return;
  const items = Array.from(resultsElement.querySelectorAll('.list-group-item'));
  if (!items.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const current = typeof window.fuelPersonSuggestionIndex === 'number' ? window.fuelPersonSuggestionIndex : -1;
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(current + 1, items.length - 1)
      : Math.max(current - 1, 0);
    window.fuelPersonSuggestionIndex = nextIndex;
    highlightFuelPersonSuggestion(nextIndex);
  } else if (event.key === 'Enter') {
    const selectedIndex = window.fuelPersonSuggestionIndex >= 0 ? window.fuelPersonSuggestionIndex : 0;
    const selected = items[selectedIndex];
    if (selected) {
      event.preventDefault();
      selected.click();
    }
  } else if (event.key === 'Escape') {
    hideFuelPersonSuggestions();
  }
}

function highlightFuelPersonSuggestion(index) {
  const resultsElement = document.getElementById('fuel_nombre_results');
  if (!resultsElement) return;
  const items = Array.from(resultsElement.querySelectorAll('.list-group-item'));
  items.forEach((item, idx) => {
    if (idx === index) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function selectFuelPerson(id, name) {
  const input = document.getElementById('fuel_nombre_input');
  const resultsElement = document.getElementById('fuel_nombre_results');
  if (input) {
    input.value = `${id} | ${name}`;
  }
  if (resultsElement) {
    resultsElement.style.display = 'none';
    resultsElement.innerHTML = '';
  }
}

function hideFuelPersonSuggestions() {
  const resultsElement = document.getElementById('fuel_nombre_results');
  if (resultsElement) {
    resultsElement.style.display = 'none';
    resultsElement.innerHTML = '';
  }
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
    .normalize("NFD")
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
  const headers = ["Fecha", "Proyecto", "Tipo", "ID/Patente", "Litros", "KM", "Nombre", "Usuario"];
  const worksheetData = [headers, ...data];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(worksheetData);
  XLSX.utils.book_append_sheet(wb, ws, "Combustible");
  XLSX.writeFile(wb, "Reporte_Combustible.xlsx");
}

function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const data = getFilteredTableData();
  doc.text("Reporte de Combustible", 14, 15);
  doc.autoTable({
    head: [["Fecha", "Proyecto", "Tipo", "ID", "Litros", "KM", "Nombre", "Usuario"]],
    body: data,
    startY: 20
  });
  doc.save("Reporte_Combustible.pdf");
}

function exportToCSV() {
  const data = getFilteredTableData();
  const headers = ["Fecha", "Proyecto", "Tipo", "ID/Patente", "Litros", "KM", "Nombre", "Usuario"];
  let csvContent = headers.join(",") + "\n";
  data.forEach(row => {
    const escapedRow = row.map(field => `"${field}"`).join(",");
    csvContent += escapedRow + "\n";
  });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Reporte_Combustible_Rapido.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyToClipboard() {
  const data = getFilteredTableData();
  const headers = ["Fecha", "Proyecto", "Tipo", "ID/Patente", "Litros", "KM", "Nombre", "Usuario"];
  let tsvContent = headers.join("\t") + "\n";
  data.forEach(row => {
    tsvContent += row.join("\t") + "\n";
  });
  navigator.clipboard.writeText(tsvContent).then(() => {
    Swal.fire("Copiado!", "Datos copiados al portapapeles", "success");
  }).catch(() => {
    Swal.fire("Error", "No se pudo copiar al portapapeles", "error");
  });
}

// ============================================================
// FUEL PURCHASE SAVE (Reception Modal)
// ============================================================

function saveFuelPurchase(btnElement) {
  const proveedor = document.getElementById('rec_proveedor')?.value?.trim();
  const litros = document.getElementById('rec_litros')?.value?.trim();
  const factura = document.getElementById('rec_factura')?.value?.trim();

  if (!proveedor || !litros) {
    Swal.fire('Error', 'Por favor ingrese al menos Proveedor y Litros.', 'error');
    return;
  }

  const data = {
    proveedor: proveedor,
    litros: litros,
    factura: factura,
    userName: window.currentUser ? window.currentUser.name : "Unknown"
  };

  const btn = btnElement || document.getElementById('btn_save_fuel_purchase');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Guardando...';
  }

  window.RECON_API.saveFuelPurchase(data)
    .then(res => {
      const modalEl = document.getElementById('modalFuelReception');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
      if (document.getElementById('rec_proveedor')) document.getElementById('rec_proveedor').value = '';
      if (document.getElementById('rec_litros')) document.getElementById('rec_litros').value = '';
      if (document.getElementById('rec_factura')) document.getElementById('rec_factura').value = '';
      Swal.fire('Éxito', 'Compra de combustible registrada', 'success');
      if (typeof window.refreshBalance === "function") {
        window.refreshBalance();
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Guardar Recepción';
      }
      loadFuelPurchaseData();
    })
    .catch(err => {
      Swal.fire('Error', err.message || 'No se pudo guardar la compra.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Guardar Recepción';
      }
    });
}