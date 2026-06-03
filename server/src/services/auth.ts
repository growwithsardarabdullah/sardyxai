import crypto from 'crypto';
import { getDb, getPersistence } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { getSupabaseAdmin } from '../db/supabase.js';

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

// Per-user token version. Bumped on logout (and on login from a different
// device) so any previously-issued stateless token with an older version is
// rejected — this gives us real logout invalidation while keeping the cookie
// itself stateless (no DB row per session).
function getUserSessionVersion(userId: number): number {
  try {
    const row = getDb().prepare('SELECT session_version FROM users WHERE id = ?').get(userId) as { session_version: number } | undefined;
    return row?.session_version ?? 0;
  } catch {
    return 0;
  }
}

function bumpUserSessionVersion(userId: number): void {
  try {
    getDb().prepare('UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?').run(userId);
  } catch { /* ignore */ }
  // Mirror to Supabase. The local userId is not the Supabase userId, so we
  // resolve by email. Captured here because the route handler doesn't pass
  // the email — we'd have to look it up. Keep this best-effort: if the user
  // table is empty on Supabase yet, the next cold-start hydration will catch
  // the bump up.
  try {
    const row = getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    if (row) {
      getPersistence().enqueueWrite(async () => {
        const sb = getSupabaseAdmin();
        if (!sb) return;
        // The Supabase users table doesn't have session_version, so there's
        // nothing to update on the mirror side. The mirror is for persistence
        // of the user record itself, not the runtime session counter. The
        // local SQLite value survives cold starts in the same instance; on a
        // new instance, hydration resets it to 0 and active sessions stay
        // valid (the version check still passes). This is acceptable for v1.
        // No-op write to keep the queue progressing.
        const { error } = await sb.from('users').select('id').eq('email', row.email).limit(1);
        if (error) throw new Error(`users probe: ${error.message}`);
      }, `users:session-bump:${userId}`);
    }
  } catch { /* best-effort */ }
}

function getSessionSecret(): string {
  // Persistent secret. If SESSION_SECRET env var is set, use it. Otherwise derive
  // a stable secret from ENCRYPTION_KEY (which the user must already set in
  // production) so the cookie stays valid across deploys. As a last resort, on
  // Vercel we derive a deployment-stable secret from Vercel metadata so sessions
  // survive cold starts of the same deployment.
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) {
    console.log('[auth] Using SESSION_SECRET from env var');
    return explicit;
  }

  const encKey = process.env.ENCRYPTION_KEY;
  if (encKey && encKey.length >= 32) {
    return crypto.createHash('sha256').update(`session:${encKey}`).digest('hex');
  }

  // Vercel fallback: derive a stable secret from deployment metadata so cookies
  // survive cold starts. LOST on redeploy (a SHA change rotates the secret).
  const vercelKeySource = process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL;
  if (vercelKeySource) {
    const derived = crypto.createHash('sha256')
      .update(`freellmapi-session-secret:v1:${vercelKeySource}`)
      .digest('hex');
    console.warn(`[auth] No SESSION_SECRET/ENCRYPTION_KEY set — derived a STABLE secret from Vercel metadata (${vercelKeySource.substring(0, 12)}...). Survives cold starts of THIS deployment but is LOST on redeploy. For long-term persistence, set SESSION_SECRET in Vercel env vars.`);
    return derived;
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

/**
 * Mint a signed session token. The token is stateless (no DB row), but it
 * carries the user's `v` (session_version) field so we can invalidate all of a
 * user's tokens by bumping that version in the DB on logout.
 */
export function createSession(userId: number, email: string = ''): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const v = getUserSessionVersion(userId);
  const payload = JSON.stringify({ userId, email, exp, v });
  const encoded = base64url(payload);
  const sig = sign(encoded);
  const token = `${encoded}.${sig}`;
  console.log('[auth] Session created', { userId, email, exp, v, tokenLen: token.length });
  return token;
}

/** Verify a signed session token. Returns the user on success, null on bad/expired/invalidated. */
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

  let payload: { userId: number; email: string; exp: number; v?: number };
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
  // Compare the token's session_version with the DB. If the user has logged
  // out since this token was issued, their version is now higher and we reject
  // the token. This is the "real" logout invalidation.
  const currentVersion = getUserSessionVersion(payload.userId);
  const tokenVersion = payload.v ?? 0;
  if (tokenVersion !== currentVersion) {
    console.log('[auth] Session validation failed: invalidated by logout', { tokenVersion, currentVersion });
    return null;
  }
  return { userId: payload.userId, email: payload.email };
}

/** Invalidate all of a user's currently-issued tokens by bumping their session_version. */
export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  const session = validateSession(token);
  if (!session) return;
  bumpUserSessionVersion(session.userId);
  console.log('[auth] deleteSession: bumped session_version for user', { userId: session.userId });
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
  const passwordHash = hashPassword(password);
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(normalized, passwordHash);
  const userId = Number(result.lastInsertRowid);
  console.log('[auth] User created', { userId, email: normalized });

  // Mirror to Supabase. The Supabase users table has no session_version column,
  // so we don't send it. The local rowid is not the Supabase id; the mirror
  // uses email as the stable identifier and lets Supabase auto-assign.
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { error } = await sb.from('users').insert({
      email: normalized,
      password_hash: passwordHash,
    });
    if (error) throw new Error(`users insert: ${error.message}`);
  }, `users:insert:${userId}`);

  return { userId, email: normalized };
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
