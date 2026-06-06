// Production + dev auth routes — supports Supabase Auth in production,
// SQLite HMAC-cookie/Bearer auth in dev/test.
// Auto-detects whether Supabase is configured; falls back to local mode.

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import * as authSupa from '../services/auth-supabase.js';
import * as authDev from '../services/auth-dev.js';

const USE_DEV_AUTH = !authDev.isSupabaseConfigured();

// ============================================================================
// Local (dev/test) auth — backed by the `users` SQLite table
// ============================================================================

import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const SESSION_COOKIE_NAME = 'freellmapi_session';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/',
};

// Simple in-memory brute-force protection: count consecutive bad-password
// attempts per email (never by IP — IP can be shared on Vercel).
// Resets on successful login or when count reaches threshold.
const loginAttempts = new Map<string, { count: number; until?: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(email: string): { allowed: boolean; retryAfterSec?: number } {
  const rec = loginAttempts.get(email);
  if (!rec) return { allowed: true };
  if (rec.until && Date.now() < rec.until) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.until - Date.now()) / 1000) };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    // Start lockout
    rec.until = Date.now() + LOCKOUT_MS;
    return { allowed: false, retryAfterSec: Math.ceil(LOCKOUT_MS / 1000) };
  }
  return { allowed: true };
}

function recordFailedAttempt(email: string) {
  const rec = loginAttempts.get(email) ?? { count: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.until = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(email, rec);
}

function clearAttempts(email: string) {
  loginAttempts.delete(email);
}

// ============================================================================
// HMAC token (stateless, invalidatable via session_version bump)
// ============================================================================

function getSecret(): string {
  return process.env.SESSION_SECRET ?? process.env.ENCRYPTION_KEY ?? '';
}

function signToken(userId: number, email: string, sessionVersion: number): string {
  const secret = getSecret();
  const payload = `${userId}|${email}|${sessionVersion}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

function verifyToken(token: string): { valid: boolean; userId?: number; email?: string; sessionVersion?: number } {
  try {
    const { payload, sig } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const secret = getSecret();
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length !== expected.length) return { valid: false };
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return { valid: false };
    }
    const parts = (payload as string).split('|');
    const userId = parts[0];
    const sessionVersion = parts[parts.length - 1];
    const email = parts.slice(1, -1).join('|'); // handles pipe in email (unlikely but safe)
    return { valid: true, userId: Number(userId), email, sessionVersion: Number(sessionVersion) };
  } catch {
    return { valid: false };
  }
}

function verifyLocalToken(token: string): { valid: boolean; user?: { id: string; email: string } } {
  const result = verifyToken(token);
  if (!result.valid || !result.userId || !result.email) {
    return { valid: false };
  }
  // Check the user still exists and session_version matches
  const db = getDb();
  const user = db.prepare('SELECT id, email, session_version FROM users WHERE id = ?').get(result.userId) as any;
  if (!user || user.session_version !== result.sessionVersion) {
    return { valid: false };
  }
  return { valid: true, user: { id: String(user.id), email: user.email } };
}

// ============================================================================
// Supabase auth interface (production)
// ============================================================================

const supaAuth = {
  signUp: authSupa.signUp,
  signIn: authSupa.signIn,
  loadUserData: authSupa.loadUserData,
  logout: authSupa.logout,
  verifyAccessToken: authSupa.verifyAccessToken,
  requestPasswordReset: authSupa.requestPasswordReset,
};

// ============================================================================
// Router
// ============================================================================

export const authRouter = Router();

// Helper: extract token from Authorization header or session cookie
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return (req as any).cookies?.[SESSION_COOKIE_NAME] ?? null;
}

// ============================================================================
// GET /api/auth/status
// ============================================================================

authRouter.get('/status', async (req: Request, res: Response) => {
  try {
    if (USE_DEV_AUTH) {
      // Local mode: check if any users exist (needsSetup)
      const db = getDb();
      const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as any).cnt;
      const token = extractToken(req);
      if (!token) {
        return res.json({ authenticated: false, needsSetup: userCount === 0, user: null, userData: null });
      }
      const { valid, user } = verifyLocalToken(token);
      if (!valid || !user) {
        res.clearCookie(SESSION_COOKIE_NAME);
        return res.json({ authenticated: false, needsSetup: userCount === 0, user: null, userData: null });
      }
      return res.json({ authenticated: true, needsSetup: false, user, userData: null, email: user.email });
    }

    // Supabase mode
    const token = extractToken(req);
    if (!token) {
      return res.json({ authenticated: false, needsSetup: false, user: null, userData: null });
    }
    const { valid, user } = await supaAuth.verifyAccessToken(token);
    if (!valid || !user) {
      res.clearCookie(SESSION_COOKIE_NAME);
      return res.json({ authenticated: false, needsSetup: false, user: null, userData: null });
    }
    const { success, data: userData } = await supaAuth.loadUserData(user.id || user.email);
    res.json({ authenticated: true, needsSetup: false, user, userData: success ? userData : null });
  } catch (err) {
    console.error('[auth] Status check error:', err);
    res.status(500).json({ error: { message: 'Status check failed' } });
  }
});

// ============================================================================
// POST /api/auth/setup — create an account (first-run or open registration in local mode)
// ============================================================================

const setupSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
});

authRouter.post('/setup', async (req: Request, res: Response) => {
  try {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => e.message).join(', ') },
      });
    }
    const { email, password } = parsed.data;

    if (USE_DEV_AUTH) {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ error: { message: 'Email already registered' } });
      }
      const hash = hashPassword(password);
      const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
      const userId = result.lastInsertRowid as number;
      const token = signToken(userId, email, 0);
      res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
      return res.status(201).json({ success: true, token, user: { id: String(userId), email } });
    }

    // Supabase mode
    const { success, error } = await supaAuth.signUp(email, password);
    if (!success) {
      return res.status(400).json({ error: { message: error || 'Signup failed' } });
    }
    const { success: ok, session } = await supaAuth.signIn(email, password);
    if (!ok || !session) {
      return res.status(500).json({ error: { message: 'Failed to create session after setup' } });
    }
    res.cookie(SESSION_COOKIE_NAME, session.accessToken, SESSION_COOKIE_OPTIONS);
    return res.status(201).json({ success: true, token: session.accessToken, user: session.user });
  } catch (err) {
    console.error('[auth] Setup error:', err);
    res.status(500).json({ error: { message: 'Setup failed' } });
  }
});

// ============================================================================
// POST /api/auth/register — same as setup (explicit registration endpoint)
// ============================================================================

authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => e.message).join(', ') },
      });
    }
    const { email, password } = parsed.data;

    if (USE_DEV_AUTH) {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ error: { message: 'Email already registered' } });
      }
      const hash = hashPassword(password);
      const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
      const userId = result.lastInsertRowid as number;
      const token = signToken(userId, email, 0);
      res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
      return res.status(201).json({ success: true, token, user: { id: String(userId), email } });
    }

    const { success, error } = await supaAuth.signUp(email, password);
    if (!success) {
      const status = error?.includes('already') ? 409 : 400;
      return res.status(status).json({ error: { message: error || 'Registration failed' } });
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[auth] Register error:', err);
    res.status(500).json({ error: { message: 'Registration failed' } });
  }
});

// ============================================================================
// POST /api/auth/signup — alias for register
// ============================================================================

authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => e.message).join(', ') },
      });
    }
    const { email, password } = parsed.data;

    if (USE_DEV_AUTH) {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ error: { message: 'Email already registered' } });
      }
      const hash = hashPassword(password);
      const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
      const userId = result.lastInsertRowid as number;
      const token = signToken(userId, email, 0);
      res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
      return res.status(201).json({ success: true, token, user: { id: String(userId), email } });
    }

    const { success, error } = await supaAuth.signUp(email, password);
    if (!success) {
      const status = error?.includes('already') ? 409 : 400;
      return res.status(status).json({ error: { message: error || 'Signup failed' } });
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[auth] Signup error:', err);
    res.status(500).json({ error: { message: 'Signup failed' } });
  }
});

// ============================================================================
// POST /api/auth/login
// ============================================================================

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => e.message).join(', '), type: 'validation_error' },
      });
    }
    const { email, password } = parsed.data;

    // Rate limiting check
    const rl = checkRateLimit(email);
    if (!rl.allowed) {
      return res.status(429).json({
        error: {
          message: `Too many failed attempts. Try again in ${rl.retryAfterSec}s.`,
          type: 'rate_limit_error',
        },
      });
    }

    if (USE_DEV_AUTH) {
      const db = getDb();
      const user = db.prepare('SELECT id, email, password_hash, session_version FROM users WHERE email = ?').get(email) as any;
      if (!user || !verifyPassword(password, user.password_hash)) {
        recordFailedAttempt(email);
        return res.status(401).json({
          error: { message: 'Invalid email or password', type: 'authentication_error' },
        });
      }
      clearAttempts(email);
      const token = signToken(user.id, email, user.session_version);
      res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
      return res.json({ success: true, token, user: { id: String(user.id), email } });
    }

    // Supabase mode
    const { success, session, error } = await supaAuth.signIn(email, password);
    if (!success || !session) {
      recordFailedAttempt(email);
      return res.status(401).json({
        error: { message: error || 'Invalid email or password', type: 'authentication_error' },
      });
    }
    clearAttempts(email);
    res.cookie(SESSION_COOKIE_NAME, session.accessToken, SESSION_COOKIE_OPTIONS);
    return res.json({ success: true, token: session.accessToken, user: session.user });
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================

authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    if (USE_DEV_AUTH) {
      // Bump session_version to invalidate all tokens for this user
      const token = extractToken(req);
      if (token) {
        const result = verifyLocalToken(token);
        if (result.valid && result.user) {
          const db = getDb();
          db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(result.user.id);
        }
      }
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('[auth] Logout error:', err);
    res.status(500).json({ error: { message: 'Logout failed' } });
  }
});

// ============================================================================
// GET /api/auth/me
// ============================================================================

authRouter.get('/me', requireAuth as any, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: { message: 'Not authenticated' } });
    }
    res.json({ user, userData: null });
  } catch (err) {
    console.error('[auth] Me endpoint error:', err);
    res.status(500).json({ error: { message: 'Failed to load user info' } });
  }
});

// ============================================================================
// POST /api/auth/forgot-password
// ============================================================================

authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: { message: 'Email required' } });
    }
    if (!USE_DEV_AUTH) {
      await supaAuth.requestPasswordReset(email);
    }
    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[auth] Forgot password error:', err);
    res.status(500).json({ error: { message: 'Failed to process password reset' } });
  }
});

// ============================================================================
// requireAuth middleware — checks Bearer token or session cookie
// ============================================================================

export async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: { message: 'Authentication required' } });
    return;
  }

  if (USE_DEV_AUTH) {
    const { valid, user } = verifyLocalToken(token);
    if (!valid || !user) {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(401).json({ error: { message: 'Invalid or expired session' } });
      return;
    }
    (req as any).user = user;
    next();
    return;
  }

  // Supabase mode
  const { valid, user, error } = await supaAuth.verifyAccessToken(token);
  if (!valid || !user) {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(401).json({ error: { message: error || 'Invalid or expired session' } });
    return;
  }
  (req as any).user = user;
  next();
}

// Alias for backward compat
export const verifyAuthMiddleware = requireAuth;
