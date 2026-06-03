// Initialize env from server FIRST
import '../server/dist/env.js';
// Import from compiled server build
import { createApp } from '../server/dist/app.js';
import { initDbAsync } from '../server/dist/db/index.js';
import { startHealthChecker } from '../server/dist/services/health.js';
// Initialize database once on cold start
let initialized = false;
let app = null;
let initError = null;
async function initializeApp() {
    if (initialized)
        return;
    if (initError)
        throw initError;
    try {
        // Log env var status immediately — critical for diagnosing issues
        console.log('[Vercel] Starting initialization...');
        console.log('[Vercel] NODE_ENV:', process.env.NODE_ENV);
        console.log('[Vercel] Env vars:', JSON.stringify({
            SUPABASE_URL: !!process.env.SUPABASE_URL,
            SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
            SESSION_SECRET: !!process.env.SESSION_SECRET,
        }));
        if (!process.env.SUPABASE_URL) {
            console.error('[Vercel] WARNING: SUPABASE_URL is NOT set. Data will NOT persist across cold starts.');
        }
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error('[Vercel] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is NOT set. ALL Supabase writes will fail silently.');
        }
        if (!process.env.ENCRYPTION_KEY) {
            console.error('[Vercel] WARNING: ENCRYPTION_KEY is NOT set. Keys may not decrypt correctly.');
        }
        await initDbAsync();
        console.log('[Vercel] Database initialized');
        app = createApp();
        console.log('[Vercel] Express app created');
        startHealthChecker();
        console.log('[Vercel] Health checker started');
        // Verify Supabase connection
        const { verifySupabaseConnection } = await import('../server/dist/db/supabase.js');
        const supabaseOk = await verifySupabaseConnection();
        if (supabaseOk) {
            console.log('[Vercel] Supabase connection verified OK');
        }
        else if (process.env.SUPABASE_URL) {
            console.error('[Vercel] WARNING: Supabase is configured but connection FAILED. Data will NOT persist.');
        }
        else {
            console.log('[Vercel] Supabase not configured (no SUPABASE_URL). Running in local-only mode.');
        }
        initialized = true;
        console.log('[Vercel] App initialized successfully');
    }
    catch (error) {
        console.error('[Vercel] Initialization FAILED:', error);
        initError = error;
        throw error;
    }
}
export default async (req, res) => {
    try {
        // Initialize on first request
        if (!app) {
            await initializeApp();
        }
        // Handle the request through Express
        return app(req, res);
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map