import './dist/env.js';
import { createApp } from './dist/app.js';
import { initDb } from './dist/db/index.js';
import { startHealthChecker } from './dist/services/health.js';

let initialized = false;
let app = null;
let initError = null;

async function initializeApp() {
  if (initialized) return;
  if (initError) throw initError;
  try {
    console.log('[Vercel Server Workspace] Starting initialization...');
    initDb();
    app = createApp();
    startHealthChecker();
    initialized = true;
    console.log('[Vercel Server Workspace] Initialization successful');
  } catch (error) {
    console.error('[Vercel Server Workspace] Initialization failed:', error);
    initError = error;
    throw error;
  }
}

export default async (req, res) => {
  try {
    if (!app) {
      await initializeApp();
    }
    return app(req, res);
  } catch (error) {
    console.error('[Vercel Handler] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
