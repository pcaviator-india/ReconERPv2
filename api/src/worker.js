globalThis.__IS_CF_WORKER__ = true;
process.env.CF_WORKER = 'true';

import { httpServerHandler } from 'cloudflare:node';
import app from './index.js';
import { Database } from './db.js';

let handler = null;
try {
  handler = httpServerHandler(app);
} catch (e) {
  console.warn('[worker] httpServerHandler init error:', e);
}

export default {
  async fetch(request, env, ctx) {
    // Bind Cloudflare D1 database and environment variables
    if (env && env.DB) {
      app.locals.db = new Database(env);
    }
    if (env && env.JWT_SECRET) {
      process.env.JWT_SECRET = env.JWT_SECRET;
    }

    if (handler && typeof handler.fetch === 'function') {
      return handler.fetch(request, env, ctx);
    }

    return new Response('RECON ERP API Worker Active', {
      headers: { 'Content-Type': 'text/plain' },
      status: 200
    });
  }
};
