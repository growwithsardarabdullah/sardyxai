import { Router } from 'express';
import { z } from 'zod';
import { userCount, createUser, verifyCredentials, createSession, validateSession, SESSION_COOKIE_NAME, } from '../services/auth.js';
export const authRouter = Router();
// ── Cookie helpers ─────────────────────────────────────────────────────────
// Sessions are now stateless HMAC tokens stored in an httpOnly cookie. The cookie
// is automatically sent on every same-origin request, so it survives page
// refreshes, route changes, and Vercel cold starts (no server-side state).
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
function setSessionCookie(res, token) {
    // `secure: true` in production ensures the cookie is only sent over HTTPS.
    // `sameSite: 'lax'` lets the cookie be sent on top-level navigations but
    // blocks it on cross-site XHR (CSRF protection). `httpOnly` blocks JS access
    // so XSS can't steal the session.
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_SECONDS * 1000,
    });
    console.log('[auth] Cookie set', { name: SESSION_COOKIE_NAME, secure: isProd, ttlSeconds: SESSION_TTL_SECONDS });
}
function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    console.log('[auth] Cookie cleared', { name: SESSION_COOKIE_NAME });
}
// Dashboard auth (#35). These routes are mounted BEFORE requireAuth, so
// /status, /setup and /login are reachable without a session (bootstrap);
// /logout and /me validate the token themselves.
const credentialsSchema = z.object({
    email: z.string().email('A valid email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});
// ── Brute-force throttle ──────────────────────────────────────────────────
// Simple in-memory per-email limiter. A local single-user tool doesn't need a
// distributed store; this just blunts online password guessing.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map();
function isLockedOut(email) {
    const a = attempts.get(email.toLowerCase());
    return !!a && a.lockedUntil > Date.now();
}
function recordFailure(email) {
    const key = email.toLowerCase();
    const a = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
    a.count++;
    if (a.count >= MAX_ATTEMPTS) {
        a.lockedUntil = Date.now() + LOCKOUT_MS;
        a.count = 0;
    }
    attempts.set(key, a);
}
function clearFailures(email) {
    attempts.delete(email.toLowerCase());
}
/**
 * Read the session token from either:
 *  - the `Authorization: Bearer <token>` header (API clients), OR
 *  - the `freellmapi_session` httpOnly cookie (browsers, set automatically by
 *    the browser on every same-origin request including the initial page load).
 */
function readToken(req) {
    return req.headers.authorization?.replace(/^Bearer\s+/i, '')
        ?? req.cookies?.[SESSION_COOKIE_NAME];
}
// Has the dashboard been set up yet, and is this caller authenticated?
authRouter.get('/status', (req, res) => {
    const session = validateSession(readToken(req));
    const result = {
        needsSetup: userCount() === 0,
        authenticated: !!session,
        email: session?.email ?? null,
    };
    console.log('[auth] /status', result);
    res.json(result);
});
// First-run account creation. Only allowed while there are zero users, so it
// can't be used to add accounts once the dashboard is claimed.
authRouter.post('/setup', (req, res) => {
    console.log('[auth] /setup attempt');
    if (userCount() > 0) {
        res.status(409).json({ error: { message: 'Setup already completed. Use login instead.', type: 'setup_complete' } });
        return;
    }
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
        return;
    }
    const user = createUser(parsed.data.email, parsed.data.password);
    const token = createSession(user.userId, user.email);
    setSessionCookie(res, token);
    console.log('[auth] /setup success', { userId: user.userId, email: user.email });
    res.status(201).json({ token, email: user.email });
});
authRouter.post('/login', (req, res) => {
    console.log('[auth] /login attempt');
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
        return;
    }
    const { email, password } = parsed.data;
    if (isLockedOut(email)) {
        console.log('[auth] /login locked out', { email: email.toLowerCase() });
        res.status(429).json({ error: { message: 'Too many failed attempts. Try again later.', type: 'rate_limit_error' } });
        return;
    }
    const user = verifyCredentials(email, password);
    if (!user) {
        recordFailure(email);
        // Same message whether the email exists or not — don't leak which.
        res.status(401).json({ error: { message: 'Invalid email or password', type: 'authentication_error' } });
        return;
    }
    clearFailures(email);
    const token = createSession(user.userId, user.email);
    setSessionCookie(res, token);
    console.log('[auth] /login success', { userId: user.userId, email: user.email });
    res.json({ token, email: user.email });
});
authRouter.post('/logout', (req, res) => {
    console.log('[auth] /logout');
    clearSessionCookie(res);
    res.json({ success: true });
});
authRouter.get('/me', (req, res) => {
    const session = validateSession(readToken(req));
    if (!session) {
        res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
        return;
    }
    res.json({ email: session.email });
});
//# sourceMappingURL=auth.js.map