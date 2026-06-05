# Production Deployment Guide

## Overview

SardyxAI is a production-ready multi-user LLM routing platform with:
- **Frontend:** React + TypeScript + Vite (localhost:5173)
- **Backend:** Express.js + TypeScript (localhost:3001)
- **Database:** Supabase PostgreSQL (production) or SQLite (development)
- **Authentication:** Supabase Auth or development fallback
- **Deployment:** Vercel (frontend + backend API)

## Pre-Deployment Checklist

### 1. Environment Configuration

#### Development (.env.local)
```bash
NODE_ENV=development
PORT=3001
DASHBOARD_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
ENCRYPTION_KEY=  # auto-generated from DB
SESSION_SECRET=dev-session-secret-change-in-production
SUPABASE_URL=    # optional - uses SQLite fallback if empty
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

#### Production (.env.production)
- [ ] Set `NODE_ENV=production`
- [ ] Set `DASHBOARD_ORIGINS` to your production domain(s)
- [ ] Generate and set `ENCRYPTION_KEY` (32-char hex)
- [ ] Generate and set `SESSION_SECRET` (strong random value)
- [ ] Set Supabase credentials (required for production)
- [ ] Set `PROXY_RATE_LIMIT_RPM=60` or desired rate limit

### 2. Database Setup (Supabase)

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create new project
   - Note: Project URL, Anon Key, Service Role Key

2. **Initialize Database Schema**
   ```bash
   # Run the production schema
   psql $DATABASE_URL < server/src/db/supabase-production-schema.sql
   ```

3. **Enable Row Level Security (RLS)**
   - All tables have RLS policies configured in schema
   - Policies enforce: `auth.uid() = user_id`

### 3. Application Build

```bash
# Install dependencies
npm install
cd client && npm install
cd ../server && npm install

# Build frontend
cd client
npm run build

# Build backend (TypeScript)
cd ../server
npm run build  # if available, otherwise just npm run dev works as-is
```

### 4. Vercel Deployment

#### Frontend (client/)
1. Connect GitHub repository to Vercel
2. Set project root: `client`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Environment variables: None needed (frontend makes requests to API_URL)

#### Backend API (server/)
1. Create separate Vercel project for backend
2. Set project root: `server`
3. Build command: (leave empty, uses default)
4. Environment variables:
   - `NODE_ENV=production`
   - `SUPABASE_URL=...`
   - `SUPABASE_ANON_KEY=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...`
   - `ENCRYPTION_KEY=...` (generated)
   - `SESSION_SECRET=...` (strong random)
   - `DASHBOARD_ORIGINS=https://your-frontend.vercel.app`
   - `PORT=3001`

#### Frontend to Backend Connection
Update `client/.env.production`:
```
VITE_API_URL=https://your-backend.vercel.app
```

Or configure Vite proxy in production to backend domain.

### 5. Docker Deployment

```bash
# Build image
docker build -t sardyxai:latest .

# Run container
docker run -p 3001:3001 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=$SUPABASE_URL \
  -e SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
  -e SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  -e ENCRYPTION_KEY=$ENCRYPTION_KEY \
  -e SESSION_SECRET=$SESSION_SECRET \
  sardyxai:latest

# Or use docker-compose
docker-compose -f docker-compose.yml up -d
```

## Production Features

### Security
- ✅ HTTPS enforced (Vercel)
- ✅ HTTP-only session cookies
- ✅ AES-256-GCM encryption for sensitive data
- ✅ Row Level Security (RLS) on database
- ✅ Rate limiting on API endpoints
- ✅ CORS configured
- ✅ Helmet.js security headers

### Authentication
- ✅ Supabase Auth with OAuth
- ✅ JWT access tokens + refresh tokens
- ✅ Session persistence with cookies
- ✅ Automatic token refresh
- ✅ Password reset via email
- ✅ Multi-device login support

### Data Persistence
- ✅ User profiles
- ✅ API keys (encrypted)
- ✅ Unified routing key
- ✅ User settings
- ✅ Usage analytics
- ✅ Provider routing rules

### Scalability
- ✅ Vercel serverless (auto-scaling)
- ✅ Supabase PostgreSQL (managed)
- ✅ Connection pooling via Supabase
- ✅ Stateless API design
- ✅ Client-side caching (React Query)

## Monitoring & Maintenance

### Logs
- Frontend: Browser DevTools + Vercel logs
- Backend: Vercel logs + application logs
- Database: Supabase logs

### Metrics
- API response times (Vercel Analytics)
- Error rates (Sentry integration optional)
- Database performance (Supabase dashboard)
- User analytics (custom tracking)

### Backups
- [ ] Enable Supabase automated backups
- [ ] Configure backup schedule
- [ ] Test backup restoration

## Troubleshooting

### Login Issues
- Check Session cookie being set (Network tab)
- Verify CORS settings match frontend domain
- Check `auth-status` endpoint returns authenticated

### API Errors
- 401 Unauthorized: Token expired or invalid
- 403 Forbidden: User doesn't have permission
- 500 Server Error: Check backend logs on Vercel

### Database Errors
- Connection refused: Check SUPABASE_URL
- Permission denied: Check RLS policies
- Rate limited: Increase Supabase plan

## Rollback Plan

If production has issues:

1. **Frontend Rollback**
   ```bash
   # Revert to previous commit and redeploy
   git revert HEAD
   git push  # Auto-deploys on Vercel
   ```

2. **Backend Rollback**
   - Revert environment variables on Vercel
   - Trigger new deployment

3. **Database Rollback**
   - Restore from Supabase backup
   - Re-run schema if needed

## Performance Optimization

### Frontend
- [ ] Lazy load routes with React.lazy()
- [ ] Enable Code splitting
- [ ] Optimize bundle size
- [ ] Cache static assets
- [ ] Use CDN for assets

### Backend
- [ ] Database query optimization
- [ ] Connection pooling (enabled)
- [ ] Response compression
- [ ] API caching headers
- [ ] Rate limiting

### Database
- [ ] Index frequently queried columns
- [ ] Archive old usage logs
- [ ] Monitor query performance
- [ ] Optimize RLS policies

## Support

For issues or questions:
1. Check logs on Vercel
2. Review Supabase dashboard
3. Check GitHub issues
4. Contact support team

---

**Last Updated:** June 5, 2026  
**Version:** 1.0.0  
**Status:** Production Ready
