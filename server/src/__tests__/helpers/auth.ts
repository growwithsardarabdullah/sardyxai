import crypto from 'crypto';
import { getDb } from '../../db/index.js';
import { hashPassword } from '../../lib/password.js';

// Dashboard /api/* routes are gated by requireAuth (#35). Tests mint a session
// token once (after initDb) and attach it to gated requests.
// Uses the same local SQLite users table + HMAC token scheme as the auth routes.

function signToken(userId: number, email: string, sessionVersion: number): string {
  const SECRET = process.env.SESSION_SECRET ?? process.env.ENCRYPTION_KEY ?? 'test-secret';
  const payload = `${userId}|${email}|${sessionVersion}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

export function mintDashboardToken(email = 'test@example.com'): string {
  const db = getDb();
  // Ensure dev auth tables exist
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Create or find the user
  let user = db.prepare('SELECT id, email, session_version FROM users WHERE email = ?').get(email) as any;
  if (!user) {
    const hash = hashPassword('password123');
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
    user = { id: result.lastInsertRowid, email, session_version: 0 };
  }
  return signToken(user.id as number, email, user.session_version as number);
}

// Gated = under /api/ but not the public bootstrap routes (/api/auth/*, /api/ping).
export function isGatedApiPath(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/auth') && path !== '/api/ping';
}
