// ============================================================
// VEHICLE TRACKING MODULE
// GPS voyage tracking with Wake Lock, Leaflet map, expenses
// ============================================================

(function () {
  'use strict';

  // ── State ──
  window.vehicleTracking = {
    activeVoyage: null,
    watchId: null,
    wakeLock: null,
    map: null,
    marker: null,
    polyline: null,
    routeLine: null,
    startMarker: null,
    endMarker: null,
    elapsedTimer: null,
    startTime: null,
    mapInitialized: false,
    isTracking: false,
    sitesCache: [],
    detailMap: null
  };

  function createColorPin(color, iconClass) {
    return L.divIcon({
      className: 'custom-map-pin',
      html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.35);"><i class="bi ${iconClass}" style="font-size: 15px;"></i></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -18]
    });
  }

  // ── Init ──
  window.initVehicleTrackingModule = async function () {
    console.log('[VehicleTracking] Initializing module...');
    showVtStatus(getI18nText('vt_loading'));

    try {
      await Promise.all([
        loadSites(),
        loadVehicles(),
        loadPeople(),
        loadActiveVoyage(),
        loadVoyageHistory()
      ]);

      // Apply translations after DOM is ready
      if (typeof updateUI === 'function') updateUI();

      if (window.vehicleTracking.activeVoyage) {
        showActiveVoyage(window.vehicleTracking.activeVoyage);
        await resumeGpsTracking();
      } else {
        showStartForm();
      }

      showVtStatus('');
    } catch (err) {
      console.error('[VehicleTracking] Init error:', err);
      showVtStatus(getI18nText('vt_error_loading'), 'danger');
    }
  };

  // ── Data Loading ──
  async function loadSites() {
    try {
      const res = await RECON_API.getSites();
      const sites = Array.isArray(res) ? res : (res && res.data ? res.data : []);
      window.vehicleTracking.sitesCache = sites;
      const fromSel = document.getElementById('vtFromSite');
      const toSel = document.getElementById('vtToSite');
      if (fromSel) fromSel.innerHTML = '<option value="">' + getI18nText('vt_select_site') + '</option>' +
        sites.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
      if (toSel) toSel.innerHTML = '<option value="">' + getI18nText('vt_select_site') + '</option>' +
        sites.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    } catch (err) {
      console.error('[VehicleTracking] Load sites error:', err);
    }
  }

  async function loadVehicles() {
    try {
      let res = await RECON_API.getVehicles();
      let vehicles = Array.isArray(res) ? res : (res && res.data ? res.data : []);

      // Fallback: if vehicles table returned nothing or failed, try movement validation
      if (!vehicles.length && typeof RECON_API.getMovementValidation === 'function') {
        try {
          const mvRes = await RECON_API.getMovementValidation();
          const mvVehicles = (mvRes && mvRes.Vehiculo) || [];
          vehicles = mvVehicles.map((v, idx) => ({ id: idx + 1, vehicle_number: v, vehicle_type: '' }));
        } catch (e) {
          console.warn('[VehicleTracking] Movement validation fallback error:', e);
        }
      }

      const sel = document.getElementById('vtVehicle');
      if (sel) {
        sel.innerHTML = '<option value="">' + getI18nText('vt_select_vehicle') + '</option>' +
          vehicles.map(v => {
            const typeStr = v.vehicle_type ? ` (${v.vehicle_type})` : '';
            return `<option value="${v.id}">${v.vehicle_number}${typeStr}</option>`;
          }).join('');
      }
    } catch (err) {
      console.error('[VehicleTracking] Load vehicles error:', err);
    }
  }

  async function loadPeople() {
    try {
      const res = await RECON_API.getPeople();
      const people = Array.isArray(res) ? res : (res && res.data ? res.data : []);
      const sel = document.getElementById('vtDriver');
      if (sel) {
        // Filter to active people with a valid non-empty name
        const activePeople = people.filter(p =>
          (p.active === true || p.active === 'TRUE' || p.active === 1 || p.active === undefined) &&
          (p.name && String(p.name).trim().length > 0)
        );
        // Sort alphabetically by name
        activePeople.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        sel.innerHTML = '<option value="">' + getI18nText('vt_select_driver') + '</option>' +
          activePeople.map(p => {
            const displayName = p.rut ? `${p.name} (${p.rut})` : p.name;
            const val = p.id || p.userId || p.name;
            return `<option value="${val}">${displayName}</option>`;
          }).join('');
      }
    } catch (err) {
      console.error('[VehicleTracking] Load people error:', err);
    }
  }

  async function loadActiveVoyage() {
    try {
      const res = await RECON_API.getVoyages();
      const voyages = Array.isArray(res) ? res : (res && res.data ? res.data : []);
      const user = JSON.parse(localStorage.getItem('recon_user_secure') || '{}');
      const uId = String(user.userId || user.user_id || user.id || '');
      const uName = String(user.name || '');

      const active = voyages.find(v =>
        v.status === 'IN_PROGRESS' &&
        (String(v.driver_id) === uId || String(v.driver_id) === uName || !uId)
      );
      if (active) {
        window.vehicleTracking.activeVoyage = active;
        const detail = await RECON_API.getVoyage(active.id);
        if (detail.data) window.vehicleTracking.activeVoyage = detail.data;
      }
    } catch (err) {
      console.error('[VehicleTracking] Load active voyage error:', err);
    }
  }

  async function loadVoyageHistory() {
    try {
      const res = await RECON_API.getVoyages();
      const voyages = Array.isArray(res) ? res : (res && res.data ? res.data : []);
      const container = document.getElementById('vtHistoryList');
      if (!container) return;

      // Show recent voyages (completed or others)
      const list = voyages.slice(0, 15);

      if (list.length === 0) {
        container.innerHTML = '<div class="col-12"><p class="text-muted small text-center py-4">' + getI18nText('vt_no_voyages') + '</p></div>';
        return;
      }

      container.innerHTML = list.map(v => {
        let statusBadge = '<span class="badge" style="background-color: #fd7e14; color: #fff;">Finished</span>';
        if (v.status === 'IN_PROGRESS') {
          statusBadge = '<span class="badge bg-success">Running</span>';
        } else if (v.status === 'DELETED' || v.status === 'CANCELLED') {
          statusBadge = '<span class="badge bg-danger">Deleted</span>';
        }

        return `
        <div class="col-md-6 col-lg-4">
          <div class="card border shadow-sm h-100">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <span class="fw-bold text-primary">${v.voyage_number}</span>
                ${statusBadge}
              </div>
              <h6 class="card-title fw-bold text-dark">${v.from_site || '—'} → ${v.to_site || '—'}</h6>
              <p class="small text-muted mb-3">
                <i class="bi bi-calendar3 me-1"></i> ${new Date(v.start_time).toLocaleDateString()}<br>
                <i class="bi bi-truck me-1"></i> ${v.vehicle_number || getI18nText('vt_na')}<br>
                <i class="bi bi-speedometer2 me-1"></i> ${v.start_km || 0} → ${v.end_km !== null && v.end_km !== undefined ? v.end_km : '—'} KM<br>
                <i class="bi bi-cash me-1"></i> $${Number(v.total_expenses || 0).toFixed(2)}
              </p>
              <button class="btn btn-outline-primary btn-sm w-100"
                onclick="window.vehicleTrackingViewVoyage(${v.id})">
                <i class="bi bi-eye me-1"></i> ${getI18nText('vt_view_details') || 'View Details'}
              </button>
            </div>
          </div>
        </div>
      `;}).join('');
    } catch (err) {
      console.error('[VehicleTracking] Load history error:', err);
    }
  }

  // ── UI State ──
  function showStartForm() {
    document.getElementById('vtStartForm').classList.remove('d-none');
    document.getElementById('vtActiveVoyage').classList.add('d-none');
    document.getElementById('vtHistorySection').classList.remove('d-none');
    window.vehicleTracking.isTracking = false;
    stopGpsTracking();
  }

  function showActiveVoyage(voyage) {
    document.getElementById('vtStartForm').classList.add('d-none');
    document.getElementById('vtActiveVoyage').classList.remove('d-none');
    document.getElementById('vtHistorySection').classList.add('d-none');

    document.getElementById('vtVoyageNumber').textContent = voyage.voyage_number;
    document.getElementById('vtVoyageRoute').textContent = `${voyage.from_site} → ${voyage.to_site}`;
    document.getElementById('vtKpiStartKm').textContent = voyage.start_km || 0;
    document.getElementById('vtKpiCurrentKm').textContent = voyage.start_km || 0;
    document.getElementById('vtKpiExpenses').textContent = `$${Number(voyage.total_expenses || 0).toFixed(2)}`;

    window.vehicleTracking.startTime = new Date(voyage.start_time).getTime();
    startElapsedTimer();

    loadVoyageExpenses(voyage.id);
    loadVoyageGpsPoints(voyage.id);
    initMap(voyage);

    window.vehicleTracking.isTracking = true;
  }

  function startElapsedTimer() {
    if (window.vehicleTracking.elapsedTimer) clearInterval(window.vehicleTracking.elapsedTimer);
    window.vehicleTracking.elapsedTimer = setInterval(() => {
      const now = Date.now();
      const diff = now - window.vehicleTracking.startTime;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const el = document.getElementById('vtKpiElapsed');
      if (el) el.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (window.vehicleTracking.elapsedTimer) {
      clearInterval(window.vehicleTracking.elapsedTimer);
      window.vehicleTracking.elapsedTimer = null;
    }
  }

  // ── Map (Leaflet) ──
  function initMap(voyage) {
    if (window.vehicleTracking.mapInitialized) return;

    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMapAfterLoad(voyage);
      document.head.appendChild(script);
      return;
    }
    initMapAfterLoad(voyage);
  }

  function initMapAfterLoad(voyage) {
    const mapEl = document.getElementById('vtMap');
    if (!mapEl || window.vehicleTracking.map) return;

    window.vehicleTracking.map = L.map('vtMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([-33.4489, -70.6693], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(window.vehicleTracking.map);

    window.vehicleTracking.startMarker = L.marker([-33.4489, -70.6693], {
      icon: L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-green.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        shadowSize: [41, 41]
      })
    }).addTo(window.vehicleTracking.map);
    window.vehicleTracking.startMarker.bindPopup('<b>' + getI18nText('vt_start') + '</b><br>' + voyage.from_site).openPopup();

    window.vehicleTracking.endMarker = L.marker([-33.4489, -70.6693], {
      icon: L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-red.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        shadowSize: [41, 41]
      })
    }).addTo(window.vehicleTracking.map);
    window.vehicleTracking.endMarker.bindPopup('<b>' + getI18nText('vt_destination') + '</b><br>' + voyage.to_site);

    window.vehicleTracking.marker = L.marker([-33.4489, -70.6693], {
      icon: L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-blue.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        shadowSize: [41, 41]
      })
    }).addTo(window.vehicleTracking.map);
    window.vehicleTracking.marker.bindPopup('<b>' + getI18nText('vt_vehicle_position') + '</b>');

    window.vehicleTracking.polyline = L.polyline([], { color: '#007bff', weight: 3 }).addTo(window.vehicleTracking.map);

    window.vehicleTracking.mapInitialized = true;
  }

  function updateMapPosition(lat, lng) {
    if (!window.vehicleTracking.map || !window.vehicleTracking.marker) return;

    window.vehicleTracking.marker.setLatLng([lat, lng]);

    if (window.vehicleTracking.polyline) {
      const latlngs = window.vehicleTracking.polyline.getLatLngs();
      latlngs.push([lat, lng]);
      window.vehicleTracking.polyline.setLatLngs(latlngs);
      window.vehicleTracking.map.fitBounds(window.vehicleTracking.polyline.getBounds(), { padding: [50, 50] });
    }
  }

  // ── GPS Tracking ──
  async function resumeGpsTracking() {
    try {
      if ('wakeLock' in navigator) {
        window.vehicleTracking.wakeLock = await navigator.wakeLock.request('screen');
        window.vehicleTracking.wakeLock.addEventListener('release', () => {
          window.vehicleTracking.wakeLock = null;
        });
      }
    } catch (e) {
      console.warn('[VehicleTracking] Wake Lock not available:', e.message);
    }

    if ('geolocation' in navigator) {
      window.vehicleTracking.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy, speed } = pos.coords;
          updateMapPosition(latitude, longitude);
          document.getElementById('vtGpsStatus').textContent =
            `Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}, Accuracy: ±${Math.round(accuracy)}m`;
          sendGpsPoint(window.vehicleTracking.activeVoyage.id, latitude, longitude, accuracy, speed);
        },
        (err) => {
          console.error('[VehicleTracking] GPS error:', err);
          document.getElementById('vtGpsStatus').textContent = getI18nText('vt_gps_error') + err.message;
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }
  }

  async function startGpsTracking() {
    await resumeGpsTracking();
  }

  function stopGpsTracking() {
    if (window.vehicleTracking.watchId) {
      navigator.geolocation.clearWatch(window.vehicleTracking.watchId);
      window.vehicleTracking.watchId = null;
    }
    if (window.vehicleTracking.wakeLock) {
      window.vehicleTracking.wakeLock.release().then(() => { window.vehicleTracking.wakeLock = null; });
    }
    stopElapsedTimer();
    window.vehicleTracking.isTracking = false;
  }

  async function sendGpsPoint(voyageId, lat, lng, accuracy, speed) {
    try {
      await RECON_API._request('/voyages/' + voyageId + '/gps', 'POST', {
        latitude: lat,
        longitude: lng,
        accuracy: accuracy,
        speed: speed,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      // GPS points are best-effort; ignore errors
    }
  }

  async function refreshGps() {
    if (!window.vehicleTracking.activeVoyage) return;
    loadVoyageGpsPoints(window.vehicleTracking.activeVoyage.id);
  }

  async function loadVoyageGpsPoints(voyageId) {
    try {
      const res = await RECON_API._request('/voyages/' + voyageId + '/gps', 'GET');
      const points = res.data || [];
      if (points.length > 0) {
        const last = points[points.length - 1];
        updateMapPosition(last.latitude, last.longitude);
        document.getElementById('vtGpsStatus').textContent =
          getI18nText('vt_last_update') + ': ' + new Date(last.timestamp).toLocaleTimeString();
      }
    } catch (e) {
      console.error('[VehicleTracking] Load GPS error:', e);
    }
  }

  // ── Voyage Actions ──
  window.vehicleTrackingStartVoyage = async function (event) {
    event.preventDefault();

    const fromSite = document.getElementById('vtFromSite').value;
    const toSite = document.getElementById('vtToSite').value;
    const vehicleId = document.getElementById('vtVehicle').value;
    const driverId = document.getElementById('vtDriver') ? document.getElementById('vtDriver').value : '';
    const startKm = document.getElementById('vtStartKm').value;
    const reason = document.getElementById('vtReason').value;

    if (!fromSite || !toSite || !vehicleId || !startKm || !driverId) {
      showVtStatus(getI18nText('vt_fill_required'), 'warning');
      return;
    }

    const btn = document.getElementById('vtBtnStartVoyage');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> ' + getI18nText('vt_starting');

    try {
      const res = await RECON_API._request('/voyages', 'POST', {
        from_site: fromSite,
        to_site: toSite,
        vehicle_id: parseInt(vehicleId, 10),
        driver_id: driverId,
        start_km: parseInt(startKm, 10),
        reason: reason || ''
      });

      if (res.status === 'success') {
        const detail = await RECON_API.getVoyage(res.data.id);
        if (detail.data) {
          window.vehicleTracking.activeVoyage = detail.data;
          showActiveVoyage(detail.data);
          await startGpsTracking();
        }
      } else {
        showVtStatus(res.message || getI18nText('vt_start_failed'), 'danger');
      }
    } catch (err) {
      console.error('[VehicleTracking] Start voyage error:', err);
      showVtStatus(getI18nText('vt_start_failed_try_again'), 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  };

  window.vehicleTrackingEndVoyage = async function () {
    if (!window.vehicleTracking.activeVoyage) return;
    const voyage = window.vehicleTracking.activeVoyage;
    const startKm = Number(voyage.start_km) || 0;

    const titleText = getI18nText('vt_end_confirm_title') || 'End Voyage & Finalize';
    const finalKmLabel = getI18nText('vt_end_final_km') || 'Final Odometer (KM)';
    const totalExpLabel = getI18nText('vt_end_total_exp') || 'Total Expenses (optional)';
    const detailedExpLabel = getI18nText('vt_end_detailed_exp') || 'Add Detailed Expenses (optional)';
    const endVoyageBtn = getI18nText('vt_end_voyage') || 'End Voyage';
    const cancelBtn = getI18nText('btn_cancel') || 'Cancel';
    const addRowBtn = getI18nText('vt_add_row') || '+ Add Row';

    if (typeof Swal !== 'undefined') {
      const { value: formValues, isConfirmed } = await Swal.fire({
        title: titleText,
        html: `
          <div class="text-start mb-3">
            <label class="form-label fw-bold small text-dark">${finalKmLabel} <span class="text-danger">*</span></label>
            <input id="swal-end-km" class="swal2-input form-control form-control-sm m-0 w-100" type="number" min="${startKm}" value="${startKm}" placeholder="${startKm}">
          </div>
          <div class="text-start mb-3">
            <label class="form-label fw-bold small text-dark">${totalExpLabel}</label>
            <input id="swal-total-exp" class="swal2-input form-control form-control-sm m-0 w-100" type="number" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="text-start">
            <details>
              <summary class="fw-bold small text-primary mb-2" style="cursor: pointer;">${detailedExpLabel}</summary>
              <div id="swal-expense-rows">
                <div class="d-flex gap-1 mb-2 align-items-center">
                  <select class="form-select form-select-sm swal-exp-type" style="max-width: 110px;">
                    <option value="fuel">${getI18nText('vt_fuel') || 'Fuel'}</option>
                    <option value="food">${getI18nText('vt_food') || 'Food'}</option>
                    <option value="tag">${getI18nText('vt_tag') || 'Tag/Toll'}</option>
                    <option value="other">${getI18nText('vt_other') || 'Other'}</option>
                  </select>
                  <input class="form-control form-control-sm swal-exp-amount" type="number" placeholder="0.00" min="0" step="0.01" style="max-width: 100px;">
                  <input class="form-control form-control-sm swal-exp-desc" type="text" placeholder="${getI18nText('vt_description') || 'Note'}">
                </div>
              </div>
              <button type="button" id="swal-add-row-btn" class="btn btn-outline-secondary btn-sm mt-1">${addRowBtn}</button>
            </details>
          </div>
        `,
        didOpen: () => {
          const addBtn = document.getElementById('swal-add-row-btn');
          if (addBtn) {
            addBtn.addEventListener('click', () => {
              const container = document.getElementById('swal-expense-rows');
              if (!container) return;
              const row = document.createElement('div');
              row.className = 'd-flex gap-1 mb-2 align-items-center';
              row.innerHTML = `
                <select class="form-select form-select-sm swal-exp-type" style="max-width: 110px;">
                  <option value="fuel">${getI18nText('vt_fuel') || 'Fuel'}</option>
                  <option value="food">${getI18nText('vt_food') || 'Food'}</option>
                  <option value="tag">${getI18nText('vt_tag') || 'Tag/Toll'}</option>
                  <option value="other">${getI18nText('vt_other') || 'Other'}</option>
                </select>
                <input class="form-control form-control-sm swal-exp-amount" type="number" placeholder="0.00" min="0" step="0.01" style="max-width: 100px;">
                <input class="form-control form-control-sm swal-exp-desc" type="text" placeholder="${getI18nText('vt_description') || 'Note'}">
                <button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.parentElement.remove()">✕</button>
              `;
              container.appendChild(row);
            });
          }
        },
        showCancelButton: true,
        confirmButtonText: endVoyageBtn,
        cancelButtonText: cancelBtn,
        confirmButtonColor: '#dc3545',
        focusConfirm: false,
        preConfirm: () => {
          const kmInput = document.getElementById('swal-end-km');
          const kmVal = parseInt(kmInput ? kmInput.value : '', 10);
          if (isNaN(kmVal) || kmVal < startKm) {
            Swal.showValidationMessage(`${finalKmLabel} must be ≥ start KM (${startKm})`);
            return false;
          }
          const totalExpInput = document.getElementById('swal-total-exp');
          const totalExpVal = totalExpInput && totalExpInput.value ? parseFloat(totalExpInput.value) : 0;
          const expRows = [];
          document.querySelectorAll('#swal-expense-rows .d-flex').forEach(r => {
            const type = r.querySelector('.swal-exp-type')?.value;
            const amt = parseFloat(r.querySelector('.swal-exp-amount')?.value);
            const desc = r.querySelector('.swal-exp-desc')?.value || '';
            if (type && amt > 0) expRows.push({ expense_type: type, amount: amt, description: desc });
          });
          return { km: kmVal, totalExp: totalExpVal, expRows };
        }
      });

      if (!isConfirmed || !formValues) return;

      try {
        await RECON_API._request('/voyages/' + voyage.id, 'PUT', {
          end_km: formValues.km,
          end_time: new Date().toISOString(),
          total_expenses: formValues.totalExp > 0 ? formValues.totalExp : null,
          expenses: formValues.expRows,
          status: 'COMPLETED'
        });

        stopGpsTracking();
        await Swal.fire({
          icon: 'success',
          title: getI18nText('vt_voyage_completed') || 'Voyage Completed!',
          timer: 2000,
          showConfirmButton: false
        });
        window.vehicleTracking.activeVoyage = null;
        showStartForm();
        loadVoyageHistory();
      } catch (err) {
        console.error('[VehicleTracking] End voyage error:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: getI18nText('vt_end_failed') || 'Failed to end voyage.' });
      }
    } else {
      // Fallback if Swal is not loaded
      if (!confirm(getI18nText('vt_end_confirm'))) return;
      const endKm = prompt(getI18nText('vt_end_km_prompt'), startKm);
      if (endKm === null) return;
      const endKmNum = parseInt(endKm, 10);
      if (isNaN(endKmNum) || endKmNum < startKm) {
        showVtStatus(getI18nText('vt_invalid_km'), 'warning');
        return;
      }
      try {
        await RECON_API._request('/voyages/' + voyage.id, 'PUT', {
          end_km: endKmNum,
          end_time: new Date().toISOString(),
          status: 'COMPLETED'
        });
        stopGpsTracking();
        window.vehicleTracking.activeVoyage = null;
        showStartForm();
        loadVoyageHistory();
      } catch (err) {
        console.error('[VehicleTracking] End voyage error:', err);
      }
    }
  };

  window.vehicleTrackingAddExpense = async function () {
    if (!window.vehicleTracking.activeVoyage) return;

    const expenseType = document.getElementById('vtExpenseType').value;
    const amount = document.getElementById('vtExpenseAmount').value;
    const description = document.getElementById('vtExpenseDesc').value;

    if (!amount || parseFloat(amount) <= 0) {
      showVtStatus(getI18nText('vt_valid_amount'), 'warning');
      return;
    }

    try {
      await RECON_API._request('/voyages/' + window.vehicleTracking.activeVoyage.id + '/expenses', 'POST', {
        expense_type: expenseType,
        amount: parseFloat(amount),
        description: description || ''
      });

      document.getElementById('vtExpenseAmount').value = '';
      document.getElementById('vtExpenseDesc').value = '';

      loadVoyageExpenses(window.vehicleTracking.activeVoyage.id);
    } catch (err) {
      console.error('[VehicleTracking] Add expense error:', err);
      showVtStatus(getI18nText('vt_add_expense_failed'), 'danger');
    }
  };

  async function loadVoyageExpenses(voyageId) {
    try {
      const res = await RECON_API._request('/voyages/' + voyageId + '/expenses', 'GET');
      const expenses = res.data || [];
      const container = document.getElementById('vtExpenseItems');
      if (!container) return;

      if (expenses.length === 0) {
        container.innerHTML = '<p class="text-muted small text-center">' + getI18nText('vt_no_expenses') + '</p>';
        document.getElementById('vtKpiExpenses').textContent = '$0.00';
        return;
      }

      let total = 0;
      container.innerHTML = expenses.map(e => {
        total += parseFloat(e.amount || 0);
        return `
          <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
            <span><strong>${e.expense_type}</strong>${e.description ? ' - ' + e.description : ''}</span>
            <span class="fw-bold">$${parseFloat(e.amount).toFixed(2)}</span>
          </div>
        `;
      }).join('');
      document.getElementById('vtKpiExpenses').textContent = `$${total.toFixed(2)}`;
    } catch (e) {
      console.error('[VehicleTracking] Load expenses error:', e);
    }
  }

  window.vehicleTrackingViewVoyage = async function (voyageId) {
    try {
      const res = await RECON_API.getVoyage(voyageId);
      if (!res || !res.data) return;
      const v = res.data;

      // If the voyage is still in progress, show active tracking view
      if (v.status === 'IN_PROGRESS') {
        window.vehicleTracking.activeVoyage = v;
        showActiveVoyage(v);
        return;
      }

      // Completed or other voyages open the read-only details modal (prevents auto-restart bug)
      showVoyageDetailsModal(v);
    } catch (e) {
      console.error('[VehicleTracking] View voyage error:', e);
    }
  };

  function showVoyageDetailsModal(v) {
    const elNum = document.getElementById('vtDetailVoyageNumber');
    if (elNum) elNum.textContent = v.voyage_number || ('VOY-' + v.id);

    const elRoute = document.getElementById('vtDetailRoute');
    if (elRoute) elRoute.textContent = `${v.from_site || '—'} → ${v.to_site || '—'}`;

    const startStr = v.start_time ? new Date(v.start_time).toLocaleString() : '—';
    const endStr = v.end_time ? new Date(v.end_time).toLocaleString() : '—';
    const elDates = document.getElementById('vtDetailDates');
    if (elDates) elDates.textContent = `${startStr} → ${endStr}`;

    const elVehDriver = document.getElementById('vtDetailVehicleDriver');
    if (elVehDriver) elVehDriver.textContent = `${v.vehicle_number || '—'} / ${v.driver_name || v.driver_id || '—'}`;

    const elStartKm = document.getElementById('vtDetailStartKm');
    if (elStartKm) elStartKm.textContent = v.start_km ?? 0;

    const elEndKm = document.getElementById('vtDetailEndKm');
    if (elEndKm) elEndKm.textContent = (v.end_km !== null && v.end_km !== undefined) ? v.end_km : '—';

    const elDist = document.getElementById('vtDetailDistance');
    if (elDist) {
      const dist = (v.end_km && v.start_km && v.end_km >= v.start_km) ? (v.end_km - v.start_km) + ' KM' : '—';
      elDist.textContent = dist;
    }

    const elExp = document.getElementById('vtDetailExpenses');
    if (elExp) elExp.textContent = `$${Number(v.total_expenses || 0).toFixed(2)}`;

    const elReason = document.getElementById('vtDetailReason');
    if (elReason) elReason.textContent = v.reason || '—';

    // Status badge (Orange for Completed, Green for Running, Red for Deleted/Cancelled)
    const badge = document.getElementById('vtDetailStatusBadge');
    if (badge) {
      if (v.status === 'IN_PROGRESS') {
        badge.className = 'badge bg-success';
        badge.textContent = 'Running';
        badge.style.backgroundColor = '';
        badge.style.color = '#fff';
      } else if (v.status === 'COMPLETED') {
        badge.className = 'badge';
        badge.style.backgroundColor = '#fd7e14';
        badge.style.color = '#fff';
        badge.textContent = 'Completed';
      } else {
        badge.className = 'badge bg-danger';
        badge.textContent = v.status || 'Deleted';
        badge.style.backgroundColor = '';
        badge.style.color = '#fff';
      }
    }

    // Expense table
    const tbody = document.getElementById('vtDetailExpenseBody');
    if (tbody) {
      const expenses = v.expenses || [];
      if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted small">No expenses recorded</td></tr>';
      } else {
        tbody.innerHTML = expenses.map(e =>
          `<tr><td>${e.expense_type || 'Expense'}</td><td>${e.description || '—'}</td><td class="text-end fw-bold">$${Number(e.amount || 0).toFixed(2)}</td></tr>`
        ).join('');
      }
    }

    const modalEl = document.getElementById('vtDetailModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();

      const onShown = function () {
        initDetailMap(v);
        modalEl.removeEventListener('shown.bs.modal', onShown);
      };
      modalEl.addEventListener('shown.bs.modal', onShown);
    }
  }

  function initDetailMap(v) {
    if (!window.L) return;
    const mapEl = document.getElementById('vtDetailMap');
    if (!mapEl) return;

    if (window.vehicleTracking.detailMap) {
      try {
        window.vehicleTracking.detailMap.remove();
      } catch (e) {
        console.warn('Error removing detail map:', e);
      }
      window.vehicleTracking.detailMap = null;
    }

    const map = L.map('vtDetailMap', { zoomControl: true, attributionControl: false }).setView([-27.3668, -70.3323], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    window.vehicleTracking.detailMap = map;

    const bounds = [];
    const sites = window.vehicleTracking.sitesCache || [];
    const fromSite = sites.find(s => s.name === v.from_site);
    const toSite = sites.find(s => s.name === v.to_site);

    if (fromSite && fromSite.latitude && fromSite.longitude) {
      L.marker([fromSite.latitude, fromSite.longitude], {
        icon: createColorPin('#28a745', 'bi-geo-alt-fill')
      }).bindPopup(`<b>Start Site:</b> ${v.from_site}<br><small>${fromSite.address || ''}</small>`).addTo(map);
      bounds.push([fromSite.latitude, fromSite.longitude]);
    }

    if (toSite && toSite.latitude && toSite.longitude) {
      L.marker([toSite.latitude, toSite.longitude], {
        icon: createColorPin('#dc3545', 'bi-flag-fill')
      }).bindPopup(`<b>Destination:</b> ${v.to_site}<br><small>${toSite.address || ''}</small>`).addTo(map);
      bounds.push([toSite.latitude, toSite.longitude]);
    }

    const gpsPoints = v.gps_points || [];
    if (gpsPoints.length > 0) {
      const latlngs = gpsPoints.map(p => [p.latitude, p.longitude]);
      L.polyline(latlngs, { color: '#fd7e14', weight: 4, opacity: 0.8 }).addTo(map);
      latlngs.forEach(ll => bounds.push(ll));

      const last = latlngs[latlngs.length - 1];
      L.circleMarker(last, { radius: 7, color: '#0d6efd', fillColor: '#0d6efd', fillOpacity: 1 })
        .bindPopup(`<b>Last Position</b><br><small>${gpsPoints[gpsPoints.length - 1].recorded_at || ''}</small>`).addTo(map);
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [35, 35] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 11);
    }
  }

  window.vehicleTrackingRefresh = function () {
    loadSites();
    loadVehicles();
    loadVoyageHistory();
    if (window.vehicleTracking.activeVoyage) {
      loadVoyageGpsPoints(window.vehicleTracking.activeVoyage.id);
      loadVoyageExpenses(window.vehicleTracking.activeVoyage.id);
    }
  };

  window.vehicleTrackingNewVoyage = async function () {
    if (window.vehicleTracking.activeVoyage) {
      if (typeof Swal !== 'undefined') {
        const result = await Swal.fire({
          icon: 'warning',
          title: getI18nText('vt_new_voyage_confirm') || 'Start new voyage?',
          text: 'The current voyage will be ended.',
          showCancelButton: true,
          confirmButtonColor: '#fd7e14',
          confirmButtonText: getI18nText('vt_end_voyage') || 'End Voyage',
          cancelButtonText: getI18nText('btn_cancel') || 'Cancel'
        });
        if (result.isConfirmed) {
          window.vehicleTrackingEndVoyage();
        }
      } else if (confirm(getI18nText('vt_new_voyage_confirm'))) {
        window.vehicleTrackingEndVoyage();
      }
    } else {
      showStartForm();
    }
  };

  window.vehicleTrackingRefreshGPS = function () {
    if (window.vehicleTracking.activeVoyage) {
      refreshGps();
    }
  };

  // ── Helpers ──
  function showVtStatus(msg, type = 'info') {
    const el = document.getElementById('vtAlert');
    if (!el) return;
    el.className = `alert alert-${type} alert-dismissible fade show`;
    el.innerHTML = msg + ' <button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    if (type !== 'danger') {
      setTimeout(() => { el.classList.add('d-none'); }, 5000);
    }
  }

})();