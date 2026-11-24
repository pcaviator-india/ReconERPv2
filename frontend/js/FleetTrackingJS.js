/**
 * FleetTrackingJS.js — RECON ERP Fleet Live Map Module
 * Displays all active voyages, sites, origin-to-destination routes, and live GPS locations.
 */
(function () {
  'use strict';

  window.fleetTracking = {
    map: null,
    sites: [],
    activeVoyages: [],
    markers: [],
    polylines: [],
    refreshTimer: null,
    isInitialized: false,
    voyageMarkersMap: {} // voyageId -> Leaflet marker/layer
  };

  // ── Color Pin Marker Helper ──
  function createMapPin(color, iconClass, label) {
    return L.divIcon({
      className: 'fleet-custom-pin',
      html: `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
          <div style="
            background: ${color};
            color: #ffffff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 6px rgba(0,0,0,0.35);
            border: 2px solid #ffffff;
            font-size: 15px;
          ">
            <i class="bi ${iconClass}"></i>
          </div>
          ${label ? `<div style="
            background: rgba(0,0,0,0.75);
            color: #fff;
            font-size: 10px;
            font-weight: 600;
            padding: 1px 5px;
            border-radius: 4px;
            margin-top: 2px;
            white-space: nowrap;
          ">${label}</div>` : ''}
        </div>
      `,
      iconSize: [32, 42],
      iconAnchor: [16, 20],
      popupAnchor: [0, -18]
    });
  }

  // ── Leaflet Loader ──
  function ensureLeaflet() {
    return new Promise((resolve) => {
      if (window.L) return resolve();

      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
      } else {
        const check = setInterval(() => {
          if (window.L) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      }
    });
  }

  // ── Initialize Fleet Map Module ──
  window.initFleetMapModule = async function () {
    try {
      await ensureLeaflet();

      const container = document.getElementById('fleetMapCanvas');
      if (!container) return;

      // Initialize map container if not already initialized
      if (!window.fleetTracking.map) {
        const map = L.map('fleetMapCanvas', {
          zoomControl: true,
          attributionControl: false
        }).setView([-27.3668, -70.3323], 6); // Default Chile Copiapó/Atacama area

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(map);

        window.fleetTracking.map = map;
      } else {
        window.fleetTracking.map.invalidateSize();
      }

      if (typeof updateUI === 'function') updateUI();

      // Load sites & active voyages
      await loadFleetData();

      // Setup 30s auto-refresh
      if (window.fleetTracking.refreshTimer) {
        clearInterval(window.fleetTracking.refreshTimer);
      }
      window.fleetTracking.refreshTimer = setInterval(() => {
        const activeMod = document.getElementById('fleetMapModule');
        if (activeMod && activeMod.offsetParent !== null) {
          window.fleetMapRefresh(true);
        } else {
          clearInterval(window.fleetTracking.refreshTimer);
          window.fleetTracking.refreshTimer = null;
        }
      }, 30000);

    } catch (err) {
      console.error('[FleetMap] Init error:', err);
    }
  };

  // ── Load Sites & Active Voyages ──
  async function loadFleetData(isSilent = false) {
    try {
      // 1. Fetch sites with coordinates
      const sitesRes = await RECON_API.getSites();
      const sites = Array.isArray(sitesRes) ? sitesRes : (sitesRes && sitesRes.data ? sitesRes.data : []);
      window.fleetTracking.sites = sites;

      // 2. Fetch all active voyages
      const voyagesRes = await RECON_API.getVoyages({ status: 'IN_PROGRESS', all_active: '1' });
      const activeList = Array.isArray(voyagesRes) ? voyagesRes : (voyagesRes && voyagesRes.data ? voyagesRes.data : []);

      // 3. For each active voyage, fetch full detail including GPS points
      const detailedVoyages = await Promise.all(
        activeList.map(async (v) => {
          try {
            const d = await RECON_API.getVoyage(v.id);
            return (d && d.data) ? d.data : v;
          } catch (e) {
            return v;
          }
        })
      );

      window.fleetTracking.activeVoyages = detailedVoyages;

      // 4. Render on map & sidebar
      renderFleetMap(!isSilent);
      renderActiveTripsSidebar();

      const lastUpdateEl = document.getElementById('fleetLastUpdateText');
      if (lastUpdateEl) {
        lastUpdateEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
      }

      const countBadge = document.getElementById('fleetActiveCountBadge');
      if (countBadge) {
        countBadge.textContent = `${detailedVoyages.length} Active`;
        countBadge.className = detailedVoyages.length > 0 ? 'badge bg-success rounded-pill' : 'badge bg-secondary rounded-pill';
      }

    } catch (err) {
      console.error('[FleetMap] Load data error:', err);
    }
  }

  // ── Render Fleet Map ──
  function renderFleetMap(autoFit = true) {
    const map = window.fleetTracking.map;
    if (!map) return;

    // Clear previous dynamic markers & lines
    window.fleetTracking.markers.forEach(m => map.removeLayer(m));
    window.fleetTracking.polylines.forEach(p => map.removeLayer(p));
    window.fleetTracking.markers = [];
    window.fleetTracking.polylines = [];
    window.fleetTracking.voyageMarkersMap = {};

    const bounds = [];
    const sites = window.fleetTracking.sites || [];
    const voyages = window.fleetTracking.activeVoyages || [];

    // Render subtle site markers
    sites.forEach(site => {
      if (site.latitude && site.longitude) {
        const marker = L.circleMarker([site.latitude, site.longitude], {
          radius: 6,
          color: '#6c757d',
          fillColor: '#adb5bd',
          fillOpacity: 0.8,
          weight: 2
        }).bindPopup(`
          <div class="p-1">
            <strong class="text-primary"><i class="bi bi-geo-alt me-1"></i>${site.name}</strong><br>
            <small class="text-muted">${site.address || 'Site Location'}</small><br>
            <small class="text-secondary">Coord: ${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}</small>
          </div>
        `);
        marker.addTo(map);
        window.fleetTracking.markers.push(marker);
      }
    });

    // Render active voyages
    voyages.forEach((v, idx) => {
      const fromSite = sites.find(s => s.name === v.from_site);
      const toSite = sites.find(s => s.name === v.to_site);
      const gpsPoints = v.gps_points || [];
      const routePoints = [];

      // Start pin (Green)
      if (fromSite && fromSite.latitude && fromSite.longitude) {
        const startLatLng = [fromSite.latitude, fromSite.longitude];
        routePoints.push(startLatLng);
        bounds.push(startLatLng);

        const startMarker = L.marker(startLatLng, {
          icon: createMapPin('#28a745', 'bi-geo-alt-fill', v.from_site)
        }).bindPopup(`
          <div class="p-1">
            <span class="badge bg-success mb-1">Origin Site</span><br>
            <strong>${v.from_site}</strong><br>
            <small class="text-muted">${fromSite.address || ''}</small><br>
            <small><b>Trip:</b> ${v.voyage_number || 'VOY-' + v.id}</small>
          </div>
        `);
        startMarker.addTo(map);
        window.fleetTracking.markers.push(startMarker);
      }

      // Add GPS breadcrumb path
      if (gpsPoints.length > 0) {
        gpsPoints.forEach(p => {
          routePoints.push([p.latitude, p.longitude]);
          bounds.push([p.latitude, p.longitude]);
        });
      }

      // Destination pin (Red flag)
      if (toSite && toSite.latitude && toSite.longitude) {
        const destLatLng = [toSite.latitude, toSite.longitude];
        bounds.push(destLatLng);

        const destMarker = L.marker(destLatLng, {
          icon: createMapPin('#dc3545', 'bi-flag-fill', v.to_site)
        }).bindPopup(`
          <div class="p-1">
            <span class="badge bg-danger mb-1">Destination Site</span><br>
            <strong>${v.to_site}</strong><br>
            <small class="text-muted">${toSite.address || ''}</small><br>
            <small><b>Trip:</b> ${v.voyage_number || 'VOY-' + v.id}</small>
          </div>
        `);
        destMarker.addTo(map);
        window.fleetTracking.markers.push(destMarker);
      }

      // Route line connecting origin -> breadcrumbs -> destination
      const fullRouteLine = [];
      if (fromSite && fromSite.latitude) fullRouteLine.push([fromSite.latitude, fromSite.longitude]);
      if (gpsPoints.length > 0) {
        gpsPoints.forEach(p => fullRouteLine.push([p.latitude, p.longitude]));
      }
      if (toSite && toSite.latitude) fullRouteLine.push([toSite.latitude, toSite.longitude]);

      if (fullRouteLine.length > 1) {
        const line = L.polyline(fullRouteLine, {
          color: '#fd7e14',
          weight: 4,
          opacity: 0.85,
          dashArray: '8, 6'
        }).addTo(map);
        window.fleetTracking.polylines.push(line);
      }

      // Current Vehicle position marker
      let vehicleLatLng = null;
      let lastTimeStr = 'Waiting for GPS';
      if (gpsPoints.length > 0) {
        const lastPt = gpsPoints[gpsPoints.length - 1];
        vehicleLatLng = [lastPt.latitude, lastPt.longitude];
        lastTimeStr = lastPt.recorded_at ? new Date(lastPt.recorded_at).toLocaleTimeString() : 'Recent';
      } else if (fromSite && fromSite.latitude) {
        // Vehicle just started, position at start site
        vehicleLatLng = [fromSite.latitude, fromSite.longitude];
        lastTimeStr = 'At origin site';
      }

      if (vehicleLatLng) {
        const vehicleMarker = L.marker(vehicleLatLng, {
          icon: createMapPin('#0d6efd', 'bi-truck', v.vehicle_number || 'Vehicle')
        }).bindPopup(`
          <div class="p-2" style="min-width: 200px;">
            <div class="d-flex justify-content-between align-items-center border-bottom pb-1 mb-2">
              <strong class="text-primary">${v.voyage_number || 'VOY-' + v.id}</strong>
              <span class="badge bg-success">RUNNING</span>
            </div>
            <div class="small">
              <div><b>Vehicle:</b> ${v.vehicle_number || '—'}</div>
              <div><b>Driver:</b> ${v.driver_name || v.driver_id || '—'}</div>
              <div><b>Route:</b> ${v.from_site} → ${v.to_site}</div>
              <div><b>Start KM:</b> ${v.start_km || 0}</div>
              <div><b>Last GPS:</b> ${lastTimeStr}</div>
              ${v.reason ? `<div><b>Reason:</b> ${v.reason}</div>` : ''}
            </div>
          </div>
        `);
        vehicleMarker.addTo(map);
        window.fleetTracking.markers.push(vehicleMarker);
        window.fleetTracking.voyageMarkersMap[v.id] = vehicleMarker;
      }
    });

    if (autoFit && bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    } else if (autoFit && bounds.length === 1) {
      map.setView(bounds[0], 10);
    }
  }

  // ── Render Active Trips Sidebar ──
  function renderActiveTripsSidebar() {
    const container = document.getElementById('fleetActiveTripsList');
    if (!container) return;

    const voyages = window.fleetTracking.activeVoyages || [];
    const sites = window.fleetTracking.sites || [];

    if (voyages.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-geo-alt display-6 text-muted mb-2 d-block"></i>
          <p class="small mb-1 fw-bold">${getI18nText('fleet_no_active') || 'No active trips right now.'}</p>
          <small class="text-muted">When drivers start a trip, it appears here in real time.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = voyages.map(v => {
      const fromSite = sites.find(s => s.name === v.from_site);
      const toSite = sites.find(s => s.name === v.to_site);
      const startTime = v.start_time ? new Date(v.start_time).toLocaleTimeString() : '—';
      const gpsPoints = v.gps_points || [];
      const gpsCount = gpsPoints.length;

      return `
        <div class="card border mb-2 shadow-sm trip-card" style="border-left: 4px solid #28a745 !important;">
          <div class="card-body p-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-bold text-dark small">${v.voyage_number || 'VOY-' + v.id}</span>
              <span class="badge bg-success small"><i class="bi bi-circle-fill me-1" style="font-size: 7px;"></i>Running</span>
            </div>
            <div class="fw-bold text-primary small mb-1">
              <i class="bi bi-arrow-right-circle me-1"></i>${v.from_site} → ${v.to_site}
            </div>
            <div class="text-muted small mb-1" style="font-size: 11px;">
              <div><i class="bi bi-truck me-1"></i>${v.vehicle_number || '—'} &bull; <i class="bi bi-person me-1"></i>${v.driver_name || v.driver_id || '—'}</div>
              <div><i class="bi bi-clock me-1"></i>Started: ${startTime} &bull; Start KM: ${v.start_km || 0}</div>
              <div><i class="bi bi-broadcast me-1 text-success"></i>GPS Updates: ${gpsCount} points</div>
            </div>
            <div class="d-flex gap-2 mt-2">
              <button class="btn btn-sm btn-outline-primary py-0 px-2 flex-grow-1" style="font-size: 11px;"
                onclick="window.locateFleetVoyage(${v.id})">
                <i class="bi bi-crosshair me-1"></i>${getI18nText('fleet_locate') || 'Locate'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Locate Voyage on Map ──
  window.locateFleetVoyage = function (voyageId) {
    const map = window.fleetTracking.map;
    if (!map) return;

    const marker = window.fleetTracking.voyageMarkersMap[voyageId];
    if (marker) {
      map.setView(marker.getLatLng(), 13, { animate: true });
      marker.openPopup();
    } else {
      const v = window.fleetTracking.activeVoyages.find(voy => voy.id === voyageId);
      if (v) {
        const fromSite = window.fleetTracking.sites.find(s => s.name === v.from_site);
        if (fromSite && fromSite.latitude) {
          map.setView([fromSite.latitude, fromSite.longitude], 12, { animate: true });
        }
      }
    }
  };

  // ── Manual Refresh ──
  window.fleetMapRefresh = async function (isSilent = false) {
    await loadFleetData(isSilent);
  };

  // Helper for i18n
  function getI18nText(key) {
    if (typeof window.getI18nText === 'function') return window.getI18nText(key);
    if (typeof translations !== 'undefined' && translations[window.currentLang || 'es']) {
      return translations[window.currentLang || 'es'][key] || key;
    }
    return key;
  }

})();
