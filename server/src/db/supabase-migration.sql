-- ============================================================================
-- FreeLLMAPI Supabase Migration: Add user_email columns + fix RLS
-- Run this AFTER the existing tables are created.
-- Safe to run multiple times — checks before creating any policy.
-- ============================================================================

-- ── Add user_email column to existing tables ──────────────────────────────

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

-- ── Add indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_api_keys_user_email ON api_keys(user_email);
CREATE INDEX IF NOT EXISTS idx_requests_user_email ON requests(user_email);
CREATE INDEX IF NOT EXISTS idx_settings_user_email ON settings(user_email);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Fix RLS Policies ──────────────────────────────────────────────────────
-- Drop ALL existing policies on each table first, then recreate.
-- Uses a helper function to safely drop all policies on a given table.

CREATE OR REPLACE FUNCTION _drop_all_policies(tbl text) RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = tbl AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, tbl);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Models
SELECT _drop_all_policies('models');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'models' AND policyname = 'models_public_read') THEN
    CREATE POLICY models_public_read ON models FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'models' AND policyname = 'models_service_all') THEN
    CREATE POLICY models_service_all ON models FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- API Keys
SELECT _drop_all_policies('api_keys');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'api_keys_service_all') THEN
    CREATE POLICY api_keys_service_all ON api_keys FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Requests
SELECT _drop_all_policies('requests');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'requests' AND policyname = 'requests_service_all') THEN
    CREATE POLICY requests_service_all ON requests FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Rate limit usage
SELECT _drop_all_policies('rate_limit_usage');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limit_usage' AND policyname = 'rate_limit_usage_service_all') THEN
    CREATE POLICY rate_limit_usage_service_all ON rate_limit_usage FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Rate limit cooldowns
SELECT _drop_all_policies('rate_limit_cooldowns');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limit_cooldowns' AND policyname = 'rate_limit_cooldowns_service_all') THEN
    CREATE POLICY rate_limit_cooldowns_service_all ON rate_limit_cooldowns FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Fallback config
SELECT _drop_all_policies('fallback_config');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fallback_config' AND policyname = 'fallback_config_service_all') THEN
    CREATE POLICY fallback_config_service_all ON fallback_config FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Settings
SELECT _drop_all_policies('settings');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'settings_service_all') THEN
    CREATE POLICY settings_service_all ON settings FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Users
SELECT _drop_all_policies('users');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_service_all') THEN
    CREATE POLICY users_service_all ON users FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Sessions
SELECT _drop_all_policies('sessions');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'sessions_service_all') THEN
    CREATE POLICY sessions_service_all ON sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Provider health
SELECT _drop_all_policies('provider_health');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'provider_health' AND policyname = 'provider_health_service_all') THEN
    CREATE POLICY provider_health_service_all ON provider_health FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Token usage
SELECT _drop_all_policies('token_usage');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'token_usage' AND policyname = 'token_usage_service_all') THEN
    CREATE POLICY token_usage_service_all ON token_usage FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Analytics
SELECT _drop_all_policies('analytics');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'analytics' AND policyname = 'analytics_service_all') THEN
    CREATE POLICY analytics_service_all ON analytics FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Error logs
SELECT _drop_all_policies('error_logs');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'error_logs' AND policyname = 'error_logs_service_all') THEN
    CREATE POLICY error_logs_service_all ON error_logs FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Provider rotation state
SELECT _drop_all_policies('provider_rotation_state');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'provider_rotation_state' AND policyname = 'provider_rotation_state_service_all') THEN
    CREATE POLICY provider_rotation_state_service_all ON provider_rotation_state FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Clean up helper
DROP FUNCTION IF EXISTS _drop_all_policies(text);
