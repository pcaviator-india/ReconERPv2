let importedInvoiceLines = [];
let productChoicesMap = {};
let extractedInvoiceText = "";

// ============================================
// INIT
// ============================================
window.initImportInvModule = function () {

  document.getElementById("pdfTextPreview").value = "";
  extractedInvoiceText = "";

};

// ============================================
// PDF UPLOAD
// ============================================
function handleInvoiceUpload(input) {

  const file = input.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = function(e) {

    const base64 =
      e.target.result.split(",")[1];

    document.getElementById("extractStatus").innerHTML =
      "Extracting PDF text...";

    google.script.run
      .withSuccessHandler(function(res){

        if (!res.success) {

          alert(res.message || "Extraction failed");

          document.getElementById("extractStatus").innerHTML =
            "";

          return;
        }

        extractedInvoiceText =
          res.text || "";
        parseInvoiceText(extractedInvoiceText);

        document.getElementById("pdfTextPreview").value =
          extractedInvoiceText;

        document.getElementById("extractStatus").innerHTML =
          "PDF text extracted";

      })
      .withFailureHandler(function(err){

        console.error(err);

        alert("PDF extraction failed");

        document.getElementById("extractStatus").innerHTML =
          "";

      })
      .extractInvoicePDFText({
        fileName: file.name,
        base64: base64
      });

  };

  reader.readAsDataURL(file);

}

// =========================
// SUPPLIERS
// =========================
function loadSuppliers() {

  const select =
    document.getElementById("inv_supplier");

  if (!select) return;

  select.innerHTML =
    `<option value="">Select Supplier</option>`;

  (window.suppliersData || []).forEach(s => {

    const opt =
      document.createElement("option");

    opt.value = s.name;
    opt.text = s.name;

    select.appendChild(opt);

  });

}


function detectInvoiceType(lines) {

  const sample = lines.slice(0, 20).join(" ").toUpperCase();

  // TABLE STYLE
  if (
    sample.includes("CODIGO") &&
    sample.includes("DESCRIPCION") &&
    sample.includes("CANTIDAD")
  ) {
    return "TABLE";
  }

  // XML STYLE
  if (sample.includes("<INVOICE") || sample.includes("<XML")) {
    return "XML";
  }

  // DEFAULT = FLAT OCR
  return "FLAT";
}

// =========================
// START IMPORT
// =========================
function parseInvoiceText(rawText) {

  importedInvoiceLines = [];

  if (!rawText) return;

  const lines = rawText.split("\n");

  console.log("TOTAL LINES:", lines.length);

  lines.forEach((line, lineIndex) => {
    if (!line || line.trim() === "") return;

    console.log(`LINE ${lineIndex + 1} RAW:`, line);

    let cleaned = line.replace(
      /CODIGO\s+DESCRIPCION\s+CANTIDAD\s+UN\.?\s*MED\.?\s*PRECIO\s+DESCUENTO\s+TOTAL/i,
      ""
    ).trim();

    cleaned = cleaned.replace(
      /CODIGO.*TOTAL/i,
      ""
    ).trim();

    console.log("CLEANED LINE:", cleaned);

    const numbers = cleaned.match(/\d+(\.\d+)?/g);
    const code = cleaned.match(/[A-Z0-9]{5,}/);

    console.log("CODE:", code);
    console.log("NUMBERS:", numbers);

    if (code && numbers && numbers.length >= 3) {

      importedInvoiceLines.push({
        raw: line,
        pn: code[0],
        qty: Number(numbers[0]),
        unitPrice: Number(numbers[numbers.length - 2]),
        total: Number(numbers[numbers.length - 1]),
        description: cleaned.replace(code[0], "").trim()
      });

    }
  });

  console.log("FOUND ITEMS:", importedInvoiceLines);

  renderImportedInvoiceLines();
}

// ============================================
// RENDER STAGING TABLE
// ============================================
function renderImportedInvoiceLines() {

  const box =
    document.getElementById("invoiceLinesBox");

  box.innerHTML = "";

  if (!importedInvoiceLines.length) {

    box.innerHTML = `
      <div class="p-3 text-muted">
        No invoice lines detected
      </div>
    `;

    return;
  }

  // TABLE
  const table =
    document.createElement("table");

  table.className =
    "table table-sm table-bordered mb-0";

  table.innerHTML = `
    <thead class="table-light">
      <tr>
        <th style="width:5%">#</th>
        <th style="width:15%">PN</th>
        <th>Description</th>
        <th style="width:10%">Qty</th>
        <th style="width:15%">Matched GEO</th>
        <th style="width:10%">Score</th>
      </tr>
    </thead>
    <tbody>
    </tbody>
  `;

  const tbody =
    table.querySelector("tbody");

  importedInvoiceLines.forEach((item, i) => {

    const tr =
      document.createElement("tr");

    const scoreColor =
      item.matchScore >= 90
        ? "success"
        : item.matchScore >= 60
        ? "warning"
        : "danger";

    tr.innerHTML = `

      <td>
        ${i + 1}
      </td>

      <td>
        <input
          class="form-control form-control-sm"
          value="${item.pn || ""}"
          onchange="
            importedInvoiceLines[${i}].pn=this.value
          "
        >
      </td>

      <td>

        <textarea
          class="form-control form-control-sm"
          style="min-height:60px;"
          onchange="
            importedInvoiceLines[${i}].description=this.value
          "
        >${item.description || ""}</textarea>

      </td>

      <td>

        <input
          type="number"
          min="1"
          class="form-control form-control-sm"
          value="${item.qty || 1}"
          onchange="
            importedInvoiceLines[${i}].qty=Number(this.value)||1
          "
        >

      </td>

      <td>

        <input
          class="form-control form-control-sm"
          placeholder="Search GEO / PN / Desc"
          value="${item.matchedGeo || ""}"
          oninput="
            searchInvoiceGeo(this, ${i})
          "
        >

        <div
          id="geoResults_${i}"
          class="border rounded bg-white"
          style="
            max-height:150px;
            overflow:auto;
          "
        ></div>

      </td>

      <td>

        <span class="badge bg-${scoreColor}">
          ${item.matchScore || 0}
        </span>

      </td>
    `;

    tbody.appendChild(tr);

  });

  box.appendChild(table);

}

function autoMatchInvoiceLines() {

  if (!window.fullInventory) return;

  importedInvoiceLines.forEach(line => {

    let best = null;
    let bestScore = 0;

    const lineText =
      (
        (line.description || "") + " " +
        (line.pn || "")
      )
      .toLowerCase();

    window.fullInventory.forEach(inv => {

      let score = 0;

      const pn =
        String(inv.pn || "")
        .toLowerCase();

      const desc =
        String(inv.en || "")
        .toLowerCase();

      const marca =
        String(inv.marca || "")
        .toLowerCase();

      // =====================
      // PART NUMBER MATCH
      // =====================

      if (
        pn &&
        line.pn &&
        pn === line.pn.toLowerCase()
      ) {
        score += 100;
      }

      if (
        pn &&
        lineText.includes(pn)
      ) {
        score += 60;
      }

      // =====================
      // DESCRIPTION MATCH
      // =====================

      const words =
        desc.split(" ");

      words.forEach(w => {

        if (
          w.length > 3 &&
          lineText.includes(w)
        ) {
          score += 5;
        }

      });

      // =====================
      // BRAND MATCH
      // =====================

      if (
        marca &&
        lineText.includes(marca)
      ) {
        score += 15;
      }

      if (score > bestScore) {

        bestScore = score;

        best = inv;

      }

    });

    // =====================
    // APPLY BEST MATCH
    // =====================

    if (best && bestScore >= 40) {

      line.matchedGeo =
        best.geo || "";

      line.matchedDescription =
        best.en || "";

      line.matchScore =
        bestScore;

    }

  });

}


function searchInvoiceGeo(input, rowIndex) {

  const q =
    input.value
      .toLowerCase()
      .trim();

  const box =
    document.getElementById(
      `geoResults_${rowIndex}`
    );

  if (!q || q.length < 2) {

    box.innerHTML = "";
    return;

  }

  const results =
    window.fullInventory
      .filter(inv => {

        return (

          (inv.geo || "")
            .toLowerCase()
            .includes(q)

          ||

          (inv.pn || "")
            .toLowerCase()
            .includes(q)

          ||

          (inv.en || "")
            .toLowerCase()
            .includes(q)

        );

      })
      .slice(0,10);

  box.innerHTML = "";

  results.forEach(r => {

    const div =
      document.createElement("div");

    div.className =
      "p-2 border-bottom small";

    div.style.cursor = "pointer";

    div.innerHTML = `
      <b>${r.geo}</b><br>
      ${r.en || ""}<br>
      <span class="text-muted">
        ${r.pn || ""}
      </span>
    `;

    div.onclick = function() {

      importedInvoiceLines[rowIndex].matchedGeo =
        r.geo;

      importedInvoiceLines[rowIndex].matchedDescription =
        r.en || "";

      importedInvoiceLines[rowIndex].matchScore =
        999;

      renderImportedInvoiceLines();

    };

    box.appendChild(div);

  });

}


// =========================
// PRODUCT SEARCH SELECTORS
// =========================
function initProductSelectors(lines) {

  lines.forEach((line, i) => {

    const select =
      document.getElementById(`match_${i}`);

    if (!select) return;

    if (select.choicesInstance) {
      select.choicesInstance.destroy();
    }

    window.fullInventory.forEach(item => {

      const opt =
        document.createElement("option");

      opt.value = item.geo;

      opt.text =
        `${item.geo} | ${item.pn || ''} | ${item.en || ''}`;

      if (line.suggestedGeo === item.geo) {
        opt.selected = true;
      }

      select.appendChild(opt);

    });

    select.choicesInstance =
      new Choices(select, {

        searchEnabled: true,
        itemSelectText: '',
        shouldSort: false,
        placeholder: true,
        searchPlaceholderValue: 'Search product...'

      });

  });

}

// =========================
// CONFIRM IMPORT
// =========================
function confirmInvoiceImport() {

  if (!importedInvoiceLines.length) {
    alert(i18n("msg_no_data"));
    return;
  }

  const finalLines = [];

  importedInvoiceLines.forEach((line, i) => {

    const geo =
      document.getElementById(`match_${i}`).value;

    finalLines.push({

      ...line,

      matchedGeo: geo

    });

  });

  const payload = {

    supplier:
      document.getElementById("inv_supplier").value,

    invoiceNo:
      document.getElementById("inv_invoiceNo").value,

    invoiceDate:
      document.getElementById("inv_invoiceDate").value,

    lines: finalLines

  };

  google.script.run
    .withSuccessHandler(res => {

      alert(res.message);

    })
    .saveImportedInvoice(payload);

}
