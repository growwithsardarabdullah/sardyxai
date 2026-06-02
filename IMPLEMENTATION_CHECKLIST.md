# Supabase Migration - Complete Implementation Checklist

## Project: FreeLLMAPI → Production-Ready on Vercel + Supabase

**Goal:** Migrate from local SQLite to Supabase PostgreSQL with 100% feature parity

**Timeline:** 1-2 weeks depending on team size

---

## Phase 1: Planning & Setup (Days 1-2)

### Database Layer
- [ ] **Create Supabase schema** (`server/src/db/supabase-schema.sql`)
  - [ ] 15+ tables created
  - [ ] All indexes added
  - [ ] RLS policies configured
  - [ ] Foreign keys validated
  
- [ ] **Create service layer** (`server/src/db/supabase-service.ts`)
  - [ ] All CRUD operations abstracted
  - [ ] Error handling consistent
  - [ ] Connection pooling ready

- [ ] **Create adapter layer** (`server/src/db/supabase-adapter.ts`)
  - [ ] SQLite-compatible interface
  - [ ] Backward compatibility helpers

### Environment & Configuration
- [ ] **Update `.env` files**
  - [ ] `.env.development` for local testing
  - [ ] `.env.production` for Vercel
  - [ ] `.env.example` updated with all vars
  
- [ ] **Create Vercel config** (`vercel.json`)
  - [ ] Build commands
  - [ ] Environment variables mapped
  - [ ] Memory/timeout settings
  
- [ ] **Create deployment docs**
  - [ ] `MIGRATION_GUIDE.md` ✅
  - [ ] `VERCEL_DEPLOYMENT.md` ✅
  - [ ] `REFACTORING_GUIDE.md` ✅

### Tools & Scripts
- [ ] **Migration script** (`scripts/migrate-sqlite-to-supabase.ts`)
  - [ ] SQLite export logic
  - [ ] Supabase import logic
  - [ ] Error handling & logging

---

## Phase 2: Code Refactoring (Days 3-7)

### Core Services

#### Authentication Service (`server/src/services/auth.ts`)
- [ ] Convert `userCount()` to async
- [ ] Convert `createUser()` to async
- [ ] Convert `verifyCredentials()` to async
- [ ] Convert `createSession()` to async
- [ ] Convert `validateSession()` to async
- [ ] Convert `deleteSession()` to async
- [ ] Add proper error handling
- [ ] Update all route handlers calling these

#### Rate Limiting Service (`server/src/services/ratelimit.ts`)
- [ ] Convert `canMakeRequest()` to async
- [ ] Convert `canUseTokens()` to async
- [ ] Convert `recordRequest()` to async
- [ ] Convert `recordTokens()` to async
- [ ] Update memory-based storage
- [ ] Add fallback handling if DB unavailable
- [ ] Update all proxy routes

#### Router Service (`server/src/services/router.ts`)
- [ ] Convert `refreshStatsCache()` to async
- [ ] Update aggregation logic for PostgreSQL
- [ ] Fix SQL dialect differences
- [ ] Add decay weight calculations
- [ ] Cache invalidation strategy
- [ ] Update scoring algorithm

#### Health Service (`server/src/services/health.ts`)
- [ ] Convert to async operations
- [ ] Add database health checks
- [ ] Check Supabase connectivity
- [ ] Monitor rate limit status

### Route Handlers

#### API Routes (`server/src/routes/api/`)
- [ ] **auth.ts** - Login, register, logout, session validation
  - [ ] Convert all handlers to async
  - [ ] Update error messages
  - [ ] Test authentication flow
  
- [ ] **keys.ts** - API key management
  - [ ] GET /api/keys
  - [ ] POST /api/keys
  - [ ] DELETE /api/keys/:id
  - [ ] PATCH /api/keys/:id
  
- [ ] **analytics.ts** - Usage analytics
  - [ ] GET /api/analytics/usage
  - [ ] GET /api/analytics/requests
  - [ ] GET /api/analytics/errors
  
- [ ] **health.ts** - Health checks
  - [ ] GET /api/health
  - [ ] GET /api/health/db
  - [ ] GET /api/health/providers

#### Proxy Routes (`server/src/routes/proxy.ts`)
- [ ] Convert to async
- [ ] Update rate limit checks
- [ ] Update request recording
- [ ] Update token tracking
- [ ] Update error handling
- [ ] Update analytics events

#### Settings Routes (`server/src/routes/settings.ts`)
- [ ] Convert to async
- [ ] Update setting operations
- [ ] Add validation

#### Models Routes (`server/src/routes/models.ts`)
- [ ] GET /v1/models
- [ ] GET /v1/models/:platform/:model_id
- [ ] POST /api/models (admin)
- [ ] PATCH /api/models/:id (admin)

### Middleware

- [ ] **Authentication middleware** (`server/src/middleware/requireAuth.ts`)
  - [ ] Update to async
  - [ ] Use new session validation
  
- [ ] **Rate limit middleware** (`server/src/middleware/rateLimit.ts`)
  - [ ] Update to use async functions
  - [ ] Handle cooldowns from DB
  
- [ ] **Error handler** (`server/src/middleware/errorHandler.ts`)
  - [ ] Log to error_logs table
  - [ ] Don't expose sensitive data

---

## Phase 3: Testing (Days 8-9)

### Unit Tests

- [ ] **Database layer tests**
  - [ ] Model queries
  - [ ] API key operations
  - [ ] Session management
  - [ ] Rate limit tracking
  
- [ ] **Service tests**
  - [ ] Auth service
  - [ ] Rate limiting
  - [ ] Router logic
  
- [ ] **Mock Supabase** for testing
  - [ ] Create mocks for all DB operations
  - [ ] Test error scenarios

### Integration Tests

- [ ] **Full flow tests**
  - [ ] User registration → login → API usage
  - [ ] API key creation → usage tracking → rate limiting
  - [ ] Provider selection → request proxying → analytics
  
- [ ] **Database migration tests**
  - [ ] Test migration script
  - [ ] Verify data integrity
  - [ ] Check for data loss

### Manual Testing

- [ ] **Local testing with Supabase**
  - [ ] Health check: `curl http://localhost:3001/api/health`
  - [ ] Get models: `curl http://localhost:3001/v1/models`
  - [ ] Register user: `curl -X POST http://localhost:3001/api/auth/register ...`
  - [ ] Create API key: `curl -X POST http://localhost:3001/api/keys ...`
  - [ ] Make request: `curl -X POST http://localhost:3001/v1/chat/completions ...`
  
- [ ] **Database verification**
  - [ ] Check models seeded
  - [ ] Verify requests logged
  - [ ] Confirm rate limits tracked
  - [ ] Validate analytics recorded

### Performance Tests

- [ ] Load test with k6 or Artillery
- [ ] Monitor Supabase query performance
- [ ] Check connection pooling
- [ ] Measure request latency

---

## Phase 4: Deployment Preparation (Day 10)

### Security Review

- [ ] **Encryption**
  - [ ] ENCRYPTION_KEY generated (64 hex chars)
  - [ ] Stored securely (environment variable only)
  - [ ] Used consistently across operations
  
- [ ] **API Security**
  - [ ] CORS properly configured
  - [ ] Authentication required on protected endpoints
  - [ ] Rate limiting working
  - [ ] Input validation on all endpoints
  
- [ ] **Database Security**
  - [ ] RLS policies enabled on all tables
  - [ ] Service role key never exposed
  - [ ] Backup strategy configured
  - [ ] Monitoring/alerts set up

### Performance Review

- [ ] Query performance optimized
- [ ] Indexes created for common queries
- [ ] Connection pooling configured
- [ ] Caching strategy implemented
- [ ] Static assets optimized

### Documentation Review

- [ ] All deployment docs complete
- [ ] API documentation updated
- [ ] Environment variables documented
- [ ] Troubleshooting guide written
- [ ] Runbook for common operations

---

## Phase 5: Production Deployment (Day 11)

### Pre-deployment

- [ ] **Final verification**
  - [ ] All tests passing locally
  - [ ] Build succeeds without errors
  - [ ] No console warnings/errors
  - [ ] .gitignore prevents sensitive files
  
- [ ] **Backup existing data**
  - [ ] Export SQLite database
  - [ ] Store in secure location
  
- [ ] **Vercel setup**
  - [ ] Project linked to GitHub
  - [ ] Environment variables configured
  - [ ] Build settings correct

### Deployment Steps

- [ ] **Initial deploy to staging**
  ```bash
  vercel deploy
  ```
  
- [ ] **Run migrations**
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-sqlite-to-supabase.ts
  ```
  
- [ ] **Test staging environment**
  - [ ] All endpoints working
  - [ ] Database queries functional
  - [ ] Analytics recording
  
- [ ] **Deploy to production**
  ```bash
  vercel deploy --prod
  ```
  
- [ ] **Verify production**
  - [ ] Health check passing
  - [ ] Models loading
  - [ ] API authentication working
  - [ ] Requests being recorded

### Monitoring

- [ ] Set up Vercel analytics
- [ ] Enable error tracking (Sentry if needed)
- [ ] Monitor database performance
- [ ] Watch logs for errors
- [ ] Check Supabase metrics

---

## Phase 6: Post-deployment (Day 12+)

### Monitoring & Maintenance

- [ ] **Daily checks**
  - [ ] Error rate normal
  - [ ] No hung connections
  - [ ] Database performance stable
  
- [ ] **Weekly reviews**
  - [ ] Usage patterns analysis
  - [ ] Cost tracking
  - [ ] Performance metrics
  
- [ ] **Automated tasks**
  - [ ] Database cleanup (old requests)
  - [ ] Session expiration
  - [ ] Error log retention
  - [ ] Analytics aggregation

### Optimization

- [ ] Database query optimization
- [ ] Caching improvements
- [ ] Connection pooling tuning
- [ ] Cold start optimization

### Documentation Updates

- [ ] Update README with new deployment
- [ ] Document any custom configurations
- [ ] Create runbooks for common tasks
- [ ] Update architecture diagrams

---

## Files Summary

### New Files Created ✅
- [x] `server/src/db/supabase-schema.sql` - Database schema
- [x] `server/src/db/supabase.ts` - Supabase client
- [x] `server/src/db/supabase-adapter.ts` - Adapter layer
- [x] `server/src/db/supabase-service.ts` - Service layer
- [x] `scripts/migrate-sqlite-to-supabase.ts` - Migration script
- [x] `MIGRATION_GUIDE.md` - Complete migration guide
- [x] `VERCEL_DEPLOYMENT.md` - Vercel deployment guide
- [x] `REFACTORING_GUIDE.md` - Code refactoring examples
- [x] `.env.production` - Production environment template
- [x] `vercel.json` - Vercel configuration

### Files to Modify (Significant Changes)
- [ ] `server/src/services/auth.ts` - Make async
- [ ] `server/src/services/ratelimit.ts` - Make async
- [ ] `server/src/services/router.ts` - Make async
- [ ] `server/src/services/health.ts` - Make async
- [ ] `server/src/routes/proxy.ts` - Make async
- [ ] `server/src/routes/auth.ts` - Make async
- [ ] `server/src/routes/keys.ts` - Make async
- [ ] `server/src/routes/analytics.ts` - Make async
- [ ] `server/src/routes/models.ts` - Make async
- [ ] `server/src/app.ts` - Initialize Supabase instead of SQLite
- [ ] `server/package.json` - Add Supabase dependency
- [ ] `client/src/lib/api.ts` - Update API base URL (if needed)

### Files to Keep As-Is
- `server/src/lib/crypto.ts` - Encryption logic stays the same
- `server/src/lib/password.ts` - Password hashing stays the same
- `server/src/middleware/errorHandler.ts` - Just add logging
- `server/src/providers/` - Provider implementations stay the same
- Client code (`client/src/`) - No major changes needed

---

## Environment Variables

### Development
```env
SUPABASE_URL=https://kwklmrroxodzsscgdwni.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ENCRYPTION_KEY=<64-hex-chars>
NODE_ENV=development
PORT=3001
```

### Production (Vercel)
Same as above, set via `vercel env add`

---

## Success Criteria

✅ **All tests passing**  
✅ **Database persists across deployments**  
✅ **API keys encrypted and stored**  
✅ **Usage tracking working**  
✅ **Rate limiting enforced**  
✅ **Analytics recording**  
✅ **All providers functional**  
✅ **Performance comparable to SQLite**  
✅ **Zero data loss during migration**  
✅ **Documentation complete**  

---

## Rollback Plan

If issues occur in production:

1. **Immediate**: Revert to previous commit
   ```bash
   git revert HEAD
   vercel deploy --prod
   ```

2. **Switch back to SQLite**:
   ```bash
   # Update .env to use local SQLite
   export DATABASE_URL=sqlite:./data/freeapi.db
   npm run build
   vercel deploy --prod
   ```

3. **Restore from backup**:
   - Supabase automatic daily backups available
   - Can restore entire database from Supabase dashboard

---

## Support & Resources

- **Supabase Docs**: https://supabase.com/docs
- **Vercel Docs**: https://vercel.com/docs
- **PostgreSQL**: https://www.postgresql.org/docs
- **GitHub Issues**: https://github.com/growwithsardarabdullah/sardyxai/issues

---

**This checklist ensures a smooth, production-ready migration with minimal risk.** 🚀
