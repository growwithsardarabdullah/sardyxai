-- ============================================================================
-- SardyxAI Production Schema - Supabase Auth Integration
-- ============================================================================
-- This migration creates a production-ready schema with:
-- 1. Supabase Auth integration (using auth.users)
-- 2. User ID (UUID) based multi-tenant design
-- 3. Proper RLS policies for all user-scoped tables
-- 4. Persistent storage for all user data
--
-- Tables created:
-- - profiles: User profile information linked to auth.users
-- - provider_keys: Encrypted API keys per user
-- - unified_keys: Generated API key for unified access
-- - usage_logs: Request and token usage tracking
-- - user_settings: User preferences and configuration
-- ============================================================================

-- ============================================================================
-- 1. PROFILES TABLE - User profile data
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own profile
DROP POLICY IF EXISTS profiles_user_access ON profiles;
CREATE POLICY profiles_user_access ON profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything
DROP POLICY IF EXISTS profiles_service_access ON profiles;
CREATE POLICY profiles_service_access ON profiles
  FOR ALL
  USING (auth.role() = 'service_role');

-- Index for auth lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ============================================================================
-- 2. PROVIDER_KEYS TABLE - Encrypted API keys per user
-- ============================================================================
CREATE TABLE IF NOT EXISTS provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT DEFAULT '',
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  base_url TEXT,
  enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'unknown', -- unknown, valid, invalid, rate_limited
  last_tested_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, provider, label)
);

-- Enable RLS
ALTER TABLE provider_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own keys
DROP POLICY IF EXISTS provider_keys_user_access ON provider_keys;
CREATE POLICY provider_keys_user_access ON provider_keys
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything
DROP POLICY IF EXISTS provider_keys_service_access ON provider_keys;
CREATE POLICY provider_keys_service_access ON provider_keys
  FOR ALL
  USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_provider_keys_user_id ON provider_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider);
CREATE INDEX IF NOT EXISTS idx_provider_keys_enabled ON provider_keys(enabled);

-- ============================================================================
-- 3. UNIFIED_KEYS TABLE - One unified API key per user for /v1 proxy access
-- ============================================================================
CREATE TABLE IF NOT EXISTS unified_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE, -- The actual unified API key (hashed in production)
  name TEXT DEFAULT 'Default', -- Allow multiple keys in future
  enabled BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE unified_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own unified key
DROP POLICY IF EXISTS unified_keys_user_access ON unified_keys;
CREATE POLICY unified_keys_user_access ON unified_keys
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything
DROP POLICY IF EXISTS unified_keys_service_access ON unified_keys;
CREATE POLICY unified_keys_service_access ON unified_keys
  FOR ALL
  USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_unified_keys_user_id ON unified_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_unified_keys_key ON unified_keys(key);

-- ============================================================================
-- 4. USAGE_LOGS TABLE - Request and token usage tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER,
  status TEXT DEFAULT 'success', -- success, error, rate_limited
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own usage logs
DROP POLICY IF EXISTS usage_logs_user_access ON usage_logs;
CREATE POLICY usage_logs_user_access ON usage_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can't insert/update directly, only service role can
DROP POLICY IF EXISTS usage_logs_service_write ON usage_logs;
CREATE POLICY usage_logs_service_write ON usage_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);

-- ============================================================================
-- 5. USER_SETTINGS TABLE - User preferences and configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own settings
DROP POLICY IF EXISTS user_settings_user_access ON user_settings;
CREATE POLICY user_settings_user_access ON user_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything
DROP POLICY IF EXISTS user_settings_service_access ON user_settings;
CREATE POLICY user_settings_service_access ON user_settings
  FOR ALL
  USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_key ON user_settings(key);

-- ============================================================================
-- 6. SHARED TABLES (No RLS - system-level data)
-- ============================================================================

-- Models catalog (unchanged but ensure RLS enabled)
CREATE TABLE IF NOT EXISTS models (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  intelligence_rank INTEGER NOT NULL,
  speed_rank INTEGER NOT NULL,
  size_label TEXT NOT NULL DEFAULT '',
  rpm_limit INTEGER,
  rpd_limit INTEGER,
  tpm_limit INTEGER,
  tpd_limit INTEGER,
  monthly_token_budget TEXT NOT NULL DEFAULT '',
  context_window INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, model_id)
);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS models_public_read ON models;
CREATE POLICY models_public_read ON models
  FOR SELECT
  USING (true);
DROP POLICY IF EXISTS models_service_write ON models;
CREATE POLICY models_service_write ON models
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_models_platform ON models(platform);
CREATE INDEX IF NOT EXISTS idx_models_enabled ON models(enabled);

-- Provider health checks
CREATE TABLE IF NOT EXISTS provider_health (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  last_check_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider)
);

ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_health_service_all ON provider_health;
CREATE POLICY provider_health_service_all ON provider_health
  FOR ALL
  USING (auth.role() = 'service_role');

-- Fallback configuration
CREATE TABLE IF NOT EXISTS fallback_config (
  id BIGSERIAL PRIMARY KEY,
  model_db_id BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(model_db_id)
);

ALTER TABLE fallback_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fallback_config_service_all ON fallback_config;
CREATE POLICY fallback_config_service_all ON fallback_config
  FOR ALL
  USING (auth.role() = 'service_role');

-- Analytics events
CREATE TABLE IF NOT EXISTS analytics (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_service_all ON analytics;
CREATE POLICY analytics_service_all ON analytics
  FOR ALL
  USING (auth.role() = 'service_role');

-- Error logs
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  error_type TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  message TEXT,
  stack_trace TEXT,
  context JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS error_logs_service_all ON error_logs;
CREATE POLICY error_logs_service_all ON error_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- Rate limit tables (transient, no persistence to Supabase)
CREATE TABLE IF NOT EXISTS rate_limit_usage (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'tokens')),
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rate_limit_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_usage_service_all ON rate_limit_usage;
CREATE POLICY rate_limit_usage_service_all ON rate_limit_usage
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id UUID NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, model_id, key_id)
);

ALTER TABLE rate_limit_cooldowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_cooldowns_service_all ON rate_limit_cooldowns;
CREATE POLICY rate_limit_cooldowns_service_all ON rate_limit_cooldowns
  FOR ALL
  USING (auth.role() = 'service_role');

-- Provider rotation state
CREATE TABLE IF NOT EXISTS provider_rotation_state (
  id BIGSERIAL PRIMARY KEY,
  routing_strategy TEXT NOT NULL DEFAULT 'priority',
  model_id TEXT NOT NULL,
  state JSONB,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, routing_strategy)
);

ALTER TABLE provider_rotation_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_rotation_state_service_all ON provider_rotation_state;
CREATE POLICY provider_rotation_state_service_all ON provider_rotation_state
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- MIGRATION HELPERS
-- ============================================================================
-- These functions help migrate data from the old schema to the new one

-- Migrate users from custom users table to profiles (auth.users created via signup)
-- Call: SELECT migrate_users_to_profiles();
CREATE OR REPLACE FUNCTION migrate_users_to_profiles()
RETURNS TABLE(migrated_count INT, error_message TEXT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- This is a placeholder function
  -- In practice, data migration happens through the backend during auth transition
  RETURN QUERY SELECT 0::INT, 'Migration should be handled by backend during auth transition'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Get current user's unified key
CREATE OR REPLACE FUNCTION get_user_unified_key(p_user_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT key FROM unified_keys WHERE user_id = p_user_id AND enabled = true LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Regenerate unified key for a user
CREATE OR REPLACE FUNCTION regenerate_unified_key(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_new_key TEXT;
BEGIN
  -- Generate a cryptographically random key (prefix + random string)
  v_new_key := 'sk-' || encode(gen_random_bytes(32), 'hex');
  
  -- Disable old key if exists
  UPDATE unified_keys SET enabled = false WHERE user_id = p_user_id;
  
  -- Insert new key
  INSERT INTO unified_keys (user_id, key, name)
  VALUES (p_user_id, v_new_key, 'Default')
  ON CONFLICT (user_id) DO UPDATE
  SET key = v_new_key, enabled = true, updated_at = now();
  
  RETURN v_new_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get usage summary for a user
CREATE OR REPLACE FUNCTION get_usage_summary(p_user_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE(
  total_requests BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  provider_count INT,
  model_count INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(request_count)::BIGINT, 0) as total_requests,
    COALESCE(SUM(input_tokens)::BIGINT, 0) as total_input_tokens,
    COALESCE(SUM(output_tokens)::BIGINT, 0) as total_output_tokens,
    COUNT(DISTINCT provider)::INT as provider_count,
    COUNT(DISTINCT model)::INT as model_count
  FROM usage_logs
  WHERE user_id = p_user_id
    AND created_at >= NOW() - (p_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANTS
-- ============================================================================
-- This ensures that authenticated users have access to their own data via RLS
-- and service role can do system-level operations
