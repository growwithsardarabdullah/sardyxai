# Code Refactoring Examples
## Converting SQLite to Supabase Service Layer

This document provides concrete examples of how to refactor existing route handlers and services.

---

## Pattern 1: Route Handler Conversion

### Before (SQLite, Synchronous)

**File: `server/src/routes/keys.ts`**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

router.get('/api/keys', (req, res) => {
  try {
    const db = getDb();
    const keys = db.prepare('SELECT * FROM api_keys WHERE enabled = 1 ORDER BY created_at DESC').all();
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/keys', (req, res) => {
  try {
    const { platform, label, encrypted_key, iv, auth_tag, status } = req.body;
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(platform, label, encrypted_key, iv, auth_tag, status);
    
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
```

### After (Supabase, Async)

**File: `server/src/routes/keys.ts`**

```typescript
import { Router } from 'express';
import * as db from '../db/supabase-service.js';

const router = Router();

router.get('/api/keys', async (req, res) => {
  try {
    const { data: keys } = await supabaseClient
      .from('api_keys')
      .select('id, platform, label, status, enabled, created_at, last_checked_at')
      .eq('enabled', true)
      .order('created_at', { ascending: false });
    
    res.json(keys || []);
  } catch (error) {
    console.error('Error fetching keys:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/keys', async (req, res) => {
  try {
    const { platform, label, encrypted_key, iv, auth_tag, status } = req.body;
    
    // Validate input
    if (!platform || !encrypted_key) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const key = await db.createApiKey({
      platform,
      label,
      encrypted_key,
      iv,
      auth_tag,
      status: status || 'unknown',
    });
    
    res.json({ id: key.id });
  } catch (error) {
    console.error('Error creating key:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
```

---

## Pattern 2: Service Method Conversion

### Before (SQLite)

**File: `server/src/services/auth.ts`**

```typescript
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as any;
  return row.c;
}

export function createUser(email: string, password: string) {
  const db = getDb();
  const normalized = email.toLowerCase().trim();
  
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) throw new Error('email_taken');
  
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(normalized, hashPassword(password));
  
  return { userId: Number(result.lastInsertRowid), email: normalized };
}

export function validateSession(token: string | null) {
  if (!token) return null;
  
  const db = getDb();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const row = db.prepare(`
    SELECT s.user_id, s.expires_at_ms, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash) as any;
  
  if (!row) return null;
  if (row.expires_at_ms < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  
  return { userId: row.user_id, email: row.email };
}
```

### After (Supabase)

**File: `server/src/services/auth.ts`**

```typescript
import crypto from 'crypto';
import * as db from '../db/supabase-service.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function userCount(): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  
  if (error) throw error;
  return count || 0;
}

export async function createUser(email: string, password: string) {
  const normalized = email.toLowerCase().trim();
  
  // Check if user exists
  const existing = await db.getUserByEmail(normalized);
  if (existing) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }
  
  // Create user
  const user = await db.createUser(normalized, hashPassword(password));
  return { userId: user.id, email: user.email };
}

export async function validateSession(token: string | undefined | null) {
  if (!token) return null;
  
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await db.getSession(tokenHash);
  
  if (!session) return null;
  if (session.expires_at_ms < Date.now()) {
    await db.deleteSession(tokenHash);
    return null;
  }
  
  return { userId: session.user_id, email: session.users.email };
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  await db.createSession(userId, tokenHash, Date.now() + SESSION_TTL_MS);
  return token;
}
```

---

## Pattern 3: Complex Query with Aggregation

### Before (SQLite with Sync API)

**File: `server/src/services/router.ts`**

```typescript
import { getDb } from '../db/index.js';

let statsCache: Map<string, ModelStats> | null = null;
let statsCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

export function refreshStatsCache(db: Database, force = false): void {
  if (!force && statsCache && Date.now() - statsCacheTime < CACHE_TTL_MS) return;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const buckets = db.prepare(`
    SELECT platform, model_id,
      CAST((julianday('now') - julianday(created_at)) AS INTEGER) AS age_days,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes
    FROM requests
    WHERE created_at >= ?
    GROUP BY platform, model_id, age_days
  `).all(since) as any[];

  const acc = new Map<string, any>();
  for (const b of buckets) {
    const key = `${b.platform}:${b.model_id}`;
    const w = decayWeight(b.age_days);
    const a = acc.get(key) ?? { wSucc: 0, wFail: 0 };
    a.wSucc += w * b.successes;
    a.wFail += w * (b.total - b.successes);
    acc.set(key, a);
  }

  statsCache = new Map(acc);
  statsCacheTime = Date.now();
}
```

### After (Supabase with Async)

**File: `server/src/services/router.ts`**

```typescript
import * as db from '../db/supabase-service.js';
import { getSupabaseClient } from '../db/supabase.js';

let statsCache: Map<string, ModelStats> | null = null;
let statsCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

export async function refreshStatsCache(force = false): Promise<void> {
  if (!force && statsCache && Date.now() - statsCacheTime < CACHE_TTL_MS) return;

  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  // Fetch requests using raw SQL or Supabase queries
  const { data: requests, error } = await supabase
    .from('requests')
    .select('platform, model_id, status, created_at')
    .gte('created_at', since);

  if (error) {
    console.error('Error fetching stats:', error);
    return;
  }

  // Group and aggregate in JavaScript (or use Supabase aggregations)
  const acc = new Map<string, {
    wSucc: number;
    wFail: number;
  }>();

  for (const req of (requests || [])) {
    const key = `${req.platform}:${req.model_id}`;
    
    // Calculate age
    const ageMs = Date.now() - new Date(req.created_at).getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const w = decayWeight(ageDays);
    
    const a = acc.get(key) ?? { wSucc: 0, wFail: 0 };
    if (req.status === 'success') {
      a.wSucc += w;
    } else {
      a.wFail += w;
    }
    acc.set(key, a);
  }

  statsCache = new Map(acc);
  statsCacheTime = Date.now();
}

function decayWeight(ageDays: number): number {
  const HALF_LIFE_DAYS = 2;
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}
```

---

## Pattern 4: Rate Limiting

### Before (SQLite)

**File: `server/src/services/ratelimit.ts`**

```typescript
import { getDb } from '../db/index.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function canMakeRequest(
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm?: number | null; rpd?: number | null },
): boolean {
  const now = Date.now();

  if (limits.rpm) {
    const row = getDb().prepare(`
      SELECT COUNT(*) AS used
      FROM rate_limit_usage
      WHERE platform = ? AND model_id = ? AND key_id = ? AND kind = 'request'
        AND created_at_ms > ?
    `).get(platform, modelId, keyId, now - MINUTE) as any;
    
    if (row.used >= limits.rpm) return false;
  }

  if (limits.rpd) {
    const row = getDb().prepare(`
      SELECT COUNT(*) AS used
      FROM rate_limit_usage
      WHERE platform = ? AND model_id = ? AND key_id = ? AND kind = 'request'
        AND created_at_ms > ?
    `).get(platform, modelId, keyId, now - DAY) as any;
    
    if (row.used >= limits.rpd) return false;
  }

  return true;
}

export function recordRequest(platform: string, modelId: string, keyId: number) {
  getDb().prepare(`
    INSERT INTO rate_limit_usage (platform, model_id, key_id, kind, tokens, created_at_ms)
    VALUES (?, ?, ?, 'request', 0, ?)
  `).run(platform, modelId, keyId, Date.now());
}
```

### After (Supabase)

**File: `server/src/services/ratelimit.ts`**

```typescript
import * as db from '../db/supabase-service.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export async function canMakeRequest(
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm?: number | null; rpd?: number | null },
): Promise<boolean> {
  const now = Date.now();

  if (limits.rpm) {
    const count = await db.countRateLimitRequests(platform, modelId, keyId, MINUTE);
    if (count >= limits.rpm) return false;
  }

  if (limits.rpd) {
    const count = await db.countRateLimitRequests(platform, modelId, keyId, DAY);
    if (count >= limits.rpd) return false;
  }

  return true;
}

export async function recordRequest(
  platform: string,
  modelId: string,
  keyId: number,
): Promise<void> {
  await db.recordRateLimitUsage(platform, modelId, keyId, 'request', 0);
}

export async function recordTokens(
  platform: string,
  modelId: string,
  keyId: number,
  tokens: number,
): Promise<void> {
  await db.recordRateLimitUsage(platform, modelId, keyId, 'tokens', tokens);
}
```

---

## Pattern 5: Transaction Handling

### Before (SQLite)

```typescript
export function transferApiKey(fromUserId: number, toUserId: number, keyId: number): boolean {
  const db = getDb();
  
  const txn = db.transaction(() => {
    const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?')
      .get(keyId, fromUserId);
    
    if (!key) throw new Error('Key not found');
    
    db.prepare('UPDATE api_keys SET user_id = ? WHERE id = ?')
      .run(toUserId, keyId);
    
    db.prepare('INSERT INTO audit_logs (action, key_id, from_user, to_user) VALUES (?, ?, ?, ?)')
      .run('transfer', keyId, fromUserId, toUserId);
  });
  
  txn();
  return true;
}
```

### After (Supabase)

```typescript
export async function transferApiKey(
  fromUserId: number,
  toUserId: number,
  keyId: number,
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    
    // Supabase handles transactions automatically for operations
    // For complex transactions, use RPC
    const { data, error } = await supabase.rpc('transfer_api_key', {
      from_user_id: fromUserId,
      to_user_id: toUserId,
      key_id: keyId,
    });
    
    if (error) throw error;
    
    return true;
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

// Create this stored procedure in Supabase SQL:
/*
CREATE OR REPLACE FUNCTION transfer_api_key(
  from_user_id BIGINT,
  to_user_id BIGINT,
  key_id BIGINT
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE api_keys SET user_id = to_user_id WHERE id = key_id AND user_id = from_user_id;
  
  INSERT INTO audit_logs (action, key_id, from_user, to_user)
  VALUES ('transfer', key_id, from_user_id, to_user_id);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;
*/
```

---

## Migration Checklist

For each file being refactored:

- [ ] Change `getDb().prepare()` to service function calls
- [ ] Add `async`/`await` to function signatures
- [ ] Wrap in try-catch for error handling
- [ ] Update route handlers to `async (req, res) =>`
- [ ] Import from `supabase-service.js`
- [ ] Test with sample data
- [ ] Update tests to handle async operations
- [ ] Verify database changes persisted in Supabase
- [ ] Check error logs for issues

---

## Common Issues & Solutions

### Issue: "Cannot mix sync and async"

**Problem:**
```typescript
// ❌ Won't work
const result = db.recordRequest(...); // async but not awaited
```

**Solution:**
```typescript
// ✅ Correct
const result = await db.recordRequest(...);
```

### Issue: "Stale data in cache"

**Problem:**
```typescript
// ❌ Cache not invalidated
const cached = statsCache.get(key);
```

**Solution:**
```typescript
// ✅ Refresh on change
export async function recordRequest(...) {
  await db.recordRequest(...);
  statsCache = null; // Invalidate cache
  await refreshStatsCache(true); // Force refresh
}
```

### Issue: "Connection timeouts"

**Problem:** Long-running queries

**Solution:**
```typescript
// Add timeout handling
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Query timeout')), 5000)
);

try {
  await Promise.race([dbQuery, timeout]);
} catch (error) {
  // Handle timeout
}
```

---

This guide covers the most common refactoring patterns. Apply these consistently across all files for smooth migration.
