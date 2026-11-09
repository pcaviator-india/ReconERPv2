// ============================================================
// ProductsJS.js  — REST API version (replaces google.script.run)
// Wrapped in IIFE to protect global scope
// ============================================================

(function () {
  'use strict';

  let currentPage = 1;
  const rowsPerPage = 50;
  window.fullInventory = window.fullInventory || [];
  let isLoading = false;
  let searchTimer = null;

  window.initProductsModule = async function () {
    window.showStatus && window.showStatus('Loading inventory...');
    await loadProducts();
  };

  // ── Fetch products from REST API ────────────────────────────
  async function loadProducts(params = {}) {
    if (isLoading) return;
    isLoading = true;

    try {
      const pageSize = 5000;
      const products = [];
      let page = 1;
      let total = null;

      do {
        const resp = await RECON_API.getProducts({
          ...params,
          page,
          limit: pageSize
        });
        const pageProducts = Array.isArray(resp?.data) ? resp.data : [];
        products.push(...pageProducts);
        total = Number(resp?.pagination?.total);
        updateSyncStatus(products.length, total || products.length, false);

        if (pageProducts.length === 0 || pageProducts.length < pageSize) {
          break;
        }
        page += 1;
      } while (total === null || products.length < total);

      window.fullInventory = products.map(normalise);
      currentPage = 1;
      window.renderProducts();
      updateSyncStatus(window.fullInventory.length, total || window.fullInventory.length, true);
    } catch (err) {
      console.error('Products load error:', err);
      const tbody = document.getElementById('productsTableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger py-4">
          <i class="bi bi-exclamation-triangle me-2"></i>Failed to load products: ${err.message}
        </td></tr>`;
      }
    } finally {
      isLoading = false;
      window.hideStatus && window.hideStatus();
    }
  }

  // Map API field names → internal field names used in render
  // NOTE: never fall back to numeric IDs — only use resolved name strings.
  function normalise(p) {
    return {
      id: p.geo || '',
      geo: p.geo || '',
      pn: p.pn || '',
      en: p.description || '',   // English description
      es: p.description_es || '',   // Spanish description
      name: p.name || '',
      category: p.category_name || '',   // name only, never raw ID
      sub_categoria: p.sub_category_name || '',   // name only, never raw ID
      marca: p.brand_name || '',   // name only, never raw ID
      proveedor: p.supplier_name || '',   // name only, never raw ID
      un: p.unit || '',
      stock: Number(p.stock) || 0,
      costo_clp: Number(p.cost) || 0,
      min: Number(p.min_qty) || 0,
      max: Number(p.max_qty) || 0,
      is_active: p.is_active,
      // keep the raw object for edit
      _raw: p
    };
  }

  // ── Populate filter dropdowns from loaded data ───────────────
  // Only call this once on initial load / full refresh.
  // All subsequent cascade updates use updateCascadeFilters().
  function populateDropdowns() {
    const list = window.fullInventory || [];

    // Category — always the full universe, no cascade
    const cats = [...new Set(list.map(i => i.category).filter(v => v && isNaN(v)))].sort();
    fillSelect('filterCategory', cats, 'All Categories');

    // Cascade everything downstream from scratch
    updateCascadeFilters();
  }

  /**
   * Re-populate filterSubCategory, filterBrand and filterSupplier
   * based on what is currently selected in the upstream dropdowns.
   *
   * Cascade order: Category → SubCategory → Brand → Supplier
   * Each level narrows the pool for the levels below it.
   */
  function updateCascadeFilters() {
    const list = window.fullInventory || [];
    const catF = document.getElementById('filterCategory')?.value || '';
    const subF = document.getElementById('filterSubCategory')?.value || '';
    const brandF = document.getElementById('filterBrand')?.value || '';

    // Pool after category filter
    const afterCat = catF ? list.filter(i => i.category === catF) : list;
    // Pool after subcat filter (applied on top of category)
    const afterSub = subF ? afterCat.filter(i => i.sub_categoria === subF) : afterCat;
    // Pool after brand filter (applied on top of subcat)
    const afterBrand = brandF ? afterSub.filter(i => i.marca === brandF) : afterSub;

    // SubCategory options — only those in the selected category
    const subs = [...new Set(afterCat.map(i => i.sub_categoria).filter(v => v && isNaN(v)))].sort();
    fillSelect('filterSubCategory', subs, 'All Subcategories');

    // Brand options — only those in cat+subcat selection
    const brands = [...new Set(afterSub.map(i => i.marca).filter(v => v && isNaN(v)))].sort();
    fillSelect('filterBrand', brands, 'All Brands');

    // Supplier options — only those in cat+subcat+brand selection
    const supps = [...new Set(afterBrand.map(i => i.proveedor).filter(v => v && isNaN(v)))].sort();
    fillSelect('filterSupplier', supps, 'All Suppliers');
  }

  // kept for backward compatibility (called from renderProducts)
  function updateSubCategoryFilter() {
    updateCascadeFilters();
  }

  function populateModalDropdowns() {
    const list = window.fullInventory || [];

    // Category — full universe
    const cats = [...new Set(list.map(i => i.category).filter(v => v && isNaN(v)))].sort();
    fillSelect('form_cat', cats, '-- Select Category --');

    // Seed subcat/brand/supplier with full lists initially
    const subs = [...new Set(list.map(i => i.sub_categoria).filter(v => v && isNaN(v)))].sort();
    const brands = [...new Set(list.map(i => i.marca).filter(v => v && isNaN(v)))].sort();
    const supps = [...new Set(list.map(i => i.proveedor).filter(v => v && isNaN(v)))].sort();
    fillSelect('form_subcat', subs, '-- Select Subcategory --');
    fillSelect('form_brand', brands, '-- Select Brand --');
    fillSelect('form_supplier', supps, '-- Select Supplier --');

    // ── Wire cascade once ────────────────────────────────────────
    // Helper: re-cascade form_subcat, form_brand, form_supplier
    // based on current form_cat and form_subcat values.
    function cascadeModal() {
      const selCat = document.getElementById('form_cat')?.value || '';
      const selSub = document.getElementById('form_subcat')?.value || '';

      const afterCat = selCat ? list.filter(i => i.category === selCat) : list;
      const afterSub = selSub ? afterCat.filter(i => i.sub_categoria === selSub) : afterCat;

      const filtSubs = [...new Set(afterCat.map(i => i.sub_categoria).filter(v => v && isNaN(v)))].sort();
      const filtBrands = [...new Set(afterSub.map(i => i.marca).filter(v => v && isNaN(v)))].sort();
      const filtSupps = [...new Set(afterSub.map(i => i.proveedor).filter(v => v && isNaN(v)))].sort();

      fillSelect('form_subcat', filtSubs, '-- Select Subcategory --');
      fillSelect('form_brand', filtBrands, '-- Select Brand --');
      fillSelect('form_supplier', filtSupps, '-- Select Supplier --');
    }

    const formCat = document.getElementById('form_cat');
    if (formCat && !formCat._cascadeWired) {
      formCat.addEventListener('change', cascadeModal);
      formCat._cascadeWired = true;
    }

    const formSub = document.getElementById('form_subcat');
    if (formSub && !formSub._cascadeWired) {
      formSub.addEventListener('change', cascadeModal);
      formSub._cascadeWired = true;
    }
  }

  function fillSelect(id, items, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('');
  }

  // ── Render the product table (client-side filter + paginate) ─
  window.renderProducts = function () {
    // Populate main dropdowns; subcategory cascade runs inside populateDropdowns
    populateDropdowns();

    const search = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
    const catF = document.getElementById('filterCategory')?.value || '';
    const subF = document.getElementById('filterSubCategory')?.value || '';
    const brandF = document.getElementById('filterBrand')?.value || '';
    const suppF = document.getElementById('filterSupplier')?.value || '';

    const terms = search ? search.split(/\s+/).filter(t => t.length > 0) : [];

    const filtered = (window.fullInventory || []).filter(i => {
      const haystack = (i.geo + ' ' + i.pn + ' ' + i.en + ' ' + i.es + ' ' + i.marca).toLowerCase();
      const matchS = !terms.length || terms.every(t => haystack.includes(t));
      const matchC = !catF || i.category === catF;
      const matchSub = !subF || i.sub_categoria === subF;
      const matchB = !brandF || i.marca === brandF;
      const matchSupp = !suppF || i.proveedor === suppF;
      return matchS && matchC && matchSub && matchB && matchSupp;
    });

    const totalPages = Math.ceil(filtered.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = 1;
    const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-5">
        <i class="bi bi-inbox fs-2 d-block mb-2"></i>No products found.
      </td></tr>`;
    } else {
      tbody.innerHTML = paginated.map(item => `
        <tr>
          <td class="fw-bold text-primary small">${esc(item.geo)}</td>
          <td><small>${esc(item.pn)}</small></td>
          <td><small>${esc(item.category)}</small></td>
          <td><small>${esc(item.sub_categoria)}</small></td>
          <td><small>${esc(item.marca)}</small></td>
          <td>
            <div class="small fw-semibold text-dark">${esc(item.en || item.name)}</div>
            <div class="small text-muted fst-italic">${esc(item.es)}</div>
          </td>
          <td class="text-center"><small>${esc(item.un)}</small></td>
          <td class="text-center fw-bold ${item.stock <= 0 ? 'text-danger' : 'text-success'}">${item.stock}</td>
          <td class="text-end"><small>${formatCost(item.costo_clp)}</small></td>
          <td><small>${esc(item.proveedor)}</small></td>
          <td class="text-end admin-only">
            <button class="btn btn-sm btn-outline-primary" onclick="window.editProduct('${esc(item.geo)}')">
              <i class="bi bi-pencil"></i>
            </button>
          </td>
        </tr>`).join('');
    }

    renderPaginationControls(totalPages, filtered.length);
  };

  function esc(v) {
    return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatCost(v) {
    if (!v && v !== 0) return '';
    return Number(v).toLocaleString();
  }

  function updateSyncStatus(current, total, finished) {
    const info = document.getElementById('paginationInfo');
    if (!info) return;
    if (finished) {
      info.innerText = `Total: ${total}`;
    } else {
      info.innerText = `Loading: ${current} / ${total}...`;
    }
  }

  function renderPaginationControls(totalPages, totalItems) {
    const container = document.getElementById('paginationControls');
    const info = document.getElementById('paginationInfo');
    if (info) info.innerText = `Total: ${totalItems}`;
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
        html += `<button type="button" class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline-secondary'} btn-sm mx-1"
          onclick="window.changePage(${i})">${i}</button>`;
      } else if (i === currentPage - 3 || i === currentPage + 3) {
        html += `<span class="mx-1">…</span>`;
      }
    }
    container.innerHTML = html;
  }

  // ── Search / filter handlers ─────────────────────────────────

  // Helper: re-run cascade + debounced render
  function triggerCascadeAndFilter() {
    updateCascadeFilters();
    currentPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => window.renderProducts(), 220);
  }

  // Category changes → reset subcat/brand/supplier options then filter
  window.onProductCategoryChange = function () {
    // Clear downstream selections so the new cascade is unambiguous
    const sub = document.getElementById('filterSubCategory');
    const br = document.getElementById('filterBrand');
    const su = document.getElementById('filterSupplier');
    if (sub) sub.value = '';
    if (br) br.value = '';
    if (su) su.value = '';
    triggerCascadeAndFilter();
  };

  // SubCategory changes → update brand/supplier options then filter
  window.onProductSubCategoryChange = function () {
    const br = document.getElementById('filterBrand');
    const su = document.getElementById('filterSupplier');
    if (br) br.value = '';
    if (su) su.value = '';
    triggerCascadeAndFilter();
  };

  // Brand changes → update supplier options then filter
  window.onProductBrandChange = function () {
    const su = document.getElementById('filterSupplier');
    if (su) su.value = '';
    triggerCascadeAndFilter();
  };

  window.handleSearchInput = function () {
    currentPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => window.renderProducts(), 220);
  };

  window.changePage = function (p) {
    currentPage = p;
    window.renderProducts();
  };

  window.refreshCurrentModule = async function () {
    window.fullInventory = [];
    currentPage = 1;
    await loadProducts();
  };

  // ── Edit product modal ────────────────────────────────────────
  window.editProduct = function (geo) {
    const item = (window.fullInventory || []).find(i => i.geo === geo);
    if (!item) return;

    populateModalDropdowns();

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('form_geo', item.geo);
    const geoEl = document.getElementById('form_geo');
    if (geoEl) geoEl.readOnly = true;
    set('form_pn', item.pn);
    set('form_un', item.un);
    set('form_cat', item.category);
    set('form_subcat', item.sub_categoria);
    set('form_brand', item.marca);
    set('form_supplier', item.proveedor);
    set('form_min', item.min);
    set('form_max', item.max);
    set('form_cost_clp', item.costo_clp);
    set('form_desc_en', item.en);
    set('form_desc_es', item.es);

    new bootstrap.Modal(document.getElementById('productModal')).show();
  };

  // ── Add new product ───────────────────────────────────────────
  window.openAddProductModal = function () {
    populateModalDropdowns();
    const form = document.getElementById('productForm');
    if (form) form.reset();
    const geoEl = document.getElementById('form_geo');
    if (geoEl) geoEl.readOnly = false;
    new bootstrap.Modal(document.getElementById('productModal')).show();
  };

  // ── Save (add / update) product via REST API ──────────────────
  window.saveProduct = async function () {
    const get = id => document.getElementById(id)?.value?.trim() || '';

    const payload = {
      geo: get('form_geo'),
      pn: get('form_pn'),
      name: get('form_desc_en'),        // use EN desc as name when no separate name field
      description: get('form_desc_en'),
      description_es: get('form_desc_es'),
      category_name: get('form_cat'),
      sub_category_name: get('form_subcat'),
      brand_name: get('form_brand'),
      supplier_name: get('form_supplier'),
      unit: get('form_un'),
      cost: Number(get('form_cost_clp')) || null,
      min_qty: Number(get('form_min')) || null,
      max_qty: Number(get('form_max')) || null,
      is_active: 1
    };

    if (!payload.geo) {
      alert('GEO code is required.');
      return;
    }

    const saveBtn = document.querySelector('#productModal .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...'; }

    try {
      // Use paste-import endpoint to upsert a single product
      await RECON_API._request('/sheets/paste-import', 'POST', {
        table: 'master',
        rows: [[
          payload.geo, payload.pn, payload.name, payload.description, payload.description_es,
          payload.category_name, payload.sub_category_name, payload.brand_name,
          payload.supplier_name, payload.unit, payload.cost, payload.min_qty, payload.max_qty,
          1, 1   // ETA placeholder, is_active
        ]],
        columnMap: {
          0: 'geo', 1: 'pn', 2: 'name', 3: 'description', 4: 'description_es',
          5: 'category', 6: 'sub_category', 7: 'brand', 8: 'supplier', 9: 'unit',
          10: 'cost', 11: 'min_qty', 12: 'max_qty', 13: 'eta', 14: 'is_active'
        },
        hasHeaderRow: false,
        createRefs: true
      });

      const modal = bootstrap.Modal.getInstance(document.getElementById('productModal'));
      if (modal) modal.hide();
      await loadProducts();   // refresh list
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Changes'; }
    }
  };
})();
