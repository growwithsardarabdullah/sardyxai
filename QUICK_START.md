# SardyxAI - Production Deployment Guide

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git
- Supabase account (for production)

### Local Development

1. **Install dependencies:**
```bash
npm install
cd client && npm install && cd ../server && npm install && cd ..
```

2. **Create development environment:**
```bash
# Copy template
cp .env.local.example .env.local
```

3. **Start backend (Terminal 1):**
```bash
cd server
npm run dev
# Backend runs on http://localhost:3001
```

4. **Start frontend (Terminal 2):**
```bash
cd client
npm run dev
# Frontend runs on http://localhost:5173
```

5. **Test the application:**
   - Open http://localhost:5173
   - Click "Sign up"
   - Create account with email/password
   - Login and explore the app

### Production Deployment

#### Step 1: Prepare Supabase

```bash
# 1. Create project at https://supabase.com
# 2. Get your credentials:
#    - Project URL
#    - Anon Key
#    - Service Role Key

# 3. Run production schema:
psql $DATABASE_URL < server/src/db/supabase-production-schema.sql

# 4. Enable Row Level Security (RLS)
# Already configured in schema
```

#### Step 2: Configure Environment

```bash
# Edit .env.production with your values:
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - ENCRYPTION_KEY (generate: openssl rand -hex 16)
# - SESSION_SECRET (generate: openssl rand -base64 32)
# - DASHBOARD_ORIGINS (your frontend domain)
```

#### Step 3: Deploy to Vercel

**Frontend:**
```bash
# 1. Push to GitHub
git push origin main

# 2. Go to vercel.com → New Project
# 3. Select GitHub repo
# 4. Framework: Vite
# 5. Root Directory: client
# 6. Build: npm run build
# 7. Deploy
```

**Backend:**
```bash
# 1. Create new Vercel project
# 2. Select same GitHub repo
# 3. Framework: Other
# 4. Root Directory: server
# 5. Add environment variables (from .env.production)
# 6. Deploy
```

#### Step 4: Connect Frontend to Backend

In `client/src/lib/api.ts`, ensure API calls point to backend:
```typescript
const API_URL = process.env.VITE_API_URL || 'http://localhost:3001';
```

Or update Vite proxy in `client/vite.config.ts`:
```typescript
server: {
  proxy: {
    '/api': {
      target: 'https://your-backend.vercel.app',
      changeOrigin: true,
    }
  }
}
```

### Docker Deployment

```bash
# Build
docker build -t sardyxai:latest .

# Run with environment
docker run -p 3001:3001 \
  -e SUPABASE_URL=$SUPABASE_URL \
  -e SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
  -e SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  -e ENCRYPTION_KEY=$ENCRYPTION_KEY \
  -e SESSION_SECRET=$SESSION_SECRET \
  sardyxai:latest

# Or use docker-compose
docker-compose up -d
```

## Architecture

### Frontend (React + Vite)
- **Port:** 5173 (dev), 3000+ (Vercel)
- **Components:** Authentication, Keys, Analytics, Settings
- **State:** React Query for API caching
- **Auth:** Context-based with automatic session restore

### Backend (Express.js)
- **Port:** 3001 (dev/Docker), Vercel serverless (prod)
- **Routes:** 
  - `POST /api/auth/signup` - Create account
  - `POST /api/auth/login` - Authenticate
  - `GET /api/auth/status` - Check session
  - `POST /api/auth/logout` - End session
  - `GET /api/user/keys` - List API keys
  - `POST /api/user/keys` - Add provider key

### Database (Supabase PostgreSQL)
- **Tables:** profiles, provider_keys, unified_keys, user_settings, usage_logs
- **Security:** Row Level Security (RLS) on all tables
- **Encryption:** AES-256-GCM for sensitive data

## Features

### Authentication
- ✅ Email/password signup
- ✅ Secure login with tokens
- ✅ Automatic session restoration
- ✅ Password reset via email
- ✅ Multi-device login
- ✅ Logout functionality

### User Data Management
- ✅ Profile management
- ✅ API key storage (encrypted)
- ✅ Unified routing key
- ✅ User settings persistence
- ✅ Usage analytics tracking

### Security
- ✅ HTTPS (automatic on Vercel)
- ✅ HTTP-only cookies
- ✅ AES-256-GCM encryption
- ✅ Row Level Security (RLS)
- ✅ Rate limiting
- ✅ CORS protection
- ✅ Input validation

## Testing

### Manual Testing

1. **Signup:**
   ```bash
   curl -X POST http://localhost:3001/api/auth/signup \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"TestPass123"}'
   ```

2. **Login:**
   ```bash
   curl -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"TestPass123"}'
   ```

3. **Check Status:**
   ```bash
   curl http://localhost:3001/api/auth/status
   ```

### Test Accounts (Development)
- Email: `test@example.com`
- Password: `TestPassword123`

(Note: In development mode, any password works for existing users after server restart due to SQLite fallback limitation)

## Troubleshooting

### Login Issues
- **"User not found"**: Create new account or check Supabase is configured
- **"Invalid password"**: Ensure correct credentials
- **"Unauthorized"**: Session expired, login again

### API Errors
- **401**: Session invalid or expired
- **403**: User doesn't have permission
- **500**: Check backend logs on Vercel

### Deployment Issues
- **Frontend can't reach API**: Check CORS and API URL
- **Database errors**: Verify Supabase credentials
- **Rate limit**: Check PROXY_RATE_LIMIT_RPM setting

## Support

- **Documentation:** See PRODUCTION_DEPLOYMENT.md
- **Checklist:** See PRODUCTION_CHECKLIST.md
- **GitHub Issues:** Report bugs on GitHub
- **Logs:** Check Vercel dashboard for errors

## Next Steps

1. [ ] Set up Supabase project
2. [ ] Configure environment variables
3. [ ] Deploy to Vercel (or Docker)
4. [ ] Test production deployment
5. [ ] Configure custom domain
6. [ ] Set up monitoring/alerts
7. [ ] Configure backups
8. [ ] Scale as needed

---

**Version:** 1.0.0  
**Status:** Production Ready  
**Last Updated:** June 5, 2026
