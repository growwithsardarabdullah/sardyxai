import type { Request, Response, NextFunction } from 'express';
import { validateSession, SESSION_COOKIE_NAME } from '../services/auth.js';

// Gate the /api/* admin surface behind a dashboard session (#35, item #2).
// The token is the HMAC-signed session token issued by /api/auth/login|setup,
// sent as either:
//   1. `Authorization: Bearer <token>` (API clients), OR
//   2. The `freellmapi_session` httpOnly cookie (browsers; auto-sent on every
//      same-origin request, including the initial page load and post-refresh).
// The /v1 proxy is NOT gated by this — it keeps its own unified-API-key auth
// for app clients.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined)
    ?? (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
  const session = validateSession(token);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  (req as Request & { user?: typeof session }).user = session;
  next();
}
