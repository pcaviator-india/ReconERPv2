// Cloudflare Worker entry point for RECON ERP API
// Uses cloudflare:node httpServerHandler to bridge Express → Workers fetch API
globalThis.__IS_CF_WORKER__ = true;
process.env.CF_WORKER = 'true';

import { httpServerHandler } from 'cloudflare:node';
import app from './index.js';
import { Database } from './db.js';

const PORT = 8080;
app.listen(PORT);

const handler = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    // Inject D1 database binding into Express app.locals so routes can access it
    if (env && env.DB) {
      app.locals.db = new Database(env);
    }

    // Inject Cloudflare env vars into process.env for JWT and other middleware
    if (env && env.JWT_SECRET) {
      process.env.JWT_SECRET = env.JWT_SECRET;
    }
    if (env && env.JWT_EXPIRES_IN) {
      process.env.JWT_EXPIRES_IN = env.JWT_EXPIRES_IN;
    }
    if (env && env.API_BASE_URL) {
      process.env.API_BASE_URL = env.API_BASE_URL;
    }

    return handler.fetch(request, env, ctx);
  }
};
