(function(){
  const QUOTE_REPORT_STATUSES = [
    "Pending",
    "Not Quoted",
    "Quoted",
    "Approved",
    "Sent",
    "Received",
    "Despatched",
    "Final Received",
    "Deleted",
  ];

  const QUOTE_REPORT_STATUS_PALETTE = {
    Pending: "bg-secondary",
    "Not Quoted": "bg-secondary",
    Quoted: "bg-primary",
    Approved: "bg-success",
    Sent: "bg-info",
    Received: "bg-success",
    Despatched: "bg-warning text-dark",
    "Final Received": "bg-dark",
    Deleted: "bg-danger",
  };

  const QUOTE_REPORT_AGE_BUCKETS = [
    { key: "all", labelKey: "quote_report_all_ages" },
    { key: "0-7", labelKey: "quote_report_age_0_7", min: 0, max: 7 },
    { key: "8-14", labelKey: "quote_report_age_8_14", min: 8, max: 14 },
    { key: "15-30", labelKey: "quote_report_age_15_30", min: 15, max: 30 },
    { key: "31-60", labelKey: "quote_report_age_31_60", min: 31, max: 60 },
    { key: "60+", labelKey: "quote_report_age_60_plus", min: 61, max: Infinity },
  ];

  let quoteReportRows = [];
  let quoteReportGroups = [];
  let quoteReportFilteredGroups = [];
  let quoteReportReady = false;
  let quoteReportViewMode = localStorage.getItem("quote_report_view_mode") || "chart";

  if (typeof window.t === "undefined") {
    window.t = function (key) {
      return typeof getI18nText === "function" ? getI18nText(key) : key;
    };
  }
  var t = window.t;

  function normalizeQuoteReportStatus(value) {
    const raw = String(value || "").trim();
    if (!raw) return "Pending";
    if (QUOTE_REPORT_STATUSES.includes(raw)) return raw;

    const lower = raw.toLowerCase();
    // "Not Quoted" must be caught BEFORE the bare "quot" check, otherwise it
    // misreads as "Quoted" — exactly the confusion the status exists to cure.
    if ((lower.includes("not") && lower.includes("quot")) || lower.includes("no cotiz") || lower.includes("sin cotiz")) return "Not Quoted";
    if (lower.includes("final")) return "Final Received";
    if (lower.includes("pend")) return "Pending";
    if (lower.includes("quot")) return "Quoted";
    if (lower.includes("approv")) return "Approved";
    if (lower.includes("sent")) return "Sent";
    if (lower.includes("receiv")) return "Received";
    if (lower.includes("desp")) return "Despatched";
    if (lower.includes("delete")) return "Deleted";
    return "Pending";
  }

  function parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateToInputValue(date) {
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfDay(date) {
    if (!date) return null;
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function endOfDay(date) {
    if (!date) return null;
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  }

  function getGroupKey(row) {
    return [
      String(row.quoteId || row.refCotiz || "").trim(),
      String(row.orderId || "").trim(),
      String(row.supplier || "").trim(),
      String(row.category || "").trim(),
      String(row.faena || "").trim(),
    ].join("|").toLowerCase();
  }

  function lineTotal(row) {
    const qty = Number(row.cant || row.qty || 0);
    const price = Number(row.price || 0);
    const total = Number(row.total || row.lineTotal || 0);
    return total || qty * price;
  }

  function bucketForAge(ageDays) {
    if (ageDays == null || isNaN(ageDays)) return "all";
    if (ageDays <= 7) return "0-7";
    if (ageDays <= 14) return "8-14";
    if (ageDays <= 30) return "15-30";
    if (ageDays <= 60) return "31-60";
    return "60+";
  }

  function bucketLabel(bucketKey) {
    const bucket = QUOTE_REPORT_AGE_BUCKETS.find((item) => item.key === bucketKey);
    return bucket ? t(bucket.labelKey) : bucketKey;
  }

  function colorClassForStatus(status) {
    return QUOTE_REPORT_STATUS_PALETTE[status] || "bg-secondary";
  }

  function formatCurrency(value) {
    return `$ ${Number(value || 0).toLocaleString("es-CL")}`;
  }

  function formatDateTime(value) {
    const date = parseDateValue(value);
    if (!date) return "";
    return date.toLocaleString();
  }

  function buildReportGroups(rows) {
    const groups = {};

    (rows || []).forEach((row) => {
      const key = getGroupKey(row);
      const itemDate = parseDateValue(row.timestampIso || row.timestamp || row.fecha);
      if (!groups[key]) {
        groups[key] = {
          quoteId: String(row.quoteId || row.refCotiz || "").trim(),
          refCotiz: String(row.refCotiz || "").trim(),
          orderId: String(row.orderId || "").trim(),
          supplier: String(row.supplier || "").trim(),
          faena: String(row.faena || "").trim(),
          category: String(row.category || "").trim(),
          subCategory: String(row.subCategory || "").trim(),
          quoteLink: String(row.quoteLink || "").trim(),
          latestDate: itemDate,
          latestTs: itemDate ? itemDate.getTime() : 0,
          items: [],
        };
      }

      if (itemDate && itemDate.getTime() > (groups[key].latestTs || 0)) {
        groups[key].latestDate = itemDate;
        groups[key].latestTs = itemDate.getTime();
      }

      groups[key].items.push({
        ...row,
        status: normalizeQuoteReportStatus(row.estado || row.status),
        itemDate,
      });
    });

    return Object.values(groups).map((group) => {
      const statusCounts = QUOTE_REPORT_STATUSES.reduce((acc, status) => {
        acc[status] = 0;
        return acc;
      }, {});

      let activeLines = 0;
      let deletedLines = 0;
      let activeValue = 0;

      group.items.forEach((item) => {
        const status = normalizeQuoteReportStatus(item.status);
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (status === "Deleted") {
          deletedLines += 1;
          return;
        }
        activeLines += 1;
        activeValue += lineTotal(item);
      });

      const activeStatuses = QUOTE_REPORT_STATUSES.filter((status) => status !== "Deleted")
        .map((status) => ({ status, count: statusCounts[status] || 0 }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count);

      const ageDays = group.latestDate
        ? Math.floor((Date.now() - group.latestDate.getTime()) / 86400000)
        : null;

      return {
        ...group,
        statusCounts,
        activeLines,
        deletedLines,
        activeValue,
        totalLines: group.items.length,
        ageDays,
        ageBucket: bucketForAge(ageDays),
        activeStatuses,
        dominantStatus: activeStatuses.length ? activeStatuses[0].status : "Deleted",
      };
    });
  }

  function getMetrics(groups) {
    const metrics = {
      quoteGroups: groups.length,
      activeLines: 0,
      deletedLines: 0,
      activeValue: 0,
      suppliers: new Set(),
      activeGroups: 0,
    };

    groups.forEach((group) => {
      metrics.activeLines += group.activeLines || 0;
      metrics.deletedLines += group.deletedLines || 0;
      metrics.activeValue += group.activeValue || 0;
      if (group.activeLines > 0) metrics.activeGroups += 1;
      if (group.supplier) metrics.suppliers.add(group.supplier);
    });

    return {
      ...metrics,
      uniqueSuppliers: metrics.suppliers.size,
    };
  }

  function applyStaticTranslations() {
    const titleEl = document.querySelector('[data-i18n="quote_report_title"]');
    const subtitleEl = document.querySelector('[data-i18n="quote_report_subtitle"]');
    if (titleEl) titleEl.innerText = t("quote_report_title");
    if (subtitleEl) subtitleEl.innerText = t("quote_report_subtitle");
  }

  function populateSelects(rows) {
    const siteSel = document.getElementById("quoteReportSiteFilter");
    const supplierSel = document.getElementById("quoteReportSupplierFilter");
    const statusSel = document.getElementById("quoteReportStatusFilter");
    const agingSel = document.getElementById("quoteReportAgingFilter");

    if (siteSel) {
      const uniqueSites = [...new Set(rows.map((row) => String(row.faena || "").trim()).filter(Boolean))].sort();
      siteSel.innerHTML = `<option value="">${t("all_sites")}</option>` + uniqueSites.map((site) => `<option value="${site}">${site}</option>`).join("");
    }

    if (supplierSel) {
      const uniqueSuppliers = [...new Set(rows.map((row) => String(row.supplier || "").trim()).filter(Boolean))].sort();
      supplierSel.innerHTML = `<option value="">${t("all_suppliers")}</option>` + uniqueSuppliers.map((supplier) => `<option value="${supplier}">${supplier}</option>`).join("");
    }

    if (statusSel) {
      statusSel.innerHTML = [
        `<option value="active">${t("quote_report_active_groups")}</option>`,
        `<option value="all">${t("quote_report_all_groups")}</option>`,
        `<option value="Pending">Pending</option>`,
        `<option value="Not Quoted">Not Quoted</option>`,
        `<option value="Quoted">Quoted</option>`,
        `<option value="Approved">Approved</option>`,
        `<option value="Sent">Sent</option>`,
        `<option value="Received">Received</option>`,
        `<option value="Despatched">Despatched</option>`,
        `<option value="Final Received">Final Received</option>`,
        `<option value="deleted">${t("quote_report_deleted_only")}</option>`,
      ].join("");
    }

    if (agingSel) {
      agingSel.innerHTML = QUOTE_REPORT_AGE_BUCKETS.map((bucket) => `<option value="${bucket.key}">${t(bucket.labelKey)}</option>`).join("");
    }
  }

  function currentFilters() {
    return {
      site: document.getElementById("quoteReportSiteFilter")?.value || "",
      supplier: document.getElementById("quoteReportSupplierFilter")?.value || "",
      status: document.getElementById("quoteReportStatusFilter")?.value || "active",
      aging: document.getElementById("quoteReportAgingFilter")?.value || "all",
      search: (document.getElementById("quoteReportSearch")?.value || "").trim().toLowerCase(),
      dateFrom: parseDateValue(document.getElementById("quoteReportDateFrom")?.value || ""),
      dateTo: parseDateValue(document.getElementById("quoteReportDateTo")?.value || ""),
    };
  }

  function filterGroups() {
    const filters = currentFilters();
    const fromDate = startOfDay(filters.dateFrom);
    const toDate = endOfDay(filters.dateTo);

    quoteReportFilteredGroups = (quoteReportGroups || []).filter((group) => {
      const siteMatch = !filters.site || group.faena === filters.site;
      const supplierMatch = !filters.supplier || group.supplier === filters.supplier;
      const searchMatch =
        !filters.search ||
        [group.quoteId, group.refCotiz, group.orderId, group.supplier, group.faena, group.category, group.subCategory]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(filters.search));

      const dateMatch =
        (!fromDate || !group.latestDate || group.latestDate >= fromDate) &&
        (!toDate || !group.latestDate || group.latestDate <= toDate);

      const agingMatch = filters.aging === "all" || group.ageBucket === filters.aging;

      let statusMatch = true;
      if (filters.status === "active") {
        statusMatch = group.activeLines > 0;
      } else if (filters.status === "all") {
        statusMatch = true;
      } else if (filters.status === "deleted") {
        statusMatch = group.deletedLines > 0 && group.activeLines === 0;
      } else {
        const wanted = normalizeQuoteReportStatus(filters.status);
        statusMatch = (group.statusCounts && group.statusCounts[wanted]) > 0;
      }

      return siteMatch && supplierMatch && searchMatch && dateMatch && agingMatch && statusMatch;
    });
  }

  function renderMetrics(groups) {
    const metrics = getMetrics(groups);
    const container = document.getElementById("quoteReportKpis");
    if (!container) return;

    container.innerHTML = `
      <div class="col-md-6 col-xl-3">
        <div class="quote-report-kpi p-3 border-start border-4 border-primary">
          <div class="quote-report-kpi-label">${t("quote_report_quote_groups")}</div>
          <div class="quote-report-kpi-value">${metrics.quoteGroups}</div>
          <div class="quote-report-kpi-note">${t("quote_report_grouped_by")}</div>
        </div>
      </div>
      <div class="col-md-6 col-xl-3">
        <div class="quote-report-kpi p-3 border-start border-4 border-success">
          <div class="quote-report-kpi-label">${t("quote_report_active_lines")}</div>
          <div class="quote-report-kpi-value">${metrics.activeLines}</div>
          <div class="quote-report-kpi-note">${t("quote_report_active_lines_note")}</div>
        </div>
      </div>
      <div class="col-md-6 col-xl-3">
        <div class="quote-report-kpi p-3 border-start border-4 border-warning">
          <div class="quote-report-kpi-label">${t("quote_report_deleted_lines")}</div>
          <div class="quote-report-kpi-value">${metrics.deletedLines}</div>
          <div class="quote-report-kpi-note">${t("quote_report_deleted_lines_note")}</div>
        </div>
      </div>
      <div class="col-md-6 col-xl-3">
        <div class="quote-report-kpi p-3 border-start border-4 border-info">
          <div class="quote-report-kpi-label">${t("quote_report_active_value")}</div>
          <div class="quote-report-kpi-value">${formatCurrency(metrics.activeValue)}</div>
          <div class="quote-report-kpi-note">${t("quote_report_active_value_note")}</div>
        </div>
      </div>
    `;
  }

  function renderStatusCards(groups) {
    const container = document.getElementById("quoteReportStatusCards");
    if (!container) return;

    const counts = QUOTE_REPORT_STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    let totalLines = 0;

    groups.forEach((group) => {
      Object.entries(group.statusCounts || {}).forEach(([status, count]) => {
        counts[status] = (counts[status] || 0) + count;
        totalLines += count;
      });
    });

    container.innerHTML = QUOTE_REPORT_STATUSES.map((status) => {
      const count = counts[status] || 0;
      const percent = totalLines ? Math.round((count / totalLines) * 100) : 0;
      return `
        <div class="col-6 col-xl-3">
          <div class="quote-report-status-card p-3 h-100">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <div class="quote-report-status-label">${status}</div>
                <div class="quote-report-status-count h4 mb-0">${count}</div>
              </div>
              <span class="badge ${colorClassForStatus(status)} quote-report-badge">${percent}%</span>
            </div>
            <div class="quote-report-status-bar">
              <div class="quote-report-status-fill ${colorClassForStatus(status)}" style="width:${percent}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAgingCards(groups) {
    const container = document.getElementById("quoteReportAgingCards");
    if (!container) return;

    const bucketStats = QUOTE_REPORT_AGE_BUCKETS.filter((bucket) => bucket.key !== "all").reduce((acc, bucket) => {
      acc[bucket.key] = { count: 0, value: 0 };
      return acc;
    }, {});

    groups.forEach((group) => {
      if (!bucketStats[group.ageBucket]) return;
      bucketStats[group.ageBucket].count += 1;
      bucketStats[group.ageBucket].value += group.activeValue || 0;
    });

    const totalGroups = groups.filter((group) => group.ageBucket && group.ageBucket !== "all").length || 0;

    container.innerHTML = QUOTE_REPORT_AGE_BUCKETS.filter((bucket) => bucket.key !== "all")
      .map((bucket) => {
        const stat = bucketStats[bucket.key] || { count: 0, value: 0 };
        const percent = totalGroups ? Math.round((stat.count / totalGroups) * 100) : 0;
        return `
          <div class="quote-report-aging-card p-3">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <div class="quote-report-aging-label">${t(bucket.labelKey)}</div>
                <div class="quote-report-aging-count h4 mb-0">${stat.count}</div>
              </div>
              <span class="badge bg-secondary quote-report-badge">${percent}%</span>
            </div>
            <div class="small text-muted mb-2">${formatCurrency(stat.value)}</div>
            <div class="quote-report-aging-bar">
              <div class="quote-report-aging-fill bg-primary" style="width:${percent}%"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderSuppliers(groups) {
    const container = document.getElementById("quoteReportSuppliers");
    if (!container) return;

    const stats = {};
    groups.forEach((group) => {
      const supplier = group.supplier || "Unknown";
      if (!stats[supplier]) {
        stats[supplier] = {
          groups: 0,
          lines: 0,
          value: 0,
          statusCounts: {},
        };
      }

      stats[supplier].groups += 1;
      stats[supplier].lines += group.activeLines || 0;
      stats[supplier].value += group.activeValue || 0;
      Object.entries(group.statusCounts || {}).forEach(([status, count]) => {
        stats[supplier].statusCounts[status] = (stats[supplier].statusCounts[status] || 0) + count;
      });
    });

    const sorted = Object.entries(stats)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 6);

    if (!sorted.length) {
      container.innerHTML = `<div class="text-muted small">${t("quote_report_no_suppliers")}</div>`;
      return;
    }

    container.innerHTML = sorted
      .map(([supplier, info], index) => {
        const dominant = Object.entries(info.statusCounts)
          .filter(([status]) => status !== "Deleted")
          .sort((a, b) => b[1] - a[1])[0];
        const dominantLabel = dominant ? dominant[0] : "Deleted";

        return `
          <div class="quote-report-supplier-card p-3">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
              <div class="quote-report-supplier-name text-truncate">${index + 1}. ${supplier}</div>
              <span class="badge ${colorClassForStatus(dominantLabel)} quote-report-badge">${dominantLabel}</span>
            </div>
            <div class="quote-report-supplier-meta">${info.groups} quote group(s) | ${info.lines} active line(s)</div>
            <div class="h5 mb-0 mt-2 text-success">${formatCurrency(info.value)}</div>
          </div>
        `;
      })
      .join("");
  }

  function buildStatusMixText(group) {
    const parts = (group.activeStatuses || []).map((entry) => `${entry.status} ${entry.count}`);
    if (group.deletedLines) parts.push(`Deleted ${group.deletedLines}`);
    return parts.length ? parts.join(" · ") : t("msg_no_items");
  }

  function flattenGroupsForExport(groups) {
    const rows = [];
    groups.forEach((group) => {
      (group.items || []).forEach((item) => {
        rows.push({
          Quote: group.quoteId || group.refCotiz || "",
          Req: group.orderId || "",
          Supplier: group.supplier || "",
          Site: group.faena || "",
          Category: group.category || "",
          SubCategory: group.subCategory || "",
          GEO: item.geo || "",
          P_N: item.pn || item.p || "",
          Description: item.es || item.desc || "",
          Qty: Number(item.cant || item.qty || 0),
          Price: Number(item.price || 0),
          Total: lineTotal(item),
          Status: normalizeQuoteReportStatus(item.status || item.estado),
          Updated: formatDateTime(group.latestDate),
        });
      });
    });
    return rows;
  }

  function renderTable(groups) {
    const body = document.getElementById("quoteReportTableBody");
    const results = document.getElementById("quoteReportResults");
    if (!body) return;

    quoteReportFilteredGroups = groups || [];

    if (results) {
      results.textContent = `${quoteReportFilteredGroups.length} ${t("quote_report_visible_groups")}`;
    }

    if (!quoteReportFilteredGroups.length) {
      body.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-muted py-4">${t("quote_report_no_matches")}</td>
        </tr>
      `;
      return;
    }

    body.innerHTML = quoteReportFilteredGroups
      .map((group) => {
        const pdfCell = group.quoteLink
          ? `<a class="btn btn-sm btn-outline-danger" href="${group.quoteLink}" target="_blank">PDF</a>`
          : `<span class="text-muted small">${t("quote_report_no_pdf")}</span>`;

        return `
          <tr>
            <td class="fw-bold">${group.quoteId || group.refCotiz || "N/A"}</td>
            <td>${group.orderId || ""}</td>
            <td>${group.supplier || ""}</td>
            <td>${group.faena || ""}</td>
            <td>${group.category || ""}${group.subCategory ? ` / ${group.subCategory}` : ""}</td>
            <td class="text-center">${group.totalLines || 0}</td>
            <td><div class="small text-muted">${buildStatusMixText(group)}</div></td>
            <td class="text-end fw-bold">${formatCurrency(group.activeValue || 0)}</td>
            <td class="small text-muted">${formatDateTime(group.latestDate)}</td>
            <td class="text-end">${pdfCell}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderAllViews() {
    renderMetrics(quoteReportFilteredGroups);
    renderStatusCards(quoteReportFilteredGroups);
    renderAgingCards(quoteReportFilteredGroups);
    renderSuppliers(quoteReportFilteredGroups);
    renderTable(quoteReportFilteredGroups);
  }

  function setViewMode(mode) {
    quoteReportViewMode = mode === "table" ? "table" : "chart";
    localStorage.setItem("quote_report_view_mode", quoteReportViewMode);

    const chartView = document.getElementById("quoteReportChartView");
    const tableView = document.getElementById("quoteReportTableView");
    const chartBtn = document.getElementById("quoteReportChartToggle");
    const tableBtn = document.getElementById("quoteReportTableToggle");

    if (chartView) chartView.classList.toggle("d-none", quoteReportViewMode !== "chart");
    if (tableView) tableView.classList.toggle("d-none", quoteReportViewMode !== "table");
    if (chartBtn) chartBtn.classList.toggle("btn-light", quoteReportViewMode === "chart");
    if (chartBtn) chartBtn.classList.toggle("btn-outline-light", quoteReportViewMode !== "chart");
    if (tableBtn) tableBtn.classList.toggle("btn-light", quoteReportViewMode === "table");
    if (tableBtn) tableBtn.classList.toggle("btn-outline-light", quoteReportViewMode !== "table");
  }

  function exportToExcel() {
    if (!window.XLSX) {
      Swal.fire(t("msg_error"), "XLSX library not available", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const metrics = getMetrics(quoteReportFilteredGroups);

    const summarySheet = XLSX.utils.json_to_sheet([
      { Metric: t("quote_report_quote_groups"), Value: metrics.quoteGroups },
      { Metric: t("quote_report_active_lines"), Value: metrics.activeLines },
      { Metric: t("quote_report_deleted_lines"), Value: metrics.deletedLines },
      { Metric: t("quote_report_active_value"), Value: metrics.activeValue },
      { Metric: t("quote_report_top_suppliers"), Value: metrics.uniqueSuppliers },
    ]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const groupRows = quoteReportFilteredGroups.map((group) => ({
      Quote: group.quoteId || group.refCotiz || "",
      Req: group.orderId || "",
      Supplier: group.supplier || "",
      Site: group.faena || "",
      Category: group.category || "",
      SubCategory: group.subCategory || "",
      Lines: group.totalLines || 0,
      ActiveLines: group.activeLines || 0,
      DeletedLines: group.deletedLines || 0,
      ActiveValue: group.activeValue || 0,
      AgeDays: group.ageDays == null ? "" : group.ageDays,
      AgingBucket: bucketLabel(group.ageBucket),
      StatusMix: buildStatusMixText(group),
      Updated: formatDateTime(group.latestDate),
      QuoteLink: group.quoteLink || "",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupRows), "Groups");

    const lineRows = flattenGroupsForExport(quoteReportFilteredGroups);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lineRows), "Lines");

    const agingRows = QUOTE_REPORT_AGE_BUCKETS.filter((bucket) => bucket.key !== "all").map((bucket) => {
      const filtered = quoteReportFilteredGroups.filter((group) => group.ageBucket === bucket.key);
      return {
        AgingBucket: t(bucket.labelKey),
        Groups: filtered.length,
        ActiveValue: filtered.reduce((sum, group) => sum + (group.activeValue || 0), 0),
      };
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(agingRows), "Aging");

    XLSX.writeFile(workbook, `quotes_report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportToPdf() {
    const jsPdfCtor = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPdfCtor) {
      Swal.fire(t("msg_error"), "PDF libraries not available", "error");
      return;
    }

    const doc = new jsPdfCtor({ orientation: "landscape", unit: "pt", format: "a4" });
    const runAutoTable = doc.autoTable
      ? (options) => doc.autoTable(options)
      : (options) => (typeof window.autoTable === "function" ? window.autoTable(doc, options) : null);
    const metrics = getMetrics(quoteReportFilteredGroups);

    doc.setFontSize(16);
    doc.text(t("quote_report_title"), 40, 34);
    doc.setFontSize(10);
    doc.text(t("quote_report_subtitle"), 40, 50);

    const summaryData = [
      [t("quote_report_quote_groups"), String(metrics.quoteGroups)],
      [t("quote_report_active_lines"), String(metrics.activeLines)],
      [t("quote_report_deleted_lines"), String(metrics.deletedLines)],
      [t("quote_report_active_value"), formatCurrency(metrics.activeValue)],
    ];
    const summaryTable = runAutoTable({
      startY: 62,
      head: [["Metric", "Value"]],
      body: summaryData,
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 110, 253] },
    });

    const groupRows = quoteReportFilteredGroups.map((group) => [
      group.quoteId || group.refCotiz || "",
      group.orderId || "",
      group.supplier || "",
      group.faena || "",
      `${group.category || ""}${group.subCategory ? ` / ${group.subCategory}` : ""}`,
      String(group.totalLines || 0),
      buildStatusMixText(group),
      formatCurrency(group.activeValue || 0),
      formatDateTime(group.latestDate),
    ]);

    if (summaryTable && doc.lastAutoTable) {
      runAutoTable({
        startY: doc.lastAutoTable.finalY + 12,
        head: [[t("quote_report_quote"), t("quote_report_req"), t("quote_report_supplier"), t("quote_report_site"), t("quote_report_category"), t("quote_report_lines"), t("quote_report_status_mix"), t("quote_report_active_value"), t("quote_report_updated")]],
        body: groupRows,
        theme: "grid",
        styles: { fontSize: 8 },
        headStyles: { fillColor: [22, 50, 79] },
      });
    } else {
      let y = 70;
      doc.setFontSize(10);
      doc.text(t("quote_report_quote_groups") + ": " + metrics.quoteGroups, 40, y);
      y += 16;
      doc.text(t("quote_report_active_lines") + ": " + metrics.activeLines, 40, y);
      y += 16;
      doc.text(t("quote_report_deleted_lines") + ": " + metrics.deletedLines, 40, y);
      y += 16;
      doc.text(t("quote_report_active_value") + ": " + formatCurrency(metrics.activeValue), 40, y);
      y += 24;

      quoteReportFilteredGroups.slice(0, 20).forEach((group) => {
        const line = `${group.quoteId || group.refCotiz || "N/A"} | ${group.supplier || ""} | ${group.faena || ""} | ${group.totalLines || 0} | ${formatCurrency(group.activeValue || 0)}`;
        if (y > 520) {
          doc.addPage();
          y = 40;
        }
        doc.text(line, 40, y);
        y += 14;
      });
    }

    doc.save(`quotes_report_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function wireEvents() {
    ["quoteReportSiteFilter", "quoteReportSupplierFilter", "quoteReportStatusFilter", "quoteReportAgingFilter", "quoteReportSearch", "quoteReportDateFrom", "quoteReportDateTo"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        filterGroups();
        renderAllViews();
      });
      el.addEventListener("input", () => {
        filterGroups();
        renderAllViews();
      });
    });

    const resetBtn = document.getElementById("quoteReportResetBtn");
    if (resetBtn) {
      resetBtn.onclick = function () {
        const ids = ["quoteReportSiteFilter", "quoteReportSupplierFilter", "quoteReportStatusFilter", "quoteReportAgingFilter", "quoteReportSearch", "quoteReportDateFrom", "quoteReportDateTo"];
        ids.forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          if (id === "quoteReportStatusFilter") el.value = "active";
          else if (id === "quoteReportAgingFilter") el.value = "all";
          else el.value = "";
        });
        filterGroups();
        renderAllViews();
      };
    }

    const chartBtn = document.getElementById("quoteReportChartToggle");
    const tableBtn = document.getElementById("quoteReportTableToggle");
    if (chartBtn) chartBtn.onclick = () => setViewMode("chart");
    if (tableBtn) tableBtn.onclick = () => setViewMode("table");

    const excelBtn = document.getElementById("quoteReportExportExcel");
    const pdfBtn = document.getElementById("quoteReportExportPdf");
    if (excelBtn) excelBtn.onclick = exportToExcel;
    if (pdfBtn) pdfBtn.onclick = exportToPdf;
  }

  window.initQuoteReportModule = function () {
    const loading = document.getElementById("quoteReportLoading");
    const content = document.getElementById("quoteReportContent");
    if (!loading || !content) return;

    applyStaticTranslations();

    if (!quoteReportReady) {
      wireEvents();
      quoteReportReady = true;
    }

    loading.classList.remove("d-none");
    content.classList.add("d-none");

    google.script.run
      .withSuccessHandler(function (rows) {
        quoteReportRows = Array.isArray(rows) ? rows : [];
        quoteReportGroups = buildReportGroups(quoteReportRows);
        populateSelects(quoteReportRows);
        const agingSel = document.getElementById("quoteReportAgingFilter");
        const statusSel = document.getElementById("quoteReportStatusFilter");
        if (agingSel && !agingSel.value) agingSel.value = "all";
        if (statusSel && !statusSel.value) statusSel.value = "active";
        filterGroups();
        renderAllViews();
        loading.classList.add("d-none");
        content.classList.remove("d-none");
        setViewMode(quoteReportViewMode);
      })
      .withFailureHandler(function (err) {
        loading.innerHTML = `<div class="alert alert-danger">${t("msg_error")}: ${String(err)}</div>`;
      })
      .getHistoryData();
  };

})();
