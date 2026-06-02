// Import from compiled server build
import { createApp } from '../server/dist/app.js';
import { initDb } from '../server/dist/db/index.js';
import { startHealthChecker } from '../server/dist/services/health.js';
// Initialize env from server
import '../server/dist/env.js';
// Initialize database once on cold start
let initialized = false;
let app = null;
async function initializeApp() {
    if (initialized)
        return;
    try {
        initDb();
        app = createApp();
        startHealthChecker();
        initialized = true;
        console.log('[Vercel] App initialized successfully');
    }
    catch (error) {
        console.error('[Vercel] Initialization failed:', error);
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
        res.status(500).json({
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
//# sourceMappingURL=index.js.map