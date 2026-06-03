import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

// Dashboard authentication: email + password accounts with stateless, HMAC-signed
// session tokens. Distinct from the unified API key, which authenticates the /v1
// proxy for apps — this gates the /api/* admin surface for the human operator (#35).
//
// Sessions are STATELESS (no DB row per session). The token itself is
// `${base64url(payload)}.${base64url(hmacSha256(payload, SESSION_SECRET))}`
// where the payload is `{ userId, email, exp }`. The server verifies the HMAC
// and reads the user from the token — no DB lookup per request. This is
// required for serverless deploys (Vercel) where /tmp SQLite is per-instance
// and a session row written on one lambda would not exist on the next.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: number;
  email: string;
}

export const SESSION_COOKIE_NAME = 'freellmapi_session';

function getSessionSecret(): string {
  // Persistent secret. If SESSION_SECRET env var is set, use it. Otherwise derive
  // a stable secret from ENCRYPTION_KEY (which the user must already set in
  // production) so the cookie stays valid across deploys. As a last resort fall
  // back to a per-process random secret — this only works for the lifetime of a
  // single Vercel instance, but keeps the app bootable in dev without setup.
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return explicit;

  const encKey = process.env.ENCRYPTION_KEY;
  if (encKey && encKey.length >= 32) {
    return crypto.createHash('sha256').update(`session:${encKey}`).digest('hex');
  }

  // Last-resort dev fallback. Logs a warning so it's obvious in deploy logs.
  if (!(globalThis as any).__freellmapiDevSecret) {
    (globalThis as any).__freellmapiDevSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] SESSION_SECRET and ENCRYPTION_KEY both missing — using a per-process random secret. '
      + 'Sessions will NOT survive Vercel cold starts. Set SESSION_SECRET in your Vercel env vars.');
  }
  return (globalThis as any).__freellmapiDevSecret;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string): string {
  return base64url(
    crypto.createHmac('sha256', getSessionSecret()).update(payload).digest()
  );
}

/** Mint a signed session token. No DB write. */
export function createSession(userId: number, email: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = JSON.stringify({ userId, email, exp });
  const encoded = base64url(payload);
  const sig = sign(encoded);
  const token = `${encoded}.${sig}`;
  console.log('[auth] Session created', { userId, email, exp, tokenLen: token.length });
  return token;
}

/** Verify a signed session token. Returns the user on success, null on bad/expired. */
export function validateSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    console.log('[auth] Session validation failed: malformed token');
    return null;
  }
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(encoded);
  // Constant-time compare to avoid timing leaks
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.log('[auth] Session validation failed: bad signature');
    return null;
  }

  let payload: { userId: number; email: string; exp: number };
  try {
    payload = JSON.parse(base64urlDecode(encoded).toString('utf8'));
  } catch {
    console.log('[auth] Session validation failed: bad payload');
    return null;
  }
  if (typeof payload.userId !== 'number' || typeof payload.email !== 'string' || typeof payload.exp !== 'number') {
    console.log('[auth] Session validation failed: missing fields');
    return null;
  }
  if (payload.exp < Date.now()) {
    console.log('[auth] Session validation failed: expired', { exp: payload.exp, now: Date.now() });
    return null;
  }
  return { userId: payload.userId, email: payload.email };
}

/** Stateless — no DB write. Kept for API compatibility with /api/auth/logout. */
export function deleteSession(_token: string | undefined | null): void {
  // No-op: stateless sessions expire on their own. The caller is responsible for
  // clearing the cookie on the response.
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function userCount(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return row.c;
  } catch {
    // DB may not be initialized yet during boot
    return 0;
  }
}

/** Create a user. Throws { code: 'email_taken' } if the email already exists. */
export function createUser(email: string, password: string): SessionUser {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(normalized, hashPassword(password));
  console.log('[auth] User created', { userId: Number(result.lastInsertRowid), email: normalized });
  return { userId: Number(result.lastInsertRowid), email: normalized };
}

/** Verify credentials. Returns the user on success, null on failure. */
export function verifyCredentials(email: string, password: string): SessionUser | null {
  let db;
  try {
    db = getDb();
  } catch {
    console.error('[auth] verifyCredentials called before DB init');
    return null;
  }
  const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .get(normalizeEmail(email)) as { id: number; email: string; password_hash: string } | undefined;
  if (!row) {
    console.log('[auth] verifyCredentials: no user', { email: normalizeEmail(email) });
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) {
    console.log('[auth] verifyCredentials: bad password', { email: normalizeEmail(email) });
    return null;
  }
  console.log('[auth] verifyCredentials: success', { userId: row.id, email: row.email });
  return { userId: row.id, email: row.email };
}
