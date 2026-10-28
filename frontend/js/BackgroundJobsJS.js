(function () {
  if (window.BgJobs && window.BgJobs.__v === 2) return;
  var jobs = {};
  var timer = null;
  var POLL_MS = 2500;
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function ensureHost() {
    var host = document.getElementById("bgJobsBubbleHost");
    if (host) return host;
    host = document.createElement("div");
    host.id = "bgJobsBubbleHost";
    host.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:min(380px,92vw);";
    document.body.appendChild(host);
    if (!document.getElementById("bgJobsBubbleCss")) {
      var st = document.createElement("style");
      st.id = "bgJobsBubbleCss";
      st.textContent = ".bgjob-card{background:#fff;border:1px solid #dbe4f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:10px 12px;font-size:12px;}" +
        ".bgjob-title{font-weight:700;color:#0b4f8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;}" +
        ".bgjob-step{color:#495057;margin:2px 0 6px;min-height:1.2em;}" +
        ".bgjob-bar{height:7px;background:#e9ecef;border-radius:99px;overflow:hidden;}" +
        ".bgjob-fill{height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#0d6efd,#22b8cf);transition:width .4s ease;}" +
        ".bgjob-done .bgjob-fill{background:linear-gradient(90deg,#198754,#20c997);}" +
        ".bgjob-err .bgjob-fill{background:linear-gradient(90deg,#dc3545,#fd7e14);}" +
        ".bgjob-row{display:flex;align-items:center;gap:8px;}" +
        ".bgjob-x{margin-left:auto;border:0;background:transparent;color:#adb5bd;cursor:pointer;font-size:15px;}" +
        ".bgjob-link{font-size:11px;}" +
        ".bgjob-card.pulse{animation:pulseBg 1.6s ease-in-out 2;}" +
        "@keyframes pulseBg{0%{box-shadow:0 12px 32px rgba(15,23,42,.18);}50%{box-shadow:0 12px 48px rgba(13,110,253,.35);border-color:#86b7fe;}100%{box-shadow:0 12px 32px rgba(15,23,42,.18);}}";
      document.head.appendChild(st);
    }
    return host;
  }
  function cardHtml(id, j) {
    var pct = Math.max(0, Math.min(100, Number(j.progress) || 0));
    var icon = j.status === "DONE" ? "&#9989;" : (j.status === "ERROR" ? "&#10060;" : "&#9203;");
    var link = (j.status === "DONE" && j.pdfUrl) ? " <a href=\"" + esc(j.pdfUrl) + "\" target=\"_blank\">View PDF</a>" : "";
    return "<div class=\"bgjob-row\"><span>" + icon + "</span><span class=\"bgjob-title\">" + esc(j.title || id) + "</span><button class=\"bgjob-x\" data-bgclose=\"" + esc(id) + "\">\u00d7</button></div>" +
      "<div class=\"bgjob-step\">" + esc(j.step || "Working...") + link + "</div>" +
      "<div class=\"bgjob-bar\"><div class=\"bgjob-fill\" style=\"width:" + pct + "%\"></div></div>";
  }
  function render() {
    var host = ensureHost();
    var ids = Object.keys(jobs);
    if (!ids.length) { host.innerHTML = ""; stop(); return; }
    host.innerHTML = ids.map(function (id) {
      var j = jobs[id];
      var cls = j.status === "DONE" ? "bgjob-done" : (j.status === "ERROR" ? "bgjob-err" : "");
      var row = "<div class=\"bgjob-card " + cls + "\">" + cardHtml(id, j) + "</div>";
      // Pulse the card while running so the user spots it in the stack.
      if (j.status === "RUNNING" || j.status === "QUEUED") {
        row = row.replace("<div class=\"bgjob-card", "<div class=\"bgjob-card pulse\"");
      }
      return row;
    }).join("");
    host.querySelectorAll("[data-bgclose]").forEach(function (b) {
      b.onclick = function () { remove(b.getAttribute("data-bgclose")); };
    });
  }
  function poll() {
    var ids = Object.keys(jobs).filter(function (id) { return jobs[id].status === "RUNNING" || jobs[id].status === "QUEUED"; });
    if (!ids.length) { stop(); return; }
    try {
      google.script.run.withSuccessHandler(function (list) {
        (list || []).forEach(function (s) {
          var j = jobs[s.jobId];
          if (!j) return;
          j.status = s.status || j.status;
          if (s.progress !== undefined) j.progress = s.progress;
          if (s.step) j.step = s.step;
          if (s.pdfUrl) j.pdfUrl = s.pdfUrl;
          if (s.error) j.error = s.error;
          if (typeof j.onUpdate === "function") { try { j.onUpdate(j); } catch (e) {} }
          if ((s.status === "DONE" || s.status === "ERROR") && typeof j.onDone === "function") {
            try { var cb = j.onDone; j.onDone = null; cb(j); } catch (e) {}
          }
        });
        render();
        Object.keys(jobs).forEach(function (id) {
          if (jobs[id].status === "DONE" && !jobs[id].__dismissT) {
            jobs[id].__dismissT = setTimeout(function () { remove(id); }, 8000);
          }
        });
      }).withFailureHandler(function () {}).bgGetJobs(ids);
    } catch (e) {}
  }
  function start() { if (!timer) timer = setInterval(poll, POLL_MS); }
  function stop() {
    var active = Object.keys(jobs).some(function (id) { return jobs[id].status === "RUNNING" || jobs[id].status === "QUEUED"; });
    if (!active && timer) { clearInterval(timer); timer = null; }
  }
  function remove(id) { if (jobs[id] && jobs[id].__dismissT) clearTimeout(jobs[id].__dismissT); delete jobs[id]; render(); }
  window.BgJobs = {
    __v: 2,
    push: function (opts) {
      opts = opts || {};
      if (!opts.jobId) return null;
      jobs[opts.jobId] = { title: opts.title || opts.jobId, refId: opts.refId || "", kind: opts.kind || "", status: "RUNNING", progress: 4, step: opts.step || "Sheet saved - finishing in background...", pdfUrl: "", error: "", onUpdate: opts.onUpdate || null, onDone: opts.onDone || null };
      render(); start(); poll();
      return opts.jobId;
    },
    activeCount: function () { return Object.keys(jobs).filter(function (id) { return jobs[id].status === "RUNNING" || jobs[id].status === "QUEUED"; }).length; },
    // Status of ONE tracked job ("RUNNING" / "QUEUED" / "DONE" / "ERROR") or null
    // when the bubble no longer knows it (finished and dismissed, or closed).
    // Lets feature locks (e.g. pendingQuoteSaves in QuoteMgmtJS) self-heal instead
    // of waiting for a callback that will never fire.
    status: function (id) { var j = jobs[String(id || "")]; return j ? (j.status || null) : null; }
  };
})();
