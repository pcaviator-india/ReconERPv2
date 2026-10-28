// =============================================
// DASHBOARD JS v2 - Interactive Control Tower
// =============================================
// Features: Animated counters, clickable KPIs, real spending,
// doughnut chart, dark mode, timeline view, filter bar,
// stock health gauge, comparison badges, bottleneck drill-down
// =============================================

// ─── HELPERS ───────────────────────────────────────

function normalizeStage(s) {
  if (!s) return "Pending";
  const x = String(s).toLowerCase();
  // "Not Quoted" must be caught BEFORE the bare 'quot' check: otherwise the
  // supplier-didn't-quote state inflates the "Quoted" counts on the dashboard.
  if ((x.includes("not") && x.includes("quot")) || x.includes("no cotiz") || x.includes("sin cotiz")) return "Not Quoted";
  if (x.includes("final") || x.includes("received") || x.includes("recib")) return "Final Received";
  if (x.includes("po") || x.includes("orden") || x.includes("ordered")) return "PO Created";
  if (x.includes("approv") || x.includes("aprob")) return "Approved";
  if (x.includes("quot") || x.includes("cotiz")) return "Quoted";
  if (x.includes("rfq") || x.includes("sent")) return "RFQ Issued";
  if (x.includes("pend")) return "Pending";
  return "Created";
}

function getStatusColor(status) {
  const s = normalizeStage(status);
  const map = {
    "Pending": "#ffc107",
    "Quoted": "#198754",
    "Approved": "#0dcaf0",
    "PO Created": "#0d6efd",
    "RFQ Issued": "#6f42c1",
    "Final Received": "#20c997",
    "Created": "#adb5bd"
  };
  return map[s] || "#adb5bd";
}

// ─── ANIMATED COUNTER ──────────────────────────────

function animateCounter(el, target, duration = 800, prefix = "", suffix = "") {
  if (!el) return;
  const start = performance.now();
  const isFloat = target % 1 !== 0;

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const current = eased * target;
    if (isFloat) {
      el.textContent = prefix + current.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + suffix;
    } else {
      el.textContent = prefix + Math.round(current).toLocaleString('es-CL') + suffix;
    }
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  requestAnimationFrame(update);
}

// ─── DARK MODE ─────────────────────────────────────

function toggleDarkMode() {
  const container = document.querySelector('.dash-container');
  if (!container) return;
  container.classList.toggle('dark-mode');
  const isDark = container.classList.contains('dark-mode');
  localStorage.setItem('recon_dash_dark', isDark ? '1' : '0');
  const icon = document.querySelector('#darkModeToggle i');
  if (icon) {
    icon.className = isDark ? 'bi bi-sun' : 'bi bi-moon-stars';
  }
}

function initDarkMode() {
  const saved = localStorage.getItem('recon_dash_dark') === '1';
  const container = document.querySelector('.dash-container');
  if (saved && container) {
    container.classList.add('dark-mode');
    const icon = document.querySelector('#darkModeToggle i');
    if (icon) icon.className = 'bi bi-sun';
  }
}

// ─── MONTH NAME HELPER ─────────────────────────────

function getMonthName(d, short) {
  if (short === undefined) short = true;
  const names = short
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[d.getMonth()];
}

// ─── MAIN INIT ─────────────────────────────────────

window.initDashboard = function () {
  const user = JSON.parse(localStorage.getItem("recon_user_secure") || "{}");
  const role = String(user.role || "").toLowerCase().trim();
  const site = String(user.site || "").trim();
  const userCategory = String(user.position || "").toLowerCase().trim();

  console.log(`🚀 Dashboard v2 Init → Role: ${role} | Site: ${site} | Category: ${userCategory}`);

  google.script.run
    .withSuccessHandler(function (history) {
      let data = history || [];

      let isFiltered = false;
      let filterMessage = "";

      if (role === "user" && site) {
        data = data.filter(r =>
          String(r.faena || r.site || "").toLowerCase() === site.toLowerCase()
        );
        isFiltered = true;
        filterMessage = `Showing only <strong>${site}</strong> data`;
      }
      else if (role === "office" && userCategory) {
        data = data.filter(r =>
          String(r.category || "").toLowerCase().includes(userCategory)
        );
        isFiltered = true;
        filterMessage = `Showing only <strong>${userCategory}</strong> category`;
      }

      window._dashFullData = data;

      const notice = document.getElementById("filter-notice");
      if (notice) {
        if (isFiltered) {
          notice.classList.remove("d-none");
          document.getElementById("filter-text").innerHTML = filterMessage;
        } else {
          notice.classList.add("d-none");
        }
      }

      const siteSelect = document.getElementById("dashFilterSite");
      if (siteSelect) {
        const sites = [...new Set(data.map(r => r.faena || r.site || "Unknown").filter(Boolean))];
        sites.sort();
        siteSelect.innerHTML = '<option value="all">All Sites</option>' +
          sites.map(s => `<option value="${s}">${s}</option>`).join('');
      }

      google.script.run
        .withSuccessHandler(function (stockData) {
          DashboardUI.renderAll(data, user, stockData || []);
        })
        .withFailureHandler(function () {
          DashboardUI.renderAll(data, user, []);
        })
        .getFullStockData();
    })
    .withFailureHandler(err => {
      console.error("❌ Failed to load dashboard data:", err);
    })
    .getRequirementsHistory();
};

// =============================================
// DASHBOARD UI ENGINE v2
// =============================================
const DashboardUI = {

  _currentData: [],
  _currentUser: {},
  _currentStock: [],

  renderAll: function(data, user, stockData) {
    this._currentData = data;
    this._currentUser = user;
    this._currentStock = stockData;

    initDarkMode();

    document.querySelectorAll('.stagger-item').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    });

    this.renderKPIs(data);
    this.renderAgingCards(data);
    this.renderFunnelChart(data);
    this.renderCategoryDoughnut(data);
    this.renderStockHealthGauge(stockData);
    this.renderSpendingTrend(data);
    this.renderBottlenecks(data);
    this.renderActivityTimeline(data);
    this.renderBreakdownCards(data, user);
    this.renderTopSuppliers(data);

    if (typeof updateUI === "function") updateUI();
  },

  // ══════════════════════════════════════════
  // 1. KPI CARDS (Clickable, Animated Counters)
  // ══════════════════════════════════════════
  renderKPIs: function(data) {
    const container = document.getElementById("kpi-row");
    if (!container) return;

    const pending = data.filter(r => normalizeStage(r.estado) === "Pending");
    const quoted = data.filter(r => normalizeStage(r.estado) === "Quoted");
    const po = data.filter(r => normalizeStage(r.estado) === "PO Created");
    const totalValue = data.reduce((sum, r) => sum + (Number(r.price||0) * Number(r.cant||r.qty||0)), 0);

    const now = new Date();
    const currentMonth = now.getMonth();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const currentYear = now.getFullYear();
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const pendingLastMonth = data.filter(r => {
      const d = new Date(r.fecha);
      return normalizeStage(r.estado) === "Pending" && d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    }).length;
    const diff = pending.length - pendingLastMonth;
    const compareHtml = diff !== 0
      ? `<span class="kpi-compare-badge ${diff > 0 ? 'bg-danger bg-opacity-10 text-danger' : 'bg-success bg-opacity-10 text-success'}">
          ${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)} vs last month
        </span>`
      : `<span class="kpi-compare-badge bg-secondary bg-opacity-10 text-muted">↔ Same</span>`;

    const kpis = [
      { label: 'Pending Requirements', value: pending.length, color: 'var(--kpi-gradient-1)', icon: 'bi-clock-history', id: 'pending' },
      { label: 'Quoted', value: quoted.length, color: 'var(--kpi-gradient-2)', icon: 'bi-check2-circle', id: 'quoted' },
      { label: 'PO Created', value: po.length, color: 'var(--kpi-gradient-3)', icon: 'bi-file-earmark-check', id: 'po' },
      { label: 'Est. Value', value: `$${Math.round(totalValue/1000000)}M`, raw: Math.round(totalValue/1000000), color: 'var(--kpi-gradient-4)', icon: 'bi-currency-dollar', id: 'value' }
    ];

    container.innerHTML = kpis.map((k, i) => `
      <div class="col-6 col-md-3 stagger-item">
        <div class="card kpi-card shadow-sm h-100"
             style="background: ${k.color}; color: white;"
             onclick="DashboardUI.onKpiClick('${k.id}')"
             title="Click to filter by ${k.label}">
          <div class="card-body position-relative">
            <div class="kpi-value">
              <span class="count-up" id="kpi-val-${i}">0</span>
              ${k.id === 'value' ? '' : ''}
            </div>
            <p class="kpi-label">${k.label}</p>
            ${i === 0 ? compareHtml : ''}
            <i class="bi ${k.icon} kpi-icon"></i>
          </div>
        </div>
      </div>
    `).join('');

    // Animate counters
    kpis.forEach((k, i) => {
      const el = document.getElementById(`kpi-val-${i}`);
      if (el && k.id !== 'value') {
        animateCounter(el, k.value, 800);
      } else if (el && k.id === 'value') {
        el.textContent = `$${k.raw}M`;
      }
    });
  },

  onKpiClick: function(id) {
    const map = {
      'pending': 'Pending',
      'quoted': 'Quoted',
      'po': 'PO Created'
    };
    const stage = map[id];
    if (!stage) return;
    if (typeof loadModule === 'function') {
      loadModule('ViewReq');
      // Store filter to apply after ViewReq loads
      setTimeout(() => {
        if (typeof window.applyStatusFilter === 'function') {
          window.applyStatusFilter(stage);
        }
      }, 500);
    }
  },

  // ══════════════════════════════════════════
  // 2. AGING ANALYSIS
  // ══════════════════════════════════════════
  renderAgingCards: function(data) {
    const container = document.getElementById("aging-row");
    if (!container) return;

    const now = new Date();
    let pending7 = 0, quoted14 = 0;

    data.forEach(r => {
      const stage = normalizeStage(r.estado);
      const date = new Date(r.fecha);
      const days = Math.floor((now - date) / (1000*60*60*24));
      if (stage === "Pending" && days > 7) pending7++;
      if (stage === "Quoted" && days > 14) quoted14++;
    });

    const totalActive = data.length;

    container.innerHTML = `
      <div class="col-md-4 stagger-item">
        <div class="card aging-card shadow-sm h-100 p-3 ${pending7 > 5 ? 'border-danger' : 'border-warning'}" style="border-left: 5px solid ${pending7 > 5 ? '#dc3545' : '#ffc107'};">
          <div class="d-flex align-items-center gap-3">
            <div class="rounded-circle bg-danger bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
              <i class="bi ${pending7 > 5 ? 'bi-exclamation-triangle' : 'bi-clock'} text-danger fs-5"></i>
            </div>
            <div>
              <h4 class="mb-0 fw-bold text-danger">${pending7}</h4>
              <p class="mb-0 small text-muted">Pending > 7 days</p>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-4 stagger-item">
        <div class="card aging-card shadow-sm h-100 p-3 ${quoted14 > 3 ? 'border-danger' : 'border-warning'}" style="border-left: 5px solid ${quoted14 > 3 ? '#dc3545' : '#ffc107'};">
          <div class="d-flex align-items-center gap-3">
            <div class="rounded-circle bg-warning bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
              <i class="bi bi-hourglass-split text-warning fs-5"></i>
            </div>
            <div>
              <h4 class="mb-0 fw-bold text-warning">${quoted14}</h4>
              <p class="mb-0 small text-muted">Quoted > 14 days</p>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-4 stagger-item">
        <div class="card aging-card shadow-sm h-100 p-3" style="border-left: 5px solid #0dcaf0;">
          <div class="d-flex align-items-center gap-3">
            <div class="rounded-circle bg-info bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
              <i class="bi bi-boxes text-info fs-5"></i>
            </div>
            <div>
              <h4 class="mb-0 fw-bold text-info">${totalActive}</h4>
              <p class="mb-0 small text-muted">Total Active Items</p>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ══════════════════════════════════════════
  // 3. PROCUREMENT FUNNEL (Clickable Bars)
  // ══════════════════════════════════════════
  renderFunnelChart: function(data) {
    const ctx = document.getElementById("funnelChart");
    if (!ctx || typeof Chart === "undefined") return;

    if (window.funnelChartInstance) window.funnelChartInstance.destroy();

    const stages = ["Created","RFQ Issued","Quoted","Approved","PO Created","Final Received"];
    const counts = {};
    stages.forEach(s => counts[s] = 0);
    data.forEach(r => {
      const stage = normalizeStage(r.estado);
      if (counts[stage] !== undefined) counts[stage]++;
    });

    const colors = ['#adb5bd','#6f42c1','#198754','#0dcaf0','#0d6efd','#20c997'];

    window.funnelChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: stages,
        datasets: [{
          label: 'Items',
          data: stages.map(s => counts[s]),
          backgroundColor: colors,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.raw + ' items';
              }
            }
          }
        },
        onClick: function(e, item) {
          if (item.length > 0) {
            const index = item[0].datasetIndex;
            const label = this.data.labels[item[0].index];
            const stage = label;
            if (typeof loadModule === 'function') {
              loadModule('ViewReq');
              setTimeout(() => {
                if (typeof window.applyStatusFilter === 'function') {
                  window.applyStatusFilter(stage);
                }
              }, 500);
            }
          }
        }
      }
    });
  },

  // ══════════════════════════════════════════
  // 4. CATEGORY DOUGHNUT CHART
  // ══════════════════════════════════════════
  renderCategoryDoughnut: function(data) {
    const ctx = document.getElementById("categoryDoughnutChart");
    if (!ctx || typeof Chart === "undefined") return;

    if (window.doughnutChartInstance) window.doughnutChartInstance.destroy();

    const catCounts = {};
    data.forEach(r => {
      const cat = r.category || "Other";
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const sorted = Object.entries(catCounts).sort((a,b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const other = sorted.slice(6);
    const labels = top.map(([name]) => name);
    const values = top.map(([,count]) => count);
    if (other.length > 0) {
      labels.push('Other');
      values.push(other.reduce((sum, [,c]) => sum + c, 0));
    }

    const colors = ['#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0','#6610f2','#adb5bd'];

    window.doughnutChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 10,
              font: { size: 10 }
            }
          }
        }
      }
    });
  },

  // ══════════════════════════════════════════
  // 5. STOCK HEALTH GAUGE
  // ══════════════════════════════════════════
  renderStockHealthGauge: function(stockData) {
    const container = document.getElementById("stock-health-body");
    if (!container) return;

    if (!stockData || stockData.length === 0) {
      container.innerHTML = '<p class="text-center text-muted small">No stock data available</p>';
      return;
    }

    let totalQty = 0, totalAvailable = 0, totalReserved = 0;
    let zeroStockCount = 0, lowStockCount = 0, healthyCount = 0;

    stockData.forEach(function(item) {
      const qty = Number(item.Quantity) || 0;
      const reserved = Number(item.ReservedQty) || 0;
      const available = Number(item.AvailableQty) || qty - reserved;
      totalQty += qty;
      totalReserved += reserved;
      totalAvailable += available;
      if (qty === 0) zeroStockCount++;
      else if (available <= 0 || qty <= 5) lowStockCount++;
      else healthyCount++;
    });

    const healthPercent = stockData.length > 0
      ? Math.round((healthyCount / stockData.length) * 100)
      : 0;

    const gaugeColor = healthPercent >= 70 ? '#198754' : healthPercent >= 40 ? '#ffc107' : '#dc3545';

    // Render a simple circular gauge using CSS
    container.innerHTML = `
      <div class="stock-gauge-container">
        <div class="position-relative" style="width: 140px; height: 140px;">
          <canvas id="stockGaugeCanvas" width="140" height="140"></canvas>
          <div class="stock-gauge-value">
            <span style="color: ${gaugeColor};">${healthPercent}%</span>
            <div class="stock-gauge-label">Healthy</div>
          </div>
        </div>
        <div class="row g-2 mt-3 w-100">
          <div class="col-4">
            <div class="health-stat-item text-center">
              <div class="fw-bold text-primary">${totalQty.toLocaleString()}</div>
              <small class="text-muted">Total</small>
            </div>
          </div>
          <div class="col-4">
            <div class="health-stat-item text-center">
              <div class="fw-bold text-success">${totalAvailable.toLocaleString()}</div>
              <small class="text-muted">Available</small>
            </div>
          </div>
          <div class="col-4">
            <div class="health-stat-item text-center" title="Items with stock issues">
              <div class="fw-bold text-danger">${zeroStockCount + lowStockCount}</div>
              <small class="text-muted">At Risk</small>
            </div>
          </div>
        </div>
        <div class="mt-2 small text-muted d-flex justify-content-between px-2">
          <span>🟢 ${healthyCount} healthy</span>
          <span>🟡 ${lowStockCount} low</span>
          <span>🔴 ${zeroStockCount} zero</span>
        </div>
      </div>
    `;

    // Draw gauge on canvas
    this._drawGauge(healthPercent, gaugeColor);
  },

  _drawGauge: function(percent, color) {
    const canvas = document.getElementById('stockGaugeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, r = 55;
    const startAngle = -Math.PI * 0.75;
    const endAngle = Math.PI * 0.75;
    const totalAngle = endAngle - startAngle;
    const currentAngle = startAngle + (totalAngle * percent / 100);

    ctx.clearRect(0, 0, w, h);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Foreground arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, currentAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  // ══════════════════════════════════════════
  // 6. SPENDING TREND (Real Data)
  // ══════════════════════════════════════════
  renderSpendingTrend: function(data) {
    const ctx = document.getElementById("spendingChart");
    if (!ctx || typeof Chart === "undefined") return;

    if (window.spendingChartInstance) window.spendingChartInstance.destroy();

    // Compute real monthly spending from Quoted/Approved items
    const now = new Date();
    const months = [];
    const spending = [];

    for (let i = 2; i >= 0; i--) {
      const m = now.getMonth() - i;
      const y = now.getFullYear();
      const month = ((m % 12) + 12) % 12;
      const year = m < 0 ? y - 1 : y;
      const label = getMonthName(new Date(year, month, 1), true);
      months.push(label);

      const total = data.reduce((sum, r) => {
        const d = new Date(r.fecha);
        const stage = normalizeStage(r.estado);
        if (d.getMonth() === month && d.getFullYear() === year &&
            (stage === "Quoted" || stage === "Approved" || stage === "PO Created")) {
          return sum + (Number(r.price||0) * Number(r.cant||r.qty||0));
        }
        return sum;
      }, 0);
      spending.push(total);
    }

    // Compute comparison badge
    const badge = document.getElementById('spendingComparisonBadge');
    if (badge && spending.length >= 2) {
      const prev = spending[1] || 0;
      const curr = spending[2] || 0;
      const pct = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0;
      if (pct > 0) {
        badge.innerHTML = `↑ ${pct}% vs last month`;
        badge.className = 'badge bg-danger bg-opacity-10 text-danger rounded-pill';
      } else if (pct < 0) {
        badge.innerHTML = `↓ ${Math.abs(pct)}% vs last month`;
        badge.className = 'badge bg-success bg-opacity-10 text-success rounded-pill';
      } else {
        badge.innerHTML = '↔ Same as last month';
        badge.className = 'badge bg-secondary bg-opacity-10 text-muted rounded-pill';
      }
    }

    window.spendingChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Spending (CLP)',
          data: spending,
          borderColor: '#198754',
          backgroundColor: 'rgba(25,135,84,0.08)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#198754',
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return '$ ' + Number(ctx.raw).toLocaleString('es-CL');
              }
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: function(val) {
                return '$' + (val / 1000000).toFixed(1) + 'M';
              }
            }
          }
        }
      }
    });
  },

  // ══════════════════════════════════════════
  // 7. BOTTLENECKS (Clickable with drill-down)
  // ══════════════════════════════════════════
  renderBottlenecks: function(data) {
    const container = document.getElementById("bottleneck-body");
    if (!container) return;

    const pending = data.filter(r => normalizeStage(r.estado) === "Pending");
    const totalPending = pending.length;

    const pendingByCat = {};
    pending.forEach(r => {
      const cat = r.category || "Other";
      pendingByCat[cat] = (pendingByCat[cat] || 0) + 1;
    });

    const topBottlenecks = Object.entries(pendingByCat)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 5);

    if (topBottlenecks.length === 0) {
      container.innerHTML = '<div class="text-center py-4 text-muted"><i class="bi bi-emoji-smile fs-1 d-block mb-2"></i>No bottlenecks found</div>';
      return;
    }

    const maxCount = topBottlenecks[0][1];

    let html = `<div class="small text-muted mb-2">${totalPending} items stuck in Pending</div>`;
    topBottlenecks.forEach(([cat, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      html += `
        <div class="bottleneck-item" onclick="DashboardUI.onBottleneckClick('${cat}')" title="Click to view ${cat} pending items">
          <div>
            <div class="fw-semibold small">${cat}</div>
            <div class="bottleneck-bar" style="width: ${pct}%;"></div>
          </div>
          <strong class="small">${count}</strong>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  onBottleneckClick: function(category) {
    if (typeof loadModule === 'function') {
      loadModule('ViewReq');
      setTimeout(() => {
        if (typeof window.applyCategoryFilter === 'function') {
          window.applyCategoryFilter(category);
        }
      }, 500);
    }
  },

  // ══════════════════════════════════════════
  // 8. ACTIVITY TIMELINE
  // ══════════════════════════════════════════
  renderActivityTimeline: function(data) {
    const container = document.getElementById("dash-timeline-container");
    if (!container) return;

    const recent = [...data]
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 10);

    if (recent.length === 0) {
      container.innerHTML = '<div class="text-center py-4 text-muted small">No recent activity</div>';
      return;
    }

    container.innerHTML = recent.map(r => {
      const stage = normalizeStage(r.estado);
      const color = getStatusColor(stage);
      const date = new Date(r.fecha);
      const timeStr = date.toLocaleDateString('es-CL', { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="timeline-item" onclick="window.viewRequirementDetail && window.viewRequirementDetail('${r.order}')">
          <div class="timeline-dot" style="background: ${color};"></div>
          <div class="timeline-content">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <strong class="small">#${r.order}</strong>
                <span class="text-muted small ms-1">${r.pn || '—'}</span>
              </div>
              <span class="timeline-time">${timeStr}</span>
            </div>
            <div class="d-flex gap-2 mt-1">
              <span class="badge rounded-pill" style="background: ${color}; color: white; font-size: 0.6rem;">${stage}</span>
              <small class="text-muted text-truncate">${r.faena || ''}</small>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // ══════════════════════════════════════════
  // 9. BREAKDOWN CARDS (with Table toggle)
  // ══════════════════════════════════════════
  renderBreakdownCards: function(data, user) {
    const container = document.getElementById("breakdown-cards");
    if (!container) return;

    const role = String(user.role || "").toLowerCase();
    let breakdown = {};
    if (role === "user") {
      data.forEach(r => breakdown[r.category || "Other"] = (breakdown[r.category || "Other"] || 0) + 1);
    } else {
      data.forEach(r => breakdown[r.faena || "Unknown"] = (breakdown[r.faena || "Unknown"] || 0) + 1);
    }

    const title = role === "user" ? "By Category" : "By Site";
    const entries = Object.entries(breakdown).sort((a,b) => b[1] - a[1]).slice(0, 8);
    const maxCount = entries.length > 0 ? entries[0][1] : 1;

    // Save for table toggle
    this._breakdownData = { entries, title, maxCount, data, role };

    let html = `<h5 class="fw-bold mb-3">${title}</h5><div class="row g-3">`;
    entries.forEach(([name, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      html += `
        <div class="col-md-3 col-sm-6">
          <div class="card dash-glass-card h-100 p-0 overflow-hidden">
            <div class="card-body p-3">
              <div class="d-flex justify-content-between align-items-start">
                <strong class="small text-truncate">${name}</strong>
                <span class="fw-bold small">${count}</span>
              </div>
              <div class="dash-progress mt-2">
                <div class="dash-progress-bar" style="width: ${pct}%;"></div>
              </div>
            </div>
          </div>
        </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;

    // Also render table
    this._renderBreakdownTable(entries, title);
  },

  _renderBreakdownTable: function(entries, title) {
    const container = document.getElementById("breakdown-table");
    if (!container) return;

    let html = `
      <h5 class="fw-bold mb-3">${title} (Table)</h5>
      <div class="table-responsive">
        <table class="table table-sm table-hover">
          <thead class="table-light">
            <tr><th>Name</th><th class="text-end">Count</th><th class="text-end">%</th></tr>
          </thead>
          <tbody>
    `;
    const total = entries.reduce((s, [,c]) => s + c, 0);
    entries.forEach(([name, count]) => {
      const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
      html += `<tr class="breakdown-table-card">
        <td>${name}</td>
        <td class="text-end fw-bold">${count}</td>
        <td class="text-end text-muted">${pct}%</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    container.innerHTML = html;
  },

  toggleBreakdownView: function(view) {
    const cards = document.getElementById("breakdown-cards");
    const table = document.getElementById("breakdown-table");
    const cardsBtn = document.getElementById("viewCardsBtn");
    const tableBtn = document.getElementById("viewTableBtn");
    if (!cards || !table) return;

    if (view === 'cards') {
      cards.classList.remove('d-none');
      table.classList.add('d-none');
      cardsBtn.className = 'btn btn-sm rounded-pill btn-primary';
      tableBtn.className = 'btn btn-sm rounded-pill btn-outline-primary';
    } else {
      cards.classList.add('d-none');
      table.classList.remove('d-none');
      cardsBtn.className = 'btn btn-sm rounded-pill btn-outline-primary';
      tableBtn.className = 'btn btn-sm rounded-pill btn-primary';
    }
  },

  // ══════════════════════════════════════════
  // 10. TOP SUPPLIERS (with Heat Bar)
  // ══════════════════════════════════════════
  renderTopSuppliers: function(data) {
    const container = document.getElementById("top-suppliers-row");
    if (!container) return;

    const stats = {};
    data.filter(r => normalizeStage(r.estado) === "Quoted")
      .forEach(r => {
        const sup = r.supplier || "Unknown";
        if (!stats[sup]) stats[sup] = {count:0, value:0};
        stats[sup].count++;
        stats[sup].value += Number(r.price||0) * Number(r.cant||r.qty||0);
      });

    const top = Object.entries(stats)
      .sort((a,b) => b[1].value - a[1].value)
      .slice(0, 4);

    const maxValue = top.length > 0 ? top[0][1].value : 1;

    container.innerHTML = top.length
      ? top.map(([name, s]) => {
          const heatPct = Math.round((s.value / maxValue) * 100);
          const heatColor = heatPct >= 70 ? '#dc3545' : heatPct >= 40 ? '#ffc107' : '#198754';
          return `
            <div class="col-md-3 col-6">
              <div class="card supplier-card shadow-sm h-100">
                <div class="card-body p-3">
                  <div class="fw-bold small text-truncate">${name}</div>
                  <div class="h5 text-success mb-0">$${Math.round(s.value).toLocaleString('es-CL')}</div>
                  <small class="text-muted">${s.count} items</small>
                  <div class="supplier-heat-bar" style="width: ${heatPct}%; background: ${heatColor};"></div>
                </div>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="col-12"><p class="text-center text-muted small">No supplier activity data</p></div>';
  },

  // ══════════════════════════════════════════
  // FILTER BAR
  // ══════════════════════════════════════════
  applyFilters: function() {
    const status = document.getElementById('dashFilterStatus')?.value || 'all';
    const site = document.getElementById('dashFilterSite')?.value || 'all';
    const from = document.getElementById('dashFilterFrom')?.value || '';
    const to = document.getElementById('dashFilterTo')?.value || '';

    let data = window._dashFullData || [];

    if (status !== 'all') {
      const stageMap = {
        'pending': 'Pending',
        'quoted': 'Quoted',
        'approved': 'Approved',
        'po': 'PO Created'
      };
      const targetStage = stageMap[status];
      if (targetStage) {
        data = data.filter(r => normalizeStage(r.estado) === targetStage);
      }
    }

    if (site !== 'all') {
      data = data.filter(r => (r.faena || r.site || '') === site);
    }

    if (from) {
      const fromDate = new Date(from);
      data = data.filter(r => new Date(r.fecha) >= fromDate);
    }

    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      data = data.filter(r => new Date(r.fecha) <= toDate);
    }

    // Re-render with filtered data
    this.renderAll(data, this._currentUser, this._currentStock);
  },

  clearFilters: function() {
    document.getElementById('dashFilterStatus').value = 'all';
    document.getElementById('dashFilterSite').value = 'all';
    document.getElementById('dashFilterFrom').value = '';
    document.getElementById('dashFilterTo').value = '';
    this.applyFilters();
  }
};

window.DashboardUI = DashboardUI;
