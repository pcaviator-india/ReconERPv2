/**
 * sheets-client.js — Google Sheets API wrapper using a Service Account
 *
 * Reads sheets via the official googleapis client. Expects credentials
 * at GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON) or
 * GOOGLE_SERVICE_ACCOUNT_KEY (raw JSON string).
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to JSON key file
 *   GOOGLE_SHEET_ID                 target spreadsheet id
 *   GOOGLE_API_SCOPE                default: https://www.googleapis.com/auth/spreadsheets
 */

let google = null;
function getGoogle() {
  if (!google) {
    try {
      const req = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : eval('require');
      const g = req('googleapis');
      google = g.google || g;
    } catch (e) {
      throw new Error('googleapis package is not available in edge environment. Run sheets import locally.');
    }
  }
  return google;
}

const fs = require('fs');
const path = require('path');

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

class SheetsClient {
  constructor(env = process.env) {
    this.env = env;
    this._auth = null;
    this._sheets = null;
  }

  get sheets() {
    if (!this._sheets) {
      throw new Error('SheetsClient not connected. Call .connect() first.');
    }
    return this._sheets;
  }

  /**
   * Load the service account JSON and authorize the Sheets API client.
   * Idempotent: reconnects on each call so stale tokens are refreshed.
   */
  async connect() {
    const credPath = this.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');
    }
    const resolved = path.resolve(credPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Service account JSON not found: ${resolved}`);
    }
    let credentials;
    try {
      credentials = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse service account JSON: ${err.message}`);
    }
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Service account JSON is missing client_email or private_key');
    }

    const g = getGoogle();
    const scope = this.env.GOOGLE_API_SCOPE || DEFAULT_SCOPE;
    this._auth = new g.auth.GoogleAuth({
      scopes: [scope],
      keyFile: resolved,
    });
    this._sheets = g.sheets({ version: 'v4', auth: this._auth });

    // Force a token refresh so the client is immediately usable.
    await this._auth.getAccessToken();
  }

  /**
   * Fetch rows from a tab as a 2D string array. Empty trailing cells are
   * preserved; missing rows answer [].
   *
   * @param {string} sheetId
   * @param {string} tabName
   * @param {string} [range='A:ZZ'] A1 notation range within the tab
   * @returns {Promise<string[][]>}
   */
  async getValues(sheetId, tabName, range = 'A:ZZ') {
    if (!this._sheets) await this.connect();
    const fullRange = `'${tabName}'!${range}`;
    try {
      const res = await this._sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: fullRange,
        valueRenderOption: 'FORMATTED_VALUE',
      });
      return res.data.values || [];
    } catch (err) {
      throw new Error(`Failed to read range "${fullRange}" from sheet ${sheetId}: ${err.message}`);
    }
  }

  /**
   * List the tab titles present in the target spreadsheet.
   *
   * @param {string} sheetId
   * @returns {Promise<string[]>}
   */
  async getTabNames(sheetId) {
    if (!this._sheets) await this.connect();
    try {
      const res = await this._sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: 'sheets.properties.title',
      });
      return (res.data.sheets || []).map((s) => s.properties.title);
    } catch (err) {
      throw new Error(`Failed to read spreadsheet metadata for ${sheetId}: ${err.message}`);
    }
  }
}

module.exports = { SheetsClient };
