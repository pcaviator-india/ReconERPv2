'use strict';

/**
 * sheets-client.js — Google Sheets API v4 client (service-account auth).
 *
 * Reads rows from a Google Spreadsheet and hands structured data to the
 * importer. No server-side Google Apps Script code is required; the Apps
 * Script side only needs to POST to /api/v1/sheets/import on a time-driven
 * trigger (or a Cloudflare cron later).
 *
 * Environment (loaded via dotenv):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the service account JSON
 *   GOOGLE_SHEET_ID                 the spreadsheet ID
 *   GOOGLE_API_SCOPE                default: https://www.googleapis.com/auth/spreadsheets
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

class SheetsClient {
  constructor(env = process.env) {
    this.env = env;
    this._auth = null;
    this._sheets = null;
  }

  get auth() {
    return this._auth;
  }

  get sheets() {
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

    const scope = this.env.GOOGLE_API_SCOPE || DEFAULT_SCOPE;
    this._auth = new google.auth.GoogleAuth({
      scopes: [scope],
      keyFile: resolved,
    });
    this._sheets = google.sheets({ version: 'v4', auth: this._auth });

    // Force a token refresh so the client is immediately usable.
    await this._auth.getAccessToken();
  }

  /**
   * Read a sheet and return raw rows (array of arrays) plus the header row.
   *
   * @param {string} gasSheet  - one of the tab names in api/src/sheets/sheets-config.js
   * @param {string} [range]   - A1 notation (defaults to the used range)
   * @param {string} [sheetId] - override for this.env.GOOGLE_SHEET_ID (e.g. from GUI)
   * @returns {Promise<{headers: string[], rows: string[][]}>}
   */
  async readSheet(gasSheet, range, sheetId) {
    if (!this._sheets) {
      throw new Error('SheetsClient is not connected. Call connect() first.');
    }
    const id = sheetId || this.env.GOOGLE_SHEET_ID;
    if (!id) {
      throw new Error('GOOGLE_SHEET_ID is not set');
    }

    const request = range
      ? { spreadsheetId: id, range: `${gasSheet}!${range}` }
      : { spreadsheetId: id, range: gasSheet };

    const resp = await this._sheets.spreadsheets.values.get(request);
    const values = resp.data.values || [];
    if (values.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = values[0].map((h) => String(h).trim());
    const rows = values.slice(1).map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v))));
    return { headers, rows };
  }
}

module.exports = { SheetsClient };
