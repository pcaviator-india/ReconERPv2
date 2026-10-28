// ============================================================
// ProductsJS.js  — REST API version (replaces google.script.run)
// ============================================================

let currentPage = 1;
const rowsPerPage = 50;
let fullInventory = [];     // local cache of fetched products
let isLoading     = false;
let searchTimer   = null;

window.initProductsModule = async function () {
  window.showStatus && window.showStatus('Loading inventory...');
  await loadProducts();
};

// ── Fetch products from REST API ────────────────────────────
async function loadProducts(params = {}) {
  if (isLoading) return;
  isLoading = true;

  try {
    const resp = await RECON_API.getProducts(params);
    // resp.data is the array; resp.pagination carries totals
    fullInventory = (resp.data || []).map(normalise);
    currentPage   = 1;
    renderProducts();
    updateSyncStatus(fullInventory.length, (resp.pagination || {}).total || fullInventory.length, true);
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
function normalise(p) {
  return {
    geo          : p.geo         || '',
    pn           : p.pn          || '',
    en           : p.description || '',          // English description
    es           : p.description_es || '',       // Spanish description
    name         : p.name        || '',
    category     : p.category_name  || p.category_id  || '',
    sub_categoria: p.sub_category_name || p.sub_category_id || '',
    marca        : p.brand_name  || p.brand_id   || '',
    proveedor    : p.supplier_name || p.supplier_id  || '',
    un           : p.unit        || '',
    stock        : Number(p.stock)    || 0,
    costo_clp    : Number(p.cost)     || 0,
    min          : Number(p.min_qty)  || 0,
    max          : Number(p.max_qty)  || 0,
    is_active    : p.is_active,
    // keep the raw object for edit
    _raw         : p
  };
}

// ── Populate filter dropdowns from loaded data ───────────────
function populateDropdowns() {
  const cats  = [...new Set(fullInventory.map(i => i.category).filter(Boolean))].sort();
  const subs  = [...new Set(fullInventory.map(i => i.sub_categoria).filter(Boolean))].sort();
  const brands= [...new Set(fullInventory.map(i => i.marca).filter(Boolean))].sort();
  const supps = [...new Set(fullInventory.map(i => i.proveedor).filter(Boolean))].sort();

  fillSelect('filterCategory',    cats,  'All Categories');
  fillSelect('filterSubCategory', subs,  'All Subcategories');
  fillSelect('filterBrand',       brands,'All Brands');
  fillSelect('filterSupplier',    supps, 'All Suppliers');
}

function populateModalDropdowns() {
  const cats  = [...new Set(fullInventory.map(i => i.category).filter(Boolean))].sort();
  const subs  = [...new Set(fullInventory.map(i => i.sub_categoria).filter(Boolean))].sort();
  const brands= [...new Set(fullInventory.map(i => i.marca).filter(Boolean))].sort();
  const supps = [...new Set(fullInventory.map(i => i.proveedor).filter(Boolean))].sort();

  fillSelect('form_cat',      cats,   '-- Select Category --');
  fillSelect('form_subcat',   subs,   '-- Select Subcategory --');
  fillSelect('form_brand',    brands, '-- Select Brand --');
  fillSelect('form_supplier', supps,  '-- Select Supplier --');
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
  populateDropdowns();

  const search  = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
  const catF    = document.getElementById('filterCategory')?.value    || '';
  const subF    = document.getElementById('filterSubCategory')?.value || '';
  const brandF  = document.getElementById('filterBrand')?.value       || '';
  const suppF   = document.getElementById('filterSupplier')?.value    || '';

  const terms = search ? search.split(/\s+/).filter(t => t.length > 0) : [];

  const filtered = fullInventory.filter(i => {
    const haystack = (i.geo + ' ' + i.pn + ' ' + i.en + ' ' + i.es + ' ' + i.marca).toLowerCase();
    const matchS    = !terms.length || terms.every(t => haystack.includes(t));
    const matchC    = !catF   || i.category     === catF;
    const matchSub  = !subF   || i.sub_categoria === subF;
    const matchB    = !brandF || i.marca         === brandF;
    const matchSupp = !suppF  || i.proveedor     === suppF;
    return matchS && matchC && matchSub && matchB && matchSupp;
  });

  const totalPages = Math.ceil(filtered.length / rowsPerPage);
  if (currentPage > totalPages) currentPage = 1;
  const paginated  = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

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
  return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  const info      = document.getElementById('paginationInfo');
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
  fullInventory = [];
  currentPage   = 1;
  await loadProducts();
};

// ── Edit product modal ────────────────────────────────────────
window.editProduct = function (geo) {
  const item = fullInventory.find(i => i.geo === geo);
  if (!item) return;

  populateModalDropdowns();

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('form_geo',       item.geo);
  const geoEl = document.getElementById('form_geo');
  if (geoEl) geoEl.readOnly = true;
  set('form_pn',        item.pn);
  set('form_un',        item.un);
  set('form_cat',       item.category);
  set('form_subcat',    item.sub_categoria);
  set('form_brand',     item.marca);
  set('form_supplier',  item.proveedor);
  set('form_min',       item.min);
  set('form_max',       item.max);
  set('form_cost_clp',  item.costo_clp);
  set('form_desc_en',   item.en);
  set('form_desc_es',   item.es);

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
    geo          : get('form_geo'),
    pn           : get('form_pn'),
    name         : get('form_desc_en'),        // use EN desc as name when no separate name field
    description  : get('form_desc_en'),
    description_es: get('form_desc_es'),
    category_name: get('form_cat'),
    sub_category_name: get('form_subcat'),
    brand_name   : get('form_brand'),
    supplier_name: get('form_supplier'),
    unit         : get('form_un'),
    cost         : Number(get('form_cost_clp')) || null,
    min_qty      : Number(get('form_min'))      || null,
    max_qty      : Number(get('form_max'))      || null,
    is_active    : 1
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
      table      : 'master',
      rows       : [[
        payload.geo, payload.pn, payload.name, payload.description, payload.description_es,
        payload.category_name, payload.sub_category_name, payload.brand_name,
        payload.supplier_name, payload.unit, payload.cost, payload.min_qty, payload.max_qty,
        1, 1   // ETA placeholder, is_active
      ]],
      columnMap  : {
        0:'geo', 1:'pn', 2:'name', 3:'description', 4:'description_es',
        5:'category', 6:'sub_category', 7:'brand', 8:'supplier', 9:'unit',
        10:'cost', 11:'min_qty', 12:'max_qty', 13:'eta', 14:'is_active'
      },
      hasHeaderRow: false,
      createRefs  : true
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
