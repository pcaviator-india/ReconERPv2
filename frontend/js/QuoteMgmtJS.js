let groupedQuotes = [];
  let allQuotesRaw = [];
  let visibleQuoteGroups = [];
  // Rows of the quote currently open in the edit modal (see openEditQuote).
  // Declared at MODULE scope because saveEditedQuote also reads it: it needs the
  // ORIGINAL (pre-edit) discount / transport of those rows to decide whether a
  // blank commercials bar means "cleared on purpose" (send 0) or "never filled"
  // (send undefined = server keeps the stored value). While this was a local
  // `const` inside openEditQuote, every save threw
  // "ReferenceError: editRows is not defined".
  let editRows = [];

  // 🕐 QUOTES LOCKED WHILE THEIR BACKGROUND SAVE RUNS.
  // Mirror of window.pendingEditOrderId in ViewEditReqJS.html: a fire-and-forget
  // save closes the edit modal immediately and keeps working server-side
  // (write + PDF + email + stock), so the card must be greyed out and re-editing
  // blocked until that job reports DONE/ERROR - otherwise the user re-opens a
  // modal built from STALE pre-save rows and a second save can run against a
  // sheet the first one is still writing.
  // Key = quoteGroupKey() (orderId | supplier | category), i.e. the exact card
  // identity, so every row of the card locks together.
  const pendingQuoteSaves = {};

  /** Registry key for one quote/card. `meta` may be the group or the edit ctx. */
  function quoteSaveKeyOf(meta) {
    return quoteGroupKey(meta || {});
  }

  /**
   * True while the background save of this quote is still running.
   * Self-healing: once the bubble knows the job, a missing/DONE/ERROR status
   * releases the lock immediately (covers jobs whose callbacks were lost, e.g.
   * the bubble card was closed), and an enqueue that never confirmed is given
   * 60s before it is treated as dead - so a quote can never stay grey forever.
   */
  function isQuoteSavePending(key) {
    const k = String(key || "");
    const entry = pendingQuoteSaves[k];
    if (!entry) return false;
    if (entry.jobId && window.BgJobs && typeof window.BgJobs.status === "function") {
      const st = window.BgJobs.status(entry.jobId);
      if (!st || st === "DONE" || st === "ERROR") {
        delete pendingQuoteSaves[k];
        return false;
      }
      return true;
    }
    if (!entry.jobId && (Date.now() - (entry.at || 0)) > 60000) {
      delete pendingQuoteSaves[k];
      return false;
    }
    return true;
  }

  function markQuoteSavePending(key) {
    pendingQuoteSaves[String(key || "")] = { jobId: "", at: Date.now() };
  }

  function setQuoteSaveJobId(key, jobId) {
    const entry = pendingQuoteSaves[String(key || "")];
    if (entry) entry.jobId = String(jobId || "");
  }

  function clearQuoteSavePending(key) {
    delete pendingQuoteSaves[String(key || "")];
  }

  /** Re-render the cards so the grey "Saving..." state shows / disappears. */
  function refreshQuoteCards_() {
    try {
      // Prefer the filter-aware view built from the FULL card list, so a refresh
      // triggered by a background job still honours the active filter; fall back
      // to the on-screen list when data has not been loaded yet.
      if (typeof renderQuoteView_ === "function" && Array.isArray(groupedQuotes) && groupedQuotes.length) {
        renderQuoteView_(groupedQuotes);
      } else if (typeof renderQuoteCards === "function") {
        renderQuoteCards(visibleQuoteGroups || []);
      }
    } catch (e) {
      console.warn("refreshQuoteCards_ failed: " + e);
    }
  }

  /** Shared "save still running" warning (same wording as the Req fix). */
  function showQuoteSavingWarning_(what) {
    if (window.Swal) {
      Swal.fire({
        icon: "warning",
        title: i18n("msg_saving_in_progress_title", "Save in Progress"),
        text: i18n("msg_quote_saving_in_progress",
          "This quote is still being saved in the background. Please wait for the save to complete before editing it again."),
        confirmButtonColor: "#3085d6",
      });
    }
    return false;
  }

  const QUOTE_ITEM_STATUSES = [
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

  // "Not Quoted" (label "Not quoted by supplier") is a side-branch off Pending,
  // NOT a step of the main flow: inserting it into the strict linear flow would
  // force every quote to pass through it (Pending -> Quoted would become a
  // 2-step jump and be rejected). It is handled by explicit pair rules in
  // isStatusTransitionAllowed (client) and isValidQuoteItemStatusProgression
  // (server) instead.

  // Statuses that are considered "quoted or later" — supplier quote no + quoted
  // document are auto-applied to any item in these states.
  const QUOTED_OR_LATER_STATUSES = [
    "Quoted",
    "Approved",
    "Sent",
    "Received",
    "Despatched",
    "Final Received",
  ];

  // Competitor rows the "Fix Deleted" resync may delete on its own. Only
  // Pending/Quoted/Not Quoted are safe: from Sent onwards the row already carries
  // a supplier
  // quote number, received quantities and (for Pending) a stock reservation, so
  // those are reported for manual review instead of being silently deleted.
  // "Not Quoted" rows carry no price, no quote number and no document, and any
  // Pending-time reservation is released when they are marked, so they are safe
  // to repair automatically, exactly like Pending.
  // Single source of truth: used by the compare table's cell hints AND by
  // resyncQuoteCompare's planner.
  const COMPETITOR_AUTO_DELETE_STATUSES = ["Pending", "Not Quoted", "Quoted"];

  // ---- Status -> light card colours (9 statuses) ----
  const QUOTE_STATUS_COLORS = {
    "Pending":       { bg: "#FFF8E1", border: "#F0C75E", badgeBg: "#FFF3C4", badgeBorder: "#E0B93E", text: "#7A5B00", dot: "#E8B400" },
    "Not Quoted":    { bg: "#F1F3F5", border: "#9AA3AD", badgeBg: "#E9ECEF", badgeBorder: "#ADB5BD", text: "#495057", dot: "#6C757D" },
    "Quoted":        { bg: "#E8F1FF", border: "#7AA9E8", badgeBg: "#D6E6FF", badgeBorder: "#5B93DB", text: "#1A4FA0", dot: "#3B82F6" },
    "Approved":      { bg: "#E9F7EF", border: "#6FCF97", badgeBg: "#D4EFDF", badgeBorder: "#4CAF7D", text: "#1E7A46", dot: "#22C55E" },
    "Sent":          { bg: "#E8FAFD", border: "#5BC8E3", badgeBg: "#D1F2FA", badgeBorder: "#38B6D3", text: "#0E6E85", dot: "#06B6D4" },
    "Received":      { bg: "#F0E9FF", border: "#A78BFA", badgeBg: "#E2D6FF", badgeBorder: "#8B5CF6", text: "#5B21B6", dot: "#8B5CF6" },
    "Despatched":    { bg: "#FFF1E6", border: "#F0A35E", badgeBg: "#FFE3CC", badgeBorder: "#E8823A", text: "#9A4E12", dot: "#F59E0B" },
    "Final Received":{ bg: "#E6F9F0", border: "#34C98E", badgeBg: "#CFF3E2", badgeBorder: "#22B07D", text: "#0B6B45", dot: "#10B981" },
    "Deleted":       { bg: "#FDECEC", border: "#E57373", badgeBg: "#FADBD8", badgeBorder: "#D95F5F", text: "#8E2424", dot: "#EF4444" },
  };

  function quoteStatusColor(status) {
    const s = normalizeQuoteItemStatus(status);
    return QUOTE_STATUS_COLORS[s] || QUOTE_STATUS_COLORS["Pending"];
  }

  // Dominant status of a card = most advanced item status present (by flow order).
  // "Not Quoted" sits between "Pending" and "Quoted": a card that is part
  // untouched / part unquoted reads as Not Quoted, but anything actually quoted
  // outranks it, so it can never mask a Quoted-or-later line.
  function quoteGroupDominantStatus(items) {
    const flow = ["Pending", "Not Quoted", "Quoted", "Approved", "Sent", "Received", "Despatched", "Final Received", "Deleted"];
    let best = "Pending", bestIdx = -1, deletedCount = 0;
    (Array.isArray(items) ? items : []).forEach((it) => {
      const s = normalizeQuoteItemStatus(it.estado || it.status);
      if (s === "Deleted") { deletedCount++; return; }
      const idx = flow.indexOf(s);
      if (idx > bestIdx) { bestIdx = idx; best = s; }
    });
    if (bestIdx === -1 && deletedCount > 0) return "Deleted";
    return best;
  }

  // Render the colour legend next to the header (called after i18n ready + on lang change).
  function renderQuoteStatusLegend() {
    const el = document.getElementById("quoteStatusLegend");
    if (!el) return;
    el.innerHTML = QUOTE_ITEM_STATUSES.map((s) => {
      const c = quoteStatusColor(s);
      return `<span class="legend-pill" title="${attr_(quoteStatusLabel(s))}" style="background:${c.badgeBg};border-color:${c.badgeBorder};color:${c.text};"><span class="legend-dot" style="background:${c.dot};"></span>${quoteStatusLabel(s)}</span>`;
    }).join("");
  }
  window.renderQuoteStatusLegend = renderQuoteStatusLegend;

  function isQuotedOrLaterStatus(value) {
    return QUOTED_OR_LATER_STATUSES.includes(normalizeQuoteItemStatus(value));
  }

  // Escape a value for safe injection into an HTML attribute.
  function attr_(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeQuoteItemStatus(value) {
    const status = String(value || "").trim();
    return QUOTE_ITEM_STATUSES.includes(status) ? status : "Pending";
  }

  // ---- Quoted vs Approved quantity (client twin of QuoteMgmtGS.js) ----
  // "Cant." now holds the QUOTED quantity and is frozen once the line reaches
  // Approved; "Cant. Aprobado" holds what the manager actually signed off. Before
  // this split approving a reduced quantity overwrote "Cant.", so the quoted figure
  // was lost for good. `approvedQty` arrives pre-resolved from the server (a blank
  // cell falls back to the quoted qty), so both can be shown unconditionally.
  const APPROVED_OR_LATER_STATUSES = ["Approved", "Sent", "Received", "Despatched", "Final Received"];

  /** True once the quoted quantity must stop moving (server: isQuoteQtyFrozen_). */
  function isQuoteQtyFrozenStatus(value) {
    const s = normalizeQuoteItemStatus(value);
    return APPROVED_OR_LATER_STATUSES.includes(s) || s === "Deleted";
  }

  /**
   * { quoted, approved, reduced } for one quote line. `approved` falls back to
   * `quoted`, which is what makes pre-existing approved rows display correctly
   * without any backfill.
   */
  function quoteLineQtys(item) {
    const it = item || {};
    const quoted = Number(
      it.quotedQty !== undefined && it.quotedQty !== null && it.quotedQty !== ""
        ? it.quotedQty
        : (it.cant !== undefined ? it.cant : it.qty)
    ) || 0;
    const rawApproved =
      it.approvedQty !== undefined && it.approvedQty !== null && it.approvedQty !== ""
        ? it.approvedQty
        : it.cant;
    const approved = Number(rawApproved) || 0;
    const effective = approved > 0 ? approved : quoted;
    return { quoted, approved: effective, reduced: effective !== quoted };
  }

  // ---- Supplier discount + transport (client twin of QuoteMgmtGS.js) ----
  // Some suppliers quote their list prices and then grant a DISCOUNT, and some
  // add a TRANSPORT / freight charge on top. Both are ONCE PER QUOTE: a single
  // discount % applied to every line's price, and a single transport charge
  // counted once in the totals.
  //
  //   discountPct : percentage the supplier granted on the quoted unit price
  //   freight      : transport charged for the WHOLE supplier quote (a lump sum
  //                  for one delivery, never per unit)
  //
  // The QUOTED unit price (`price`) is never overwritten - it is the record of
  // what the supplier asked for. Everything that spends money uses the derived
  // net price instead. A blank cell resolves to 0, so rows that predate the
  // columns keep behaving exactly as before (zero migration).
  //
  // Transport is stored on every row of the quote but must land in the totals
  // EXACTLY ONCE, otherwise a 5-line quote would be charged 5x. The carrier is
  // the first row that holds a value (see quoteFreightCarrierIndex_).
  const MAX_QUOTE_DISCOUNT_PCT = 100;
  // Largest transport amount accepted for one quote. Keeps the value well inside
  // the 15-significant-digit precision of a Sheets cell, so a figure typed here
  // round-trips through the sheet without losing cents. Mirrors the server's
  // QUOTE_MAX_FREIGHT_ (QuoteMgmtGS.js) - change both together.
  const MAX_QUOTE_FREIGHT = 999999999999.99;

  /** Coerce a raw discount cell/payload value to a percentage within [0, 100]. */
  function normalizeQuoteDiscountPct(value) {
    if (value === undefined || value === null || String(value).trim() === "") return 0;
    const n = Number(String(value).replace(/[%\s,]/g, "").replace(",", "."));
    if (!isFinite(n) || isNaN(n)) return 0;
    if (n < 0) return 0;
    return n > MAX_QUOTE_DISCOUNT_PCT ? MAX_QUOTE_DISCOUNT_PCT : n;
  }

  /** Coerce a raw transport cell/payload value to an amount >= 0. */
  function normalizeQuoteFreight(value) {
    if (value === undefined || value === null || String(value).trim() === "") return 0;
    const n = Number(String(value).replace(/[\s,]/g, "").replace(",", "."));
    if (!isFinite(n) || isNaN(n)) return 0;
    return n < 0 ? 0 : n;
  }

  /** Net unit price once the supplier discount is applied. */
  function quoteNetUnitPrice(price, discountPct) {
    const p = Number(price || 0) || 0;
    if (p <= 0) return 0;
    return Math.round(p * (1 - normalizeQuoteDiscountPct(discountPct) / 100) * 100) / 100;
  }

  /** Full money view of one quote line, used by the modal, details and export. */
  function quoteLineCommercials(item) {
    const it = item || {};
    const price = Number(it.price || 0) || 0;
    const discountPct = normalizeQuoteDiscountPct(it.discountPct);
    const freight = normalizeQuoteFreight(it.freight);
    return {
      price: price,
      discountPct: discountPct,
      freight: freight,
      netUnit: quoteNetUnitPrice(price, discountPct),
    };
  }

  /**
   * Gross (before-discount) amount of a line: quoted price x basis qty.
   * @param {object} item quote line
   * @param {number} basisQty quantity the money is based on
   */
  function quoteLineGross_(item, basisQty) {
    const it = item || {};
    const price = Number(it.price || 0) || 0;
    if (price <= 0) return 0;
    return Math.round(price * (Number(basisQty) || 0) * 100) / 100;
  }

  /**
   * Index of the row that carries the quote-level transport into the totals.
   * Rows arrive in sheet order (oldest first), so this is stable across saves
   * and the charge never migrates from one line to another.
   * @param {Array} items quote lines
   * @return {number} carrier index, or -1 when there is no transport charge
   */
  function quoteFreightCarrierIndex_(items) {
    const rows = Array.isArray(items) ? items : [];
    for (let i = 0; i < rows.length; i++) {
      if (normalizeQuoteFreight(rows[i] && rows[i].freight) > 0) return i;
    }
    return -1;
  }

  /**
   * Money summary of a whole quote card: subtotal, discount amount, transport
   * (counted ONCE) and grand total. Every view that shows a quote total should
   * use this instead of summing line totals, so the freight rule holds
   * everywhere and the numbers can never disagree with the sheet.
   * @param {Array} items quote lines
   */
  function quoteMoneySummary(items) {
    const rows = Array.isArray(items) ? items : [];
    const carrier = quoteFreightCarrierIndex_(rows);
    let subtotal = 0;   // net goods value, discount already applied
    let gross = 0;      // list value before the discount (for display only)
    let freight = 0;
    rows.forEach(function (it, i) {
      const q = quoteLineQtys(it);
      const basis = isQuoteQtyFrozenStatus(it.estado || it.status) ? q.approved : q.quoted;
      const price = Number(it.price || 0) || 0;
      const netUnit = quoteNetUnitPrice(price, it.discountPct);
      if (price > 0) {
        subtotal += Math.round(netUnit * basis * 100) / 100;
        gross += quoteLineGross_(it, basis);
      }
      if (i === carrier) freight = normalizeQuoteFreight(it.freight);
    });
    const discount = Math.round((gross - subtotal) * 100) / 100;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      gross: Math.round(gross * 100) / 100,
      discount: discount > 0 ? discount : 0,
      freight: freight,
      total: Math.round((subtotal + freight) * 100) / 100,
      hasDiscount: rows.some(function (it) { return normalizeQuoteDiscountPct(it.discountPct) > 0; }),
      hasFreight: freight > 0,
    };
  }

  /**
   * Quantity a modal row's money is based on, in the order the sheet and the
   * server agree on: RECEIVED while the receiving window is open (what actually
   * arrived), else the editable Qty, else the APPROVED qty on a frozen line,
   * else the quoted (sent) qty - the fallback for rows that predate the
   * "Cant. Aprobado" column.
   *
   * Both the line total and the modal footer sum read this, so the printed
   * Subtotal can never disagree with the sum of the printed rows.
   *
   * @param {Element} tr the <tr> of the edit-quote modal
   * @return {number} basis quantity
   */
  function quoteRowBasisQty_(tr) {
    if (!tr) return 0;
    const received = tr.querySelector(".edit-received-qty");
    const qtyInput = tr.querySelector(".edit-qty");
    const approved = tr.querySelector(".edit-approved-qty");
    const sent = tr.dataset.origSent || "";
    const origApproved = tr.dataset.origApproved || "";
    if (received && !received.disabled) {
      return received.value ? Number(received.value) || 0 : Number(sent || 0) || 0;
    }
    if (qtyInput) return Number(qtyInput.value) || 0;
    if (approved && !approved.disabled) return Number(approved.value) || 0;
    return Number(origApproved || sent) || 0;
  }

  // ---- Quote card grouping (single source of truth) ----
  // ONE card per requirement + supplier + category. The Quote ID is deliberately
  // NOT part of the key: the same supplier quote can end up with rows carrying
  // different (or blank) Quote IDs - older rows written before the ID existed, or
  // items added later through a brand new RFQ send. Keying on it split one
  // supplier quote into several "duplicate" cards, and the cache sync (which
  // matches on req + supplier + category) then silently dropped the sibling rows.
  function quoteGroupKey(item) {
    const it = item || {};
    return [
      String(it.orderId || "").trim(),
      String(it.supplier || "").trim(),
      String(it.category || "").trim().toUpperCase(),
    ].join("|");
  }

  // Representative Quote ID for a merged card: the newest non-empty value wins so
  // the card reference / edit payload points at the latest quote generated for
  // that supplier. Rows arrive in sheet order (oldest first).
  function quoteGroupQuoteId(item, current) {
    const v = String((item && item.quoteId) || "").trim();
    return v || String(current || "").trim();
  }

  // Requirement-level metadata (Req PDF link + the date the requirement was
  // raised) is joined server-side onto every quote row by getQuotesHistory: the
  // Quotes sheet only carries the QUOTE PDF and the RFQ date. Rows of one card
  // share the same Req ID, so the first non-empty value wins; PDFs are merged by
  // URL so a consolidated requirement ("A+B") keeps one link per source Req.
  function mergeQuoteReqMeta(group, item) {
    const it = item || {};
    (Array.isArray(it.reqPdfUrls) ? it.reqPdfUrls : []).forEach(function (p) {
      const url = String((p && p.url) || "").trim();
      if (!url) return;
      const exists = group.reqPdfUrls.some(function (e) { return e.url === url; });
      if (!exists) group.reqPdfUrls.push({ ref: String((p && p.ref) || "").trim(), url: url });
    });
    if (!group.reqDate && it.reqDate) group.reqDate = String(it.reqDate).trim();
    if (!group.reqDateIso && it.reqDateIso) group.reqDateIso = String(it.reqDateIso).trim();
    // 🕐 Requirement AUDIT (info "i" timeline): the NEWEST modification wins
    // across the card's rows (every row of one Req carries the same stamp, so
    // first-non-empty is the tie-break when the ISO value is unparseable), and
    // the missing "By" / count fields are backfilled rather than overwritten.
    if (it.reqLastModified || it.reqLastModifiedIso) {
      const modIso = String(it.reqLastModifiedIso || "").trim();
      const curIso = String(group.reqLastModifiedIso || "").trim();
      if (!group.reqLastModified || (modIso && (!curIso || modIso > curIso))) {
        group.reqLastModified = String(it.reqLastModified || "").trim();
        group.reqLastModifiedIso = modIso;
      }
    }
    if (!group.reqLastModifiedBy && it.reqLastModifiedBy) {
      group.reqLastModifiedBy = String(it.reqLastModifiedBy).trim();
    }
    if ((Number(it.reqModCount) || 0) > (Number(group.reqModCount) || 0)) {
      group.reqModCount = Number(it.reqModCount) || 0;
    }
  }

  // Shared builder used by loadQuoteData / filterQuotes / cache sync so all three
  // paths always produce exactly the same cards.
  function buildQuoteGroups(list) {
    const groups = {};
    (list || []).forEach((item) => {
      const key = quoteGroupKey(item);
      if (!groups[key]) {
        groups[key] = {
          orderId: item.orderId,
          quoteId: "",
          supplier: item.supplier,
          category: item.category,
          subCategory: item.subCategory || "",
          site: item.faena,
          link: item.quoteLink,
          date: item.timestamp,
          reqPdfUrls: [],
          reqDate: "",
          reqDateIso: "",
          // 🕐 Card-level audit trail (aggregated below across the card's rows):
          // earliest creation stamp + newest modification stamp + max edit count,
          // so the edit modal and the req timeline can show ONE answer per card.
          createdBy: "",
          createdByName: "",
          createdDate: "",
          createdIso: "",
          lastModifiedBy: "",
          lastModifiedByName: "",
          lastModifiedDate: "",
          lastModifiedIso: "",
          modCount: 0,
          // Requirement-level audit (filled by mergeQuoteReqMeta).
          reqLastModifiedBy: "",
          reqLastModified: "",
          reqLastModifiedIso: "",
          reqModCount: 0,
          items: [],
        };
      }
      groups[key].quoteId = quoteGroupQuoteId(item, groups[key].quoteId);
      mergeQuoteReqMeta(groups[key], item);
      // 🕐 Card audit: earliest Created (ties keep the first row seen), newest
      // Last Modified, and the highest Mod Count of the card's rows. A row with
      // no audit cells (legacy data) never blanks values another row supplied.
      const g = groups[key];
      const cIso = String(item.createdIso || "").trim();
      if ((item.createdDate || cIso) &&
          (!g.createdDate || (cIso && (!g.createdIso || cIso < g.createdIso)))) {
        g.createdDate = String(item.createdDate || "").trim();
        g.createdIso = cIso;
        g.createdBy = String(item.createdBy || "").trim();
        g.createdByName = String(item.createdByName || "").trim();
      }
      const mIso = String(item.lastModifiedIso || "").trim();
      if ((item.lastModifiedDate || mIso) &&
          (!g.lastModifiedDate || (mIso && (!g.lastModifiedIso || mIso > g.lastModifiedIso)))) {
        g.lastModifiedDate = String(item.lastModifiedDate || "").trim();
        g.lastModifiedIso = mIso;
        g.lastModifiedBy = String(item.lastModifiedBy || "").trim();
        g.lastModifiedByName = String(item.lastModifiedByName || "").trim();
      }
      if ((Number(item.modCount) || 0) > (Number(g.modCount) || 0)) {
        g.modCount = Number(item.modCount) || 0;
      }
      groups[key].items.push(item);
    });
    // `items` keeps EVERY sheet row of the card (the approval flow still has to
    // resolve each one), `displayItems` is the deduplicated view used by the card,
    // the details modal, the edit modal and the Excel export.
    return Object.values(groups).map((g) => {
      g.displayItems = buildQuoteDisplayItems(g.items);
      return g;
    });
  }

  // ---- Duplicate line collapse (display only) ----
  // Re-sending an RFQ to a supplier writes a whole new set of rows for the SAME
  // requirement lines, so one card can hold several rows per line (same GEO + P/N)
  // with different Quote IDs / statuses. The sheet keeps them all, but the UI must
  // show each line ONCE: the row that actually carries the business state wins
  // (Approved > Quoted/price > priced > Pending > Deleted) and, on a tie, the
  // newest row - rows arrive in sheet order, oldest first.
  function quoteLineGeoKey(item) {
    return String((item || {}).geo || "").trim().toUpperCase();
  }

  function quoteLineKey(item) {
    const it = item || {};
    const geo = quoteLineGeoKey(it);
    const pn = String(it.pn || it.p || "").trim().toUpperCase();
    const desc = String(it.es || it.desc || "").trim().toUpperCase();
    // GEO + P/N identify a requirement line. The description is only used when
    // both are empty, so a description edit never splits a line in two.
    return [geo, pn, geo || pn ? "" : desc].join("|");
  }

  function quoteLineRank(item) {
    const it = item || {};
    const status = normalizeQuoteItemStatus(it.estado || it.status);
    const price = Number(it.price || 0) || 0;
    if (status === "Deleted") return 0;
    // Approved-or-later outranks everything live: a row the flow already moved
    // past Approval must keep winning over a superseded Quoted/Pending re-send,
    // even after it advances to Sent/Received/... — otherwise the displayed
    // line (and the compare price cell) would flip back to a stale round.
    // APPROVED_OR_LATER_STATUSES is declared below; resolved lazily so this
    // helper stays safe to call during module init order.
    const frozen = (typeof APPROVED_OR_LATER_STATUSES !== "undefined" &&
      APPROVED_OR_LATER_STATUSES.indexOf(status) !== -1) || status === "Approved";
    const base = status === "Pending" ? 1 : (frozen ? 3 : 2);
    return base * 2 + (price > 0 ? 1 : 0);
  }

  function buildQuoteDisplayItems(items) {
    const rows = Array.isArray(items) ? items : [];
    const best = {};
    const picked = [];
    rows.forEach((it, idx) => {
      const geo = quoteLineGeoKey(it);
      const pn = String((it || {}).pn || (it || {}).p || "").trim();
      if (!geo && !pn) {
        // Rows without GEO/P/N carry no identity: never merge them, otherwise two
        // manually added lines would collapse into one and the second would be lost.
        picked.push({ item: it, idx });
        return;
      }
      const key = quoteLineKey(it);
      const prev = best[key];
      if (!prev || quoteLineRank(it) >= quoteLineRank(prev.item)) best[key] = { item: it, idx };
    });
    Object.keys(best).forEach((k) => picked.push(best[k]));
    return picked.sort((a, b) => a.idx - b.idx).map((entry) => entry.item);
  }

  // Rows a card should render. Falls back to the raw rows when the caller passes a
  // plain item array (e.g. an ad-hoc group built outside buildQuoteGroups).
  function quoteCardRows(quote) {
    if (!quote) return [];
    if (Array.isArray(quote.displayItems)) return quote.displayItems;
    return Array.isArray(quote.items) ? quote.items : [];
  }

  // ---- Email chip-field + parsing helpers (inlined; Quote Mgmt does not load
  //      CreateReqJS.html, but the shared #emailModal needs the same editable
  //      To/Cc chip fields as RFQ). Pure client-side, no side effects. ----
  // NOTE: the dot must never be double-escaped here: a doubled backslash makes the
  // pattern require a literal backslash character in the address, so EVERY real
  // address fails validation (all chips red, sending blocked).
  // Guarded with `||` because Index.html loads CreateReqJS.html first and that file
  // already defines the canonical EMAIL_RE / parser / chip helpers used app-wide.
  window.EMAIL_RE = window.EMAIL_RE || /^[^\s@<>;,]+@[^\s@<>;,]+[.][^\s@<>;,]{2,}$/;

  window.parseEmailsLoose = window.parseEmailsLoose || function (raw) {
    // Unwrap "Display Name <mail@x.com>" to mail@x.com BEFORE the whitespace split
    // below, otherwise "Juan Perez <juan@x.com>" turned into bogus "Juan"/"Perez"
    // chips (red) which then blocked the send. Bare addresses are left untouched.
    const normalized = String(raw || "").replace(/(^|[,;\n\r\t\s>"'])[^<>@]*<([^<>@\s]+@[^<>\s]+)>/g, "$1$2 ");
    return String(normalized)
      .split(/[,;\s\n\r\t]+/)
      .map(function (p) {
        let s = String(p || "").trim().replace(/^[\"'<\(\[}+]|[\]\"'>\)\]]+$/g, "");
        const m = s.match(/<([^<>@\s]+@[^<>\s]+)>/);
        if (m) s = m[1];
        return s.trim();
      })
      .filter(Boolean);
  };

  window.escapeHtml_ = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };
  window.escHtml_ = window.escapeHtml_;
  window.getChipFieldValue = window.getChipFieldValue || function (container, selector) {
    var box = container && container.querySelector ? container.querySelector(selector) : null;
    if (!box) return "";
    if (box._chipApi) return box._chipApi.getValue();
    var input = box.querySelector ? box.querySelector("input.email-chip-input") : null;
    if (input) return input.value || "";
    return box.dataset ? (box.dataset.value || "") : "";
  };

  window.createEmailChipField = window.createEmailChipField || function (container, initialValue) {
    if (!container) return null;
    container.classList.add("email-chip-field");
    container.innerHTML =
      '<div class="email-chips"></div>' +
      '<input type="text" class="email-chip-input" placeholder="Add email…" aria-label="Add email">';

    var listEl = container.querySelector(".email-chips");
    var inputEl = container.querySelector(".email-chip-input");
    var emails = [];

    var esc = function (s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };

    var render = function () {
      listEl.innerHTML = "";
      emails.forEach(function (email, idx) {
        var valid = window.EMAIL_RE.test(email);
        var chip = document.createElement("span");
        chip.className = "email-chip" + (valid ? "" : " email-chip-invalid");
        chip.title = valid ? email : (email + " — invalid email (double-click to fix)");
        chip.draggable = true;
        var label = document.createElement("span");
        label.className = "email-chip-label";
        label.textContent = email;
        var x = document.createElement("button");
        x.type = "button";
        x.className = "email-chip-x";
        x.setAttribute("aria-label", "Remove " + email);
        x.textContent = "×";
        x.onclick = function (e) {
          e.stopPropagation();
          emails.splice(idx, 1);
          render();
        };
        chip.appendChild(label);
        chip.appendChild(x);
        chip.ondblclick = function (e) {
          e.stopPropagation();
          inputEl.value = email;
          emails.splice(idx, 1);
          render();
          inputEl.focus();
        };
        chip.addEventListener("dragstart", function (e) {
          e.dataTransfer.setData("text/plain", email);
          e.dataTransfer.setData("text/email-chip-idx", String(idx));
          e.dataTransfer.effectAllowed = "move";
          chip.classList.add("email-chip-dragging");
          container._dragSourceEmail = email;
          container._dragSourceChip = chip;
          window._dragSourceFieldRef = container;
        });
        chip.addEventListener("dragend", function (e) {
          chip.classList.remove("email-chip-dragging");
          container._dragSourceEmail = null;
          container._dragSourceChip = null;
          var nodes = document.querySelectorAll(".email-chip-field.drag-over");
          for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("drag-over");
        });
        listEl.appendChild(chip);
      });
      container.dataset.value = emails.join(", ");
      var hasInvalid = false;
      for (var i = 0; i < emails.length; i++) {
        if (!window.EMAIL_RE.test(emails[i])) { hasInvalid = true; break; }
      }
      container.classList.toggle("has-invalid", hasInvalid);
    };

    var commitInput = function () {
      var parts = window.parseEmailsLoose ? window.parseEmailsLoose(inputEl.value) : [];
      if (parts.length) {
        parts.forEach(function (p) {
          var lowered = emails.map(function (e) { return e.toLowerCase(); });
          if (lowered.indexOf(p.toLowerCase()) === -1) emails.push(p);
        });
        inputEl.value = "";
        render();
      }
    };

    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";" || e.key === " ") {
        e.preventDefault();
        commitInput();
      } else if (e.key === "Backspace" && !inputEl.value && emails.length) {
        emails.pop();
        render();
      }
    });
    inputEl.addEventListener("blur", commitInput);
    inputEl.addEventListener("paste", function () { setTimeout(commitInput, 0); });
    container.addEventListener("click", function () { inputEl.focus(); });

    container.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      container.classList.add("drag-over");
    });
    container.addEventListener("dragenter", function (e) {
      e.preventDefault();
      container.classList.add("drag-over");
    });
    container.addEventListener("dragleave", function (e) {
      if (!container.contains(e.relatedTarget)) container.classList.remove("drag-over");
    });
    container.addEventListener("drop", function (e) {
      e.preventDefault();
      container.classList.remove("drag-over");
      var draggedEmail = e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData("text/plain") : "";
      if (!draggedEmail) return;
      var src = null;
      var nodes = document.querySelectorAll(".email-chip-field");
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i]._dragSourceEmail === draggedEmail) { src = nodes[i]; break; }
      }
      if (!src) src = window._dragSourceFieldRef || null;
      if (!src || src === container) return;
      var srcApi = src._chipApi;
      var tgtApi = container._chipApi;
      if (!srcApi || !tgtApi) return;
      var srcEmails = srcApi.getEmails();
      var filtered = srcEmails.filter(function (e) { return e.toLowerCase() !== draggedEmail.toLowerCase(); });
      if (filtered.length === srcEmails.length) return;
      srcApi.setValue(filtered.join(", "));
      var tgtEmails = tgtApi.getEmails();
      if (tgtEmails.map(function (e) { return e.toLowerCase(); }).indexOf(draggedEmail.toLowerCase()) === -1) {
        tgtApi.setValue((tgtEmails.concat(draggedEmail)).join(", "));
      }
    });

    var api = {
      getEmails: function () { commitInput(); return emails.slice(); },
      getValue: function () { commitInput(); return emails.join(", "); },
      setValue: function (str) {
        emails = [];
        var parts = window.parseEmailsLoose ? window.parseEmailsLoose(str) : [];
        parts.forEach(function (p) {
          if (emails.map(function (e) { return e.toLowerCase(); }).indexOf(p.toLowerCase()) === -1)
            emails.push(p);
        });
        render();
      },
    };
    api.setValue(initialValue || "");
    container._chipApi = api;
    return api;
  };

  // Lightweight email-autocomplete hook for the chip input.
  // Quote Mgmt loads its own script (not CreateReqJS.html), so we ship a small
  // ASCII-only version here: arrow nav + Enter/Tab commits the highlighted or
  // top recent suggestion. When the full CreateReq suggestion pool is present on
  // the page, the CreateReq version will override this one; otherwise this keeps
  // the To/Cc inputs usable without Graph people search.
  window.setupEmailAutocomplete = window.setupEmailAutocomplete || function (inputEl) {
    if (!inputEl) return;
    if (inputEl._emailAutocompleteSetup) return;
    inputEl._emailAutocompleteSetup = true;

    var dd = document.createElement("div");
    dd.className = "email-suggest-dropdown";
    dd.style.display = "none";
    dd.setAttribute("role", "listbox");
    dd.setAttribute("aria-label", "Email suggestions");
    var p = inputEl.parentNode;
    if (p) {
      p.style.position = p.style.position || "relative";
      p.appendChild(dd);
    } else {
      document.body.appendChild(dd);
    }

    var hi = -1, cur = [];
    var hide = function () {
      dd.style.display = "none";
      dd.innerHTML = "";
      hi = -1;
      cur = [];
    };
    var pos = function () {
      if (!dd.parentNode) return;
      dd.style.position = "absolute";
      dd.style.top = (inputEl.offsetHeight + 2) + "px";
      dd.style.left = "0";
      dd.style.width = Math.max(280, inputEl.offsetWidth) + "px";
      dd.style.display = "block";
    };
    var hl = function () {
      var items = dd.querySelectorAll(".email-suggest-item");
      items.forEach(function (el, i) {
        el.classList.toggle("highlighted", i === hi);
        el.setAttribute("aria-selected", i === hi ? "true" : "false");
      });
      if (items[hi]) items[hi].scrollIntoView({ block: "nearest" });
    };
    var render = function () {
      dd.innerHTML = "";
      if (!cur || !cur.length) {
        var no = document.createElement("div");
        no.className = "email-suggest-no-results";
        no.textContent = "No suggestions";
        dd.appendChild(no);
        pos();
        return;
      }
      hi = 0;
      cur.forEach(function (s, i) {
        var item = document.createElement("div");
        item.className = "email-suggest-item" + (i === 0 ? " highlighted" : "");
        item.setAttribute("role", "option");
        var label = document.createElement("span");
        label.className = "suggest-name";
        label.textContent = (String(s.label || s.value || "").split("<")[0] || s.value || "").trim();
        var email = document.createElement("span");
        email.className = "suggest-email";
        email.textContent = s.value;
        item.appendChild(label);
        item.appendChild(email);
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          if (s.value) inputEl.value = inputEl.value.replace(/[^@]+@[^\s,;]+$/, "") + s.value;
          hi = -1;
          hide();
          inputEl.focus();
        });
        dd.appendChild(item);
      });
      pos();
      hl();
    };

    var querySuggestions = function (q) {
      var suggestions = [];
      if (window.recentEmails && Array.isArray(window.recentEmails)) {
        var seen = {};
        for (var i = 0; i < window.recentEmails.length; i++) {
          var rec = window.recentEmails[i];
          if (!rec || !rec.email) continue;
          var email = String(rec.email).toLowerCase().trim();
          if (!email) continue;
          if (q && email.indexOf(q.toLowerCase()) === -1) continue;
          if (Object.prototype.hasOwnProperty.call(seen, email)) continue;
          seen[email] = true;
          suggestions.push({
            value: email,
            label: (rec.name || "").trim() ? String(rec.name).split("<")[0].trim() + " <" + email + ">" : email,
            source: "recent",
          });
        }
      }
      if (!suggestions.length && q) {
        var bare = q.replace(/<[^>]*>/g, "").trim();
        if (bare && /[@.]/.test(bare)) {
          suggestions.push({ value: bare, label: bare, source: "typed" });
        }
      }
      return suggestions;
    };

    var schedule = null;
    inputEl.addEventListener("input", function () {
      var q = inputEl.value.replace(/<[^>]*>/g, "").replace(/[;,\s]+$/, "").trim();
      if (schedule) clearTimeout(schedule);
      schedule = setTimeout(function () {
        if (!q) { hide(); return; }
        cur = querySuggestions(q);
        render();
      }, 80);
    });
    inputEl.addEventListener("focus", function () {
      var q = inputEl.value.replace(/<[^>]*>/g, "").replace(/[;,\s]+$/, "").trim();
      if (!q) { hide(); return; }
      cur = querySuggestions(q);
      render();
    });
    inputEl.addEventListener("blur", function () { setTimeout(hide, 120); });
    inputEl.addEventListener("keydown", function (e) {
      var items = dd.querySelectorAll(".email-suggest-item");
      if (items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        if (e.key === "ArrowDown") hi = Math.min(hi + 1, items.length - 1);
        else hi = Math.max(hi - 1, 0);
        hl();
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (items.length && hi >= 0) {
          e.preventDefault();
          var chosen = cur[hi];
          if (chosen && chosen.value) {
            var before = inputEl.value.replace(/[^@]+@[^\s,;]+$/, "");
            inputEl.value = before + chosen.value;
          }
          hi = -1;
          hide();
          var ev = new Event("input", { bubbles: true });
          inputEl.dispatchEvent(ev);
        }
      } else if (e.key === "Escape") {
        hide();
      }
    });
  };
  // Chip-field + autocomplete CSS (mirrors CreateReq's injectEmailChipDragCss,
  // which Quote Mgmt never runs because it does not load CreateReqJS.html).
  (function injectPoReminderChipCss() {
    if (document.getElementById("po-reminder-chip-css")) return;
    var style = document.createElement("style");
    style.id = "po-reminder-chip-css";
    style.textContent =
      ".email-chip[draggable=true]{cursor:grab;transition:opacity .15s,transform .15s}" +
      ".email-chip[draggable=true]:active{cursor:grabbing}" +
      ".email-chip.email-chip-dragging{opacity:.4;transform:scale(.95)}" +
      ".email-chip-field.drag-over{outline:2px dashed #0d6efd;outline-offset:2px;background-color:#e7f1ff;border-radius:4px}" +
      ".email-chip-field{transition:outline .15s,background-color .15s}" +
      ".email-chip{display:inline-flex;align-items:center;gap:4px;background:#e7f1ff;border:1px solid #7aa8e8;border-radius:14px;padding:2px 6px 2px 10px;font-size:12px;color:#084298}" +
      ".email-chip.email-chip-invalid{background:#fde2e2;border-color:#e57373;color:#a30000}" +
      ".email-chip-label{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".email-chip-x{background:none;border:none;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px}" +
      ".email-chip-x:hover{color:#c00}" +
      ".email-chip-input{min-width:160px;border:1px solid #ced4da;border-radius:4px;padding:2px 6px;font-size:12px}" +
      ".email-suggest-dropdown{position:absolute;z-index:1050;max-height:260px;overflow-y:auto;border:1px solid #dee2e6;border-radius:6px;box-shadow:0 .5rem 1rem rgba(0,0,0,.15);background:#fff;min-width:280px}" +
      ".email-suggest-item{padding:6px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background-color .1s}" +
      ".email-suggest-item:last-child{border-bottom:none}" +
      ".email-suggest-item:hover,.email-suggest-item.highlighted{background-color:#0d6efd;color:#fff}" +
      ".email-suggest-item .suggest-name{font-weight:600}" +
      ".email-suggest-item .suggest-email{font-size:12px;color:#6c757d;margin-left:8px}" +
      ".email-suggest-item .suggest-source{display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:8px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}" +
      ".email-suggest-item .suggest-source.source-recent{background-color:#d1e7dd;color:#0f5132}" +
      ".email-suggest-item .suggest-source.source-typed{background-color:#e7f1ff;color:#084298}" +
      ".email-suggest-item:hover .suggest-email,.email-suggest-item.highlighted .suggest-email{color:#cfe5ff}" +
      ".email-suggest-item:hover .suggest-source,.email-suggest-item.highlighted .suggest-source{color:#fff}" +
      "#email-suggest-no-results{padding:10px 12px;color:#6c757d;font-size:13px;text-align:center}" +
      "#quoteEditDocDropzone{transition:background-color .15s,box-shadow .15s,transform .15s}" +
      "#quoteEditDocDropzone:hover,#quoteEditDocDropzone:focus{background-color:#f1fcf5;outline:none}" +
      "#quoteEditDocDropzone.quote-doc-drop-active{background-color:#d1e7dd;box-shadow:0 0 0 3px rgba(25,135,84,.18);transform:scale(1.01)}";
    document.head.appendChild(style);
  })();

  function isInternalReceivingSite(site) {
    const s = String(site || "").trim().toLowerCase();
    return s === "store" || s === "workshop";
  }

  // Requester's per-item notes joined from Ordenes (unique per requirement +
  // GEO). Rendered read-only, labelled with the Req ID when consolidated.
  // `req_typed_notes` is "Req {ref}: {notes}" — the note text is appended as
  // sanitized HTML, so only the "{ref}" half is substituted here.
  function quoteReqNotesHtml(it) {
    const list = Array.isArray(it && it.reqItemNotes) ? it.reqItemNotes : [];
    const parts = list.filter(function(n) { return n && String(n.notes || '').trim(); });
    if (!parts.length) return '<span class="text-muted">&mdash;</span>';
    return parts.map(function(n) {
      const prefix = String(i18n('req_typed_notes', 'Req {ref}: {notes}'))
        .replace('{notes}', '')
        .replace('{ref}', String(n.ref || ''));
      const body = (typeof window.notesToHtml === 'function')
        ? window.notesToHtml(n.notes || '')
        : attr_(n.notes || '');
      return '<div class="small text-warning-emphasis" style="font-size:0.7rem;">' +
        '<i class="bi bi-sticky me-1"></i><span class="fw-semibold">' +
        attr_(prefix) + '</span>' + body + '</div>';
    }).join('');
  }

  // Supplier notes for the same line, joined from the Ordenes "Supplier Notes"
  // column (unique per requirement + GEO) and delivered as `reqSupplierNotes`.
  // Deliberately READ-ONLY: this is the note that went out to the supplier with
  // the RFQ, so Quote Mgmt shows it as context next to Item Notes and never
  // rewrites it. Rendering mirrors quoteReqNotesHtml so both columns look alike;
  // the only differences are the source array and the glyph/tone.
  function quoteReqSupplierNotesHtml(it) {
    const list = Array.isArray(it && it.reqSupplierNotes) ? it.reqSupplierNotes : [];
    const parts = list.filter(function(n) { return n && String(n.notes || '').trim(); });
    if (!parts.length) return '<span class="text-muted">&mdash;</span>';
    return parts.map(function(n) {
      const prefix = String(i18n('req_typed_notes', 'Req {ref}: {notes}'))
        .replace('{notes}', '')
        .replace('{ref}', String(n.ref || ''));
      const body = (typeof window.notesToHtml === 'function')
        ? window.notesToHtml(n.notes || '')
        : attr_(n.notes || '');
      return '<div class="small text-info-emphasis" style="font-size:0.7rem;">' +
        '<i class="bi bi-chat-left-text me-1"></i><span class="fw-semibold">' +
        attr_(prefix) + '</span>' + body + '</div>';
    }).join('');
  }

  // Requester's per-item photos, joined from the Ordenes "Item Images" column
  // (unique per requirement + GEO) and delivered as `reqImages` ([{ref, images}]
  // where images is the raw comma-separated Drive-URL cell).
  // Deliberately READ-ONLY, like the notes above: the quote screens render the
  // requester's attachments for context and never rewrite them. Drive
  // file.getUrl() serves an HTML "view" page (never image bytes), so <img>
  // uses the thumbnail endpoint — the same endpoint the server-side
  // requirement email uses (buildHtmlTable). Self-contained helpers, guarded
  // with `||` so the canonical CreateReqJS versions win when that module is
  // loaded on the same page.
  window.reqDriveFileId_ = window.reqDriveFileId_ || function (url) {
    const u = String(url || '').trim();
    if (!u) return '';
    let m = u.match(/\/file\/d\/([-\w]{10,})/i);
    if (m && m[1]) return m[1];
    m = u.match(/[?&](?:id|ids)=([-\w]{10,})/i);
    return (m && m[1]) ? m[1] : '';
  };
  window.reqDriveThumbUrl_ = window.reqDriveThumbUrl_ || function (url) {
    const id = window.reqDriveFileId_(url);
    return id ? ('https://drive.google.com/thumbnail?id=' + id + '&sz=w200') : String(url || '');
  };
  window.reqDriveImgOnerror_ = window.reqDriveImgOnerror_ || function (url) {
    const id = window.reqDriveFileId_(url);
    if (!id) return '';
    const alt = 'https://drive.google.com/uc?export=view&id=' + id;
    return " onerror=\"if(this.dataset.fb){this.style.visibility='hidden';}else{this.dataset.fb='1';this.src='" + alt + "';}\"";
  };
  function quoteReqImagesUrls_(it) {
    const list = Array.isArray(it && it.reqImages) ? it.reqImages : [];
    const out = [], seen = {};
    list.forEach(function (n) {
      if (!n || !n.images) return;
      String(n.images).split(/\s*,\s*/).forEach(function (u) {
        const url = String(u || '').trim();
        if (!/^https?:\/\//i.test(url) || seen[url]) return;
        seen[url] = true;
        out.push({ ref: String(n.ref || ''), url: url });
      });
    });
    return out;
  }
  window.quoteReqImagesUrls_ = window.quoteReqImagesUrls_ || quoteReqImagesUrls_;
  // Read-only thumbnail strip, thumbs linking to the full Drive files, each
  // labelled with its source Req ID when the row quotes several requirements.
  window.quoteReqImagesHtml = window.quoteReqImagesHtml || function (it, px) {
    const pics = quoteReqImagesUrls_(it);
    if (!pics.length) return '<span class="text-muted">&mdash;</span>';
    const size = Number(px) || 34;
    const thumbs = pics.map(function (p, i) {
      const src = attr_(window.reqDriveThumbUrl_(p.url));
      const href = attr_(p.url);
      const err = window.reqDriveImgOnerror_(p.url);
      const tip = attr_((p.ref ? 'Req ' + p.ref + ' · ' : '') + 'Photo ' + (i + 1) + ' — click to open');
      return '<a href="' + href + '" target="_blank" rel="noopener" title="' + tip + '" ' +
        'style="display:inline-block;width:' + size + 'px;height:' + size +
        'px;border:1px solid #dee2e6;border-radius:4px;overflow:hidden;margin:1px;vertical-align:middle;background:#fff;">' +
        '<img src="' + src + '" alt="Photo ' + (i + 1) + '" loading="lazy"' + err +
        ' style="width:100%;height:100%;object-fit:cover;display:block;"></a>';
    }).join('');
    return '<span style="white-space:nowrap;display:inline-block;" title="' + pics.length +
      ' photo(s) — click to open">' + thumbs + '</span>';
  };

  function quoteStatusLabel(status) {
    const s = normalizeQuoteItemStatus(status);
    const keyMap = {
      Pending: "status_pending",
      "Not Quoted": "status_not_quoted",
      Quoted: "status_quoted",
      Approved: "status_approved",
      Sent: "status_sent",
      Received: "status_received",
      Despatched: "status_despatched",
      "Final Received": "status_final_received",
      Deleted: "status_deleted",
    };
    const key = keyMap[s];
    return key ? i18n(key) : s;
  }

  function quoteStatusOptionsHtml(selectedStatus = "", currentItemStatus = "", price = null) {
    const current = normalizeQuoteItemStatus(selectedStatus);
    const normalizedCurrentItem = normalizeQuoteItemStatus(currentItemStatus || selectedStatus);
    
    // Get editor role for "Approved" restriction
    let userJson = localStorage.getItem("recon_user_secure");
    let user = null;
    if (userJson && userJson !== "") {
      try {
        user = JSON.parse(userJson);
      } catch (e) {
        console.warn("Failed to parse user from localStorage:", e);
      }
    }
    const editorRole = String((user && user.role) || "").trim().toUpperCase();
    const isManager = editorRole === "MANAGER" || editorRole === "ADMIN";
    
    return QUOTE_ITEM_STATUSES.map(
      (status) => {
        let isDisabled = !isStatusTransitionAllowed(normalizedCurrentItem, status, isManager);
        // A quote with a price of 0 is not a valid quote — block "Quoted".
        const priceBlocksQuoted = (price !== null && Number(price) <= 0);
        if (!isDisabled && status === "Quoted" && priceBlocksQuoted) isDisabled = true;
        const selected = current === status ? "selected" : "";
        const disabledAttr = isDisabled ? "disabled" : "";
        const titleAttr = isDisabled
          ? ` title="${i18n('msg_transition_not_allowed')}: ${quoteStatusLabel(normalizedCurrentItem)} → ${quoteStatusLabel(status)}${(status === "Quoted" && priceBlocksQuoted) ? " — " + i18n('msg_price_zero_cannot_quote', 'Items with a price of 0 cannot be marked as Quoted.') : ""}"`
          : "";
        return `<option value="${status}" ${selected} ${disabledAttr}${titleAttr}>${quoteStatusLabel(status)}</option>`;
      }
    ).join("");
  }
  
  function isStatusTransitionAllowed(oldStatus, newStatus, isManager) {
    const cleanNew = String(newStatus || "").trim();
    const cleanOld = String(oldStatus || "").trim();
    
    // Always allow staying on same status
    if (cleanNew === cleanOld) return true;
    
    // Allow transition to Deleted from any valid status
    if (cleanNew === "Deleted") return true;
    
    // Prevent moving out of Deleted
    if (cleanOld === "Deleted") return false;

    // ---- "Not Quoted" side-branch (see QUOTE_ITEM_STATUSES comment) ----
    // Mark: the supplier never quoted this line, so it is resolved as
    // "ignorable" instead of lingering as Pending. Anyone who may edit the
    // quote may mark it (no manager gate: the approver only *reads* this).
    if (cleanNew === "Not Quoted") return cleanOld === "Pending";
    // Undo a wrongly-marked line, or pick the line back up when the supplier
    // quotes late (then the normal Quoted rules, incl. the price > 0 gate,
    // apply on the next step).
    if (cleanOld === "Not Quoted") return cleanNew === "Pending" || cleanNew === "Quoted";
    
    // Strict sequential flow: can only advance exactly one step
    const flow = ["Pending", "Quoted", "Approved", "Sent", "Received", "Despatched", "Final Received"];
    const oldIdx = flow.indexOf(cleanOld);
    const newIdx = flow.indexOf(cleanNew);
    
    if (oldIdx === -1 || newIdx === -1) return false;
    
    // Enforce strict forward progression (no skipping steps)
    if (newIdx !== oldIdx + 1) return false;
    
    // Only MANAGER or ADMIN can set Approved
    if (cleanNew === "Approved" && !isManager) return false;
    
    return true;
  }

  // Re-evaluate one edit-modal row's "Quoted" option against its CURRENT price
  // input.
  //
  // quoteStatusOptionsHtml freezes the price gate at modal open: it renders the
  // option `disabled` from the STORED price, and nothing re-checked it afterwards
  // (the price listeners only recompute the money). So a line whose price was 0
  // stayed locked even after the user typed a price in the same session —
  // Pending -> Quoted looked broken. This re-applies the exact same rule (price
  // must be > 0 to be Quoted, see priceBlocksQuoted in quoteStatusOptionsHtml)
  // live on every price/status change, so entering a price unlocks the option
  // immediately.
  //
  // A row that is ALREADY on "Quoted" is never locked by this helper: disabling
  // the currently-selected option would leave the user a stuck dropdown, and the
  // save-time guard (zeroPriceQuoted in saveEditedQuote) still refuses to persist
  // a Quoted line whose price is 0 — with a proper warning.
  //
  // @param {Element} tr the <tr> of the edit-quote modal
  function refreshQuotedOptionState_(tr) {
    if (!tr || !tr.querySelector) return;
    const sel = tr.querySelector(".edit-status");
    if (!sel) return;
    const opt = sel.querySelector('option[value="Quoted"]');
    if (!opt) return;
    if (normalizeQuoteItemStatus(sel.value) === "Quoted") {
      opt.disabled = false;
      opt.title = "";
      return;
    }
    const priceInput = tr.querySelector(".edit-price");
    // No price cell on this row -> leave the rendered state untouched.
    if (!priceInput) return;
    // Same expression as the renderer, so a non-numeric value keeps today's
    // "not blocked" (NaN <= 0 is false) semantics.
    const price = Number(priceInput.value);
    const blocked = price <= 0;
    opt.disabled = blocked;
    opt.title = blocked
      ? `${i18n("msg_transition_not_allowed")}: ${quoteStatusLabel(sel.value)} → ${quoteStatusLabel("Quoted")} — ${i18n("msg_price_zero_cannot_quote", "Items with a price of 0 cannot be marked as Quoted.")}`
      : "";
  }

  function quoteStatusIconClass(status) {
    switch (normalizeQuoteItemStatus(status)) {
      case "Pending":
        return "bi-dot text-muted";
      case "Not Quoted":
        return "bi-slash-circle text-secondary";
      case "Quoted":
        return "bi-chat-left-quote-fill text-primary";
      case "Approved":
        return "bi-check-circle-fill text-success";
      case "Sent":
        return "bi-send-fill text-info";
      case "Received":
        return "bi-inbox-fill text-success";
      case "Despatched":
        return "bi-truck text-warning";
      case "Final Received":
        return "bi-check2-circle text-success";
      case "Deleted":
        return "bi-trash-fill text-danger";
      default:
        return "bi-question-circle text-secondary";
    }
  }


function buildInternalDualTableEmailHtml(quotedItems, bodegaItems, quoteId) {
  let html = `<p>Quote processing update for Document ID: <strong>${quoteId}</strong></p>`;
  
  // Table 1: Products Sent to Supplier
  html += `<h3 style="color:#333;">${i18n('tbl_quoted_to_supplier')}</h3>`;
  html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-family:sans-serif; font-size:12px;">`;
  html += `<tr style="background-color:#f2f2f2;"><th>Geo</th><th>Description</th><th>Qty Quoted</th><th>Supplier</th></tr>`;
  
  if (quotedItems && quotedItems.length > 0) {
    quotedItems.forEach(i => {
      html += `<tr><td>${i.geo}</td><td>${i.desc || i.es || ''}</td><td>${i.qty}</td><td>${i.supplier || ''}</td></tr>`;
    });
  } else {
    html += `<tr><td colspan="4">${i18n('msg_no_items_sent_to_suppliers')}</td></tr>`;
  }
  html += `</table>`;

  // Table 2: Internal Warehouse Fulfillments
  html += `<h3 style="margin-top:20px; color:#333;">${i18n('tbl_internal_fulfillment')}</h3>`;
  html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; font-family:sans-serif; font-size:12px;">`;
  html += `<tr style="background-color:#e6f2ff;"><th>Geo</th><th>Description</th><th>Qty Allocated</th></tr>`;

  if (bodegaItems && bodegaItems.length > 0) {
    bodegaItems.forEach(bi => {
      html += `<tr><td>${bi.geo}</td><td>${bi.desc || bi.es || ''}</td><td>${bi.qty}</td></tr>`;
    });
  } else {
    html += `<tr><td colspan="3">${i18n('msg_no_items_internal_stock')}</td></tr>`;
  }
  html += `</table>`;

  return html;
}

  function buildQuoteStatusSummary(items) {
    const rows = Array.isArray(items) ? items : [];
    const counts = rows.reduce(
      (acc, item) => {
        const status = normalizeQuoteItemStatus(item.estado || item.status);
        acc[status] = (acc[status] || 0) + 1;
        if (status !== "Deleted") acc.active += 1;
        else acc.deleted += 1;
        return acc;
      },
      { active: 0, deleted: 0 },
    );

    const activeStatuses = QUOTE_ITEM_STATUSES.filter((status) => status !== "Deleted")
      .map((status) => `${quoteStatusLabel(status)}: ${counts[status] || 0}`)
      .filter((entry) => !entry.endsWith(": 0"));

    const summaryBits = [];
    summaryBits.push(i18n('quote_status_active').replace('{count}', counts.active));
    if (counts.deleted) summaryBits.push(i18n('quote_status_deleted').replace('{count}', counts.deleted));
    if (activeStatuses.length) summaryBits.push(activeStatuses.join(" · "));
    return summaryBits.join(" | ");
  }

  window.attemptQuoteDropdownPopulation = function (retries = 20) {
    const domReady =
      document.getElementById("filterQuoteSite") ||
      document.getElementById("filterQuoteSupplier");
    if (window.CachedDataVal && window.cachedSites && domReady) {
      window.populateAllQuoteDropdowns();
      window.loadQuoteData();
    } else if (retries > 0) {
      setTimeout(() => window.attemptQuoteDropdownPopulation(retries - 1), 300);
    } else {
      console.warn("Quote dropdowns not populated: cache or DOM not ready.");
    }
  };

  window.populateAllQuoteDropdowns = function () {
    const val = window.CachedDataVal;
    if (!val) return;

    const fillOptions = (ids, list, placeholder, isObject = false) => {
      const safeList = list || [];
      let uniqueList = isObject
        ? [
            ...new Map(
              safeList
                .filter((item) => item && item.name)
                .map((item) => [item.name, item]),
            ).values(),
          ]
        : [...new Set(safeList.filter((item) => item))];
      const html =
        `<option value="">${placeholder}</option>` +
        uniqueList
          .map(
            (item) =>
              `<option value="${isObject ? item.name : item}">${isObject ? item.name : item}</option>`,
          )
          .join("");
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
      });
    };

    fillOptions(["filterQuoteSite"], window.cachedSites, i18n('all_sites'), true);
    fillOptions(["filterQuoteSupplier"], val.suppliers, i18n('all_suppliers'), true);
    fillOptions(["filterQuoteCat"], val.categories, i18n('all_categories'), true);

    // Category "primary" behavior: auto-select the user's assigned category as the
    // DEFAULT filter, but keep it changeable for every role EXCEPT "User".
    // Only the "User" role is locked to their assigned category (data + dropdown).
    let isUserCatLocked = false;
    try {
      const u = JSON.parse(localStorage.getItem("recon_user_secure") || "null");
      isUserCatLocked = u && String(u.role || "").trim().toLowerCase() === "user";
    } catch (e) {
      console.warn("Failed to parse user for quote category primary:", e);
    }
    const defaultsCat = String(window.quoteAllowedCategory || "").trim();
    const quoteCatSel = document.getElementById("filterQuoteCat");
    if (quoteCatSel && defaultsCat) {
      const found = Array.from(quoteCatSel.options || [])
        .some((o) => String(o.value || "").trim().toUpperCase() === defaultsCat.toUpperCase());
      if (found) {
        // Lock + pre-select ONLY for the "User" role. For every other role the
        // category is just informational — leave the dropdown on "All" so the
        // initial view is never wiped out by a programmatic change event
        // firing before loadQuoteData() has filled allQuotesRaw.
        if (isUserCatLocked) {
          quoteCatSel.value = defaultsCat;
          quoteCatSel.disabled = true;
          quoteCatSel.style.backgroundColor = "#e9ecef";
          quoteCatSel.title = i18n('category_locked_msg', 'Category locked for your role');
        } else {
          quoteCatSel.disabled = false;
          quoteCatSel.style.backgroundColor = "";
          quoteCatSel.title = "";
        }
      } else {
        console.warn("Primary category not found in QuoteMgmt category filter:", defaultsCat);
      }
    } else if (quoteCatSel) {
      // Make sure previously-locked quotes don't stay greyed out for allowed users.
      quoteCatSel.disabled = false;
      quoteCatSel.style.backgroundColor = "";
    }
  };

  window.loadQuoteData = function (onDone) {
    google.script.run
      .withSuccessHandler(function (data) {
        const rawQuotes = Array.isArray(data) ? data : [];
        // Only the "User" role is hard-scoped to their assigned category. For other
        // roles the category is just a primary/default (changeable), so load ALL
        // categories into allQuotesRaw and let the filter dropdown control display.
        let isUserRole = false;
        try {
          const u = JSON.parse(localStorage.getItem("recon_user_secure") || "null");
          isUserRole = u && String(u.role || "").trim().toLowerCase() === "user";
        } catch (e) { /* ignore */ }
        const lockedCategory = isUserRole ? String(window.quoteAllowedCategory || "").trim() : "";
        const scopedQuotes = lockedCategory
          ? rawQuotes.filter(
              (item) => String(item.category || "").trim().toUpperCase() === lockedCategory.toUpperCase(),
            )
          : rawQuotes;

        allQuotesRaw = scopedQuotes;

        // Ensure each item has origGeo and origPn set (for matching during edits)
        scopedQuotes.forEach((item) => {
          // 🔴 CRITICAL: map quoteId from backend
          item.quoteId = item.quoteId || item.quoteID || item["Quote ID"] || "";
          if (!item.origGeo) item.origGeo = item.geo || "";
          if (!item.origPn) item.origPn = item.pn || item.p || "";
        });

        // Populate subcategories from validation cache (same as Products page)
        const subCatSel = document.getElementById("filterQuoteSubCat");
        const catSel = document.getElementById("filterQuoteCat");
        const selectedCat = catSel ? catSel.value : "";
        
        if (subCatSel && window.CachedDataVal) {
          const allSubCats = (window.CachedDataVal.subCategories || []).filter(
            (s) => !selectedCat || s.parent === selectedCat
          );
          subCatSel.innerHTML =
            `<option value="">${window.t ? window.t('p_all_subcats') : 'All Sub Categories'}</option>` +
            allSubCats
              .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
              .map((s) => `<option value="${s.name}">${s.name}</option>`)
              .join("");
          subCatSel.disabled = !selectedCat;
        }

        // Re-populate subcategories when category changes
        if (catSel && !catSel._subcatBound) {
          catSel._subcatBound = true;
          catSel.addEventListener("change", function () {
            const selCat = this.value;
            const subSel = document.getElementById("filterQuoteSubCat");
            if (subSel && window.CachedDataVal) {
              const filtered = (window.CachedDataVal.subCategories || []).filter(
                (s) => !selCat || s.parent === selCat
              );
              subSel.innerHTML =
                `<option value="">${window.t ? window.t('p_all_subcats') : 'All Sub Categories'}</option>` +
                filtered
                  .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                  .map((s) => `<option value="${s.name}">${s.name}</option>`)
                  .join("");
              subSel.disabled = !selCat;
            }
          });
        }

        // ONE card per requirement + supplier + category (quoteGroupKey): grouping
        // on the Quote ID used to split a single supplier quote into several
        // "duplicate" cards whenever its rows carried different/blank IDs.
        groupedQuotes = buildQuoteGroups(scopedQuotes);
        // Honor the user's current filters (they survive in the DOM) so a
        // reload after delete/approve/resync doesn't silently show everything.
        renderQuoteView_(groupedQuotes);
        const quoteLoaderEl = document.getElementById("quoteLoader");
        if (quoteLoaderEl) quoteLoaderEl.classList.add("d-none");
        const quoteContainerEl = document.getElementById("quoteContainer");
        if (quoteContainerEl) quoteContainerEl.classList.remove("d-none");
        if (typeof onDone === "function") { try { onDone(); } catch (e) { console.warn("loadQuoteData onDone failed:", e); } }
      })
      .withFailureHandler(function (err) {
        console.error("loadQuoteData failed:", err);
        allQuotesRaw = [];
        groupedQuotes = [];
        renderQuoteCards([]);
        const quoteLoaderEl = document.getElementById("quoteLoader");
        if (quoteLoaderEl) quoteLoaderEl.classList.add("d-none");
        const quoteContainerEl = document.getElementById("quoteContainer");
        if (quoteContainerEl) quoteContainerEl.classList.remove("d-none");
        if (typeof onDone === "function") { try { onDone(); } catch (e) { console.warn("loadQuoteData onDone failed:", e); } }
      })
      .getHistoryData();
  };

  // IDs of every control that filterQuotes() reads. Keep in sync with it.
  const QUOTE_FILTER_IDS_ = [
    "filterQuoteSite",
    "filterQuoteSupplier",
    "filterQuoteSubCat",
    "filterQuoteCat",
    "filterQuoteStatus",
    "quoteSearchInput",
  ];

  // True when the user has any quote filter or search text set.
  function hasActiveQuoteFilters_() {
    return QUOTE_FILTER_IDS_.some((id) => {
      const el = typeof document !== "undefined" ? document.getElementById(id) : null;
      return !!el && String(el.value || "").trim() !== "";
    });
  }

  // Re-render honoring the user's current filters: filterQuotes() when a filter
  // is active, otherwise the plain grouped render. The guard is deliberate:
  // filterQuotes' empty Status scope means "active only" (hides Deleted), while
  // first load intentionally shows everything — so with no filter set the
  // historic behaviour is preserved exactly. Use this for every re-render after
  // a data change (save / reload / delete / approve / resync) instead of
  // calling renderQuoteCards() directly.
  function renderQuoteView_(groups) {
    if (hasActiveQuoteFilters_() && typeof window.filterQuotes === "function") {
      window.filterQuotes();
    } else {
      renderQuoteCards(groups);
    }
  }

  window.filterQuotes = function () {
    const raw = Array.isArray(allQuotesRaw) ? allQuotesRaw : [];
    const siteSel = document.getElementById("filterQuoteSite")?.value || "";
    const supplierSel =
      document.getElementById("filterQuoteSupplier")?.value || "";
    const subCatSel = document.getElementById("filterQuoteSubCat")?.value || "";
    const catSel = document.getElementById("filterQuoteCat")?.value || "";
    const statusSel = document.getElementById("filterQuoteStatus")?.value || "";
    const searchTerm =
      document.getElementById("quoteSearchInput")?.value.trim().toLowerCase() ||
      "";
    
    // Get user for site lock check
    let userJson = localStorage.getItem("recon_user_secure");
    let isUserRole = false;
    let userSite = "";
    if (userJson && userJson !== "") {
      try {
        const user = JSON.parse(userJson);
        isUserRole = user && user.role?.toLowerCase() === 'user';
        userSite = user?.site || "";
      } catch (e) {
        console.warn("Failed to parse user from localStorage:", e);
      }
    }

    const lockedCategory = String(window.quoteAllowedCategory || "").trim();
    // Only the "User" role is hard-locked to their assigned category. Every other role
    // (incl. those with a "primary" category) can still change the dropdown, so honor
    // their selection via catSel.
    const effectiveCatSel = (isUserRole && lockedCategory) ? lockedCategory : catSel;

    const filtered = raw.filter((item) => {
      // 🔒 SITE LOCK for USER role
      let siteMatch = true;
      if (isUserRole && userSite) {
        // USER only sees quotes for their assigned site
        siteMatch = item.faena === userSite;
      } else if (!siteSel || siteSel === "All Sites") {
        siteMatch = true;
      } else {
        siteMatch = !item.faena || item.faena === siteSel;
      }

      const supplierMatch = !supplierSel || String(item.supplier || "").trim() === String(supplierSel).trim();
      const subCatMatch = !subCatSel || String(item.subCategory || "").trim() === String(subCatSel).trim();
      const catMatch = !effectiveCatSel || String(item.category || "").trim().toUpperCase() === String(effectiveCatSel).trim().toUpperCase();
      const statusVal = String(item.estado || item.status || "").trim();
      // __ALL__ = show everything including Deleted; "" = active only; else exact status.
      const statusMatch = statusSel === "__ALL__"
        ? true
        : !statusSel
          ? statusVal.toLowerCase() !== "deleted"
          : statusVal.toLowerCase() === statusSel.toLowerCase();
      // Search across req no, quote no, supplier quote no, supplier, site,
      // category, geo, P/N, descriptions, status and notes. Multiple words are
      // AND-ed, so "REQ-12 acme" only matches rows containing both.
      const searchMatch = (() => {
        if (!searchTerm) return true;
        const tokens = searchTerm.split(/\s+/).filter(Boolean);
        const noteTexts = [];
        (Array.isArray(item.reqItemNotes) ? item.reqItemNotes : []).forEach((n) => {
          if (n && String(n.notes || "").trim()) noteTexts.push(n.notes);
        });
        (Array.isArray(item.reqSupplierNotes) ? item.reqSupplierNotes : []).forEach((n) => {
          if (n && String(n.notes || "").trim()) noteTexts.push(n.notes);
        });
        const haystack = [
          item.orderId, item.quoteId, item.supplier, item.supplierQuoteNo,
          item.refCotiz, item.faena, item.category, item.subCategory,
          item.geo, item.pn, item.p, item.desc, item.es, item.en,
          item.estado, item.status, quoteStatusLabel(item.estado || item.status),
          item.currency, item.quoteLink, item.quotedDocUrl,
          noteTexts.join(" "),
        ]
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
          .join(" ")
          .toLowerCase();
        return tokens.every((t) => haystack.includes(t));
      })();
      return (
        siteMatch &&
        supplierMatch &&
        subCatMatch &&
        catMatch &&
        searchMatch &&
        statusMatch
      );
    });

    const filteredQuotes = buildQuoteGroups(filtered);
    renderQuoteCards(filteredQuotes);
  };

  // ---- Segmented status bar (one equal slice per item, merged blocks by colour) ----
  function renderQuoteStatusBar(items) {
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) return "";

    const flow = ["Pending", "Not Quoted", "Quoted", "Approved", "Sent", "Received", "Despatched", "Final Received"];
    const counts = {};
    rows.forEach((it) => {
      const s = normalizeQuoteItemStatus(it.estado || it.status);
      if (flow.includes(s)) {
        counts[s] = (counts[s] || 0) + 1;
      }
    });

    const total = rows.length;
    const activeCount = flow.reduce((sum, s) => sum + (counts[s] || 0), 0);
    if (activeCount === 0) return "";

    const segments = [];
    flow.forEach((s) => {
      const cnt = counts[s] || 0;
      if (cnt === 0) return;
      const widthPct = (cnt / total) * 100;
      const c = QUOTE_STATUS_COLORS[s] || QUOTE_STATUS_COLORS["Pending"];
      segments.push(
        `<span class="qsb-segment" style="flex:${widthPct} 1 0;min-width:2px;height:100%;background:${c.badgeBg};border-color:${c.badgeBorder};" title="${quoteStatusLabel(s)}: ${cnt} / ${total}"></span>`
      );
    });

    if (segments.length === 0) return "";

    return `
      <div class="quote-status-bar mt-2" title="${activeCount} item${activeCount !== 1 ? 's' : ''} · ${segments.length} status${segments.length !== 1 ? 'es' : ''}">
        <div class="quote-status-bar-track d-flex align-items-stretch" style="height:10px;border-radius:5px;overflow:hidden;border:1px solid rgba(0,0,0,.08);background:#f8f9fa;">
          ${segments.join("")}
        </div>
        <div class="quote-status-bar-legend small text-muted mt-1 d-flex flex-wrap gap-1">
          ${flow.filter(s => counts[s]).map(s => {
            const c = QUOTE_STATUS_COLORS[s] || QUOTE_STATUS_COLORS["Pending"];
            return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c.badgeBg};border:1px solid ${c.badgeBorder};"></span>${quoteStatusLabel(s)}: ${counts[s]}</span>`;
          }).join("")}
        </div>
      </div>`;
  }



  // Fallback Req-date formatter (dd-MM-yyyy) for when the server sent only the
  // ISO value. UTC parts are used so the day never shifts with the viewer's
  // timezone — the server already formats the value in the sheet's own zone.
  function quoteReqDateFromIso(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(d.getUTCDate()) + "-" + pad(d.getUTCMonth() + 1) + "-" + d.getUTCFullYear();
  }

  // Req section header chips: the requirement PDF (stored on Ordenes, joined
  // server-side onto every quote row) + the date the requirement was raised.
  // A consolidated section header ("A+B") gets one PDF icon per source Req ID so
  // each source requirement's own document stays reachable.
  function quoteReqMetaHtml(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const pdfs = [];
    let dateStr = "";
    let dateIso = "";

    list.forEach(function (g) {
      if (!g) return;
      (Array.isArray(g.reqPdfUrls) ? g.reqPdfUrls : []).forEach(function (p) {
        const url = String((p && p.url) || "").trim();
        if (!url) return;
        if (pdfs.some(function (e) { return e.url === url; })) return;
        pdfs.push({ ref: String((p && p.ref) || "").trim(), url: url });
      });
      const iso = String(g.reqDateIso || "").trim();
      const raw = String(g.reqDate || "").trim();
      // ISO strings compare correctly as text, so the earliest Req date wins.
      if (iso && (!dateIso || iso < dateIso)) { dateIso = iso; dateStr = raw; }
      else if (!dateStr && !iso && raw) { dateStr = raw; }
    });

    const pdfHtml = pdfs.map(function (p) {
      const tip = i18n('btn_open_req_pdf', 'Open requirement PDF') + (p.ref ? " — " + p.ref : "");
      return `<a href="${attr_(p.url)}" target="_blank" class="text-danger" title="${attr_(tip)}" onclick="event.stopPropagation()"><i class="bi bi-file-pdf-fill" style="font-size:1.05rem;"></i></a>`;
    }).join("");

    const shownDate = dateStr || (dateIso ? quoteReqDateFromIso(dateIso) : "");
    const dateHtml = shownDate
      ? `<span class="badge bg-light text-dark border" title="${attr_(i18n('lbl_req_date', 'Req date'))}"><i class="bi bi-calendar3 me-1"></i>${attr_(shownDate)}</span>`
      : "";

    // 🕐 INFO ("i") ICON: opens the full date timeline of this requirement -
    // requirement created + last modified, then EVERY quote of it with its own
    // creation date and last modified by/date (window.openReqTimeline). Kept
    // outside the role gate on purpose: it is read-only history for everyone.
    const reqOid = String((list[0] && list[0].orderId) || "").trim();
    const infoHtml = reqOid
      ? `<a href="javascript:void(0)" class="text-primary ms-1" title="${attr_(i18n('btn_req_timeline', 'Requirement dates & quotes timeline'))}" onclick="event.stopPropagation(); window.openReqTimeline('${attr_(reqOid)}')"><i class="bi bi-info-circle-fill" style="font-size:1.05rem;cursor:pointer;"></i></a>`
      : "";

    return pdfHtml + dateHtml + infoHtml;
  }



  /**
   * 🕐 Full date timeline of ONE requirement (info "i" icon in the Req header).
   *
   * Shows the requirement's own dates first (created, then last modified by /
   * date + edit count) followed by ONE row per quote of that requirement with
   * its creation date and its last modified by/date - the values the Quotes
   * sheet audit columns ("Created By/Date", "Last Modified By/Date") and the
   * Ordenes audit columns carry, joined server-side by getQuotesHistory /
   * getRequirementsHistory and aggregated per card by buildQuoteGroups. Reading
   * the card list already on screen means no extra server round-trip, and the
   * timeline can never disagree with the cards below it.
   *
   * @param {string} orderId requirement ref (may be a consolidated "A+B")
   */
  window.openReqTimeline = function (orderId) {
    const oid = String(orderId || "").trim();
    if (!oid) return;

    const dash = (v) => {
      const s = String(v == null ? "" : v).trim();
      return s ? escHtml_(s) : "&mdash;";
    };

    // Render helper shared by the server-enriched path and the cache fallback.
    const renderTimeline = (t) => {
      const data = t || {};
      const reqCreated = String(data.reqCreated || "").trim();
      const reqMod = String(data.reqLastModified || reqCreated).trim();
      const reqModBy = String(data.reqLastModifiedBy || "").trim();
      const reqModCount = Number(data.reqModCount) || 0;
      const reqApprBy = String(data.reqApprovedBy || "").trim();
      const reqApprOn = String(data.reqApprovedDate || "").trim();
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      const reqBlock =
        `<div class="rounded border p-2 mb-2" style="background:#f8f9fa;">` +
        `<div class="fw-bold text-primary"><i class="bi bi-folder2-open me-1"></i>${i18n("lbl_req", "Req")}: ${escHtml_(oid)}</div>` +
        `<div class="small mt-1"><i class="bi bi-plus-circle me-1"></i>${i18n("lbl_req_created", "Req created")}: <strong>${dash(reqCreated)}</strong></div>` +
        `<div class="small"><i class="bi bi-patch-check me-1"></i>${i18n("lbl_req_approved_by", "Req approved by")}: ` +
        `<strong>${dash(reqApprBy)}</strong> · <strong>${dash(reqApprOn)}</strong></div>` +
        `<div class="small"><i class="bi bi-pencil-square me-1"></i>${i18n("lbl_req_last_modified", "Req last modified")}: ` +
        `<strong>${dash(reqModBy)}</strong> · <strong>${dash(reqMod)}</strong>` +
        (reqModCount > 0 ? ` (${i18n("lbl_edits", "edits")}: ${reqModCount})` : "") +
        `</div></div>`;
      const head =
        `<tr class="table-light"><th>${i18n("lbl_supplier", "Supplier")}</th>` +
        `<th>${i18n("lbl_quote", "Quote")} ID</th>` +
        `<th>${i18n("lbl_created", "Created")}</th>` +
        `<th>${i18n("lbl_created_by", "Created by")}</th>` +
        `<th>${i18n("lbl_quotation_uploaded", "Quotation uploaded")}</th>` +
        `<th>${i18n("lbl_uploaded_by", "Uploaded by")}</th>` +
        `<th>${i18n("lbl_approved_by", "Approved by")}</th>` +
        `<th>${i18n("lbl_approved_on", "Approved on")}</th>` +
        `<th>${i18n("lbl_last_modified_by", "Last modified by")}</th>` +
        `<th>${i18n("lbl_last_modified", "Last modified")}</th>` +
        `<th class="text-center">${i18n("lbl_edits", "Edits")}</th></tr>`;
      const body = quotes
        .map((q) => {
          const cnt = Number(q.modCount) || 0;
          return `<tr>` +
            `<td>${dash(q.supplier)}</td>` +
            `<td>${dash(q.quoteId)}</td>` +
            `<td>${dash(q.createdDate)}</td>` +
            `<td>${dash(q.createdBy)}</td>` +
            `<td>${dash(q.uploadedDate)}</td>` +
            `<td>${dash(q.uploadedBy)}</td>` +
            `<td>${dash(q.approvedBy)}</td>` +
            `<td>${dash(q.approvedDate)}</td>` +
            `<td>${dash(q.lastModifiedBy)}</td>` +
            `<td>${dash(q.lastModifiedDate)}</td>` +
            `<td class="text-center">${cnt > 0 ? cnt : "&mdash;"}</td>` +
            `</tr>`;
        })
        .join("");
      return reqBlock +
        `<div class="fw-bold text-primary mb-1"><i class="bi bi-journal-text me-1"></i>${i18n("lbl_quotes", "Quotes")} (${quotes.length})</div>` +
        `<div class="table-responsive"><table class="table table-sm table-bordered mb-0" style="font-size:13px;">` +
        `<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    };

    const showHtml = (html) => {
      if (window.Swal) {
        Swal.fire({
          icon: "info",
          title: i18n("btn_req_timeline", "Requirement dates & quotes timeline"),
          html: html,
          width: "auto",
        confirmButtonText: i18n("btn_close", "Close"),
        confirmButtonColor: "#3085d6",
      });
    }
  };

    // Enriched path: server reader (Quotes + Ordenes + QuoteLog). Falls back to
    // the on-screen card cache when the call fails, so the modal never blanks.
    if (window.Swal) {
      Swal.fire({
        icon: "info",
        title: i18n("btn_req_timeline", "Requirement dates & quotes timeline"),
        html: '<div class="py-3"><span class="spinner-border text-primary"></span></div>',
        showConfirmButton: false,
        allowOutsideClick: false,
      });
    }
    const fallbackFromCache = () => {
      const groups = (visibleQuoteGroups || []).filter(
        (g) => String(g.orderId || "").trim() === oid
      );
      if (!groups.length) {
        if (window.Swal) Swal.fire(i18n("msg_warning"), i18n("msg_no_quotes_found"), "warning");
        return;
      }
      let reqCreated = "", reqCreatedIso = "", reqMod = "", reqModIso = "", reqModBy = "", reqModCount = 0;
      groups.forEach((g) => {
        const cIso = String(g.reqDateIso || "").trim(), cRaw = String(g.reqDate || "").trim();
        if (cIso && (!reqCreatedIso || cIso < reqCreatedIso)) { reqCreatedIso = cIso; reqCreated = cRaw; }
        else if (!reqCreated && !reqCreatedIso && cRaw) { reqCreated = cRaw; }
        const mIso = String(g.reqLastModifiedIso || "").trim(), mRaw = String(g.reqLastModified || "").trim();
        if ((mRaw || mIso) && (!reqMod || (mIso && (!reqModIso || mIso > reqModIso)))) { reqMod = mRaw; reqModIso = mIso; }
        if (!reqModBy && g.reqLastModifiedBy) reqModBy = String(g.reqLastModifiedBy);
        if ((Number(g.reqModCount) || 0) > reqModCount) reqModCount = Number(g.reqModCount) || 0;
      });
      showHtml(renderTimeline({
        reqCreated, reqCreatedIso, reqApprovedBy: "", reqApprovedDate: "",
        reqLastModifiedBy: reqModBy, reqLastModified: reqMod,
        reqLastModifiedIso: reqModIso, reqModCount,
        quotes: groups.map((g) => ({
          supplier: g.supplier, quoteId: g.quoteId, createdDate: g.createdDate,
          createdBy: String(g.createdByName || g.createdBy || "").trim(),
          uploadedDate: "", uploadedBy: "", approvedBy: "", approvedDate: "",
          lastModifiedBy: String(g.lastModifiedByName || g.lastModifiedBy || "").trim(),
          lastModifiedDate: g.lastModifiedDate, modCount: Number(g.modCount) || 0,
        })),
      }));
    };
    try {
      google.script.run
        .withSuccessHandler(function (t) {
          if (!t || !Array.isArray(t.quotes)) { fallbackFromCache(); return; }
          showHtml(renderTimeline(t));
        })
        .withFailureHandler(function () { fallbackFromCache(); })
        .getReqQuoteTimeline(oid);
    } catch (e) { fallbackFromCache(); }
  };

  function renderSingleQuoteCard(q, flatIndex) {
    const pdfEnabled = window.globalConfig?.quoPdfEnabled !== false;
    // Duplicate rows from re-sent RFQs are collapsed for display (see
    // buildQuoteDisplayItems): counters, status bar and colours all describe the
    // lines the user actually sees.
    const rows = quoteCardRows(q);
    const sentQty = rows[0]?.qty || rows[0]?.cant || 0;
    const receivedQty = Number(String(rows[0]?.receivedQty || '').replace(/,/g, '')) || 0;

    let receiptStatusHtml = '';
    if (sentQty > 0) {
      const progress = Math.round((receivedQty / sentQty) * 100) || 0;
      if (progress === 100) {
        receiptStatusHtml = `<div class="small text-muted mt-2"><span class="badge bg-success">✅ ${i18n('receipt_fully_received').replace('{qty}', receivedQty)}</span></div>`;
      } else if (progress > 0) {
        const pctMissing = 100 - progress;
        receiptStatusHtml = `<div class="small text-muted mt-2"><span class="badge bg-warning text-dark">⚠️ ${i18n('receipt_partial').replace('{recv}', receivedQty).replace('{sent}', sentQty).replace('{pct}', pctMissing)}</span></div>`;
      } else if (q.status === 'Despatched' || rows[0]?.status === 'Despatched') {
        receiptStatusHtml = `<div class="small text-muted mt-2"><span class="badge bg-info text-dark">📦 ${i18n('receipt_awaiting')}</span></div>`;
      }
    }

    const metaHtml = `<div>${q.category}${q.subCategory ? " / " + q.subCategory : ""}</div><div>${q.site || i18n('quote_no_site')}</div>${receiptStatusHtml}`;

    const domStatus = quoteGroupDominantStatus(rows);
    const domColor = quoteStatusColor(domStatus);
    const statusBadge = `<span class="badge mt-2" style="background:${domColor.badgeBg};border:1px solid ${domColor.badgeBorder};color:${domColor.text};"><span style="display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:${domColor.dot};margin-right:.3rem;vertical-align:baseline;"></span>${quoteStatusLabel(domStatus)}</span>`;

    const statusBarHtml = renderQuoteStatusBar(rows);

    // PO creation reminder — only for quotes whose dominant status is Approved.
    const poReminderBtn = domStatus === "Approved"
      ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); window.sendPoReminder(${flatIndex})" title="${i18n('btn_send_po_reminder')}"><i class="bi bi-envelope"></i></button>`
      : "";

    // 🕐 GREY + LOCK while this card's background save is still running (see
    // pendingQuoteSaves). The read-only parts (details, PDF, export) stay
    // usable; the write paths (edit / delete) are disabled with an explanatory
    // tooltip, mirroring the opacity/cursor treatment of the Req fix.
    const savePending = isQuoteSavePending(quoteSaveKeyOf(q));
    const saveLockTitle = attr_(i18n("msg_quote_saving_in_progress",
      "This quote is still being saved in the background. Please wait for the save to complete before editing it again."));
    const savingBadge = savePending
      ? `<span class="badge bg-info text-dark"><span class="spinner-border spinner-border-sm me-1" style="width:.65rem;height:.65rem;vertical-align:middle;" role="status"></span>${i18n("lbl_saving_badge", "Saving…")}</span>`
      : "";
    const cardSaveStyle = savePending ? "opacity:.55;cursor:not-allowed;" : "";
    const editBtnHtml = savePending
      ? `<button type="button" class="btn btn-sm btn-outline-secondary" disabled title="${saveLockTitle}"><i class="bi bi-pencil"></i></button>`
      : `<button type="button" class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); window.openEditQuote(${flatIndex})" title="${i18n('btn_edit')}"><i class="bi bi-pencil"></i></button>`;
    const deleteBtnHtml = savePending
      ? `<button type="button" class="btn btn-sm btn-outline-danger" disabled title="${saveLockTitle}"><i class="bi bi-trash"></i></button>`
      : `<button type="button" class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); window.confirmDeleteQuote(${flatIndex})" title="${i18n('btn_delete')}"><i class="bi bi-trash"></i></button>`;

    return `<div class="col-md-6 col-lg-4"><div class="card h-100 border-start border-4 shadow-sm quote-card" role="button" tabindex="0" style="background:${domColor.bg};border-left-color:${domColor.border} !important;border-color:${domColor.border}40;${cardSaveStyle}"><div class="card-body"><div class="d-flex justify-content-between align-items-center gap-2 mb-1"><div class="flex-grow-1" onclick="window.openQuoteDetails(${flatIndex})" style="cursor: pointer; min-width: 0; overflow: hidden;"><h6 class="fw-bold mb-1 text-truncate" title="${attr_(q.supplier || i18n('quote_no_supplier'))}">${q.supplier || i18n('quote_no_supplier')}</h6><div class="quote-meta small text-muted">${metaHtml}</div>${statusBadge}${savingBadge}</div><div class="d-flex flex-column gap-1 flex-shrink-0">${pdfEnabled ? `<a href="${q.link}" target="_blank" class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation()" title="${i18n('btn_open_pdf')}"><i class="bi bi-file-pdf"></i></a>` : ""}${poReminderBtn}<button type="button" class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); window.exportQuoteExcel(${flatIndex})" title="${i18n('lbl_export_excel_title')}"><i class="bi bi-file-earmark-excel"></i></button>${editBtnHtml}${deleteBtnHtml}</div></div>${statusBarHtml}<hr class="my-2"><div class="small"><strong>${i18n('lbl_items_card')}:</strong> ${i18n('quote_positions').replace('{count}', rows.length)}</div><div class="small text-muted mt-2"><strong>${i18n('status')}:</strong> ${buildQuoteStatusSummary(rows) || i18n('msg_no_items')}</div><div class="quote-hint mt-3" onclick="window.openQuoteDetails(${flatIndex})">${i18n('quote_view_full_details')}</div></div></div></div>`;
  }

  function renderQuoteCards(quotes) {
    const container = document.getElementById("quoteContainer");
    const safeQuotes = Array.isArray(quotes) ? quotes : [];
    visibleQuoteGroups = safeQuotes;
    updateQuoteResultsCount(safeQuotes);
    if (typeof renderQuoteStatusLegend === "function") renderQuoteStatusLegend();

    if (safeQuotes.length === 0) {
      container.innerHTML =
        `<div class="alert alert-info">${i18n('msg_no_quotes_found')}</div>`;
      return;
    }

    // Group quote groups by orderId (requirement number)
    const byReq = {};
    safeQuotes.forEach((q) => {
      const oid = q.orderId || i18n('quote_no_supplier');
      if (!byReq[oid]) byReq[oid] = [];
      byReq[oid].push(q);
    });

    // Sort requirement sections by most recent item date (descending)
    const reqKeys = Object.keys(byReq).sort((a, b) => {
      const latestDate = (groups) => {
        let max = new Date(0);
        groups.forEach((q) => {
          const d = new Date(q.date || q.items?.[0]?.timestamp || 0);
          if (d > max) max = d;
        });
        return max;
      };
      return latestDate(byReq[b]) - latestDate(byReq[a]);
    });

    let flatIndex = 0;
    const orderedGroups = [];
    container.innerHTML = reqKeys
      .map((oid) => {
        const groups = byReq[oid];
        const allItems = groups.flatMap((g) => quoteCardRows(g));
        const totalItems = allItems.length;
        const statusSummary = buildQuoteStatusSummary(allItems);
        const reqMetaHtml = quoteReqMetaHtml(groups);

        // 🕐 While ANY card of this requirement is still saving in the background
        // (pendingQuoteSaves), the requirement-level actions — add quote and
        // price compare — are disabled too: both would read a half-written sheet
        // or a stale card list. Grey card + "Saving…" badge make the reason clear.
        const reqSaving = groups.some((g) => isQuoteSavePending(quoteSaveKeyOf(g)));
        const reqLockTitle = attr_(i18n("msg_quote_saving_in_progress",
          "This quote is still being saved in the background. Please wait for the save to complete before editing it again."));
        const reqSavingBadge = reqSaving
          ? `<span class="badge bg-info text-dark"><span class="spinner-border spinner-border-sm me-1" style="width:.65rem;height:.65rem;vertical-align:middle;" role="status"></span>${i18n("lbl_saving_badge", "Saving…")}</span>`
          : "";
        const addQuoteBtnHtml = reqSaving
          ? `<button type="button" class="btn btn-sm btn-outline-primary" disabled title="${reqLockTitle}"><i class="bi bi-plus-lg"></i></button>`
          : `<button type="button" class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); window.openAddQuoteToReq('${attr_(oid)}')" title="${attr_(i18n('btn_add_quote', 'Add another quote to this requirement'))}"><i class="bi bi-plus-lg"></i></button>`;
        const compareBtnHtml = reqSaving
          ? `<button type="button" class="btn btn-sm btn-outline-info" disabled title="${reqLockTitle}"><i class="bi bi-bar-chart-line"></i></button>`
          : `<button type="button" class="btn btn-sm btn-outline-info" onclick="event.stopPropagation(); window.openCompareQuotes('${attr_(oid)}')" title="${attr_(i18n('btn_compare_prices', 'Compare prices'))}"><i class="bi bi-bar-chart-line"></i></button>`;

        return `<div class="quote-req-section mb-4"><div class="card border-start border-4 border-primary shadow-sm mb-3"><div class="card-body py-2 px-3"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2"><div class="d-flex align-items-center gap-2"><span class="fs-5 fw-bold text-primary">${i18n('lbl_req')} ${oid}</span>${reqMetaHtml}${reqSavingBadge}<span class="badge bg-secondary bg-opacity-75 text-dark">${groups.length} quotes</span><span class="badge bg-light text-dark border">Items: ${totalItems}</span>${(typeof window.isQuoteUserRole === "function" && window.isQuoteUserRole()) ? "" : `${addQuoteBtnHtml}${compareBtnHtml}`}</div><div class="small text-muted">${statusSummary}</div></div></div></div><div class="row g-3">${groups.map((q) => { orderedGroups.push(q); const h = renderSingleQuoteCard(q, flatIndex); flatIndex++; return h; }).join("")}</div></div>`;
      })
      .join("");
    visibleQuoteGroups = orderedGroups;
  }

  // Single source of truth for card grouping (see quoteGroupKey): the Quote ID is
  // NOT part of the key, so a cache-sync re-render can never split one supplier
  // quote into several cards nor drop the rows that were not edited.
  function rebuildGroupedQuotes(list) {
    return buildQuoteGroups(list);
  }

  function syncQuoteCachesAfterSave(meta, updatedItems, newPdfUrl) {
    const orderId = String(meta?.orderId || "").trim();
    const supplier = String(meta?.supplier || "").trim();
    const category = String(meta?.category || "").trim();

    if (!orderId || !supplier || !category || !Array.isArray(updatedItems)) return;

    const matchGroup = (item) =>
      String(item.orderId || "").trim() === orderId &&
      String(item.supplier || "").trim() === supplier &&
      String(item.category || "").trim() === category;

    const existingGroup = (allQuotesRaw || []).filter((item) => !matchGroup(item));

    const originalMeta = (allQuotesRaw || []).find((item) => matchGroup(item)) || {};

    // Rows of the card that the edit modal did NOT show (the superseded RFQ rounds
    // collapsed by buildQuoteDisplayItems) must survive this cache rebuild: they are
    // real sheet rows that the approval flow still has to resolve when the supplier
    // wins an item, they are only hidden from the UI. The sheet row identity is
    // Quote ID + GEO Code, so a previous row is only "represented" (i.e. safe to
    // drop) when the payload edits that exact Quote ID + GEO pair - matching on GEO
    // alone would erase every superseded round of a re-sent RFQ, because those rows
    // necessarily share the GEO of the line the modal shows. Rows without a Quote ID
    // fall back to the full line-key match.
    const shownIdentities = {};
    const shownLineKeys = {};
    updatedItems.forEach((it) => {
      // Same fallback chain as normalizedItems below: the identity must be the Quote
      // ID the row will actually be written with, or a row could be kept as hidden
      // AND re-added by the payload (duplicate) or vice versa (lost row).
      const qid = String(it.quoteId || meta.quoteId || originalMeta.quoteId || "").trim();
      if (qid) {
        shownIdentities[qid + "|" + quoteLineGeoKey(it)] = true;
      } else {
        shownLineKeys[quoteLineKey(it)] = true;
      }
    });
    const hiddenRows = (allQuotesRaw || [])
      .filter((item) => matchGroup(item))
      .filter((item) => {
        const qid = String(item.quoteId || "").trim();
        if (qid) return !shownIdentities[qid + "|" + quoteLineGeoKey(item)];
        return !shownLineKeys[quoteLineKey(item)];
      });

    // 💰 Lookup of the stored commercials per sheet row (Quote ID + GEO), used to
    // keep the cached discount/transport when the payload sends `undefined`.
    const storedCommercialRowByKey = {};
    (allQuotesRaw || []).filter(matchGroup).forEach((row) => {
      storedCommercialRowByKey[
        String(row.quoteId || "").trim() + "|" + quoteLineGeoKey(row)
      ] = row;
    });

    const normalizedItems = updatedItems.map((it) => {
      // 💰 Commercials follow the "undefined = server kept the stored value"
      // contract, so the cache has to fall back to the row it already holds.
      // Without this, saving a quote that never touched the discount would blank
      // it on screen (until the next reload) and the cards would show totals that
      // no longer match the sheet.
      const storedRow = storedCommercialRowByKey[
        String(it.quoteId || meta.quoteId || originalMeta.quoteId || "").trim() + "|" + quoteLineGeoKey(it)
      ] || {};
      const hasDiscount = it.discountPct !== undefined && it.discountPct !== null && String(it.discountPct).trim() !== "";
      const hasFreight = it.freight !== undefined && it.freight !== null && String(it.freight).trim() !== "";
      return {
      ...it,
      orderId,
      // Rows of one merged card may carry different Quote IDs: keep the row's own
      // ID (used server-side for the Quote ID + Geo Code row lookup) and only fall
      // back to the card/meta ID when the row has none.
      quoteId: String(it.quoteId || meta.quoteId || originalMeta.quoteId || "").trim(),
      supplier,
      category,
      faena: it.faena || originalMeta.faena || "",
      timestamp: it.timestamp || originalMeta.timestamp || new Date().toString(),
      price: Number(it.price || 0),
      total: Number(it.total || 0),
      // Net unit price is always derived, never cached as an input.
      discountPct: hasDiscount ? normalizeQuoteDiscountPct(it.discountPct) : normalizeQuoteDiscountPct(storedRow.discountPct),
      freight: hasFreight ? normalizeQuoteFreight(it.freight) : normalizeQuoteFreight(storedRow.freight),
      netUnitPrice: quoteNetUnitPrice(
        Number(it.price || 0),
        hasDiscount ? it.discountPct : storedRow.discountPct
      ),
      cant: Number(it.qty || it.cant || 0),
      estado: it.status || "Pending",
      subCategory: it.subCategory || "",
      es: it.es || it.desc || "",
      quoteLink: newPdfUrl || it.quoteLink || originalMeta.quoteLink || "",
      origGeo: it.origGeo || it.geo || "",
      origPn: it.origPn || it.pn || it.p || "",
      // 🕐 Keep the sheet AUDIT trail on the cached rows: the save payload
      // carries no audit cells (the server stamps them on write), so without
      // this the card's "Created / Last modified" info and the edit-modal audit
      // line would blank out after every in-session save. `it` first (in case a
      // future payload sends them), then the stored sheet row, then blank.
      createdBy: it.createdBy || storedRow.createdBy || "",
      createdByName: it.createdByName || storedRow.createdByName || "",
      createdDate: it.createdDate || storedRow.createdDate || "",
      createdIso: it.createdIso || storedRow.createdIso || "",
      lastModifiedBy: it.lastModifiedBy || storedRow.lastModifiedBy || "",
      lastModifiedByName: it.lastModifiedByName || storedRow.lastModifiedByName || "",
      lastModifiedDate: it.lastModifiedDate || storedRow.lastModifiedDate || "",
      lastModifiedIso: it.lastModifiedIso || storedRow.lastModifiedIso || "",
      modCount: Number(it.modCount || storedRow.modCount) || 0,
      // Requirement audit joins ride on the original row too.
      reqLastModified: it.reqLastModified || storedRow.reqLastModified || "",
      reqLastModifiedIso: it.reqLastModifiedIso || storedRow.reqLastModifiedIso || "",
      reqLastModifiedBy: it.reqLastModifiedBy || storedRow.reqLastModifiedBy || "",
      reqModCount: Number(it.reqModCount || storedRow.reqModCount) || 0,
      };
    });

    allQuotesRaw = existingGroup.concat(hiddenRows, normalizedItems);

    groupedQuotes = rebuildGroupedQuotes(allQuotesRaw);
    
    // Re-render the quote cards without reloading all data, honoring the
    // user's current filters instead of unconditionally showing every quote.
    renderQuoteView_(groupedQuotes);
  }

  function updateQuoteResultsCount(quotes) {
    const el = document.getElementById("quoteResultsCount");
    if (!el) return;

    const count = Array.isArray(quotes) ? quotes.length : 0;
    el.textContent =
      count === 0
        ? i18n('msg_no_quotes_found')
        : i18n('quote_count_visible').replace('{count}', count);
  }

  // ---- PO creation reminder: full preview modal (Approved quotes only) ----
  //
  // Reuses the shared #emailModal (same shell RFQ uses) with a single editable
  // card: To/Cc chips (add/remove/edit + autocomplete), Subject, editable HTML
  // body (the pre-rendered reminder + products table is prefilled and editable),
  // and Signature. Supplier email is intentionally NOT included — this is an
  // internal intimation. On confirm, dispatches via Graph API
  // with the same Graph-first + fallback contract as RFQ.
  //
  window.sendPoReminder = function (index) {
    const quote = visibleQuoteGroups[index];
    if (!quote) return;
    window.showPoReminderModal(quote);
  };

  window.showPoReminderModal = function (quote) {
    if (!quote) return;

    const items = quoteCardRows(quote);
    const domStatus = quoteGroupDominantStatus(items);
    if (domStatus !== "Approved") {
      Swal.fire(i18n("msg_warning", "Warning"), i18n("po_reminder_not_approved"), "warning");
      return;
    }

    const supplierName = quote.supplier || i18n("quote_no_supplier");
    const quoteId = quote.quoteId || "";
    const orderId = quote.orderId || "";

    const btnLoading = document.getElementById("btnFinalConfirm");
    if (btnLoading) {
      if (btnLoading._origHtml === undefined) btnLoading._origHtml = btnLoading.innerHTML;
      btnLoading.disabled = true;
      btnLoading.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> ' + i18n("email_preparing");
    }

    // Building the draft is a server round-trip (Quotes + Ordenes + Users +
    // QuoteLog + Drive). Show a blocking "preparing" dialog so the click on
    // the card's envelope is acknowledged; without it the UI looks frozen and
    // users click repeatedly, firing duplicate requests.
    const closeLoader = function () {
      try { if (Swal.isVisible()) Swal.close(); } catch (e) { /* ignore */ }
    };
    let loaderShown = false;
    try {
      loaderShown = Swal.isVisible();
    } catch (e) { loaderShown = false; }
    if (!loaderShown) {
      Swal.fire({
        title: i18n("po_reminder_preparing_title", "Preparing preview..."),
        html: '<div class="d-flex align-items-center justify-content-center gap-2 py-2">' +
          '<span class="spinner-border text-primary" role="status"></span>' +
          '<span class="text-muted">' + escHtml_(i18n("email_preparing", "Preparing...")) + '</span>' +
          '</div>',
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
      });
    }
    // Safety net so a call that never returns can never leave a modal spinner
    // stuck on screen forever.
    const _staleGuard = setTimeout(closeLoader, 25000);

    google.script.run
      .withSuccessHandler(function (res) {
        clearTimeout(_staleGuard);
        closeLoader();
        if (!res || !res.success || !res.mail) {
          const msg = (res && res.message) || i18n("msg_sys_error");
          Swal.fire(i18n("msg_error", "Error"), msg, "error");
          if (btnLoading) {
            btnLoading.disabled = false;
            btnLoading.innerHTML = btnLoading._origHtml || i18n("modal_send", "Send & Save Order");
          }
          return;
        }

        buildAndShowPoReminderModal(res, btnLoading);
      })
      .withFailureHandler(function (err) {
        clearTimeout(_staleGuard);
        closeLoader();
        Swal.fire(i18n("msg_error", "Error"), i18n("po_reminder_failed") + ": " + String(err), "error");
        if (btnLoading) {
          btnLoading.disabled = false;
          btnLoading.innerHTML = btnLoading._origHtml || i18n("modal_send", "Send & Save Order");
        }
      })
      .getPoReminderDraft({
        quoteId: quote.quoteId || "",
        orderId: quote.orderId || "",
        supplier: supplierName,
        currentUserEmail: (window.currentUser && window.currentUser.email) || "",
        fallbackProvider: "",
      });
  };

  window.buildAndShowPoReminderModal = function (res, restoreBtn) {
    // Guard: server already asserted Approved, but also mirror the no-doc
    // warning in the modal subtitle so the user sees it before editing.
    const sub = getI18nText("po_reminder_modal_subtitle")
      .replace("{quote}", attr_(res.meta.quoteId || res.meta.orderId || ""))
      .replace("{supplier}", attr_(res.meta.supplierName || ""))
      + (res.meta.hasDoc ? "" : " " + i18n("po_reminder_no_doc_warning"));

    const previewEl = document.getElementById("emailPreview");
    const modalBody = document.querySelector("#emailModal .modal-body");
    const modalFooter = document.querySelector("#emailModal .modal-footer");
    const titleEl = document.querySelector("#emailModal .modal-title");
    // Backup the pristine shell once (body/footer/title) so any close path can
    // restore what RFQ/CreateReq expect (#emailPreview, their Send button).
    if (previewEl && window._poEmailShellBackup === undefined) {
      window._poEmailShellBackup = {
        body: modalBody ? modalBody.innerHTML : "",
        footer: modalFooter ? modalFooter.innerHTML : "",
        title: titleEl ? titleEl.innerHTML : "",
      };
    }
    if (previewEl) previewEl.innerHTML = "";
    if (modalBody) modalBody.innerHTML = "";
    if (modalFooter) modalFooter.innerHTML = "";

    const headerLabel = getI18nText("email_preview_email_label");
    const refLabel = res.meta.quoteId || res.meta.orderId || "";
    const refDisplay = res.meta.quoteId
      ? "PO " + attr_(res.meta.quoteId)
      : "Req " + attr_(res.meta.orderId);

    var _parts = [];
    _parts.push(
      '<input type="hidden" id="poReminderRef" value="' + attr_(refLabel) + '">' +
      '<input type="hidden" id="poReminderQuoteId" value="' + attr_(res.meta.quoteId) + '">' +
      '<input type="hidden" id="poReminderOrderId" value="' + attr_(res.meta.orderId) + '">' +
      '<input type="hidden" id="poReminderSupplier" value="' + attr_(res.meta.supplierName) + '">'
    );
    _parts.push('<div class="alert alert-info py-2 small mb-3">' + escHtml_(sub) + '</div>');
    _parts.push(
      '<div class="card mb-4 border-primary shipment-group" data-index="0">' +
      '  <div class="card-header bg-primary text-white d-flex justify-content-between py-1">' +
      '    <span class="small fw-bold">' + headerLabel + ' 1: ' + refDisplay + '</span>' +
      '    <span class="badge bg-light text-primary small">' + getI18nText("po_reminder_modal_title") + '</span>' +
      '  </div>' +
      '  <div class="card-body p-3 bg-light">'
    );
    _parts.push(
      '    <div class="mb-2">' +
      '      <label class="small fw-bold text-muted">' + getI18nText("email_preview_to_label") + ':</label>' +
      '      <div class="edit-to email-chip-field" data-emails="' + attr_(res.mail.to || "") + '"></div>' +
      '      <small class="text-muted">Type or paste emails — comma, space or Enter creates a block. ' +
      '        <b>×</b> removes, <b>double-click</b> edits.</small>' +
      '    </div>'
    );
    _parts.push(
      '    <div class="mb-2">' +
      '      <label class="small fw-bold text-muted">Cc:</label>' +
      '      <div class="edit-cc email-chip-field" data-emails=""></div>' +
      '    </div>'
    );
    _parts.push(
      '    <div class="mb-2">' +
      '      <label class="small fw-bold text-muted">' + getI18nText("email_preview_subject_label") + ':</label>' +
      '      <input type="text" class="form-control form-control-sm edit-subject" ' +
      '        value="' + attr_(res.mail.subject || "") + '"' +
      '        data-i18n-placeholder="' + getI18nText("email_preview_subject_placeholder") + '">' +
      '    </div>'
    );
    _parts.push(
      '    <div class="mb-3">' +
      '      <label class="small fw-bold text-muted">' + getI18nText("po_reminder_additional_body_label") + ':</label>' +
      '      <div class="btn-group btn-group-sm mb-1" role="toolbar" aria-label="Format body">' +
      '        <button type="button" class="btn btn-outline-secondary" onclick="window.poReminderBodyCmd(this,\'bold\')"><b>B</b></button>' +
      '        <button type="button" class="btn btn-outline-secondary" onclick="window.poReminderBodyCmd(this,\'italic\')"><i>I</i></button>' +
      '        <button type="button" class="btn btn-outline-secondary" onclick="window.poReminderBodyCmd(this,\'underline\')"><u>U</u></button>' +
      '        <button type="button" class="btn btn-outline-secondary" onclick="window.poReminderBodyCmd(this,\'insertUnorderedList\')">• List</button>' +
      '      </div>' +
      '      <div class="edit-body-rich border rounded p-2 mb-1" contenteditable="true" ' +
      '        style="min-height:220px;background:#fff;font-size:13px;line-height:1.5;" data-po-body></div>' +
      '      <small class="text-muted">' + getI18nText("po_reminder_additional_body_placeholder") + '</small>' +
      '    </div>'
    );
    _parts.push(
      '    <div class="mb-2">' +
      '      <label class="small fw-bold text-muted">' + getI18nText("email_preview_signature_label") + ':</label>' +
      '      <div class="edit-signature border rounded p-2" contenteditable="true" ' +
      '        style="min-height:42px;background:#fff;font-size:13px;"></div>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
    _parts.push(
      '<div class="alert alert-light border py-2 small mb-0">' +
      '  <span class="fw-bold">' + getI18nText("po_reminder_attached") + '</span><br>'
    );
    // Attachment status comes from the server preflight (getPoReminderDraft):
    // resolveMailAttachments_ silently drops an unresolvable Drive document at
    // dispatch time, so anything flagged !ok gets an explicit "attach manually"
    // control here, BEFORE the user sends.
    // Each OK entry renders a clickable preview tile (image thumbnail, real CSV
    // mini-table, or a typed file card that opens the Drive link) so the user can
    // confirm the RIGHT file is attached rather than trusting a green label.
    var _att = Array.isArray(res.meta.attachments) ? res.meta.attachments : [];
    var _hasFail = _att.some(function (a) { return !a.ok; });

    var _fmtSize = function (n) {
      var b = Number(n || 0);
      if (!b) return "";
      if (b < 1024) return b + " B";
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
      return (b / (1024 * 1024)).toFixed(2) + " MB";
    };

    // Unique per-row id: filenames can contain characters that are invalid in
    // an id, and the label must point at its own checkbox or clicking the
    // text does nothing.
    var _attTile = function (a, ai) {
      if (!a.ok) {
        return '<li class="list-unstyled mb-2"><div class="d-flex align-items-center gap-2 text-danger">' +
          '<i class="bi bi-exclamation-triangle-fill"></i><span>' +
          escHtml_(i18n("po_reminder_attach_failed", "Could not attach: {name}")).replace("{name}", String(a.label || "")) +
          '</span></div><div class="small text-muted ms-4">' + escHtml_(String(a.reason || "")) + '</div></li>';
      }
      // Exactly one attachment is sent (the supplier quotation), so there is
      // no checkbox: nothing to choose between. The size is shown so the user
      // can confirm which file will go out.
      var _sizeTxt = _fmtSize(a.sizeBytes);
      var _nameHtml = '<div class="fw-semibold text-truncate" style="max-width:220px;" title="' +
        attr_(a.label || "") + '">' + escHtml_(a.label || "") +
        (_sizeTxt ? ' <span class="text-muted fw-normal">(' + escHtml_(_sizeTxt) + ')</span>' : '') +
        '</div>';

      if (a.kind === "image" && a.previewImg) {
        // Do NOT link to the data URL: that navigates the tab and dumps the
        // base64 payload into the address bar. Open a lightbox instead, and
        // offer the real Drive file as a separate link.
        return '<li class="list-unstyled mb-2"><div class="d-flex align-items-center gap-2">' +
          '<img src="' + attr_(a.previewImg) + '" alt="" data-po-preview="' + attr_(a.previewImg) + '" ' +
          'style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #dee2e6;cursor:zoom-in;">' +
          '<div>' + _nameHtml +
          '<div class="small text-success"><i class="bi bi-check-circle"></i> ' +
          escHtml_(i18n("po_reminder_attached_tag", "attached")) +
          ' <span class="text-muted">· ' + escHtml_(i18n("po_reminder_preview_open", "click to preview")) + '</span></div>' +
          (a.openUrl
            ? '<a href="' + attr_(a.openUrl) + '" target="_blank" rel="noopener" ' +
              'onclick="event.stopPropagation()" class="small">' +
              escHtml_(i18n("po_reminder_open_drive", "open in Drive")) + '</a>'
            : '') +
          '</div></div></li>';
      }

      // PDF (or any file Drive cannot thumbnail): a typed card that opens the
      // real Drive link in a new tab for confirmation.
      var _icon = a.kind === "pdf" ? "bi-file-earmark-pdf" : "bi-file-earmark";
      var _body =
        '<div class="d-flex align-items-center gap-2">' +
        '<i class="bi ' + _icon + ' text-danger" style="font-size:1.4rem;"></i><div>' + _nameHtml +
        '<div class="small text-success"><i class="bi bi-check-circle"></i> ' +
        escHtml_(i18n("po_reminder_attached_tag", "attached")) +
        (a.mimeType ? ' <span class="text-muted">· ' + escHtml_(a.mimeType) + '</span>' : '') +
        '</div></div></div>';
      return '<li class="list-unstyled mb-2"><div class="d-flex align-items-center gap-2">' +
        (a.openUrl
          ? '<a href="' + attr_(a.openUrl) + '" target="_blank" rel="noopener" ' +
            'onclick="event.stopPropagation()" class="text-decoration-none">' + _body + '</a>'
          : _body) + '</div></li>';
    };

    _parts.push(
      '<div class="alert alert-light border py-2 small mb-0">' +
      '  <span class="fw-bold">' + getI18nText("po_reminder_attached") + '</span>' +
      (_att.length ? '<ul class="mb-0 mt-2 ps-1">' + _att.map(_attTile).join("") + '</ul>' : '') +
      (_hasFail
        ? '<div class="mt-2 pt-2 border-top d-flex align-items-center gap-2 flex-wrap">' +
          '<button type="button" class="btn btn-sm btn-outline-primary" id="btnPoAttachManually">' +
          '<i class="bi bi-upload"></i> ' + escHtml_(i18n("po_reminder_attach_manually", "Attach the quotation manually")) + '</button>' +
          '<span class="text-muted small" id="poAttachManualStatus">' +
          escHtml_(i18n("po_reminder_attach_manually_hint", "Choose the file from your computer; it will be sent instead of the broken link.")) +
          '</span>' +
          '<input type="file" id="poAttachManualInput" class="d-none">' +
          '</div>'
        : '') +
    '</div>');

    var _modalBody = document.querySelector("#emailModal .modal-body");
    if (_modalBody) _modalBody.innerHTML = _parts.join("");


    // ---- Image preview lightbox ----
    // Clicking a thumbnail opens it in a modal instead of navigating to the
    // data URL (which exposed the raw base64 in the address bar).
    // A spinner is shown immediately: rendering a large data URL can take a
    // moment, and without feedback the user clicks repeatedly.
    var _ensureLightbox = function () {
      if (document.getElementById("poPreviewLightbox")) return;
      var wrap = document.createElement("div");
      wrap.id = "poPreviewLightbox";
      wrap.className = "modal fade";
      wrap.tabIndex = -1;
      wrap.innerHTML =
        '<div class="modal-dialog modal-lg modal-dialog-centered">' +
        '<div class="modal-content">' +
        '<div class="modal-header py-2">' +
        '<h6 class="modal-title" id="poPreviewLightboxTitle"></h6>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
        '</div>' +
        '<div class="modal-body text-center bg-light" id="poPreviewLightboxBody">' +
        '<div id="poPreviewLoading" class="py-5">' +
        '<div class="spinner-border text-primary" role="status"></div>' +
        '<div class="small text-muted mt-2">' +
        escHtml_(i18n("po_reminder_preview_loading", "Loading preview...")) + '</div>' +
        '</div>' +
        '<img id="poPreviewLightboxImg" alt="" style="display:none;max-width:100%;max-height:70vh;">' +
        '</div></div></div>';
      document.body.appendChild(wrap);
    };
    var _openLightbox = function (src, title) {
      try {
        _ensureLightbox();
        var modalEl = document.getElementById("poPreviewLightbox");
        var img = document.getElementById("poPreviewLightboxImg");
        var ttl = document.getElementById("poPreviewLightboxTitle");
        var loader = document.getElementById("poPreviewLoading");
        if (ttl) ttl.textContent = title || "";
        // Show the modal + spinner straight away, then reveal the image once
        // the browser has actually decoded it.
        if (img) { img.style.display = "none"; if (img.dataset.poSrc !== src) { img.dataset.poSrc = src; img.src = src; } else { img.style.display = "block"; } }
        if (loader) loader.style.display = "";
        var reveal = function () {
          if (loader) loader.style.display = "none";
          if (img) img.style.display = "block";
          img.removeEventListener("load", reveal);
          img.removeEventListener("error", reveal);
        };
        img.addEventListener("load", reveal);
        img.addEventListener("error", reveal);
        if (modalEl && window.bootstrap) {
          var inst = bootstrap.Modal.getOrCreateInstance(modalEl);
          inst.show();
        }
        // Safety net: never leave the spinner up if decode stalls.
        setTimeout(reveal, 4000);
      } catch (e) {
        console.warn("PO preview lightbox failed:", e);
      }
    };
    if (_modalBody) {
      _modalBody.querySelectorAll("img[data-po-preview]").forEach(function (imgEl) {
        imgEl.addEventListener("click", function (ev) {
          ev.stopPropagation();
          _openLightbox(imgEl.getAttribute("data-po-preview"),
            (imgEl.parentNode && imgEl.parentNode.querySelector(".fw-semibold") || {}).textContent || "");
        });
      });
    }

    // ---- Manual attachment fallback ----
    var _fileInput = document.getElementById("poAttachManualInput");
    var _btnManual = document.getElementById("btnPoAttachManually");
    var _statusManual = document.getElementById("poAttachManualStatus");
    if (_btnManual && _fileInput) {
      _btnManual.onclick = function () { _fileInput.click(); };
      _fileInput.onchange = function () {
        var file = _fileInput.files && _fileInput.files[0];
        if (!file) return;
        // 10 MB ceiling: beyond this the base64 round-trip to Apps Script is
        // liable to be truncated, so refuse it instead of failing at send.
        if (file.size > 10 * 1024 * 1024) {
          Swal.fire(i18n("msg_warning", "Warning"),
            i18n("msg_doc_too_large", "File is too large (max {max}).").replace("{max}", "10 MB"), "warning");
          _fileInput.value = "";
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var dataUrl = String(reader.result || "");
            var b64 = dataUrl.split(",")[1] || "";
            if (!b64) throw new Error("no data");
            window._poReminderManualAttachment = {
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              contentBase64: b64,
            };
            if (_statusManual) {
              _statusManual.innerHTML =
                '<span class="text-success"><i class="bi bi-check-circle"></i> ' +
                escHtml_(i18n("po_reminder_attach_ready", "Ready to send: {name}"))
                  .replace("{name}", file.name) + '</span>';
            }
          } catch (e) {
            Swal.fire(i18n("msg_warning", "Warning"),
              i18n("msg_doc_read_failed", "Could not read the file.") + " " + String(e), "warning");
          }
          _fileInput.value = "";
        };
        reader.onerror = function () {
          Swal.fire(i18n("msg_warning", "Warning"), i18n("msg_doc_read_failed", "Could not read the file."), "warning");
          _fileInput.value = "";
        };
        reader.readAsDataURL(file);
      };
    }

    var _toCard = _modalBody.querySelector(".shipment-group");
    var _toEl = _toCard.querySelector(".edit-to");
    var _ccEl = _toCard.querySelector(".edit-cc");
    var _subjEl = _toCard.querySelector(".edit-subject");
    var _bodyEl = _toCard.querySelector("[data-po-body]");
    var _sigEl = _toCard.querySelector(".edit-signature");

    var _toApi = window.createEmailChipField(_toEl, res.mail.to || "");
    var _ccApi = window.createEmailChipField(_ccEl, "");

    if (_toEl.querySelector(".email-chip-input")) {
      window.setupEmailAutocomplete(_toEl.querySelector(".email-chip-input"));
    }
    if (_ccEl.querySelector(".email-chip-input")) {
      window.setupEmailAutocomplete(_ccEl.querySelector(".email-chip-input"));
    }

    if (_subjEl) _subjEl.value = res.mail.subject || "";

    var _poDraftBody = res.mail.body;
    var _poDraftSig = "";
    if (_bodyEl) {
      _bodyEl.innerHTML = res.mail.body || "";
      _bodyEl.addEventListener("input", function () { _poDraftBody = _bodyEl.innerHTML; });
    }
    if (_sigEl) {
      _sigEl.addEventListener("input", function () { _poDraftSig = _sigEl.innerHTML; });
    }

    var _modalFooter = document.querySelector("#emailModal .modal-footer");
    if (_modalFooter) {
      _modalFooter.innerHTML =
        '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal" ' +
        '  data-i18n="' + getI18nText("modal_cancel") + '">Cancel</button>' +
        '<button type="button" id="btnPoReminderSend" class="btn btn-primary px-4" ' +
        '  onclick="window.sendPoReminderFromModal()" data-i18n="' + getI18nText("btn_send_po_reminder") + '">' +
        getI18nText("btn_send_po_reminder") + '</button>';
    }

    window._poReminderManualAttachment = null;
    window._poReminderDraft = {
      refId: res.meta.quoteId || res.meta.orderId || "",
      to: "",
      cc: "",
      subject: res.mail.subject || "",
      body: _poDraftBody,
      signature: _poDraftSig,
      fallbackProvider: String(res.mail.fallbackProvider || ""),
      _badTo: [],
      _badCc: [],
    };
    window._poReminderMeta = res.meta;

    var _sendBtn = document.getElementById("btnPoReminderSend");
    if (_sendBtn) { _sendBtn.onclick = window.sendPoReminderFromModal; }

    var _modalEl = document.getElementById("emailModal");
    if (_modalEl) {
      var _m = new bootstrap.Modal(_modalEl, { keyboard: true });
      _m.show();
    }
    var _titleEl = document.querySelector("#emailModal .modal-title");
    if (_titleEl) { _titleEl.textContent = getI18nText("po_reminder_modal_title"); }
    if (restoreBtn) {
      restoreBtn.disabled = false;
      restoreBtn.innerHTML = restoreBtn._origHtml || i18n("modal_send", "Send & Save Order");
    }
  };

  // Body-format toolbar for the PO-reminder editable body (mirrors RFQ execBodyCmd).
  window.poReminderBodyCmd = function (btn, cmd) {
    var ed = null;
    if (btn && btn.closest) {
      var card = btn.closest(".shipment-group") || btn.closest(".card-body") || btn.parentElement;
      ed = (card && card.querySelector) ? card.querySelector("[data-po-body]") : null;
    }
    if (!ed) ed = document.querySelector("#emailModal [data-po-body]");
    if (!ed) return;
    ed.focus();
    try { document.execCommand(cmd, false, null); } catch (e) {}
  };

  window.sendPoReminderFromModal = function () {
    var btn = document.getElementById("btnPoReminderSend");
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> ' + i18n("email_processing"); }

    var card = document.querySelector("#emailModal .shipment-group");
    if (!card) {
      Swal.fire(i18n("msg_error", "Error"), i18n("po_reminder_failed"), "error");
      if (btn) { btn.disabled = false; btn.innerHTML = getI18nText("btn_send_po_reminder"); }
      return;
    }

    var toEl = card.querySelector(".edit-to");
    var ccEl = card.querySelector(".edit-cc");
    var subjEl = card.querySelector(".edit-subject");
    var bodyEl = card.querySelector("[data-po-body]");
    var sigEl = card.querySelector(".edit-signature");

    var toVal = "";
    if (toEl && window.getChipFieldValue) toVal = window.getChipFieldValue(card, ".edit-to") || "";
    else if (toEl && toEl._chipApi && toEl._chipApi.getValue) toVal = toEl._chipApi.getValue() || "";
    var ccVal = "";
    if (ccEl && window.getChipFieldValue) ccVal = window.getChipFieldValue(card, ".edit-cc") || "";
    else if (ccEl && ccEl._chipApi && ccEl._chipApi.getValue) ccVal = ccEl._chipApi.getValue() || "";

    var toEmails = window.parseEmailsLoose ? window.parseEmailsLoose(toVal) : [];
    var ccEmails = window.parseEmailsLoose ? window.parseEmailsLoose(ccVal) : [];
    var badTo = toEmails.filter(function (e) { return !window.EMAIL_RE.test(e); });
    var badCc = ccEmails.filter(function (e) { return !window.EMAIL_RE.test(e); });

    if (!toEmails.length) {
      Swal.fire(i18n("msg_error", "Error"), "To: is empty — add at least one recipient.", "error");
      if (btn) { btn.disabled = false; btn.innerHTML = getI18nText("btn_send_po_reminder"); }
      return;
    }
    if (badTo.length || badCc.length) {
      Swal.fire(i18n("msg_error", "Error"),
        "Invalid email(s): " + [].concat(badTo, badCc).join(", ") + " — double-click the red block to fix.", "error");
      if (btn) { btn.disabled = false; btn.innerHTML = getI18nText("btn_send_po_reminder"); }
      return;
    }

    window._poReminderDraft.to = toEmails.join(", ");
    window._poReminderDraft.cc = ccEmails.join(", ");

    // ---- Harvest the remaining editable fields ----
    var subjVal = subjEl ? String(subjEl.value || "").trim() : "";
    if (!subjVal) subjVal = window._poReminderDraft.subject || "";
    var bodyHtml = bodyEl ? bodyEl.innerHTML : (window._poReminderDraft.body || "");
    var sigHtml = sigEl ? sigEl.innerHTML : (window._poReminderDraft.signature || "");
    var finalBody =
      bodyHtml +
      (sigHtml ? '<hr style="margin:16px 0 8px 0;border:none;border-top:1px solid #ccc;">' + sigHtml : "");

    var meta = window._poReminderMeta || {};
    var payloadBase = {
      quoteId: meta.quoteId || "",
      orderId: meta.orderId || "",
      supplier: meta.supplierName || "",
      currentUserEmail: (window.currentUser && window.currentUser.email) || meta.senderEmail || "",
      to: window._poReminderDraft.to,
      cc: window._poReminderDraft.cc,
      subject: subjVal,
      body: finalBody,
      // Replaces the failed Drive descriptor server-side (see buildPoReminderMail_).
      manualAttachment: window._poReminderManualAttachment || null,
      fallbackProvider: "",
    };

    var restoreSendBtn = function () {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = getI18nText("btn_send_po_reminder") || "Send PO reminder";
      }
    };

    // Graph-first attempt (fallbackProvider: "") or the chosen fallback lane on retry.
    function doDispatch(provider) {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> ' + i18n("po_reminder_sending");
      }
      var p = {};
      Object.keys(payloadBase).forEach(function (k) { p[k] = payloadBase[k]; });
      p.fallbackProvider = provider || "";
      google.script.run
        .withSuccessHandler(onSendResult)
        .withFailureHandler(function (err) {
          Swal.fire(i18n("msg_error", "Error"), i18n("po_reminder_failed") + ": " + String(err), "error");
          restoreSendBtn();
        })
        .sendPoReminderEmail(p);
    }

    function onSendResult(res) {
      if (res && res.requiresFallbackChoice) {
        // Graph send failed — show error
        Swal.fire({
          icon: "error",
          title: "Email Send Failed",
          text: res.graphError || res.emailError || "Microsoft Graph could not send the email. Please check the system configuration.",
        }).then(function () { restoreSendBtn(); });
        return;
      }
      if (res && res.success) {
        // An attachment that could not be resolved is dropped by the dispatcher
        // WITHOUT failing the send, so the green "sent" toast would otherwise
        // hide a missing quotation document / CSV. Warn explicitly instead.
        var _fail = Array.isArray(res.attachmentFailures) ? res.attachmentFailures : [];
        var _sentHtml = i18n("po_reminder_sent", "Reminder email sent.").replace("{service}", res.service || "");
        if (_fail.length) {
          _sentHtml +=
            '<div class="alert alert-warning mt-2 mb-0 py-2 small text-start">' +
            escHtml_(i18n("po_reminder_attach_dropped", "Sent, but {n} attachment(s) could not be included:")
              .replace("{n}", String(_fail.length))) +
            "<ul class=\"mb-0 ps-3 mt-1\">" + _fail.map(function (f) {
              return "<li>" + escHtml_(String(f.label || "")) +
                (f.reason ? ' <span class="text-muted">(' + escHtml_(String(f.reason)) + ")</span>" : "") +
                "</li>";
            }).join("") + "</ul></div>";
          Swal.fire({
            icon: "warning",
            title: i18n("po_reminder_sent_title", "Reminder Sent"),
            html: _sentHtml,
          });
        } else {
          Swal.fire(i18n("po_reminder_sent_title", "Reminder Sent"), _sentHtml, "success");
        }
        window.closePoReminderModal();
        return;
      }
      Swal.fire(i18n("msg_error", "Error"), (res && res.message) || i18n("po_reminder_failed"), "error");
      restoreSendBtn();
    }

    doDispatch("");
  };

  // Closes the shared #emailModal PO-reminder view and clears the cached draft.
  // The modal body/footer are rebuilt from scratch on every open (RFQ does the
  // same), so no content restore is required here.
  // Restores the pristine #emailModal shell (body/footer/title) after the PO
  // reminder view — RFQ/CreateReq rely on #emailPreview and their own footer.
  window.restorePoEmailModalShell_ = function () {
    var b = window._poEmailShellBackup;
    if (!b) return;
    var modalEl = document.getElementById("emailModal");
    if (modalEl) {
      var body = modalEl.querySelector(".modal-body");
      var footer = modalEl.querySelector(".modal-footer");
      var title = modalEl.querySelector(".modal-title");
      if (body) body.innerHTML = b.body;
      if (footer) footer.innerHTML = b.footer;
      if (title) title.innerHTML = b.title;
    }
    window._poEmailShellBackup = undefined;
  };

  // Covers every close path (Cancel, Esc, X): bootstrap fires this once hidden.
  document.addEventListener("hidden.bs.modal", function (ev) {
    if (ev.target && ev.target.id === "emailModal") window.restorePoEmailModalShell_();
  });

  window.closePoReminderModal = function () {
    var modalEl = document.getElementById("emailModal");
    if (modalEl) {
      var inst = (window.bootstrap && bootstrap.Modal) ? bootstrap.Modal.getInstance(modalEl) : null;
      if (inst) inst.hide();
    }
    window._poReminderDraft = null;
    window._poReminderMeta = null;
    window._poReminderManualAttachment = null;
    window.restorePoEmailModalShell_();
  };

  window.exportQuoteExcel = function (index) {
    const quote = visibleQuoteGroups[index];
    if (!quote) return;

    const runExport = () => {
      if (!window.XLSX) {
        Swal.fire(i18n("msg_warning"), i18n("msg_doc_libs_missing"), "warning");
        return;
      }
      const X = window.XLSX;
      // Export mirrors the collapsed view: one row per requirement line.
      const exportItems = quoteCardRows(quote);
      // 💰 Money columns: the QUOTED unit price, the supplier discount, the NET
      // unit price actually paid, and the transport shown per row but charged once
      // (the Summary sheet states the once-only rule and the grand total).
      // "Photos (Item Images)": the requester's Create Req attachments for the
      // line, joined from Ordenes per Req ID + GEO (drive URLs, newline joined
      // so each link opens on its own line straight from Excel).
      const header = [
        "Req", "Quote ID", "Supplier", "Site", "GEO", "P/N", "Description",
        "Qty", "Currency", "Exch. Rate", "Unit Price", "Discount %", "Net Unit Price",
        "Transport", "Total", "Category", "SubCategory", "Status",
        "Supplier Quote No.", "PDF Link", "Quoted Doc Link", "Photos (Item Images)",
      ];
      const rows = exportItems.map((it) => {
        const photoUrls = (window.quoteReqImagesUrls_ ? window.quoteReqImagesUrls_(it) : [])
          .map(function (p) { return p.url; });
        return [
        it.orderId || "",
        it.quoteId || "",
        quote.supplier || "",
        quote.site || "",
        it.geo || "",
        it.pn || it.p || "",
        it.es || it.desc || "",
        it.cant || it.qty || 0,
        it.currency || "CLP",
        Number(it.exchangeRate || 0),
        Number(it.price || 0),
        normalizeQuoteDiscountPct(it.discountPct),
        quoteNetUnitPrice(it.price, it.discountPct),
        normalizeQuoteFreight(it.freight),
        Number(it.total || it.lineTotal || 0),
        it.category || "",
        it.subCategory || "",
        normalizeQuoteItemStatus(it.estado || it.status),
        it.supplierQuoteNo || "",
        it.quoteLink || "",
        it.quotedDocUrl || "",
        photoUrls.join("\n"),
        ];
      });

      // Quote-level money view: Subtotal - Discount + Transport = Total, with the
      // transport counted ONCE (it is printed on every row above for reference).
      const money = quoteMoneySummary(exportItems);
      const summaryRows = [
        { Field: "Req", Value: quote.orderId || "" },
        { Field: "Quote ID", Value: quote.quoteId || "" },
        { Field: "Supplier", Value: quote.supplier || "" },
        { Field: "Site", Value: quote.site || "" },
        { Field: "Category", Value: quote.category || "" },
        { Field: "Sub Category", Value: quote.subCategory || "" },
        { Field: "Positions", Value: exportItems.length },
        { Field: "Status", Value: buildQuoteStatusSummary(exportItems) },
        { Field: i18n("lbl_subtotal", "Subtotal"), Value: money.subtotal },
        { Field: i18n("lbl_discount", "Discount"), Value: money.discount },
        { Field: i18n("lbl_freight", "Transport"), Value: money.freight },
        { Field: i18n("lbl_grand_total", "Total"), Value: money.total },
      ];

      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([header, ...rows]), "Quote");
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(summaryRows), "Summary");

      const safeOrder = String(quote.orderId || "Quote").replace(/[^A-Za-z0-9_-]/g, "_");
      const safeSupplier = String(quote.supplier || "Supplier").replace(/[^A-Za-z0-9_-]/g, "_");
      X.writeFile(wb, `Quote_${safeOrder}_${safeSupplier}.xlsx`);
    };

    if (window.XLSX) {
      runExport();
    } else {
      // SheetJS not loaded (standalone mode) — inject then retry once.
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
      s.onload = runExport;
      s.onerror = () => Swal.fire(i18n("msg_warning"), i18n("msg_doc_libs_missing"), "warning");
      document.head.appendChild(s);
    }
  };

  // ===== Table UI: column picker (A) + text zoom (B) =====
  // Every OPTIONAL column carries data-qcol="<key>" on its <th>, its <td>s and
  // (for currency) on the footer spacer, so one toggle keeps header, rows and
  // footer aligned. Mandatory columns (checkbox, Status, GEO, P/N, Description,
  // Qty, Price, Net, Total) have no data-qcol and can never be hidden.
  // Visibility per table persists in localStorage; the eye dropdown lists one
  // checkbox per optional column. A-/A+ zooms the whole table (text + inputs)
  // so more columns fit on screen.
  const QUOTE_ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25];
  const QUOTE_TABLE_UI = {
    edit: {
      rootId: "quoteEditModal",
      // Store key bumped to V2 together with the all-checked default (issue:
      // "by default mark all columns as checked") so every user starts from
      // the new default once; their later toggles keep persisting as before.
      store: "reconQuoteColsEditV2",
      zoomStore: "reconQuoteZoomEdit",
      menuId: "quoteEditColMenu",
      cols: [
        { key: "notes",    label: "item_notes",          fallback: "Item Notes",     def: 1 },
        { key: "approved", label: "lbl_qty_approved",     fallback: "Approved",       def: 1 },
        { key: "supnotes", label: "supplier_notes",       fallback: "Supplier Notes", def: 1 },
        { key: "images",   label: "item_images",          fallback: "Images",         def: 1 },
        { key: "quoteno",  label: "lbl_supplier_quote_no",fallback: "Quote No.",      def: 1 },
        { key: "doc",      label: "lbl_quoted_doc",       fallback: "Doc",            def: 1 },
        { key: "rcvd",     label: "tbl_rcvd",             fallback: "Rcvd",           def: 1 },
        { key: "diff",     label: "tbl_diff",             fallback: "Diff",           def: 1 },
        { key: "currency", label: "lbl_currency", pair: "lbl_exchange_rate", fallback: "Currency / Exch. Rate", def: 1 },
      ],
    },
    details: {
      rootId: "quoteDetailsModal",
      store: "reconQuoteColsDetailsV2",
      zoomStore: "reconQuoteZoomDetails",
      menuId: "quoteDetailsColMenu",
      cols: [
        { key: "notes",    label: "item_notes",          fallback: "Item Notes",     def: 1 },
        { key: "images",   label: "item_images",         fallback: "Images",         def: 1 },
        { key: "approved", label: "lbl_qty_approved",     fallback: "Approved",       def: 1 },
        { key: "cat",      label: "col_category",        fallback: "Category",       def: 1 },
        { key: "subcat",   label: "col_subcategory",     fallback: "Sub Category",   def: 1 },
        { key: "quoteno",  label: "lbl_supplier_quote_no",fallback: "Quote No.",      def: 1 },
        { key: "doc",      label: "lbl_quoted_doc",       fallback: "Quoted Doc",     def: 1 },
        { key: "currency", label: "lbl_currency", pair: "lbl_exchange_rate", fallback: "Currency / Exch. Rate", def: 1 },
      ],
    },
  };

  function quoteColState_(scope) {
    const cfg = QUOTE_TABLE_UI[scope];
    try { return JSON.parse(localStorage.getItem(cfg.store) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function quoteZoomState_(scope) {
    const cfg = QUOTE_TABLE_UI[scope];
    const v = parseFloat(localStorage.getItem(cfg.zoomStore));
    return QUOTE_ZOOM_STEPS.indexOf(v) >= 0 ? v : 1;
  }

  // Keep the money footer aligned with however many columns are visible: the
  // base/label cells absorb the difference (edit: 3 money cells fixed at the
  // end, details: 1 value cell fixed at the end, both with a 2-col currency
  // spacer when currency shows).
  function syncQuoteTableFooters_(root) {
    const table = root.querySelector("table");
    if (!table) return;
    let visible = 0;
    let curOn = false;
    table.querySelectorAll("thead th").forEach((th) => {
      if (!th.classList.contains("d-none")) visible++;
      if (th.getAttribute("data-qcol") === "currency" && !th.classList.contains("d-none")) curOn = true;
    });
    const base = table.querySelector("#quoteEditFootBase");
    if (base) base.setAttribute("colspan", Math.max(1, visible - 3 - (curOn ? 2 : 0)));
    table.querySelectorAll("tfoot tr").forEach((tr) => {
      const cells = tr.children;
      if (cells.length === 3 && cells[0] !== base && cells[0].hasAttribute("colspan")) {
        cells[0].setAttribute("colspan", Math.max(1, visible - 1 - (curOn ? 2 : 0)));
      }
    });
    table.querySelectorAll("tbody > tr").forEach((tr) => {
      if (tr.children.length === 1 && tr.children[0].hasAttribute("colspan")) {
        tr.children[0].setAttribute("colspan", Math.max(1, visible));
      }
    });
  }

  // Apply persisted column visibility + zoom to a quote table.
  window.applyQuoteTableState = function (scope) {
    const cfg = QUOTE_TABLE_UI[scope];
    if (!cfg) return;
    const root = document.getElementById(cfg.rootId);
    if (!root) return;
    const state = quoteColState_(scope);
    cfg.cols.forEach((c) => {
      const show = (c.key in state) ? !!state[c.key] : !!c.def;
      root.querySelectorAll('[data-qcol="' + c.key + '"]').forEach((el) => {
        el.classList.toggle("d-none", !show);
      });
    });
    const table = root.querySelector("table");
    if (table) table.style.zoom = quoteZoomState_(scope);
    syncQuoteTableFooters_(root);
  };

  // Build the eye dropdown: one checkbox per optional column.
  window.buildQuoteColMenu = function (scope) {
    const cfg = QUOTE_TABLE_UI[scope];
    if (!cfg) return;
    const menu = document.getElementById(cfg.menuId);
    if (!menu) return;
    const state = quoteColState_(scope);
    menu.innerHTML = cfg.cols.map((c) => {
      const on = (c.key in state) ? !!state[c.key] : !!c.def;
      const label = i18n(c.label, c.fallback) + (c.pair ? " / " + i18n(c.pair, "") : "");
      return '<label class="dropdown-item d-flex align-items-center gap-2" style="cursor:pointer;">' +
        '<input type="checkbox" class="form-check-input m-0" data-qcol-check="' + c.key + '"' + (on ? " checked" : "") + ">" +
        '<span>' + attr_(label) + "</span></label>";
    }).join("");
    menu.querySelectorAll("[data-qcol-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const st = quoteColState_(scope);
        st[cb.getAttribute("data-qcol-check")] = cb.checked;
        try { localStorage.setItem(cfg.store, JSON.stringify(st)); } catch (e) { /* private mode */ }
        window.applyQuoteTableState(scope);
      });
    });
  };

  // A- / A+ : step the table zoom (text, inputs and paddings together).
  window.quoteTableZoom = function (scope, dir) {
    const cfg = QUOTE_TABLE_UI[scope];
    if (!cfg) return;
    let idx = QUOTE_ZOOM_STEPS.indexOf(quoteZoomState_(scope));
    if (idx < 0) idx = QUOTE_ZOOM_STEPS.indexOf(1);
    idx = Math.max(0, Math.min(QUOTE_ZOOM_STEPS.length - 1, idx + dir));
    try { localStorage.setItem(cfg.zoomStore, String(QUOTE_ZOOM_STEPS[idx])); } catch (e) { /* private mode */ }
    window.applyQuoteTableState(scope);
  };

  window.openQuoteDetails = function (index) {
    const quote = visibleQuoteGroups[index];
    if (!quote) return;
    window._quoteDetailsIndex = index;

    const modalTitle = document.getElementById("quoteDetailsTitle");
    const modalSubtitle = document.getElementById("quoteDetailsSubtitle");
    const modalBody = document.getElementById("quoteDetailsBody");

    if (modalTitle) modalTitle.textContent = `${i18n('quote_details_title')} ${quote.orderId || ""}`;
    if (modalSubtitle) {
      modalSubtitle.textContent = [
        quote.supplier,
        quote.category,
        quote.subCategory,
      ]
        .filter(Boolean)
        .join(" | ");
    }

    const pdfLinkHtml = quote.link
      ? `<a href="${quote.link}" target="_blank" class="btn btn-sm btn-outline-danger"><i class="bi bi-file-pdf me-1"></i> ${i18n('btn_open_pdf')}</a>`
      : "";
    const excelBtnHtml = `<button type="button" class="btn btn-sm btn-outline-success" onclick="window.exportQuoteExcel(window._quoteDetailsIndex)"><i class="bi bi-file-earmark-excel me-1"></i> ${i18n('btn_export_excel')}</button>`;

    // Collapsed line list of the card (see buildQuoteDisplayItems) — one row per
    // requirement line even when the supplier was quoted in several RFQ rounds.
    const detailItems = quoteCardRows(quote);
    const detailRows = detailItems
      .map(
        (item) => {
          const docCell = item.quotedDocUrl
            ? `<a href="${attr_(item.quotedDocUrl)}" target="_blank" class="small" title="${attr_(item.quotedDocUrl)}"><i class="bi bi-paperclip"></i> ${i18n('btn_open_pdf')}</a>`
            : `<span class="text-muted">${i18n('quote_doc_empty')}</span>`;
          // 🔒 Quoted vs approved side by side, so a manager who reduced a line
          // during approval can still see both figures here. Only rendered once
          // the line is approved, and flagged when the two differ.
          const dq = quoteLineQtys(item);
          const dFrozen = isQuoteQtyFrozenStatus(item.estado || item.status);
          // 💰 Money view of the line (discount %, derived net unit price and the
          // quote-level transport this row carries for reference).
          const price = Number(item.price || 0) || 0;
          const discountPct = normalizeQuoteDiscountPct(item.discountPct);
          const netUnit = quoteNetUnitPrice(price, discountPct);
          const freight = normalizeQuoteFreight(item.freight);
          const approvedCell = !dFrozen
            ? '<span class="text-muted">&mdash;</span>'
            : `<span style="font-weight:600;${dq.reduced ? 'color:#b35c00;' : ''}"
                 title="${attr_(dq.reduced ? i18n('lbl_approved_qty_reduced', 'Approved below the quoted qty') : i18n('lbl_approved_qty_hint', 'Qty the manager approved'))}">${dq.approved}</span>`;
          return `
    <tr>
      <td>${item.geo || ""}</td>
      <td><strong>${item.pn || item.p || ""}</strong></td>
      <td>
        <div class="fw-semibold">${item.es || item.desc || "N/A"}</div>
        <div class="text-muted small fst-italic">${item.en || ""}</div>
      </td>
      <td style="min-width:140px;" data-qcol="notes">${quoteReqNotesHtml(item)}</td>
      <td style="min-width:110px;" data-qcol="images">${quoteReqImagesHtml(item)}</td>
      <td class="text-center">${dq.quoted}</td>
      <td class="text-center" data-qcol="approved">${approvedCell}</td>
      <td data-qcol="cat">${item.category || ""}</td>
      <td data-qcol="subcat">${item.subCategory || ""}</td>
      <td class="text-center" data-qcol="quoteno">${item.supplierQuoteNo || '<span class="text-muted">—</span>'}</td>
      <td class="text-center" data-qcol="doc">${docCell}</td>
      <td class="text-center quote-col-currency d-none" data-qcol="currency">${item.currency || "CLP"}</td>
      <td class="text-end quote-col-xrate d-none" data-qcol="currency">${Number(item.exchangeRate) > 0 ? Number(item.exchangeRate) : '<span class="text-muted">&mdash;</span>'}</td>
      <td class="text-end">${Number(item.price || 0).toLocaleString("en-US")}</td>
      <td class="text-end ${discountPct > 0 ? "text-success fw-semibold" : ""}">${price > 0 ? netUnit.toLocaleString("en-US") : '<span class="text-muted">—</span>'}</td>
      <td class="text-end">${Number(item.total || 0).toLocaleString("en-US")}</td>
    </tr>
  `;
        },
      )
      .join("");

    // Grand total across all line items (shown in the table footer). The stored
    // line totals already carry the transport once (only the carrier line adds
    // it), so this is the money the supplier actually invoiced for the goods + freight.
    const quoteTotalSum = detailItems.reduce(
      (sum, it) => sum + (Number(it.total || 0) || 0), 0
    );

    // 💰 Money breakdown of the footer: the transport figure is read from the
    // carrier line only, and the net subtotal is what remains of the grand total
    // once that single charge is taken out, so Subtotal + Transport = Total.
    const detailMoney = quoteMoneySummary(detailItems);
    const quoteFreightSum = detailMoney.freight;
    const quoteNetSum = Math.round((quoteTotalSum - quoteFreightSum) * 100) / 100;
    const discountSum = detailMoney.discount;

    if (modalBody) {
      const statusSummary = buildQuoteStatusSummary(detailItems);
      modalBody.innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_requirement">Requirement</div>
            <div class="quote-summary-value">${quote.orderId || ""}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_site">Site</div>
            <div class="quote-summary-value">${quote.site || ""}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_date">Date</div>
            <div class="quote-summary-value">${quote.date || ""}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_supplier">Supplier</div>
            <div class="quote-summary-value">${quote.supplier || ""}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_category">Category</div>
            <div class="quote-summary-value">${quote.category || ""}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_subcategory">Sub Category</div>
            <div class="quote-summary-value">${quote.subCategory || ""}</div>
          </div>
        </div>
        <div class="col-md-12">
          <div class="quote-summary-tile p-3 h-100">
            <div class="quote-summary-label" data-i18n="lbl_status_summary">Status Summary</div>
            <div class="quote-summary-value">${statusSummary || i18n('msg_no_items')}</div>
          </div>
        </div>
      </div>
      <div class="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mb-3">
        <div class="small text-muted"><strong>${detailItems.length}</strong> ${i18n('lbl_line_items')}</div>
        <div class="d-flex gap-2 align-items-center">
          <div class="btn-group btn-group-sm" role="group" aria-label="Table text size">
            <button type="button" class="btn btn-outline-secondary" onclick="window.quoteTableZoom('details', -1)" title="${attr_(i18n('quote_text_smaller', 'Smaller text'))}">A&minus;</button>
            <button type="button" class="btn btn-outline-secondary" onclick="window.quoteTableZoom('details', 1)" title="${attr_(i18n('quote_text_bigger', 'Bigger text'))}">A+</button>
          </div>
          <div class="dropdown">
            <button type="button" id="quoteDetailsColBtn" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" onclick="window.buildQuoteColMenu('details')" title="${attr_(i18n('quote_cols_toggle', 'Show / hide columns'))}"><i class="bi bi-eye"></i></button>
            <div id="quoteDetailsColMenu" class="dropdown-menu dropdown-menu-end p-2" style="max-height: 320px; overflow-y: auto; min-width: 220px;"></div>
          </div>
          ${pdfLinkHtml} ${excelBtnHtml}
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th data-i18n="col_geo">GEO</th>
              <th data-i18n="col_pn">P/N</th>
              <th data-i18n="col_description">Description</th>
              <th data-i18n="item_notes" data-qcol="notes">Item Notes</th>
              <th data-i18n="item_images" data-qcol="images">Images</th>
              <th class="text-center" data-i18n="col_qty">Qty</th>
              <th class="text-center" data-i18n="lbl_qty_approved" data-qcol="approved">Approved</th>
              <th data-i18n="col_category" data-qcol="cat">Category</th>
              <th data-i18n="col_subcategory" data-qcol="subcat">Sub Category</th>
              <th class="text-center" data-i18n="lbl_supplier_quote_no" data-qcol="quoteno">Supplier Quote No.</th>
              <th class="text-center" data-i18n="lbl_quoted_doc" data-qcol="doc">Quoted Doc</th>
              <th class="text-center quote-col-currency d-none" data-i18n="lbl_currency" data-qcol="currency">Currency</th>
              <th class="text-end quote-col-xrate d-none" data-i18n="lbl_exchange_rate" data-qcol="currency">Exch. Rate</th>
              <th class="text-end" data-i18n="col_price">Price</th>
              <th class="text-end" data-i18n="lbl_net_price">Net Unit</th>
              <th class="text-end" data-i18n="col_total">Total</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows || `<tr><td colspan="16" class="text-center text-muted py-3">${i18n('msg_no_line_items')}</td></tr>`}
          </tbody>
          <tfoot>
            <!-- 💰 Quote-level money footer: Subtotal (net) - Discount + Transport
                 (counted ONCE) = Total. Discount % + Transport are edited once in
                 the edit modal and shown once here — never as per-line columns.
                 The middle spacer carries the quote-col-currency class so the
                 value cell stays in the Total column in BOTH column states. -->
            <tr class="table-light">
              <td colspan="13" class="text-end fw-bold">${i18n('lbl_subtotal', 'Subtotal')}</td>
              <td colspan="2" class="quote-col-currency d-none" data-qcol="currency"></td>
              <td class="text-end fw-semibold">${quoteNetSum.toLocaleString("en-US")}</td>
            </tr>
            <tr class="table-light">
              <td colspan="13" class="text-end fw-bold">${i18n('lbl_discount', 'Discount')}</td>
              <td colspan="2" class="quote-col-currency d-none" data-qcol="currency"></td>
              <td class="text-end">${discountSum > 0 ? "-" + discountSum.toLocaleString("en-US") : "0"}</td>
            </tr>
            <tr class="table-light">
              <td colspan="13" class="text-end fw-bold">${i18n('lbl_freight', 'Transport')}</td>
              <td colspan="2" class="quote-col-currency d-none" data-qcol="currency"></td>
              <td class="text-end">${quoteFreightSum.toLocaleString("en-US")}</td>
            </tr>
            <tr class="table-light">
              <td colspan="13" class="text-end fw-bold">${i18n('col_total')}</td>
              <td colspan="2" class="quote-col-currency d-none" data-qcol="currency"></td>
              <td class="text-end fw-bold">${quoteTotalSum.toLocaleString("en-US")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    }

    const modalEl = document.getElementById("quoteDetailsModal");
    if (modalEl && window.bootstrap) {
      // Translate the data-i18n labels/headers injected into the modal body
      if (typeof applyTranslations === "function") applyTranslations();
      // Column picker + A-/A+ zoom: apply persisted visibility to the freshly
      // rendered rows and re-align the money footer with the visible columns.
      window.applyQuoteTableState("details");
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    }
  };

  // ===== DELETE HANDLER =====
  window.confirmDeleteQuote = function (index) {
    const q = visibleQuoteGroups[index];
    if (!q) return;
    // 🕐 GUARD: deleting a quote whose background save is still running would
    // race the sheet write (same lock as the edit path).
    if (isQuoteSavePending(quoteSaveKeyOf(q))) {
      showQuoteSavingWarning_();
      return;
    }
    Swal.fire({
      title: i18n('btn_delete_quote'),
      html: `${i18n('msg_delete_confirm')} <strong>${q.orderId}</strong> (${i18n('lbl_supplier')}: ${q.supplier}) as <strong>${i18n('status_deleted')}</strong>?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: i18n('btn_yes_delete'),
    }).then((res) => {
      if (res.isConfirmed) {
        google.script.run
          .withSuccessHandler(function () {
            Swal.fire(i18n('msg_success'), `${i18n('status_deleted')} ${i18n('msg_quote_marked')}`, "success");
            window.loadQuoteData();
          })
          .withFailureHandler(function (err) {
    Swal.fire(i18n("msg_error"), String(err), "error");
          })
          .markQuoteDeleted(q.orderId, q.supplier, q.category);
        }
      });
  };

  // Recompute and display the money footer of the edit-quote modal:
  //     Subtotal - Descuento + Transporte = Total
  //
  // Subtotal is the net value of the lines (discount already applied, transport
  // excluded); Descuento is the supplier discount expressed in money; Transporte
  // is the quote-level charge read from its single carrier input, so it can only
  // ever be counted once no matter how many lines the quote has.
  window.updateQuoteEditTotalSum = function () {
    const tbodyEl = document.getElementById("quoteEditBody");
    const sumEl = document.getElementById("quoteEditTotalSum");
    if (!tbodyEl || !sumEl) return;

    let subtotal = 0; // net goods value (discount applied, no transport)
    let discount = 0; // money granted by the supplier discount
    let freight = 0;  // transport, counted once (carrier input only)

    Array.from(tbodyEl.querySelectorAll("tr")).forEach((tr, rowIdx) => {
      const totalInput = tr.querySelector(".edit-total");
      const priceInput = tr.querySelector(".edit-price");
      if (!totalInput || !priceInput) return;

      // 💰 Transport lives in the quote-level bar (single value for the whole
      // quote) and lands in the totals once, on the carrier row.
      const barFreight = normalizeQuoteFreight(
        document.getElementById("quoteEditFreight")?.value);
      const rowIsCarrier = Number(tr.dataset.row) === window._quoteFreightCarrierIdx;
      const lineFreight = rowIsCarrier ? barFreight : 0;
      if (rowIsCarrier) freight = barFreight;

      const price = Number(priceInput.value || 0) || 0;
      const lineTotal = Number(totalInput.value || 0) || 0;
      const lineNet = lineTotal - lineFreight; // goods part of the line

      // Gross value of the same lines BEFORE the supplier discount. A price of 0
      // is a lump sum (no price x qty relationship), so it can show no discount.
      const gross = price > 0
        ? Math.round(price * quoteRowBasisQty_(tr) * 100) / 100
        : lineNet;
      discount += Math.max(0, Math.round((gross - lineNet) * 100) / 100);
      subtotal += lineNet;
    });

    subtotal = Math.round(subtotal * 100) / 100;
    discount = Math.round(discount * 100) / 100;
    freight = Math.round(freight * 100) / 100;
    const total = Math.round((subtotal + freight) * 100) / 100;
    const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // 💰 One figure PER LINE: Subtotal / Discount / Transport / Total
    // stacked as label-left / amount-right rows. The old inline spans wrapped
    // into an unreadable jumble inside the narrow Total column of the footer.
    const moneyLine = (label, value, cls) =>
      `<div class="d-flex justify-content-between gap-4 ${cls || ""}"><span>${label}</span><span>${value}</span></div>`;
    sumEl.innerHTML =
      moneyLine(`${i18n("lbl_subtotal", "Subtotal")}:`, fmt(subtotal)) +
      moneyLine(
        `${i18n("lbl_discount", "Discount")}:`,
        discount > 0 ? `-${fmt(discount)}` : fmt(0),
        "text-success"
      ) +
      moneyLine(`${i18n("lbl_freight", "Transport")}:`, fmt(freight), "text-info") +
      `<div class="d-flex justify-content-between gap-4 border-top mt-1 pt-1 fw-bold"><span>${i18n("lbl_grand_total", "Total")}: </span><span>${fmt(total)}</span></div>`;
  };

  // Build <option>s for a per-row Currency select from the Validation cache
  // (window.CachedDataVal.currencies => [{ name, symbol }]). Falls back gracefully
  // when the cache is unavailable.
  function quoteCurrencyOptionsHtml(selected) {
    const sel = String(selected || "").trim();
    const selUp = sel.toUpperCase();
    const list = (window.CachedDataVal && Array.isArray(window.CachedDataVal.currencies))
      ? window.CachedDataVal.currencies
      : [];
    const opts = [];
    const seen = {};
    list.forEach((c) => {
      const name = String((c && (c.name || c.Name)) || "").trim();
      if (!name) return;
      const key = name.toUpperCase();
      if (seen[key]) return;
      seen[key] = true;
      const sym = String((c && (c.symbol || c.Symbol)) || "").trim();
      const label = sym ? name + " (" + sym + ")" : name;
      opts.push('<option value="' + attr_(name) + '"' + (key === selUp ? " selected" : "") + ">" + attr_(label) + "</option>");
    });
    if (sel && !seen[selUp]) {
      opts.unshift('<option value="' + attr_(sel) + '" selected>' + attr_(sel) + "</option>");
    }
    if (!opts.length) {
      opts.push('<option value="CLP">CLP</option>');
    }
    return opts.join("");
  }

  // ===== EDIT HANDLERS =====
  window.openEditQuote = function (index) {
    const q = visibleQuoteGroups[index];
    if (!q) return;

    // 🕐 GUARD: refuse to open the modal while this card's background save is
    // still running (mirror of handleEditClickReq in ViewEditReqJS.html). The
    // modal would be built from the pre-save cache, so editing it would overwrite
    // the row changes the server is writing right now.
    if (isQuoteSavePending(quoteSaveKeyOf(q))) {
      showQuoteSavingWarning_();
      return;
    }

    // Defensive reset: ensure the Save button is enabled and the saving flag is
    // cleared every time the edit modal opens (protects against stale state
    // from an interrupted previous save).
    window._quoteEditSaving = false;
    const resetSaveBtn = document.getElementById("btnSaveEditedQuote");
    if (resetSaveBtn && resetSaveBtn.disabled) {
      resetSaveBtn.disabled = false;
      resetSaveBtn.innerHTML = i18n("btn_save_changes");
    }

    // 🔒 USER ROLE: Show warning if trying to edit before Despatched
    // Rows rendered by this modal: duplicates from re-sent RFQs are collapsed to
    // one row per requirement line (see buildQuoteDisplayItems). The save payload is
    // built from the rendered rows only, so superseded rows keep their sheet values.
    // Module-level (not a local const): saveEditedQuote reads the same array to
    // recover the quote's original commercials while building the payload.
    editRows = quoteCardRows(q);
    let userJson = localStorage.getItem("recon_user_secure");
    let isUserRole = false;
    let currentStatus = "Pending";
    
    try {
      const user = JSON.parse(userJson || "null");
      isUserRole = user && user.role?.toLowerCase() === 'user';
      
      if (isUserRole) {
        currentStatus = normalizeQuoteItemStatus(editRows[0]?.estado || editRows[0]?.status || '');
      }
    } catch (e) {
      console.warn("Failed to parse user for edit check:", e);
    }

    // Allow edit only for Despatched and later statuses
    const isDespatchedOrLater =
      ['Despatched', 'Received', 'Final Received'].includes(currentStatus);

    if (isUserRole && !isDespatchedOrLater) {
      Swal.fire({
        icon: "warning",
        title: i18n('btn_edit_not_allowed'),
        html: `${i18n('lbl_quote')} ${q.orderId}:</div><br>${i18n('msg_only_quotes_despatched_or_later')}${i18n('status_despatched')}${i18n('msg_edit_protected')}`,
        confirmButtonColor: "#6c757d",
      }).then(() => { return; }); // Exit early - fixed return in then() callback
    }

    window._editingQuote = {
      index, // can keep for UI, but not for DB
      orderId: q.orderId,
      quoteId: q.quoteId,   // ✅ ADD THIS
      supplier: q.supplier,
      category: q.category,
      site: q.site || "",
      supplierQuoteNo: "",
      quotedDoc: { url: "", fileName: "" },
    };

    // Pre-fill the shared Supplier Quote No + Quoted Doc controls from any item
    // that already has values (kept per-row and re-applied on save).
    const existingNo = editRows.map((it) => String(it.supplierQuoteNo || "").trim()).find((v) => v !== "") || "";
    const existingDoc = editRows.map((it) => String(it.quotedDocUrl || "").trim()).find((v) => v !== "") || "";
    window._editingQuote.supplierQuoteNo = existingNo;
    window._editingQuote.quotedDoc = { url: existingDoc, fileName: "" };
    const quoteNoInput = document.getElementById("quoteEditSupplierNo");
    if (quoteNoInput) {
      quoteNoInput.value = existingNo;
      // Clear the invalid highlight as soon as the user types a value.
      quoteNoInput.oninput = function () { this.classList.remove("is-invalid"); };
    }
    const docStatusEl = document.getElementById("quoteEditDocStatus");
    if (docStatusEl) {
      docStatusEl.innerHTML = existingDoc
        ? `<span class="text-success"><i class="bi bi-check2"></i> ${i18n('msg_doc_uploaded').replace('{file}', i18n('lbl_quoted_doc'))}</span> <a href="${attr_(existingDoc)}" target="_blank" class="ms-1 small" title="${i18n('btn_open_pdf')}"><i class="bi bi-paperclip"></i> ${i18n('btn_open_pdf')}</a> <a href="javascript:void(0)" onclick="window.removeQuoteDoc()" class="ms-1 small text-danger">${i18n('btn_remove_doc')}</a>`
        : `<span class="text-muted">${i18n('quote_doc_empty')}</span>`;
    }
    
    const summary = document.getElementById("quoteEditSummary");
    summary.innerHTML = `<div><strong>${i18n('lbl_req')}:</strong> ${q.orderId} &nbsp; <strong>${i18n('lbl_supplier')}:</strong> ${q.supplier} &nbsp; <strong>${i18n('lbl_category')}:</strong> ${q.category}</div>`;
    // 🕐 AUDIT LINE: when this quote was created and who last changed it (Quotes
    // sheet "Created By/Date" + "Last Modified By/Date", aggregated across the
    // card's rows by buildQuoteGroups). Legacy rows without audit cells show "-".
    try {
      const auditParts = [];
      const createdOn = String(q.createdDate || "").trim();
      const createdByName = String(q.createdByName || q.createdBy || "").trim();
      if (createdOn || createdByName) {
        auditParts.push(
          `<i class="bi bi-plus-circle me-1"></i>${i18n("lbl_created", "Created")}: ` +
          `${escHtml_(createdOn || "-")}${createdByName ? " · " + escHtml_(createdByName) : ""}`
        );
      }
      const modByName = String(q.lastModifiedByName || q.lastModifiedBy || "").trim();
      const modOn = String(q.lastModifiedDate || "").trim();
      if (modByName || modOn) {
        auditParts.push(
          `<i class="bi bi-pencil-square me-1"></i>${i18n("lbl_last_modified", "Last modified")}: ` +
          `${escHtml_(modByName || "-")}${modOn ? " · " + escHtml_(modOn) : ""}` +
          (Number(q.modCount) > 0 ? ` (${Number(q.modCount)})` : "")
        );
      }
      if (auditParts.length) {
        summary.innerHTML +=
          `<div class="mt-1 small text-muted" style="opacity:.85;">${auditParts.join(" &nbsp;·&nbsp; ")}</div>`;
      }
    } catch (auditErr) {
      console.warn("quote audit line failed: " + auditErr);
    }
    
    // Add received quantity info
    if (q.receivedQty) {
      summary.innerHTML += `<div class="mt-2 text-muted small"><strong>${i18n('lbl_user_mode')} Info:</strong> Received Qty: <span style="color:#28a745;font-weight:bold;">${q.receivedQty}</span></div>`;
    }
    
    // 🔒 USER MODE: Add context banner if needed
    const isUserRoleChecked = isUserRole;
    if (isUserRoleChecked) {
      summary.innerHTML += `<div style="margin-top:10px; padding:8px; background:#fff3cd; border-radius:4px; font-size:12px;">
        <strong>${i18n('lbl_user_mode')}:</strong> ${i18n('msg_user_edit_warning')}. 
        Sent quantities and prices are protected. Contact manager for other changes.
      </div>`;
    }

    const tbody = document.getElementById("quoteEditBody");
    // 💰 QUOTE-LEVEL commercials: one discount % + one transport charge shared
    // by every line of this quote. Existing rows may still hold differing
    // per-line values (legacy data) — the quote value is the first non-zero
    // one found, and saving unifies every row to it.
    const quoteDiscountPct = editRows.reduce(
      (found, it) => (found > 0 ? found : normalizeQuoteDiscountPct(it.discountPct)),
      0
    );
    const quoteFreightVal = editRows.reduce(
      (found, it) => (found > 0 ? found : normalizeQuoteFreight(it.freight)),
      0
    );
    // 💰 Snapshot of the quote's ORIGINAL commercials at open time. saveEditedQuote
    // reads this to tell "the user blanked the bar on purpose" (send 0) from "the
    // bar was never filled" (send undefined = keep the stored cell). It lives on
    // the edit context so it is always reachable from the save handler.
    window._editingQuote.origDiscountPct = quoteDiscountPct;
    window._editingQuote.origFreight = quoteFreightVal;
    // Which single line of this quote carries the transport into the totals.
    // With no transport yet, the first live line is the prospective carrier,
    // so saving writes the shared header value there exactly once.
    let freightCarrierIdx = quoteFreightCarrierIndex_(editRows);
    if (freightCarrierIdx === -1) {
      freightCarrierIdx = editRows.findIndex(
        (it) => normalizeQuoteItemStatus(it.estado || it.status) !== "Deleted"
      );
    }
    // 💰 Exposed for updateQuoteEditTotalSum (footer): the single row whose
    // total carries the quote-level transport.
    window._quoteFreightCarrierIdx = freightCarrierIdx;
    const siteInternal = isInternalReceivingSite(q.site);
    tbody.innerHTML = editRows
      .map((it, i) => {
        const price = Number(it.price || 0);
        // 💰 Every row displays the SAME quote-level discount/transport, read
        // from the header above — never from its own cell — so the charge can
        // only ever be entered and counted once for the whole quote.
        const discountPct = quoteDiscountPct;
        const netUnit = quoteNetUnitPrice(price, discountPct);
        const freightVal = quoteFreightVal;
        const qtys = quoteLineQtys(it);
        const qty = qtys.quoted;
        const status = normalizeQuoteItemStatus(it.estado || it.status);
        // 🔒 The quoted qty freezes once the line is Approved: it is the record of
        // what the supplier quoted, and the manager's reduction now lives in the
        // separate "Cant. Aprobado" column instead of overwriting it.
        const qtyFrozen = isQuoteQtyFrozenStatus(status);
        // Basis for the "Missing" column and the total auto-calculation: the
        // approved qty once the line is approved, the quoted qty before that.
        const diffBasis = qtyFrozen ? qtys.approved : qty;
        const total = Number(it.total || it.lineTotal || price * qty || 0);
        // Received qty visible only once the receiving window is open for this site:
        //  - Store/Workshop (internal): status is "Sent" or later
        //  - Remote sites (default): status is "Despatched" or later
        const showReceived = siteInternal
          ? ['SENT', 'RECEIVED', 'DESPATCHED', 'FINAL RECEIVED'].includes(status)
          : ['DESPATCHED', 'FINAL RECEIVED'].includes(status);
        // Display value for the input. Fall back to sent qty only for DISPLAY.
        const receivedValue = it.receivedQty || qty || '';
        // Actual stored received quantity (0 when none recorded yet). Needed for the
        // hidden-save path so we never "receive" the sent qty by accident.
        const storedRecv = (it.receivedQty !== undefined && it.receivedQty !== null && String(it.receivedQty).trim() !== '')
          ? (Number(String(it.receivedQty).replace(/,/g, '')) || 0)
          : 0;
        const origGeo = it.origGeo || it.geo || "";
        const origPn = it.origPn || it.pn || it.p || "";
        const currencySel = String(it.currency || "CLP").trim() || "CLP";
        const exchangeVal = (it.exchangeRate !== undefined && it.exchangeRate !== null && String(it.exchangeRate).trim() !== "")
          ? (Number(it.exchangeRate) || 0)
          : "";
        return `<tr data-row="${i}" data-quote-id="${attr_(it.quoteId || '')}" data-orig-recv="${storedRecv}" data-orig-sent="${qty}" data-orig-approved="${qtys.approved}" data-qty-frozen="${qtyFrozen ? "1" : "0"}" data-orig-cat="${attr_(it.category || "")}" data-orig-sub="${attr_(it.subCategory || "")}" data-orig-discount="${discountPct}" data-orig-freight="${freightVal}" data-saved-quote-no="${attr_(it.supplierQuoteNo)}" data-saved-doc-url="${attr_(it.quotedDocUrl)}" data-saved-doc-name="${attr_(quoteDocFileNameFromUrl(it.quotedDocUrl))}" data-pending-doc="" data-clear-doc="0">
        <td class="text-center"><input type="checkbox" class="form-check-input edit-item-select" data-i="${i}"></td>
        <td>
          <div class="d-flex align-items-center gap-2">
            <select class="form-select form-select-sm edit-status" data-i="${i}">
              ${quoteStatusOptionsHtml(status, it.estado || it.status, price)}
            </select>
            <i class="bi status-icon" data-i="${i}"></i>
          </div>
        </td>
        <td>
          <span 
            class="edit-geo-label" 
            data-i="${i}" 
            data-orig-geo="${origGeo}"
            style="font-weight: 500;"
          >
            ${it.geo || ""}
          </span>
        </td>
        <td><input class="form-control form-control-sm edit-pn" data-i="${i}" data-orig-pn="${origPn}" value="${it.pn || it.p || ""}"></td>
        <td style="min-width: 240px;"><textarea class="form-control form-control-sm edit-desc" data-i="${i}" rows="2">${it.es || it.desc || ""}</textarea></td>
        <td style="min-width: 140px;" data-qcol="notes">${quoteReqNotesHtml(it)}</td>

        <!-- QUOTED QUANTITY ("Cant."). Editable for non-USER roles while the line is
             still pre-approval AND the receiving window is closed; frozen from
             Approved onwards, where the approved figure moves to its own column. -->
        <td class="text-center">
          ${(!isUserRole && !showReceived && !qtyFrozen)
            ? `<input type="number" min="0" step="1" class="form-control form-control-sm edit-qty text-center" data-i="${i}" value="${qty}">`
            : `<span style="font-weight: bold; color: ${it.receivedQty ? '#28a745' : '#6c757d'};"${qtyFrozen ? ` title="${attr_(i18n('lbl_qty_quoted_locked', 'Quoted qty is locked once the line is Approved'))}"` : ''}>${qty}</span>`}
        </td>

        <!-- APPROVED QUANTITY ("Cant. Aprobado"). Empty until the line is actually
             approved; a Manager/Admin may then correct it, which re-derives the
             line total and every downstream consumer from this figure. -->
        <td class="text-center edit-approved-cell" data-qcol="approved">
          ${qtyFrozen
            ? `<input type="number" min="0" step="1" class="form-control form-control-sm edit-approved-qty text-center ${isUserRole ? "bg-light" : ""}" data-i="${i}" value="${qtys.approved}"${isUserRole ? " disabled" : ""} title="${attr_(qtys.reduced ? i18n('lbl_approved_qty_reduced', 'Approved below the quoted qty') : i18n('lbl_approved_qty_hint', 'Qty the manager approved'))}">`
            : `<span class="text-muted">&mdash;</span><small class="d-block text-muted">${attr_(i18n('lbl_not_approved_yet', 'not approved yet'))}</small>`}
        </td>

        <!-- Supplier Notes (read-only, joined from the Ordenes "Supplier Notes"
             column per Req ID + GEO). Category / Sub Category were removed from
             THIS MODAL ONLY: both values are echoed back on the <tr> as
             data-orig-cat / data-orig-sub so the sheet is never blanked. -->
        <td style="min-width: 140px;" data-qcol="supnotes">${quoteReqSupplierNotesHtml(it)}</td>

        <!-- Requester photos (read-only, joined from the Ordenes "Item Images"
             column per Req ID + GEO). Never an input: the save payload must not
             rewrite another module's documents. -->
        <td style="min-width: 110px;" class="text-center edit-req-images-cell" data-qcol="images">${window.quoteReqImagesHtml ? window.quoteReqImagesHtml(it) : ''}</td>

        <!-- Supplier Quote No (per line; the toolbar bulk-fills the ticked rows) -->
        <td class="text-center edit-quote-no-cell" data-qcol="quoteno">
          <input type="text" class="form-control form-control-sm edit-quote-no text-center" data-i="${i}"
                 placeholder="${attr_(i18n('quote_doc_empty'))}"
                 value="${attr_(it.supplierQuoteNo || "")}"
                 style="min-width:90px;" />
        </td>

        <!-- Quoted Doc (per line: link + upload + clear) -->
        <td class="text-center edit-doc-cell" data-qcol="doc">
          <span class="edit-doc-actions d-inline-flex align-items-center gap-1"></span>
        </td>

        <!-- RECEIVED QUANTITY (EDITABLE only when the receiving window is open) -->
        <td class="text-center edit-received-cell" data-qcol="rcvd">
          <input
            type="number"
            min="0"
            step="1"
            class="form-control form-control-sm edit-received-qty text-center ${showReceived ? '' : 'd-none'}"
            data-i="${i}"
            value="${receivedValue}"
            ${showReceived ? '' : 'disabled'}>
          <span class="edit-received-placeholder text-muted ${showReceived ? 'd-none' : ''}">&mdash;</span>
          <small style="color: #28a745; display: block;">${i18n('lbl_you_received')}</small>
        </td>

        <!-- MISSING QUANTITY (CALCULATED against the APPROVED qty, not the quoted one:
             the shortfall that matters is what was signed off and did not arrive).
             A frozen line whose approved qty was reduced therefore shows the real
             gap instead of the original quote minus the receipt. -->
        <td class="text-center text-end edit-diff-cell ${showReceived ? '' : 'text-muted'}" data-qcol="diff">
          ${showReceived
            ? `<span style="${Number(it.receivedQty || 0) < diffBasis ? 'color: #dc3545; font-weight: bold;' : 'color: #6c757d'};">
                ${Math.max(0, diffBasis - Number(it.receivedQty || 0))}
              </span>
              <small>${i18n('lbl_missing')}</small>`
            : '<span class="text-muted">&mdash;</span>'}
        </td>

        <!-- Currency (metadata only, column-picker controlled) -->
        <td class="text-center quote-col-currency d-none" data-qcol="currency">
          <select class="form-select form-select-sm edit-currency text-center" data-i="${i}" style="min-width:84px;" title="${i18n('lbl_currency', 'Currency')}">
            ${quoteCurrencyOptionsHtml(currencySel)}
          </select>
        </td>

        <!-- Exchange Rate (metadata only, column-picker controlled) -->
        <td class="text-end quote-col-xrate d-none" data-qcol="currency">
          <input
            type="number"
            min="0"
            step="any"
            class="form-control form-control-sm edit-exchange text-end"
            data-i="${i}"
            value="${exchangeVal}"
            title="${i18n('lbl_exchange_rate', 'Exch. Rate')}"
            style="min-width:70px;">
        </td>

        <!-- 💰 Discount % + Transport are QUOTE-LEVEL (edited once in the bar
             below, shown once in the footer) — no per-line columns here. -->

        <!-- Price (the QUOTED unit price, never overwritten) -->
        <td class="text-end">
          <input 
            type="number" 
            min="0" 
            step="0.01" 
            class="form-control form-control-sm edit-price text-end" style="min-width:120px;"
            data-i="${i}" 
            value="${price}"
            title="${i18n('price_editable_tooltip')}">
        </td>

        <!-- Net unit price (read-only): Price x (1 - Discount %) -->
        <td class="text-end">
          <span class="edit-net-unit fw-semibold ${discountPct > 0 ? "text-success" : "text-muted"}">${price > 0 ? netUnit.toLocaleString("en-US") : "—"}</span>
        </td>

        <!-- Total (auto-calculated) -->
        <td class="text-end">
          <input 
            type="number" 
            min="0" 
            step="0.01" 
            class="form-control form-control-sm edit-total text-end" style="min-width:120px;"
            data-i="${i}" 
            value="${total}" 
            readonly>
        </td>
      </tr>`;
      })
      .join("");

    // Apply the persisted column picker + zoom state to the freshly rendered
    // rows (the header cells persist across modal reopens, so this mirrors the
    // saved visibility onto the new body cells and re-aligns the footer).
    window.applyQuoteTableState("edit");

    // wire up status icons and toolbar actions
    const applyBtn = document.getElementById("quoteEditApplyBtn");
    const applySelect = document.getElementById("quoteEditApplySelect");
    const selectAll = document.getElementById("quoteEditSelectAll");

    function updateReceivedVisibilityForRow(tr) {
      if (!tr) return;
      const sel = tr.querySelector(".edit-status");
      if (!sel) return;
      const status = normalizeQuoteItemStatus(sel.value);
      const show = siteInternal
        ? ['SENT', 'RECEIVED', 'DESPATCHED', 'FINAL RECEIVED'].includes(status)
        : ['DESPATCHED', 'FINAL RECEIVED'].includes(status);
      const input = tr.querySelector(".edit-received-qty");
      const placeholder = tr.querySelector(".edit-received-placeholder");
      const diffCell = tr.querySelector(".edit-diff-cell");
      if (input) {
        input.classList.toggle("d-none", !show);
        input.disabled = !show;
      }
      if (placeholder) placeholder.classList.toggle("d-none", show);
      if (diffCell) diffCell.classList.toggle("text-muted", !show);
    }

    // ---- Selection scope helpers ----
    // The row checkboxes are the single scope selector for the whole modal: the
    // "Apply to selected" status toolbar, the bulk Quote No / document upload, and
    // the save payload all read the same ticked set.
    function getSelectedRowIndexes(tbodyEl) {
      return Array.from(tbodyEl.querySelectorAll(".edit-item-select"))
        .filter((cb) => cb.checked)
        .map((cb) => cb.getAttribute("data-i"));
    }

    function setRowSelected(tr, checked) {
      if (!tr) return;
      const cb = tr.querySelector(".edit-item-select");
      if (cb) cb.checked = !!checked;
      tr.classList.toggle("table-active", !!checked);
    }

    function clearSelection(tbodyEl) {
      Array.from(tbodyEl.querySelectorAll(".edit-item-select")).forEach((cb) => {
        cb.checked = false;
        const tr = cb.closest("tr");
        if (tr) tr.classList.remove("table-active");
      });
    }

    // Live "applying to N selected lines" counter, so the blast radius of a bulk
    // upload/save is always visible before the user commits to it.
    function updateSelectionScopeIndicator(tbodyEl) {
      const el = document.getElementById("quoteEditDocScope");
      if (!el) return;
      const all = Array.from(tbodyEl.querySelectorAll(".edit-item-select"));
      const checked = all.filter((cb) => cb.checked);
      if (!all.length || !checked.length) {
        el.innerHTML = `<span class="text-muted">${escHtml_(i18n("quote_doc_scope_none", "Tick the rows to apply a quote no. or document to."))}</span>`;
        return;
      }
      const eligible = checked.filter((cb) => {
        const sel = tbodyEl.querySelector(`.edit-status[data-i="${cb.getAttribute("data-i")}"]`);
        return sel && isQuotedOrLaterStatus(normalizeQuoteItemStatus(sel.value));
      }).length;
      el.innerHTML =
        `<i class="bi bi-check2-square me-1"></i>` +
        escHtml_(i18n("quote_doc_scope_n", "Applying to {n} selected line(s)").replace("{n}", checked.length)) +
        (eligible === 0
          ? ` <span class="text-warning">· ${escHtml_(i18n("quote_doc_scope_none_eligible", "none are Quoted or later"))}</span>`
          : ` <span class="text-muted">· ${escHtml_(i18n("quote_doc_scope_eligible", "{n} Quoted or later").replace("{n}", eligible))}</span>`);
    }

    // Indeterminate state on the select-all box: a partially scoped save must not
    // look fully scoped, otherwise the user overwrites lines they never ticked.
    function updateSelectAllState(tbodyEl) {
      if (!selectAll) return;
      const all = tbodyEl.querySelectorAll(".edit-item-select").length;
      const checked = tbodyEl.querySelectorAll(".edit-item-select:checked").length;
      selectAll.checked = all > 0 && checked === all;
      selectAll.indeterminate = checked > 0 && checked < all;
      updateSelectionScopeIndicator(tbodyEl);
    }
    window.updateSelectAllState = updateSelectAllState;

    // ---- Per-line Quoted Doc cell ----
    // Renders the line's effective document: a per-line upload made in this session
    // (data-pending-doc) wins over the value already stored in the sheet, and a
    // pending clear (data-clear-doc) hides the stored one.
    function renderRowDocCell(tr) {
      if (!tr) return;
      const host = tr.querySelector(".edit-doc-actions");
      if (!host) return;
      const sel = tr.querySelector(".edit-status");
      const status = normalizeQuoteItemStatus(sel ? sel.value : "");
      const pending = String(tr.dataset.pendingDoc || "").trim();
      const cleared = tr.dataset.clearDoc === "1";
      const savedUrl = cleared ? "" : (pending || String(tr.dataset.savedDocUrl || "").trim());
      const fileName = pending
        ? String(tr.dataset.pendingDocName || "").trim()
        : String(tr.dataset.savedDocName || "").trim();
      const eligible = isQuotedOrLaterStatus(status);

      let html = "";
      if (savedUrl) {
        html += `<a href="${attr_(savedUrl)}" target="_blank" rel="noopener" class="text-success" title="${attr_(fileName || savedUrl)}"><i class="bi bi-paperclip"></i></a>`;
        if (fileName) {
          html += `<span class="small text-muted text-truncate d-inline-block" style="max-width:110px;" title="${attr_(fileName)}">${escHtml_(fileName)}</span>`;
        }
        html += `<button type="button" class="btn btn-sm btn-link text-danger p-0 ms-1 edit-doc-clear" title="${attr_(i18n("btn_remove_doc"))}" aria-label="${attr_(i18n("btn_remove_doc"))}"><i class="bi bi-x-lg"></i></button>`;
      } else if (eligible) {
        html += `<span class="small text-muted">${escHtml_(i18n("quote_doc_empty"))}</span>`;
      } else {
        html += `<span class="small text-muted">&mdash;</span>`;
      }
      if (eligible) {
        html += `<button type="button" class="btn btn-sm btn-link text-primary p-0 edit-doc-upload" title="${attr_(i18n("quote_doc_row_upload", "Upload a document for this line"))}" aria-label="${attr_(i18n("quote_doc_row_upload", "Upload a document for this line"))}"><i class="bi bi-upload"></i></button>`;
      }
      host.innerHTML = html;
    }

    // Force-refresh every line's doc cell + the scope counter.
    window.updateQuoteDocPreviews = function () {
      Array.from(tbody.querySelectorAll("tr")).forEach(renderRowDocCell);
      updateSelectionScopeIndicator(tbody);
    };
    window.updateSelectionScopeIndicator = updateSelectionScopeIndicator;

    // The Quote No input and the Doc cell only apply to rows that are Quoted or
    // later. They are DISABLED (not merely hidden) outside that range so the save
    // payload can never write a number/document onto a Pending or Deleted line.
    function updateQuoteDocPreviewForRow(tr) {
      if (!tr) return;
      const sel = tr.querySelector(".edit-status");
      if (!sel) return;
      const eligible = isQuotedOrLaterStatus(normalizeQuoteItemStatus(sel.value));
      const noInput = tr.querySelector(".edit-quote-no");
      if (noInput) noInput.disabled = !eligible;
      const noCell = tr.querySelector(".edit-quote-no-cell");
      if (noCell) noCell.classList.toggle("text-muted", !eligible);
      renderRowDocCell(tr);
    }

    function updateIconForRow(i) {
      const tr = tbody.querySelector(`tr[data-row="${i}"]`);
      if (!tr) return;
      const sel = tr.querySelector(".edit-status");
      const icon = tr.querySelector(".status-icon");
      if (!sel || !icon) return;
      const v = sel.value;
      icon.className = "bi status-icon";
      icon.classList.remove(
        "text-success",
        "text-danger",
        "text-muted",
        "text-primary",
        "text-info",
        "text-warning",
        "text-secondary"
      );
      quoteStatusIconClass(v).split(" ").forEach((cls) => icon.classList.add(cls));
    }

    // Auto-check the row when it enters Quoted or later. The status flow is strictly
    // one-way for regular users (isStatusTransitionAllowed forbids going back), so a
    // row can only cross into Quoted+ once: this is unambiguous, and it makes the
    // checkbox the natural "this line is ready for its quote no + document" marker.
    // A Deleted line is unticked instead - there is nothing to attach to it.
    function applyAutoSelectForStatus(tr) {
      if (!tr) return;
      const sel = tr.querySelector(".edit-status");
      if (!sel) return;
      const status = normalizeQuoteItemStatus(sel.value);
      if (status === "Deleted") {
        setRowSelected(tr, false);
        return;
      }
      if (isQuotedOrLaterStatus(status)) setRowSelected(tr, true);
    }

    // initialize icons and attach change listeners
    Array.from(tbody.querySelectorAll(".edit-status")).forEach((sel) => {
      const i = sel.getAttribute("data-i");
      sel.addEventListener("change", () => {
        const tr = sel.closest("tr");
        updateIconForRow(i);
        updateReceivedVisibilityForRow(tr);
        updateQuoteDocPreviewForRow(tr);
        refreshQuotedOptionState_(tr);
        applyAutoSelectForStatus(tr);
        updateSelectAllState(tbody);
      });
      updateIconForRow(i);
      updateReceivedVisibilityForRow(sel.closest("tr"));
      updateQuoteDocPreviewForRow(sel.closest("tr"));
      // First paint: sync the price gate with the price cell as rendered.
      refreshQuotedOptionState_(sel.closest("tr"));
    });

    // apply to selected rows
    if (applyBtn) {
      applyBtn.onclick = function () {
        const v = applySelect.value;
        const skippedNoPrice = [];
        Array.from(tbody.querySelectorAll(".edit-item-select")).forEach(
          (cb) => {
            if (cb.checked) {
              const idx = cb.getAttribute("data-i");
              const sel = tbody.querySelector(`.edit-status[data-i="${idx}"]`);
              if (sel) {
                const tr = sel.closest("tr");
                // Same price rule as the per-row dropdown: assigning sel.value
                // bypasses the disabled <option>, so without this check a
                // price-0 line could be bulk-jumped to Quoted here and then
                // fail the whole save with a distant warning. Skip it and
                // report — exactly what the per-row dropdown does.
                if (v === "Quoted" && tr) {
                  const priceInput = tr.querySelector(".edit-price");
                  const price = priceInput ? Number(priceInput.value) : 0;
                  if (price <= 0) {
                    const geoEl = tr.querySelector(".edit-geo-label");
                    const descEl = tr.querySelector(".edit-desc");
                    const pnEl = tr.querySelector(".edit-pn");
                    skippedNoPrice.push(
                      `${(descEl && descEl.value) || (pnEl && pnEl.value) || "?"} (GEO ${(geoEl && geoEl.innerText) || "?"})`
                    );
                    return;
                  }
                }
                sel.value = v;
                updateIconForRow(idx);
                updateReceivedVisibilityForRow(tr);
                updateQuoteDocPreviewForRow(tr);
                refreshQuotedOptionState_(tr);
                // Re-run the auto-select: a bulk Pending -> Quoted must leave the
                // rows selected, otherwise the next document upload would skip them.
                applyAutoSelectForStatus(tr);
              }
            }
          },
        );
        if (skippedNoPrice.length) {
          Swal.fire(
            i18n("msg_warning"),
            i18n("msg_price_zero_cannot_quote", "Items with a price of 0 cannot be marked as Quoted. Enter a price for:") +
              "<br>" + skippedNoPrice.map(attr_).join("<br>"),
            "warning"
          );
        }
        updateSelectAllState(tbody);
      };
    }

    // select-all checkbox toggles selection checkboxes
    if (selectAll) {
      selectAll.onchange = function () {
        const checked = !!selectAll.checked;
        Array.from(tbody.querySelectorAll(".edit-item-select")).forEach(
          (cb) => {
            cb.checked = checked;
            const tr = cb.closest("tr");
            if (tr) tr.classList.toggle("table-active", checked);
          },
        );
        updateSelectAllState(tbody);
      };
    }

    // toggle row highlight when selecting individual rows
    Array.from(tbody.querySelectorAll(".edit-item-select")).forEach((cb) => {
      cb.addEventListener("change", () => {
        const tr = cb.closest("tr");
        if (tr) tr.classList.toggle("table-active", !!cb.checked);
        updateSelectAllState(tbody);
      });
    });

    // Per-line doc buttons (delegated: one listener for the whole table, so a
    // quote with hundreds of lines does not attach hundreds of handlers).
    tbody.addEventListener("click", function (e) {
      const tr = e.target.closest("tr");
      if (!tr) return;
      if (e.target.closest(".edit-doc-upload")) {
        e.preventDefault();
        e.stopPropagation();
        window.pickQuoteRowDoc(tr.getAttribute("data-row"));
      } else if (e.target.closest(".edit-doc-clear")) {
        e.preventDefault();
        e.stopPropagation();
        // Mark the line for clearing; the sheet value is only dropped on save,
        // because the server treats an empty quotedDocUrl as "preserve".
        tr.dataset.pendingDoc = "";
        tr.dataset.pendingDocName = "";
        tr.dataset.clearDoc = "1";
        renderRowDocCell(tr);
      }
    });

    // auto-calculate total = net unit price * qty (+ transport once, on the carrier line).
    // Basis, in order: the RECEIVED qty while the
    // receiving window is open (what actually arrived), else the editable Qty
    // input, else the APPROVED qty on a frozen line — falling back to the quoted
    // qty only for rows that predate the "Cant. Aprobado" column.
    // 💰 Quote-level commercials: the single discount % / transport in the bar
    // below apply to every row, so there are no per-row money inputs here.
    const discountBarInput = document.getElementById("quoteEditDiscount");
    const freightBarInput = document.getElementById("quoteEditFreight");
    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      const priceInput = tr.querySelector(".edit-price");
      const receivedQtyInput = tr.querySelector(".edit-received-qty"); // Use receivedQty field
      const totalInput = tr.querySelector(".edit-total");
      const qtyInput = tr.querySelector(".edit-qty"); // editable Qty (non-USER, window closed)
      const approvedQtyInput = tr.querySelector(".edit-approved-qty"); // Manager correction

      // Also keep reference to sent qty (display only) - use dataset for reliability
      const sentQtyDisplayVal = tr.dataset.origSent || "";
      const origApprovedVal = tr.dataset.origApproved || "";

      if (priceInput && receivedQtyInput && totalInput) {
        const calculateTotal = () => {
          // Money view of the line. The QUOTED price is what the supplier asked
          // for; the quote-level discount turns it into the net unit price we
          // actually pay, and the quote-level transport is added only on the
          // carrier line so the sum of all row totals equals the quote total
          // exactly once.
          const price = Number(priceInput.value || 0);
          const netUnit = quoteNetUnitPrice(price, discountBarInput ? discountBarInput.value : 0);
          const rowIdx = Number(tr.dataset.row);
          const isCarrier = rowIdx === freightCarrierIdx;
          const freightAmt = isCarrier ? normalizeQuoteFreight(freightBarInput ? freightBarInput.value : 0) : 0;
          const qtyForCalc = quoteRowBasisQty_(tr);
          // A quoted unit price of 0 means a LUMP-SUM line: the supplier gave one
          // figure for the whole line, so there is nothing to multiply and the
          // stored total must survive untouched (mirrors the server-side guard).
          if (price > 0) {
            totalInput.value = (netUnit * qtyForCalc + freightAmt).toFixed(2);
          }

          // 💰 Keep the derived net unit price next to the price in sync while typing.
          const netSpan = tr.querySelector(".edit-net-unit");
          if (netSpan) {
            netSpan.textContent = netUnit > 0 ? netUnit.toLocaleString("en-US") : "—";
            netSpan.classList.toggle("text-success", normalizeQuoteDiscountPct(discountBarInput ? discountBarInput.value : 0) > 0);
            netSpan.classList.toggle("text-muted", !(normalizeQuoteDiscountPct(discountBarInput ? discountBarInput.value : 0) > 0));
          }
          window.updateQuoteEditTotalSum();
        };
        priceInput.addEventListener("input", calculateTotal);
        // LIVE price gate: the "Quoted" option was rendered from the STORED price,
        // so re-check it on every keystroke — typing a price must unlock the
        // Pending -> Quoted transition immediately instead of only after the modal
        // is closed and reopened (see refreshQuotedOptionState_).
        priceInput.addEventListener("input", () => refreshQuotedOptionState_(tr));
        receivedQtyInput.addEventListener("input", calculateTotal);
        if (qtyInput) qtyInput.addEventListener("input", calculateTotal);
        if (approvedQtyInput) {
          approvedQtyInput.addEventListener("input", calculateTotal);
          // 🔒 Never let a Manager correction push the approved qty ABOVE the quote:
          // the server rejects it, so stop it here with a visible reason instead of
          // a save that fails the whole quote.
          approvedQtyInput.addEventListener("change", () => {
            const approved = Number(approvedQtyInput.value || 0);
            const quoted = Number(qtyInput ? qtyInput.value : sentQtyDisplayVal) || 0;
            const invalid = approved > quoted;
            approvedQtyInput.classList.toggle("is-invalid", invalid);
            approvedQtyInput.title = invalid
              ? i18n("lbl_approved_qty_over", "Approved qty cannot exceed the quoted qty")
              : i18n("lbl_approved_qty_hint", "Qty the manager approved");
          });
        }
      }
    });

    // 💰 QUOTE-LEVEL commercials bar: ONE discount % + ONE transport charge for
    // the whole quote. Both values are seeded from the stored rows (first
    // non-zero wins, so legacy per-line data unifies on open), Apply refreshes
    // every row's Net/Total display, and save writes the shared values to all
    // rows (transport adding to the totals once, on the carrier line).
    const discountBarBtn = document.getElementById("quoteEditDiscountBtn");
    const refreshAllRowTotals = () => {
      const pct = normalizeQuoteDiscountPct(discountBarInput ? discountBarInput.value : 0);
      const fr = normalizeQuoteFreight(freightBarInput ? freightBarInput.value : 0);
      Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
        const priceInput = tr.querySelector(".edit-price");
        const totalInput = tr.querySelector(".edit-total");
        const netSpan = tr.querySelector(".edit-net-unit");
        // 💰 No per-line discount/transport cells: the single quote-level values
        // in the bar below apply to every row (shown once in the footer).
        const price = Number(priceInput ? priceInput.value : 0);
        const netUnit = quoteNetUnitPrice(price, pct);
        if (netSpan) {
          netSpan.textContent = netUnit > 0 ? netUnit.toLocaleString("en-US") : "—";
          netSpan.classList.toggle("text-success", pct > 0);
          netSpan.classList.toggle("text-muted", !(pct > 0));
        }
        if (priceInput && totalInput && price > 0) {
          const rowIdx = Number(tr.dataset.row);
          const freightAmt = (rowIdx === freightCarrierIdx) ? fr : 0;
          totalInput.value = (netUnit * quoteRowBasisQty_(tr) + freightAmt).toFixed(2);
        }
      });
      // 💰 Quote totals live in the footer (Subtotal - Discount + Transport);
      // no per-line transport cells to refresh.
      window.updateQuoteEditTotalSum();
    };
    if (discountBarInput) {
      const locked = isUserRole;
      discountBarInput.disabled = locked;
      if (discountBarBtn) discountBarBtn.disabled = locked;
      discountBarInput.value = quoteDiscountPct > 0 ? String(quoteDiscountPct) : "";
      discountBarInput.title = locked
        ? i18n("msg_readonly_commercials", "Discount and transport are read-only for your role")
        : "";
      if (!locked) {
        const applyDiscount = () => {
          const pct = normalizeQuoteDiscountPct(discountBarInput.value);
          const raw = String(discountBarInput.value || "").trim();
          if (raw !== "" && (isNaN(Number(raw.replace(/[%\s,]/g, "").replace(",", "."))) || pct < 0 || pct > MAX_QUOTE_DISCOUNT_PCT)) {
            discountBarInput.classList.add("is-invalid");
            return;
          }
          discountBarInput.classList.remove("is-invalid");
          refreshAllRowTotals();
        };
        if (discountBarBtn) discountBarBtn.onclick = applyDiscount;
        discountBarInput.onkeydown = (e) => {
          if (e.key === "Enter") { e.preventDefault(); applyDiscount(); }
        };
        discountBarInput.addEventListener("input", () => {
          discountBarInput.classList.remove("is-invalid");
          refreshAllRowTotals();
        });
      }
    }
    if (freightBarInput) {
      const freightBarBtn = document.getElementById("quoteEditFreightBtn");
      const locked = isUserRole;
      freightBarInput.disabled = locked;
      if (freightBarBtn) freightBarBtn.disabled = locked;
      freightBarInput.value = quoteFreightVal > 0 ? String(quoteFreightVal) : "";
      freightBarInput.title = locked
        ? i18n("msg_readonly_commercials", "Discount and transport are read-only for your role")
        : "";
      if (!locked) {
        const applyFreight = () => {
          const raw = String(freightBarInput.value || "").trim();
          const val = raw === "" ? 0 : Number(raw.replace(/[\s,]/g, "").replace(",", "."));
          if (!isFinite(val) || isNaN(val) || val < 0 || val > MAX_QUOTE_FREIGHT) {
            freightBarInput.classList.add("is-invalid");
            freightBarInput.title = i18n(
              "msg_freight_range",
              "Transport must be a positive amount within the allowed range"
            );
            return;
          }
          freightBarInput.classList.remove("is-invalid");
          refreshAllRowTotals();
        };
        if (freightBarBtn) freightBarBtn.onclick = applyFreight;
        freightBarInput.onkeydown = (e) => {
          if (e.key === "Enter") { e.preventDefault(); applyFreight(); }
        };
        freightBarInput.addEventListener("input", () => {
          freightBarInput.classList.remove("is-invalid");
          refreshAllRowTotals();
        });
      }
    }

    window.updateQuoteEditTotalSum();

    // Nothing is selected when the modal opens and the bulk toolbar is left empty:
    // a stale value would be re-applied to whatever the user ticks next. Each line
    // already shows its own stored quote no. / document in the table.
    updateSelectAllState(tbody);

    const modalEl = document.getElementById("quoteEditModal");
    if (modalEl && window.bootstrap) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    } else if (modalEl) {
      // Bootstrap not ready yet, try again later
      setTimeout(() => {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
      }, 100);
    }
  };

  // ===== QUOTED DOCUMENT UPLOAD =====
  // Images are client-side compressed (downscaled + JPEG) before upload.
  // PDFs are stored as-is (no rasterization) to keep text-based quotes small.
  const DOC_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB raw image
  const DOC_MAX_PDF_BYTES = 10 * 1024 * 1024;   // 10 MB raw PDF (stored as-is)
  const DOC_MAX_DIM = 1600;                     // long-edge cap (px) before image compression
  const DOC_JPEG_QUALITY = 0.75;

  // Best-effort display name for a Drive URL. The sheet stores only the URL, so the
  // file name is recovered from its last path segment for the per-line doc cell.
  function quoteDocFileNameFromUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    const tail = s.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "";
    if (!tail || tail === "view" || tail === "d") return "";
    return decodeURIComponent(tail).slice(0, 120);
  }

  window.pickQuoteDoc = function () {
    const input = document.getElementById("quoteEditDocFile");
    if (input) input.click();
  };

  // Read an image file, downscale to a sane max dimension and re-encode as JPEG
  // (drops EXIF + alpha, massively shrinks phone photos).
  function compressImageToJpeg(file, maxDim = DOC_MAX_DIM, quality = DOC_JPEG_QUALITY) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = function () {
          try {
            const img = new Image();
            img.onload = function () {
              try {
                const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
                const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
                const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", quality));
              } catch (e) { reject(e); }
            };
            img.onerror = () => reject(new Error("image decode failed"));
            img.src = reader.result;
          } catch (e) { reject(e); }
        };
        reader.onerror = () => reject(new Error("file read failed"));
        reader.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }

  // Read a PDF file as a base64 data URL and store it as-is (no rasterization).
  function readPdfAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = () => reject(new Error("file read failed"));
        reader.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }

  // Upload the compressed pages to Drive.
  // With `targetTr`, the file belongs to that ONE line: the URL is stashed on the
  // row (data-pending-doc) and never touches the shared toolbar or other lines.
  // Without it, the file is a bulk upload and lands in meta.quotedDoc, where it is
  // applied to the ticked rows at save time.
  // The drop handler supplies a File directly; the hidden input supplies
  // input.files[0]. Both use the same validation, compression, upload and errors.
  function uploadQuoteDocFile(file, targetTr) {
    if (!file) return;

    const meta = window._editingQuote;
    if (!meta) return;

    const isPdf = /\.pdf$/i.test(file.name);
    const isImage = /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!isPdf && !isImage) {
      Swal.fire(i18n("msg_warning"), i18n("msg_doc_type_invalid"), "warning");
      return;
    }

    const limit = isPdf ? DOC_MAX_PDF_BYTES : DOC_MAX_IMAGE_BYTES;
    if (file.size > limit) {
      Swal.fire(i18n("msg_warning"),
        i18n("msg_doc_too_large").replace("{max}", "10 MB"),
        "warning");
      return;
    }

    const statusEl = targetTr ? null : document.getElementById("quoteEditDocStatus");
    const cellStatus = targetTr ? targetTr.querySelector(".edit-doc-actions") : null;
    if (statusEl) statusEl.innerHTML = `<span class="text-primary">${i18n("msg_doc_processing")}</span>`;
    if (cellStatus) cellStatus.innerHTML = `<span class="small text-primary"><span class="spinner-border spinner-border-sm me-1"></span></span>`;

    const finish = (pages) => {
      google.script.run
        .withSuccessHandler(function (res) {
          if (res && res.success) {
            if (targetTr) {
              // Per-line: stash on the row so only this line receives the file.
              targetTr.dataset.pendingDoc = res.url;
              targetTr.dataset.pendingDocName = res.fileName;
              targetTr.dataset.clearDoc = "0";
            } else {
              meta.quotedDoc = { url: res.url, fileName: res.fileName };
            }
            if (statusEl) {
              statusEl.innerHTML =
                `<span class="text-success"><i class="bi bi-check2"></i> ${i18n('msg_doc_uploaded').replace('{file}', res.fileName)}</span> ` +
                `<a href="javascript:void(0)" onclick="window.removeQuoteDoc()" class="ms-1 small text-danger">${i18n('btn_remove_doc')}</a>`;
            }
            if (typeof window.updateQuoteDocPreviews === "function") window.updateQuoteDocPreviews();
          } else {
            if (statusEl) statusEl.innerHTML = "";
            if (targetTr && typeof window.updateQuoteDocPreviews === "function") window.updateQuoteDocPreviews();
            Swal.fire(i18n("btn_error"),
              i18n("msg_doc_upload_failed") + (res && res.error ? " (" + res.error + ")" : ""),
              "error");
          }
        })
        .withFailureHandler(function (err) {
          if (statusEl) statusEl.innerHTML = "";
          console.error("Upload failed:", err);
          if (targetTr && typeof window.updateQuoteDocPreviews === "function") window.updateQuoteDocPreviews();
          Swal.fire(i18n("btn_error"), String(err), "error");
        })
        .uploadQuoteAttachment({
          orderId: meta.orderId || "",
          // Per-line uploads use the row's own Quote ID so the Drive folder matches
          // the round this line came from, not just the card's newest one.
          quoteId: (targetTr && String(targetTr.dataset.quoteId || "").trim()) || meta.quoteId || "",
          supplier: meta.supplier || "",
          site: meta.site || "",
          fileName: file.name,
          files: pages,
        });
    };

    const onError = (err) => {
      if (statusEl) statusEl.innerHTML = "";
      if (targetTr && typeof window.updateQuoteDocPreviews === "function") window.updateQuoteDocPreviews();
      console.error("Compression failed:", err);
      Swal.fire(i18n("btn_error"), i18n("msg_doc_read_failed") + " " + err, "error");
    };

    if (isPdf) {
      readPdfAsDataUrl(file).then((dataUrl) => {
        finish([{ name: file.name, mimeType: file.type || "application/pdf", base64: (dataUrl.split(",")[1] || "") }]);
      }).catch(onError);
    } else {
      compressImageToJpeg(file).then((dataUrl) => {
        finish([{ name: file.name, mimeType: "image/jpeg", base64: (dataUrl.split(",")[1] || "") }]);
      }).catch(onError);
    }

  }

  window.handleQuoteDocFile = function (input) {
    const file = input && input.files && input.files[0];
    if (input) input.value = "";
    uploadQuoteDocFile(file);
  };

  window.handleQuoteDocDrop = function (event) {
    event.preventDefault();
    event.stopPropagation();
    const zone = event.currentTarget;
    if (zone) zone.classList.remove("quote-doc-drop-active");

    const transfer = event.dataTransfer;
    const files = transfer && transfer.files ? Array.from(transfer.files) : [];
    if (files.length !== 1) {
      Swal.fire(i18n("msg_warning"), i18n("quote_doc_drop_one_file", "Drop one PDF or image file at a time."), "warning");
      return;
    }
    uploadQuoteDocFile(files[0]);
  };

  function wireQuoteDocDropzone() {
    const zone = document.getElementById("quoteEditDocDropzone");
    if (!zone || zone._quoteDocDropBound) return;
    zone._quoteDocDropBound = true;
    zone.addEventListener("dragenter", function (event) {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.add("quote-doc-drop-active");
    });
    zone.addEventListener("dragover", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      zone.classList.add("quote-doc-drop-active");
    });
    zone.addEventListener("dragleave", function (event) {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove("quote-doc-drop-active");
    });
    zone.addEventListener("drop", window.handleQuoteDocDrop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireQuoteDocDropzone, { once: true });
  } else {
    wireQuoteDocDropzone();
  }

  // Clears the bulk Quote No / document toolbar and unticks the rows, leaving it
  // ready for the next quote file. Called after every successful save.
  window.resetQuoteDocToolbar = function () {
    const meta = window._editingQuote;
    if (meta) meta.quotedDoc = { url: "", fileName: "" };
    const noInput = document.getElementById("quoteEditSupplierNo");
    if (noInput) {
      noInput.value = "";
      noInput.classList.remove("is-invalid");
    }
    const statusEl = document.getElementById("quoteEditDocStatus");
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-muted">${escHtml_(i18n("quote_doc_ready_next", "Ready for the next quote file"))}</span>`;
    }
    const tbody = document.getElementById("quoteEditBody");
    if (tbody && typeof window.updateSelectAllState === "function") {
      Array.from(tbody.querySelectorAll(".edit-item-select")).forEach((cb) => {
        cb.checked = false;
        const tr = cb.closest("tr");
        if (tr) tr.classList.remove("table-active");
      });
      window.updateSelectAllState(tbody);
    }
  };

  window.removeQuoteDoc = function () {
    const meta = window._editingQuote;
    if (meta) meta.quotedDoc = { url: "", fileName: "" };
    const statusEl = document.getElementById("quoteEditDocStatus");
    if (statusEl) statusEl.innerHTML = `<span class="text-danger">${i18n('msg_doc_removed')}</span>`;
    if (typeof window.updateQuoteDocPreviews === "function") window.updateQuoteDocPreviews();
  };

  // Per-line document upload. The line keeps its OWN document, so a supplier that
  // quotes the items across several files ends up with one document per line - the
  // bulk toolbar is only for when a single file covers a whole ticked batch.
  window.pickQuoteRowDoc = function (rowIndex) {
    const input = document.getElementById("quoteEditRowDocFile");
    if (!input) return;
    input.dataset.row = String(rowIndex == null ? "" : rowIndex);
    input.value = "";
    input.click();
  };

  window.handleQuoteRowDocFile = function (input) {
    const file = input && input.files && input.files[0];
    const rowIndex = input ? input.dataset.row : "";
    if (input) input.value = "";
    if (!file) return;
    const tbody = document.getElementById("quoteEditBody");
    if (!tbody) return;
    const tr = tbody.querySelector(`tr[data-row="${rowIndex}"]`);
    if (!tr) return;
    uploadQuoteDocFile(file, tr);
  };

  window.saveEditedQuote = function () {
    // Re-entrancy guard: ignore repeated clicks while a save is already in flight.
    if (window._quoteEditSaving) return;
    const meta = window._editingQuote;
    if (!meta) {
      console.error("No quote being edited");
      Swal.fire(i18n("msg_error"), i18n("msg_no_data"), "error");
      return;
    }
    // 🕐 Belt & braces: a second save of a quote whose previous background save
    // has not finished yet is refused before anything is locked or sent. The
    // modal should not even be open in that state (openEditQuote guards it), but
    // a stale DOM / re-entry must never reach the server either.
    if (isQuoteSavePending(quoteSaveKeyOf(meta))) {
      showQuoteSavingWarning_();
      return;
    }
    const tbody = document.getElementById("quoteEditBody");
    if (!tbody) {
      console.error("quoteEditBody not found");
      Swal.fire(i18n("msg_error"), i18n("msg_sys_error"), "error");
      return;
    }
    const rows = Array.from(tbody.querySelectorAll("tr"));
    console.log(`Saving ${rows.length} items for quote`, meta);

    // ---- Validations (run before anything is locked or sent) ----

    // The Supplier Quote No. is no longer a single obligatory toolbar value: it is
    // per line (or bulk-filled onto the ticked rows). So instead of blocking the
    // save, verify the bulk toolbar is not being used with an EMPTY selection -
    // that combination is a silent no-op and the most likely mistake.
    const quoteNoInputEl = document.getElementById("quoteEditSupplierNo");
    const quoteNoVal = String(quoteNoInputEl?.value || "").trim();
    const bulkDocUrl = String(meta.quotedDoc?.url || "").trim();
    const selectedCount = tbody.querySelectorAll(".edit-item-select:checked").length;
    if ((quoteNoVal || bulkDocUrl) && selectedCount === 0) {
      if (quoteNoInputEl) {
        quoteNoInputEl.classList.add("is-invalid");
        quoteNoInputEl.focus();
      }
      Swal.fire(
        i18n("msg_warning"),
        i18n("quote_doc_no_selection", "Tick the lines this quote no. / document applies to. Nothing was selected, so it would not be applied to any line."),
        "warning"
      );
      return;
    }
    if (quoteNoInputEl) quoteNoInputEl.classList.remove("is-invalid");

    // Lock the Save button with a spinner while the server call is in flight so
    // the user sees progress and cannot fire duplicate saves.
    const saveBtn = document.getElementById("btnSaveEditedQuote");
    const saveBtnOriginalHtml = saveBtn ? saveBtn.innerHTML : "";
    const restoreSaveBtn = function () {
      window._quoteEditSaving = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = saveBtnOriginalHtml;
      }
    };
    window._quoteEditSaving = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> ' + i18n("draft_saving");
    }
    const items = rows.map((tr, idx) => {
      const geoEl = tr.querySelector(".edit-geo-label");

      const status = normalizeQuoteItemStatus(tr.querySelector(".edit-status")?.value);
      const origGeo = geoEl?.dataset.origGeo || "";
      const origPn = tr.querySelector(".edit-pn")?.dataset.origPn || "";
      const currentGeo = geoEl?.innerText || "";
      const currentPn = tr.querySelector(".edit-pn")?.value || "";

      // Get receivedQty (editable field) - this is what USER changes
      const receivedQtyInput = tr.querySelector(".edit-received-qty");
      const fieldVisible = receivedQtyInput && !receivedQtyInput.disabled;
      // When the field is hidden (receiving window not open), OMIT receivedQty entirely
      // (undefined) so the server preserves whatever is already stored. Never force 0.
      const receivedQtyValue = fieldVisible
        ? (Number(receivedQtyInput.value) || 0)
        : undefined;
      // The payload "qty" is the server's QUOTED quantity ("Cant."), which is now
      // frozen the moment a line is approved. While the line is still pre-approval
      // it also doubles as the figure being approved, and once the receiving window
      // is open it follows the received field (existing behaviour). The server
      // ignores it entirely for a frozen line, so echoing the stored value back is
      // safe.
      const qtyInput = tr.querySelector(".edit-qty");
      const approvedQtyInput = tr.querySelector(".edit-approved-qty");
      const sentQtyValue = fieldVisible
        ? (Number(receivedQtyInput.value) || 0)
        : (qtyInput && !qtyInput.disabled
            ? (Number(qtyInput.value) || 0)
            : (Number(tr.dataset.origSent) || 0));

      // 🔒 APPROVED QTY ("Cant. Aprobado"). Sent only when the row actually carries
      // an editable approved figure: `undefined` tells the server to keep the
      // stored stamp (or, at approval time, to stamp whatever `qty` carries).
      const approvedQtyValue = (approvedQtyInput && !approvedQtyInput.disabled)
        ? (Number(approvedQtyInput.value) || 0)
        : undefined;

      console.log(`Item ${idx}:`, { origGeo, origPn, currentGeo, currentPn, status });

      // Supplier quote no + quoted doc are PER LINE. The bulk toolbar only fills the
      // TICKED rows, so a supplier that quotes part of the items in COT-001 and the
      // rest in COT-002 keeps each line's own document instead of the last upload
      // stamping over every Quoted+ line.
      const quotedOrLater = isQuotedOrLaterStatus(status);
      const toolbarNo = String(document.getElementById("quoteEditSupplierNo")?.value || "").trim();
      const rowSelected = !!tr.querySelector(".edit-item-select")?.checked;

      // The row's own Quote No input always wins: it is seeded from the stored
      // value, so it reflects the line whether or not the row is ticked.
      const rowNoEl = tr.querySelector(".edit-quote-no");
      const rowNo = rowNoEl && !rowNoEl.disabled ? String(rowNoEl.value || "").trim() : "";
      const savedNo = String(tr.dataset.savedQuoteNo || "").trim();
      let supplierQuoteNo;
      if (!quotedOrLater) {
        supplierQuoteNo = undefined;                  // preserve whatever is stored
      } else if (rowNo) {
        supplierQuoteNo = rowNo;                      // per-line input wins
      } else if (rowSelected && toolbarNo) {
        supplierQuoteNo = toolbarNo;                  // bulk fill, ticked rows only
      } else {
        supplierQuoteNo = savedNo || undefined;
      }

      // Document precedence: per-line pending upload > (ticked ? bulk upload) > stored.
      // An explicit per-line clear wins over everything and is flagged so the server
      // blanks the cell instead of preserving it.
      const clearedDoc = tr.dataset.clearDoc === "1";
      const pendingDoc = String(tr.dataset.pendingDoc || "").trim();
      const bulkDoc = rowSelected ? (window._editingQuote?.quotedDoc?.url || "").trim() : "";
      const savedDoc = String(tr.dataset.savedDocUrl || "").trim();
      let quotedDocUrl;
      let clearQuotedDoc = false;
      if (!quotedOrLater) {
        quotedDocUrl = undefined;
      } else if (clearedDoc) {
        quotedDocUrl = "";
        clearQuotedDoc = true;
      } else if (pendingDoc) {
        quotedDocUrl = pendingDoc;
      } else if (bulkDoc) {
        quotedDocUrl = bulkDoc;
      } else {
        quotedDocUrl = savedDoc || undefined;
      }

      const currencyVal = String(tr.querySelector(".edit-currency")?.value || "").trim();
      const exchangeRaw = String(tr.querySelector(".edit-exchange")?.value || "").trim();

      // 💰 QUOTE-LEVEL commercials: ONE discount % + ONE transport for the whole
      // quote, read from the bar (not from any row). `undefined` means "server
      // keeps the stored value", so simply opening and saving a quote can never
      // wipe commercials it never touched:
      //   - USER role: bar is disabled -> never sent (server would lock them);
      //   - blank bar on a quote that already held a figure -> 0 (cleared);
      //   - blank bar that was already blank -> undefined (nothing to change).
      // Every row carries the SAME discount %; the SAME freight is replicated
      // on every row for auditability but counted once (carrier row only).
      const discountBarEl = document.getElementById("quoteEditDiscount");
      const freightBarEl = document.getElementById("quoteEditFreight");
      const quoteDiscountRaw = (discountBarEl && !discountBarEl.disabled)
        ? String(discountBarEl.value || "").trim() : null;
      const quoteFreightRaw = (freightBarEl && !freightBarEl.disabled)
        ? String(freightBarEl.value || "").trim() : null;
      // Original commercials of this quote: prefer the snapshot taken when the
      // modal opened (meta), falling back to the module-level editRows so an
      // interrupted/stale open can never throw while building the payload.
      const origRows = Array.isArray(editRows) && editRows.length ? editRows : [];
      const quoteOrigDiscount = (meta.origDiscountPct !== undefined && meta.origDiscountPct !== null)
        ? (Number(meta.origDiscountPct) || 0)
        : origRows.reduce(
            (found, it) => (found > 0 ? found : normalizeQuoteDiscountPct(it.discountPct)), 0);
      const quoteOrigFreight = (meta.origFreight !== undefined && meta.origFreight !== null)
        ? (Number(meta.origFreight) || 0)
        : origRows.reduce(
            (found, it) => (found > 0 ? found : normalizeQuoteFreight(it.freight)), 0);
      const quoteDiscountValue = quoteDiscountRaw === null ? undefined
        : (quoteDiscountRaw !== "" ? normalizeQuoteDiscountPct(quoteDiscountRaw)
          : (quoteOrigDiscount !== 0 ? 0 : undefined));
      const quoteFreightValue = quoteFreightRaw === null ? undefined
        : (quoteFreightRaw !== "" ? normalizeQuoteFreight(quoteFreightRaw)
          : (quoteOrigFreight !== 0 ? 0 : undefined));

      return {
        orderId: meta.orderId,
        quoteId: (tr.dataset.quoteId !== undefined ? tr.dataset.quoteId : (meta.quoteId || "")),
        origGeo: origGeo,

        deleted: status === "Deleted",
        status: status,
        geo: currentGeo,
        pn: currentPn,
        origPn: origPn,
        es: tr.querySelector(".edit-desc")?.value || "",

        // Per-line values. undefined = "server keeps what it has stored".
        supplierQuoteNo: supplierQuoteNo,
        quotedDocUrl: quotedDocUrl,
        clearQuotedDoc: clearQuotedDoc,

        // Use receivedQty as the primary quantity field for USER editing
        qty: sentQtyValue,
        receivedQty: receivedQtyValue,
        // 🔒 Quoted and approved are separate figures from here on.
        approvedQty: approvedQtyValue,

        // Category / Sub Category are no longer editable in this modal (their
        // cells were removed). Echo the values the row was rendered with so the
        // server rewrites the stored Quote row identically; `undefined` tells it
        // to leave the stored cell untouched.
        category: tr.dataset.origCat || undefined,
        subCategory: tr.dataset.origSub || undefined,
        price: Number(tr.querySelector(".edit-price")?.value || 0),
        total: Number(tr.querySelector(".edit-total")?.value || 0),
        // 💰 Quote-level commercials. The SAME discount % travels on every row;
        // the SAME freight is replicated on every row but counted once
        // (carrier row only, server-side).
        discountPct: quoteDiscountValue,
        freight: quoteFreightValue,
        // Currency / exchange rate (metadata only). Currency always has a selection;
        // exchangeRate is undefined when blank so the server preserves a stored value.
        currency: currencyVal || undefined,
        exchangeRate: exchangeRaw === "" ? undefined : (Number(exchangeRaw) || 0),
      };
    });
    // 1) Range validation for the commercials. The server enforces the same rules
    //    with [RECON LOCK] and aborts the whole save, so catch a typo here first
    //    and point at the exact quote bar instead of failing the entire quote remotely.
    const badCommercials = [];
    const dBarV = document.getElementById("quoteEditDiscount");
    const fBarV = document.getElementById("quoteEditFreight");
    const rawDiscount = (dBarV && !dBarV.disabled) ? String(dBarV.value || "").trim() : "";
    const rawFreight = (fBarV && !fBarV.disabled) ? String(fBarV.value || "").trim() : "";
    const numDiscount = rawDiscount === "" ? null : Number(rawDiscount.replace(/[%\s,]/g, "").replace(",", "."));
    const numFreight = rawFreight === "" ? null : Number(rawFreight.replace(/[\s,]/g, "").replace(",", "."));
    if (numDiscount !== null && (!isFinite(numDiscount) || isNaN(numDiscount) || numDiscount < 0 || numDiscount > MAX_QUOTE_DISCOUNT_PCT)) {
      badCommercials.push(i18n("lbl_discount_pct", "Discount %") + ': "' + rawDiscount + '"');
    }
    if (numFreight !== null && (!isFinite(numFreight) || isNaN(numFreight) || numFreight < 0 || numFreight > MAX_QUOTE_FREIGHT)) {
      badCommercials.push(i18n("lbl_freight", "Transport") + ': "' + rawFreight + '"');
    }
    if (badCommercials.length) {
      // Release the Save button locked above: this is a pre-flight rejection, not
      // a save in flight, and a stuck spinner would force a modal reopen.
      if (typeof restoreSaveBtn === "function") restoreSaveBtn();
      Swal.fire(
        i18n("msg_warning"),
        i18n("msg_invalid_commercials", "Invalid discount or transport value. Discount must be between 0 and 100 and transport cannot be negative:") +
          "<br>" + badCommercials.map((m) => attr_(m)).join("<br>"),
        "warning"
      );
      return;
    }

    // 2) Items cannot be Quoted (or later) with a price of 0.
    const zeroPriceQuoted = items.filter(
      (it) => !it.deleted && isQuotedOrLaterStatus(it.status) && Number(it.price || 0) <= 0
    );
    if (zeroPriceQuoted.length > 0) {
      const offending = zeroPriceQuoted
        .map((it) => attr_(`${it.es || it.pn || "?"} (GEO ${it.geo || "?"})`))
        .join("<br>");
      if (typeof restoreSaveBtn === "function") restoreSaveBtn();
      Swal.fire(
        i18n("msg_warning"),
        i18n("msg_price_zero_cannot_quote", "Items with a price of 0 cannot be marked as Quoted. Enter a price for:") + "<br>" + offending,
        "warning"
      );
      return;
    }

    // 2) HARD BLOCK: a line saved as Quoted MUST carry BOTH the Supplier Quote
    // No. and the supplier quotation PDF. The PDF is only ever uploaded at the
    // moment a line becomes Quoted, so one without the other is rejected.
    // Effective values use the same precedence as the payload below (per-line >
    // ticked bulk > stored; an explicit per-line clear counts as missing).
    {
      const missingProof = rows
        .map((tr) => {
          const sel = tr.querySelector(".edit-status");
          const status = normalizeQuoteItemStatus(sel ? sel.value : "");
          if (status !== "Quoted") return null;
          const noEl = tr.querySelector(".edit-quote-no");
          const rowNo = noEl && !noEl.disabled ? String(noEl.value || "").trim() : "";
          const selected = !!tr.querySelector(".edit-item-select")?.checked;
          const effNo = rowNo || (selected ? quoteNoVal : String(tr.dataset.savedQuoteNo || "").trim());
          const cleared = tr.dataset.clearDoc === "1";
          const effDoc = cleared
            ? ""
            : (String(tr.dataset.pendingDoc || "").trim() ||
               (selected ? bulkDocUrl : "") ||
               String(tr.dataset.savedDocUrl || "").trim());
          const missingNo = !effNo;
          const missingDoc = !effDoc || !/^https?:\/\//i.test(effDoc);
          if (!missingNo && !missingDoc) return null;
          const geoEl = tr.querySelector(".edit-geo-label");
          const descEl = tr.querySelector(".edit-desc");
          const label = `${descEl?.value || tr.querySelector(".edit-pn")?.value || "?"} (GEO ${geoEl?.innerText || "?"})`;
          // Highlight the offending cells in place so the user sees what to fix.
          if (missingNo && noEl) noEl.classList.add("is-invalid");
          if (missingDoc) {
            const docCell = tr.querySelector(".edit-doc-cell");
            if (docCell) docCell.style.outline = "2px solid #dc3545";
          }
          return { label, missingNo, missingDoc };
        })
        .filter(Boolean);
      if (missingProof.length) {
        if (typeof restoreSaveBtn === "function") restoreSaveBtn();
        const lines = missingProof
          .map((m) => {
            const what = m.missingNo && m.missingDoc
              ? i18n("msg_quoted_missing_both", "missing Quote No. + document")
              : m.missingNo
                ? i18n("msg_quoted_missing_no", "missing Quote No.")
                : i18n("msg_quoted_missing_doc", "missing document");
            return `${attr_(m.label)} — ${attr_(what)}`;
          })
          .join("<br>");
        Swal.fire(
          i18n("msg_warning"),
          i18n("msg_quoted_requires_no_and_doc", "Lines saved as Quoted require a Supplier Quote No. AND the quotation document:") + "<br>" + lines,
          "warning"
        );
        return;
      }
    }

    const newStatus = "Pending";
    console.log("Calling updateQuoteWithItems with items:", items);

    const payload = {

      orderId: meta.orderId,
      quoteId: meta.quoteId,
      supplier: meta.supplier,
      category: meta.category,
      items: items,
      status: newStatus,
      currentUserEmail: (() => {
        try {
          const userStr = localStorage.getItem('recon_user_secure');
          if (userStr && userStr !== '') {
            return JSON.parse(userStr).email;
          }
          return window.currentUser?.email || '';
        } catch (e) {
          console.warn('Failed to get user email:', e);
          return '';
        }
      })()
    }

    // ===== SAVE: fire-and-forget (background) =====
    // The slow part (PDF + notification email + stock) runs server-side while
    // this call returns: the modal closes right away, the floating bubble
    // (bottom-right) shows live progress, and the user can move on to the next
    // quote. Falls back to the original synchronous call when the bubble is
    // not available (standalone / legacy pages).
    var __useBg = !!(window.BgJobs && window.bgFireAndForget);
    if (__useBg) {
      var __userEmail = '';
      try {
        var __ust = localStorage.getItem('recon_user_secure');
        if (__ust && __ust !== '') { var __u = JSON.parse(__ust); __userEmail = __u.email; }
        else { __userEmail = window.currentUser?.email || ''; }
      } catch (e) { __userEmail = ''; }
      // 🕐 LOCK: grey this card and refuse re-edits from the moment the save is
      // fired until the job reports DONE/ERROR (released in onDone below, and on
      // an enqueue failure so a failed start can never leave the card stuck).
      var __pendingKey = quoteSaveKeyOf(meta);
      markQuoteSavePending(__pendingKey);
      refreshQuoteCards_();
      window.bgFireAndForget({
        fn: "updateQuoteWithItems",
        args: [payload],
        kind: "QUOTE",
        refId: payload.quoteId || '',
        title: "Quote " + (payload.quoteId || payload.orderId || ''),
        userEmail: __userEmail,
        onDone: function (job) {
          try {
            if (job.status === "DONE") {
              syncQuoteCachesAfterSave(meta, items, job.pdfUrl || "");
              if (window.Swal) Swal.fire(i18n('msg_success'), i18n('status_saved') + " " + i18n('msg_quote_updated'), "success");
            } else if (window.Swal) {
              Swal.fire(i18n('btn_error'), String(job.error || job.step || "Background job failed") + " — " + i18n('msg_refresh_hint', "Refresh the list to see the latest data."), "error");
            }
          } catch (e) {}
          // Release the card lock LAST: an errored job must unlock too, or the
          // quote would stay greyed (and uneditable) forever.
          clearQuoteSavePending(__pendingKey);
          refreshQuoteCards_();
        }
      }).then(function (fired) {
        // Enqueue + launch round-trip finished. On success the UI is freed NOW
        // (modal closes; the bubble keeps reporting progress). On failure keep
        // the modal open and restore the Save button so the user can retry.
        restoreSaveBtn();
        if (!fired || !fired.ok || !fired.jobId) {
          // Nothing is running server-side: release the lock immediately.
          clearQuoteSavePending(__pendingKey);
          refreshQuoteCards_();
          if (window.Swal) Swal.fire(i18n('btn_error'), i18n('lbl_server_error') + ": could not start the background save.", "error");
          return;
        }
        // Hand the job id to the lock so it can self-heal if the job record
        // disappears (bubble card closed) - see isQuoteSavePending.
        setQuoteSaveJobId(__pendingKey, fired.jobId);
        var editModalEl = document.getElementById("quoteEditModal");
        var detailsModalEl = document.getElementById("quoteDetailsModal");
        if (editModalEl) bootstrap.Modal.getOrCreateInstance(editModalEl).hide();
        if (detailsModalEl) bootstrap.Modal.getOrCreateInstance(detailsModalEl).hide();
        if (window.resetQuoteDocToolbar) window.resetQuoteDocToolbar();
      });
      return;
    }

    google.script.run
      .withSuccessHandler(function (response) {
        const newPdfUrl = response ? response.pdfUrl : "";
        syncQuoteCachesAfterSave(meta, items, newPdfUrl);
        restoreSaveBtn();
        var editModalEl = document.getElementById("quoteEditModal");
        var detailsModalEl = document.getElementById("quoteDetailsModal");
        if (editModalEl) bootstrap.Modal.getOrCreateInstance(editModalEl).hide();
        if (detailsModalEl) bootstrap.Modal.getOrCreateInstance(detailsModalEl).hide();
        if (window.resetQuoteDocToolbar) window.resetQuoteDocToolbar();
        if (window.Swal) Swal.fire(i18n('msg_success'), `${i18n('status_saved')} ${i18n('msg_quote_updated')}`, "success");
      })
      .withFailureHandler(function (err) {
        console.error(`${i18n('lbl_server_error')}:`, err);
        restoreSaveBtn();
        if (window.Swal) Swal.fire(i18n('btn_error'), String(err), "error");
      })
      .updateQuoteWithItems(payload);
  };

  // "+" deep-links into the RFQ module with this requirement preselected, so
  // the additional quote is created through the normal RFQ flow (supplier
  // chips, email preview, sendFinalRFQ) — same qty, new supplier.
  window.openAddQuoteToReq = function (orderId) {
    // 🕐 GUARD: refuse while any card of this requirement is still saving in the
    // background — the new quote would be built on top of a half-written sheet.
    if ((visibleQuoteGroups || []).some((g) =>
        String(g.orderId || "").trim() === String(orderId || "").trim() &&
        isQuoteSavePending(quoteSaveKeyOf(g)))) {
      showQuoteSavingWarning_();
      return;
    }
    if (window.isQuoteUserRole()) {
      Swal.fire(i18n("msg_warning"), i18n("quote_add_not_allowed", "Your role cannot add quotes."), "warning");
      return;
    }
    const ref = String(orderId || "").trim();
    if (ref.indexOf("+") !== -1) {
      // Consolidated requirement header ("A+B"): pre-select every source req
      window._rfqPreselectOrderIds = ref.split("+").map((id) => id.trim()).filter(Boolean);
      window._rfqPreselectOrderId = "";
    } else {
      window._rfqPreselectOrderId = ref;
      window._rfqPreselectOrderIds = "";
    }
    if (typeof window.loadModule === "function") {
      window.loadModule("RFQ");
    } else {
      const link = document.querySelector('.nav-link[onclick*="RFQ"]');
      if (link) {
        link.click();
      } else {
        window._rfqPreselectOrderId = "";
        Swal.fire(i18n("msg_warning"), i18n("rfq_nav_failed", "Could not open the RFQ module. Open it from the menu and select the requirement."), "warning");
      }
    }
  };

  // ===== QUOTE PRICE COMPARISON & APPROVAL =====
  window._quoteCompareCtx = null;

  // Stable key per item (geo, fallback pn/p). Items without geo/pn share a bucket.
  window.quoteCompareKeyOf = function (it) {
    const k = String(it.geo || it.pn || it.p || "").trim().toLowerCase();
    return k || "geo-empty";
  };

  window.openCompareQuotes = function (orderId) {
    const oid = String(orderId || "").trim();
    if (!oid) return;
    // 🕐 GUARD: the compare matrix is built from the card list, so a quote of
    // this requirement that is still saving in the background must be waited for
    // (a half-written sheet would show prices/quantities mid-update).
    if ((visibleQuoteGroups || []).some((g) =>
        String(g.orderId || "").trim() === oid &&
        isQuoteSavePending(quoteSaveKeyOf(g)))) {
      showQuoteSavingWarning_();
      return;
    }
    // Build the matrix from the UNFILTERED row cache (allQuotesRaw) instead of the
    // on-screen cards. A Site/Status/Supplier filter used to remove whole suppliers
    // from this table, so an already-approved item looked single-supplier and the
    // competing quotes that still need deleting were invisible (and un-repairable).
    // allQuotesRaw is still User-role category-scoped upstream (loadQuoteData).
    const reqRows = (Array.isArray(allQuotesRaw) ? allQuotesRaw : []).filter(
      (it) => String(it.orderId || "").trim() === oid
    );
    const groups = buildQuoteGroups(reqRows).filter(
      (g) => Array.isArray(g.items) && g.items.length
    );
    if (groups.length === 0) {
      Swal.fire(i18n("msg_warning"), i18n("msg_no_quotes_found"), "warning");
      return;
    }

    // Stable key per item (geo, fallback pn/p). Items without geo/pn share a bucket.
    const keyOf = window.quoteCompareKeyOf;

    // Union of items across all quotes of this requirement. Deliberately
    // status-blind (every row contributes a key, including Deleted): a price
    // must never disappear from this table just because some row moved to
    // Approved/Sent/Received/... or was marked Deleted. Rows that are Deleted
    // everywhere still render (all-red), so an auditor can always see who
    // quoted what.
    const itemUnion = [];
    const seenKeys = {};
    groups.forEach((g) => {
      (g.items || []).forEach((it) => {
        const key = keyOf(it);
        if (seenKeys[key]) {
          const target = itemUnion.filter(function(u) { return u.key === key; })[0];
          if (target) {
            const existing = target.reqItemNotes || [];
            (it.reqItemNotes || []).forEach(function(n) {
              if (n && String(n.notes || '').trim() && !existing.some(function(e) {
                return String(e.ref) === String(n.ref) && String(e.notes) === String(n.notes);
              })) existing.push({ ref: String(n.ref || ''), notes: String(n.notes || '') });
            });
            target.reqItemNotes = existing;
          }
          return;
        }
        seenKeys[key] = true;
        itemUnion.push({
          key,
          geo: it.geo || "",
          pn: it.pn || it.p || "",
          desc: it.es || it.desc || "",
          qty: Number(it.cant || it.qty || 0) || 0,
          reqItemNotes: (it.reqItemNotes || []).map(function(n) { return { ref: String(n.ref || ''), notes: String(n.notes || '') }; }),
        });
      });
    });

    // One entry per supplier quote, with a geo-keyed price matrix.
    // Within ONE supplier, category-split groups (same supplier quoted the
    // same requirement under two categories) are merged into a single column:
    // otherwise each column would show "-" for the other category's items and
    // quoted prices would look missing. Freight keeps its own (per quoteId)
    // value so a merged column shows every transport once in the header.
    const mergedBySupplier = {};
    groups.forEach((g) => {
      const gkey = [String(g.orderId || oid).trim().toLowerCase(),
        String(g.supplier || "").trim().toLowerCase()].join("|");
      if (!mergedBySupplier[gkey]) mergedBySupplier[gkey] = [];
      mergedBySupplier[gkey].push(g);
    });
    const suppliers = Object.keys(mergedBySupplier).map((gkey) => {
      const parts = mergedBySupplier[gkey];
      const g = parts[0];
      const byKey = {};
      const byKeyPn = {};
      const freightNotes = [];
      // Price matrix: built from the RAW rows so every RFQ round is considered, but
      // only the most resolved row per GEO survives in byKey. Iterates every
      // part of a merged supplier column (see above) so no quoted line of this
      // supplier is ever missing from its column.
      const itemPool = [];
      parts.forEach((part) => { (part.items || []).forEach((it) => itemPool.push({ it: it, g: part })); });
      itemPool.forEach((entry) => {
        const it = entry.it;
        const g = entry.g;
        const st = normalizeQuoteItemStatus(it.estado || it.status);
        // ⚠️ Deleted rows are KEPT here (flagged, never dropped). When one supplier
        // wins an item, every competitor's line for that item is marked as Deleted,
        // and this table exists to keep showing that price in red - exactly what
        // i18n.html has always promised ("competing quotes are shown in red and
        // marked as Deleted"). Skipping them printed a bare "-" for every losing
        // supplier the moment the page reloaded, which made a correctly-approved
        // requirement look like the other suppliers had never quoted.
        // A merged card can hold several rows for the same GEO (same supplier
        // quoted in two RFQ passes). Keep the most resolved row so the matrix
        // shows the real price/status instead of whichever row came last.
        const cellKey = keyOf(it);
        const next = {
          price: Number(it.price || 0) || 0,
          total: Number(it.total || it.lineTotal || 0) || 0,
          // 💰 Money comparison is done on the NET unit price (the quoted price
          // less the supplier's discount), because that is what the company
          // actually pays per unit. The quoted figure stays visible for audit.
          discountPct: normalizeQuoteDiscountPct(it.discountPct),
          netUnit: quoteNetUnitPrice(it.price, it.discountPct),
          status: st,
          deleted: st === "Deleted",
          // RAW GEO of this row: the P/N alias fallback may only fire when one
          // side lacks a GEO — a row keyed by a DIFFERENT GEO is another
          // requirement line (the same P/N is commonly requisitioned twice)
          // and must never resolve into this cell.
          geoKey: String(it.geo || "").trim(),
          quoteId: String(it.quoteId || g.quoteId || "").trim(),
          item: it,
        };
        // Same resolution rule as the collapsed card view (quoteLineRank): an
        // approved/priced row always wins over a superseded Pending re-send.
        // The P/N alias index is a display fallback only: when the union row
        // was keyed by GEO but this supplier's round carries the line under
        // its P/N (e.g. a blank-GEO round), the cell still resolves instead of
        // printing a bare "-".
        const cellRank = (c) => quoteLineRank({ status: c.status, price: c.price });
        const prev = byKey[cellKey];
        if (!prev || cellRank(next) >= cellRank(prev)) byKey[cellKey] = next;
        const pnAlias = String((it && (it.pn || it.p)) || "").trim().toLowerCase();
        if (pnAlias) {
          const prevPn = byKeyPn[pnAlias];
          if (!prevPn || cellRank(next) >= cellRank(prevPn)) byKeyPn[pnAlias] = next;
        }
      });
      // Selectability follows the VISIBLE (collapsed) lines: a superseded Pending
      // re-send must not block approving a supplier whose live line is quoted.
      // "Not Quoted" lines are ignorable by design: the supplier never priced
      // them, so they must not hold the rest of the quote hostage.
      let activeCount = 0, allQuoted = true;
      parts.forEach((part) => {
      quoteCardRows(part).forEach((it) => {
        const st = normalizeQuoteItemStatus(it.estado || it.status);
        if (st === "Deleted" || st === "Not Quoted") return;
        activeCount++;
        if (st !== "Quoted" && st !== "Approved") allQuoted = false;
      });
      });
      // Merged supplier identity: one representative Quote ID (newest wins, like
      // buildQuoteGroups), all categories/docs/transport collected across parts.
      let mergedQuoteId = "";
      const mergedReqPdfUrls = [];
      const docUrlsAll = [];
      let mainPdf = "";
      let quoteNoTip = "";
      parts.forEach((part) => {
        const partFreight = quoteMoneySummary(part.items || []).freight;
        if (Number(partFreight || 0) > 0) {
          const label = String(part.quoteId || part.category || "").trim();
          if (!freightNotes.some(function (f) { return f.value === partFreight && f.label === label; })) {
            freightNotes.push({ value: partFreight, label: label });
          }
        }
        mergedQuoteId = quoteGroupQuoteId({ quoteId: part.quoteId }, mergedQuoteId);
        (Array.isArray(part.reqPdfUrls) ? part.reqPdfUrls : []).forEach(function (p) {
          const url = String((p && p.url) || "").trim();
          if (!url) return;
          if (!mergedReqPdfUrls.some(function (e) { return e.url === url; })) {
            mergedReqPdfUrls.push({ ref: String((p && p.ref) || "").trim(), url: url });
          }
        });
        const link = String((part && part.link) || "").trim();
        if (link && !mainPdf) mainPdf = link;
        (Array.isArray(part.items) ? part.items : []).forEach(function (dit) {
          const qn = String(dit.supplierQuoteNo || "").trim();
          if (qn && !quoteNoTip) quoteNoTip = qn;
          const u = String(dit.quotedDocUrl || "").trim();
          if (u && docUrlsAll.indexOf(u) === -1) docUrlsAll.push(u);
        });
      });
      const mergedGroup = {
        orderId: g.orderId || oid,
        quoteId: mergedQuoteId,
        supplier: g.supplier || "",
        category: parts.map((p) => String(p.category || "").trim()).filter(Boolean).join(" / ") || g.category || "",
        subCategory: parts.map((p) => String(p.subCategory || "").trim()).filter(Boolean).join(" / "),
        site: g.site || "",
        link: mainPdf,
        date: g.date || "",
        reqPdfUrls: mergedReqPdfUrls,
        items: parts.reduce((acc, p) => acc.concat(p.items || []), []),
        displayItems: parts.reduce((acc, p) => acc.concat(quoteCardRows(p)), []),
      };
      const allItemsFlat = mergedGroup.items;
      return {
        orderId: g.orderId || oid,
        quoteId: mergedQuoteId,
        supplier: g.supplier || "",
        category: mergedGroup.category,
        group: mergedGroup,
        byKey: byKey,
        byKeyPn: byKeyPn,
        selectable: activeCount > 0 && allQuoted,
        domStatus: quoteGroupDominantStatus(allItemsFlat),
        // 💰 One transport charge per supplier quote (the carrier line's value).
        // It is quote-level, so the header can show it once and the row prices
        // stay comparable without it folded in. quoteMoneySummary already
        // counts the freight exactly once (carrier row only) - there is no
        // separate "quoteFreightSummary" helper.
        // Merged column: keep every part's transport, each printed once.
        freight: quoteMoneySummary(allItemsFlat).freight,
        freightNotes: freightNotes,
        mainPdf: mainPdf,
        docUrlsAll: docUrlsAll,
        quoteNoTip: quoteNoTip,
      };
    });

    // Status-agnostic cell lookup, shared by the matrix renderer, the
    // best-price scan below, the winner lock and the "All" shortcut: exact
    // GEO key first, then the supplier's P/N alias index (blank-GEO rounds),
    // so a quoted line never renders a bare "-" for a key-normalization
    // mismatch. Defined here, before its first consumer above runs.
    window.quoteCompareCellFor = function (supplier, unionRow) {
      if (!supplier || !unionRow) return null;
      const cellMap = supplier.byKey || {};
      const exact = cellMap[unionRow.key];
      if (exact) return exact;
      const aliasMap = supplier.byKeyPn || {};
      const pnAlias = String((unionRow && (unionRow.pn || unionRow.p)) || "").trim().toLowerCase();
      const cand = pnAlias ? aliasMap[pnAlias] : null;
      if (!cand) return null;
      // Cross-line guard: identical P/Ns on different GEOs are DIFFERENT
      // requirement lines. The P/N alias may only stand in for a side that has
      // no GEO of its own (blank-GEO round vs GEO-keyed union row, or vice
      // versa). When both sides carry a GEO and still missed the exact match,
      // the GEOs differ — never resolve.
      const candGeo = String(cand.geoKey || "").trim().toLowerCase();
      const uniGeo = String(unionRow.geo || "").trim().toLowerCase();
      if (!candGeo || !uniGeo) return cand;
      return null;
    };

    // Lowest active NET unit price per item (for the green highlight). The net
    // price already has the supplier's discount applied, so a supplier who lists
    // high and discounts is compared on what the company actually pays per unit.
    const lowest = {};
    itemUnion.forEach((iu) => {
      let best = null;
      suppliers.forEach((s) => {
        const cell = window.quoteCompareCellFor ? window.quoteCompareCellFor(s, iu) : (s.byKey[iu.key] || null);
        // A Deleted row stays visible but must never win the "best price" highlight.
        if (cell && !cell.deleted && cell.price > 0 && (best === null || cell.netUnit < best)) best = cell.netUnit;
      });
      lowest[iu.key] = best;
    });

    // Approved winners are locked: they remain visible for audit/comparison,
    // but cannot be selected again in a new approval pass. The lock keys on
    // APPROVED-OR-LATER, not on "Approved" exactly: once the winning line moves
    // on to Sent/Received/..., the item is still resolved and must stay locked,
    // otherwise the manager could approve a second supplier for the same item.
    // Resolved per UNION row through quoteCompareCellFor so a winner that only
    // matches via the P/N alias still locks its item.
    const approvedByItem = {};
    itemUnion.forEach((iu) => {
      for (let si = 0; si < suppliers.length; si++) {
        const byKeyCell = window.quoteCompareCellFor(suppliers[si], iu);
        // Only a LIVE approved-or-later row can be a winner: a Deleted one must
        // not lock the item (that would freeze the row against re-approval
        // forever).
        if (byKeyCell && !byKeyCell.deleted && APPROVED_OR_LATER_STATUSES.indexOf(byKeyCell.status) !== -1) {
          approvedByItem[iu.key] = si;
          break;
        }
      }
    });

    const ctx = { orderId: oid, suppliers, itemUnion, selection: {}, approvedByItem };
    window._quoteCompareCtx = ctx;

    const bodyEl = document.getElementById("quoteCompareBody");
    const titleEl = document.getElementById("quoteCompareTitle");
    const applyBtn = document.getElementById("btnApplyQuoteCompare");
    if (titleEl) titleEl.textContent = `${i18n('quote_compare_title', 'Compare Prices')} — ${i18n('lbl_req')} ${oid}`;
    if (applyBtn) {
      if (!applyBtn.dataset.defaultHtml) applyBtn.dataset.defaultHtml = applyBtn.innerHTML;
      applyBtn.disabled = true;
      applyBtn.innerHTML = applyBtn.dataset.defaultHtml;
    }
    // "Fix Deleted" (resync) is an approval-level power tool: only roles that may
    // approve get to see it (same gate as the compare icon in the quote header).
    const resyncBtn = document.getElementById("btnResyncQuoteCompare");
    if (resyncBtn) {
      const canResync = !window.isQuoteUserRole();
      resyncBtn.classList.toggle("d-none", !canResync);
      if (canResync) {
        resyncBtn.title = i18n("quote_compare_resync_title", "Scan this requirement on the server for items that are approved from one supplier while another supplier's quote lines for the same item are still active, and repair them.");
      }
    }

    const headHtml = `<tr>
        <th data-i18n="col_geo">GEO</th>
        <th data-i18n="m_pn">P/N</th>
        <th data-i18n="desc">Description</th>
        <th data-i18n="item_notes" style="min-width:140px;">Item Notes</th>
        <th class="text-center" data-i18n="col_qty">Qty</th>
        ${suppliers.map((s, si) => {
          const c = quoteStatusColor(s.domStatus);
          // Supplier quote attachments: merged group PDF (quoteLink) + per-item
          // Quoted Docs, pre-collected while the supplier column was merged
          // across categories (identical fields to the old per-group scan).
          const mainPdf = String((s.mainPdf !== undefined ? s.mainPdf : (s.group && s.group.link)) || "").trim();
          const docUrls = Array.isArray(s.docUrlsAll) ? s.docUrlsAll : [];
          ((docUrls.length || mainPdf) ? [] : ((s.group && s.group.items) || [])).forEach((dit) => {
            const u = String(dit.quotedDocUrl || "").trim();
            if (u && docUrls.indexOf(u) === -1) docUrls.push(u);
          });
          const quoteNoTip = String(s.quoteNoTip || ((s.group && s.group.items) || []).map((nit) => String(nit.supplierQuoteNo || "").trim()).filter(Boolean)[0] || "").trim();
          const docsTitle = [quoteNoTip ? (i18n('lbl_supplier_quote_no', 'Supplier Quote No.') + ": " + quoteNoTip) : "", mainPdf || "", docUrls[0] || ""].filter(Boolean).join(" | ");
          const docsHtml = (mainPdf || docUrls.length)
            ? `<div class="d-flex justify-content-center gap-1 mt-1">` +
              (mainPdf ? `<a href="${attr_(mainPdf)}" target="_blank" class="btn btn-sm btn-outline-danger py-0 px-1" title="${attr_(i18n('btn_open_pdf', 'Open PDF') + (quoteNoTip ? " — " + quoteNoTip : ""))}" onclick="event.stopPropagation()"><i class="bi bi-file-pdf"></i></a>` : "") +
              (docUrls.length ? `<a href="${attr_(docUrls[0])}" target="_blank" class="btn btn-sm btn-outline-secondary py-0 px-1" title="${attr_((i18n('lbl_quoted_doc', 'Quoted Doc') + (docUrls.length > 1 ? " (1/" + docUrls.length + ")" : "")) + (docsTitle ? " — " + docsTitle : ""))}" onclick="event.stopPropagation()"><i class="bi bi-paperclip"></i>${docUrls.length > 1 ? `<span class="ms-1" style="font-size:.65rem;">+${docUrls.length - 1}</span>` : ""}</a>` : "") +
              `</div>`
            : "";
          // 💰 Quote-level transport, printed ONCE in this supplier's column: the
          // row prices below are goods-only, so the whole transport has to be
          // visible somewhere before a winner is picked. A merged column shows
          // one line per underlying quote (labelled by its Quote ID), each
          // exactly once.
          const freightNotesList = Array.isArray(s.freightNotes) ? s.freightNotes : [];
          const freightNote = (Number(s.freight || 0) > 0 || freightNotesList.length)
            ? (freightNotesList.length
                ? freightNotesList.map(function (f) {
                    const tag = String(f.label || "").trim();
                    return `<div class="small text-info fw-semibold" title="${attr_(i18n('lbl_freight_once_hint', 'Charged once for the whole quote'))}"><i class="bi bi-truck"></i> ${attr_(i18n('lbl_freight', 'Transport'))}${tag ? " (" + attr_(tag) + ")" : ""}: ${Number(f.value).toLocaleString("en-US")}</div>`;
                  }).join("")
                : `<div class="small text-info fw-semibold" title="${attr_(i18n('lbl_freight_once_hint', 'Charged once for the whole quote'))}"><i class="bi bi-truck"></i> ${attr_(i18n('lbl_freight', 'Transport'))}: ${Number(s.freight).toLocaleString("en-US")}</div>`)
            : "";
          return `<th class="text-center"><div class="fw-bold text-truncate" style="max-width:150px;" title="${attr_(s.supplier)}">${attr_(s.supplier)}</div><span class="badge" style="background:${c.badgeBg};border:1px solid ${c.badgeBorder};color:${c.text};font-size:.65rem;">${quoteStatusLabel(s.domStatus)}</span>${s.quoteId ? `<div class="small text-muted">${attr_(s.quoteId)}</div>` : ""}${freightNote}${docsHtml}<button type="button" class="btn btn-sm btn-outline-primary mt-1 py-0 px-2" onclick="window.quoteCompareSelectAllFor(${si})" title="${attr_(i18n('quote_compare_all', 'All'))}">${attr_(i18n('quote_compare_all', 'All'))}</button></th>`;
        }).join("")}
      </tr>`;

    // 🔒 In the Qty cell below, an already-approved item is locked and must show the
    // APPROVED quantity — not the quoted one, which the split now keeps in "Cant.".
    // Reading the winner's own row also picks the right figure up when the union row
    // came from a different supplier's quote.
    const rowsHtml = itemUnion.map((iu, iIdx) => `<tr>
        <td>${attr_(iu.geo)}</td>
        <td><strong>${attr_(iu.pn)}</strong></td>
        <td>${attr_(iu.desc)}</td>
        <td style="min-width:140px;">${quoteReqNotesHtml(iu)}</td>
        <td class="text-center">
        ${(() => {
          const winnerIdx = approvedByItem[iu.key];
          const winnerCell = winnerIdx !== undefined ? window.quoteCompareCellFor(suppliers[winnerIdx], iu) : null;
          const shownQty = winnerCell
            ? quoteLineQtys(winnerCell.item).approved
            : iu.qty;
          const hint = winnerCell
            ? i18n('lbl_approved_qty_hint', 'Qty the manager approved')
            : i18n('quote_compare_qty_hint', 'Qty saved with the approved item');
          return `<input type="number" min="0" step="1" class="form-control form-control-sm cmp-item-qty text-center" data-iidx="${iIdx}" value="${shownQty}"${winnerIdx !== undefined ? ' readonly' : ''} title="${attr_(hint)}">`;
        })()}
        ${suppliers.map((s, si) => {
          const cell = window.quoteCompareCellFor(s, iu);
          if (!cell) return `<td class="text-center text-muted">&mdash;</td>`;
          // Deleted competitors are listed (their price stays visible in red) but
          // they are never a candidate for the green "best price" highlight.
          // Cells for a supplier the user marked "Not Quoted" are likewise
          // shown (status grey, never selectable) instead of hidden: the
          // approver asked to SEE that they were ignored, not to lose the row.
          const isDeletedCell = !!cell.deleted;
          const isBest = !isDeletedCell && lowest[iu.key] !== null && cell.price > 0 && cell.netUnit === lowest[iu.key];
          // Per-item winner selection: exactly one supplier per item row.
          // Status flow: Pending cells can't be approved (must be Quoted first);
          // cells beyond Approved can't be selected either (no going backwards).
          // A quote with a price of 0 is not a valid quote — not selectable.
          const priceOk = cell.price > 0;
          const hasApprovedWinner = approvedByItem[iu.key] !== undefined;
          const isApprovedWinner = hasApprovedWinner && approvedByItem[iu.key] === si;
          const isRejectedAfterApproval = hasApprovedWinner && !isApprovedWinner;
          const canPick = !hasApprovedWinner && cell.status === "Quoted" && priceOk;
          // Four cell states:
          //   1. approved winner  -> locked, green, price stays visible
          //   2. competing quote  -> locked, red, price stays visible. The row may
          //      already be Deleted (repaired) or still alive (unbalanced) - see
          //      resyncQuoteCompare for the alive ones.
          //   3. already Deleted  -> locked, red, price stays visible: a lost quote is
          //      a lost quote whether or not the row was flagged yet
          //   4. unresolved       -> standard rules (Quoted only, price > 0)
          const isAutoDeletableCompetitor = isRejectedAfterApproval &&
            COMPETITOR_AUTO_DELETE_STATUSES.indexOf(cell.status) !== -1;
          const competitorHint = isAutoDeletableCompetitor
            ? i18n("quote_compare_todelete", "will be Deleted")
            : i18n("quote_compare_needs_review_note", "needs manual review");
          const isLockedRedCell = isRejectedAfterApproval || isDeletedCell;
          const radioTitle = isApprovedWinner
            ? i18n("quote_compare_approved_locked", "Approved - already locked")
            : (isLockedRedCell
                ? i18n("quote_compare_not_selected_deleted", "Not selected - this quote item is marked as Deleted")
                : (canPick
                    ? quoteStatusLabel(cell.status)
                    : (cell.status === "Not Quoted"
                        ? i18n("quote_compare_not_quoted_hint", "Supplier did not quote this item — ignored")
                        : (!priceOk
                        ? i18n('quote_compare_price_zero', 'Price is 0 - enter a price first (in Edit Quote)')
                        : i18n('quote_compare_locked_later', 'Item is {status} - cannot go back').replace('{status}', quoteStatusLabel(cell.status))))));
          const radio = canPick
            ? `<input type="radio" name="cmpItem_${iIdx}" class="form-check-input mt-0 cmp-item-radio" data-iidx="${iIdx}" data-si="${si}" title="${attr_(radioTitle)}">`
            : `<input type="radio" class="form-check-input mt-0" disabled title="${attr_(radioTitle)}">`;
          const pickAttr = canPick
            ? ` onclick="window.quoteComparePickRadio(${iIdx}, ${si})" style="cursor:pointer;" title="${attr_(i18n('quote_compare_click_to_select', 'Click to select this quote'))}"`
            : "";
          // Locked rows: the winner stays green, the competing quotes turn red, and
          // the lowest-price highlight only applies while the item is unresolved.
          const cellClass = isApprovedWinner
            ? "table-success"
            : (isLockedRedCell
                ? "table-danger"
                : (isBest ? "table-success fw-bold" : ""));
          // The red note says WHICH kind of red this is:
          //   * already Deleted           -> done, nothing left to repair
          //   * alive + Pending/Quoted    -> the resync tool can delete it
          //   * alive + Sent/Received/... -> too advanced to auto-delete, review it
          const stateNote = isApprovedWinner
            // The winner's row keeps moving (Approved -> Sent -> Received ...),
            // so print its ACTUAL status, not a hardcoded "Approved".
            ? `<div class="small fw-bold text-success"><i class="bi bi-check-circle"></i> ${quoteStatusLabel(cell.status)}</div>`
            : (isDeletedCell
                ? `<div class="small fw-bold text-danger"><i class="bi bi-x-circle"></i> ${quoteStatusLabel("Deleted")}</div>`
                : (isRejectedAfterApproval
                    ? `<div class="small fw-bold text-danger"><i class="bi bi-x-circle"></i> ${quoteStatusLabel(cell.status)}</div><div class="small text-danger">${attr_(competitorHint)}</div>`
                    : `<div class="small fw-normal text-muted">${quoteStatusLabel(cell.status)}</div>`));
          // 💰 What the cell prints: the NET unit price (what we actually pay per
          // unit) as the headline figure, then the discount that produced it and
          // the line total. The transport is NOT in the unit price - it is printed
          // once in the supplier's header as a quote-level charge, so two suppliers
          // are compared on like-for-like goods pricing.
          const netText = cell.netUnit.toLocaleString("en-US");
          const discLine = cell.discountPct > 0
            ? `<div class="small text-success fw-normal"><span class="text-decoration-line-through text-muted">${cell.price.toLocaleString("en-US")}</span> &minus;${cell.discountPct}%</div>`
            : "";
          return `<td class="text-center ${cellClass}"${pickAttr}><div class="d-flex align-items-center justify-content-center gap-1">${radio}<span class="${cell.discountPct > 0 ? "text-success" : ""}">${netText}</span></div>${discLine}<div class="small text-muted fw-normal">${cell.total.toLocaleString("en-US")}</div>${stateNote}</td>`;
        }).join("")}
      </tr>`).join("");

    bodyEl.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0">
        <thead class="table-light">${headHtml}</thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div id="quoteCompareWarning" class="mt-2 small"></div>`;

    window.quoteCompareUpdateSelectionState = function () {
      const cur = window._quoteCompareCtx;
      const cbody = document.getElementById("quoteCompareBody");
      const cbtn = document.getElementById("btnApplyQuoteCompare");
      if (!cur || !cbody) return;
      cur.selection = {};
      Array.from(cbody.querySelectorAll(".cmp-item-radio:checked")).forEach((r) => {
        cur.selection[r.dataset.iidx] = Number(r.dataset.si);
      });
      const picked = Object.keys(cur.selection).length;
      const locked = Object.keys(cur.approvedByItem || {}).length;
      const warnEl = document.getElementById("quoteCompareWarning");
      if (warnEl) {
        const lockedHtml = locked > 0
          ? `<span class="text-success d-block"><i class="bi bi-lock-fill"></i> ${i18n('quote_compare_locked_note', '{n} item(s) already approved - locked (green); competing quotes are shown in red and marked as Deleted.').replace('{n}', locked)}</span>`
          : "";
        if (picked === 0) {
          warnEl.innerHTML = lockedHtml + `<span class="text-muted">${i18n('quote_compare_pick_hint', 'Pick one supplier per item, or use "All" to pick a supplier for every item. Unselected items stay unchanged.')}</span>`;
        } else if (picked < cur.itemUnion.length) {
          warnEl.innerHTML = lockedHtml + `<span class="text-warning">${i18n('quote_compare_partial_note', '{picked} of {total} items selected - unselected items remain unchanged.').replace('{picked}', picked).replace('{total}', cur.itemUnion.length)}</span>`;
        } else {
          warnEl.innerHTML = lockedHtml;
        }
      }
      if (cbtn) cbtn.disabled = picked === 0;
    };
    // "All" shortcut: select this supplier for every item it quoted.
    window.quoteCompareSelectAllFor = function (si) {
      const cur = window._quoteCompareCtx;
      const cbody = document.getElementById("quoteCompareBody");
      if (!cur || !cbody) return;
      Array.from(cbody.querySelectorAll(".cmp-item-radio")).forEach((r) => { r.checked = false; });
      const s = cur.suppliers[si];
      if (!s) return;
      cur.itemUnion.forEach((iu, iIdx) => {
        // Items with an approved winner are locked for every supplier.
        if (cur.approvedByItem && cur.approvedByItem[iu.key] !== undefined) return;
        const cell = window.quoteCompareCellFor(s, iu);
        if (cell && (cell.status === "Quoted" || cell.status === "Approved")) {
          const r = cbody.querySelector(`.cmp-item-radio[data-si="${si}"][data-iidx="${iIdx}"]`);
          if (r) r.checked = true;
        }
      });
      window.quoteCompareUpdateSelectionState();
    };
    // Click anywhere on a selectable price cell to pick that supplier for the item.
    window.quoteComparePickRadio = function (iIdx, si) {
      const cbody = document.getElementById("quoteCompareBody");
      if (!cbody) return;
      const r = cbody.querySelector(`.cmp-item-radio[data-iidx="${iIdx}"][data-si="${si}"]`);
      if (r && !r.disabled) {
        r.checked = true;
        window.quoteCompareUpdateSelectionState();
      }
    };
    Array.from(bodyEl.querySelectorAll(".cmp-item-radio")).forEach((r) =>
      r.addEventListener("change", window.quoteCompareUpdateSelectionState)
    );
    window.quoteCompareUpdateSelectionState();

    const modalEl = document.getElementById("quoteCompareModal");
    if (modalEl && window.bootstrap) {
      if (typeof applyTranslations === "function") applyTranslations();
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  };

  // ===== QUOTE COMPARE: APPLY (approve selected, delete others) =====
  window.applyQuoteCompareSelection = function () {
    const ctx = window._quoteCompareCtx;
    const selMap = (ctx && ctx.selection) || {};
    const pickedKeys = Object.keys(selMap);
    if (!ctx || pickedKeys.length === 0) {
      Swal.fire(i18n("msg_warning"), i18n("quote_compare_select_first", "Select a supplier quote to approve first."), "warning");
      return;
    }
    // Role gate: approving requires MANAGER or ADMIN.
    let editorRole = "";
    try {
      const u = JSON.parse(localStorage.getItem("recon_user_secure") || "null");
      editorRole = String((u && u.role) || "").trim().toUpperCase();
    } catch (e) { /* ignore */ }
    if (editorRole !== "MANAGER" && editorRole !== "ADMIN") {
      Swal.fire(i18n("msg_warning"), i18n("msg_approve_role_required", "Only Managers/Admins can approve quotes."), "warning");
      return;
    }

    // All ACTIVE (non-Deleted) rows of a merged card sharing this item key. A
    // merged card can hold more than one row per GEO when the same supplier was
    // quoted in two RFQ passes - every one of them has to be resolved.
    const findActiveItems = (s, iu) =>
      (s.group.items || []).filter((it) => {
        if (normalizeQuoteItemStatus(it.estado || it.status) === "Deleted") return false;
        if (quoteCompareKeyOf(it) === iu.key) return true;
        // Alias identities, guarded: only when at least one side lacks a GEO
        // (blank-GEO round). Two rows that BOTH carry a GEO and missed the key
        // match are different requirement lines sharing a P/N — never merged.
        const itGeo = String(it.geo || "").trim().toLowerCase();
        const itPn = String(it.pn || it.p || "").trim().toLowerCase();
        const uGeo = String(iu.geo || "").trim().toLowerCase();
        const uPn = String(iu.pn || iu.p || "").trim().toLowerCase();
        if (uGeo && itGeo && itGeo === uGeo) return true;
        if (!(uGeo && itGeo) && uPn && itPn && itPn === uPn) return true;
        return false;
      });

    // Qty edits made directly in the compare matrix (applied to approved rows).
    const qtyOverrides = {};
    Array.from(document.querySelectorAll("#quoteCompareBody .cmp-item-qty")).forEach((inp) => {
      const v = Number(inp.value);
      if (!Number.isNaN(v) && v >= 0) qtyOverrides[inp.dataset.iidx] = v;
    });

    // Per-supplier operations: approvals (Quoted -> Approved) and per-item
    // deletions (every other supplier's row for each selected item).
    const opsBySi = {};
    const opFor = (si) => opsBySi[si] || (opsBySi[si] = { si, s: ctx.suppliers[si], approve: [], del: [] });

    pickedKeys.forEach((iIdx) => {
      const si = selMap[iIdx];
      const iu = ctx.itemUnion[Number(iIdx)];
      const winner = ctx.suppliers[si];
      if (!winner || !iu) return;
      // Already resolved in an earlier approval pass: the cell is locked in the
      // matrix, so never re-approve it nor re-delete its competitors.
      if (ctx.approvedByItem && ctx.approvedByItem[iu.key] !== undefined) return;
      const winCell = window.quoteCompareCellFor(winner, iu);
      // No covering quote from the winner -> leave the item alone (never delete
      // competitors for an item that is not being approved).
      if (!winCell) return;
      // Only a Quoted cell can move forward to Approved.
      if (String(winCell.status) !== "Quoted") return;
      const winItem = winCell.item || findActiveItems(winner, iu)[0];
      if (winItem) opFor(si).approve.push({ src: winItem, qty: qtyOverrides[iIdx] });
      // Every other supplier quoting this exact item is the loser of the
      // comparison: mark all of its active rows (Pending included) as Deleted.
      ctx.suppliers.forEach((s, sj) => {
        if (sj === si) return;
        if (!window.quoteCompareCellFor(s, iu)) return;
        findActiveItems(s, iu).forEach((it) => opFor(sj).del.push(it));
      });
    });

    const ops = Object.values(opsBySi).filter((op) => op.approve.length || op.del.length);
    if (ops.length === 0) return;

    const approveCount = ops.reduce((n, op) => n + op.approve.length, 0);
    const delCount = ops.reduce((n, op) => n + op.del.length, 0);
    const bySupplierHtml = ops.map((op) => `${attr_(op.s.supplier)} (${op.approve.length})`).join(", ");

    let confirmHtml = `${i18n('quote_compare_confirm_items', 'Approve {n} item(s) from:').replace('{n}', approveCount)} <strong>${bySupplierHtml}</strong>`;
    if (delCount > 0) {
      confirmHtml += `<br><span class="text-danger small">${i18n('quote_compare_confirm_delete_items', '{n} item quote(s) from other suppliers will be marked as Deleted.').replace('{n}', delCount)}</span>`;
    }

    Swal.fire({
      title: i18n('quote_compare_confirm_title', 'Approve quote?'),
      html: confirmHtml,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: i18n('btn_yes_delete', 'Yes'),
    }).then((res) => {
      if (!res.isConfirmed) return;
      if (window._quoteCompareSaving) return;

      const btn = document.getElementById("btnApplyQuoteCompare");
      const btnOriginalHtml = btn ? btn.innerHTML : "";
      const restoreBtn = function () {
        window._quoteCompareSaving = false;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = btnOriginalHtml;
        }
      };
      window._quoteCompareSaving = true;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> ' + i18n("draft_saving");
      }

      const currentUserEmail = (() => {
        try {
          const userStr = localStorage.getItem('recon_user_secure');
          if (userStr && userStr !== '') return JSON.parse(userStr).email;
          return window.currentUser?.email || '';
        } catch (e) { return ''; }
      })();

      // Sequential per-supplier calls (each acquires the script lock server-side).
      const buildPayloadItem = (op, entry, status) => {
        const it = entry.src || entry;
        const q = (entry.src && entry.qty !== undefined && entry.qty !== null)
          ? (Number(entry.qty) || 0)
          : (Number(it.cant || it.qty || 0) || 0);
        const price = Number(it.price || 0) || 0;
        // 💰 Commercials travel with the line so an approval can never silently
        // drop the supplier's discount or the agreed transport. A value the source
        // row does not have is sent as `undefined`, which the server reads as
        // "keep the stored cell" - same contract as approvedQty below.
        const discountPct = (it.discountPct === undefined || it.discountPct === null || String(it.discountPct).trim() === "")
          ? undefined
          : normalizeQuoteDiscountPct(it.discountPct);
        const freight = (it.freight === undefined || it.freight === null || String(it.freight).trim() === "")
          ? undefined
          : normalizeQuoteFreight(it.freight);
        // Money actually approved: the NET unit price (discount applied), because
        // approving at the list price would pay the supplier more than agreed.
        const netUnitPrice = quoteNetUnitPrice(price, discountPct);
        // 🛎️ FIX (approval totals): the line Total used to be forwarded VERBATIM
        // from the cached row, so approving with an edited Qty wrote the new Cant.
        // but kept the OLD "Total Neto" - and because the quote grand total is just
        // the sum of line totals, neither figure ever moved. Recompute from the qty
        // actually being approved. Two guards:
        //   * only the Approved leg is recalculated (Deleted rows keep stored value)
        //   * a zero unit price means a lump-sum quote, so it is preserved as-is
        //     rather than being zeroed out.
        //   The transport is NOT added here: the server adds it on the single
        //   carrier line of the quote, so it is counted exactly once.
        const isApproving = String(status).toUpperCase() === "APPROVED";
        const lineTotal = (isApproving && price > 0)
          ? Math.round(netUnitPrice * q * 100) / 100
          : (Number(it.total || it.lineTotal || 0) || 0);
        // 🔒 On the approval leg `q` IS the approved quantity: the server stamps it
        // into "Cant. Aprobado" and freezes "Cant." as the quoted figure. Sending it
        // explicitly as well keeps the stamp correct even if the line is later
        // re-approved, and it is what lets a reduced approval stay visible instead
        // of overwriting the quote. Deleted legs must never touch it.
        const approvedQty = isApproving ? q : undefined;
        return {
        orderId: it.orderId || op.s.orderId,
        quoteId: it.quoteId || op.s.quoteId || "",
        origGeo: it.origGeo || it.geo || "",
        deleted: status === "Deleted",
        status,
        geo: it.geo || "",
        pn: it.pn || it.p || "",
        origPn: it.origPn || it.pn || it.p || "",
        es: it.es || it.desc || "",
        supplierQuoteNo: it.supplierQuoteNo || undefined,
        quotedDocUrl: it.quotedDocUrl || undefined,
        qty: q,
        receivedQty: undefined, // omitted -> server preserves stored value
        // 🔒 Only the Approved leg writes "Cant. Aprobado" (see isApproving above).
        approvedQty: approvedQty,
        category: it.category || op.s.category,
        subCategory: it.subCategory || "",
        price: price,
        total: lineTotal,
        // 💰 Quote-level supplier discount + quote-level transport (see above).
        discountPct: discountPct,
        freight: freight,
        };
      };

      let opIdx = 0;
      const failures = [];
      const finish = () => {
        restoreBtn();
        const modalEl = document.getElementById("quoteCompareModal");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        if (failures.length) {
          Swal.fire(i18n("msg_warning"), i18n("msg_compare_partial_fail", "Some changes could not be saved:") + "<br>" + failures.map(attr_).join("<br>"), "warning");
        } else {
          Swal.fire(i18n("msg_success"), i18n('msg_compare_success_items', '{approved} item(s) approved; {deleted} item quote(s) from other suppliers marked as Deleted.').replace('{approved}', approveCount).replace('{deleted}', delCount), "success");
        }
        window.loadQuoteData();
      };
      const runNextOp = () => {
        if (opIdx >= ops.length) { finish(); return; }
        const op = ops[opIdx++];
        const payloadItems = op.approve
          .map((it) => buildPayloadItem(op, it, "Approved"))
          .concat(op.del.map((it) => buildPayloadItem(op, it, "Deleted")));
        google.script.run
          .withSuccessHandler(function () { runNextOp(); })
          .withFailureHandler(function (err) {
            failures.push(`${op.s.supplier}: ${String(err)}`);
            runNextOp();
          })
          .updateQuoteWithItems({
            orderId: op.s.orderId,
            quoteId: op.s.quoteId,
            supplier: op.s.supplier,
            category: op.s.category,
            items: payloadItems,
            status: "Pending",
            currentUserEmail,
          });
      };
      runNextOp();
    });
  };

  // ===== "FIX DELETED" — compare-modal resync =====
  // Approving an item must mark every other supplier's line for that item as
  // Deleted, but three gaps could leave those competitors alive:
  //   1. the compare modal only cascaded for items that had no winner yet
  //   2. the Edit Quote / bulk save paths call updateQuoteWithItems with no cascade
  //   3. that cascade keyed on GEO only, so blank/differing GEO rows were skipped
  // The result is an "unbalanced" requirement: item X is Approved from supplier A
  // while B and/or C are still Quoted/Pending, so the same item looks costed twice.
  // This tool re-reads the requirement from the SERVER (never from the possibly
  // filtered or stale page), shows exactly what it would change, and repairs only
  // what is provably safe:
  //   * only Pending/Quoted competitors (COMPETITOR_AUTO_DELETE_STATUSES) - from
  //     Sent onwards a row already carries a supplier quote number, received
  //     quantities and a stock reservation, so it is REPORTED, never touched
  //   * never the winning supplier's own rows (same rule as the approval flow)
  //   * never an item with two approved suppliers (double approval) - reported
  //   * only rows whose (Quote ID + GEO) matches a single sheet row, because that
  //     is the pair the server resolves rows with and it falls back to "first row
  //     of this quote" when it misses - a blank GEO could otherwise delete the
  //     wrong line, so those rows are reported for manual review instead
  // Writes reuse updateQuoteWithItems, so the QuoteLog audit entry, role and lock
  // checks, stock movements and the status validator all still apply.
  window.resyncQuoteCompare = function () {
    const ctx = window._quoteCompareCtx;
    if (!ctx || !ctx.orderId) return;
    if (window.isQuoteUserRole()) {
      Swal.fire(i18n("msg_warning"), i18n("quote_compare_resync_not_allowed", "Your role cannot run the balance repair."), "warning");
      return;
    }

    // Same busy-state pattern as the Apply button: dataset.defaultHtml keeps the
    // icon + i18n-label markup so applyTranslations can restore it afterwards.
    const btn = document.getElementById("btnResyncQuoteCompare");
    if (btn) {
      if (!btn.dataset.defaultHtml) btn.dataset.defaultHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${attr_(i18n("quote_compare_resync_scanning", "Scanning requirement..."))}`;
    }
    const restoreBtn = () => {
      if (!btn) return;
      btn.disabled = false;
      btn.innerHTML = btn.dataset.defaultHtml || btn.innerHTML;
      if (typeof applyTranslations === "function") applyTranslations();
    };

    const orderId = String(ctx.orderId || "").trim();
    google.script.run
      .withSuccessHandler(function (rows) {
        restoreBtn();
        let plan = null;
        try {
          plan = buildResyncPlan_(orderId, Array.isArray(rows) ? rows : []);
        } catch (e) {
          console.error("resyncQuoteCompare: planning failed:", e);
          Swal.fire(i18n("msg_error", "Error"), i18n("quote_compare_resync_failed", "Repair failed:") + "<br>" + attr_(String((e && e.message) || e)), "error");
          return;
        }
        showResyncPlan_(plan);
      })
      .withFailureHandler(function (err) {
        restoreBtn();
        console.error("resyncQuoteCompare failed:", err);
        Swal.fire(i18n("msg_error", "Error"), i18n("quote_compare_resync_failed", "Repair failed:") + "<br>" + attr_(String(err)), "error");
      })
      .getRequirementQuoteRows(orderId, currentQuoteUserEmail_());
  };

  // Current user's email, from the same session storage the rest of the page uses.
  function currentQuoteUserEmail_() {
    try {
      const u = JSON.parse(localStorage.getItem("recon_user_secure") || "null");
      return u && u.email ? String(u.email) : "";
    } catch (e) {
      return "";
    }
  }

  // Pure planner - no DOM, no writes - so it can be exercised with plain fixtures.
  // Returns { orderId, auto, review, doubles, skipped } where `auto` is the exact
  // list of rows the repair is allowed to delete.
  function buildResyncPlan_(orderId, rows) {
    const keyOf = window.quoteCompareKeyOf;
    const norm = (v) => String(v || "").trim().toLowerCase();

    const quotes = [];         // one entry per supplier quote (sheet Quote ID)
    const quoteIdx = {};
    const approvedByKey = {};  // itemKey -> [{ quote, row }]
    const rowKeyCount = {};    // "quoteId|geo" -> how many scanned rows use it

    (rows || []).forEach((r) => {
      if (!r) return;
      const supplier = String(r.supplier || "").trim();
      const quoteId = String(r.quoteId || "").trim();
      const sKey = norm(supplier) + "|" + norm(quoteId);
      if (quoteIdx[sKey] === undefined) {
        quoteIdx[sKey] = quotes.push({
          supplier,
          quoteId,
          orderId: String(r.orderId || orderId || "").trim(),
          category: r.category || "",
          rows: [],
        }) - 1;
      }
      const q = quotes[quoteIdx[sKey]];
      q.rows.push(r);

      const rKey = norm(quoteId) + "|" + norm(r.geo);
      rowKeyCount[rKey] = (rowKeyCount[rKey] || 0) + 1;

      if (APPROVED_OR_LATER_STATUSES.indexOf(normalizeQuoteItemStatus(r.estado || r.status)) !== -1) {
        // Winner detection, like the compare lock, is approved-OR-LATER: an
        // item whose winning line has already moved to Sent/Received/... is
        // still resolved, so its alive competitors must be repaired too.
        const k = keyOf(r);
        if (!approvedByKey[k]) approvedByKey[k] = [];
        approvedByKey[k].push({ quote: q, row: r });
      }
    });

    const auto = [], review = [], doubles = [], skipped = [];
    Object.keys(approvedByKey).forEach((key) => {
      const winners = approvedByKey[key];
      const winnerBySupplier = {};
      winners.forEach((w) => { winnerBySupplier[norm(w.quote.supplier)] = w; });
      const winnerNames = Object.keys(winnerBySupplier);
      if (winnerNames.length > 1) {
        // Two suppliers both Approved on the same item: flag it and touch nothing.
        // Choosing a winner here would be a business decision, and deleting a third
        // supplier's line while the item is double-approved would make the mess
        // harder to unpick, so this item is reported and skipped entirely.
        doubles.push({
          key,
          geo: winners[0].row.geo || "",
          pn: winners[0].row.pn || winners[0].row.p || "",
          suppliers: winnerNames.map((n) => winnerBySupplier[n].quote.supplier),
        });
        return;
      }
      quotes.forEach((q) => {
        if (winnerBySupplier[norm(q.supplier)]) return; // winner's own rows: untouched
        q.rows.forEach((r) => {
          if (keyOf(r) !== key) return;
          const st = normalizeQuoteItemStatus(r.estado || r.status);
          if (st === "Deleted") return; // already repaired
          const entry = { quote: q, row: r, status: st, key };
          // The server resolves the target row by (Quote ID + GEO) and, when that
          // misses, falls back to the FIRST row of that quote. A row may therefore
          // only be auto-deleted when its GEO is present and that pair is unique -
          // otherwise we could mark a different line of the same quote as Deleted.
          const rKey = norm(r.quoteId || q.quoteId) + "|" + norm(r.geo);
          if (!String(r.geo || "").trim() || rowKeyCount[rKey] !== 1) { skipped.push(entry); return; }
          if (COMPETITOR_AUTO_DELETE_STATUSES.indexOf(st) !== -1) auto.push(entry);
          else review.push(entry);
        });
      });
    });

    return { orderId: String(orderId || "").trim(), auto, review, doubles, skipped };
  }

  // Preview + one confirm. Nothing is written until the user accepts.
  function showResyncPlan_(plan) {
    const notes = [];
    if (plan.review.length) {
      notes.push(i18n("quote_compare_resync_review", "{n} line(s) are already Sent/Received and were left untouched (manual review).").replace("{n}", plan.review.length));
    }
    if (plan.doubles.length) {
      notes.push(i18n("quote_compare_resync_double", "{n} item(s) have more than one approved quote - left untouched (manual review).").replace("{n}", plan.doubles.length));
    }
    if (plan.skipped.length) {
      notes.push(i18n("quote_compare_resync_skipped", "{n} line(s) could not be matched to a unique quote row (blank or duplicated GEO) - left untouched (manual review).").replace("{n}", plan.skipped.length));
    }
    const notesHtml = notes.length
      ? `<ul class="small text-start mt-2 mb-0">${notes.map((n) => `<li>${attr_(n)}</li>`).join("")}</ul>`
      : "";

    if (plan.auto.length === 0) {
      // Nothing safe to fix - the button doubles as a health check for the item.
      Swal.fire({
        icon: notes.length ? "info" : "success",
        title: i18n("quote_compare_resync_none", "Nothing to repair."),
        html: `<div class="text-start">${attr_(i18n("quote_compare_resync_balanced", "This requirement is already balanced: every approved item has its competing quote lines marked as Deleted."))}${notesHtml}</div>`,
      });
      return;
    }

    const supplierCount = {};
    plan.auto.forEach((a) => { supplierCount[String(a.quote.supplier).trim().toLowerCase()] = true; });
    const summary = i18n("quote_compare_resync_found", "{n} stale quote line(s) from {m} supplier(s) can be repaired.")
      .replace("{n}", plan.auto.length)
      .replace("{m}", Object.keys(supplierCount).length);

    const tableHtml = `<div class="table-responsive" style="max-height:320px;overflow:auto;">
        <table class="table table-sm table-bordered align-middle mb-0 text-start">
          <thead class="table-light"><tr>
            <th>${attr_(i18n("lbl_supplier", "Supplier"))}</th>
            <th>${attr_(i18n("col_geo", "GEO"))}</th>
            <th>${attr_(i18n("m_pn", "P/N"))}</th>
            <th>${attr_(i18n("quote_compare_resync_col_current", "Current"))}</th>
            <th>${attr_(i18n("quote_compare_resync_col_new", "New status"))}</th>
          </tr></thead>
          <tbody>${plan.auto.map((a) => `<tr>
            <td>${attr_(a.quote.supplier)}</td>
            <td>${attr_(a.row.geo)}</td>
            <td>${attr_(a.row.pn || a.row.p || "")}</td>
            <td class="text-center">${attr_(quoteStatusLabel(a.status))}</td>
            <td class="text-center text-danger fw-bold">${attr_(quoteStatusLabel("Deleted"))}</td>
          </tr>`).join("")}</tbody>
        </table></div>`;

    Swal.fire({
      icon: "warning",
      title: i18n("quote_compare_resync_confirm_title", "Repair unbalanced items?"),
      html: `<div class="text-start small mb-2">${attr_(summary)}<br>${attr_(i18n("quote_compare_resync_confirm_msg", "These quote lines will be marked as Deleted:"))}</div>${tableHtml}${notesHtml}`,
      width: 900,
      showCancelButton: true,
      confirmButtonText: i18n("quote_compare_resync", "Fix Deleted"),
      cancelButtonText: i18n("modal_cancel", "Cancel"),
      confirmButtonColor: "#d97706",
    }).then((res) => {
      if (res && res.isConfirmed) applyResync_(plan);
    });
  }

  // Apply the plan: one updateQuoteWithItems call per supplier quote, sequentially
  // (each call takes the script lock server-side). Only plan.auto rows are ever
  // sent, so the review / skipped / double rows are physically untouched.
  function applyResync_(plan) {
    const ops = [];
    const opIdx = {};
    plan.auto.forEach((a) => {
      const key = String(a.quote.supplier).trim().toLowerCase() + "|" + String(a.quote.quoteId || "").trim().toLowerCase();
      if (opIdx[key] === undefined) opIdx[key] = ops.push({ quote: a.quote, rows: [] }) - 1;
      ops[opIdx[key]].rows.push(a.row);
    });

    const email = currentQuoteUserEmail_();
    const failures = [];
    let deletedCount = 0;
    let i = 0;
    const runNext = () => {
      if (i >= ops.length) {
        if (failures.length) {
          Swal.fire(i18n("msg_warning"), i18n("msg_compare_partial_fail", "Some changes could not be saved:") + "<br>" + failures.map(attr_).join("<br>"), "warning");
        } else {
          Swal.fire(i18n("msg_success"), i18n("quote_compare_resync_done", "{n} quote line(s) marked as Deleted.").replace("{n}", deletedCount), "success");
        }
        // Re-read from the sheet and reopen the comparison so the repaired cells are
        // visible immediately (they now render red + Deleted instead of a bare "-").
        const oid = String(plan.orderId || "").trim();
        const modalEl = document.getElementById("quoteCompareModal");
        if (modalEl && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        window.loadQuoteData(function () {
          if (oid && typeof window.openCompareQuotes === "function") window.openCompareQuotes(oid);
        });
        return;
      }
      const op = ops[i++];
      const items = op.rows.map((r) => buildResyncPayloadItem_(r, op.quote));
      google.script.run
        .withSuccessHandler(function () { deletedCount += items.length; runNext(); })
        .withFailureHandler(function (err) { failures.push(String(op.quote.supplier || "") + ": " + String(err)); runNext(); })
        .updateQuoteWithItems({
          orderId: op.quote.orderId || plan.orderId,
          quoteId: op.quote.quoteId,
          supplier: op.quote.supplier,
          category: op.quote.category,
          items: items,
          status: "Pending",
          currentUserEmail: email,
        });
    };
    runNext();
  }

  // Mirrors the Deleted leg of the approval flow's buildPayloadItem: the row is
  // identified by (Quote ID + original GEO) and every other field is echoed, so only
  // the status moves. receivedQty is deliberately omitted (undefined) so the server
  // preserves the stored value instead of fabricating a diff, and so is
  // approvedQty — a Deleted line keeps whatever was stamped at approval.
  function buildResyncPayloadItem_(it, quote) {
    return {
      orderId: it.orderId || quote.orderId || "",
      quoteId: it.quoteId || quote.quoteId || "",
      origGeo: it.origGeo || it.geo || "",
      deleted: true,
      status: "Deleted",
      geo: it.geo || "",
      pn: it.pn || it.p || "",
      origPn: it.origPn || it.pn || it.p || "",
      es: it.es || it.desc || "",
      supplierQuoteNo: it.supplierQuoteNo || undefined,
      quotedDocUrl: it.quotedDocUrl || undefined,
      qty: Number(it.cant || it.qty || 0) || 0,
      receivedQty: undefined, // omitted -> server preserves the stored value
      approvedQty: undefined, // omitted -> server preserves the stored stamp
      category: it.category || quote.category || "",
      subCategory: it.subCategory || "",
      price: Number(it.price || 0) || 0,
      total: Number(it.total || it.lineTotal || 0) || 0,
    };
  }

  // Initialize QuoteMgmt module when page is ready
  window.initQuoteMgmtModule = function () {
    console.log("Initializing QuoteMgmt module...");
    
    // Parse user safely with error handling
    let userJson = localStorage.getItem("recon_user_secure");
    let user = null;
    try {
      if (userJson && userJson !== "") {
        user = JSON.parse(userJson);
      }
    } catch (e) {
      console.warn("Failed to parse user from localStorage:", e);
    }
    
    window.quoteAllowedCategory =
      !user || user.role.toLowerCase() === "admin" || !user.position
        ? ""
        : String(user.position || "").trim();
    window.attemptQuoteDropdownPopulation();

    // Populate QuoteMgmt site filter dropdown and apply site lock
    const quoteSiteSelect = document.getElementById("filterQuoteSite");
    if (quoteSiteSelect && window.cachedSites && window.cachedSites.length > 0) {
      // Repopulate with "All Sites" first + all available sites
      const allSitesLabel = (typeof i18n === "function" ? i18n('all_sites') : "") || "All Sites";
      quoteSiteSelect.innerHTML =
        `<option value="">${allSitesLabel}</option>` +
        window.cachedSites
          .map((s) => `<option value="${s.name}">${s.name}</option>`)
          .join("");

      try {
        if (userJson && userJson !== "") {
          user = JSON.parse(userJson);
        }
      } catch (e) {
        console.warn("Failed to parse user for site lock:", e);
      }

      if (user) {
        if (user.role.toLowerCase() === "user" && user.site) {
          // USER role: LOCK to their assigned site
          const siteObj = window.cachedSites.find(s => s.name === user.site);
          if (siteObj) {
            quoteSiteSelect.value = siteObj.name;
            quoteSiteSelect.disabled = true;
            quoteSiteSelect.style.backgroundColor = "#e9ecef";
            quoteSiteSelect.title = "Site locked for your role";
            
            // Trigger change event for any dependent dropdowns
            quoteSiteSelect.dispatchEvent(new Event("change"));
          }
        } else {
          // Admin/Office/Manager: default to "All Sites" (no lock, no forced selection)
          quoteSiteSelect.value = "";
        }
      }
    }

  };

  // Auto-start initialization
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.initQuoteMgmtModule === "function") {
      window.initQuoteMgmtModule();
    }
  });

  // Apply translations to all [data-i18n] elements (LifecycleReportJS pattern)
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      if (typeof getI18nText === "function") {
        const translated = getI18nText(key);
        el.textContent = translated;
      } else if (typeof i18n === "function") {
        const translated = i18n(key);
        el.textContent = translated;
      }
    });
  }

  // Auto-apply translations after initialization
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { applyTranslations(); if (typeof renderQuoteStatusLegend === "function") renderQuoteStatusLegend(); }, 100);
  });
