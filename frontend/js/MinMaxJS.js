// =============================================
  // MinMaxJS.html - Per-Site Min/Max Maintenance UI
  // =============================================
  let mmRows = [];      // [{ site, geo, min, max, globalMin, globalMax, desc }]
  let mmSites = [];
  let mmProducts = [];  // [{ geo, globalMin, globalMax }]

  function mmEsc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.initMinMaxModule = function () {
    console.log("Initializing MinMax module...");
    if (typeof window.showStatus === "function") window.showStatus("Loading Min/Max...");
    google.script.run
      .withSuccessHandler(function (data) {
        mmSites = (data && data.sites) || [];
        mmProducts = (data && data.products) || [];
        const existing = (data && data.rows) || [];

        // Build a display list: existing per-site rows + (optionally) products with global fallback
        const geoDesc = {};
        (window.fullInventory || []).forEach(function (p) {
          if (p.geo) geoDesc[p.geo] = p.es || p.en || "";
        });

        mmRows = existing.map(function (r) {
          const prod = mmProducts.find((p) => p.geo === r.geo) || {};
          return {
            site: r.site,
            geo: r.geo,
            min: r.min,
            max: r.max,
            globalMin: prod.globalMin || 0,
            globalMax: prod.globalMax || 0,
            desc: r.desc || geoDesc[r.geo] || "",
          };
        });

        window.mmPopulateSites();
        window.mmApplyFilters();
        if (typeof window.hideStatus === "function") window.hideStatus();
      })
      .withFailureHandler(function (err) {
        console.error("MinMax load error:", err);
        if (typeof window.hideStatus === "function") window.hideStatus();
        if (typeof Swal !== "undefined") Swal.fire("Error", String(err), "error");
      })
      .getMinMaxData();
  };

  window.mmPopulateSites = function () {
    const sel = document.getElementById("mmSiteFilter");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">-- All Sites --</option>` +
      mmSites.map((s) => `<option value="${mmEsc(s)}">${mmEsc(s)}</option>`).join("");
  };

  window.mmApplyFilters = function () {
    const site = document.getElementById("mmSiteFilter") ? document.getElementById("mmSiteFilter").value : "";
    const term = (document.getElementById("mmSearch") ? document.getElementById("mmSearch").value : "").toLowerCase().trim();

    const filtered = mmRows.filter(function (r) {
      const siteOk = !site || r.site === site;
      const termOk = !term ||
        String(r.geo).toLowerCase().includes(term) ||
        String(r.desc || "").toLowerCase().includes(term);
      return siteOk && termOk;
    });

    window.mmRender(filtered);
    const info = document.getElementById("mmInfo");
    if (info) info.innerText = `${filtered.length} item(s)`;
  };

  window.mmRender = function (rows) {
    const body = document.getElementById("mmTableBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No Min/Max configured. Use "Add" to create one.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(function (r, idx) {
        const used = r.min > 0 || r.max > 0;
        const sourceTag = used
          ? ""
          : `<span class="badge bg-secondary ms-1">G ${r.globalMin}/${r.globalMax}</span>`;
        return `
        <tr data-mm-key="${mmEsc(r.site)}__${mmEsc(r.geo)}">
          <td><input type="checkbox" class="mm-row-check" data-ck="${mmEsc(r.site)}__${mmEsc(r.geo)}"></td>
          <td class="fw-bold">${mmEsc(r.site)}${sourceTag}</td>
          <td class="fw-bold text-primary">${mmEsc(r.geo)}</td>
          <td><small>${mmEsc(r.desc)}</small></td>
          <td class="text-center"><input type="number" min="0" class="form-control form-control-sm mm-min" data-key="${mmEsc(r.site)}__${mmEsc(r.geo)}" value="${r.min}"></td>
          <td class="text-center"><input type="number" min="0" class="form-control form-control-sm mm-max" data-key="${mmEsc(r.site)}__${mmEsc(r.geo)}" value="${r.max}"></td>
          <td class="small text-muted">${r.lastUpdated ? mmEsc(r.lastUpdated) : (used ? "" : "using global")}</td>
        </tr>`;
      })
      .join("");
    window.mmSyncEdits();
  };
window.mmSyncEdits = function () {
    document.querySelectorAll(".mm-min").forEach(function (el) {
      el.oninput = function () {
        const key = el.getAttribute("data-key");
        const r = mmRows.find((x) => x.site + "__" + x.geo === key);
        if (r) r.min = Number(el.value) || 0;
      };
    });
    document.querySelectorAll(".mm-max").forEach(function (el) {
      el.oninput = function () {
        const key = el.getAttribute("data-key");
        const r = mmRows.find((x) => x.site + "__" + x.geo === key);
        if (r) r.max = Number(el.value) || 0;
      };
    });
  };

  window.mmToggleAll = function () {
    const checked = document.getElementById("mmCheckAll").checked;
    document.querySelectorAll(".mm-row-check").forEach(function (cb) { cb.checked = checked; });
  };

  // ============================================
  // CART-STYLE ADD FLOW
  // Pick a site once, search products, add many,
  // then confirm to insert them all into the table.
  // ============================================
  let mmCart = []; // [{ geo, pn, desc, min, max }]

  window.mmAddRow = function () {
    if (!mmSites.length) {
      if (typeof Swal !== "undefined") Swal.fire("No Sites", "No sites configured in Validation.", "warning");
      return;
    }
    mmCart = [];
    const siteSel = document.getElementById("mmCartSite");
    if (siteSel) {
      siteSel.innerHTML = mmSites
        .map((s) => `<option value="${mmEsc(s)}">${mmEsc(s)}</option>`)
        .join("");
    }
    const searchInput = document.getElementById("mmCartSearch");
    if (searchInput) { searchInput.value = ""; }
    window.mmCartSearch();
    window.mmCartRender();

    const modalEl = document.getElementById("mmAddModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else {
      // Fallback: old single-prompt flow
      const site = window.prompt("Site", mmSites[0]);
      const geo = window.prompt("Geo Code", "");
      if (site && geo) {
        mmRows.push({ site: site, geo: geo, min: 0, max: 0, globalMin: 0, globalMax: 0, desc: "" });
        window.mmApplyFilters();
      }
    }
  };

  window.mmCartSearch = function () {
    const tbody = document.getElementById("mmCartResults");
    if (!tbody) return;
    const term = (document.getElementById("mmCartSearch") ? document.getElementById("mmCartSearch").value : "").toLowerCase().trim();
    if (!term || term.length < 2) { tbody.innerHTML = ""; return; }

    // Search the global background-synced inventory (same pattern as CreateReq)
    const matches = (window.fullInventory || [])
      .filter(function (i) {
        return (String(i.geo) + String(i.pn) + String(i.en || "") + String(i.es || ""))
          .toLowerCase()
          .includes(term);
      })
      .slice(0, 20);

    if (!matches.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-2">${getI18nText("no_items_found")}</td></tr>`;
      return;
    }

    tbody.innerHTML = matches
      .map(function (i) {
        const prod = mmProducts.find((p) => p.geo === String(i.geo).trim()) || {};
        const inCart = mmCart.some((c) => c.geo === String(i.geo).trim());
        return `
        <tr>
          <td class="fw-bold text-primary">${mmEsc(i.geo)}</td>
          <td><small>${mmEsc(i.pn)}</small></td>
          <td><small>${mmEsc(i.es || i.en)}</small></td>
          <td class="text-center small text-muted">${prod.globalMin || 0}</td>
          <td class="text-center small text-muted">${prod.globalMax || 0}</td>
          <td><button class="btn btn-sm ${inCart ? "btn-success" : "btn-outline-primary"}" onclick="window.mmCartAdd('${mmEsc(i.id)}')"><i class="bi bi-plus"></i></button></td>
        </tr>`;
      })
      .join("");
  };

  window.mmCartAdd = function (id) {
    const item = (window.fullInventory || []).find(function (i) { return i.id === id; });
    if (!item) return;
    const geo = String(item.geo).trim();
    if (mmCart.some((c) => c.geo === geo)) return;
    const prod = mmProducts.find((p) => p.geo === geo) || {};
    // Prefill with global Master values as a starting point
    mmCart.push({
      geo: geo,
      pn: item.pn || "",
      desc: item.es || item.en || "",
      min: Number(prod.globalMin) || 0,
      max: Number(prod.globalMax) || 0,
    });
    window.mmCartSearch(); // refresh add-button state
    window.mmCartRender();
  };

  window.mmCartRemove = function (geo) {
    mmCart = mmCart.filter((c) => c.geo !== geo);
    window.mmCartSearch();
    window.mmCartRender();
  };

  window.mmCartRender = function () {
    const body = document.getElementById("mmCartBody");
    const count = document.getElementById("mmCartCount");
    if (count) count.innerText = String(mmCart.length);
    if (!body) return;
    if (!mmCart.length) {
      body.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">${getI18nText("mm_cart_empty")}</td></tr>`;
      return;
    }
    body.innerHTML = mmCart
      .map(function (c) {
        return `
        <tr>
          <td class="fw-bold text-primary">${mmEsc(c.geo)}<br><small class="text-muted">${mmEsc(c.pn)}</small></td>
          <td><small>${mmEsc(c.desc)}</small></td>
          <td class="text-center"><input type="number" min="0" class="form-control form-control-sm mm-cart-min" data-geo="${mmEsc(c.geo)}" value="${c.min}"></td>
          <td class="text-center"><input type="number" min="0" class="form-control form-control-sm mm-cart-max" data-geo="${mmEsc(c.geo)}" value="${c.max}"></td>
          <td><button class="btn btn-sm text-danger" onclick="window.mmCartRemove('${mmEsc(c.geo)}')"><i class="bi bi-x-lg"></i></button></td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".mm-cart-min").forEach(function (el) {
      el.oninput = function () {
        const c = mmCart.find((x) => x.geo === el.getAttribute("data-geo"));
        if (c) c.min = Number(el.value) || 0;
      };
    });
    body.querySelectorAll(".mm-cart-max").forEach(function (el) {
      el.oninput = function () {
        const c = mmCart.find((x) => x.geo === el.getAttribute("data-geo"));
        if (c) c.max = Number(el.value) || 0;
      };
    });
  };

  window.mmCartConfirm = function () {
    const siteSel = document.getElementById("mmCartSite");
    const site = siteSel ? siteSel.value : "";
    if (!site) {
      if (typeof Swal !== "undefined") Swal.fire("Site Required", "Select a site first.", "warning");
      return;
    }
    if (!mmCart.length) {
      if (typeof Swal !== "undefined") Swal.fire("Cart Empty", getI18nText("mm_cart_empty"), "info");
      return;
    }

    let added = 0;
    let updated = 0;
    mmCart.forEach(function (c) {
      const existing = mmRows.find((r) => r.site === site && r.geo === c.geo);
      if (existing) {
        existing.min = c.min;
        existing.max = c.max;
        updated++;
      } else {
        const prod = mmProducts.find((p) => p.geo === c.geo) || {};
        mmRows.push({
          site: site,
          geo: c.geo,
          min: c.min,
          max: c.max,
          globalMin: prod.globalMin || 0,
          globalMax: prod.globalMax || 0,
          desc: c.desc,
        });
        added++;
      }
    });

    // Focus the table on the chosen site so the new rows are visible
    const siteFilter = document.getElementById("mmSiteFilter");
    if (siteFilter) siteFilter.value = site;
    window.mmApplyFilters();

    mmCart = [];
    const modalEl = document.getElementById("mmAddModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
    if (typeof Swal !== "undefined") {
      Swal.fire("Added", `${added} new row(s) added${updated ? `, ${updated} existing row(s) updated` : ""}. Review and press "Save Changes".`, "success");
    }
  };

  window.mmDeleteSelected = function () {
    const keys = [];
    document.querySelectorAll(".mm-row-check:checked").forEach(function (cb) {
      keys.push({ site: cb.getAttribute("data-ck").split("__")[0], geo: cb.getAttribute("data-ck").split("__").slice(1).join("__") });
    });
    if (!keys.length) { if (typeof Swal !== "undefined") Swal.fire("Nothing Selected", "Select rows to delete.", "warning"); return; }

    const del = () => {
      google.script.run
        .withSuccessHandler(function (res) {
          keys.forEach((k) => {
            mmRows = mmRows.filter((r) => !(r.site === k.site && r.geo === k.geo));
          });
          window.mmApplyFilters();
          if (typeof Swal !== "undefined") Swal.fire("Deleted", `${res.deleted} row(s) removed`, "success");
        })
        .withFailureHandler(function (err) { if (typeof Swal !== "undefined") Swal.fire("Error", String(err), "error"); })
        .deleteMinMaxItems(keys);
    };

    if (typeof Swal !== "undefined") {
      Swal.fire({ title: `Delete ${keys.length} row(s)?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Delete" }).then(function (r) { if (r.isConfirmed) del(); });
    } else if (confirm(`Delete ${keys.length} row(s)?`)) { del(); }
  };

  window.mmSaveAll = function () {
    const toSave = [];
    document.querySelectorAll(".mm-min, .mm-max").forEach(function (el) {
      const key = el.getAttribute("data-key");
      const parts = key.split("__");
      const site = parts[0];
      const geo = parts.slice(1).join("__");
      const r = mmRows.find((x) => x.site + "__" + x.geo === key);
      if (!r) return;
      toSave.push({ site: site, geo: geo, min: r.min, max: r.max });
    });

    // De-duplicate keys
    const seen = new Set();
    const deduped = toSave.filter(function (e) {
      const k = e.site + "__" + e.geo;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (!deduped.length) { if (typeof Swal !== "undefined") Swal.fire("Nothing to Save", "Add or edit at least one row.", "info"); return; }

    if (typeof Swal !== "undefined") Swal.fire({ title: "Saving...", text: "Please wait", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    google.script.run
      .withSuccessHandler(function (res) {
        if (typeof Swal !== "undefined") { Swal.close(); Swal.fire("Saved", `${res.count} item(s) saved`, "success"); }
        window.initMinMaxModule();
      })
      .withFailureHandler(function (err) {
        if (typeof Swal !== "undefined") { Swal.close(); Swal.fire("Error", String(err), "error"); }
      })
      .saveMinMaxItems(deduped);
  };

  // ============================================
  // IMPORT FLOW (CSV / Excel)
  // ============================================
  let mmImportRows = []; // normalized [{ site, geo, min, max, status }]

  window.mmOpenImport = function () {
    const fileInput = document.getElementById("mmImportFile");
    if (fileInput) fileInput.value = "";
    mmImportRows = [];
    document.getElementById("mmImportPreviewWrap").classList.add("d-none");
    document.getElementById("mmImportPreview").innerHTML = "";
    document.getElementById("mmImportStats").innerHTML = "";
    document.getElementById("mmImportConfirmBtn").classList.add("d-none");
    document.getElementById("mmImportParseBtn").classList.remove("d-none");
    const modalEl = document.getElementById("mmImportModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  };

  // CSV line parser handling quoted fields
  window.mmParseCsvLine = function (line, sep) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  window.mmHeaderIndex = function (headers, candidates) {
    for (let c = 0; c < candidates.length; c++) {
      const idx = headers.findIndex(function (h) {
        return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "") === candidates[c];
      });
      if (idx !== -1) return idx;
    }
    return -1;
  };

  window.mmNormalizeRows = function (matrix) {
    if (!matrix || !matrix.length) return [];
    const first = matrix[0].map(function (h) { return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, ""); });
    const looksHeader = first.some(function (h) {
      return ["site", "sitio", "geocode", "geo", "min", "minimo"].indexOf(h) !== -1;
    });

    let sIdx = 0, gIdx = 1, minIdx = 2, maxIdx = 3;
    let body = matrix;
    if (looksHeader) {
      const headers = matrix[0];
      sIdx = window.mmHeaderIndex(headers, ["site", "sitio", "faena"]);
      gIdx = window.mmHeaderIndex(headers, ["geocode", "geo", "codigo", "codgeo"]);
      minIdx = window.mmHeaderIndex(headers, ["min", "minimo", "minstock"]);
      maxIdx = window.mmHeaderIndex(headers, ["max", "maximo", "maxstock"]);
      body = matrix.slice(1);
      if (sIdx === -1) sIdx = 0;
      if (gIdx === -1) gIdx = 1;
      if (minIdx === -1) minIdx = 2;
      if (maxIdx === -1) maxIdx = 3;
    }

    const rows = [];
    body.forEach(function (r) {
      const site = String(r[sIdx] || "").trim();
      const geo = String(r[gIdx] || "").trim();
      if (!site && !geo) return; // skip blank lines
      const min = Math.max(0, Number(String(r[minIdx] || "").replace(",", ".")) || 0);
      const max = Math.max(0, Number(String(r[maxIdx] || "").replace(",", ".")) || 0);
      const valid = !!site && !!geo;
      rows.push({ site: site, geo: geo, min: min, max: max, status: valid ? "" : "error" });
    });
    return rows;
  };

  window.mmImportParse = function () {
    const input = document.getElementById("mmImportFile");
    const file = input && input.files ? input.files[0] : null;
    if (!file) {
      if (typeof Swal !== "undefined") Swal.fire("No File", getI18nText("mm_import_nofile"), "warning");
      return;
    }
    const name = file.name.toLowerCase();
    const mode = document.querySelector('input[name="mmImportMode"]:checked').value;

    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      const sepVal = document.getElementById("mmImportSep").value;
      const sep = sepVal === "tab" ? "\t" : sepVal;
      const reader = new FileReader();
      reader.onload = function (e) {
        const lines = String(e.target.result).split(/\r?\n/);
        const matrix = lines
          .filter(function (l) { return l.trim() !== ""; })
          .map(function (l) { return window.mmParseCsvLine(l, sep); });
        window.mmBuildPreview(window.mmNormalizeRows(matrix), mode);
      };
      reader.readAsText(file);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const base64 = String(e.target.result).split(",")[1];
        if (typeof Swal !== "undefined") Swal.fire({ title: "Reading...", allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
        google.script.run
          .withSuccessHandler(function (res) {
            if (typeof Swal !== "undefined") Swal.close();
            if (!res || !res.success) {
              if (typeof Swal !== "undefined") Swal.fire("Error", (res && res.message) || "Excel parse failed", "error");
              return;
            }
            window.mmBuildPreview(window.mmNormalizeRows(res.rows || []), mode);
          })
          .withFailureHandler(function (err) {
            if (typeof Swal !== "undefined") Swal.close();
            if (typeof Swal !== "undefined") Swal.fire("Error", String(err), "error");
          })
          .importMinMaxExcel(base64, file.name);
      };
      reader.readAsDataURL(file);
    } else {
      if (typeof Swal !== "undefined") Swal.fire("Unsupported", getI18nText("mm_import_badtype"), "error");
    }
  };

  window.mmBuildPreview = function (rows, mode) {
    mmImportRows = rows;
    const existingKeys = new Set(mmRows.map(function (r) {
      return String(r.site).trim().toUpperCase() + "__" + String(r.geo).trim().toUpperCase();
    }));
    let newC = 0, updC = 0, skipC = 0, errC = 0;

    mmImportRows.forEach(function (r) {
      if (r.status === "error") { errC++; return; }
      const key = r.site.trim().toUpperCase() + "__" + r.geo.trim().toUpperCase();
      if (existingKeys.has(key)) {
        if (mode === "replace") { r.status = "update"; updC++; }
        else { r.status = "skip"; skipC++; }
      } else {
        r.status = "new"; newC++;
      }
    });

    const badge = {
      new: '<span class="badge bg-success">NEW</span>',
      update: '<span class="badge bg-primary">UPDATE</span>',
      skip: '<span class="badge bg-secondary">SKIP</span>',
      error: '<span class="badge bg-danger">ERROR</span>',
    };
    document.getElementById("mmImportPreview").innerHTML = mmImportRows
      .map(function (r) {
        return `<tr class="${r.status === "error" ? "table-danger" : (r.status === "skip" ? "table-light text-muted" : "")}">
          <td>${mmEsc(r.site)}</td><td>${mmEsc(r.geo)}</td>
          <td class="text-center">${r.min}</td><td class="text-center">${r.max}</td>
          <td>${badge[r.status] || ""}${r.status === "error" ? " " + getI18nText("mm_import_missing") : ""}</td>
        </tr>`;
      })
      .join("");
    document.getElementById("mmImportStats").innerHTML =
      `<span class="badge bg-success">NEW: ${newC}</span>` +
      `<span class="badge bg-primary">UPDATE: ${updC}</span>` +
      `<span class="badge bg-secondary">SKIP: ${skipC}</span>` +
      `<span class="badge bg-danger">ERROR: ${errC}</span>`;
    document.getElementById("mmImportPreviewWrap").classList.remove("d-none");
    document.getElementById("mmImportParseBtn").classList.add("d-none");
    const confirmBtn = document.getElementById("mmImportConfirmBtn");
    if (newC + updC > 0) confirmBtn.classList.remove("d-none");
    else confirmBtn.classList.add("d-none");
  };

  window.mmImportConfirm = function () {
    const mode = document.querySelector('input[name="mmImportMode"]:checked').value;
    const payload = mmImportRows
      .filter(function (r) { return r.status === "new" || r.status === "update"; })
      .map(function (r) { return { site: r.site, geo: r.geo, min: r.min, max: r.max }; });
    if (!payload.length) {
      if (typeof Swal !== "undefined") Swal.fire("Nothing to Import", getI18nText("mm_cart_empty"), "info");
      return;
    }
    if (typeof Swal !== "undefined") Swal.fire({ title: "Importing...", allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
    google.script.run
      .withSuccessHandler(function (res) {
        if (typeof Swal !== "undefined") Swal.close();
        const modalEl = document.getElementById("mmImportModal");
        if (modalEl && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        if (typeof Swal !== "undefined") {
          Swal.fire("Imported", `${res.saved} row(s) saved, ${res.skipped} skipped.`, "success");
        }
        window.initMinMaxModule();
      })
      .withFailureHandler(function (err) {
        if (typeof Swal !== "undefined") Swal.close();
        if (typeof Swal !== "undefined") Swal.fire("Error", String(err), "error");
      })
      .saveMinMaxImport(payload, mode);
  };
