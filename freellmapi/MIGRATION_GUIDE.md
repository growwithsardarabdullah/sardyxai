# FreeLLMAPI Production Migration Guide
## SQLite to Supabase PostgreSQL + Vercel

---

## Overview

This guide converts FreeLLMAPI from a local SQLite-based deployment to a production-ready Supabase + Vercel deployment. All application state is persisted in PostgreSQL, enabling serverless deployment.

**Key Changes:**
- ✅ 100% existing functionality preserved
- ✅ All provider integrations maintained
- ✅ Usage tracking and analytics preserved
- ✅ Rate limiting moved to Supabase
- ✅ Authentication remains secure
- ✅ Async/await API with Supabase client library

---

## Step 1: Environment Setup

### 1.1 Install Dependencies

```bash
cd server
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
```

### 1.2 Configure Environment Variables

Create `.env.production`:

```env
# Supabase
SUPABASE_URL=https://kwklmrroxodzsscgdwni.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2xtcnJveG9kenNzY2dkd25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk2MDUsImV4cCI6MjA5NTk3NTYwNX0._x8v9CR10vpvgrXZkfFIzxRIf3RNxzcG9qMieFIu7Es
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2xtcnJveG9kenNzY2dkd25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM5OTYwNSwiZXhwIjoyMDk1OTc1NjA1fQ.3zWY4BGLdMFHMThKePFjLIGWmlSbJExWa5wCkwUhL64

# Encryption
ENCRYPTION_KEY=<your-64-char-hex-key>

# Application
NODE_ENV=production
PORT=3001
```

### 1.3 Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 2: Database Migration

### 2.1 Create Supabase Tables

1. Log in to [Supabase Dashboard](https://app.supabase.com)
2. Go to SQL Editor
3. Copy entire contents of `server/src/db/supabase-schema.sql`
4. Run as a new query
5. Verify all tables created

### 2.2 Enable Row Level Security (RLS)

All tables are pre-configured with RLS policies. Verify in Supabase:

```sql
-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;
```

### 2.3 Migrate Data from SQLite

If you have existing data:

```bash
# Export SQLite data
sqlite3 server/data/freeapi.db ".mode json" ".output export.json" \
  "SELECT * FROM models; SELECT * FROM api_keys; SELECT * FROM requests;"

# Create Node script to import to Supabase
node scripts/migrate-sqlite-to-supabase.ts
```

---

## Step 3: Code Refactoring

### 3.1 Update Database Import

**Before (SQLite):**
```typescript
import { getDb } from '../db/index.js';

const db = getDb();
const stmt = db.prepare('SELECT * FROM models WHERE platform = ?');
const model = stmt.get('google');
```

**After (Supabase):**
```typescript
import * as dbService from '../db/supabase-service.js';

const models = await dbService.getAllModels();
// or
const model = await dbService.getModelByPlatformAndId('google', 'gemini-2.5-pro');
```

### 3.2 Convert Route Handlers to Async

**Before:**
```typescript
export function getModelsRoute(req: Request, res: Response) {
  const db = getDb();
  const models = db.prepare('SELECT * FROM models').all();
  res.json(models);
}
```

**After:**
```typescript
export async function getModelsRoute(req: Request, res: Response) {
  try {
    const models = await getAllModels();
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

### 3.3 Update Key Service Files

#### Auth Service (`server/src/services/auth.ts`)

```typescript
import * as db from '../db/supabase-service.js';

export async function userCount(): Promise<number> {
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function createUser(email: string, password: string) {
  const user = await db.getUserByEmail(email);
  if (user) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }
  return db.createUser(email, hashPassword(password));
}

export async function verifyCredentials(email: string, password: string) {
  const user = await db.getUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return { userId: user.id, email: user.email };
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.createSession(userId, tokenHash, Date.now() + SESSION_TTL_MS);
  return token;
}

export async function validateSession(token: string | null) {
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
```

#### Rate Limit Service (`server/src/services/ratelimit.ts`)

```typescript
import * as db from '../db/supabase-service.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const windows = new Map<string, Window>();

export async function canMakeRequest(
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm?: number | null; rpd?: number | null },
) {
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
) {
  await db.recordRateLimitUsage(platform, modelId, keyId, 'request', 0);
}

export async function recordTokens(
  platform: string,
  modelId: string,
  keyId: number,
  tokens: number,
) {
  await db.recordRateLimitUsage(platform, modelId, keyId, 'tokens', tokens);
}
```

#### Router Service (`server/src/services/router.ts`)

```typescript
import * as db from '../db/supabase-service.js';

interface ModelStats {
  successes: number;
  failures: number;
  tokPerSec: number;
  avgTtfbMs: number | null;
  monthlyUsedTokens: number;
}

let statsCache: Map<string, ModelStats> | null = null;
let statsCacheTime = 0;

export async function refreshStatsCache(force = false): Promise<void> {
  if (!force && statsCache && Date.now() - statsCacheTime < 60000) return;

  const requests = await db.getRequestStats('', '', 7); // All platforms/models
  
  // Process requests into stats (same logic as before, just using DB data)
  const acc = new Map<string, any>();
  for (const req of requests) {
    const key = `${req.platform}:${req.model_id}`;
    // ... decay weight calculation ...
  }

  statsCache = new Map(acc);
  statsCacheTime = Date.now();
}

export function getStats(): Map<string, ModelStats> | null {
  return statsCache;
}
```

#### Proxy Routes (`server/src/routes/proxy.ts`)

```typescript
import * as db from '../db/supabase-service.js';

export async function handleProxyRequest(req: Request, res: Response) {
  try {
    const { platform, model, ...opts } = req.body;
    
    // Get model config
    const model = await db.getModelByPlatformAndId(platform, modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    
    // Get API key
    const keys = await db.getApiKeysByPlatform(platform);
    if (!keys.length) return res.status(503).json({ error: 'No API keys configured' });
    
    // Check rate limits
    const canRequest = await canMakeRequest(platform, modelId, keys[0].id, {
      rpm: model.rpm_limit,
      rpd: model.rpd_limit,
    });
    if (!canRequest) return res.status(429).json({ error: 'Rate limit exceeded' });
    
    // ... make request ...
    
    // Record request
    await db.recordRequest({
      platform,
      model_id: modelId,
      key_id: keys[0].id,
      status: 'success',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latency,
    });
    
    // Record token usage
    await db.recordRateLimitUsage(platform, modelId, keys[0].id, 'tokens', outputTokens);
    
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## Step 4: Vercel Deployment

### 4.1 Add Vercel Configuration

Create `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "env": {
    "SUPABASE_URL": "@supabase_url",
    "SUPABASE_ANON_KEY": "@supabase_anon_key",
    "SUPABASE_SERVICE_ROLE_KEY": "@supabase_service_role_key",
    "ENCRYPTION_KEY": "@encryption_key",
    "NODE_ENV": "production"
  }
}
```

### 4.2 Add Environment Secrets to Vercel

```bash
vercel env add SUPABASE_URL https://kwklmrroxodzsscgdwni.supabase.co
vercel env add SUPABASE_ANON_KEY <your-anon-key>
vercel env add SUPABASE_SERVICE_ROLE_KEY <your-service-role-key>
vercel env add ENCRYPTION_KEY <your-64-char-hex-key>
```

### 4.3 Deploy

```bash
vercel deploy --prod
```

---

## Step 5: Client Updates

### 5.1 Update API Client

The client-side `lib/api.ts` continues to work as-is:

```typescript
// No changes needed - localStorage session tokens remain the same
const TOKEN_KEY = 'freeapi_session_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
```

### 5.2 Update API Base URL (Optional)

For self-hosted: Update `VITE_API_URL` to your Vercel deployment URL.

---

## Step 6: Verification & Testing

### 6.1 Health Check Endpoint

```bash
curl https://your-deployment.vercel.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "version": "1.0.0"
}
```

### 6.2 Test API Endpoints

```bash
# Get models
curl https://your-deployment.vercel.app/v1/models

# Make a request (with valid API key in Authorization header)
curl -X POST https://your-deployment.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"google/gemini-2.5-pro","messages":[{"role":"user","content":"Hello"}]}'

# Check usage analytics
curl https://your-deployment.vercel.app/api/analytics \
  -H "Authorization: Bearer <your-session-token>"
```

### 6.3 Monitor Logs

```bash
vercel logs --tail
```

---

## Step 7: Production Checklist

- [ ] Database schema created in Supabase
- [ ] RLS policies enabled and tested
- [ ] Environment variables configured in Vercel
- [ ] All route handlers converted to async
- [ ] Auth service working with new DB layer
- [ ] Rate limiting working with Supabase
- [ ] Requests being recorded to analytics
- [ ] API keys encrypted and stored
- [ ] Health check endpoint responding
- [ ] Analytics dashboard loading
- [ ] Client authentication working
- [ ] Proxy endpoints functional for all providers

---

## Troubleshooting

### "Synchronous queries not supported"

**Issue:** Error "Synchronous queries not yet supported"

**Solution:** Ensure all route handlers are async:
```typescript
// ❌ Wrong
export function handler(req, res) { ... }

// ✅ Correct
export async function handler(req, res) { ... }
```

### "Connection pool exhausted"

**Issue:** Too many concurrent connections to Supabase

**Solution:** Implement connection pooling:
```typescript
// In supabase-service.ts
const POOL_SIZE = 5;
const connectionPool = Array(POOL_SIZE).fill(null).map(() => createClient(...));
```

### "Encryption key mismatch"

**Issue:** API keys can't be decrypted after migration

**Solution:** Ensure same `ENCRYPTION_KEY` used in production as in development

### "Rate limit not working"

**Issue:** Rate limits not being enforced

**Solution:** Verify `rate_limit_usage` table has recent records:
```sql
SELECT * FROM rate_limit_usage 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## Performance Tuning

### Database Query Optimization

```sql
-- Analyze slow queries
EXPLAIN ANALYZE
SELECT platform, model_id, COUNT(*) as requests
FROM requests
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY platform, model_id;

-- Add materialized view for analytics
CREATE MATERIALIZED VIEW request_stats AS
SELECT 
  platform, 
  model_id, 
  DATE(created_at) as date,
  COUNT(*) as total_requests,
  SUM(input_tokens) as input_tokens,
  SUM(output_tokens) as output_tokens,
  AVG(latency_ms) as avg_latency
FROM requests
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY platform, model_id, DATE(created_at);

CREATE INDEX idx_request_stats ON request_stats(platform, model_id, date);
```

### Caching Strategy

```typescript
import { LRUCache } from 'lru-cache';

const modelCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

export async function getAllModels() {
  const cached = modelCache.get('all_models');
  if (cached) return cached;

  const models = await db.getAllModels();
  modelCache.set('all_models', models);
  return models;
}
```

---

## Migration Complete! 

Your FreeLLMAPI is now production-ready on Vercel with Supabase PostgreSQL persistence. 

**Next Steps:**
1. Monitor analytics at your Vercel deployment
2. Set up automated backups in Supabase
3. Configure CDN caching for static assets
4. Set up monitoring and alerting
5. Plan for scaling across regions (Supabase multi-region)

