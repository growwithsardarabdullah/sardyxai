import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { responsesRouter } from './routes/responses.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import { createProxyRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

function getAllowedCorsOrigins() {
  const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // CSP intentionally disabled — the SPA bundles inline styles and the OG
  // image is loaded from the same origin; enabling helmet's default CSP
  // breaks the React build's hashed-asset loader. HSTS off because this is
  // a single-user local proxy, served over HTTP on localhost. Both should
  // stay disabled unless someone serves the proxy over HTTPS publicly
  // (which is also not a supported deployment — see README).
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  // Cookie parser — required so /api/auth can read the httpOnly session cookie.
  // Hand-rolled (no extra dep) — only the `freellmapi_session` cookie is read.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.cookie;
    if (!header) { next(); return; }
    const jar: Record<string, string> = {};
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) jar[k] = decodeURIComponent(v);
    }
    (req as Request & { cookies?: Record<string, string> }).cookies = jar;
    next();
  });

  // Dashboard auth (#35): /api/auth/{status,setup,login} bootstrap without a
  // session; everything else under /api/* requires a logged-in dashboard user.
  // The /v1 proxy keeps its own unified-API-key auth and is NOT gated here.
  app.use('/api/auth', authRouter);

  // API routes — all admin endpoints sit behind requireAuth.
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  // OpenAI-compatible proxy. Per-IP rate limiting (#35 item #6) runs first so
  // it throttles unauthenticated brute-force / flood attempts before any
  // routing work. Tune via PROXY_RATE_LIMIT_RPM; 0 disables it.
  app.use('/v1', createProxyRateLimiter());
  app.use('/v1', proxyRouter);
  // OpenAI Responses API shim (Codex CLI requires wire_api="responses"; see #96)
  app.use('/v1', responsesRouter);

  // Health check
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Debug: persistence status (no auth required — shows booleans only, no secrets)
  app.get('/api/debug/persistence', async (_req, res) => {
    const { getPersistence } = await import('./db/index.js');
    const { getSupabaseAdmin } = await import('./db/supabase.js');
    const persistence = getPersistence();
    const stats = persistence.stats();
    const sb = getSupabaseAdmin();
    let supabaseTest: { ok: boolean; error?: string } = { ok: false };
    if (sb) {
      try {
        const { error } = await sb.from('api_keys').select('id', { count: 'exact', head: true });
        if (error) {
          supabaseTest = { ok: false, error: `${error.message} (code: ${error.code})` };
        } else {
          supabaseTest = { ok: true };
        }
      } catch (err) {
        supabaseTest = { ok: false, error: (err as Error).message };
      }
    }
    res.json({
      persistence: stats,
      supabaseAdminAvailable: !!sb,
      supabaseTest,
      envVars: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
      },
    });
  });

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler)
  const clientDist = path.resolve(__dirname, '../../client/dist');
  const clientIndexPath = path.join(clientDist, 'index.html');
  
  // Check if client dist exists before serving
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  } else {
    console.warn('[app] Client dist directory not found at:', clientDist);
  }
  
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    
    // Try to serve index.html if it exists
    if (fs.existsSync(clientIndexPath)) {
      res.sendFile(clientIndexPath);
    } else {
      // Fallback: serve a simple response
      res.status(200).json({ message: 'API is running. Client UI not available.' });
    }
  });

  return app;
}
