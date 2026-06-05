# SardyxAI Production Audit & Implementation Guide

## EXECUTIVE SUMMARY

The current SardyxAI system has **critical data persistence issues** caused by:
1. Custom HMAC JWT auth instead of Supabase Auth
2. Hybrid local SQLite + async Supabase queue (unreliable)
3. Email-based user scoping instead of user IDs
4. Missing proper RLS policies
5. No state restoration on page refresh

**Result**: Users lose data on logout, refresh, or browser restart.

## ROOT CAUSES IDENTIFIED

### 1. Custom JWT Authentication (CRITICAL)
**Problem**: Uses custom HMAC-signed JWT tokens with stateless validation
```
Token format: base64url(payload).base64url(hmac_sha256(payload, SESSION_SECRET))
Payload: { userId, email, exp, v (session_version) }
```

**Issues**:
- No refresh token mechanism
- Session version bumping is async and unreliable
- Server can't validate tokens without SESSION_SECRET
- No built-in logout across all sessions
- Browser restart doesn't restore session

**Fix**: Replace with Supabase Auth
```typescript
// OLD:
const token = createJWT({ userId, email, exp });
res.cookie('freellmapi_session', token, SESSION_COOKIE_OPTIONS);

// NEW:
const session = await signIn(email, password);
const accessToken = session.accessToken;
const refreshToken = session.refreshToken;
res.cookie('freellmapi_session', accessToken, { httpOnly: true });
```

### 2. Hybrid SQLite + Async Queue (CRITICAL)
**Problem**: Local SQLite is source of truth, Supabase is backup via async queue

```
User writes data → SQLite (immediate)
                ↓
             Async queue → Supabase (5s timeout, max 1000 jobs)
```

**Issues**:
- If app crashes before queue drains, data loss
- Queue fills up, drops oldest jobs (data loss)
- 5s timeout too short for Supabase cold starts
- No guarantee writes reach Supabase during request
- Hydration from Supabase races with local writes
- Transient errors silently dropped

**Example data loss scenario**:
```
1. User adds API key
2. SQLite write succeeds
3. Async write queued to Supabase
4. User clicks refresh
5. App cold-starts on new Vercel instance
6. Hydration tries to sync from Supabase
7. If Supabase write didn't complete yet:
   → Key appears missing
   → Hydration doesn't find it
   → Data lost
```

**Fix**: Use Supabase as source of truth
```typescript
// OLD: Local SQLite first, async backup
const db = getDb();
db.prepare('INSERT INTO api_keys ...').run();
getPersistence().enqueueWrite(async () => {
  await sb.from('api_keys').insert(...);
});

// NEW: Supabase directly with proper error handling
const { data, error } = await sb
  .from('provider_keys')
  .insert({ user_id, provider, encrypted_key, ... })
  .select()
  .single();

if (error) throw new Error(error.message);
return data;
```

### 3. Email-Based User Scoping (CRITICAL)
**Problem**: Uses `user_email` TEXT field instead of `user_id` UUID foreign key

```sql
-- CURRENT (broken):
CREATE TABLE api_keys (
  user_email TEXT NOT NULL DEFAULT '',  -- ❌ No FK, text-based
  platform TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  ...
);

-- REQUIRED (fixed):
CREATE TABLE provider_keys (
  user_id UUID NOT NULL REFERENCES auth.users(id),  -- ✓ Proper FK
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  ...
);
```

**Issues**:
- Can't implement Supabase Auth (uses UUID user_id)
- Allows duplicate signups with same email
- Breaks RLS (can't check auth.uid() = user_id)
- Makes multi-device login impossible
- User data fragmented if email changes

**Fix**: Use user_id UUID and link to auth.users
```typescript
// OLD:
INSERT INTO api_keys (user_email, platform, encrypted_key)
VALUES (currentUser.email, 'openai', encryptedKey);

// NEW:
INSERT INTO provider_keys (user_id, provider, encrypted_key)
VALUES (auth.uid(), 'openai', encryptedKey);
```

### 4. Missing RLS Policies (SECURITY)
**Problem**: No proper Row Level Security on user-scoped tables

```sql
-- CURRENT (no RLS):
CREATE TABLE api_keys (
  user_email TEXT NOT NULL,
  ...
);
-- Anyone with service_role can see all users' keys

-- REQUIRED (with RLS):
CREATE TABLE provider_keys (
  user_id UUID NOT NULL REFERENCES auth.users(id),
  ...
);

ALTER TABLE provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_keys_user_access ON provider_keys
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Fix**: Implement user-scoped RLS policies

### 5. No Session Restoration on Refresh (UX)
**Problem**: Frontend doesn't properly restore state on page refresh

```typescript
// CURRENT:
useEffect(() => {
  apiFetch('/api/auth/status').then(status => {
    setAuthenticated(status.authenticated);
    // But state (keys, settings, usage) is NOT loaded!
  });
}, []);

// REQUIRED:
useEffect(() => {
  restoreSession(); // Restores auth + all user data
}, []);
```

**Fix**: Load all user data on auth state change
```typescript
async function restoreSession() {
  const response = await fetch('/api/auth/status');
  const { authenticated, user, userData } = await response.json();
  
  if (authenticated && user) {
    setUser(user);
    // Load ALL data:
    setProviderKeys(userData.providerKeys);
    setUnifiedKey(userData.unifiedKey);
    setSettings(userData.settings);
    setUsage(userData.usage);
  }
}
```

## IMPLEMENTATION ROADMAP

### Phase 1: Create New Production Schema ✅ DONE
- Created `supabase-production-schema.sql` with:
  - `profiles` (user_id UUID, email)
  - `provider_keys` (user_id UUID, provider, encrypted_key)
  - `unified_keys` (user_id UUID, key)
  - `usage_logs` (user_id UUID, provider, tokens)
  - `user_settings` (user_id UUID, key, value)
- Added RLS policies for all user-scoped tables
- Added utility functions for key generation and usage summaries

### Phase 2: Implement Supabase Auth Service ✅ DONE
- Created `auth-supabase.ts` with:
  - `signUp(email, password)` - Create new account with Supabase Auth
  - `signIn(email, password)` - Login with session token
  - `logout(sessionId)` - Invalidate session
  - `verifyAccessToken(token)` - Validate token with Supabase
  - `loadUserData(userId)` - Load all user data from new tables
  - Proper refresh token handling

### Phase 3: Create Production Auth Routes ✅ DONE
- Created `auth-supabase.ts` routes:
  - `POST /api/auth/signup` - Create account
  - `POST /api/auth/login` - Login with httpOnly cookie
  - `POST /api/auth/logout` - Clear session
  - `GET /api/auth/status` - Check auth and load user data
  - `GET /api/auth/me` - Get current user info
  - `POST /api/auth/forgot-password` - Request reset

### Phase 4: Create User Data Service ✅ DONE
- Created `supabase-service.ts` additions:
  - `addProviderKey()` - Add encrypted API key
  - `getProviderKeysByUser()` - List user's keys
  - `ensureUserUnifiedKey()` - Get or create unified key
  - `regenerateUserUnifiedKey()` - Generate new key
  - `getUserSetting()` / `setUserSetting()` - Manage settings
  - `logUserUsage()` - Track usage
  - `getUserUsageSummary()` - Get usage stats

### Phase 5: Create User Data Routes ✅ DONE
- Created `user-data.ts` routes:
  - `POST /api/user/keys` - Add provider key
  - `GET /api/user/keys` - List provider keys
  - `GET /api/user/keys/:keyId` - Get decrypted key
  - `DELETE /api/user/keys/:keyId` - Delete key
  - `GET /api/user/unified-key` - Get unified key
  - `POST /api/user/unified-key/regenerate` - Regenerate
  - `GET/PUT /api/user/settings/:key` - Manage settings
  - `GET /api/user/usage/summary` - Usage stats
  - `GET /api/user/usage/by-provider` - Per-provider breakdown

### Phase 6: Create Production Auth Hook ✅ DONE
- Created `use-auth.ts` with:
  - `AuthProvider` - Wraps app with auth context
  - `useAuth()` - Access auth state and methods
  - Session restoration on mount
  - Automatic data refresh on auth changes
  - Custom hooks: `useProviderKeys()`, `useUnifiedKey()`, `useUsageSummary()`

### Phase 7: Update App Integration
**TODO**: Update app to use new auth system

## DEPLOYMENT CHECKLIST

### Step 1: Create Supabase Tables
```sql
-- Run in Supabase SQL Editor:
\copy (SELECT * FROM ' server/src/db/supabase-production-schema.sql) TO '/dev/stdout'
```

Or manually create each table in the schema file.

### Step 2: Environment Variables
```env
# Already set:
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# NO LONGER NEEDED:
SESSION_SECRET  (removed - use Supabase Auth)
ENCRYPTION_KEY  (kept for key encryption only)
```

### Step 3: Update App.tsx
```typescript
import { AuthProvider } from '@/hooks/use-auth';

function App() {
  return (
    <AuthProvider>
      <Router>
        {/* rest of app */}
      </Router>
    </AuthProvider>
  );
}
```

### Step 4: Update Backend app.ts
```typescript
import { authRouter } from './routes/auth-supabase.js';
import { userDataRouter } from './routes/user-data.js';

app.use('/api/auth', authRouter);
app.use('/api/user', userDataRouter);
```

### Step 5: Remove Old Auth System
- Delete `routes/auth.ts` (custom JWT)
- Delete `services/auth.ts` (HMAC logic)
- Remove `middleware/requireAuth.ts` (old auth)
- Remove async queue: `db/persistence.ts`
- Remove local SQLite user tables

### Step 6: Data Migration
```typescript
// For each existing user:
1. Create Supabase Auth account: await signUp(email, password)
2. Get UUID from auth.users
3. Copy provider keys: INSERT INTO provider_keys SELECT user_id FROM auth.users WHERE email = old_email
4. Copy settings: INSERT INTO user_settings SELECT user_id FROM auth.users WHERE email = old_email
```

### Step 7: Test End-to-End
```bash
# 1. Signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  -c cookies.txt

# 3. Add provider key
curl -X POST http://localhost:3000/api/user/keys \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"provider":"openai","key":"sk-...","label":"My key"}'

# 4. Refresh page (session should restore)
curl http://localhost:3000/api/auth/status -b cookies.txt

# 5. Logout
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt

# 6. Login again (keys should still exist)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  -c cookies2.txt

# 7. Verify keys persist
curl http://localhost:3000/api/user/keys -b cookies2.txt
```

## SUCCESS CRITERIA

A user can:

✅ Sign Up once
✅ Login forever (session persists across refresh)
✅ Save provider keys (persist forever)
✅ Generate unified key (persist forever)
✅ Refresh page (session + data restored)
✅ Close browser (session persists)
✅ Reopen browser (auto-login via session)
✅ Login again (all data remains)
✅ Logout (session cleared)
✅ Re-login (all data still exists)

**Nothing disappears unless user explicitly deletes it.**

## FILE CHANGES SUMMARY

### New Files Created
- `server/src/db/supabase-production-schema.sql` - New schema with RLS
- `server/src/db/supabase-client.ts` - Supabase client setup
- `server/src/services/auth-supabase.ts` - Supabase Auth service
- `server/src/routes/auth-supabase.ts` - Auth API routes
- `server/src/routes/user-data.ts` - User data API routes
- `client/src/hooks/use-auth.ts` - React auth hook

### Files Modified
- `server/src/db/supabase-service.ts` - Added user-scoped functions
- `client/src/App.tsx` - TODO: Wrap with AuthProvider
- `client/src/lib/api.ts` - Already compatible with httpOnly cookies

### Files to Remove (Phase 8)
- `server/src/services/auth.ts` - Old HMAC JWT
- `server/src/routes/auth.ts` - Old auth routes
- `server/src/middleware/requireAuth.ts` - Old auth middleware
- `server/src/db/persistence.ts` - Async queue (no longer needed)

## MIGRATION GUIDE

### For Existing Users
```sql
-- 1. Create Auth Account
SELECT auth.create_user(email => 'user@example.com', password => 'temp');

-- 2. Get UUID from auth.users
SELECT id FROM auth.users WHERE email = 'user@example.com';

-- 3. Migrate Provider Keys
INSERT INTO provider_keys (user_id, provider, label, encrypted_key, iv, auth_tag, base_url, enabled)
SELECT 
  auth.uid(),
  platform,
  label,
  encrypted_key,
  iv,
  auth_tag,
  base_url,
  enabled
FROM api_keys
WHERE user_email = 'user@example.com';

-- 4. Migrate Settings
INSERT INTO user_settings (user_id, key, value)
SELECT 
  auth.uid(),
  REGEXP_REPLACE(key, 'unified_api_key:.*', 'unified_api_key'),
  value
FROM settings
WHERE user_email = 'user@example.com';

-- 5. Migrate Usage
INSERT INTO usage_logs (user_id, provider, model, request_count, input_tokens, output_tokens, status, created_at)
SELECT 
  auth.uid(),
  platform,
  model_id,
  1,
  input_tokens,
  output_tokens,
  status,
  created_at
FROM requests
WHERE user_email = 'user@example.com';
```

## TESTING CHECKLIST

- [ ] Create new account (signup)
- [ ] Verify account created in auth.users
- [ ] Verify profile created in profiles table
- [ ] Verify unified key created in unified_keys table
- [ ] Add provider key
- [ ] Verify key encrypted and stored in provider_keys
- [ ] List provider keys
- [ ] Verify masked key returned (not full key)
- [ ] Get unified key
- [ ] Get usage summary
- [ ] Refresh page
- [ ] Verify session persists
- [ ] Verify all data reloaded
- [ ] Logout
- [ ] Verify session cleared
- [ ] Verify keys still in database
- [ ] Login again
- [ ] Verify keys still accessible
- [ ] Regenerate unified key
- [ ] Verify old key disabled, new key works
- [ ] Test RLS: Ensure users can only access own data
- [ ] Test password reset flow

## PRODUCTION CHECKLIST

- [ ] Run Supabase production-schema.sql
- [ ] Set SUPABASE_* environment variables
- [ ] Migrate existing user data
- [ ] Update app.tsx with AuthProvider
- [ ] Update backend app.ts routes
- [ ] Remove old auth system files
- [ ] Deploy frontend
- [ ] Deploy backend
- [ ] Test full auth flow in production
- [ ] Monitor error logs
- [ ] Verify RLS policies working
- [ ] Enable email verification for signups
- [ ] Set up password reset email template

## TROUBLESHOOTING

### Issue: Keys disappear after logout/login

**Root Cause**: Async queue didn't complete Supabase write

**Fix**: Use Supabase directly (no queue)
```typescript
// OLD (unreliable):
db.insert('api_keys', {...});
persistence.enqueueWrite(() => sb.insert(...)); // May not complete

// NEW (reliable):
const { data, error } = await sb.insert({...}).select().single();
if (error) throw error; // Fail fast
```

### Issue: Session lost on refresh

**Root Cause**: Frontend doesn't restore state

**Fix**: Use AuthProvider hook
```typescript
// Wrap app with:
<AuthProvider>
  <App />
</AuthProvider>

// Use in components:
const { user, userData, isLoading } = useAuth();
// Data automatically restored on mount
```

### Issue: RLS blocking access

**Root Cause**: Service role bypasses RLS, but user role needs policy

**Fix**: Ensure RLS policies include auth.role() = 'service_role'
```sql
CREATE POLICY policy_name ON table_name
  FOR SELECT
  USING (auth.uid() = user_id OR auth.role() = 'service_role');
```

### Issue: Unified key disappears

**Root Cause**: Key stored in settings table without user_id

**Fix**: Use unified_keys table with user_id FK
```sql
-- NEW table structure:
CREATE TABLE unified_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true
);

-- Regenerate for all users:
SELECT regenerate_unified_key(u.id) FROM profiles u;
```

## MONITORING & OBSERVABILITY

### Key Metrics to Track
- Auth success/failure rates
- Session duration
- Data load times on refresh
- RLS policy violations
- Async queue latency (if keeping queue)
- Encryption/decryption errors

### Logging
```typescript
console.log('[auth] Signup attempt:', email);
console.error('[auth] Signup failed:', error.message);

console.log('[db] Loaded user data:', userId);
console.error('[db] Data load failed:', error.message);
```

## NEXT STEPS

1. ✅ Review audit findings
2. ✅ Understand root causes
3. ✅ Review new implementation files
4. TODO: Run Supabase schema migration
5. TODO: Update app configuration
6. TODO: Perform end-to-end testing
7. TODO: Deploy to production
8. TODO: Monitor for issues
9. TODO: Migrate existing user data
10. TODO: Remove old auth system

---

**Questions?** Review the root causes section or check the implementation files for detailed examples.
