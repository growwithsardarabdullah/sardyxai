import { Router } from 'express';
import { z } from 'zod';
import { userCount, createUser, verifyCredentials, createSession, validateSession, deleteSession, } from '../services/auth.js';
export const authRouter = Router();
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
function bearer(req) {
    return req.headers.authorization?.replace(/^Bearer\s+/i, '')
        ?? req.headers['x-dashboard-token'];
}
// Has the dashboard been set up yet, and is this caller authenticated?
authRouter.get('/status', (req, res) => {
    const session = validateSession(bearer(req));
    res.json({
        needsSetup: userCount() === 0,
        authenticated: !!session,
        email: session?.email ?? null,
    });
});
// First-run account creation. Only allowed while there are zero users, so it
// can't be used to add accounts once the dashboard is claimed.
authRouter.post('/setup', (req, res) => {
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
    const token = createSession(user.userId);
    res.status(201).json({ token, email: user.email });
});
authRouter.post('/login', (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
        return;
    }
    const { email, password } = parsed.data;
    if (isLockedOut(email)) {
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
    const token = createSession(user.userId);
    res.json({ token, email: user.email });
});
authRouter.post('/logout', (req, res) => {
    deleteSession(bearer(req));
    res.json({ success: true });
});
authRouter.get('/me', (req, res) => {
    const session = validateSession(bearer(req));
    if (!session) {
        res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
        return;
    }
    res.json({ email: session.email });
});
//# sourceMappingURL=auth.js.map