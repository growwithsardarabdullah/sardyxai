# Vercel Deployment Guide
## FreeLLMAPI on Vercel + Supabase

This guide covers deploying FreeLLMAPI as a serverless application on Vercel with Supabase PostgreSQL as the database.

---

## Prerequisites

- Supabase project created and initialized
- Git repository pushed to GitHub/GitLab/Bitbucket
- Vercel account (free tier sufficient)
- Node.js 20+

---

## Step 1: Prepare Application

### Update package.json

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc && vite build",
    "start": "node dist/server/src/index.js",
    "preview": "vite preview",
    "type-check": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### Create vercel.json

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "env": {
    "SUPABASE_URL": "@supabase_url",
    "SUPABASE_ANON_KEY": "@supabase_anon_key",
    "SUPABASE_SERVICE_ROLE_KEY": "@supabase_service_role_key",
    "ENCRYPTION_KEY": "@encryption_key",
    "NODE_ENV": "production",
    "PORT": "3001"
  },
  "functions": {
    "server/src/**": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

### Create .vercelignore

```
node_modules/
.next/
.git/
.gitignore
README.md
.env.example
.env.local
.env.*.local
server/data/**
*.db
*.db-wal
*.db-shm
```

---

## Step 2: Setup Vercel Project

### Connect Git Repository

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Link project
vercel link
```

### Configure Environment Variables

```bash
# Add Supabase URL
vercel env add SUPABASE_URL https://kwklmrroxodzsscgdwni.supabase.co

# Add Supabase Anon Key (can be public)
vercel env add SUPABASE_ANON_KEY eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2xtcnJveG9kenNzY2dkd25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk2MDUsImV4cCI6MjA5NTk3NTYwNX0._x8v9CR10vpvgrXZkfFIzxRIf3RNxzcG9qMieFIu7Es

# Add Supabase Service Role Key (PRIVATE)
vercel env add SUPABASE_SERVICE_ROLE_KEY eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2xtcnJveG9kenNzY2dkd25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM5OTYwNSwiZXhwIjoyMDk1OTc1NjA1fQ.3zWY4BGLdMFHMThKePFjLIGWmlSbJExWa5wCkwUhL64

# Add Encryption Key
vercel env add ENCRYPTION_KEY <your-64-char-hex-key>

# Apply to production only
vercel env pull --environment=production
```

---

## Step 3: Database Setup

### Run Migrations

In Supabase dashboard:

1. Go to SQL Editor
2. Create new query
3. Paste entire `server/src/db/supabase-schema.sql`
4. Click "Run"
5. Verify all tables created

### Verify Migrations

```sql
-- Check tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check RLS enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;

-- Check indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
```

---

## Step 4: Deploy

### Test Deployment Locally

```bash
# Build locally
npm run build

# Start server
npm start

# Test endpoints
curl http://localhost:3001/health
```

### Deploy to Production

```bash
# Deploy to Vercel
vercel deploy --prod

# Or automatic deployment on git push to main branch
```

### Monitor Deployment

```bash
# Watch logs in real-time
vercel logs --tail

# View recent deployments
vercel ls
```

---

## Step 5: Post-Deployment

### Run Migrations

If you have existing SQLite data:

```bash
# Set up migration script environment
export SUPABASE_URL=<your-url>
export SUPABASE_SERVICE_ROLE_KEY=<your-key>

# Run migration
node scripts/migrate-sqlite-to-supabase.ts
```

### Test API Endpoints

```bash
# Replace with your Vercel URL
VERCEL_URL="your-app.vercel.app"

# Test health check
curl https://$VERCEL_URL/api/health

# Test models endpoint
curl https://$VERCEL_URL/v1/models

# Test chat completion with valid key
curl -X POST https://$VERCEL_URL/v1/chat/completions \
  -H "Authorization: Bearer <unified-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-pro",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

### Setup Custom Domain

1. Go to Vercel Project Settings → Domains
2. Add your custom domain
3. Update DNS records (instructions provided by Vercel)
4. Enable HTTPS (automatic)

### Enable Monitoring

#### Vercel Analytics

```bash
# Already included with Vercel deployment
vercel analytics
```

#### Error Tracking (Optional)

Setup Sentry:

```bash
vercel env add SENTRY_DSN <your-sentry-dsn>
```

---

## Step 6: Optimization

### Function Memory & Timeout

Update `vercel.json`:

```json
{
  "functions": {
    "server/src/routes/**": {
      "memory": 1024,
      "maxDuration": 60
    },
    "server/src/routes/proxy.ts": {
      "memory": 2048,
      "maxDuration": 120
    }
  }
}
```

### Edge Functions (Optional)

For ultra-low latency on specific endpoints:

```typescript
// server/src/routes/models.edge.ts (runs on edge, not in Lambda)
export default async (req) => {
  // Runs globally, not in one region
  return new Response(JSON.stringify({ models: [...] }));
};
```

### Caching Strategy

```typescript
// In route handlers
res.set('Cache-Control', 'public, max-age=300'); // 5 min cache
```

---

## Troubleshooting

### "Build failed"

Check build logs:

```bash
vercel logs --follow
```

Common issues:
- Missing environment variables
- TypeScript errors
- Missing dependencies

**Solution:**
```bash
# Test build locally
npm run build

# Fix issues then redeploy
git push
```

### "Supabase connection timeout"

**Issue:** Lambda function can't reach Supabase

**Solution:**
- Verify `SUPABASE_URL` is correct
- Check Supabase project is active (not paused)
- Ensure IP whitelist includes Vercel's IPs (or allow all)

### "Rate limit exceeded"

**Issue:** Too many requests to Supabase

**Solution:**
1. Implement connection pooling
2. Add caching layer
3. Upgrade Supabase plan

### "Encryption key not working"

**Ensure:**
- `ENCRYPTION_KEY` is set in Vercel environment
- Same key used in production as during development
- Key is 64 hexadecimal characters

---

## Scaling Considerations

### Database Scaling

Supabase auto-scales, but monitor:

```sql
-- Check slow queries
SELECT query, mean_time FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Monitor connections
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;
```

### Function Scaling

Vercel automatically scales functions. Monitor:

- Deployment overview in dashboard
- Analytics for request patterns
- Error rates and 5xx responses

### Multi-Region

Deploy to multiple Vercel regions:

```bash
# Automatic via Vercel
# All regions get same code
# Vercel handles request routing
```

---

## Maintenance

### Automated Backups

Supabase provides automatic daily backups. Manual backup:

```bash
# Via Supabase dashboard
# Settings → Backups → Backup now
```

### Database Cleanup

Setup scheduled job (Vercel Cron Triggers - requires Pro):

```json
{
  "crons": {
    "*/6 * * * *": "api/cron/cleanup"
  }
}
```

### Monitoring

```bash
# View logs
vercel logs

# View analytics
vercel analytics

# View errors
vercel errors
```

---

## Security Checklist

- [ ] SUPABASE_SERVICE_ROLE_KEY is NOT in browser code
- [ ] Environment variables set in Vercel (not in code)
- [ ] HTTPS enabled on custom domain
- [ ] Supabase Row Level Security (RLS) enabled
- [ ] API key rate limiting working
- [ ] Encryption key secured
- [ ] Database backups configured
- [ ] Error logs don't expose sensitive data
- [ ] CORS headers properly configured
- [ ] API authentication working

---

## Support & Documentation

- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [FreeLLMAPI Docs](https://github.com/growwithsardarabdullah/sardyxai)
- [GitHub Issues](https://github.com/growwithsardarabdullah/sardyxai/issues)

---

**Deployment Complete! Your FreeLLMAPI is now live and production-ready.** 🎉
