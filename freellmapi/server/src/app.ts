import express from 'express';
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
  }));
  app.use(express.json({ limit: '1mb' }));

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
      // Fallback: serve an informational landing page
      res.status(200).send(getLandingPage());
    }
  });

  return app;
}

function getLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FreeLLMAPI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0d12;
      color: #e6e8eb;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .container { max-width: 880px; margin: 0 auto; padding: 48px 24px; width: 100%; }
    header { text-align: center; margin-bottom: 48px; }
    h1 { font-size: 2.5rem; margin-bottom: 8px; background: linear-gradient(90deg, #6ec1ff, #b388ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .tagline { color: #9aa3af; font-size: 1.1rem; }
    .status { display: inline-flex; align-items: center; gap: 8px; background: #0f3a23; color: #4ade80; padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; margin-top: 16px; }
    .status::before { content: ""; width: 8px; height: 8px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 8px #4ade80; }
    h2 { font-size: 1.4rem; margin: 32px 0 16px; color: #e6e8eb; border-bottom: 1px solid #1f2937; padding-bottom: 8px; }
    .endpoint { background: #11141b; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 12px; font-family: "SF Mono", Monaco, monospace; font-size: 0.9rem; }
    .method { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; margin-right: 8px; }
    .get { background: #1e3a5f; color: #6ec1ff; }
    .post { background: #14532d; color: #4ade80; }
    .path { color: #e6e8eb; }
    .desc { color: #9aa3af; margin-top: 6px; font-size: 0.85rem; font-family: inherit; }
    code { background: #1f2937; color: #fbbf24; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }
    pre { background: #11141b; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.85rem; margin: 12px 0; }
    .links { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 32px; justify-content: center; }
    .links a { background: #1f2937; color: #e6e8eb; padding: 10px 20px; border-radius: 8px; text-decoration: none; transition: all 0.2s; }
    .links a:hover { background: #374151; transform: translateY(-1px); }
    footer { text-align: center; color: #6b7280; font-size: 0.85rem; margin-top: auto; padding: 24px; border-top: 1px solid #1f2937; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>FreeLLMAPI</h1>
      <p class="tagline">One OpenAI-compatible endpoint. Multiple free LLM providers.</p>
      <span class="status">API Running</span>
    </header>

    <h2>Quick Start</h2>
    <pre><code>curl https://&lt;your-domain&gt;/v1/chat/completions \\
  -H "Authorization: Bearer freellmapi-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</code></pre>

    <h2>Endpoints</h2>
    <div class="endpoint">
      <span class="method post">POST</span><span class="path">/v1/chat/completions</span>
      <div class="desc">OpenAI-compatible chat completions (the only endpoint apps need)</div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/v1/models</span>
      <div class="desc">List all available models from configured providers</div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/api/ping</span>
      <div class="desc">Health check &mdash; returns <code>{status: "ok"}</code></div>
    </div>
    <div class="endpoint">
      <span class="method post">POST</span><span class="path">/api/auth/setup</span>
      <div class="desc">Create the first admin account (one-time bootstrap)</div>
    </div>
    <div class="endpoint">
      <span class="method post">POST</span><span class="path">/api/auth/login</span>
      <div class="desc">Log in to the admin dashboard</div>
    </div>

    <h2>Client UI</h2>
    <p style="color: #9aa3af;">The admin dashboard (React + Vite) is not bundled with this deployment. Use the API directly, or build and serve <code>client/dist</code> alongside the server to enable the web UI.</p>

    <div class="links">
      <a href="/api/ping">Health Check</a>
      <a href="/v1/models">View Models</a>
      <a href="https://github.com/growwithsardarabdullah/sardyxai" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>
  <footer>FreeLLMAPI &middot; OpenAI-compatible LLM proxy</footer>
</body>
</html>`;
}
