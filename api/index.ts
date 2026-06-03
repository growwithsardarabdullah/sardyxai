import type { Request, Response } from 'express';

// Initialize env from server FIRST
import '../server/dist/env.js';

// Import from compiled server build
import { createApp } from '../server/dist/app.js';
import { initDbAsync } from '../server/dist/db/index.js';
import { startHealthChecker } from '../server/dist/services/health.js';

// Initialize database once on cold start
let initialized = false;
let app: any = null;
let initError: Error | null = null;

async function initializeApp() {
  if (initialized) return;
  if (initError) throw initError;

  try {
    console.log('[Vercel] Starting initialization...');
    console.log('[Vercel] NODE_ENV:', process.env.NODE_ENV);

    // initDbAsync opens the in-memory SQLite (seeded + migrated) and then
    // awaits Supabase hydration if credentials are configured. The first
    // request waits for this — subsequent requests are unblocked because
    // `initialized` short-circuits.
    await initDbAsync();
    console.log('[Vercel] Database initialized');

    app = createApp();
    console.log('[Vercel] Express app created');

    startHealthChecker();
    console.log('[Vercel] Health checker started');

    initialized = true;
    console.log('[Vercel] App initialized successfully');
  } catch (error) {
    console.error('[Vercel] Initialization failed:', error);
    initError = error as Error;
    throw error;
  }
}

export default async (req: Request, res: Response) => {
  try {
    // Initialize on first request
    if (!app) {
      await initializeApp();
    }

    // Handle the request through Express
    return app(req, res);
  } catch (error) {
    console.error('[Vercel Handler] Error:', error);
    console.error('[Vercel Handler] Stack:', error instanceof Error ? error.stack : 'No stack');
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : String(error)) : undefined,
      });
    }
  }
};
