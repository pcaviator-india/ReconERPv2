let canvas;
let currentTemplateId = null;
let persistentPrintQueue = [];
let printQueueItems = [];
let currentPreviewIndex = 0;
let isLiveDataView = false;
let currentUnit = 'px';
let canvasMargin = 0;
let canvasZoom = 1;
const DPI = 96;
let isMouseOverCanvas = false; // Track if mouse is over canvas viewport
let isInventoryLoading = false;

// Canonical database columns from products table & joined references
const PRODUCT_LABEL_COLUMNS = [
    { key: 'geo', label: 'GEO Code', legacyKeys: ['geo', 'GEO', 'geocode', 'GeoCode'] },
    { key: 'pn', label: 'Part Number (P/N)', legacyKeys: ['pn', 'PN', 'part_number', 'partNumber', 'product_number', 'P/N', 'p/n', 'p', 'P'] },
    { key: 'name', label: 'Product Name', legacyKeys: ['name', 'product_name', 'nombre'] },
    { key: 'description', label: 'Description (EN)', legacyKeys: ['description', 'en', 'desc_en', 'description_en', 'desc'] },
    { key: 'description_es', label: 'Description (ES)', legacyKeys: ['description_es', 'es', 'desc_es', 'descripcion', 'descripcion_es'] },
    { key: 'brand_name', label: 'Brand', legacyKeys: ['brand_name', 'brand', 'marca'] },
    { key: 'category_name', label: 'Category', legacyKeys: ['category_name', 'category', 'categoria'] },
    { key: 'sub_category_name', label: 'Subcategory', legacyKeys: ['sub_category_name', 'sub_category', 'subCategory', 'sub_categoria'] },
    { key: 'supplier_name', label: 'Supplier', legacyKeys: ['supplier_name', 'supplier', 'proveedor'] },
    { key: 'unit', label: 'Unit', legacyKeys: ['unit', 'un', 'unidad'] },
    { key: 'cost', label: 'Cost', legacyKeys: ['cost', 'costo_clp', 'costo'] },
    { key: 'stock', label: 'Stock Level', legacyKeys: ['stock', 'available_stock', 'cantidad'] },
    { key: 'min_qty', label: 'Min Qty', legacyKeys: ['min_qty', 'min', 'minimo'] },
    { key: 'max_qty', label: 'Max Qty', legacyKeys: ['max_qty', 'max', 'maximo'] },
    { key: 'eta', label: 'ETA', legacyKeys: ['eta'] }
];
window.PRODUCT_LABEL_COLUMNS = PRODUCT_LABEL_COLUMNS;

function normalizeLabelProduct(p) {
    if (!p || typeof p !== 'object') return {};
    const raw = p._raw || {};
    const pnVal = p.pn || p.PN || p.part_number || p.partNumber || p.product_number || p['P/N'] || p.p || raw.pn || raw.PN || raw.part_number || '';
    const descVal = p.description || raw.description || p.en || raw.en || '';
    const descEsVal = p.description_es || raw.description_es || p.es || raw.es || '';
    const nameVal = p.name || raw.name || descVal || descEsVal || '';
    const brandVal = p.brand_name || raw.brand_name || p.brand || p.marca || raw.marca || '';
    const catVal = p.category_name || raw.category_name || p.category || raw.category || '';
    const subCatVal = p.sub_category_name || raw.sub_category_name || p.subCategory || p.sub_categoria || raw.sub_categoria || '';
    const supVal = p.supplier_name || raw.supplier_name || p.supplier || p.proveedor || raw.proveedor || '';
    const unitVal = p.unit || raw.unit || p.un || raw.un || '';
    const costVal = Number(p.cost !== undefined ? p.cost : (raw.cost !== undefined ? raw.cost : (p.costo_clp !== undefined ? p.costo_clp : 0))) || 0;
    const stockVal = Number(p.stock !== undefined ? p.stock : (raw.stock !== undefined ? raw.stock : 0)) || 0;
    const minVal = Number(p.min_qty !== undefined ? p.min_qty : (raw.min_qty !== undefined ? raw.min_qty : (p.min !== undefined ? p.min : 0))) || 0;
    const maxVal = Number(p.max_qty !== undefined ? p.max_qty : (raw.max_qty !== undefined ? raw.max_qty : (p.max !== undefined ? p.max : 0))) || 0;
    const etaVal = p.eta || raw.eta || '';

    return {
        ...p,
        id: p.id || p.geo || raw.geo || '',
        geo: p.geo || raw.geo || '',
        pn: pnVal,
        PN: pnVal,
        name: nameVal,
        description: descVal,
        description_es: descEsVal,
        en: descVal,
        es: descEsVal,
        brand_name: brandVal,
        marca: brandVal,
        brand: brandVal,
        category_name: catVal,
        category: catVal,
        sub_category_name: subCatVal,
        sub_categoria: subCatVal,
        supplier_name: supVal,
        proveedor: supVal,
        unit: unitVal,
        un: unitVal,
        cost: costVal,
        costo_clp: costVal,
        stock: stockVal,
        min_qty: minVal,
        min: minVal,
        max_qty: maxVal,
        max: maxVal,
        eta: etaVal,
        is_active: p.is_active !== undefined ? p.is_active : (raw.is_active !== undefined ? raw.is_active : 1)
    };
}
window.normalizeLabelProduct = normalizeLabelProduct;

function getProductFieldValue(item, key) {
    if (!item || typeof item !== 'object') return '';
    const trimmed = String(key || '').trim();
    if (!trimmed) return '';
    const lowerKey = trimmed.toLowerCase();

    function extract(obj, k) {
        if (!obj || typeof obj !== 'object') return undefined;
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
            return obj[k];
        }
        const lk = k.toLowerCase();
        for (const prop of Object.keys(obj)) {
            if (prop.toLowerCase() === lk && obj[prop] !== undefined && obj[prop] !== null && obj[prop] !== '') {
                return obj[prop];
            }
        }
        return undefined;
    }

    let val = extract(item, trimmed);
    if (val !== undefined) return val;

    const colDef = PRODUCT_LABEL_COLUMNS.find(c =>
        c.key.toLowerCase() === lowerKey ||
        (c.legacyKeys && c.legacyKeys.some(lk => lk.toLowerCase() === lowerKey))
    );

    if (colDef) {
        val = extract(item, colDef.key);
        if (val !== undefined) return val;

        if (colDef.legacyKeys) {
            for (const lk of colDef.legacyKeys) {
                val = extract(item, lk);
                if (val !== undefined) return val;
            }
        }
    }

    if (item._raw && typeof item._raw === 'object') {
        val = extract(item._raw, trimmed);
        if (val !== undefined) return val;

        if (colDef) {
            val = extract(item._raw, colDef.key);
            if (val !== undefined) return val;

            if (colDef.legacyKeys) {
                for (const lk of colDef.legacyKeys) {
                    val = extract(item._raw, lk);
                    if (val !== undefined) return val;
                }
            }
        }
    }

    if (lowerKey === 'name') {
        val = extract(item, 'description') || extract(item, 'description_es') || extract(item, 'en') || extract(item, 'es');
        if (val !== undefined) return val;
    }

    if (lowerKey === 'pn' || lowerKey === 'part_number' || lowerKey === 'partnumber' || lowerKey === 'p/n') {
        val = extract(item, 'pn') || extract(item, 'part_number') || extract(item, 'partNumber') || extract(item, 'product_number') || extract(item, 'P/N') || extract(item, 'p');
        if (val !== undefined) return val;
        if (item._raw) {
            val = extract(item._raw, 'pn') || extract(item._raw, 'part_number') || extract(item._raw, 'partNumber') || extract(item._raw, 'product_number') || extract(item._raw, 'P/N');
            if (val !== undefined) return val;
        }
    }

    return '';
}
window.getProductFieldValue = getProductFieldValue;

async function loadInventoryForLabels() {
    if (window.fullInventory && Array.isArray(window.fullInventory) && window.fullInventory.length > 0) {
        window.fullInventory = window.fullInventory.map(normalizeLabelProduct);
        return window.fullInventory;
    }
    if (isInventoryLoading) return window.fullInventory || [];
    isInventoryLoading = true;

    try {
        if (typeof RECON_API !== 'undefined' && typeof RECON_API.getProducts === 'function') {
            const pageSize = 5000;
            const products = [];
            let page = 1;
            let total = null;

            do {
                const resp = await RECON_API.getProducts({ page, limit: pageSize });
                const pageProducts = Array.isArray(resp?.data) ? resp.data : [];
                products.push(...pageProducts);
                total = Number(resp?.pagination?.total);

                if (pageProducts.length === 0 || pageProducts.length < pageSize) {
                    break;
                }
                page += 1;
            } while (total === null || products.length < total);

            window.fullInventory = products.map(normalizeLabelProduct);
        }
    } catch (err) {
        console.error("Failed to load inventory for Labels module:", err);
    } finally {
        isInventoryLoading = false;
    }
    return window.fullInventory || [];
}

window.initLabelsModule = function () {
    if (typeof fabric === 'undefined') {
        setTimeout(window.initLabelsModule, 100);
        return;
    }

    if (!canvas) {
        canvas = new fabric.Canvas('labelCanvas', {
            backgroundColor: '#ffffff',
            preserveObjectStacking: true
        });

        // Make canvas globally accessible for debugging
        window.canvas = canvas;

        canvas.on('selection:created', handleObjectSelected);
        canvas.on('selection:updated', handleObjectSelected);
        canvas.on('selection:cleared', handleObjectCleared);
        canvas.on('object:modified', (e) => {
            if (!isLiveDataView) updateLayerTree();
            clearAlignmentLines();
            // Handle rotation snapping to 5° increments
            handleRotationSnap(e);
        });
        canvas.on('object:added', () => { if (!isLiveDataView) updateLayerTree(); });
        canvas.on('object:removed', () => { if (!isLiveDataView) updateLayerTree(); });
        canvas.on('object:moving', handleObjectMoving);
        canvas.on('mouse:up', handleMouseUp);
        canvas.on('mouse:down', () => { clearAlignmentLines(); });
    }

    // Fix: Properly initialize and show the default Bootstrap tab on load
    const designerTabBtn = document.getElementById('designer-tab');
    if (designerTabBtn) {
        const tabInstance = bootstrap.Tab.getOrCreateInstance(designerTabBtn);
        tabInstance.show();
    }

    // Populate columns list immediately with canonical columns
    populateDbColumnsDropdowns();
    // Ensure full inventory data is fetched in background
    ensureInventoryColumnsLoaded();
    updateLayerTree();
    syncCanvasSizeInputs();
    console.log("BarTender-style Unified Labels module initialized with updated products schema.");
};

async function ensureInventoryColumnsLoaded(retries = 10) {
    if (window.fullInventory && Array.isArray(window.fullInventory) && window.fullInventory.length > 0) {
        window.fullInventory = window.fullInventory.map(normalizeLabelProduct);
        populateDbColumnsDropdowns(window.fullInventory[0]);
    } else {
        const inv = await loadInventoryForLabels();
        if (inv && inv.length > 0) {
            populateDbColumnsDropdowns(inv[0]);
        } else if (retries > 0) {
            setTimeout(() => ensureInventoryColumnsLoaded(retries - 1), 300);
        } else {
            populateDbColumnsDropdowns();
        }
    }
}

function populateDbColumnsDropdowns(sampleItem) {
    const dbColumnsListEl = document.getElementById('db-columns-list');
    const propDbColEl = document.getElementById('prop-db-col');
    if (!dbColumnsListEl || !propDbColEl) return;

    const currentSelectedVal = propDbColEl.value;

    dbColumnsListEl.innerHTML = '';
    propDbColEl.innerHTML = '<option value="" data-i18n="lbl_db_col_none">-- None (Static) --</option>';

    // 1. Render Canonical Product Columns
    PRODUCT_LABEL_COLUMNS.forEach(col => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'list-group-item list-group-item-action list-group-item-light py-1 px-2 small d-flex justify-content-between align-items-center';
        item.innerHTML = `<span><i class="bi bi-database me-1 text-primary"></i> ${col.label}</span><code class="text-muted" style="font-size: 10px;">{{${col.key}}}</code>`;
        item.title = `Click to bind {{${col.key}}}`;
        item.onclick = () => addDynamicField(col.key);
        dbColumnsListEl.appendChild(item);

        const opt = document.createElement('option');
        opt.value = col.key;
        opt.textContent = `${col.label} (${col.key})`;
        propDbColEl.appendChild(opt);
    });

    // 2. Discover any additional custom columns from sample item
    if (sampleItem && typeof sampleItem === 'object') {
        const standardKeys = new Set([
            'id', '_raw', 'is_active', 'created_at', 'updated_at',
            ...PRODUCT_LABEL_COLUMNS.map(c => c.key.toLowerCase()),
            ...PRODUCT_LABEL_COLUMNS.flatMap(c => (c.legacyKeys || []).map(lk => lk.toLowerCase()))
        ]);

        const extraKeys = Object.keys(sampleItem).filter(k => !standardKeys.has(k.toLowerCase()));
        if (extraKeys.length > 0) {
            extraKeys.forEach(col => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'list-group-item list-group-item-action list-group-item-light py-1 px-2 small d-flex justify-content-between align-items-center';
                item.innerHTML = `<span><i class="bi bi-tag me-1 text-secondary"></i> ${col}</span><code class="text-muted" style="font-size: 10px;">{{${col}}}</code>`;
                item.title = `Click to bind {{${col}}}`;
                item.onclick = () => addDynamicField(col);
                dbColumnsListEl.appendChild(item);

                const opt = document.createElement('option');
                opt.value = col;
                opt.textContent = `${col}`;
                propDbColEl.appendChild(opt);
            });
        }
    }

    if (currentSelectedVal) {
        propDbColEl.value = currentSelectedVal;
    }
}

function syncCanvasSizeInputs() {
    if (!canvas) return;
    let wPx = canvas.width;
    let hPx = canvas.height;
    let valW = wPx, valH = hPx;
    let valMargin = canvasMargin;

    if (currentUnit === 'in') {
        valW = +(wPx / DPI).toFixed(2);
        valH = +(hPx / DPI).toFixed(2);
        valMargin = +(canvasMargin / DPI).toFixed(2);
    } else if (currentUnit === 'cm') {
        valW = +((wPx / DPI) * 2.54).toFixed(2);
        valH = +((hPx / DPI) * 2.54).toFixed(2);
        valMargin = +((canvasMargin / DPI) * 2.54).toFixed(2);
    } else if (currentUnit === 'mm') {
        valW = +((wPx / DPI) * 25.4).toFixed(1);
        valH = +((hPx / DPI) * 25.4).toFixed(1);
        valMargin = +((canvasMargin / DPI) * 25.4).toFixed(1);
    }

    const wInput = document.getElementById('prop-canvas-w');
    const hInput = document.getElementById('prop-canvas-h');
    const marginInput = document.getElementById('prop-canvas-margin');
    if (wInput) wInput.value = valW;
    if (hInput) hInput.value = valH;
    if (marginInput) marginInput.value = valMargin;
}

function changeCanvasUnit(newUnit) {
    currentUnit = newUnit;
    syncCanvasSizeInputs();
}

function updateCanvasFromProperties() {
    let valW = parseFloat(document.getElementById('prop-canvas-w').value) || 100;
    let valH = parseFloat(document.getElementById('prop-canvas-h').value) || 100;
    let valMargin = parseFloat(document.getElementById('prop-canvas-margin')?.value) || 0;
    let wPx = valW, hPx = valH, mPx = valMargin;

    if (currentUnit === 'in') {
        wPx = Math.round(valW * DPI);
        hPx = Math.round(valH * DPI);
        mPx = Math.round(valMargin * DPI);
    } else if (currentUnit === 'cm') {
        wPx = Math.round((valW / 2.54) * DPI);
        hPx = Math.round((valH / 2.54) * DPI);
        mPx = Math.round((valMargin / 2.54) * DPI);
    } else if (currentUnit === 'mm') {
        wPx = Math.round((valW / 25.4) * DPI);
        hPx = Math.round((valH / 25.4) * DPI);
        mPx = Math.round((valMargin / 25.4) * DPI);
    }

    // 1. Set dimensions using Fabric.js built-in API
    canvas.setDimensions({
        width: wPx,
        height: hPx
    });

    // 2. Forcefully override height and width on Fabric's wrapper element container
    if (canvas.wrapperEl) {
        canvas.wrapperEl.style.width = wPx + 'px';
        canvas.wrapperEl.style.height = hPx + 'px';
    }

    // 3. Forcefully override height and width on the lower and upper HTML canvas elements
    if (canvas.lowerCanvasEl) {
        canvas.lowerCanvasEl.style.width = wPx + 'px';
        canvas.lowerCanvasEl.style.height = hPx + 'px';
    }
    if (canvas.upperCanvasEl) {
        canvas.upperCanvasEl.style.width = wPx + 'px';
        canvas.upperCanvasEl.style.height = hPx + 'px';
    }

    canvasMargin = mPx;
    redrawMarginOverlay();
    canvas.renderAll();
}

function zoomCanvas(factor) {
    if (factor < 1) {
        canvasZoom = Math.max(0.3, canvasZoom * 0.9);
    } else {
        canvasZoom = Math.min(3.0, canvasZoom * 1.1);
    }
    applyCanvasZoom();
}

function resetCanvasZoom() {
    canvasZoom = 1.0;
    applyCanvasZoom();
}

function applyCanvasZoom() {
    const scaler = document.getElementById('canvas-scaler');
    if (scaler) {
        scaler.style.transform = `scale(${canvasZoom})`;
    }

    const indicator = document.getElementById('zoom-indicator');
    if (indicator) {
        indicator.textContent = `${Math.round(canvasZoom * 100)}%`;
    }
}

// Enable Mouse Wheel Zooming over the Canvas Viewport (Blocks browser zoom and scales canvas instead)
document.addEventListener('DOMContentLoaded', () => {
    const viewport = document.getElementById('canvas-viewport');
    if (viewport) {
        // Track mouse position over canvas
        viewport.addEventListener('mouseenter', () => { isMouseOverCanvas = true; });
        viewport.addEventListener('mouseleave', () => { isMouseOverCanvas = false; });

        viewport.addEventListener('wheel', function (e) {
            // Only block browser zoom when mouse is over canvas viewport
            if (isMouseOverCanvas && e.ctrlKey) {
                e.preventDefault(); // Stop browser from zooming the web page
                e.stopPropagation(); // Prevent event from bubbling up
                if (e.deltaY < 0) {
                    zoomCanvas(1.1); // Zoom in
                } else {
                    zoomCanvas(0.9); // Zoom out
                }
            }
        }, { passive: false });
    }
});

function redrawMarginOverlay() {
    const existing = canvas.getObjects().find(o => o.isMarginOverlay);
    if (existing) canvas.remove(existing);

    // Always draw a boundary representation so the canvas wrapper and visual bounds match perfectly
    const marginRect = new fabric.Rect({
        left: canvasMargin || 0,
        top: canvasMargin || 0,
        width: canvas.width - ((canvasMargin || 0) * 2),
        height: canvas.height - ((canvasMargin || 0) * 2),
        fill: 'transparent',
        stroke: canvasMargin > 0 ? '#ff9800' : 'transparent', // Orange dashed if margin exists, invisible border if 0
        strokeWidth: 1,
        strokeDashArray: canvasMargin > 0 ? [4, 4] : null,
        selectable: false,
        evented: false,
        isMarginOverlay: true
    });

    canvas.add(marginRect);
    marginRect.sendToBack();
}

// Smart Alignment & Snapping Engine
let alignmentLines = [];

function clearAlignmentLines() {
    alignmentLines.forEach(line => canvas.remove(line));
    alignmentLines = [];
    canvas.renderAll();
}

// Check if snapping is enabled via checkbox
function isSnappingEnabled() {
    const checkbox = document.getElementById('snapping-toggle');
    return checkbox ? checkbox.checked : true;
}

function handleObjectMoving(e) {
    const obj = e.target;
    clearAlignmentLines();

    // If snapping is disabled, don't do anything during move
    if (!isSnappingEnabled()) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const objectCenter = obj.getCenterPoint();
    const objectWidth = obj.getScaledWidth();
    const objectHeight = obj.getScaledHeight();

    // Increased threshold from 5 to 10 for softer snapping
    const threshold = 10;
    let snapX = null;
    let snapY = null;

    const canvasCenterX = canvasWidth / 2;
    const canvasCenterY = canvasHeight / 2;

    if (Math.abs(objectCenter.x - canvasCenterX) < threshold) {
        snapX = canvasCenterX - (objectWidth / 2);
        drawVerticalGuide(canvasCenterX);
    }
    if (Math.abs(objectCenter.y - canvasCenterY) < threshold) {
        snapY = canvasCenterY - (objectHeight / 2);
        drawHorizontalGuide(canvasCenterY);
    }

    canvas.getObjects().forEach(target => {
        if (target === obj || target.isMarginOverlay) return;

        const targetCenter = target.getCenterPoint();
        const targetWidth = target.getScaledWidth();
        const targetHeight = target.getScaledHeight();

        if (Math.abs(objectCenter.x - targetCenter.x) < threshold) {
            snapX = targetCenter.x - (objectWidth / 2);
            drawVerticalGuide(targetCenter.x);
        }
        if (Math.abs(objectCenter.y - targetCenter.y) < threshold) {
            snapY = targetCenter.y - (objectHeight / 2);
            drawHorizontalGuide(targetCenter.y);
        }

        if (Math.abs(obj.left - target.left) < threshold) {
            snapX = target.left;
            drawVerticalGuide(target.left);
        }
        const objRight = obj.left + objectWidth;
        const targetRight = target.left + targetWidth;
        if (Math.abs(objRight - targetRight) < threshold) {
            snapX = targetRight - objectWidth;
            drawVerticalGuide(targetRight);
        }
    });

    if (snapX !== null) obj.set('left', snapX);
    if (snapY !== null) obj.set('top', snapY);

    // Update coordinates to fix control positions (markers)
    if (snapX !== null || snapY !== null) {
        obj.setCoords();
    }
}

// Snap on mouse up for more precise positioning
function handleMouseUp(e) {
    clearAlignmentLines();

    const obj = e.target;
    if (!obj || !isSnappingEnabled()) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const objectCenter = obj.getCenterPoint();
    const objectWidth = obj.getScaledWidth();
    const objectHeight = obj.getScaledHeight();

    const threshold = 10;
    let snapX = null;
    let snapY = null;

    const canvasCenterX = canvasWidth / 2;
    const canvasCenterY = canvasHeight / 2;

    // Canvas center snapping
    if (Math.abs(objectCenter.x - canvasCenterX) < threshold) {
        snapX = canvasCenterX - (objectWidth / 2);
        drawVerticalGuide(canvasCenterX);
    }
    if (Math.abs(objectCenter.y - canvasCenterY) < threshold) {
        snapY = canvasCenterY - (objectHeight / 2);
        drawHorizontalGuide(canvasCenterY);
    }

    // Object-to-object snapping
    canvas.getObjects().forEach(target => {
        if (target === obj || target.isMarginOverlay) return;

        const targetCenter = target.getCenterPoint();
        const targetWidth = target.getScaledWidth();
        const targetHeight = target.getScaledHeight();

        if (Math.abs(objectCenter.x - targetCenter.x) < threshold) {
            snapX = targetCenter.x - (objectWidth / 2);
            drawVerticalGuide(targetCenter.x);
        }
        if (Math.abs(objectCenter.y - targetCenter.y) < threshold) {
            snapY = targetCenter.y - (objectHeight / 2);
            drawHorizontalGuide(targetCenter.y);
        }

        if (Math.abs(obj.left - target.left) < threshold) {
            snapX = target.left;
            drawVerticalGuide(target.left);
        }
        const objRight = obj.left + objectWidth;
        const targetRight = target.left + targetWidth;
        if (Math.abs(objRight - targetRight) < threshold) {
            snapX = targetRight - objectWidth;
            drawVerticalGuide(targetRight);
        }
    });

    if (snapX !== null) obj.set('left', snapX);
    if (snapY !== null) obj.set('top', snapY);

    if (snapX !== null || snapY !== null) {
        obj.setCoords();
        canvas.renderAll();
    }
}

// Handle rotation snapping to 5-degree increments
function handleRotationSnap(e) {
    const obj = e.target;
    if (!obj) return;

    // Check if rotation snapping is enabled via checkbox or Shift key
    const checkbox = document.getElementById('rotation-snap-toggle');
    const rotationSnapEnabled = checkbox ? checkbox.checked : false;
    const useShift = e.shiftKey;

    if (!rotationSnapEnabled && !useShift) return;

    const increment = 5;
    const currentAngle = obj.angle || 0;
    const snappedAngle = Math.round(currentAngle / increment) * increment;

    if (Math.abs(currentAngle - snappedAngle) > 0.1) {
        obj.set('angle', snappedAngle);
        obj.setCoords();
        canvas.renderAll();
    }
}

function drawVerticalGuide(xCoord) {
    const line = new fabric.Line([xCoord, 0, xCoord, canvas.height], {
        stroke: 'red',
        strokeWidth: 1,
        strokeDashArray: [3, 3],
        selectable: false,
        evented: false
    });
    canvas.add(line);
    alignmentLines.push(line);
}

function drawHorizontalGuide(yCoord) {
    const line = new fabric.Line([0, yCoord, canvas.width, yCoord], {
        stroke: 'red',
        strokeWidth: 1,
        strokeDashArray: [3, 3],
        selectable: false,
        evented: false
    });
    canvas.add(line);
    alignmentLines.push(line);
}

function addDynamicField(columnName) {
    if (isLiveDataView) refreshCanvasPlaceholderData();

    const colDef = PRODUCT_LABEL_COLUMNS.find(c => c.key === columnName);
    const labelTitle = colDef ? colDef.label : columnName;

    const textObj = new fabric.Textbox(`{{${columnName}}}`, {
        left: Math.max(30, canvasMargin + 10), top: Math.max(30, canvasMargin + 10), width: 180, fontSize: 16, fontFamily: 'Arial', fill: '#000000', textAlign: 'left', editable: true
    });
    textObj.db_col = columnName;
    textObj.rawTemplateText = `{{${columnName}}}`;
    textObj.elementName = labelTitle + " Field";

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    if (canvasMargin > 0) redrawMarginOverlay();
    canvas.renderAll();

    if (isLiveDataView) refreshCanvasLiveData();
    updateLayerTree();
}

function addTextbox() {
    if (isLiveDataView) refreshCanvasPlaceholderData();

    const textObj = new fabric.Textbox('Static Text', {
        left: Math.max(30, canvasMargin + 10), top: Math.max(30, canvasMargin + 10), width: 150, fontSize: 16, fontFamily: 'Arial', fill: '#000000', textAlign: 'left', editable: true
    });
    textObj.rawTemplateText = 'Static Text';
    textObj.elementName = "Text Block";

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    if (canvasMargin > 0) redrawMarginOverlay();
    canvas.renderAll();

    if (isLiveDataView) refreshCanvasLiveData();
    updateLayerTree();
}

function addBarcode() {
    if (isLiveDataView) refreshCanvasPlaceholderData();

    const barcodeObj = new fabric.Rect({
        left: Math.max(30, canvasMargin + 10), top: Math.max(80, canvasMargin + 10), width: 180, height: 70, fill: '#ffffff', stroke: '#000000', strokeWidth: 1, rx: 2, ry: 2
    });

    barcodeObj.isBarcode = true;
    barcodeObj.db_col = 'geo';
    barcodeObj.elementName = "Barcode (CODE128)";
    barcodeObj.barcodeFormat = "CODE128";
    barcodeObj.showText = true;
    barcodeObj.fontFamily = "monospace";
    barcodeObj.fontSize = 12;
    barcodeObj.textAlign = "center"; // Barcode text alignment option
    barcodeObj.fillColor = "#000000";
    barcodeObj.rawTemplateText = "{{geo}}";

    canvas.add(barcodeObj);
    canvas.setActiveObject(barcodeObj);
    if (canvasMargin > 0) redrawMarginOverlay();
    canvas.renderAll();

    if (isLiveDataView) refreshCanvasLiveData();
    updateLayerTree();
}

function updateLayerTree() {
    const layerListEl = document.getElementById('layer-list');
    if (!layerListEl || !canvas) return;
    layerListEl.innerHTML = '';

    const objects = canvas.getObjects().filter(o => !o.isMarginOverlay);
    if (objects.length === 0) {
        layerListEl.innerHTML = '<li class="list-group-item text-muted small fst-italic">No layers on canvas</li>';
        return;
    }

    objects.forEach((obj, idx) => {
        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center py-1 px-2 small';
        li.innerHTML = `<span>${idx + 1}. ${obj.elementName || obj.type}</span>`;
        li.style.cursor = 'pointer';
        li.onclick = () => { canvas.setActiveObject(obj); canvas.renderAll(); };
        layerListEl.appendChild(li);
    });
}

function handleObjectSelected(e) {
    const obj = e.selected[0];
    if (!obj || obj.isMarginOverlay) return;

    document.getElementById('canvas-properties').style.display = 'none';
    document.getElementById('object-properties').style.display = 'block';

    document.getElementById('prop-name').value = obj.elementName || '';
    document.getElementById('prop-text').value = obj.rawTemplateText || obj.text || '';

    const propDbColEl = document.getElementById('prop-db-col');
    if (propDbColEl) {
        let valToSet = obj.db_col || '';
        if (valToSet && !Array.from(propDbColEl.options).some(o => o.value === valToSet)) {
            const matchedCol = PRODUCT_LABEL_COLUMNS.find(c => c.legacyKeys && c.legacyKeys.includes(valToSet));
            if (matchedCol) {
                valToSet = matchedCol.key;
            } else {
                const opt = document.createElement('option');
                opt.value = valToSet;
                opt.textContent = `${valToSet} (legacy)`;
                propDbColEl.appendChild(opt);
            }
        }
        propDbColEl.value = valToSet;
    }

    document.getElementById('prop-font').value = obj.fontFamily || 'Arial';
    document.getElementById('prop-fontsize').value = obj.fontSize || 16;

    // Toggle barcode vs textbox specific property blocks
    const barcodeFields = document.getElementById('barcode-specific-properties');
    const standardTextAlignContainer = document.getElementById('standard-text-align-container');

    if (barcodeFields) {
        barcodeFields.style.display = obj.isBarcode ? 'block' : 'none';
    }
    if (standardTextAlignContainer) {
        standardTextAlignContainer.style.display = obj.isBarcode ? 'none' : 'block';
    }

    if (obj.isBarcode) {
        const showTextChk = document.getElementById('prop-barcode-showtext');
        if (showTextChk) showTextChk.checked = obj.showText !== false;

        const alignSel = document.getElementById('prop-barcode-align');
        if (alignSel) alignSel.value = obj.textAlign || 'center';
    } else {
        const textAlignSel = document.getElementById('prop-text-align');
        if (textAlignSel) textAlignSel.value = obj.textAlign || 'left';
    }
}

function handleObjectCleared() {
    document.getElementById('canvas-properties').style.display = 'block';
    document.getElementById('object-properties').style.display = 'none';
    syncCanvasSizeInputs();
}

// Helper to always fetch the *currently selected* live data row/item
function getCurrentLiveItem() {
    // 1. Check if there are items in printQueueItems (current preview)
    if (typeof printQueueItems !== 'undefined' && Array.isArray(printQueueItems) && printQueueItems.length > 0) {
        let idx = typeof currentPreviewIndex !== 'undefined' ? currentPreviewIndex : 0;
        return printQueueItems[idx] || printQueueItems[0] || {};
    }
    // 2. Check if persistentPrintQueue has items
    if (typeof persistentPrintQueue !== 'undefined' && Array.isArray(persistentPrintQueue) && persistentPrintQueue.length > 0) {
        return persistentPrintQueue[0].item || {};
    }
    // 3. Fallback to first item of window.fullInventory
    if (typeof window.fullInventory !== 'undefined' && Array.isArray(window.fullInventory) && window.fullInventory.length > 0) {
        return window.fullInventory[0] || {};
    }
    // 4. Other legacy variables
    if (typeof currentLiveItem !== 'undefined' && currentLiveItem) return currentLiveItem;
    if (typeof currentLiveDataSample !== 'undefined' && currentLiveDataSample) return currentLiveDataSample;
    if (typeof activeLiveDataItem !== 'undefined' && activeLiveDataItem) return activeLiveDataItem;

    return {};
}

function updateProperty(property, value) {
    const activeObj = canvas.getActiveObject();
    if (!activeObj || activeObj.isMarginOverlay) return;

    const sampleItem = getCurrentLiveItem();

    if (property === 'name') {
        activeObj.elementName = value;
        updateLayerTree();
    } else if (property === 'db_col') {
        activeObj.db_col = value;
        if (value && activeObj.type === 'textbox') {
            activeObj.rawTemplateText = `{{${value}}}`;
            const propTextEl = document.getElementById('prop-text');
            if (propTextEl) propTextEl.value = activeObj.rawTemplateText;
        } else if (value && activeObj.isBarcode) {
            activeObj.rawTemplateText = `{{${value}}}`;
        }
        if (isLiveDataView) {
            refreshCanvasLiveData();
        } else {
            refreshCanvasPlaceholderData();
        }
    } else if (property === 'text') {
        activeObj.rawTemplateText = value;

        if (isLiveDataView) {
            // Only refresh live data if this is NOT a plain textbox being edited
            // (prevents barcode from stealing focus while typing)
            if (activeObj.isBarcode) {
                refreshCanvasLiveData();
            } else {
                // For normal textboxes just update the visible text
                activeObj.set('text', value);
                canvas.renderAll();
            }
        } else {
            activeObj.set('text', value);
            canvas.renderAll();
        }
    } else if (property === 'showText' || property === 'barcodeFormat') {
        activeObj[property] = value;
        if (isLiveDataView && activeObj.isBarcode) {
            updateBarcodeObjectLive(activeObj, sampleItem);
        }
    } else if (property === 'textAlign') {
        activeObj.textAlign = value;
        if (activeObj.type === 'textbox') {
            activeObj.set('textAlign', value);
            activeObj.dirty = true;
            if (typeof activeObj.initDimensions === 'function') {
                activeObj.initDimensions();
            }
            activeObj.setCoords();
        }
        if (isLiveDataView && activeObj.isBarcode) {
            activeObj.textAlign = value;
            updateBarcodeObjectLive(activeObj, sampleItem);
        }
        canvas.renderAll();
    } else if (property === 'fontFamily' || property === 'fontSize') {
        activeObj.set(property, value);
        if (activeObj.type === 'textbox') {
            activeObj.set(property, value);
            activeObj.dirty = true;
            if (typeof activeObj.initDimensions === 'function') {
                activeObj.initDimensions();
            }
            activeObj.setCoords();
        }
        if (isLiveDataView && activeObj.isBarcode) {
            activeObj[property] = value;
            updateBarcodeObjectLive(activeObj, sampleItem);
        }
        canvas.renderAll();
    } else {
        activeObj.set(property, value);
        canvas.renderAll();
    }
}

function deleteSelectedObject() {
    const activeObj = canvas.getActiveObject();
    if (activeObj && !activeObj.isMarginOverlay) {
        canvas.remove(activeObj);
        canvas.discardActiveObject();
        canvas.renderAll();
        handleObjectCleared();
        updateLayerTree();
    }
}

function createNewLabel() {
    if (confirm("Clear canvas and start a new label? Unsaved changes will be lost.")) {
        if (isLiveDataView) toggleLiveDataView();
        canvas.clear();
        canvas.setBackgroundColor('#ffffff', () => { canvas.renderAll(); });
        currentTemplateId = null;
        canvasMargin = 0;
        resetCanvasZoom();
        const nameInput = document.getElementById('template-name-input');
        if (nameInput) nameInput.value = "New Label Template";
        updateLayerTree();
        handleObjectCleared();
    }
}

function saveTemplateJSON() {
    let wasInLive = isLiveDataView;
    if (wasInLive) refreshCanvasPlaceholderData();

    const marginOverlay = canvas.getObjects().find(o => o.isMarginOverlay);
    if (marginOverlay) canvas.remove(marginOverlay);

    const canvasJson = canvas.toJSON([
        'isBarcode', 'db_col', 'elementName', 'barcodeFormat', 'showText',
        'fontFamily', 'fontSize', 'fillColor', 'rawTemplateText',
        'isLiveBarcodeImage', 'textAlign'
    ]);

    if (marginOverlay) {
        canvas.add(marginOverlay);
        marginOverlay.sendToBack();
    }
    if (wasInLive) refreshCanvasLiveData();

    const templateData = {
        templateId: currentTemplateId || "template_" + Date.now(),
        templateName: document.getElementById('template-name-input')?.value || "Default Label",
        elementsJson: JSON.stringify(canvasJson),

        // ===== ADD THESE =====
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
        // =====================
    };

    google.script.run
        .withSuccessHandler(res => {
            alert(res.message || "Template saved successfully!");
            currentTemplateId = templateData.templateId;
            loadTemplatesList();
        })
        .withFailureHandler(err => {
            console.error("Failed to save template:", err);
            alert("Error saving template.");
        })
        .saveLabelTemplate(templateData);
}

function loadTemplatesList() {
    google.script.run.withSuccessHandler(templates => {
        const tbody = document.querySelector('#templates-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!templates || !Array.isArray(templates) || templates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No saved templates found.</td></tr>';
            return;
        }

        templates.forEach((t) => {
            tbody.innerHTML += `
                <tr>
                    <td><code>${t.templateId}</code></td>
                    <td class="fw-bold">${t.templateName}</td>
                    <td class="small text-muted">${new Date(t.updatedAt).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-outline-primary btn-sm me-1 p-1 px-2" title="Edit Template" onclick="loadTemplateIntoCanvas('${t.templateId}')">✏️ Edit</button>
                        <button class="btn btn-outline-danger btn-sm p-1 px-2" title="Delete Template" onclick="deleteTemplateFromDb('${t.templateId}')">🗑️</button>
                    </td>
                </tr>`;
        });
    }).getLabelTemplates();
}

function loadTemplateIntoCanvas(templateId) {
    if (isLiveDataView) toggleLiveDataView();

    google.script.run.withSuccessHandler(template => {
        if (template && template.elementsJson) {
            currentTemplateId = template.templateId;

            const nameInput = document.getElementById('template-name-input');
            if (nameInput) nameInput.value = template.templateName;

            // ===== RESTORE SIZE =====
            if (template.canvasWidth && template.canvasHeight) {
                canvas.setWidth(template.canvasWidth);
                canvas.setHeight(template.canvasHeight);

                // If you also keep a matching HTML <canvas> element in sync:
                const el = canvas.getElement();
                if (el) {
                    el.width = template.canvasWidth;
                    el.height = template.canvasHeight;
                }
            }
            // ========================

            let cleanJson = template.elementsJson.replace(/"alphabetical"/g, '"alphabetic"');

            canvas.loadFromJSON(cleanJson, () => {
                canvas.getObjects().forEach(o => {
                    if (!o.rawTemplateText && o.text) o.rawTemplateText = o.text;
                    if (o.isLiveBarcodeImage) restoreBarcodePlaceholder(o);
                });

                if (canvasMargin > 0) redrawMarginOverlay();
                canvas.renderAll();
                updateLayerTree();

                const designerTabBtn = document.getElementById('designer-tab');
                if (designerTabBtn) {
                    bootstrap.Tab.getOrCreateInstance(designerTabBtn).show();
                }
            });
        }
    }).getLabelTemplates(templateId);
}

function deleteTemplateFromDb(templateId) {
    if (confirm("Delete this template?")) {
        google.script.run
            .withSuccessHandler(res => {
                alert(res.message || "Template deleted successfully.");
                loadTemplatesList();
            })
            .withFailureHandler(err => alert("Error deleting template."))
            .deleteLabelTemplate(templateId);
    }
}

// Queue & Product Search Logic
async function filterPrintProducts(query) {
    const container = document.getElementById('print-product-selection-list');
    if (!container) return;

    if (!query || query.trim().length < 2) {
        container.innerHTML = '<div class="text-center text-muted small py-2" data-i18n="lbl_search_hint">Type at least 2 characters to search products...</div>';
        return;
    }

    if (!window.fullInventory || !Array.isArray(window.fullInventory) || window.fullInventory.length === 0) {
        container.innerHTML = '<div class="text-center text-muted small py-2"><span class="spinner-border spinner-border-sm me-1 text-primary"></span> Loading inventory...</div>';
        await loadInventoryForLabels();
    }

    if (!window.fullInventory || !Array.isArray(window.fullInventory) || window.fullInventory.length === 0) {
        container.innerHTML = '<div class="text-center text-danger small py-2">Inventory not loaded yet.</div>';
        return;
    }

    var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });

    var matches = window.fullInventory.filter(function (item) {
        var combinedSearch = (
            String(item.geo || '') + ' ' +
            String(item.pn || '') + ' ' +
            String(item.name || '') + ' ' +
            String(item.description || item.en || '') + ' ' +
            String(item.description_es || item.es || '') + ' ' +
            String(item.brand_name || item.marca || '') + ' ' +
            String(item.category_name || item.category || '')
        ).toLowerCase();

        return terms.every(function (term) {
            return combinedSearch.includes(term);
        });
    }).slice(0, 25);

    if (matches.length === 0) {
        container.innerHTML = '<div class="text-center text-muted small py-2">No matching products found.</div>';
        return;
    }

    container.innerHTML = '';
    matches.forEach(function (item) {
        var idx = window.fullInventory.indexOf(item);

        var displayName = item.name || item.description_es || item.description || item.es || item.en || item.geo || 'Unnamed Item';
        var secondLine = '';

        var subDesc = item.description || item.en;
        var subDescEs = item.description_es || item.es;
        if (subDescEs && subDesc && subDescEs !== subDesc) {
            secondLine = '<div class="text-muted" style="font-size: 10px;">ES: <strong>' + subDescEs + '</strong> | EN: <strong>' + subDesc + '</strong></div>';
        } else if (subDesc) {
            secondLine = '<div class="text-muted" style="font-size: 10px;">' + subDesc + '</div>';
        }

        container.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center py-1 px-2">
                <div class="text-truncate me-2" style="max-width: 280px;">
                    <div class="small fw-bold text-truncate">${displayName}</div>
                    ${secondLine}
                    <div class="text-muted" style="font-size: 10px;">GEO: <strong>${item.geo || 'N/A'}</strong> | P/N: <strong>${item.pn || 'N/A'}</strong></div>
                </div>
                <button class="btn btn-outline-success btn-sm py-0 px-2" onclick="addProductToPersistentQueue(${idx})">+ Add</button>
            </div>`;
    });
}

function addProductToPersistentQueue(inventoryIdx) {
    let item = window.fullInventory[inventoryIdx];
    if (!item) return;
    item = normalizeLabelProduct(item);

    const existing = persistentPrintQueue.find(qItem => qItem.inventoryIdx === inventoryIdx);
    if (existing) {
        existing.qty += 1;
        existing.item = item;
    } else {
        persistentPrintQueue.push({ inventoryIdx: inventoryIdx, item: item, qty: 1 });
    }
    renderPersistentQueuePanel();
    rebuildPrintQueueArray();
}

function updateQueueItemQty(index, newQty) {
    const qty = parseInt(newQty);
    if (qty > 0) persistentPrintQueue[index].qty = qty;
    rebuildPrintQueueArray();
}

function removeQueueItem(index) {
    persistentPrintQueue.splice(index, 1);
    renderPersistentQueuePanel();
    rebuildPrintQueueArray();
    if (persistentPrintQueue.length === 0 && isLiveDataView) {
        toggleLiveDataView();
    }
}

function renderPersistentQueuePanel() {
    const panel = document.getElementById('print-queue-panel');
    const countEl = document.getElementById('queue-count');
    if (!panel || !countEl) return;

    countEl.textContent = persistentPrintQueue.length;

    if (persistentPrintQueue.length === 0) {
        panel.innerHTML = '<div class="text-center text-muted small py-1 fst-italic">No products added yet. Click [+] from search results.</div>';
        return;
    }

    panel.innerHTML = '';
    persistentPrintQueue.forEach((qObj, idx) => {
        const displayName = qObj.item.name || qObj.item.description || qObj.item.description_es || qObj.item.en || qObj.item.es || qObj.item.geo || 'Unnamed';
        panel.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center py-1 px-2 bg-white mb-1 border rounded">
                <div class="text-truncate me-2" style="max-width: 150px;">
                    <div class="small fw-bold text-truncate">${displayName}</div>
                    <div class="text-muted" style="font-size: 10px;">GEO: ${qObj.item.geo || 'N/A'}</div>
                </div>
                <div class="d-flex align-items-center gap-1">
                    <input type="number" class="form-control form-control-sm text-center p-0" value="${qObj.qty}" min="1" style="width: 45px; height: 24px; font-size: 11px;" onchange="updateQueueItemQty(${idx}, this.value)">
                    <button class="btn btn-outline-danger btn-sm py-0 px-1" style="font-size: 10px;" onclick="removeQueueItem(${idx})">✕</button>
                </div>
            </div>`;
    });
}

function rebuildPrintQueueArray() {
    printQueueItems = [];
    persistentPrintQueue.forEach(qObj => {
        for (let i = 0; i < qObj.qty; i++) {
            printQueueItems.push(qObj.item);
        }
    });
    if (isLiveDataView) {
        if (currentPreviewIndex >= printQueueItems.length) currentPreviewIndex = Math.max(0, printQueueItems.length - 1);
        refreshCanvasLiveData();
    }
}

function toggleLiveDataView() {
    if (!isLiveDataView) {
        if (printQueueItems.length === 0) {
            if (window.fullInventory && Array.isArray(window.fullInventory) && window.fullInventory.length > 0) {
                addProductToPersistentQueue(0);
            } else {
                alert("Please add items to your print queue first so there is data to preview.");
                return;
            }
        }
        isLiveDataView = true;
        currentPreviewIndex = 0;
        document.getElementById('canvas-mode-title').textContent = "Canvas Workspace (Live Data View Active)";
        document.getElementById('preview-pagination-indicator').style.display = 'inline-block';
        document.getElementById('canvas-preview-controls').style.display = 'flex';
        document.getElementById('live-data-toggle-btn').className = "btn btn-warning btn-sm text-dark fw-bold ms-2";
        document.getElementById('live-data-toggle-btn').innerHTML = "✏️ Show Placeholders";
        refreshCanvasLiveData();
    } else {
        isLiveDataView = false;
        document.getElementById('canvas-mode-title').textContent = "Canvas Workspace (Template Design Mode)";
        document.getElementById('preview-pagination-indicator').style.display = 'none';
        document.getElementById('canvas-preview-controls').style.display = 'none';
        document.getElementById('live-data-toggle-btn').className = "btn btn-outline-warning btn-sm fw-bold ms-2";
        document.getElementById('live-data-toggle-btn').innerHTML = "👁️ Show Live Data";
        refreshCanvasPlaceholderData();
    }
}

function nextPreviewItem() {
    if (printQueueItems.length === 0) return;
    currentPreviewIndex = (currentPreviewIndex + 1) % printQueueItems.length;
    refreshCanvasLiveData();
}

function prevPreviewItem() {
    if (printQueueItems.length === 0) return;
    currentPreviewIndex = (currentPreviewIndex - 1 + printQueueItems.length) % printQueueItems.length;
    refreshCanvasLiveData();
}

function getLiveText(templateText) {
    let item = null;
    if (printQueueItems && printQueueItems.length > 0) {
        item = printQueueItems[currentPreviewIndex];
    } else if (window.fullInventory && Array.isArray(window.fullInventory) && window.fullInventory.length > 0) {
        item = window.fullInventory[currentPreviewIndex || 0];
    }
    if (!item) {
        return templateText;
    }

    return templateText.replace(/\{\{([^}]+)\}\}/g, function (match, propName) {
        const trimmedProp = propName.trim();
        const value = getProductFieldValue(item, trimmedProp);
        if (value !== undefined && value !== null && value !== '') {
            return String(value);
        }
        // If particular column is empty, return empty string so placeholders are NOT displayed in live view or printed
        return '';
    });
}

function refreshCanvasLiveData() {
    if (!isLiveDataView || printQueueItems.length === 0) {
        return;
    }

    document.getElementById('preview-pagination-indicator').textContent = `Record ${currentPreviewIndex + 1} of ${printQueueItems.length}`;
    const item = printQueueItems[currentPreviewIndex];

    // Detect if user is actively typing inside a textbox (blinking cursor)
    const active = canvas.getActiveObject();
    const isEditingTextbox = active && active.type === 'textbox' && active.isEditing;

    canvas.getObjects().forEach(obj => {
        if (obj.isMarginOverlay) return;

        if (!obj.rawTemplateText) {
            obj.rawTemplateText = obj.text || `{{${obj.db_col || 'geo'}}}`;
        }

        if (obj.type === 'textbox') {
            if (isEditingTextbox && obj === active) {
                return;
            }

            const newText = getLiveText(obj.rawTemplateText);
            obj.set({ text: newText });
        } else if (obj.isBarcode) {
            updateBarcodeObjectLive(obj, item);
        }
    });
    canvas.renderAll();
}

function refreshCanvasPlaceholderData() {
    canvas.getObjects().forEach(obj => {
        if (obj.isMarginOverlay) return;
        if (obj.type === 'textbox' && obj.rawTemplateText) {
            obj.set({ text: obj.rawTemplateText });
        } else if (obj.isLiveBarcodeImage) {
            restoreBarcodePlaceholder(obj);
        }
    });
    canvas.renderAll();
}

function updateBarcodeObjectLive(obj, item) {
    let val = "";

    // 1. Check if db_col is specified and exists in the item data
    if (obj.db_col && item) {
        const resolved = getProductFieldValue(item, obj.db_col);
        if (resolved !== undefined && resolved !== null && String(resolved).trim() !== '') {
            val = String(resolved).trim();
        }
    }
    // 2. Check if rawTemplateText exists (e.g. "{{geo}}") and replace tags with actual item values
    else if (obj.rawTemplateText && item) {
        val = obj.rawTemplateText.replace(/\{\{([^}]+)\}\}/g, function (match, colName) {
            let trimmedKey = colName.trim();
            const resolved = getProductFieldValue(item, trimmedKey);
            return (resolved !== undefined && resolved !== null && String(resolved).trim() !== '') ? String(resolved).trim() : '';
        }).trim();
    }

    // Fallback if empty so barcode doesn't crash: use item.geo (which every product has) or default
    if (!val || val.startsWith("{{")) {
        val = (item && item.geo) ? String(item.geo) : (obj.lastBarcodeVal || "123456");
    }

    var svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    try {
        JsBarcode(svgNode, val, {
            format: "CODE128",
            displayValue: obj.showText !== false,
            font: obj.fontFamily || "monospace",
            fontSize: obj.fontSize || 12,
            textMargin: 2,
            textAlign: obj.textAlign || "center",
            height: Math.max(20, (obj.height * (obj.scaleY || 1) || 70) - 25),
            width: 2,
            lineColor: "#000000",
            background: "#ffffff"
        });

        const svgData = new XMLSerializer().serializeToString(svgNode);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const blobURL = (window.URL || window.webkitURL || window).createObjectURL(svgBlob);

        // Capture whether this barcode was the active object BEFORE we replace it
        const wasActive = canvas.getActiveObject() === obj;

        fabric.Image.fromURL(blobURL, function (img) {
            let targetW = (obj.width || 180) * (obj.scaleX || 1);
            let targetH = (obj.height || 70) * (obj.scaleY || 1);

            img.set({
                left: obj.left,
                top: obj.top,
                scaleX: targetW / img.width,
                scaleY: targetH / img.height,
                angle: obj.angle || 0,
                selectable: true,
                isBarcode: true,
                db_col: obj.db_col,
                elementName: obj.elementName,
                barcodeFormat: obj.barcodeFormat,
                showText: obj.showText,
                fontFamily: obj.fontFamily,
                fontSize: obj.fontSize,
                textAlign: obj.textAlign,
                rawTemplateText: obj.rawTemplateText,
                isLiveBarcodeImage: true,
                lastBarcodeVal: val
            });

            canvas.remove(obj);
            canvas.add(img);

            // Only restore selection if this barcode was already selected
            if (wasActive) {
                canvas.setActiveObject(img);
            }

            canvas.renderAll();
        });
    } catch (err) {
        console.error("Barcode render error:", err);
    }
}

function restoreBarcodePlaceholder(obj) {
    if (obj.isLiveBarcodeImage) {
        const rect = new fabric.Rect({
            left: obj.left,
            top: obj.top,
            width: (obj.width || 180) * (obj.scaleX || 1),
            height: (obj.height || 70) * (obj.scaleY || 1),
            angle: obj.angle || 0,
            fill: '#ffffff',
            stroke: '#000000',
            strokeWidth: 1,
            rx: 2,
            ry: 2,
            isBarcode: true,
            db_col: obj.db_col,
            elementName: obj.elementName,
            barcodeFormat: obj.barcodeFormat,
            showText: obj.showText,
            fontFamily: obj.fontFamily,
            fontSize: obj.fontSize,
            textAlign: obj.textAlign,
            rawTemplateText: obj.rawTemplateText
        });
        canvas.remove(obj);
        canvas.add(rect);
    }
}

// Batch Printing Logic
// Batch Printing Logic via C# Local Tray App
async function executeBatchPrint() {
    if (typeof printQueueItems === 'undefined' || printQueueItems.length === 0) {
        alert("Please add items to print queue first.");
        return;
    }

    let wasInLive = typeof isLiveDataView !== 'undefined' && isLiveDataView;
    if (wasInLive && typeof refreshCanvasPlaceholderData === 'function') refreshCanvasPlaceholderData();

    const marginOverlay = canvas.getObjects().find(o => o.isMarginOverlay);
    if (marginOverlay) canvas.remove(marginOverlay);

    const canvasJson = canvas.toJSON([
        'isBarcode', 'db_col', 'elementName', 'barcodeFormat', 'showText', 'fontFamily', 'fontSize', 'fillColor', 'rawTemplateText', 'isLiveBarcodeImage', 'textAlign'
    ]);

    if (marginOverlay) {
        canvas.add(marginOverlay);
        marginOverlay.sendToBack();
    }
    if (wasInLive && typeof refreshCanvasLiveData === 'function') refreshCanvasLiveData();

    let index = 0;

    async function processNextBatchItem() {
        if (index >= printQueueItems.length) {
            console.log("Batch printing complete!");
            alert("Batch print job sent successfully to Brother QL-800!");
            return;
        }

        const item = printQueueItems[index];
        const tempCanvasEl = document.createElement('canvas');
        tempCanvasEl.width = canvas.width;
        tempCanvasEl.height = canvas.height;

        const batchCanvas = new fabric.StaticCanvas(tempCanvasEl, { backgroundColor: '#ffffff' });

        batchCanvas.loadFromJSON(canvasJson, async function () {
            const objects = batchCanvas.getObjects();
            let barcodesToProcess = objects.filter(function (obj) { return obj.isBarcode; });

            if (barcodesToProcess.length === 0) {
                await processBatchTextAndFinalize(batchCanvas, item, tempCanvasEl);
                return;
            }

            let completedBarcodes = 0;
            objects.forEach(function (obj) {
                if (obj.isBarcode) {
                    let val = "";
                    if (obj.db_col) {
                        const resolved = getProductFieldValue(item, obj.db_col);
                        if (resolved !== undefined && resolved !== null && String(resolved).trim() !== '') {
                            val = String(resolved).trim();
                        }
                    } else if (obj.rawTemplateText) {
                        val = obj.rawTemplateText.replace(/\{\{([^}]+)\}\}/g, function (match, propName) {
                            const trimmedProp = propName.trim();
                            const resolved = getProductFieldValue(item, trimmedProp);
                            return (resolved !== undefined && resolved !== null && String(resolved).trim() !== '') ? String(resolved).trim() : '';
                        }).trim();
                    }
                    if (!val || val.startsWith("{{")) {
                        val = (item && item.geo) ? String(item.geo) : (obj.lastBarcodeVal || "123456");
                    }

                    var svgNode = document.createElementNS('http://www.w3.org/2000/svg', "svg");
                    try {
                        JsBarcode(svgNode, val, {
                            format: "CODE128",
                            displayValue: obj.showText !== false,
                            font: obj.fontFamily || "monospace",
                            fontSize: obj.fontSize || 12,
                            textMargin: 2,
                            textAlign: obj.textAlign || "center",
                            height: Math.max(20, (obj.height || 70) - 25),
                            width: 2,
                            lineColor: "#000000",
                            background: "#ffffff"
                        });

                        const svgData = new XMLSerializer().serializeToString(svgNode);
                        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                        const blobURL = (window.URL || window.webkitURL || window).createObjectURL(svgBlob);

                        fabric.Image.fromURL(blobURL, async function (img) {
                            let targetW = obj.width || 180;
                            let targetH = obj.height || 70;

                            img.set({
                                left: obj.left,
                                top: obj.top,
                                scaleX: targetW / img.width,
                                scaleY: targetH / img.height,
                                angle: obj.angle || 0
                            });
                            batchCanvas.remove(obj);
                            batchCanvas.add(img);

                            completedBarcodes++;
                            if (completedBarcodes === barcodesToProcess.length) {
                                await processBatchTextAndFinalize(batchCanvas, item, tempCanvasEl);
                            }
                        });
                    } catch (err) {
                        completedBarcodes++;
                        if (completedBarcodes === barcodesToProcess.length) {
                            processBatchTextAndFinalize(batchCanvas, item, tempCanvasEl);
                        }
                    }
                }
            });
        });
    }

    async function processBatchTextAndFinalize(batchCanvas, item, tempCanvasEl) {
        batchCanvas.getObjects().forEach(function (obj) {
            // 1. Handle regular text boxes
            if (obj.type === 'textbox' || obj.type === 'text') {
                let baseText = obj.rawTemplateText || obj.text || '';
                let currentText = baseText.replace(/\{\{([^}]+)\}\}/g, function (match, propName) {
                    const trimmedProp = propName.trim();
                    const resolved = getProductFieldValue(item, trimmedProp);
                    if (resolved !== undefined && resolved !== null && resolved !== '') {
                        return String(resolved);
                    }
                    return '';
                });
                obj.set({ text: currentText });
            }

            // 2. Handle Barcode objects
            if (obj.isBarcode || obj.type === 'barcode' || (obj.name && obj.name.includes('barcode'))) {
                let barcodeValue = getProductFieldValue(item, obj.db_col || 'geo') || item.geo || item.pn || '123456';
                obj.set({ text: String(barcodeValue) });
            }
        });

        batchCanvas.renderAll();

        // =====================================================
        // Calculate physical size in inches
        // =====================================================
        // Change this DPI value to match how you designed the canvas.
        // Common values for label design: 300 or 203
        //const DPI = 300;

        const widthInches = canvas.width / DPI;
        const heightInches = canvas.height / DPI;

        console.log(`Canvas: ${canvas.width} × ${canvas.height} px → ${widthInches.toFixed(2)}" × ${heightInches.toFixed(2)}"`);

        // 1. Export high-res PNG
        const dataUrl = batchCanvas.toDataURL({
            format: 'png',
            multiplier: 3
        });

        try {
            // 2. Send image + physical size to C# tray app
            const response = await fetch('http://127.0.0.1:8888/print-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: dataUrl,
                    labelName: item.name || item.description || item.description_es || item.en || item.es || item.geo || 'Label',
                    widthInches: widthInches,
                    heightInches: heightInches
                })
            });

            const result = await response.json();
            if (result.status !== 'success') {
                console.error("Print server warning:", result.message);
            }
        } catch (err) {
            console.error("Failed to communicate with local C# print service:", err);
        }

        batchCanvas.dispose();

        index++;
        setTimeout(processNextBatchItem, 200);
    }

    processNextBatchItem();
}
