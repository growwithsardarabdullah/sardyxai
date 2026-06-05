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
import { authRouter } from './routes/auth-supabase.js';
import { userDataRouter } from './routes/user-data.js';
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
        origin(origin, callback) {
            callback(null, !origin || allowedCorsOrigins.has(origin));
        },
        credentials: true,
    }));
    app.use(express.json({ limit: '1mb' }));
    // Cookie parser — required so /api/auth can read the httpOnly session cookie.
    // Hand-rolled (no extra dep) — only the `freellmapi_session` cookie is read.
    app.use((req, _res, next) => {
        const header = req.headers.cookie;
        if (!header) {
            next();
            return;
        }
        const jar = {};
        for (const part of header.split(';')) {
            const eq = part.indexOf('=');
            if (eq <= 0)
                continue;
            const k = part.slice(0, eq).trim();
            const v = part.slice(eq + 1).trim();
            if (k)
                jar[k] = decodeURIComponent(v);
        }
        req.cookies = jar;
        next();
    });
    // Authentication routes (Supabase Auth)
    app.use('/api/auth', authRouter);
    // User data routes (keys, settings, usage)
    app.use('/api/user', userDataRouter);
    // API routes — legacy endpoints (can add requireAuth back if needed)
    app.use('/api/keys', keysRouter);
    app.use('/api/models', modelsRouter);
    app.use('/api/fallback', fallbackRouter);
    app.use('/api/analytics', analyticsRouter);
    app.use('/api/health', healthRouter);
    app.use('/api/settings', settingsRouter);
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
    // Debug: persistence status + per-table Supabase test (no auth required)
    app.get('/api/debug/persistence', async (_req, res) => {
        const { getPersistence } = await import('./db/index.js');
        const { getSupabaseAdmin } = await import('./db/supabase.js');
        const persistence = getPersistence();
        const stats = persistence.stats();
        const sb = getSupabaseAdmin();
        const tables = ['users', 'api_keys', 'models', 'fallback_config', 'settings', 'sessions', 'requests'];
        const tableTests = {};
        if (sb) {
            for (const table of tables) {
                try {
                    const { data, error, count } = await sb.from(table).select('id', { count: 'exact', head: true });
                    if (error) {
                        tableTests[table] = { ok: false, error: `${error.message} (code: ${error.code})` };
                    }
                    else {
                        tableTests[table] = { ok: true, count: count ?? 0 };
                    }
                }
                catch (err) {
                    tableTests[table] = { ok: false, error: err.message };
                }
            }
        }
        // Also test a direct INSERT into api_keys to confirm writes work
        let writeTest = { ok: false };
        if (sb) {
            try {
                const { error } = await sb.from('api_keys').insert({
                    user_email: '__debug_test__',
                    platform: 'debug',
                    label: 'test',
                    encrypted_key: 'test',
                    iv: 'test',
                    auth_tag: 'test',
                    status: 'test',
                    enabled: false,
                });
                if (error) {
                    writeTest = { ok: false, error: `${error.message} (code: ${error.code})` };
                }
                else {
                    // Clean up the test row
                    await sb.from('api_keys').delete().eq('user_email', '__debug_test__').eq('platform', 'debug');
                    writeTest = { ok: true };
                }
            }
            catch (err) {
                writeTest = { ok: false, error: err.message };
            }
        }
        res.json({
            persistence: stats,
            supabaseAdminAvailable: !!sb,
            tableTests,
            writeTest,
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
    // Try multiple path resolutions for compatibility with different environments
    const possibleClientDist = [
        path.resolve(__dirname, '../../client/dist'),
        path.resolve(process.cwd(), 'client/dist'),
        path.join(process.cwd(), '..', 'client', 'dist'),
        '/var/task/client/dist', // Vercel specific
    ];
    let clientDist = null;
    let clientIndexPath = null;
    console.log(`[app] __dirname: ${__dirname}`);
    console.log(`[app] process.cwd(): ${process.cwd()}`);
    for (const possiblePath of possibleClientDist) {
        const exists = fs.existsSync(possiblePath);
        console.log(`[app] Checking ${possiblePath}: ${exists}`);
        if (exists) {
            clientDist = possiblePath;
            clientIndexPath = path.join(possiblePath, 'index.html');
            console.log(`[app] ✓ Found client dist at: ${clientDist}`);
            break;
        }
    }
    if (!clientDist) {
        console.warn('[app] ✗ Client dist directory not found at any of:', possibleClientDist);
        // Try to list what we have in the current directory
        try {
            const cwdContents = fs.readdirSync(process.cwd());
            console.log('[app] Contents of cwd:', cwdContents.slice(0, 20));
        }
        catch (e) {
            console.error('[app] Could not list cwd:', e);
        }
    }
    // Check if client dist exists before serving
    if (clientDist && fs.existsSync(clientDist)) {
        console.log(`[app] Registering express.static for: ${clientDist}`);
        app.use(express.static(clientDist, {
            maxAge: '1d',
            etag: false,
            fallthrough: true, // Continue to next middleware if file not found
            dotfiles: 'ignore', // Ignore .gitkeep and other dot files
        }));
    }
    else {
        console.warn('[app] Skipping express.static - client dist not accessible');
    }
    // SPA fallback — serve index.html for non-API routes (only if file wasn't found by express.static)
    app.use((req, res, next) => {
        // Don't intercept API or versioned routes
        if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        // Don't intercept requests for files with extensions (except .html)
        const ext = path.extname(req.path);
        if (ext && ext !== '.html') {
            console.warn(`[app] Rejecting file request (extension: ${ext}): ${req.path}`);
            res.status(404).send('Not found');
            return;
        }
        // Try to serve index.html if it exists
        if (clientIndexPath && fs.existsSync(clientIndexPath)) {
            console.log(`[app] Serving SPA fallback for: ${req.path}`);
            res.sendFile(clientIndexPath);
        }
        else {
            console.warn(`[app] index.html not found at: ${clientIndexPath}`);
            res.status(200).json({ message: 'API is running. Client UI not available.' });
        }
    });
    return app;
}
//# sourceMappingURL=app.js.map