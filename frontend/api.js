// ============================================
// RECON ERP API Client
// Replaces google.script.run with fetch() REST API calls
// ============================================

// Default: same-origin /api/v1 (frontend served by the API server).
// Override with window.RECON_API_BASE_URL before this script loads
// (e.g. for a separate static host pointing at a remote API).
const API_BASE_URL = window.RECON_API_BASE_URL || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '/api/v1' : 'https://recon-erp-api.reconerp.workers.dev/api/v1');

const RECON_API = {
  _token: null,

  init() {
    this._token = sessionStorage.getItem('recon_auth_token') || (localStorage.getItem('recon_auth_token') || null);
  },

  setToken(token) {
    this._token = token;
    try { sessionStorage.setItem('recon_auth_token', token); } catch(e) {}
    if (token) {
      localStorage.setItem('recon_auth_token', token);
    } else {
      try { sessionStorage.removeItem('recon_auth_token'); } catch(e) {}
      localStorage.removeItem('recon_auth_token');
    }
  },

  getToken() {
    if (!this._token) {
      this._token = sessionStorage.getItem('recon_auth_token') || (localStorage.getItem('recon_auth_token') || null);
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

  async syncRemoteTab(sheetId, sheetKey, mapping) {
    return this._request('/sheets/sync-remote-tab', 'POST', { sheetId, sheetKey, mapping });
  },


  // ============================================
  // System
  // ============================================
  async getConfig() {
    return this._request('/system/config', 'GET');
  },

  async healthCheck() {
    return this._request('/health', 'GET');
  }
};

// Initialize on load
RECON_API.init();

// Export for use in HTML
window.RECON_API = RECON_API;
