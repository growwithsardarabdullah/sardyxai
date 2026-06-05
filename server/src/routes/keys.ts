import { Router } from 'express';

/**
 * DEPRECATED: This route has been replaced by user-data routes.
 * 
 * Legacy key management is now handled by:
 * - GET/POST/PATCH/DELETE /api/user/keys - Manage provider keys
 * - GET/POST /api/user/unified-key - Get or regenerate unified API key
 * 
 * Kept for backward compatibility but no longer used.
 */
export const keysRouter = Router();
