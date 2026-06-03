-- ============================================================================
-- FreeLLMAPI Supabase PostgreSQL Schema — Multi-User Production
-- ============================================================================

-- Models catalog (shared across all users — provider info is global)
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

-- API keys — per-user storage
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  base_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TIMESTAMP
);

-- Request logs for analytics (shared system table)
CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ttfb_ms INTEGER,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rate limit usage tracking (transient, per-instance)
CREATE TABLE IF NOT EXISTS rate_limit_usage (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'tokens')),
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rate limit cooldowns (transient, per-instance)
CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, model_id, key_id)
);

-- Fallback configuration (shared catalog)
CREATE TABLE IF NOT EXISTS fallback_config (
  id BIGSERIAL PRIMARY KEY,
  model_db_id BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(model_db_id)
);

-- Settings and configuration (per-user)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  user_email TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dashboard users (authentication)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session tokens (legacy — kept for migration, not actively used)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Provider health checks (shared system table)
CREATE TABLE IF NOT EXISTS provider_health (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  key_id BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  last_check_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token usage tracking (shared system table)
CREATE TABLE IF NOT EXISTS token_usage (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_estimate DECIMAL(10, 6),
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analytics events (shared system table)
CREATE TABLE IF NOT EXISTS analytics (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  platform TEXT,
  model_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Error logs (shared system table)
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  error_type TEXT NOT NULL,
  platform TEXT,
  model_id TEXT,
  message TEXT,
  stack_trace TEXT,
  context JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Provider rotation state (shared system table)
CREATE TABLE IF NOT EXISTS provider_rotation_state (
  id BIGSERIAL PRIMARY KEY,
  routing_strategy TEXT NOT NULL DEFAULT 'priority',
  model_id TEXT NOT NULL,
  state JSONB,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, routing_strategy)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform);
CREATE INDEX IF NOT EXISTS idx_requests_model_id ON requests(model_id);
CREATE INDEX IF NOT EXISTS idx_requests_key_id ON requests(key_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_user_email ON requests(user_email);

CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_lookup ON rate_limit_usage(platform, model_id, key_id, kind, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_rate_limit_cooldowns_expires ON rate_limit_cooldowns(expires_at_ms);

CREATE INDEX IF NOT EXISTS idx_api_keys_platform ON api_keys(platform);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_email ON api_keys(user_email);

CREATE INDEX IF NOT EXISTS idx_settings_user_email ON settings(user_email);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at_ms);

CREATE INDEX IF NOT EXISTS idx_models_platform ON models(platform);
CREATE INDEX IF NOT EXISTS idx_models_enabled ON models(enabled);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_cooldowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE fallback_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_rotation_state ENABLE ROW LEVEL SECURITY;

-- Models: publicly readable (catalog is shared)
DROP POLICY IF EXISTS models_public_read ON models;
DROP POLICY IF EXISTS models_admin_write ON models;
DROP POLICY IF EXISTS models_admin_update ON models;
CREATE POLICY models_public_read ON models FOR SELECT USING (true);
CREATE POLICY models_service_all ON models FOR ALL USING (auth.role() = 'service_role');

-- API Keys: service_role only (server-side access via service role key)
DROP POLICY IF EXISTS api_keys_admin_all ON api_keys;
CREATE POLICY api_keys_service_all ON api_keys FOR ALL USING (auth.role() = 'service_role');

-- Requests: service_role only
DROP POLICY IF EXISTS requests_system ON requests;
CREATE POLICY requests_service_all ON requests FOR ALL USING (auth.role() = 'service_role');

-- Rate limit usage: service_role only
DROP POLICY IF EXISTS rate_limit_usage_system ON rate_limit_usage;
CREATE POLICY rate_limit_usage_service_all ON rate_limit_usage FOR ALL USING (auth.role() = 'service_role');

-- Rate limit cooldowns: service_role only
DROP POLICY IF EXISTS rate_limit_cooldowns_system ON rate_limit_cooldowns;
CREATE POLICY rate_limit_cooldowns_service_all ON rate_limit_cooldowns FOR ALL USING (auth.role() = 'service_role');

-- Fallback config: service_role only
DROP POLICY IF EXISTS fallback_config_admin ON fallback_config;
CREATE POLICY fallback_config_service_all ON fallback_config FOR ALL USING (auth.role() = 'service_role');

-- Settings: service_role only
DROP POLICY IF EXISTS settings_admin ON settings;
CREATE POLICY settings_service_all ON settings FOR ALL USING (auth.role() = 'service_role');

-- Users: service_role only (auth is handled server-side with password hashing)
DROP POLICY IF EXISTS users_own ON users;
CREATE POLICY users_service_all ON users FOR ALL USING (auth.role() = 'service_role');

-- Sessions: service_role only
DROP POLICY IF EXISTS sessions_own ON sessions;
CREATE POLICY sessions_service_all ON sessions FOR ALL USING (auth.role() = 'service_role');

-- Provider health: service_role only
DROP POLICY IF EXISTS provider_health_system ON provider_health;
CREATE POLICY provider_health_service_all ON provider_health FOR ALL USING (auth.role() = 'service_role');

-- Token usage: service_role only
DROP POLICY IF EXISTS token_usage_system ON token_usage;
CREATE POLICY token_usage_service_all ON token_usage FOR ALL USING (auth.role() = 'service_role');

-- Analytics: service_role only
DROP POLICY IF EXISTS analytics_admin ON analytics;
CREATE POLICY analytics_service_all ON analytics FOR ALL USING (auth.role() = 'service_role');

-- Error logs: service_role only
DROP POLICY IF EXISTS error_logs_system ON error_logs;
CREATE POLICY error_logs_service_all ON error_logs FOR ALL USING (auth.role() = 'service_role');

-- Provider rotation state: service_role only
DROP POLICY IF EXISTS provider_rotation_state_system ON provider_rotation_state;
CREATE POLICY provider_rotation_state_service_all ON provider_rotation_state FOR ALL USING (auth.role() = 'service_role');
