(function(){
window.allBundles = [];
window.bundleViewMode = false;

// Helper to use i18n (guard global `t` to avoid redeclaration)
if (typeof window.t === 'undefined') {
  window.t = (key) => (typeof getI18nText === 'function' ? getI18nText(key) : (typeof i18n === 'function' ? i18n(key) : key));
}
var t = window.t;

window.loadBundles = function () {

  google.script.run.withSuccessHandler(function (data) {

    window.allBundles = data;   // 🔥 cache original

    renderBundles(data);

  }).getBundles();

};

window.initBundles = function () {
  console.log("Bundles module loaded");

  window.loadBundles(); // initial table load
};



function renderBundles(data) {

  const tbody = document.getElementById("bundleTableBody");

  tbody.innerHTML = data.map(b => `
    <tr>
      <td>${b.bundleId}</td>
      <td>${b.name}</td>
      <td>${b.isActive ? t('bundle_status_active') : t('bundle_status_inactive')}</td>
      <td>${b.itemCount || 0}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-info"
          onclick="viewBundle('${b.bundleId}')">${t('bundle_view')}</button>

        <button class="btn btn-sm btn-warning"
          onclick="editBundle('${b.bundleId}')">${t('bundle_edit')}</button>
      </td>
    </tr>
  `).join("");

}

window.filterBundles = function () {

  const q = document.getElementById("bundleSearchGlobal").value.toLowerCase();
  const status = document.getElementById("bundleStatusFilter").value;

  let filtered = window.allBundles || [];

  // STATUS FILTER
  if (status !== "all") {
    filtered = filtered.filter(b =>
      String(b.isActive) === status
    );
  }

  // SEARCH FILTER
  if (q) {
    filtered = filtered.filter(b =>
      (b.bundleId + b.name).toLowerCase().includes(q)
    );
  }

  renderBundles(filtered);
};


window.viewBundle = function (bundleId) {

  window.bundleViewMode = true;

  google.script.run.withSuccessHandler(function (data) {

    resetBundleModalUI();
    document.getElementById("bundleModalTitle").innerText = t('bundle_view_title');

    document.getElementById("bundleId").value = data.bundle.bundleId;
    document.getElementById("bundleName").value = data.bundle.name;
    document.getElementById("bundleStatus").value = String(data.bundle.isActive);

    window.bundleItems = data.items || [];

    window.bundleItems = window.bundleItems.map(it => {

      const inv = (window.fullInventory || []).find(x =>
        String(x.geo).trim() === String(it.geo).trim()
      );

      return {
        ...it,
        desc: inv ? (inv.en || inv.es || inv.pn || "") : t('bundle_not_found')
      };

    });

    renderBundleItems();

    setBundleReadonly(true);

    new bootstrap.Modal(document.getElementById("bundleModal")).show();

  }).getBundleDetails(bundleId);
};


window.editBundle = function (bundleId) {

  window.bundleViewMode = false;

  google.script.run.withSuccessHandler(function (data) {
    resetBundleModalUI();
    document.getElementById("bundleModalTitle").innerText = t('bundle_edit_title');

    document.getElementById("bundleId").value = data.bundle.bundleId;
    document.getElementById("bundleName").value = data.bundle.name;
    document.getElementById("bundleStatus").value = String(data.bundle.isActive);

    window.bundleItems = data.items || [];

    window.bundleItems = window.bundleItems.map(it => {

      const inv = (window.fullInventory || []).find(x =>
        String(x.geo).trim() === String(it.geo).trim()
      );

      return {
        ...it,
        desc: inv ? (inv.en || inv.es || inv.pn || "") : t('bundle_not_found')
      };

    });

    renderBundleItems();

    setBundleReadonly(false);

    new bootstrap.Modal(document.getElementById("bundleModal")).show();

  }).getBundleDetails(bundleId);
};


function setBundleReadonly(state) {

  document.getElementById("bundleId").disabled = state;
  document.getElementById("bundleName").disabled = state;
  document.getElementById("bundleStatus").disabled = state;

  document.getElementById("bundleSearch").style.display =
    state ? "none" : "block";

  document.querySelector("#bundleModal .btn-success").style.display =
    state ? "none" : "inline-block";
}


function renderBundleItems() {

  const tbody = document.getElementById("bundleItemsTable");
  if (!tbody) return;

  const items = window.bundleItems || [];
  const isView = window.bundleViewMode === true;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted">
          ${t('bundle_no_items')}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map((it, index) => `

    <tr>

      <!-- GEO -->
      <td>${it.geo}</td>

      <!-- DESCRIPTION (NEW FIX) -->
      <td>${it.desc || it.en || it.es || ""}</td>

      <!-- QTY -->
      <td style="width:120px;">
        <input type="number"
               class="form-control form-control-sm"
               value="${it.qty}"
               ${isView ? "disabled" : ""}
               onchange="updateBundleQty(${index}, this.value)">
      </td>

      <!-- DELETE -->
      <td>
        ${isView ? "" : `
          <button class="btn btn-sm btn-danger"
                  onclick="removeBundleItem(${index})">
            ✕
          </button>
        `}
      </td>

    </tr>

  `).join("");
}


window.searchBundleItems = function () {

  const q = document.getElementById("bundleSearch").value.toLowerCase().trim();
  const tbody = document.getElementById("bundleSearchResults");

  if (!tbody) return;

  if (!q || q.length < 2) {
    tbody.innerHTML = "";
    return;
  }

  const matches = (window.fullInventory || [])
    .filter(i =>
      (String(i.geo) + String(i.en || "") + String(i.es || "") + String(i.pn || ""))
        .toLowerCase()
        .includes(q)
    )
    .slice(0, 15);

  if (matches.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted">
          ${t('msg_no_items')}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = matches.map(i => `

    <tr>

      <td>${i.geo}</td>
      <td>${i.en || i.es || i.pn || ""}</td>

      <td>
        <input type="number"
               id="qty_${i.id}"
               value="1"
               class="form-control form-control-sm"
               style="width:70px">
      </td>

      <td>
        <button class="btn btn-sm btn-primary"
                onclick="addItemToBundle('${i.geo}')">
          +
        </button>
      </td>

    </tr>

  `).join("");
};


window.addItemToBundle = function (geo) {

  const qtyInput = document.getElementById("qty_" + geo);
  const qty = parseInt(qtyInput?.value || 1);

  if (!window.bundleItems) window.bundleItems = [];

  const existing = window.bundleItems.find(i => i.geo === geo);

  if (existing) {
    existing.qty += qty;
  } else {

    const inv = (window.fullInventory || []).find(x => x.geo === geo);

    window.bundleItems.push({
      geo: geo,
      qty: qty,
      desc: inv ? (inv.en || inv.es || inv.pn || "") : ""
    });
  }

  renderBundleItems();
};


window.saveBundle = function () {

  const payload = {
    bundleId: document.getElementById("bundleId").value,
    name: document.getElementById("bundleName").value,
    isActive: document.getElementById("bundleStatus").value,
    items: window.bundleItems || []
  };

  google.script.run
    .withSuccessHandler(function (res) {

      Swal.fire(t('msg_success'), t('bundle_saved_successfully'), "success");

      bootstrap.Modal.getInstance(document.getElementById("bundleModal")).hide();

      loadBundles(); // refresh table

    })
    .withFailureHandler(function (err) {
      Swal.fire(t('msg_error'), String(err), "error");
    })
    .saveBundle(payload);   // 👈 THIS calls BundlesGS.gs
};


function resetBundleModalUI() {

  // clear search input
  const search = document.getElementById("bundleSearch");
  if (search) search.value = "";

  // clear search results
  const results = document.getElementById("bundleSearchResults");
  if (results) results.innerHTML = "";

}


window.openCreateBundleModal = function () {

  window.bundleViewMode = false;
  window.bundleItems = [];

  resetBundleModalUI();

  document.getElementById("bundleModalTitle").innerText = t('bundle_create_title');

  document.getElementById("bundleId").value = "";
  document.getElementById("bundleName").value = "";
  document.getElementById("bundleStatus").value = "true";

  setBundleReadonly(false);

  new bootstrap.Modal(document.getElementById("bundleModal")).show();
};

})();
