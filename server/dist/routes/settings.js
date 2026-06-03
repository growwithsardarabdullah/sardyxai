import { Router } from 'express';
import { ensureUserUnifiedKey, regenerateUnifiedKey } from '../db/index.js';
export const settingsRouter = Router();
function getUserEmail(req) {
    return req.user?.email ?? '';
}
// Get the unified API key for this user (creates one if needed)
settingsRouter.get('/api-key', (req, res) => {
    const email = getUserEmail(req);
    if (!email) {
        res.status(401).json({ error: { message: 'Authentication required' } });
        return;
    }
    const apiKey = ensureUserUnifiedKey(email);
    console.log(`[settings] GET /api-key user=${email} → ${apiKey.substring(0, 20)}...`);
    res.json({ apiKey });
});
// Regenerate the unified API key for this user
settingsRouter.post('/api-key/regenerate', (req, res) => {
    const email = getUserEmail(req);
    if (!email) {
        res.status(401).json({ error: { message: 'Authentication required' } });
        return;
    }
    const newKey = regenerateUnifiedKey(email);
    res.json({ apiKey: newKey });
});
//# sourceMappingURL=settings.js.map