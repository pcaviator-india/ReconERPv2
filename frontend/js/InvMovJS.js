let cart = [];
let selectedProduct = null;
let activeAssignments = [];
let returnSelected = {};
let html5QrCode = null;
let lastScannedCode = null;
let lastScannedTime = 0;
let dailyMovementsCache = [];
let allMovementsCache = [];


window.movementValCache = {
  loaded: false,
  data: {
    Sector: [],
    Maquina: [],
    Generador: [],
    Vehiculo: []
  }
};

// =====================
// INIT
// =====================
window.initInvMovModule = function () {

  cart = [];
  selectedProduct = null;

  document.getElementById("searchBox").value = "";
  document.getElementById("searchResults").innerHTML = "";
  document.getElementById("cartBox").innerHTML = "";

  loadPeopleCache();

  loadMovementValidationCache(function(data) {

    console.log("Validation ready", data);

    populateMovementDropdowns();

    populateReturnFilters();

    initPersonSelectSmartSearch();
    initPersonSearchKeyboard();

  });

  // load active assignments
  google.script.run
    .withSuccessHandler(data => {

      window.activeAssignmentsData = data || [];

      console.log(
        "assignments loaded:",
        window.activeAssignmentsData
      );
      // Safely execute once DOM/Module is ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeDefaultTab);
      } else {
        initializeDefaultTab();
      }

    })
    .getAllActiveAssignments();

  initSmartSearchListener();
};


function showInvTab(tabId, btn = null) {
  const issueTab = document.getElementById("issueTab");
  const returnTab = document.getElementById("returnTab");
  const dailyTab = document.getElementById("dailyTab");

  if (issueTab) issueTab.style.display = "none";
  if (returnTab) returnTab.style.display = "none";
  if (dailyTab) dailyTab.style.display = "none";

  document.querySelectorAll(".nav-tabs .nav-link").forEach(el => el.classList.remove("active"));

  // Support both clean names ("issue", "return", "daily") and full IDs ("issueTab", "returnTab")
  if (tabId === "issue" || tabId === "issueTab") {
    if (issueTab) issueTab.style.display = "block";
  } else if (tabId === "return" || tabId === "returnTab") {
    if (returnTab) returnTab.style.display = "block";
    // Ensure return assignments load when opening the return tab
    if (typeof loadReturnAssignments === "function") {
      loadReturnAssignments();
    }
  } else if (tabId === "daily" || tabId === "dailyTab") {
    if (dailyTab) dailyTab.style.display = "block";
    
    // Set default date range inputs to Today if not set
    const dateFromInput = document.getElementById("daily_filter_date_from");
    const dateToInput = document.getElementById("daily_filter_date_to");
    const todayStr = new Date().toISOString().split("T")[0];
    if (dateFromInput && !dateFromInput.value) {
      dateFromInput.value = todayStr;
    }
    if (dateToInput && !dateToInput.value) {
      dateToInput.value = todayStr;
    }

    // Populate site filter and apply role-based auto-select / lock
    if (typeof populateDailySiteFilter === "function") {
      populateDailySiteFilter();
    }
   // Load ALL movements once
    if (typeof loadAllMovements === "function") {
        loadAllMovements();
    }
  }

  if (btn) btn.classList.add("active");
}



// ====== TARGET DEFAULT SELECTION ON LOAD ======
function initializeDefaultTab() {
  const defaultBtn = document.getElementById("issueTabBtn");
  // Call your tab switcher passing the ID string and the button element
  showInvTab("issueTab", defaultBtn);
    // Apply site lock for USER role
    if (window.currentUser && window.currentUser.site) {
      window.applySiteLock('f_sector', window.currentUser.site);
    }
  }
function loadMovementValidationCache(callback) {

  // If already loaded → reuse
  if (window.movementValCache.loaded) {
    if (callback) callback(window.movementValCache.data);
    return;
  }

  google.script.run
    .withSuccessHandler(res => {

      window.movementValCache.data = res || {
        Sector: [],
        Maquina: [],
        Generador: [],
        Vehiculo: []
      };

      window.movementValCache.loaded = true;

      console.log("Movement Validation Cache Loaded:", window.movementValCache.data);

      if (callback) callback(window.movementValCache.data);

    })
    .getMovementValidation();
}

function populateMovementDropdowns() {

  const data = window.movementValCache?.data;

  if (!data) return;

  buildSelect("sector", data.Sector);
  buildSelect("maquina", data.Maquina);
  buildSelect("generador", data.Generador);
  buildSelect("vehiculo", data.Vehiculo);
}


function buildSelect(id, values) {

  const el = document.getElementById(id);
  if (!el) return;

  el.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.text = (typeof getI18nText === 'function') ? getI18nText('select_option') : 'Select';
  el.appendChild(defaultOpt);

  (values || []).forEach(v => {

    const opt = document.createElement("option");
    opt.value = v;
    opt.text = v;
    el.appendChild(opt);

  });
}

// =====================
// SEARCH
// =====================
function liveSearch() {
  const query = document.getElementById("searchBox").value;
  const results = searchInventory(query);
  renderResults(results);
}

// =====================
// SEARCH ENGINE
// =====================
function searchInventory(query) {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  const terms = q.split(/\s+/).filter(Boolean);

  return window.fullInventory
    .map(item => {
      let score = 0;

      const geo = (item.geo || "").toLowerCase();
      const pn = (item.pn || "").toLowerCase();
      const marca = (item.marca || "").toLowerCase();
      const en = (item.en || "").toLowerCase();
      const es = (item.es || "").toLowerCase();

      // Exact matches (highest priority)
      if (geo === q) score += 100;
      if (pn === q) score += 90;

      // Multi-word support: every term must appear in at least one field
      const allText = `${geo} ${pn} ${marca} ${en} ${es}`;
      const matchesAllTerms = terms.every(term => allText.includes(term));

      if (!matchesAllTerms) {
        return { item, score: 0 }; // discard if not all words match
      }

      // Scoring for partial matches
      if (geo.includes(q)) score += 80;
      if (pn.includes(q)) score += 70;

      // Bonus for individual terms
      terms.forEach(term => {
        if (geo.includes(term)) score += 25;
        if (pn.includes(term)) score += 20;
        if (marca.includes(term)) score += 12;
        if (en.includes(term) || es.includes(term)) score += 10;
      });

      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(x => x.item);
}

// =====================
// RENDER RESULTS
// =====================
function renderResults(results) {

  const container =
    document.getElementById("searchResults");

  container.innerHTML = "";

  if (!results.length) {
    container.innerHTML =
      `<small class='text-muted'>${(typeof getI18nText === 'function') ? getI18nText('msg_no_results') : 'No results'}</small>`;
    return;
  }

  results.forEach(item => {

    const row = document.createElement("div");

    row.className =
      "d-flex align-items-center border rounded p-2 mb-2 small bg-white";

   row.innerHTML = `
      <div style="width:28%">
        <div style="font-weight: bold;">${item.es || ""}</div>
        <div style="font-size: 0.85rem; color: #6c757d; font-weight: normal;">${item.en || ""}</div>
      </div>
      <div style="width:15%">${item.marca || ""}</div>
      <div style="width:15%">${item.pn || ""}</div>
      <div style="width:15%">${item.category || ""}</div>
      <div style="width:10%">${item.stock || 0}</div>
      <div style="width:17%">${item.geo || ""}</div>
    `;

    const btn = document.createElement("button");

    btn.className = "btn btn-sm btn-primary ms-2";

    btn.innerHTML = `
      <i class="bi bi-plus"></i>
    `;

    btn.onclick = function(e) {
      e.stopPropagation();
      addToCart(item);
    };

    row.appendChild(btn);

    container.appendChild(row);

  });
}

function initPeopleDropdowns() {

  if (!window.peopleData) return;

  buildPeopleSelect("person");
  buildPeopleSelect("returnPerson");

}


function buildPeopleSelect(id) {

  const select =
    document.getElementById(id);

  if (!select) return;

  // DESTROY OLD CHOICES INSTANCE
  if (select.choicesInstance) {
    select.choicesInstance.destroy();
  }

  select.innerHTML = "";

  const empty =
    document.createElement("option");

  empty.value = "";
  empty.text = (typeof getI18nText === 'function') ? getI18nText('select_person') : 'Select Person';

  select.appendChild(empty);

  window.peopleData
    .filter(p =>
      p.active === true ||
      p.active === "TRUE" ||
      p.active === 1
    )
    .forEach(p => {

      const opt =
        document.createElement("option");

      opt.value = p.name;

      opt.text = p.name;

      opt.dataset.customProperties =
        JSON.stringify({
          department: p.department || "",
          sector: p.sector || ""
        });

      select.appendChild(opt);

    });

  // CREATE NEW CHOICES INSTANCE

      select.choicesInstance =
    new Choices(select, {

      searchEnabled: true,
      itemSelectText: "",
      shouldSort: false,
      placeholder: true,
      searchPlaceholderValue: (typeof getI18nText === 'function') ? getI18nText('person_search') : 'Search person...',
      noResultsText: (typeof getI18nText === 'function') ? getI18nText('person_no_found') : 'No person found',

      callbackOnCreateTemplates:
        function(template) {

          return {

            choice:
              (classNames, data) => {

                const dept =
                  data.customProperties
                    ?.department || "";

                return template(`

                  <div
                    class="
                      ${classNames.item}
                      ${classNames.itemChoice}
                      p-2
                    "
                    data-select-text=""
                    data-choice
                    data-id="${data.id}"
                    data-value="${data.value}"
                  >

                    <div style="font-weight:600">
                      ${data.label}
                    </div>

                    <div style="
                      font-size:11px;
                      color:#777;
                    ">
                      ${dept}
                    </div>

                  </div>

                `);

              }

          };

        }

    });

  // REMOVE OLD LISTENER
  select.onchange = null;

  // CHANGE EVENT
  select.addEventListener("change", function () {

    // ISSUE PERSON

    if (id === "person") {

      const selected =
        window.peopleData.find(
          p => p.name === select.value
        );

      if (selected) {

        document.getElementById("sector").value =
          selected.sector || "";

      }

    }

    // RETURN PERSON

    if (id === "returnPerson") {

      loadReturnAssignments();

    }

  });

}

// prevent double click issue
function addToCartByClick(e, item) {
  e.stopPropagation();
  addToCart(item);
}


// =====================
// RETURN FROM MOVEMENTS TAB
// Switches to the Issue tab with the item added to the cart as a
// negative ("add back") line, and pre-fills person / sector /
// maquina / generador / vehiculo from the original movement.
// =====================
function returnFromMovement(geo, person, movementId, sector, maquina, generador, vehiculo) {
  if (!geo) return;

  // Prefer the full product data from the master inventory cache
  // (pn / marca / descriptions); fall back to the movement record.
  const inv = (window.fullInventory || []).find(i => String(i.geo) === String(geo)) || {};
  const mov = (allMovementsCache || []).find(m =>
    m.movementId === movementId && String(m.itemGeo) === String(geo)
  ) || {};

  const cartItem = {
    geo: geo,
    pn: inv.pn || "",
    en: inv.en || mov.descEn || "",
    es: inv.es || mov.descEs || "",
    marca: inv.marca || ""
  };

  // If the item is already in the cart, make its line more negative;
  // otherwise add it as a new negative ("add back") line.
  const existing = cart.find(x => x.geo === cartItem.geo);
  if (existing) {
    existing.qty = Number(existing.qty) - 1;
    existing._flash = true;
  } else {
    cart.push({ ...cartItem, qty: -1, _flash: true });
  }

  // ----- Pre-fill person (Choices.js enhanced select) -----
  if (person) {
    const personSelect = document.getElementById("person");
    if (personSelect) {
      // Find the real option value (movement stores the normalized name)
      let actualValue = null;
      Array.from(personSelect.options).forEach(opt => {
        if (!actualValue &&
            opt.value.trim().toLowerCase() === String(person).trim().toLowerCase()) {
          actualValue = opt.value;
        }
      });

      if (personSelect.choicesInstance &&
          typeof personSelect.choicesInstance.setChoiceByValue === "function") {
        personSelect.choicesInstance.setChoiceByValue(actualValue || person);
      } else if (actualValue) {
        personSelect.value = actualValue;
      }
    }
  }

  // ----- Pre-fill sector / maquina / generador / vehiculo (plain selects) -----
  setIssueSelectValue("sector", sector);
  setIssueSelectValue("maquina", maquina);
  setIssueSelectValue("generador", generador);
  setIssueSelectValue("vehiculo", vehiculo);

  renderCart();

  // Switch to the Issue tab so the operator can confirm and submit
  showInvTab("issueTab", document.getElementById("issueTabBtn"));
}

// Sets a plain <select> value case-insensitively; if the value is not
// among the options (not present in the validation cache), the option
// is appended dynamically so the original context is preserved.
function setIssueSelectValue(id, value) {
  if (!value || String(value).trim() === "") return;

  const el = document.getElementById(id);
  if (!el) return;

  const target = String(value).trim();

  let actualValue = null;
  Array.from(el.options).forEach(opt => {
    if (!actualValue &&
        opt.value.trim().toLowerCase() === target.toLowerCase()) {
      actualValue = opt.value;
    }
  });

  if (actualValue) {
    el.value = actualValue;
  } else {
    const opt = document.createElement("option");
    opt.value = target;
    opt.text = target;
    el.appendChild(opt);
    el.value = target;
  }
}


// =====================
// CART
// =====================
function addToCart(item) {
  let exists = cart.find(x => x.geo === item.geo);

  if (exists) exists.qty++;
  else cart.push({...item, qty: 1});

  renderCart();
}

function renderCart() {
  const box = document.getElementById("cartBox");
  box.innerHTML = "";

  if (cart.length === 0) {
    box.innerHTML = "<small>" + i18n("cart_empty") + "</small>";
    return;
  }

  cart.forEach((item, i) => {
    const row = document.createElement("div");
    const isNegative = Number(item.qty) < 0;

    // Negative qty = "add back to stock" line => light red row so the
    // operator clearly sees it is a return, not an issue.
    row.style = `
      display:flex;
      gap:10px;
      align-items:center;
      border:1px solid ${isNegative ? "#f5c2c7" : "#ddd"};
      background:${isNegative ? "#fdecea" : "transparent"};
      padding:6px;
      margin:4px 0;
      border-radius:6px;
      font-size:12px;
    `;

    const qtyDisplay = isNegative
      ? `<span class="fw-bold text-danger">${item.qty}</span>
         <span class="badge bg-danger" style="font-size:9px;">${typeof i18n === "function" ? i18n("lbl_add_back") : "ADD BACK"}</span>`
      : item.qty;

    // One-shot flash highlight (used when added from the Movements tab)
    if (item._flash) {
      row.classList.add("flash-cart");
      delete item._flash;
    }

    row.innerHTML = `
      <div style="width:28%">
          <div style="font-weight: bold;">${item.es || ""}</div>
          <div style="font-size: 0.85rem; color: #6c757d; font-weight: normal;">${item.en || ""}</div>
      </div>      
      <div style="width:15%">${item.marca}</div>
      <div style="width:15%">${item.pn}</div>

      <div style="width:14%; white-space:nowrap;">
        <button onclick="decQty(${i})">-</button>
        ${qtyDisplay}
        <button onclick="incQty(${i})">+</button>
      </div>

      <div style="width:13%">${item.geo}</div>

      <button onclick="removeFromCart(${i})">X</button>
    `;

    box.appendChild(row);
  });
}

function removeFromCart(i){
  cart.splice(i,1);
  renderCart();
}

function clearCart(){
  cart = [];
  renderCart();
}


// =====================
// HELPER: FORCE SITE SELECTION IF MISSING
// =====================
async function ensureUserSite() {
  let secureUserRaw = localStorage.getItem("recon_user_secure");
  let currentUser = secureUserRaw ? JSON.parse(secureUserRaw) : {};

  // If user has a valid site set, return it directly
  if (currentUser && currentUser.site && currentUser.site.trim() !== "") {
    return currentUser.site;
  }

  // Define your system's valid locations/sites here
  const availableSites = {
    "Store": "Store / Bodega Principal",
    "Workshop": "Workshop / Taller",
    "Manto Verde": "Manto Verde"
  };

  // Force SweetAlert Selection Modal
  const { value: selectedSite } = await Swal.fire({
    title: 'Ubicación no encontrada',
    text: 'Su sesión de usuario no tiene un sitio asignado. Por favor, seleccione su ubicación operativa actual:',
    icon: 'warning',
    input: 'select',
    inputOptions: availableSites,
    inputPlaceholder: 'Seleccione Sitio...',
    showCancelButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    confirmButtonText: 'Confirmar Ubicación',
    customClass: {
      confirmButton: 'btn btn-primary'
    },
    inputValidator: (value) => {
      if (!value) {
        return 'Debe seleccionar un sitio para continuar.';
      }
    }
  });

  if (selectedSite) {
    // Save the selected site to the secure user object locally so they aren't prompted again this session
    currentUser.site = selectedSite;
    localStorage.setItem("recon_user_secure", JSON.stringify(currentUser));
    return selectedSite;
  }

  throw new Error("Site selection is required.");
}

// =====================
// BULK ISSUE (NON-BLOCKING) on delay with floating toast 
// =====================
async function bulkIssue() {
  if (cart.length === 0) {
    return alert(i18n("cart_empty"));  
  }

  const person = document.getElementById("person").value;
  if (!person || person.trim() === "") {
    return alert(i18n("select_person"));
  }

  const sector = document.getElementById("sector").value;
  if (!sector || sector.trim() === "") {
    return alert(i18n("select_store") || "Please select a Store/Sector.");
  }

  let userSite;
  try {
    userSite = await ensureUserSite();
  } catch (err) {
    console.error(err);
    return;
  }

  // 1. CAPTURE DATA BEFORE UI RESET
  // We must clone the cart so it isn't wiped out when we unlock the UI.
  // Zero-qty lines (transient state of the +/- buttons) are dropped.
  const payloadItems = JSON.parse(JSON.stringify(cart.filter(it => Number(it.qty) !== 0)));
  const personName = normalizePersonName(person);
  const personId = person;
  const maquinaVal = document.getElementById("maquina").value;
  const generadorVal = document.getElementById("generador").value;
  const vehiculoVal = document.getElementById("vehiculo").value;
  const commentsVal = document.getElementById("comments").value;
  const trackingCondition = document.getElementById("issueIsReturnable").checked ? "Returnable" : "Consumable";
  
  if (payloadItems.length === 0) {
    return alert(i18n("cart_empty"));
  }

  // Soft guard: warn when an "add back" (negative) line exceeds the qty
  // the employee currently holds (active assignments). Not a hard block.
  const negativeLines = payloadItems.filter(it => Number(it.qty) < 0);
  if (negativeLines.length > 0) {
    const over = negativeLines.filter(it => {
      const absQty = Math.abs(Number(it.qty));
      const activeQty = (window.activeAssignmentsData || [])
        .filter(a =>
          normalizePersonName(a.person) === personName &&
          String(a.geo) === String(it.geo)
        )
        .reduce((sum, a) => sum + (Number(a.active) || 0), 0);
      return absQty > activeQty;
    });

    if (over.length > 0) {
      const geoList = over.map(it => it.geo).join(", ");
      const ok = confirm(
        "Warning: return qty exceeds what " + personName +
        " currently holds for: " + geoList +
        ".\n\nContinue anyway?"
      );
      if (!ok) return;
    }
  }
  
  const hseItems = detectHSEItemsInCart();

  // 2. ROUTE TO APPROPRIATE FUNCTION
  if (hseItems.length > 0) {
    showHSEFingerprintModal(personId, hseItems, function(fingerprintData) {
      issueItemsWithHSE(fingerprintData);
    });
  } else {
    issueItemsNormally();
  }

  // ==========================================
  // INNER FUNCTION: NORMAL ISSUE (BACKGROUND)
  // ==========================================
  function issueItemsNormally() {
    const taskId = "NORM_" + new Date().getTime();
    
    // Clear UI IMMEDIATELY to unblock the user
    resetIssueUI();
    addBackgroundQueueTask(taskId, personName);

    google.script.run
      .withSuccessHandler(res => {
        updateBackgroundQueueTask(taskId, res.message || "¡Completado!", "success");
        
        // Silently refresh assignments in background
        google.script.run
          .withSuccessHandler(data => { window.activeAssignmentsData = data || []; })
          .getAllActiveAssignments();
      })
      .withFailureHandler(err => {
        updateBackgroundQueueTask(taskId, "Error: " + err.message, "error");
      })
      .bulkIssueItems({
        items: payloadItems,
        person: personName,
        personId: personId,
        sector: sector,
        maquina: maquinaVal,
        generador: generadorVal,
        vehiculo: vehiculoVal,
        comments: commentsVal,
        condition: trackingCondition,
        userSite: userSite
      });
  }

  // ==========================================
  // INNER FUNCTION: HSE ISSUE (BACKGROUND)
  // ==========================================
  function issueItemsWithHSE(fingerprintData) {
    const taskId = "HSE_" + new Date().getTime();

    // Clear UI IMMEDIATELY to unblock the user
    resetIssueUI();
    addBackgroundQueueTask(taskId, personName);

    // Step 1: Save to Database
    google.script.run
      .withSuccessHandler(res => {
        // Step 2: DB Done, Update status and trigger PDF
        updateBackgroundQueueTask(taskId, "BD Guardada. Generando PDF...", "processing");

        // Silently refresh assignments
        google.script.run
          .withSuccessHandler(data => { window.activeAssignmentsData = data || []; })
          .getAllActiveAssignments();

        // Step 3: Trigger PDF Generation in background
        google.script.run
          .withSuccessHandler(result => {
             updateBackgroundQueueTask(taskId, "HSE Firmado y PDF Listo ✓", "success");
          })
          .withFailureHandler(err => {
             updateBackgroundQueueTask(taskId, "Error PDF: " + err.message, "error");
          })
          .processPendingHSEPDFs();
      })
      .withFailureHandler(err => {
        updateBackgroundQueueTask(taskId, "Error al guardar BD: " + err.message, "error");
      })
      .bulkIssueItems({
        items: payloadItems,
        person: personName,
        personId: personId,
        sector: sector,
        maquina: maquinaVal,
        generador: generadorVal,
        vehiculo: vehiculoVal,
        comments: commentsVal,
        condition: trackingCondition,
        isHSE: true,
        hseItems: hseItems,
        fingerprintBase64: fingerprintData.fingerprintBase64,
        matchScore: fingerprintData.matchScore,
        userSite: userSite
      });
  }
}


function resetIssueUI() {
  // =====================
  // RESET CART
  // =====================
  clearCart(); 

  // =====================
  // RESET SEARCH UI
  // =====================
  const searchBox = document.getElementById("searchBox"); 
  if (searchBox) searchBox.value = ""; 

  const searchResults = document.getElementById("searchResults"); 
  if (searchResults) searchResults.innerHTML = ""; 
  // =====================
  // RESET COMMENTS & CHECKBOX
  // =====================
  const comments = document.getElementById("comments"); 
  if (comments) comments.value = ""; 
  
  const returnableToggle = document.getElementById("issueIsReturnable");
  if (returnableToggle) returnableToggle.checked = false; 

  // =====================
  // OPTIONAL: RESET SELECTED PRODUCT
  // =====================
  selectedProduct = null; 

  // =====================
  // OPTIONAL: RESET MOVEMENT FIELDS
  // =====================
  document.getElementById("sector").value = ""; 
  document.getElementById("maquina").value = ""; 
  document.getElementById("generador").value = ""; 
  document.getElementById("vehiculo").value = ""; 
}

// =====================
// BULK RETURN
// =====================

function bulkReturn(){

  if(cart.length===0)
    return alert(i18n("cart_empty"));

  google.script.run

    .withSuccessHandler(res => {

      alert(res.message);

      clearCart();

      // REFRESH ASSIGNMENT CACHE

      google.script.run
        .withSuccessHandler(data => {

          window.activeAssignmentsData =
            data || [];

          console.log(
            "Assignments cache refreshed"
          );

        })
        .getAllActiveAssignments();

    })

    .bulkReturnItems({

      items: cart,

      person : normalizePersonName(
        document.getElementById("person").value
      ),

      sector:
        document.getElementById("sector").value,

      comments:
        document.getElementById("comments").value

    });

}

function incQty(i){
  cart[i].qty++;
  renderCart();
}

function decQty(i){
  cart[i].qty--;
  // Allow going negative (exchange / unused return => add back to stock).
  // Rows are removed only via the X button.
  if(cart[i].qty < -99){
    cart[i].qty = -99;
  }
  renderCart();
}

// If not found → fallback to normal search

/**
 * DETECT HSE ITEMS IN CART
 
function detectHSEItemsInCart() {
  const hseItems = [];
  const masterData = window.fullInventory || [];
  
  cart.forEach(cartItem => {
    const found = masterData.find(m => 
      String(m.geo || "").toUpperCase() === String(cartItem.geo || "").toUpperCase()
    );
    
    console.log("Found category ",found.category);
    console.log("Found category ",found.sub_categoria);
    
   if (
      found &&
      found.category?.toLowerCase() === "operaciones" &&
      ["epp", "hse"].includes(found.sub_categoria?.toLowerCase())
    ) {
      hseItems.push({
        geo: cartItem.geo,
        en: found.en || "",
        es: found.es || "",
        qty: cartItem.qty,
        category: found.category,
        sub_categoria: found.sub_categoria
      });
    }
  });
  
  return hseItems;
}
*/
function detectHSEItemsInCart() {
  const hseItems = [];
  const masterData = window.fullInventory || [];
  
  cart.forEach(cartItem => {
    // Negative (add-back) and zero lines are returns, not issues:
    // they must not trigger the HSE fingerprint flow.
    if (Number(cartItem.qty) <= 0) return;

    const found = masterData.find(m => 
      String(m.geo || "").toUpperCase() === String(cartItem.geo || "").toUpperCase()
    );

    console.log(`Processing item:`, cartItem);
    console.log(`Found match in masterData:`, found);

    if (!found) {
      console.warn(`No match found for geo ${cartItem.geo}`);
      return;
    }

    console.log("Category levels:", {
      category: found.category,
      sub_categoria: found.sub_categoria
    });

    const isOperations = found.category?.trim().toLowerCase() === "operaciones";
    const isEppOrHse = ["epp", "hse"].includes(found.sub_categoria?.toLowerCase());

    if (isOperations && isEppOrHse) {
      console.log(`Match found: ${found.en} belongs to HSE category`);
      hseItems.push({
        geo: cartItem.geo,
        en: found.en || "",
        es: found.es || "",
        qty: cartItem.qty,
        category: found.category,
        sub_categoria: found.sub_categoria
      });
    }
  });

  console.log("HSE items detected:", hseItems);
  return hseItems;
}



/**
 * SHOW HSE FINGERPRINT MODAL & CAPTURE
 
function showHSEFingerprintModal(personId, hseItems, callback) {
  const modal = document.createElement("div");
  modal.id = "hseModal";
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0,0,0,0.5); display: flex; align-items: center;
    justify-content: center; z-index: 9999;
  `;
  
  const content = document.createElement("div");
  content.style.cssText = `
    background: white; padding: 30px; border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2); max-width: 500px;
    width: 90%; text-align: center; font-family: Arial, sans-serif;
  `;
  
  let fingerprintState = { captured: false, data: null, score: 0 };
  
  content.innerHTML = `
    <h2 style="color: #e74c3c; margin-bottom: 10px;">HSE Fingerprint Verification</h2>
    <p style="color: #666; margin-bottom: 20px;">
      <strong>${hseItems.length} HSE Item(s)</strong> requires fingerprint signature
    </p>
    
    <div id="hseScore" style="font-size: 14px; color: #666; min-height: 20px; margin-bottom: 15px;"></div>
    
    <button id="hsePressButton" style="
      padding: 15px 30px; font-size: 16px; font-weight: bold;
      background-color: #3498db; color: white; border: none;
      border-radius: 4px; cursor: pointer; width: 100%; margin-bottom: 10px;
    ">Press Finger to Verify</button>
    
    <div id="hseError" style="color: #c0392b; font-size: 13px; margin-bottom: 10px; display: none;"></div>
    
    <div style="display: flex; gap: 10px; margin-top: 15px;">
      <button id="hseRetry" style="
        flex: 1; padding: 10px; background-color: #95a5a6; color: white;
        border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
      ">Retry</button>
      <button id="hseConfirm" style="
        flex: 1; padding: 10px; background-color: #27ae60; color: white;
        border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
        opacity: 0.5; cursor: not-allowed;
      " disabled>Confirm</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  const pressBtn = document.getElementById("hsePressButton");
  const retryBtn = document.getElementById("hseRetry");
  const confirmBtn = document.getElementById("hseConfirm");
  const scoreDiv = document.getElementById("hseScore");
  const errorDiv = document.getElementById("hseError");
  
  // Get person biometric template
  google.script.run.withSuccessHandler(function(person) {
    if (!person || !person.biometricTemplate) {
      errorDiv.textContent = "No biometric template found for this person.";
      errorDiv.style.display = "block";
      pressBtn.disabled = true;
      return;
    }
    
    pressBtn.addEventListener("click", function() {
      pressBtn.disabled = true;
      scoreDiv.textContent = "Contacting scanner...";
      
      captureFingerprintFromScanner(person.biometricTemplate, function(result) {
        if (result.success) {
          fingerprintState.captured = true;
          fingerprintState.data = result.fingerprintBase64;
          fingerprintState.score = result.matchScore;
          
          scoreDiv.textContent = `Score: ${result.matchScore}/100 - ${result.match ? "✓ MATCH" : "✗ MISMATCH"}`;
          scoreDiv.style.color = result.match ? "#27ae60" : "#c0392b";
          
          if (result.match && result.matchScore >= 60) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = "1";
            confirmBtn.style.cursor = "pointer";
          }
          pressBtn.disabled = false;
        } else {
          errorDiv.textContent = result.error || "Fingerprint capture failed";
          errorDiv.style.display = "block";
          pressBtn.disabled = false;
        }
      });
    });
    
  }).getPersonById(personId);
  
  retryBtn.addEventListener("click", function() {
    scoreDiv.textContent = "";
    errorDiv.textContent = "";
    errorDiv.style.display = "none";
    fingerprintState = { captured: false, data: null, score: 0 };
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = "0.5";
    pressBtn.disabled = false;
  });
  
  confirmBtn.addEventListener("click", function() {

    console.log("DEBUG: Confirm clicked. State captured:", fingerprintState.captured);
    console.log("DEBUG: Data presence check:", !!fingerprintState.data);
    console.log("DEBUG: Actual data snippet:", fingerprintState.data ? fingerprintState.data.substring(0, 30) : "NULL");

    if (fingerprintState.captured) {
      modal.remove();
      callback({
        fingerprintBase64: fingerprintState.data,
        matchScore: fingerprintState.score
      });
    }
  });
}
*/
/**
 * CAPTURE FINGERPRINT FROM C# SCANNER SERVER
 */
function captureFingerprintFromScanner(biometricTemplate, callback) {
  const serverUrl = "http://127.0.0.1:8888/scan/";
  const payload = { template: biometricTemplate };

  fetch(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(function(res) {
      if (!res.ok) throw new Error("Local server HTTP error: " + res.status);
      return res.text();
    })
    .then(function(rawText) {
      const cleanText = rawText.trim();
      const data = JSON.parse(cleanText);

      if (data && data.status === "success") {
        callback({
          success: true,
          match: data.match || false,
          matchScore: data.score || 0,
          fingerprintBase64: data.image || "" ,
          template: data.template
        });
      } else {
        callback({
          success: false,
          error: data.message || "Scanner error"
        });
      }
    })
    .catch(function(err) {
      callback({
        success: false,
        error: "Fingerprint scanner unavailable. Issue cannot proceed. " + err.message
      });
    });
}




function handleSearchEnter(event) {
  if (event.key !== "Enter") return;
  const value = event.target.value.trim().toLowerCase();
  if (!value) return;
  const item = window.fullInventory.find(p =>
    (String(p.pn || "").toUpperCase() === value.toUpperCase()) ||
    (String(p.geo || "").toUpperCase() === value.toUpperCase())
  );
  if (item) {
    addToCart(item);
    document.getElementById("searchBox").value = "";
    document.getElementById("searchResults").innerHTML = "";
  } else {
    const results = searchInventory(value);
    renderResults(results);
  }
}
function loadPeopleList() {
  const list = document.getElementById("peopleList");
  list.innerHTML = "";

  window.peopleData.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    list.appendChild(opt);
  });
}

document.addEventListener("change", function(e) {

  if (e.target?.id === "showAllAssignments") {
    loadReturnAssignments();
  }

});

// =====================
// SITE FILTER: populate dropdown + role-based auto-select/lock
// =====================
function populateDailySiteFilter() {
  const siteSelect = document.getElementById("daily_filter_site");
  if (!siteSelect) return;

  // Collect available sites from the global validation cache
  const sitesSrc = (window.CachedDataVal && Array.isArray(window.CachedDataVal.sites))
    ? window.CachedDataVal.sites
    : (window.cachedSites || []);

  const siteNames = sitesSrc
    .map(s => String((s && s.name) || s || "").trim())
    .filter(Boolean);

  if (siteNames.length) {
    const allLabel = (typeof i18n === "function") ? i18n("all_sites") : "All Sites";
    siteSelect.innerHTML =
      `<option value="">${allLabel}</option>` +
      siteNames.map(n => `<option value="${n}">${n}</option>`).join("");
  }

  // Resolve current user (same source of truth as other modules)
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("recon_user_secure") || "null");
  } catch (e) {
    console.warn("populateDailySiteFilter: failed to parse user", e);
  }

  if (user && user.site) {
    if (String(user.role || "").toLowerCase() === "user") {
      // USER role: LOCK to their assigned site (Index.html helper).
      // applySiteLock also dispatches a change event, which re-applies filters.
      if (typeof window.applySiteLock === "function") {
        window.applySiteLock("daily_filter_site", user.site);
      } else {
        siteSelect.value = user.site;
        siteSelect.disabled = true;
        siteSelect.style.backgroundColor = "#e9ecef";
        siteSelect.title = "Site locked for your role";
      }
    } else if (siteNames.includes(user.site)) {
      // Admin / Office / Manager: auto-select their site but keep it editable
      siteSelect.value = user.site;
    }
  }
}


function loadReturnAssignments() {
  const showAllCheck = document.getElementById("showAllAssignments");
  const personSelect = document.getElementById("returnPerson");
  
  const showAll = showAllCheck?.checked;
  const personInput = personSelect?.value || "";
  const normalizedPerson = normalizePersonName(personInput);

  // Sync UI: Disable dropdown if "Show All" is checked
  if (personSelect) {
    personSelect.disabled = showAll;
    // If using Choices.js
    if (personSelect.choicesInstance) {
      showAll ? personSelect.choicesInstance.disable() : personSelect.choicesInstance.enable();
    }
  }

  if (!window.activeAssignmentsData) return;

  // Filter Logic
  activeAssignments = window.activeAssignmentsData
    .filter(x => {
      if (showAll) return true; 
      return normalizePersonName(x.person) === normalizedPerson;
    })
    .map(x => {
      const inv = window.fullInventory?.find(i => i.geo === x.geo) || {}; 
      return {
        ...x,
        pn: inv.pn || "",
        en: inv.en || "",
        marca: inv.marca || ""
      }; 
    });

  renderReturnAssignments(activeAssignments); 
  populateReturnFilters(activeAssignments); 
}



function applyReturnFilters() {
  // 1. Get Values from UI
  const q = document.getElementById("returnSearch").value.toLowerCase().trim();
  const showAll = document.getElementById("showAllAssignments")?.checked;
  const selectedPerson = (document.getElementById("returnPerson")?.value || "").toUpperCase();
  
  const f_sector = document.getElementById("f_sector").value;
  const f_maquina = document.getElementById("f_maquina").value;
  const f_generador = document.getElementById("f_generador").value;
  const f_vehiculo = document.getElementById("f_vehiculo").value;

  // Enrich data WITH Master Inventory info FIRST before filtering
  const enrichedMaster = (window.activeAssignmentsData || []).map(x => {
    const inv = window.fullInventory?.find(i => i.geo === x.geo) || {};
    return { 
      ...x, 
      pn: inv.pn || "", 
      en: inv.en || "", 
      marca: inv.marca || "" 
    };
  });

  // 2. Filter from the freshly enriched list
  const filtered = enrichedMaster.filter(item => {
    
    // A. Person logic (respecting the toggle)
    const matchesPerson = showAll ? true : (item.person || "").toUpperCase() === selectedPerson;

    // B. Search bar logic
    const matchesSearch = !q || (
      matchesMultiWord(item.geo, q) ||
      matchesMultiWord(item.pn, q) ||
      matchesMultiWord(item.en || item.marca, q) ||
      matchesMultiWord(item.person, q)
    );

    // C. Smart Filters logic (Sector, Maquina, etc.)
    const matchesSmart = 
      (!f_sector || item.sector === f_sector) &&
      (!f_maquina || item.maquina === f_maquina) &&
      (!f_generador || item.generador === f_generador) &&
      (!f_vehiculo || item.vehiculo === f_vehiculo);

    return matchesPerson && matchesSearch && matchesSmart;
  });

  // 3. Assign directly to active assignments and render globally
  activeAssignments = filtered;
  renderReturnAssignments(activeAssignments);
}



function normalizePersonName(name) {

  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

}

function renderReturnAssignments(items) {
  const box = document.getElementById("returnItemsBox");
  box.innerHTML = "";

  if (!items.length) {
    box.innerHTML = "<div class='p-3 text-center text-muted'><small>" + i18n("msg_no_items") + "</small></div>";
    return;
  }

  // HEADER - Updated with Person Column
  const header = document.createElement("div");
  header.style = "display:flex; gap:8px; align-items:center; padding:10px; border-bottom:2px solid #dee2e6; font-size:11px; font-weight:bold; text-transform:uppercase; background:#f8f9fa;";
  header.innerHTML = `
    <div style="width:4%"></div>
    <div style="width:12%">GEO</div>
    <div style="width:12%">PERSON</div>
    <div style="width:10%">PN</div>
    <div style="width:18%">DESCRIPTION</div>
    <div style="width:5%">QTY</div>
    <div style="width:18%">CONTEXT</div>
    <div style="width:8%">MOVE ID</div>
    <div style="width:13%">TIME</div>
  `;
  box.appendChild(header);

  items.forEach((item, i) => {
    const key = getReturnKey(item);
    const isSelected = !!returnSelected[key];

    const row = document.createElement("div");
    row.style = `display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid #eee; font-size:12px; cursor:pointer; background: ${isSelected ? "#eef5ff" : "transparent"};`;

    row.onclick = function (e) {
      if (e.target.tagName === "INPUT") return;
      returnSelected[key] = !returnSelected[key];
      renderReturnAssignments(items);
    };

    row.innerHTML = `
      <div style="width:4%">
        <input type="checkbox" id="retCheck_${i}" ${isSelected ? "checked" : ""}>
      </div>
      <div style="width:12%"><span class="badge bg-light text-dark border">${item.geo}</span></div>
      <div style="width:12%"><span class="fw-bold text-primary">${item.person || "-"}</span></div>
      <div style="width:10%">${item.pn || ""}</div>
      <div style="width:18%">${item.en || ""}</div>
      <div style="width:5%" class="fw-bold">${item.active}</div>
      <div style="width:18%; font-size:10px; color:#666">
        ${item.sector || ""} ${item.maquina || ""}
      </div>
      <div style="width:8%; font-size:10px">${item.movementId || "-"}</div>
      <div style="width:13%; font-size:10px" class="text-muted">${item.timestamp || "-"}</div>
    `;
    box.appendChild(row);
  });
}

function toggleReturnSelect(key) {
  returnSelected[key] = !returnSelected[key];
  loadReturnAssignments(); 
}

function getReturnKey(item) {
  return `${item.movementId || ""}||${item.geo || ""}`;
}


function populateReturnFilters() {

  const data = window.movementValCache?.data;

  if (!data) return;

  buildSelect("f_sector", data.Sector);
  buildSelect("f_maquina", data.Maquina);
  buildSelect("f_generador", data.Generador);
  buildSelect("f_vehiculo", data.Vehiculo);
}


function filterReturnItems() {
  const q = document.getElementById("returnSearch").value.toLowerCase().trim();
  const showAll = document.getElementById("showAllAssignments")?.checked;
  const selectedPerson = (document.getElementById("returnPerson")?.value || "").toUpperCase();

  // 1. Always start from the Master Cache
  let sourceData = window.activeAssignmentsData || [];

  // 2. Apply the Toggle/Dropdown logic FIRST
  if (!showAll && selectedPerson) {
    sourceData = sourceData.filter(item => 
      (item.person || "").toUpperCase() === selectedPerson
    );
  }

  // 3. Apply the Text Search (Geo, PN, EN, Person, etc.)
  const filtered = sourceData.filter(item => {
    if (!q) return true; 
    
    return (
      (item.geo || "").toLowerCase().includes(q) ||
      (item.pn || "").toLowerCase().includes(q) ||
      (item.en || "").toLowerCase().includes(q) ||
      (item.marca || "").toLowerCase().includes(q) ||
      (item.person || "").toLowerCase().includes(q)
    );
  });

  // 4. Update the global activeAssignments and render
  activeAssignments = filtered; 
  renderReturnAssignments(activeAssignments);
}
// =====================
// SUBMIT RETURNS (UPDATED)
// =====================
async function submitReturns() {  
  const person = normalizePersonName(
    document.getElementById("returnPerson").value
  );

  if (!person) {
    alert(i18n("select_person"));
    return;
  }

  let userSite;
  try {
    // Strictly retrieve or force selection of the operating site
    userSite = await ensureUserSite();
  } catch (err) {
    console.error(err);
    return; // Block execution
  }

  const selected = [];
  activeAssignments.forEach((item, i) => {
    const checked = document.getElementById(`retCheck_${i}`).checked;
    if (!checked) return;

    const qty = Number(document.getElementById(`retQty_${i}`).value) || 0;
    if (qty <= 0) return;

    if (qty > item.active) {
      alert(`Over-return not allowed for ${item.geo}`);
      return;
    }

    selected.push({
      geo: item.geo,
      qty: qty
    });
  });

  if (!selected.length) {
    alert(i18n("msg_no_items"));
    return;
  }

  const payload = {
    items: selected,
    person: person,
    sector: "", 
    comments: "",
    userSite: userSite // <--- Sourced Site
  };

  google.script.run
    .withSuccessHandler(res => {
      alert(res.message);
      google.script.run
        .withSuccessHandler(data => {
          window.activeAssignmentsData = data || [];
          loadReturnAssignments();
        })
        .getAllActiveAssignments();
    })
    .bulkReturnItems(payload);
}

/*
function submitReturns() {  
  
  const person =
  normalizePersonName(
    document.getElementById("returnPerson").value
  );

  if (!person) {
    alert(i18n("select_person"));
    return;
  }

  const selected = [];

  activeAssignments.forEach((item, i) => {

    const checked =
      document.getElementById(`retCheck_${i}`).checked;

    if (!checked) return;

    const qty = Number(
      document.getElementById(`retQty_${i}`).value
    ) || 0;

    if (qty <= 0) return;

    if (qty > item.active) {
      alert(`Over-return not allowed for ${item.geo}`);
      return;
    }

    selected.push({
      geo: item.geo,
      qty: qty
    });

  });

  if (!selected.length) {
    alert(i18n("msg_no_items"));
    return;
  }

  const payload = {
    items: selected,
    person: person,
    sector: "",
    comments: ""
  };

  google.script.run
    .withSuccessHandler(res => {

      alert(res.message);

      // refresh assignment cache from server
      google.script.run
        .withSuccessHandler(data => {

          window.activeAssignmentsData = data || [];

          // reload UI using fresh data
          loadReturnAssignments();

        })
        .getAllActiveAssignments();
      })

    .bulkReturnItems(payload);
}
*/


// people functions

let editingPersonId = null;

function openPeopleModal() {

  renderPeopleTable();

  const modal =
    new bootstrap.Modal(
      document.getElementById("peopleModal")
    );

  modal.show();
}

/*
function renderPeopleTable() {

  const box =
    document.getElementById("peopleTable");

  box.innerHTML = "";

  const activePeople = [...(window.peopleData || [])].sort((a, b) => {
    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  let html = `

    <table class="table table-bordered table-hover">

      <thead class="table-dark">

        <tr>
          <th>Name</th>
          <th>Department</th>
          <th>Sector</th>
          <th>Rut</th>
          <th>Email</th>
          <th>Status</th>
          <th width="140">Actions</th>
        </tr>

      </thead>

      <tbody>
  `;

  //  Edit button logic with this:
    activePeople.forEach((p, index) => { 
        html += `
          <tr>
            <td>${p.name || ""}</td>
            <td>${p.department || ""}</td>
            <td>${p.sector || ""}</td>
            <td>${p.rut || ""}</td>
            <td>${p.email || ""}</td> 
            <td>
              ${p.active ? `<span class="badge bg-success">ACTIVE</span>` : `<span class="badge bg-danger">INACTIVE</span>`}
            </td>
            <td>
              <button class="btn btn-sm ${p.active ? "btn-danger" : "btn-success"}" onclick='togglePersonStatus("${p.id}", ${p.active})'>
                ${p.active ? "Deactivate" : "Activate"}
              </button>

              <button 
                class="btn btn-sm btn-warning edit-person-btn" 
                data-id="${p.id}"
                data-name="${p.name || ""}"
                data-dept="${p.department || ""}"
                data-sector="${p.sector || ""}"
                data-rut="${p.rut || ""}"
                data-email="${p.email || ""}"
                onclick="handleEditClick(this)"
              >
                Edit
              </button>
            </td>
          </tr>
        `;
    });

  html += `
      </tbody>
    </table>
  `;

  box.innerHTML = html;
}

*/


function renderPeopleTable() {
  const box = document.getElementById("peopleTable");
  box.innerHTML = "";

  // 1. Grab the search query and format it for comparison
  const searchInput = document.getElementById("peopleSearchInput");
  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";

  // 2. Filter the data based on Name, RUT, or Email
  const activePeople = (window.peopleData || []).filter(p => {
    if (!query) return true;

    const name = (p.name || "").toLowerCase();
    const rut = (p.rut || "").toLowerCase();
    const email = (p.email || "").toLowerCase();

    return name.includes(query) || rut.includes(query) || email.includes(query);
  });

  // 3. Build the table framework (Reduced Actions column width)
  let html = `
    <table class="table table-bordered table-hover align-middle">
      <thead class="table-dark">
        <tr>
          <th>Name</th>
          <th>Department</th>
          <th>Sector</th>
          <th>Rut</th>
          <th>Email</th>
          <th>Status</th>
          <th width="100" class="text-center">Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  // 4. Generate rows using the filtered list
  if (activePeople.length === 0) {
    html += `<tr><td colspan="7" class="text-center text-muted py-3">No people found matching "${query}"</td></tr>`;
  } else {
    activePeople.forEach((p, index) => { 
      html += `
        <tr>
          <td>${p.name || ""}</td>
          <td>${p.department || ""}</td>
          <td>${p.sector || ""}</td>
          <td>${p.rut || ""}</td>
          <td>${p.email || ""}</td> 
          <td>
            ${p.active ? `<span class="badge bg-success">ACTIVE</span>` : `<span class="badge bg-danger">INACTIVE</span>`}
          </td>
          <td class="text-center">
            
            <!-- Activate/Deactivate Icon Button -->
            <button 
              class="btn btn-sm ${p.active ? "btn-danger" : "btn-success"} me-1" 
              onclick='togglePersonStatus("${p.id}", ${p.active})'
              title="${p.active ? "Deactivate Person" : "Activate Person"}"
            >
              ${p.active ? `<i class="bi bi-person-x-fill"></i>` : `<i class="bi bi-person-check-fill"></i>`}
            </button>

            <!-- Edit Icon Button -->
            <button 
              class="btn btn-sm btn-warning edit-person-btn" 
              data-id="${p.id}"
              data-name="${p.name || ""}"
              data-dept="${p.department || ""}"
              data-sector="${p.sector || ""}"
              data-rut="${p.rut || ""}"
              data-email="${p.email || ""}"
              onclick="handleEditClick(this)"
              title="Edit Person"
            >
              <i class="bi bi-pencil-square"></i>
            </button>

          </td>
        </tr>
      `;
    });
  }

  html += `
      </tbody>
    </table>
  `;

  box.innerHTML = html;
}


function handleEditClick(btn) {
    editingPersonId = btn.getAttribute("data-id");

    document.getElementById("p_name").value = btn.getAttribute("data-name");
    document.getElementById("p_department").value = btn.getAttribute("data-dept");
    document.getElementById("p_sector").value = btn.getAttribute("data-sector");
    document.getElementById("p_rut").value = btn.getAttribute("data-rut");
    document.getElementById("p_email").value = btn.getAttribute("data-email");

    document.getElementById("p_name").focus();
}


function editPerson(p) {

  editingPersonId = p.id;

  document.getElementById("p_name").value = p.name || "";

  document.getElementById("p_department").value = p.department || "";

  document.getElementById("p_sector").value = p.sector || "";

  document.getElementById("p_rut").value = p.rut || "";
  document.getElementById("p_email").value = p.email || "";

}

function savePerson() {
  const rawRut = document.getElementById("p_rut").value;

  const rutCheck = cleanAndValidateRut(rawRut);
  if (!rutCheck.valid) {
    alert(`Cannot Save: The RUT "${rawRut}" is invalid. Please confirm the number and check digit format.`);
    return; 
  }

  const existingPerson = (window.peopleData || []).find(p => String(p.id) === String(editingPersonId));
  const currentActiveStatus = existingPerson ? existingPerson.active : true;

  const payload = {
    id: editingPersonId,
    name: document.getElementById("p_name").value,
    department: document.getElementById("p_department").value,
    active: currentActiveStatus, 
    sector: document.getElementById("p_sector").value, // Default Sector
    notes: existingPerson ? (existingPerson.notes || "") : "", // Notes
    rut: rutCheck.formatted, 
    biometricTemplate: document.getElementById("p_biometricTemplate").value,
    email: document.getElementById("p_email").value 
  };

  google.script.run
    .withSuccessHandler(res => {
      alert(res.message);
      loadPeopleCache();
      clearPeopleForm();
    })
    .savePerson(payload);
}




function clearPeopleForm() {

  editingPersonId = null;

  document.getElementById("p_name").value = "";
  document.getElementById("p_department").value = "";
  document.getElementById("p_sector").value = "";
  document.getElementById("p_rut").value="";
  document.getElementById("p_email").value = "";
  document.getElementById("p_biometricTemplate").value="";

  const enrollBtn = document.getElementById("enrollBtn");
  enrollBtn.textContent = "Enroll Fingerprint";
  enrollBtn.disabled = false;
}

function loadPeopleCache() {

  google.script.run
    .withSuccessHandler(data => {

      window.peopleData = data || [];

      initPeopleDropdowns();

      renderPeopleTable();

    })
    .getPeople();
}


function togglePersonStatus(id, currentStatus) {

  const action =
    currentStatus
      ? "deactivate"
      : "activate";

  if (!confirm(`Are you sure to ${action} this person?`)) {
    return;
  }

  google.script.run
    .withSuccessHandler(res => {

      alert(res.message);

      loadPeopleCache();

    })
    .togglePersonStatus(id, !currentStatus);

}
// working initsmartsearch, blocked to test new @ feature in searchbox for person

/*
function initSmartSearchListener() {
  const boxes = [
    document.getElementById("searchBox"),
    document.getElementById("returnSearch")
  ];

  boxes.forEach(box => {
    if (!box) return;

    box.addEventListener("input", function () {
      const value = box.value.trim();
      if (!value) return;

      // STEP 1: exact match by ID or RUT (barcode scan)
      const person = window.peopleData?.find(p =>
        (p.id || "") === value ||
        (p.rut || "") === value
      );

      if (person) {
        console.log("👤 Person detected:", person.name);

        const isIssueActive =
          document.getElementById("issueTab")?.style.display !== "none";
        const isReturnActive =
          document.getElementById("returnTab")?.style.display !== "none";

        // ISSUE TAB
        if (isIssueActive && box.id === "searchBox") {
          const select = document.getElementById("person");
          if (select) {
            select.value = person.name;
            if (select.choicesInstance) {
              select.choicesInstance.setChoiceByValue(person.name);
            }
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          box.value = "";
          return;
        }

        // RETURN TAB
        if (isReturnActive && box.id === "returnSearch") {
          const select = document.getElementById("returnPerson");
          if (select) {
            select.value = person.name;
            if (select.choicesInstance) {
              select.choicesInstance.setChoiceByValue(person.name);
            }
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          box.value = "";
          return;
        }

        return;
      }

      // STEP 2: normal product search
      if (box.id === "searchBox") {
        liveSearch();
      }

      if (box.id === "returnSearch") {
        applyReturnFilters();
      }
    });
  });
}
*/

// new initsmartsearch block

function initSmartSearchListener() {
  const boxes = [
    document.getElementById("searchBox"),
    document.getElementById("returnSearch")
  ];

  boxes.forEach(box => {
    if (!box) return;

    box.addEventListener("input", function () {
      const value = box.value.trim();
      if (!value) {
        // Clear results when empty
        if (box.id === "searchBox") {
          document.getElementById("searchResults").innerHTML = "";
        }
        return;
      }

      // ============================================
      // PRIORITY 1: Exact ID or RUT (barcode scan)
      // ============================================
      const personById = window.peopleData?.find(p =>
        (p.id || "") === value ||
        (p.rut || "") === value
      );

      if (personById) {
        console.log("👤 Person detected by ID/RUT:", personById.name);
        selectPerson(personById, box);
        return;
      }

      // ============================================
      // PRIORITY 2: Starts with @ → Person name search
      // ============================================
      if (value.startsWith("@")) {
        const query = value.slice(1).trim(); // remove the @

        if (query.length < 2) {
          // Too short, don't search yet
          if (box.id === "searchBox") {
            document.getElementById("searchResults").innerHTML = 
              `<div class="list-group-item text-muted">Escribe al menos 2 letras...</div>`;
          }
          return;
        }

        const matches = (window.peopleData || []).filter(p =>
          matchesName(p.name, query)
        );

        showPeopleResults(matches, box);
        return;
      }

      // ============================================
      // PRIORITY 3: Normal product search
      // ============================================
      if (box.id === "searchBox") {
        liveSearch();
      }
      if (box.id === "returnSearch") {
        applyReturnFilters();
      }
    });
  });
}

// ---------- Helpers ----------

function initPersonSearchKeyboard() {
  const boxes = [
    document.getElementById("searchBox"),
    document.getElementById("returnSearch")
  ];

  boxes.forEach(box => {
    if (!box) return;

    // Remove old listeners if any (optional safety)
    box.removeEventListener("keydown", box._personKeyHandler, true);

    box._personKeyHandler = function (e) {
      handlePersonKeyboard(e, this);
    };

    box.addEventListener("keydown", box._personKeyHandler, true); // capture = true
  });
}

function matchesName(fullName, query) {
  if (!fullName || !query) return false;
  const name = fullName.toLowerCase();
  const queryParts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return queryParts.every(part => name.includes(part));
}

function selectPerson(person, box) {
  const isIssueActive = document.getElementById("issueTab")?.style.display !== "none";
  const isReturnActive = document.getElementById("returnTab")?.style.display !== "none";

  let select = null;

  if (isIssueActive && box.id === "searchBox") {
    select = document.getElementById("person");
  } else if (isReturnActive && box.id === "returnSearch") {
    select = document.getElementById("returnPerson");
  }

  if (select && select.choicesInstance) {
    const choices = select.choicesInstance;
    choices.removeActiveItems();
    choices.setChoiceByValue(person.name);
    select.value = person.name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (select) {
    select.value = person.name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Clear input
  box.value = "";

  // Clear results
  if (box.id === "searchBox") {
    document.getElementById("searchResults").innerHTML = "";
  } else {
    const floating = document.getElementById("returnPersonResults");
    if (floating) floating.innerHTML = "";
  }

  console.log("✅ Person selected:", person.name);
}

function matchesMultiWord(text, query) {
  if (!query) return true;
  if (!text) return false;

  const textLower = text.toLowerCase();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

  // Every word typed must appear somewhere in the text
  return terms.every(term => textLower.includes(term));
}

function showPeopleResults(people, box) {
  let container;

  if (box.id === "searchBox") {
    // Issue tab → use existing results container
    container = document.getElementById("searchResults");
  } else {
    // Return tab → create / reuse a floating list under the input
    container = document.getElementById("returnPersonResults");

    if (!container) {
      container = document.createElement("div");
      container.id = "returnPersonResults";
      container.className = "list-group position-absolute w-100 shadow";
      container.style.zIndex = "1050";
      container.style.maxHeight = "260px";
      container.style.overflowY = "auto";

      // Insert right after the returnSearch input
      box.parentNode.style.position = "relative";
      box.parentNode.appendChild(container);
    }
  }

  if (!container) return;

  // Store for keyboard navigation
  box._resultsContainer = container;
  box._currentPeopleResults = people;

  // Clear previous results
  container.innerHTML = "";

  if (people.length === 0) {
    container.innerHTML = `
      <div class="list-group-item text-muted">No se encontraron personas</div>
    `;
    return;
  }

  container.innerHTML = people.map((p, index) => `
    <button type="button"
            class="list-group-item list-group-item-action person-result ${index === 0 ? "active" : ""}"
            data-name="${p.name}">
      <strong>${p.name}</strong>
      ${p.rut ? `<small class="text-muted d-block">RUT: ${p.rut}</small>` : ""}
    </button>
  `).join("");

  // Click to select
  container.querySelectorAll(".person-result").forEach(btn => {
    btn.addEventListener("click", () => {
      const person = window.peopleData.find(p => p.name === btn.dataset.name);
      if (person) {
        selectPerson(person, box);
        // Hide floating list after selection
        if (container.id === "returnPersonResults") {
          container.innerHTML = "";
        }
      }
    });
  });
}


function handlePersonKeyboard(e, box) {
  if (!box.value.trim().startsWith("@")) return;

  // Get the correct results container
  let container = box._resultsContainer;

  // Fallback (just in case)
  if (!container) {
    if (box.id === "searchBox") {
      container = document.getElementById("searchResults");
    } else {
      container = document.getElementById("returnPersonResults");
    }
  }

  if (!container) return;

  const items = Array.from(container.querySelectorAll(".person-result"));
  if (items.length === 0) return;

  let activeIndex = items.findIndex(item => item.classList.contains("active"));
  if (activeIndex === -1) activeIndex = 0;

  // ---------- ENTER ----------
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopImmediatePropagation();

    const activeItem = items[activeIndex] || items[0];
    if (activeItem) {
      const person = window.peopleData.find(p => p.name === activeItem.dataset.name);
      if (person) {
        selectPerson(person, box);
      }
    }
    return;
  }

  // ---------- ARROW DOWN ----------
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopImmediatePropagation();

    items.forEach(item => item.classList.remove("active"));
    activeIndex = (activeIndex + 1) % items.length;
    items[activeIndex].classList.add("active");
    items[activeIndex].scrollIntoView({ block: "nearest" });
    return;
  }

  // ---------- ARROW UP ----------
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopImmediatePropagation();

    items.forEach(item => item.classList.remove("active"));
    activeIndex = (activeIndex - 1 + items.length) % items.length;
    items[activeIndex].classList.add("active");
    items[activeIndex].scrollIntoView({ block: "nearest" });
    return;
  }
}

// upto here new smart search block


window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'QR_SCANNED') {
    const scannedCode = event.data.code;
    const box = document.getElementById("searchBox");
    
    if (box) {
      box.value = scannedCode;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      
      if (window.fullInventory && Array.isArray(window.fullInventory)) {
        const matchedItem = window.fullInventory.find(item => 
          item.geo && item.geo.toLowerCase().trim() === scannedCode.toLowerCase().trim()
        );
        
        if (matchedItem) {
          addToCart(matchedItem);
          
          if (scannerWindowRef || event.source) {
            const targetWindow = scannerWindowRef || event.source;
            targetWindow.postMessage({
              type: 'CONFIRM_ADD',
              itemName: matchedItem.en || matchedItem.geo 
            }, '*');
          }
          
          setTimeout(() => {
            box.value = "";
            box.dispatchEvent(new Event('input', { bubbles: true }));
          }, 800); 
          
        }
      }
    }
  }
});

function submitBulkPeople() {
  const inputEl = document.getElementById("bulkNamesInput");
  if (!inputEl) return;

  const rawText = inputEl.value;
  const lines = rawText.split("\n").filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    alert(i18n("msg_enter_value"));
    return;
  }

  if (lines[0].toLowerCase().includes("department") || lines[0].toLowerCase().includes("email")) {
    lines.shift();
  }

  if (lines.length === 0) {
    alert(i18n("msg_enter_value"));
    return;
  }

const parsedPayload = [];
  const existingPeople = window.peopleData || [];
  const duplicatesFound = [];

  // Parse lines and validate RUT integrity
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    
    // Determine the delimiter for this line
    let delimiter = ",";
    if (currentLine.includes("\t")) delimiter = "\t";
    else if (currentLine.includes(";")) delimiter = ";";

    let columns = [];
    let currentField = "";
    let insideQuotes = false;

    // State-machine loop to handle quotes, commas, and consecutive empty cells safely
    for (let j = 0; j < currentLine.length; j++) {
      let char = currentLine[j];

      if (char === '"') {
        insideQuotes = !insideQuotes; // Toggle quote state, skip pushing the quote mark
      } else if (char === delimiter && !insideQuotes) {
        columns.push(currentField.trim());
        currentField = ""; // Reset for next column
      } else {
        currentField += char;
      }
    }
    columns.push(currentField.trim()); // Push the final remaining column entry

    // Safeguard: Ensure the array structure always has exactly 8 parameters
    while (columns.length < 8) {
      columns.push("");
    }

    const rawRut = columns[5] || "";
    
    // Validate and format RUT via Global Helper
    const rutCheck = cleanAndValidateRut(rawRut);
    if (!rutCheck.valid) {
      alert(`Error on Line ${i + 1}: The RUT "${rawRut}" is mathematically invalid in Chile. Please correct the typo.`);
      return; 
    }

    const formattedRut = rutCheck.formatted;

    // STRICT COUPLING MAPPING TO SPREADSHEET [B to I] MATRIX
    const personObj = {
      name: columns[0] || "",
      department: columns[1] || "",       
      active: columns[2] || "",          
      sector: columns[3] || "",           // Column E: Default Sector
      notes: columns[4] || "",            // Column F: Notes
      rut: formattedRut,                  // Column G: RUT
      biometricTemplate: columns[6] || "",// Column H: BiometricTemplate
      email: columns[7] || ""             // Column I: Email
    };

    if (formattedRut) {
      const match = existingPeople.find(p => p.rut === formattedRut);
      if (match) {
        duplicatesFound.push({
          rut: formattedRut,
          name: personObj.name,
          existingName: match.name
        });
      }
    }

    parsedPayload.push(personObj);
  }

  let actionMode = "append";
  let finalPayload = [...parsedPayload];

  if (duplicatesFound.length > 0) {
    let msg = "The following RUT entries already exist in the database:\n\n";
    duplicatesFound.forEach(d => {
      msg += `• RUT: ${d.rut} - Incoming: "${d.name}" (Existing: "${d.existingName}")\n`;
    });
    msg += "\nClick 'OK' to OVERWRITE/UPDATE their existing records.\nClick 'Cancel' to SKIP duplicates and only insert brand-new entries.";

    const userChoice = confirm(msg);
    if (userChoice) {
      actionMode = "upsert";
    } else {
      const duplicateRuts = duplicatesFound.map(d => d.rut);
      finalPayload = parsedPayload.filter(p => !duplicateRuts.includes(p.rut));
      
      if (finalPayload.length === 0) {
        alert("All entries were duplicates and skipped. No records to save.");
        return;
      }
    }
  }

  google.script.run
    .withSuccessHandler(function (res) {
      if (res && res.success) {
        alert(res.message);
        inputEl.value = "";
        if (typeof loadPeopleCache === "function") {
          loadPeopleCache();
        }
      } else {
        alert(i18n("msg_error") + ": " + (res ? res.message : i18n("msg_sys_error")));
      }
    })
    .bulkSavePeople(finalPayload, actionMode);
}


window.newFingerprintTemplate = "";

function startEnrollment() {
  const enrollBtn = document.getElementById("enrollBtn");
  enrollBtn.textContent = "Place finger on scanner...";
  enrollBtn.disabled = true;

  captureFingerprintFromScanner(null, function(result) {
    if (result.success) {
      console.log("Fingerprint ", result);
      window.newFingerprintTemplate = result.image;
      document.getElementById("p_biometricTemplate").value = result.template;
      enrollBtn.textContent = "Fingerprint Captured ✓";
      enrollBtn.className = "btn btn-success w-100";savePerson
    } else {
      alert(i18n("msg_error") + ": " + result.error);
      enrollBtn.textContent = "Enroll Fingerprint";
      enrollBtn.disabled = false;
    }
  });
}



/**
 * Cleans, validates, and formats a Chilean RUT string into XXXXXXXX-X.
 * Returns { valid: true, formatted: "12345678-K" } or { valid: false }
 */
function cleanAndValidateRut(rawRut) {
  if (!rawRut || !rawRut.trim()) return { valid: true, formatted: "" };

  // 1. Clean string: remove dots, hyphens, and spaces, then uppercase the DV
  let clean = rawRut.toString().replace(/[\.\-\s]/g, "").toUpperCase();
  
  if (clean.length < 2) return { valid: false };

  // 2. Separate body digits from Verification Digit (DV)
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);

  // Validate that body contains only numbers
  if (!/^\d+$/.test(body)) return { valid: false };

  // 3. Modulo 11 Algorithm
  let sum = 0;
  let multiplier = 2;

  // Iterate backwards through body digits
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body.charAt(i), 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const expectedRemainder = 11 - (sum % 11);
  let expectedDv = "";
  
  if (expectedRemainder === 11) expectedDv = "0";
  else if (expectedRemainder === 10) expectedDv = "K";
  else expectedDv = expectedRemainder.toString();

  // 4. Verification Check
  if (dv !== expectedDv) return { valid: false };

  // 5. Return structured format: XXXXXXXX-X
  return { valid: true, formatted: `${body}-${dv}` };
}




// =====================
// BACKGROUND TASK QUEUE
// =====================
function addBackgroundQueueTask(taskId, personName) {
  const container = document.getElementById("taskQueueContainer");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.id = "task_" + taskId;
  toast.className = "task-toast processing";
  toast.innerHTML = `
    <div>
      <strong class="d-block mb-1">Issue: ${personName}</strong>
      <span id="task_msg_${taskId}" class="text-muted">Procesando en BD...</span>
    </div>
    <div class="spinner-border spinner-border-sm text-warning" id="task_spin_${taskId}" role="status"></div>
  `;
  container.appendChild(toast);
}

function updateBackgroundQueueTask(taskId, message, status) {
  const toast = document.getElementById("task_" + taskId);
  const msgEl = document.getElementById("task_msg_" + taskId);
  const spinEl = document.getElementById("task_spin_" + taskId);
  
  if (!toast) return;
  if (msgEl) msgEl.innerText = message;

  if (status === "success") {
    toast.className = "task-toast success";
    if (spinEl) spinEl.className = "bi bi-check-circle-fill text-success fs-5";
    setTimeout(() => toast.remove(), 4000); // Auto-dismiss after 4 seconds
  } else if (status === "error") {
    toast.className = "task-toast error";
    if (spinEl) spinEl.className = "bi bi-x-circle-fill text-danger fs-5";
    setTimeout(() => toast.remove(), 7000); // Keep longer so user can read error
  }
}





// =====================
// FILTER & RENDER DATA
// =====================
function applyDailyFilters() {
  const typeFilter = document.getElementById("daily_filter_type").value;
  const searchQuery = document.getElementById("daily_search_box").value.toLowerCase().trim();

  let filtered = dailyMovementsCache;

  // Filter by Type
  if (typeFilter !== "ALL") {
    filtered = filtered.filter(m => String(m.type).toUpperCase() === typeFilter);
  }

  // Filter by Search Query
  if (searchQuery) {
    filtered = filtered.filter(m => {
      return (
        String(m.movementId || "").toLowerCase().includes(searchQuery) ||
        String(m.itemGeo || "").toLowerCase().includes(searchQuery) ||
        String(m.person || "").toLowerCase().includes(searchQuery) ||
        String(m.sector || "").toLowerCase().includes(searchQuery) ||
        String(m.comments || "").toLowerCase().includes(searchQuery)
      );
    });
  }

  renderDailyTableAndKPIs(filtered);
}

function renderDailyTableAndKPIs(records) {
  const tbody = document.getElementById("dailyMovementsTableBody");
  
  // Calculate KPIs
  let totalIssued = 0;
  let totalReturned = 0;

  records.forEach(r => {
    const qty = Number(r.qty) || 0;
    if (String(r.type).toUpperCase() === "ISSUE") {
      totalIssued += qty;
    } else if (String(r.type).toUpperCase() === "RETURN") {
      totalReturned += qty;
    }
  });

  document.getElementById("daily_kpi_total").textContent = records.length;
  document.getElementById("daily_kpi_issued").textContent = totalIssued;
  document.getElementById("daily_kpi_returned").textContent = totalReturned;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">No movements found for the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const isIssue = String(r.type).toUpperCase() === "ISSUE";
    const badgeClass = isIssue ? "bg-warning text-dark" : "bg-success";

    // PDF link for the movement, if a generated PDF is available
    const pdfLink = r.pdfLink || "";
    const pdfCell = pdfLink
      ? `<a href="${pdfLink}" target="_blank" title="Open PDF" class="btn btn-sm btn-outline-danger px-2"><i class="bi bi-file-earmark-pdf"></i></a>`
      : `<span class="text-muted">-</span>`;

    // Return / Exchange action: only for ISSUE rows. Opens the Issue tab
    // with the item added to the cart as a negative ("add back") line.
    const escAttr = s => String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;");
    const returnTitle = (typeof i18n === "function" ? i18n("lbl_return_item") : "Return / Exchange") +
      (r.movementId ? " — " + r.movementId : "");
    const returnCell = isIssue
      ? `<button class="btn btn-outline-secondary" title="${escAttr(returnTitle)}" onclick="returnFromMovement('${escAttr(r.itemGeo)}','${escAttr(r.person)}','${escAttr(r.movementId)}','${escAttr(r.sector)}','${escAttr(r.maquina)}','${escAttr(r.generador)}','${escAttr(r.vehiculo)}')"><i class="bi bi-box-arrow-in-left"></i></button>`
      : `<span class="text-muted">-</span>`;

    return `
      <tr>
        <td><small class="fw-bold">${r.timeStr || ""}</small></td>
        <td><span class="badge ${badgeClass}">${r.type}</span></td>
        <td class="fw-bold">${r.itemGeo || "-"}</td>
        <td>
          ${r.descEn ? `<div><small class="text-primary">EN:</small> <small>${r.descEn}</small></div>` : ""}
          ${r.descEs ? `<div><small class="text-primary">ES:</small> <small>${r.descEs}</small></div>` : ""}
          ${(!r.descEn && !r.descEs) ? `<small class="text-muted">-</small>` : ""}
        </td>
        <td><span class="badge bg-secondary">${r.qty}</span></td>
        <td>${r.person || "-"}</td>
        <td>${r.sector || "-"}</td>
        <td><small class="text-muted">${r.condition || "Consumable"}</small></td>
        <td><small class="text-truncate d-inline-block" style="max-width: 120px;">${r.comments || "-"}</small></td>
        <td class="text-center">${pdfCell}</td>
        <td class="text-center">${returnCell}</td>
      </tr>`;
  }).join("");
}



// 1. Fetch all movements once on module load or when tab opens
function loadAllMovements() {
  // Optional: show loading spinner if desired
  google.script.run
    .withSuccessHandler(function(data) {
      allMovementsCache = data || [];
      console.log("All movements cached:", allMovementsCache.length);
      
      // Trigger initial filter using whatever date is currently selected in the UI
      filterMovementsByDate();
    })
    .withFailureHandler(function(err) {
      console.error("Failed to load movements:", err);
    })
    .getAllDailyMovements();
}

// 2. Filter locally by selected date and search/type parameters
function filterMovementsByDate() {
  const dateFromVal = document.getElementById("daily_filter_date_from").value; // e.g. "YYYY-MM-DD"
  const dateToVal = document.getElementById("daily_filter_date_to").value;     // e.g. "YYYY-MM-DD"
  const siteFilterVal = (document.getElementById("daily_filter_site")?.value || "").toLowerCase().trim();

  if (!dateFromVal && !dateToVal && !siteFilterVal) {
    renderDailyTableAndKPIs(allMovementsCache);
    return;
  }

  // Filter cache by matching the selected date range (inclusive)
  const filteredRecords = allMovementsCache.filter(r => {
    if (!r.timestamp) return false;
    const rDateStr = new Date(r.timestamp).toISOString().split('T')[0];
    if (dateFromVal && rDateStr < dateFromVal) return false;
    if (dateToVal && rDateStr > dateToVal) return false;
    if (siteFilterVal && String(r.site || "").toLowerCase() !== siteFilterVal) return false;
    return true;
  });

  // Render the locally filtered results
  renderDailyTableAndKPIs(filteredRecords);
}

// 3. Optional: Live text/type filtering without hitting backend again
function applyLiveFilters() {
  const dateFromVal = document.getElementById("daily_filter_date_from").value;
  const dateToVal = document.getElementById("daily_filter_date_to").value;
  const siteFilterVal = (document.getElementById("daily_filter_site")?.value || "").toLowerCase().trim();
  const searchText = (document.getElementById("daily_search_box")?.value || "").toLowerCase().trim();
  const typeFilter = (document.getElementById("daily_filter_type")?.value || "").toUpperCase();

  const filtered = allMovementsCache.filter(r => {
    // Date range match (from <= date <= to, inclusive)
    const rDateStr = r.timestamp ? new Date(r.timestamp).toISOString().split('T')[0] : "";
    const matchesDate =
      (rDateStr &&
        (!dateFromVal || rDateStr >= dateFromVal) &&
        (!dateToVal || rDateStr <= dateToVal));

    // Site match (empty = all sites)
    const matchesSite = !siteFilterVal ||
      String(r.site || "").toLowerCase() === siteFilterVal;

     // Type match (ISSUE / RETURN / ALL)
    const matchesType =
      !typeFilter ||
      typeFilter === "ALL" ||
      String(r.type).toUpperCase() === typeFilter;



    // Text search match (Person, ItemID, Sector, Comments, Descriptions)
    const matchesText = !searchText || (
      r.person.toLowerCase().includes(searchText) ||
      r.itemGeo.toLowerCase().includes(searchText) ||
      r.sector.toLowerCase().includes(searchText) ||
      r.comments.toLowerCase().includes(searchText) ||
      r.movementId.toLowerCase().includes(searchText) ||
      String(r.descEn || "").toLowerCase().includes(searchText) ||
      String(r.descEs || "").toLowerCase().includes(searchText)
    );

    return matchesDate && matchesSite && matchesType && matchesText;
  });

  renderDailyTableAndKPIs(filtered);
}



function showHSEFingerprintModal(personId, hseItems, callback) {

  // Prevent duplicate modals
  const existing = document.getElementById("hseFingerprintModal");
  if (existing) {
    existing.remove();
  }

  let fingerprintState = {
    captured: false,
    data: null,
    score: 0
  };

  let scanInProgress = false;
  let cancelled = false;

  // ==========================================================
  // CREATE MODAL
  // ==========================================================

  const modal = document.createElement("div");

  modal.id = "hseFingerprintModal";

  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;


  const content = document.createElement("div");

  content.style.cssText = `
    width: 100%;
    max-width: 480px;
    background: white;
    border-radius: 12px;
    padding: 25px;
    box-shadow: 0 15px 40px rgba(0,0,0,0.35);
    text-align: center;
  `;


  const itemCount = Array.isArray(hseItems)
    ? hseItems.length
    : 0;


  content.innerHTML = `
    
    <div style="
      font-size: 42px;
      margin-bottom: 8px;
    ">
      🔐
    </div>

    <h3 style="
      margin: 0 0 8px 0;
      color: #2c3e50;
    ">
      ${i18n('hse_modal_title')}
    </h3>

    <div style="
      color: #666;
      margin-bottom: 20px;
      font-size: 14px;
    ">
      ${i18n('hse_modal_desc').replace('{count}', itemCount)}
    </div>


    <!-- SCANNER STATUS -->

    <div id="hseScannerStatus"
      style="
        padding: 14px;
        border-radius: 8px;
        background: #f5f5f5;
        margin-bottom: 15px;
        font-weight: 600;
      "
    >
      ${i18n('hse_scanner_connecting')}
    </div>


    <!-- FINGER INSTRUCTION -->

    <div id="hseFingerInstruction"
      style="
        display: none;
        margin: 20px 0;
        padding: 18px;
        border-radius: 10px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
      "
    >

      <div style="
        font-size: 42px;
        margin-bottom: 8px;
      ">
        👆
      </div>

      <div style="
        font-size: 18px;
        font-weight: bold;
        color: #166534;
      ">
        ${i18n('hse_place_your_finger')}
      </div>

      <div style="
        font-size: 13px;
        color: #166534;
        margin-top: 5px;
      ">
        ${i18n('hse_place_your_finger_desc')}
      </div>

    </div>


    <!-- SCORE -->

    <div id="hseScore"
      style="
        min-height: 24px;
        margin-bottom: 10px;
        font-weight: 600;
      "
    ></div>


    <!-- ERROR -->

    <div id="hseError"
      style="
        color: #c0392b;
        font-size: 13px;
        margin-bottom: 10px;
        display: none;
        padding: 10px;
        background: #fef2f2;
        border-radius: 6px;
      "
    ></div>


    <!-- ACTIONS -->

    <div style="
      display: flex;
      gap: 10px;
      margin-top: 15px;
    ">

      <button id="hseRetry"
        style="
          flex: 1;
          padding: 11px;
          background: #95a5a6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        "
      >
        ${i18n('hse_retry')}
      </button>


      <button id="hseConfirm"
        disabled
        style="
          flex: 1;
          padding: 11px;
          background: #27ae60;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: not-allowed;
          font-size: 14px;
          opacity: 0.5;
        "
      >
        ${i18n('hse_confirm')}
      </button>

    </div>


    <!-- BACK -->

    <button id="hseCancel"
      style="
        width: 100%;
        margin-top: 15px;
        padding: 10px;
        background: transparent;
        color: #555;
        border: 1px solid #ccc;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      "
    >
      ${i18n('hse_back_to_issue')}
    </button>

  `;


  modal.appendChild(content);
  document.body.appendChild(modal);


  // ==========================================================
  // ELEMENTS
  // ==========================================================

  const scannerStatus =
    document.getElementById("hseScannerStatus");

  const fingerInstruction =
    document.getElementById("hseFingerInstruction");

  const retryBtn =
    document.getElementById("hseRetry");

  const confirmBtn =
    document.getElementById("hseConfirm");

  const cancelBtn =
    document.getElementById("hseCancel");

  const scoreDiv =
    document.getElementById("hseScore");

  const errorDiv =
    document.getElementById("hseError");


  // ==========================================================
  // CLOSE MODAL
  // ==========================================================

  function closeModal() {

    cancelled = true;

    scanInProgress = false;

    modal.remove();
  }


  // ==========================================================
  // CANCEL / BACK TO ISSUE
  // ==========================================================

  cancelBtn.addEventListener("click", function () {

    closeModal();

  });


  // ==========================================================
  // ERROR DISPLAY
  // ==========================================================

  function showError(message) {

    errorDiv.textContent =
      message || i18n('hse_scanner_error');

    errorDiv.style.display =
      "block";
  }


  function clearError() {

    errorDiv.textContent = "";

    errorDiv.style.display =
      "none";
  }


  // ==========================================================
  // SET SCANNER STATUS
  // ==========================================================

  function setScannerStatus(
    message,
    type = "normal"
  ) {

    scannerStatus.textContent =
      message;


    if (type === "success") {

      scannerStatus.style.background =
        "#ecfdf5";

      scannerStatus.style.color =
        "#166534";

    }
    else if (type === "error") {

      scannerStatus.style.background =
        "#fef2f2";

      scannerStatus.style.color =
        "#991b1b";

    }
    else {

      scannerStatus.style.background =
        "#f5f5f5";

      scannerStatus.style.color =
        "#444";
    }
  }


  // ==========================================================
  // HEALTH CHECK
  // ==========================================================

  async function checkScannerHealth() {

  if (cancelled) return;

  clearError();

  setScannerStatus(
    i18n('hse_scanner_connecting'),
    "normal"
  );

  try {

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      3000
    );

    const response = await fetch(
      "http://127.0.0.1:8888/health",
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    // =====================================================
    // FIXED CONDITION
    // Accept the scanner if it is ready, even when the printer is offline
    // =====================================================
    const scannerIsReady =
      response.ok &&
      data &&
      (
        data.scannerReady === true ||
        data.scanner?.connected === true ||
        data.connected === true          // still accept full "ready" state
      );

    if (scannerIsReady) {

      if (cancelled) return;

      setScannerStatus(
        i18n('hse_scanner_connected_zk'),
        "success"
      );

      fingerInstruction.style.display = "block";

      // Automatically start scan
      setTimeout(startFingerprintScan, 300);

      return;
    }

    throw new Error("Scanner is not connected.");

  } catch (err) {

    if (cancelled) return;

    fingerInstruction.style.display = "none";

    setScannerStatus(
      i18n('hse_scanner_unavailable_status'),
      "error"
    );

    showError(
      i18n('hse_scanner_connect_zk_instructions')
    );

  }
}

  // ==========================================================
  // START FINGERPRINT SCAN
  // ==========================================================

  function startFingerprintScan() {

    if (cancelled) return;

    if (scanInProgress) return;


    scanInProgress = true;

    clearError();


    fingerInstruction.style.display =
      "block";


    scoreDiv.textContent =
      "";


    setScannerStatus(
      i18n('hse_scanner_ready'),
      "success"
    );


    retryBtn.disabled = true;

    retryBtn.style.opacity =
      "0.5";


    confirmBtn.disabled = true;

    confirmBtn.style.opacity =
      "0.5";


    // ========================================================
    // GET PERSON TEMPLATE
    // ========================================================

    google.script.run
      .withSuccessHandler(function (person) {

        if (cancelled) return;


        if (
          !person ||
          !person.biometricTemplate
        ) {

          scanInProgress = false;

          retryBtn.disabled = false;
          retryBtn.style.opacity = "1";

          fingerInstruction.style.display =
            "none";

          showError(
            i18n('hse_template_not_found')
          );

          setScannerStatus(
            i18n('hse_template_unavailable'),
            "error"
          );

          return;
        }


        // ====================================================
        // TELL USER TO PLACE FINGER
        // ====================================================

        setScannerStatus(
          i18n('hse_scanner_connected_place_finger'),
          "success"
        );


        fingerInstruction.style.display =
          "block";


        // ====================================================
        // START ACTUAL SCAN
        // ====================================================

        captureFingerprintFromScanner(
          person.biometricTemplate,
          function (result) {

            if (cancelled) return;


            scanInProgress = false;


            retryBtn.disabled = false;

            retryBtn.style.opacity =
              "1";


            if (result.success) {

              fingerprintState.captured =
                true;

              fingerprintState.data =
                result.fingerprintBase64;

              fingerprintState.score =
                result.matchScore;


              fingerInstruction.style.display =
                "none";


              if (result.match) {

                scoreDiv.textContent =
                  i18n('hse_match_score').replace('{score}', result.matchScore);

                scoreDiv.style.color =
                  "#27ae60";


                setScannerStatus(
                  i18n('hse_verified_successfully'),
                  "success"
                );


                if (
                  result.matchScore >= 60
                ) {

                  confirmBtn.disabled =
                    false;

                  confirmBtn.style.opacity =
                    "1";

                  confirmBtn.style.cursor =
                    "pointer";
                }

              }
              else {

                scoreDiv.textContent =
                  i18n('hse_mismatch_score').replace('{score}', result.matchScore);

                scoreDiv.style.color =
                  "#c0392b";


                setScannerStatus(
                  i18n('hse_mismatch_status'),
                  "error"
                );


                showError(
                  i18n('hse_mismatch_instructions')
                );
              }


              return;
            }


            // ==================================================
            // SCAN FAILED
            // ==================================================

            showError(
              result.error ||
              i18n('hse_capture_failed')
            );


            setScannerStatus(
              i18n('hse_scan_failed'),
              "error"
            );


            fingerInstruction.style.display =
              "none";

          }
        );

      })
      .withFailureHandler(function (err) {

        if (cancelled) return;


        scanInProgress = false;

        retryBtn.disabled = false;

        retryBtn.style.opacity =
          "1";


        fingerInstruction.style.display =
          "none";


        showError(
          i18n('hse_biometric_load_failed') +
          (err?.message || "Unknown error")
        );


        setScannerStatus(
          i18n('hse_prepare_verification_failed'),
          "error"
        );

      })
      .getPersonById(personId);
  }


  // ==========================================================
  // RETRY
  // ==========================================================

  retryBtn.addEventListener(
    "click",
    function () {

      if (cancelled) return;

      if (scanInProgress) return;


      fingerprintState = {
        captured: false,
        data: null,
        score: 0
      };


      confirmBtn.disabled =
        true;

      confirmBtn.style.opacity =
        "0.5";

      confirmBtn.style.cursor =
        "not-allowed";


      scoreDiv.textContent =
        "";

      clearError();


      fingerInstruction.style.display =
        "none";


      setScannerStatus(
        i18n('hse_checking_scanner'),
        "normal"
      );


      checkScannerHealth();

    }
  );


  // ==========================================================
  // CONFIRM
  // ==========================================================

  confirmBtn.addEventListener(
    "click",
    function () {

      if (cancelled) return;

      if (!fingerprintState.captured)
        return;

      if (!fingerprintState.data)
        return;


      console.log(
        "DEBUG: Confirm clicked."
      );

      console.log(
        "DEBUG: Score:",
        fingerprintState.score
      );


      modal.remove();


      callback({
        fingerprintBase64:
          fingerprintState.data,

        matchScore:
          fingerprintState.score
      });

    }
  );


  // ==========================================================
  // START
  // ==========================================================

  checkScannerHealth();
}



function initPersonSelectSmartSearch() {
  const selects = [
    document.getElementById("person"),
    document.getElementById("returnPerson")
  ];

  selects.forEach(select => {
    if (!select || !select.choicesInstance) return;

    const choices = select.choicesInstance;

    // Force disable internal search + remove limit
    choices.config.searchChoices = false;
    choices.config.searchResultLimit = 9999;   // high number instead of -1
    choices.config.renderChoiceLimit = -1;

    // Better matcher
    const matchesName = (fullName, query) => {
      if (!fullName || !query) return false;

      const name = fullName.toLowerCase();
      const queryParts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

      // Every word must appear somewhere in the full name
      return queryParts.every(part => name.includes(part));
    };

    // Save original list
    if (!choices._originalChoices) {
      choices._originalChoices = choices._store.choices.map(c => ({
        value: c.value,
        label: c.label,
        selected: c.selected,
        disabled: c.disabled,
        placeholder: c.placeholder
      }));
    }

    // Clean previous listener
    if (select._smartSearchHandler) {
      select.removeEventListener("search", select._smartSearchHandler);
    }

    select._smartSearchHandler = function (event) {
      const query = (event.detail?.value || "").trim();

      if (!query) {
        choices.setChoices(choices._originalChoices, "value", "label", true);
        return;
      }

      const filtered = choices._originalChoices.filter(choice =>
        matchesName(choice.label, query)
      );

      // Force show all matches
      choices.setChoices(filtered, "value", "label", true);
    };

    select.addEventListener("search", select._smartSearchHandler);

    console.log("✅ Smart search ready on", select.id, 
                "| Original people:", choices._originalChoices.length);
  });
}
