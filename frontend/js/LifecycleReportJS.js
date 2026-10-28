(function(){
  let lifecycleRows = [];

  function parseDate(value){ if(!value) return null; const d = new Date(value); return isNaN(d.getTime())?null:d; }
  function dateToInput(v){ const d = parseDate(v); if(!d) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  const STAGE_ORDER = ['Created','Pending','Not Quoted','Quoted','Approved','Sent','Received','Despatched','Final Received'];
  // STORE orders end at "Received" — no Despatched/Final Received
  const STORE_STAGE_ORDER = ['Created','Pending','Not Quoted','Quoted','Approved','Sent','Received'];

  const STATUS_COLORS = {
    'Created': '#f8f9fa',
    'Pending': '#fff3cd',
    'Not Quoted': '#e9ecef',
    'Quoted': '#d1e7dd',
    'Approved': '#cfe2ff',
    'Sent': '#dbeafe',
    'Received': '#d1e7dd',
    'Despatched': '#fff4e6',
    'PO Created': '#fff4e6',
    'Final Received': '#e6ffed'
  };

  function hexToRgb(hex){
    const h = hex.replace('#','');
    const bigint = parseInt(h,16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return {r,g,b};
  }

  function rgba(hex, alpha){
    const c = hexToRgb(hex||'#ffffff');
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
  }

  function luminance(hex){
    const c = hexToRgb(hex||'#ffffff');
    const a = [c.r,c.g,c.b].map(v=>{
      v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
    });
    return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
  }

  function getContrastColor(hex){
    return luminance(hex) > 0.5 ? '#000' : '#fff';
  }

  function getStatusColor(stage){
    return STATUS_COLORS[normalizeStage(stage)] || STATUS_COLORS['Created'];
  }

  function clean(v){ return String(v || '').trim(); }

  function normalizeStage(stage) {
    const value = clean(stage).toLowerCase();
    if (!value) return 'Created';
    // "Not Quoted" must be caught BEFORE the bare 'quot' check, otherwise the
    // supplier-didn't-quote state misreads as "Quoted" (QuoteMgmt's status).
    if ((value.includes('not') && value.includes('quot')) || value.includes('no cotiz') || value.includes('sin cotiz')) return 'Not Quoted';
    if (value.includes('final')) return 'Final Received';
    if (value.includes('po') || value.includes('orden') || value.includes('ordered') || value.includes('comprad')) return 'PO Created';
    if (value.includes('approv') || value.includes('aprob')) return 'Approved';
    if (value.includes('despatch') || value.includes('despach')) return 'Despatched';
    if (value.includes('received') || value.includes('recib')) return 'Received';
    if (value.includes('quot') || value.includes('cotiz')) return 'Quoted';
    if (value.includes('rfq') || value.includes('sent')) return 'Sent';
    if (value.includes('pend')) return 'Pending';
    return 'Created';
  }

  function stageIndex(stage) {
    const normalized = normalizeStage(stage);
    const idx = STAGE_ORDER.indexOf(normalized);
    return idx === -1 ? 0 : idx;
  }

  function stageLabel(stage) {
    const normalized = normalizeStage(stage);
    const keyMap = {
      'Created': 'stage_created',
      'Pending': 'stage_pending',
      'Not Quoted': 'stage_not_quoted',
      'Sent': 'stage_sent',
      'Quoted': 'stage_quoted',
      'Approved': 'stage_approved',
      'Received': 'stage_received',
      'Despatched': 'stage_despatched',
      'PO Created': 'stage_po_created',
      'Final Received': 'stage_final_received'
    };
    const key = keyMap[normalized] || 'stage_created';
    return getI18nText(key) || normalized;
  }

  function t(key, fallback) {
    const value = typeof getI18nText === 'function' ? getI18nText(key) : '';
    return value && value !== key ? value : (fallback || key);
  }

  function getReqSite(row) { return clean(row && (row.site || row.faena || row.requirementSite)); }
  function getReqCategory(row) { return clean(row && (row.category || row.subCategory || row.cat)); }
  function getReqCreator(row) { return clean(row && (row.creator || row.user || row.requestedBy)); }
  function getReqDesc(row) { return clean(row && (row.desc || row.description || row.requirementDesc)); }
  function getReqOrderId(row) { return clean(row && (row.orderId || row.order || row.reqId)); }
  function getReqQuoteCount(row) { return Number(row && row.quotesCount || 0) || 0; }
  function getReqItemCount(row) { return Array.isArray(row && row.items) ? row.items.length : 0; }

  function applyTranslations(){
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const key = el.getAttribute('data-i18n');
      if(!key) return;
      const txt = typeof getI18nText === 'function' ? getI18nText(key) : key;
      if (txt) el.innerText = txt;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
      const key = el.getAttribute('data-i18n-placeholder');
      if(!key) return;
      const txt = typeof getI18nText === 'function' ? getI18nText(key) : key;
      if (txt) el.placeholder = txt;
    });
  }

  function populateStageFilter(){
    const sel = document.getElementById('lifecycleStageFilter');
    if(!sel) return;
    sel.innerHTML = [
      `<option value="all">${t('all_statuses','All')}</option>`,
      `<option value="Created">${stageLabel('Created')}</option>`,
      `<option value="Pending">${stageLabel('Pending')}</option>`,
      `<option value="Not Quoted">${stageLabel('Not Quoted')}</option>`,
      `<option value="Quoted">${stageLabel('Quoted')}</option>`,
      `<option value="Approved">${stageLabel('Approved')}</option>`,
      `<option value="Sent">${stageLabel('Sent')}</option>`,
      `<option value="Received">${stageLabel('Received')}</option>`,
      `<option value="Despatched">${stageLabel('Despatched')}</option>`,
      `<option value="PO Created">${stageLabel('PO Created')}</option>`,
      `<option value="Final Received">${stageLabel('Final Received')}</option>`
    ].join('');
  }

  function populateSiteFilter(rows){
    const sel = document.getElementById('lifecycleSiteFilter');
    if(!sel) return;
    const sites = [...new Set((rows || []).map(row => getReqSite(row)).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">${t('all_sites','All Sites')}</option>` + sites.map(site => `<option value="${site}">${site}</option>`).join('');
  }

  function groupRequirementQuotes(req) {
    const quoteGroups = new Map();
    const unquotedItems = [];
    const items = Array.isArray(req.items) ? req.items : [];

    items.forEach((item, itemIndex) => {
      const itemQuotes = Array.isArray(item.quotes) ? item.quotes : [];
      if (!itemQuotes.length) {
        unquotedItems.push({ item, itemIndex });
        return;
      }

      itemQuotes.forEach((quoteRow, quoteIndex) => {
        const quoteKey = clean(quoteRow.quoteId || quoteRow.refCotiz || quoteRow.quoteLink || quoteRow.orderId || `${quoteRow.supplier || ''}|${quoteRow.timestampIso || quoteRow.timestamp || ''}|${quoteRow.geo || ''}|${quoteRow.pn || ''}`);
        const normalizedStage = normalizeStage(quoteRow.estado || quoteRow.status);
        const quoteTotal = Number(quoteRow.total || quoteRow.price || 0) || 0;
        const group = quoteGroups.get(quoteKey) || {
          key: quoteKey,
          quoteId: clean(quoteRow.quoteId || quoteRow.refCotiz || ''),
          refCotiz: clean(quoteRow.refCotiz || ''),
          supplier: clean(quoteRow.supplier || ''),
          site: clean(quoteRow.faena || req.site || ''),
          date: quoteRow.timestampIso || quoteRow.timestamp || quoteRow.fecha || '',
          stage: normalizedStage,
          total: quoteTotal,
          quoteLink: clean(quoteRow.quoteLink || ''),
          rawQuotes: [],
          items: []
        };

        group.rawQuotes.push(quoteRow);
        group.items.push({ item, quoteRow, itemIndex, quoteIndex });

        if (!group.supplier && quoteRow.supplier) group.supplier = clean(quoteRow.supplier);
        if (!group.site && quoteRow.faena) group.site = clean(quoteRow.faena);
        if (!group.date && (quoteRow.timestampIso || quoteRow.timestamp || quoteRow.fecha)) group.date = quoteRow.timestampIso || quoteRow.timestamp || quoteRow.fecha || '';
        if (stageIndex(normalizedStage) > stageIndex(group.stage)) group.stage = normalizedStage;
        if (!group.total && quoteTotal) group.total = quoteTotal;
        if (!group.quoteLink && quoteRow.quoteLink) group.quoteLink = clean(quoteRow.quoteLink);

        quoteGroups.set(quoteKey, group);
      });
    });

    return {
      quoteGroups: [...quoteGroups.values()].sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0)),
      unquotedItems
    };
  }

  function buildSearchText(req) {
    const parts = [req.orderId, req.site, req.category, req.creator, req.desc, req.stage, req.currentStage, req.lastUpdated, req.createdDate];
    (Array.isArray(req.items) ? req.items : []).forEach(item => {
      parts.push(item.pn, item.geo, item.desc, item.qty, item.estado, item.lastKnownStage);
      (Array.isArray(item.quotes) ? item.quotes : []).forEach(q => parts.push(q.quoteId, q.refCotiz, q.supplier, q.estado, q.status, q.geo, q.pn));
    });
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function currentFilters(){
    return {
      from: parseDate(document.getElementById('lifecycleDateFrom')?.value),
      to: parseDate(document.getElementById('lifecycleDateTo')?.value),
      site: clean(document.getElementById('lifecycleSiteFilter')?.value),
      stage: clean(document.getElementById('lifecycleStageFilter')?.value) || 'all',
      search: clean(document.getElementById('lifecycleSearch')?.value).toLowerCase()
    };
  }

  function filterRows(){
    const f = currentFilters();
    return lifecycleRows.filter(req => {
      if (f.site && getReqSite(req) !== f.site) return false;
      if (f.stage && f.stage !== 'all' && normalizeStage(req.stage || req.currentStage) !== f.stage) return false;
      if (f.from) { const lu = parseDate(req.lastUpdated || req.createdDate); if (!lu || lu < f.from) return false; }
      if (f.to) { const lu = parseDate(req.lastUpdated || req.createdDate); if (!lu || lu > f.to) return false; }
      if (f.search && !buildSearchText(req).includes(f.search)) return false;
      return true;
    });
  }

  function firstNonZeroTotal(rows) {
    for (let i = 0; i < rows.length; i++) {
      const value = Number(rows[i].total || rows[i].price || 0) || 0;
      if (value) return value;
    }
    return 0;
  }

  function renderRequirementCards(rows){
    const container = document.getElementById('lifecycleCards');
    const noRes = document.getElementById('lifecycleNoResults');
    if(!container || !noRes) return;
    container.innerHTML = '';
    if(!rows.length){ noRes.classList.remove('d-none'); return; }
    noRes.classList.add('d-none');

    rows.forEach(req => {
      const orderId = getReqOrderId(req);
      const site = getReqSite(req);
      const isStore = site.toLowerCase() === 'store';
      const category = getReqCategory(req);
      const creator = getReqCreator(req);
      const desc = getReqDesc(req);
      const stage = normalizeStage(req.stage || req.currentStage);
      const activeStageOrder = isStore ? STORE_STAGE_ORDER : STAGE_ORDER;
      const stageIdx = stageIndex(stage);
      const stagePct = Math.round(((stageIdx + 1) / activeStageOrder.length) * 100);
      const quoteData = groupRequirementQuotes(req);
      const quoteGroups = quoteData.quoteGroups;
      const unquotedItems = quoteData.unquotedItems;
      const quotedItemCount = (Array.isArray(req.items) ? req.items.length : 0) - unquotedItems.length;
      const quoteSuppliers = [...new Set(quoteGroups.map(q => q.supplier).filter(Boolean))];
      const itemCount = Array.isArray(req.items) ? req.items.length : 0;
      const totalQuoted = Number(req.totalQuoted || firstNonZeroTotal(quoteGroups.map(q => ({ total: q.total })))) || 0;

      const card = document.createElement('div');
      card.className = 'col-12';
      card.innerHTML = `
        <div class="card shadow-sm lifecycle-req-card">
          <div class="card-body">
            <div class="d-flex justify-content-between gap-3 flex-wrap align-items-start">
              <div class="flex-grow-1">
                <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                  <h5 class="mb-0">${orderId || t('lbl_req', 'Req')}</h5>
                  <span class="badge bg-secondary lifecycle-stage-badge">${stageLabel(stage)}</span>
                </div>
                <div class="text-muted small">${site || t('all_sites','All Sites')}${category ? ' · ' + category : ''}${creator ? ' · ' + creator : ''}</div>
                <div class="text-muted small mt-1">${desc || ''}</div>
                <div class="mt-2 lifecycle-stage-segs" aria-hidden="true">
                  ${activeStageOrder.map((s, idx) => `<div class="seg ${idx < stageIdx ? 'past' : (idx === stageIdx ? 'active' : '')}" title="${stageLabel(s)}"></div>`).join('')}
                </div>
                <div class="small text-muted mt-1">${t('lbl_stage','Stage')}: ${stageLabel(stage)}</div>
              </div>
              <div class="text-end">
                <div class="fw-semibold">${t('lbl_quotes','Quotes')}: ${quoteGroups.length}</div>
                <div class="fw-semibold">${t('lbl_supplier','Supplier')}: ${quoteSuppliers.length}</div>
                <div class="fw-semibold">${t('lbl_items','Items')}: ${itemCount}</div>
                <div class="fw-semibold">${t('lbl_total','Total')}: $ ${totalQuoted.toLocaleString('es-CL')}</div>
                <div class="small text-muted mt-1">${t('lbl_created','Created')}: ${req.createdDate ? new Date(req.createdDate).toLocaleDateString() : '-'}</div>
                <div class="small text-muted">${t('lbl_updated','Updated')}: ${req.lastUpdated ? new Date(req.lastUpdated).toLocaleString() : '-'}</div>
              </div>
            </div>

            <div class="row g-2 mt-3">
              <div class="col-md-3"><div class="p-2 rounded bg-light"><div class="small text-muted">${t('lbl_quotes','Quotes')}</div><div class="fw-semibold">${quoteGroups.length}</div></div></div>
              <div class="col-md-3"><div class="p-2 rounded bg-light"><div class="small text-muted">${t('lbl_supplier','Supplier')}</div><div class="fw-semibold">${quoteSuppliers.length}</div></div></div>
              <div class="col-md-3"><div class="p-2 rounded bg-light"><div class="small text-muted">${t('lbl_items','Items')}</div><div class="fw-semibold">${quotedItemCount}/${itemCount}</div></div></div>
              <div class="col-md-3"><div class="p-2 rounded bg-light"><div class="small text-muted">${t('lbl_total','Total')}</div><div class="fw-semibold">$ ${totalQuoted.toLocaleString('es-CL')}</div></div></div>
            </div>

            <div class="mt-4 lifecycle-quote-groups"></div>
          </div>
        </div>
      `;

      // apply requirement-level color tint and badge color
      const reqColor = getStatusColor(stage);
      const reqTextColor = getContrastColor(reqColor);
      const cardElem = card.querySelector('.card');
      if(cardElem){
        cardElem.style.background = rgba(reqColor, 0.04);
        const badge = cardElem.querySelector('.lifecycle-stage-badge');
        if(badge){ badge.style.background = reqColor; badge.style.color = reqTextColor; badge.classList.remove('bg-secondary'); }
      }

      const quoteGroupsEl = card.querySelector('.lifecycle-quote-groups');
      if (quoteGroupsEl) {
        if (!quoteGroups.length) {
          const empty = document.createElement('div');
          empty.className = 'alert alert-info mb-0';
          empty.textContent = t('msg_no_quotes', 'No quotes yet');
          quoteGroupsEl.appendChild(empty);
        } else {
          quoteGroups.forEach(group => {
            const quoteItems = Array.isArray(group.items) ? group.items : [];
            const quoteStage = normalizeStage(group.stage);
            const quoteTotal = Number(group.total || 0) || 0;
            const quoteCard = document.createElement('div');
            quoteCard.className = 'card mb-3 border-primary-subtle';
            quoteCard.innerHTML = `
              <div class="card-header bg-transparent d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div>
                  <div class="fw-semibold">${t('lbl_quote','Quote')} ${group.quoteId || group.refCotiz || ''}</div>
                  <div class="small text-muted">${group.supplier || t('lbl_supplier','Supplier')}${group.date ? ' · ' + new Date(group.date).toLocaleString() : ''}</div>
                </div>
                <div class="text-end">
                  <span class="badge bg-info text-dark">${stageLabel(quoteStage)}</span>
                  <div class="small text-muted mt-1">$ ${quoteTotal.toLocaleString('es-CL')}</div>
                </div>
              </div>
              <div class="card-body">
                <div class="lifecycle-stage-segs mb-2" aria-hidden="true">
                  ${STAGE_ORDER.map((s, idx) => `<div class="seg ${idx < stageIndex(quoteStage) ? 'past' : (idx === stageIndex(quoteStage) ? 'active' : '')}" title="${stageLabel(s)}"></div>`).join('')}
                </div>
                <div class="small text-muted mb-2">${t('lbl_item_status','Item Status')}: ${quoteItems.length}</div>
                <div class="lifecycle-quote-items"></div>
              </div>
            `;

            // apply quote-level color tint and badge
            const quoteColor = getStatusColor(quoteStage);
            const quoteTextColor = getContrastColor(quoteColor);
            const qCardElem = quoteCard.querySelector('.card') || quoteCard;
            if(qCardElem){
              qCardElem.style.background = rgba(quoteColor, 0.03);
              const qBadge = quoteCard.querySelector('.badge');
              if(qBadge){ qBadge.style.background = quoteColor; qBadge.style.color = quoteTextColor; qBadge.classList.remove('bg-info','text-dark'); }
            }

            const itemsContainer = quoteCard.querySelector('.lifecycle-quote-items');
            if (itemsContainer) {
              if (!quoteItems.length) {
                const empty = document.createElement('div');
                empty.className = 'text-muted small';
                empty.textContent = t('msg_no_items', 'No items found');
                itemsContainer.appendChild(empty);
              } else {
                const list = document.createElement('div');
                list.className = 'list-group list-group-flush';
                quoteItems.forEach(entry => {
                  const item = entry.item || {};
                  const quoteRow = entry.quoteRow || {};
                  let itemStage = normalizeStage(quoteRow.estado || quoteRow.status || item.estado || 'Pending');
                  // For STORE orders, cap item status at "Received"
                  if (isStore && (itemStage === 'Final Received' || itemStage === 'Despatched')) {
                    itemStage = 'Received';
                  }
                  const itemStageIdx = stageIndex(itemStage);
                  const itemStageOrder = isStore ? STORE_STAGE_ORDER : STAGE_ORDER;
                  const price = Number(quoteRow.price || quoteRow.total || 0) || 0;
                  const quoteId = clean(quoteRow.quoteId || quoteRow.refCotiz || '');
                  const pdfUrl = clean(quoteRow.quoteLink || item.pdfUrl || '');
                  const row = document.createElement('div');
                  row.className = 'list-group-item';
                  // tint item row according to item stage
                  row.style.background = rgba(getStatusColor(itemStage), 0.04);
                  row.innerHTML = `
                    <div class="d-flex justify-content-between gap-2 align-items-start flex-wrap">
                      <div class="flex-grow-1">
                        <div class="fw-semibold">${clean(item.pn || '') || clean(item.geo || '') || t('lbl_items','Item')}</div>
                        <div class="small text-muted">${clean(item.geo || '')}${item.qty ? ' · ' + item.qty : ''}${item.desc ? ' · ' + item.desc : ''}</div>
                        <div class="small text-muted">${t('lbl_quote','Quote')}: ${quoteId || '-'}${pdfUrl ? ' · ' : ''}${pdfUrl ? `<a href="${pdfUrl}" target="_blank" rel="noopener">PDF</a>` : ''}</div>
                      </div>
                      <div class="text-end">
                        <span class="badge lifecycle-item-badge">${stageLabel(itemStage)}</span>
                        <div class="small text-muted mt-1">$ ${price.toLocaleString('es-CL')}</div>
                      </div>
                    </div>
                    <div class="lifecycle-stage-segs mt-2" aria-hidden="true">
                      ${itemStageOrder.map((s, idx) => `<div class="seg ${idx < itemStageIdx ? 'past' : (idx === itemStageIdx ? 'active' : '')}" title="${stageLabel(s)}"></div>`).join('')}
                    </div>
                  `;
                  // style the item badge
                  const itemBadge = row.querySelector('.lifecycle-item-badge');
                  if(itemBadge){ const c = getStatusColor(itemStage); itemBadge.style.background = c; itemBadge.style.color = getContrastColor(c); }
                  list.appendChild(row);
                });
                itemsContainer.appendChild(list);
              }
            }

            quoteGroupsEl.appendChild(quoteCard);
          });
        }
      }

      if (unquotedItems.length) {
        const unquoted = document.createElement('div');
        unquoted.className = 'card border-warning-subtle mt-3';
        unquoted.innerHTML = `
          <div class="card-header bg-transparent">
            <div class="fw-semibold">${t('msg_no_quotes','No quotes yet')}</div>
            <div class="small text-muted">${unquotedItems.length} ${t('lbl_items','Items')}</div>
          </div>
          <div class="card-body">
            <div class="list-group list-group-flush"></div>
          </div>
        `;
        const list = unquoted.querySelector('.list-group');
        unquotedItems.forEach(entry => {
          const item = entry.item || {};
          const row = document.createElement('div');
          row.className = 'list-group-item';
          row.innerHTML = `
            <div class="d-flex justify-content-between gap-2 align-items-start flex-wrap">
              <div class="flex-grow-1">
                <div class="fw-semibold">${clean(item.pn || '') || clean(item.geo || '') || t('lbl_items','Item')}</div>
                <div class="small text-muted">${clean(item.geo || '')}${item.qty ? ' · ' + item.qty : ''}${item.desc ? ' · ' + item.desc : ''}</div>
              </div>
              <div class="text-end"><span class="badge bg-warning text-dark">${t('msg_no_quotes','No quotes yet')}</span></div>
            </div>
          `;
          list.appendChild(row);
        });
        card.querySelector('.card-body').appendChild(unquoted);
      }

      container.appendChild(card);
    });
  }

  function wireEvents(){
    ['lifecycleDateFrom','lifecycleDateTo','lifecycleSiteFilter','lifecycleStageFilter'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.addEventListener('change', ()=> renderRequirementCards(filterRows()));
    });
    const search = document.getElementById('lifecycleSearch');
    if(search) search.addEventListener('input', ()=> renderRequirementCards(filterRows()));
    const csvBtn = document.getElementById('lifecycleExportCsv');
    if(csvBtn) csvBtn.onclick = exportCsv;
    const xlsxBtn = document.getElementById('lifecycleExportXlsx');
    if(xlsxBtn) xlsxBtn.onclick = exportXlsx;
    const pdfBtn = document.getElementById('lifecycleExportPdf');
    if(pdfBtn) pdfBtn.onclick = exportPdf;

    const container = document.getElementById('lifecycleCards');
    if(container){
      container.addEventListener('click', function(e){
        const btn = e.target.closest('[data-toggle-target]');
        if(!btn) return;
        const selector = btn.getAttribute('data-toggle-target');
        const target = selector ? btn.closest('.card')?.querySelector(selector) : null;
        if(target) target.classList.toggle('d-none');
      });
    }
  }

  /**
   * Helper to flatten nested requirement data into a simple grid for exports.
   * Resolves the "Undefined" rows issue in CSV/Excel.
   */
  function getFlatLifecycleData(rows) {
    const flat = [];
    rows.forEach(req => {
      const items = Array.isArray(req.items) ? req.items : [];
      items.forEach(item => {
        const quotes = Array.isArray(item.quotes) ? item.quotes : [];
        const base = { 
          Req: getReqOrderId(req), 
          Site: getReqSite(req), 
          Fecha: req.createdDate ? new Date(req.createdDate).toLocaleDateString() : '', 
          ReqStage: normalizeStage(req.stage || req.currentStage || '') 
        };
        
        if (quotes.length) {
          quotes.forEach(q => flat.push({ 
            ...base, 
            QuoteId: q.quoteId || q.refCotiz || '', 
            QuoteStage: normalizeStage(q.estado || q.status || ''), 
            Item: item.pn || item.geo || '', 
            Qty: item.qty || '', 
            ItemStage: normalizeStage(q.estado || q.status || item.estado || 'Pending'), 
            Price: q.price || q.total || '' 
          }));
        } else {
          flat.push({ 
            ...base, 
            QuoteId: '', 
            QuoteStage: '', 
            Item: item.pn || item.geo || '', 
            Qty: item.qty || '', 
            ItemStage: normalizeStage(item.estado || 'Pending'), 
            Price: '' 
          });
        }
      });
    });
    return flat;
  }

  function exportCsv(){
    const rows = filterRows();
    if(!rows.length) return alert(t('msg_no_data','No data'));
    const flat = getFlatLifecycleData(rows);
    const headers = [t('lbl_req','Req'), t('lbl_site','Site'), t('lbl_created','Date'), t('lbl_stage','Req Stage'), t('lbl_quote','Quote'), t('lbl_stage','Quote Stage'), t('lbl_items','Item'), t('lbl_qty','Qty'), t('lbl_item_status','Item Stage'), t('lbl_price','Price')];
    const keys = ['Req','Site','Fecha','ReqStage','QuoteId','QuoteStage','Item','Qty','ItemStage','Price'];

    google.script.run.withSuccessHandler(function(res){
      if(res && res.url) window.open(res.url, '_blank');
      else if(res && res.fileName) alert(t('msg_export_done','Export created: ') + res.fileName);
      else alert(t('msg_error','Error'));
    }).withFailureHandler(function(err){
      console.error(err);
      alert(t('msg_error','Error')+': '+String(err));
    }).master_ExportToDrive(flat, headers, keys, 'LifecycleReport', 'CSV');
  }

  function exportXlsx(){
    const rows = filterRows();
    if(!rows.length) return alert(t('msg_no_data','No data'));
    const flat = getFlatLifecycleData(rows);
    const headers = [t('lbl_req','Req'), t('lbl_site','Site'), t('lbl_created','Date'), t('lbl_stage','Req Stage'), t('lbl_quote','Quote'), t('lbl_stage','Quote Stage'), t('lbl_items','Item'), t('lbl_qty','Qty'), t('lbl_item_status','Item Stage'), t('lbl_price','Price')];
    const keys = ['Req','Site','Fecha','ReqStage','QuoteId','QuoteStage','Item','Qty','ItemStage','Price'];

    google.script.run.withSuccessHandler(function(res){
      if(res && res.url) window.open(res.url, '_blank');
      else if(res && res.fileName) alert(t('msg_export_done','Export created: ') + res.fileName);
      else alert(t('msg_error','Error'));
    }).withFailureHandler(function(err){
      console.error(err);
      alert(t('msg_error','Error')+': '+String(err));
    }).master_ExportToDrive(flat, headers, keys, 'LifecycleReport', 'EXCEL');
  }

  function exportPdf(){
    const rows = filterRows();
    if(!rows.length) return alert(t('msg_no_data','No data'));
    const flat = getFlatLifecycleData(rows);
    const headers = [t('lbl_req','Req'), t('lbl_site','Site'), t('lbl_created','Date'), t('lbl_stage','Req Stage'), t('lbl_quote','Quote'), t('lbl_stage','Quote Stage'), t('lbl_items','Item'), t('lbl_qty','Qty'), t('lbl_item_status','Item Stage'), t('lbl_price','Price')];
    const keys = ['Req','Site','Fecha','ReqStage','QuoteId','QuoteStage','Item','Qty','ItemStage','Price'];

    google.script.run.withSuccessHandler(function(res){
      if(res && res.url) window.open(res.url, '_blank');
      else if(res && res.fileName) alert(t('msg_export_done','Export created: ') + res.fileName);
      else alert(t('msg_error','Error'));
    }).withFailureHandler(function(err){
      console.error(err);
      alert(t('msg_error','Error')+': '+String(err));
    }).master_ExportToDrive(flat, headers, keys, 'LifecycleReport', 'PDF');
  }

  window.initLifecycleReportModule = function(){
    applyTranslations();
    populateStageFilter();
    const loading = document.getElementById('lifecycleLoading');
    const content = document.getElementById('lifecycleContent');
    if(!loading || !content) return;
    loading.classList.remove('d-none');
    content.classList.add('d-none');

    google.script.run.withSuccessHandler(function(rows){
      lifecycleRows = Array.isArray(rows) ? rows : [];
      populateSiteFilter(lifecycleRows);
      renderRequirementCards(filterRows());
      wireEvents();
      loading.classList.add('d-none');
      content.classList.remove('d-none');
    }).withFailureHandler(function(err){
      loading.innerHTML = `<div class="alert alert-danger">${t('msg_error','Error')}: ${String(err)}</div>`;
    }).getLifecycleReportData();
  };
})();
