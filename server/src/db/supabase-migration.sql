-- ============================================================================
-- FreeLLMAPI Supabase Migration: Add user_email columns + fix RLS
-- Run this AFTER the existing tables are created.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ── Add user_email column to existing tables ──────────────────────────────
-- These ALTERs are no-ops when the column already exists.

DO $$ BEGIN
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_email TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_email TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_email TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Add indexes for new columns (IF NOT EXISTS is safe for indexes) ──────

CREATE INDEX IF NOT EXISTS idx_api_keys_user_email ON api_keys(user_email);
CREATE INDEX IF NOT EXISTS idx_requests_user_email ON requests(user_email);
CREATE INDEX IF NOT EXISTS idx_settings_user_email ON settings(user_email);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Fix RLS Policies ─────────────────────────────────────────────────────
-- Drop old policies and recreate with service_role access (server uses service_role key).

-- Models
DROP POLICY IF EXISTS models_public_read ON models;
DROP POLICY IF EXISTS models_admin_write ON models;
DROP POLICY IF EXISTS models_admin_update ON models;
DROP POLICY IF EXISTS models_service_all ON models;
CREATE POLICY models_public_read ON models FOR SELECT USING (true);
CREATE POLICY models_service_all ON models FOR ALL USING (auth.role() = 'service_role');

-- API Keys
DROP POLICY IF EXISTS api_keys_admin_all ON api_keys;
DROP POLICY IF EXISTS api_keys_service_all ON api_keys;
CREATE POLICY api_keys_service_all ON api_keys FOR ALL USING (auth.role() = 'service_role');

-- Requests
DROP POLICY IF EXISTS requests_system ON requests;
DROP POLICY IF EXISTS requests_service_all ON requests;
CREATE POLICY requests_service_all ON requests FOR ALL USING (auth.role() = 'service_role');

-- Rate limit usage
DROP POLICY IF EXISTS rate_limit_usage_system ON rate_limit_usage;
DROP POLICY IF EXISTS rate_limit_usage_service_all ON rate_limit_usage;
CREATE POLICY rate_limit_usage_service_all ON rate_limit_usage FOR ALL USING (auth.role() = 'service_role');

-- Rate limit cooldowns
DROP POLICY IF EXISTS rate_limit_cooldowns_system ON rate_limit_cooldowns;
DROP POLICY IF EXISTS rate_limit_cooldowns_service_all ON rate_limit_cooldowns;
CREATE POLICY rate_limit_cooldowns_service_all ON rate_limit_cooldowns FOR ALL USING (auth.role() = 'service_role');

-- Fallback config
DROP POLICY IF EXISTS fallback_config_admin ON fallback_config;
DROP POLICY IF EXISTS fallback_config_service_all ON fallback_config;
CREATE POLICY fallback_config_service_all ON fallback_config FOR ALL USING (auth.role() = 'service_role');

-- Settings
DROP POLICY IF EXISTS settings_admin ON settings;
DROP POLICY IF EXISTS settings_service_all ON settings;
CREATE POLICY settings_service_all ON settings FOR ALL USING (auth.role() = 'service_role');

-- Users
DROP POLICY IF EXISTS users_own ON users;
DROP POLICY IF EXISTS users_service_all ON users;
CREATE POLICY users_service_all ON users FOR ALL USING (auth.role() = 'service_role');

-- Sessions
DROP POLICY IF EXISTS sessions_own ON sessions;
DROP POLICY IF EXISTS sessions_service_all ON sessions;
CREATE POLICY sessions_service_all ON sessions FOR ALL USING (auth.role() = 'service_role');

-- Provider health
DROP POLICY IF EXISTS provider_health_system ON provider_health;
DROP POLICY IF EXISTS provider_health_service_all ON provider_health;
CREATE POLICY provider_health_service_all ON provider_health FOR ALL USING (auth.role() = 'service_role');

-- Token usage
DROP POLICY IF EXISTS token_usage_system ON token_usage;
DROP POLICY IF EXISTS token_usage_service_all ON token_usage;
CREATE POLICY token_usage_service_all ON token_usage FOR ALL USING (auth.role() = 'service_role');

-- Analytics
DROP POLICY IF EXISTS analytics_admin ON analytics;
DROP POLICY IF EXISTS analytics_service_all ON analytics;
CREATE POLICY analytics_service_all ON analytics FOR ALL USING (auth.role() = 'service_role');

-- Error logs
DROP POLICY IF EXISTS error_logs_system ON error_logs;
DROP POLICY IF EXISTS error_logs_service_all ON error_logs;
CREATE POLICY error_logs_service_all ON error_logs FOR ALL USING (auth.role() = 'service_role');

-- Provider rotation state
DROP POLICY IF EXISTS provider_rotation_state_system ON provider_rotation_state;
DROP POLICY IF EXISTS provider_rotation_state_service_all ON provider_rotation_state;
CREATE POLICY provider_rotation_state_service_all ON provider_rotation_state FOR ALL USING (auth.role() = 'service_role');
