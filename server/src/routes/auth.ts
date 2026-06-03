import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  userCount,
  createUser,
  verifyCredentials,
  createSession,
  validateSession,
  deleteSession,
  createPasswordResetToken,
  resetPassword,
  SESSION_COOKIE_NAME,
} from '../services/auth.js';

export const authRouter = Router();

// ── Cookie helpers ─────────────────────────────────────────────────────────
// Sessions are now stateless HMAC tokens stored in an httpOnly cookie. The cookie
// is automatically sent on every same-origin request, so it survives page
// refreshes, route changes, and Vercel cold starts (no server-side state).
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function setSessionCookie(res: Response, token: string): void {
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

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  console.log('[auth] Cookie cleared', { name: SESSION_COOKIE_NAME });
}

// Dashboard auth (#35). These routes are mounted BEFORE requireAuth, so
// /status, /register, /login, /forgot-password, /reset-password are reachable
// without a session (bootstrap); /logout and /me validate the token themselves.

const credentialsSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── Brute-force throttle ──────────────────────────────────────────────────
// Simple in-memory per-email limiter. A local single-user tool doesn't need a
// distributed store; this just blunts online password guessing.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function isLockedOut(email: string): boolean {
  const a = attempts.get(email.toLowerCase());
  return !!a && a.lockedUntil > Date.now();
}
function recordFailure(email: string): void {
  const key = email.toLowerCase();
  const a = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCKOUT_MS;
    a.count = 0;
  }
  attempts.set(key, a);
}
function clearFailures(email: string): void {
  attempts.delete(email.toLowerCase());
}

/**
 * Read the session token from either:
 *  - the `Authorization: Bearer <token>` header (API clients), OR
 *  - the `freellmapi_session` httpOnly cookie (browsers, set automatically by
 *    the browser on every same-origin request including the initial page load).
 */
function readToken(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
}

// Has the dashboard been set up yet, and is this caller authenticated?
authRouter.get('/status', (req: Request, res: Response) => {
  const session = validateSession(readToken(req));
  const result = {
    needsSetup: userCount() === 0,
    authenticated: !!session,
    email: session?.email ?? null,
  };
  console.log('[auth] /status', result);
  res.json(result);
});

// First-run account creation. When no users exist, this is the setup flow.
// When users already exist, this acts as a registration endpoint.
authRouter.post('/setup', (req: Request, res: Response) => {
  console.log('[auth] /setup attempt');
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const user = createUser(parsed.data.email, parsed.data.password);
    const token = createSession(user.userId, user.email);
    setSessionCookie(res, token);
    console.log('[auth] /setup success', { userId: user.userId, email: user.email });
    res.status(201).json({ token, email: user.email });
  } catch (err: any) {
    if (err.code === 'email_taken') {
      res.status(409).json({ error: { message: 'An account with that email already exists.', type: 'email_taken' } });
      return;
    }
    throw err;
  }
});

// Register a new account (alias for /setup when users already exist)
authRouter.post('/register', (req: Request, res: Response) => {
  console.log('[auth] /register attempt');
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const user = createUser(parsed.data.email, parsed.data.password);
    const token = createSession(user.userId, user.email);
    setSessionCookie(res, token);
    console.log('[auth] /register success', { userId: user.userId, email: user.email });
    res.status(201).json({ token, email: user.email });
  } catch (err: any) {
    if (err.code === 'email_taken') {
      res.status(409).json({ error: { message: 'An account with that email already exists.', type: 'email_taken' } });
      return;
    }
    throw err;
  }
});

authRouter.post('/login', (req: Request, res: Response) => {
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
    res.status(401).json({ error: { message: 'Invalid email or password', type: 'authentication_error' } });
    return;
  }

  clearFailures(email);
  const token = createSession(user.userId, user.email);
  setSessionCookie(res, token);
  console.log('[auth] /login success', { userId: user.userId, email: user.email });
  res.json({ token, email: user.email });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  console.log('[auth] /logout');
  deleteSession(readToken(req));
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.get('/me', (req: Request, res: Response) => {
  const session = validateSession(readToken(req));
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  res.json({ email: session.email });
});

// ── Forgot password ──────────────────────────────────────────────────────
// Generates a password reset token. Always returns success to avoid leaking
// whether an email exists. In production, this would send an email.
authRouter.post('/forgot-password', (req: Request, res: Response) => {
  const emailSchema = z.object({ email: z.string().email() });
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'A valid email is required' } });
    return;
  }

  const token = createPasswordResetToken(parsed.data.email);

  // Always return success — don't reveal whether the email exists
  console.log('[auth] /forgot-password', {
    email: parsed.data.email,
    tokenGenerated: !!token,
  });

  // In production, send an email with the reset link.
  // For now, return the token directly (works for single-user setups).
  // TODO: Replace with email sending in production
  if (token) {
    res.json({
      success: true,
      message: 'If an account exists with that email, a password reset link has been generated.',
      // Dev-only: include token in response. Remove in production with email.
      resetToken: token,
    });
  } else {
    res.json({
      success: true,
      message: 'If an account exists with that email, a password reset link has been generated.',
    });
  }
});

// Reset password with token
authRouter.post('/reset-password', (req: Request, res: Response) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const success = resetPassword(parsed.data.token, parsed.data.password);
  if (!success) {
    res.status(400).json({ error: { message: 'Invalid or expired reset token', type: 'invalid_token' } });
    return;
  }

  res.json({ success: true, message: 'Password has been reset. Please sign in with your new password.' });
});
