// ============================================
// RECON ERP API Client
// Replaces google.script.run with fetch() REST API calls
// ============================================

// Default: same-origin /api/v1 (frontend served by the API server).
// Override with window.RECON_API_BASE_URL before this script loads
// (e.g. for a separate static host pointing at a remote API).
const IS_LOCAL_HOST = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const API_BASE_URL = window.RECON_API_BASE_URL ||
  (IS_LOCAL_HOST ? 'http://localhost:3000/api/v1' : 'https://recon-erp-api.reconerp.workers.dev/api/v1');
const AUTH_TOKEN_KEY = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'recon_auth_token_local'
  : 'recon_auth_token';

const RECON_API = {
  _token: null,

  init() {
    this._token = sessionStorage.getItem(AUTH_TOKEN_KEY) || (localStorage.getItem(AUTH_TOKEN_KEY) || null);
  },

  setToken(token) {
    this._token = token;
    try { sessionStorage.setItem(AUTH_TOKEN_KEY, token); } catch(e) {}
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      try { sessionStorage.removeItem(AUTH_TOKEN_KEY); } catch(e) {}
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  },

  getToken() {
    if (!this._token) {
      this._token = sessionStorage.getItem(AUTH_TOKEN_KEY) || (localStorage.getItem(AUTH_TOKEN_KEY) || null);
    }
    return this._token;
  },

  clearToken() {
    this.setToken(null);
  },

  async _request(endpoint, method = 'GET', body = null) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      method,
      headers
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.clearToken();
          window.dispatchEvent(new CustomEvent('recon-auth-expired'));
        }
        throw new Error(data.message || `API error: ${response.status}`);
      }

      return data;
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('Network error - unable to reach API server');
      }
      throw err;
    }
  },

  // ============================================
  // Auth
  // ============================================
  async login(userId, pin) {
    const data = await this._request('/auth/login', 'POST', { userId, pin });
    if (data.status === 'success' && data.data && data.data.token) {
      this.setToken(data.data.token);
    }
    return data;
  },

  async resetPin(email) {
    return this._request('/auth/reset-pin', 'POST', { email });
  },

  async confirmResetPin(token, newPin) {
    return this._request('/auth/confirm-reset-pin', 'POST', { token, newPin });
  },

  async getMe() {
    return this._request('/auth/me', 'GET');
  },

  async changePin(oldPin, newPin) {
    return this._request('/auth/change-pin', 'POST', { oldPin, newPin });
  },

  async logout() {
    const data = await this._request('/auth/logout', 'POST');
    this.clearToken();
    return data;
  },

  // ============================================
  // Reference Data (Validation)
  // ============================================
  async getSites() {
    return this._request('/reference/sites', 'GET');
  },

  async getCategories() {
    return this._request('/reference/categories', 'GET');
  },

  async getBrands() {
    return this._request('/reference/brands', 'GET');
  },

  async getSuppliers() {
    return this._request('/reference/suppliers', 'GET');
  },

  async getValidationData() {
    return this._request('/reference/validation', 'GET');
  },

  // ============================================
  // Movement Validation (for Control Combustible asset dropdowns)
  // ============================================
  async getMovementValidation() {
    return this._request('/legacy/getMovementValidation', 'POST', {});
  },

  async getPeople() {
    return this._request('/legacy/getPeople', 'POST', {});
  },

  async getFuelTanks(site) {
    const qs = site ? `?site=${encodeURIComponent(site)}` : '';
    return this._request(`/fuel/tanks${qs}`);
  },

  async createFuelTank(data) {
    return this._request('/fuel/tanks', 'POST', data);
  },

  async updateFuelTank(id, data) {
    return this._request(`/fuel/tanks/${id}`, 'PUT', data);
  },

  async getLastFuelEntry(assetId) {
    try {
      const res = await this._request(`/fuel/last-odometer?asset_id=${encodeURIComponent(assetId)}`);
      return res;
    } catch (e) {
      return this._request('/legacy/getLastFuelEntry', 'POST', { args: [assetId] });
    }
  },

  async saveFuelEntry(data) {
    try {
      return await this._request('/fuel/entry', 'POST', data);
    } catch (e) {
      return this._request('/legacy/saveFuelEntry', 'POST', { args: [data] });
    }
  },

  async getFuelHistory(tankId) {
    try {
      const qs = tankId ? `?tank_id=${encodeURIComponent(tankId)}` : '';
      const res = await this._request(`/fuel/history${qs}`);
      return (res && res.data) ? res.data : res;
    } catch (e) {
      return this._request('/legacy/getFuelHistory', 'POST', { args: [{ tank_id: tankId }] });
    }
  },

  async getFuelBalance(tankId) {
    try {
      const qs = tankId ? `?tank_id=${encodeURIComponent(tankId)}` : '';
      const res = await this._request(`/fuel/balance${qs}`);
      return (res && res.data) ? res.data : res;
    } catch (e) {
      return this._request('/legacy/getFuelBalance', 'POST', { args: [{ tank_id: tankId }] });
    }
  },

  async getFuelPurchaseHistory(tankId) {
    try {
      const qs = tankId ? `?tank_id=${encodeURIComponent(tankId)}` : '';
      const res = await this._request(`/fuel/purchases${qs}`);
      return (res && res.data) ? res.data : res;
    } catch (e) {
      return this._request('/legacy/getFuelPurchaseHistory', 'POST', { args: [{ tank_id: tankId }] });
    }
  },

  async saveFuelPurchase(data) {
    try {
      return await this._request('/fuel/purchase', 'POST', data);
    } catch (e) {
      return this._request('/legacy/saveFuelPurchase', 'POST', { args: [data] });
    }
  },

  // ============================================
  // Products
  // ============================================
  async getProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/products${query ? '?' + query : ''}`, 'GET');
  },

  async getProductByGeo(geo) {
    return this._request(`/products/${encodeURIComponent(geo)}`, 'GET');
  },

  // ============================================
  // Stock
  // ============================================
  async getStock(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/stock${query ? '?' + query : ''}`, 'GET');
  },

  async getAvailableStock(itemId) {
    return this._request(`/stock/available/${encodeURIComponent(itemId)}`, 'GET');
  },

  // ============================================
  // Requisitions
  // ============================================
  async getRequisitions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/requisitions${query ? '?' + query : ''}`, 'GET');
  },

  async getRequisition(id) {
    return this._request(`/requisitions/${id}`, 'GET');
  },

  async createRequisition(data) {
    return this._request('/requisitions', 'POST', data);
  },

  async updateRequisition(id, data) {
    return this._request(`/requisitions/${id}`, 'PUT', data);
  },

  async deleteRequisition(id) {
    return this._request(`/requisitions/${id}`, 'DELETE');
  },

  // ============================================
  // Movements
  // ============================================
  async getMovements(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/movements${query ? '?' + query : ''}`, 'GET');
  },

  async bulkIssueItems(data) {
    return this._request('/movements/bulk-issue', 'POST', data);
  },

  async getMovement(movementId) {
    return this._request(`/movements/${encodeURIComponent(movementId)}`, 'GET');
  },

  // ============================================
  // Quotes
  // ============================================
  async getQuotes(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._request(`/quotes${query ? '?' + query : ''}`, 'GET');
  },

  async getQuote(id) {
    return this._request(`/quotes/${id}`, 'GET');
  },

  async createQuote(data) {
    return this._request('/quotes', 'POST', data);
  },

  async updateQuoteStatus(id, status) {
    return this._request(`/quotes/${id}/status`, 'PUT', { status });
  },

  /**
   * receiveQuote — Site users mark a Despatched quote as Received (full or partial)
   * @param {string} id  Quote ID
   * @param {Array}  items  [{ quote_item_id, received_qty }]
   * @param {string} receive_type 'full' | 'partial'
   */
  async receiveQuote(id, items, receive_type = 'full') {
    return this._request(`/quotes/${id}/receive`, 'PUT', { items, receive_type });
  },

  // ============================================
  // Background Jobs
  // ============================================
  async getJob(jobId) {
    return this._request(`/jobs/${jobId}`, 'GET');
  },

  async getJobs(jobIds) {
    return this._request('/jobs', 'POST', { jobIds });
  },

  // ============================================
  // Files
  // ============================================
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const token = this.getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/files/upload`, {
      method: 'POST',
      headers,
      body: formData
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Upload failed: ${response.status}`);
    }

    return response.json();
  },

  async downloadFile(fileId) {
    const token = this.getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/files/${fileId}/download`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return response.blob();
  },

  // ============================================
  // Google Sheets Sync (preview-before-import + connection)
  // ============================================
  async getSheetsStatus() {
    return this._request('/sheets/status', 'GET');
  },

  async getSheetsConnection() {
    return this._request('/sheets/connection', 'GET');
  },

  async saveSheetsConnection(data) {
    return this._request('/sheets/connection', 'PUT', data);
  },

  async testSheetsConnection(sheetId) {
    return this._request('/sheets/test', 'POST', sheetId ? { sheetId } : {});
  },

  async previewSheets(sheet) {
    return this._request('/sheets/preview', 'POST', sheet ? { sheet } : {});
  },

  async importSheets(sheet) {
    return this._request('/sheets/import', 'POST', sheet ? { sheet } : {});
  },

  async previewPasted(sheet, text) {
    return this._request('/sheets/paste-preview', 'POST', { sheet, text });
  },

  async importPasted(sheet, text, columnMap, hasHeaderRow) {
    return this._request('/sheets/paste-import', 'POST', { sheet, text, columnMap, hasHeaderRow });
  },

  async previewPastedWithMap(sheet, text, columnMap, hasHeaderRow) {
    return this._request('/sheets/paste-preview', 'POST', { sheet, text, columnMap, hasHeaderRow });
  },

  async getColumnMapping(sheetKey) {
    return this._request('/sheets/mapping/' + sheetKey, 'GET');
  },

  async saveColumnMapping(sheetKey, mapping) {
    return this._request('/sheets/mapping/' + sheetKey, 'PUT', { mapping });
  },
  async getSchemaDefinitions() {
    return this._request('/sheets/schema-definitions', 'GET');
  },

  async fetchRemoteSheet(sheetId, sheetName) {
    return this._request('/sheets/fetch-remote-sheet', 'POST', { sheetId, sheetName });
  },

  async previewTransformed(sheetKey, headers, sampleRows, mapping) {
    return this._request('/sheets/preview-transformed', 'POST', { sheetKey, headers, sampleRows, mapping });
  },

  async syncRemoteTab(sheetId, sheetKey, mapping, targetTankId) {
    return this._request('/sheets/sync-remote-tab', 'POST', { sheetId, sheetKey, mapping, targetTankId });
  },


  // ============================================
  // System & Permissions
  // ============================================
  async getConfig() {
    return this._request('/system/config', 'GET');
  },

  async healthCheck() {
    return this._request('/health', 'GET');
  },

  async getPermissionsMatrix() {
    return this._request('/permissions/matrix', 'GET');
  },

  async getMyPermissions() {
    return this._request('/permissions/my', 'GET');
  },

  async updateRolePermissions(roleId, permissions, name, description) {
    return this._request('/permissions/roles/' + encodeURIComponent(roleId), 'PUT', { permissions, name, description });
  },

  async createRole(id, name, description, cloneFrom) {
    return this._request('/permissions/roles', 'POST', { id, name, description, cloneFrom });
  },

  async resetPermissions() {
    return this._request('/permissions/reset', 'POST');
  }
};

// Initialize on load
RECON_API.init();

// Export for use in HTML
window.RECON_API = RECON_API;
