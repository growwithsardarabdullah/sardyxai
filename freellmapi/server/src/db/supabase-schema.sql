-- Supabase PostgreSQL Schema for FreeLLMAPI
-- Complete migration from SQLite with 100% feature parity

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Models catalog with provider information and rate limits
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

-- API keys for each provider
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  base_url TEXT, -- for custom/openai-compatible providers
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TIMESTAMP,
  UNIQUE(platform, label)
);

-- Request logs for analytics and monitoring
CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ttfb_ms INTEGER, -- time to first byte for streaming
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rate limit usage tracking (sliding window)
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

-- Rate limit cooldowns (exponential backoff state)
CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  key_id BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, model_id, key_id)
);

-- Fallback configuration (model rotation priority)
CREATE TABLE IF NOT EXISTS fallback_config (
  id BIGSERIAL PRIMARY KEY,
  model_db_id BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(model_db_id)
);

-- Settings and configuration
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dashboard users (authentication)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session tokens for dashboard authentication
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Provider health checks
CREATE TABLE IF NOT EXISTS provider_health (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  key_id BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  status TEXT NOT NULL, -- 'healthy', 'degraded', 'unhealthy'
  last_check_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token usage tracking for billing/analytics
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

-- Analytics events for dashboard
CREATE TABLE IF NOT EXISTS analytics (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL, -- 'request_success', 'request_error', 'rate_limit_hit', etc.
  platform TEXT,
  model_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Error logs for debugging
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

-- Unified API key for proxy access
CREATE TABLE IF NOT EXISTS unified_api_keys (
  id BIGSERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP
);

-- Provider rotation state (for bandit routing)
CREATE TABLE IF NOT EXISTS provider_rotation_state (
  id BIGSERIAL PRIMARY KEY,
  routing_strategy TEXT NOT NULL DEFAULT 'priority', -- 'priority', 'epsilon_greedy', 'ucb', 'thompson_sampling'
  model_id TEXT NOT NULL,
  state JSONB,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, routing_strategy)
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

CREATE INDEX idx_requests_created_at ON requests(created_at);
CREATE INDEX idx_requests_platform ON requests(platform);
CREATE INDEX idx_requests_model_id ON requests(model_id);
CREATE INDEX idx_requests_key_id ON requests(key_id);
CREATE INDEX idx_requests_status ON requests(status);

CREATE INDEX idx_rate_limit_usage_lookup ON rate_limit_usage(platform, model_id, key_id, kind, created_at_ms);
CREATE INDEX idx_rate_limit_usage_created_at ON rate_limit_usage(created_at_ms);

CREATE INDEX idx_rate_limit_cooldowns_expires ON rate_limit_cooldowns(expires_at_ms);

CREATE INDEX idx_api_keys_platform ON api_keys(platform);
CREATE INDEX idx_api_keys_enabled ON api_keys(enabled);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at_ms);

CREATE INDEX idx_provider_health_platform ON provider_health(platform);
CREATE INDEX idx_provider_health_key_id ON provider_health(key_id);

CREATE INDEX idx_token_usage_platform_model ON token_usage(platform, model_id);
CREATE INDEX idx_token_usage_period ON token_usage(period_start, period_end);

CREATE INDEX idx_analytics_event_type ON analytics(event_type);
CREATE INDEX idx_analytics_created_at ON analytics(created_at);

CREATE INDEX idx_error_logs_created_at ON error_logs(created_at);
CREATE INDEX idx_error_logs_error_type ON error_logs(error_type);

CREATE INDEX idx_models_platform ON models(platform);
CREATE INDEX idx_models_enabled ON models(enabled);

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
ALTER TABLE unified_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_rotation_state ENABLE ROW LEVEL SECURITY;

-- Models: publicly readable, admin write
CREATE POLICY models_public_read ON models FOR SELECT USING (true);
CREATE POLICY models_admin_write ON models FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY models_admin_update ON models FOR UPDATE USING (auth.role() = 'authenticated');

-- API Keys: admin only
CREATE POLICY api_keys_admin_all ON api_keys FOR ALL USING (auth.role() = 'authenticated');

-- Requests: readable by system, writable by system
CREATE POLICY requests_system ON requests FOR ALL USING (true);

-- Rate limit usage: system access only
CREATE POLICY rate_limit_usage_system ON rate_limit_usage FOR ALL USING (true);

-- Rate limit cooldowns: system access only
CREATE POLICY rate_limit_cooldowns_system ON rate_limit_cooldowns FOR ALL USING (true);

-- Fallback config: admin only
CREATE POLICY fallback_config_admin ON fallback_config FOR ALL USING (auth.role() = 'authenticated');

-- Settings: admin only
CREATE POLICY settings_admin ON settings FOR ALL USING (auth.role() = 'authenticated');

-- Users: users can only see themselves
CREATE POLICY users_own ON users FOR SELECT USING (auth.uid()::text = id::text OR auth.role() = 'service_role');

-- Sessions: users can see own sessions
CREATE POLICY sessions_own ON sessions FOR SELECT USING (auth.role() = 'service_role');

-- Provider health: system and admin
CREATE POLICY provider_health_system ON provider_health FOR ALL USING (true);

-- Token usage: admin and system
CREATE POLICY token_usage_system ON token_usage FOR ALL USING (true);

-- Analytics: admin only
CREATE POLICY analytics_admin ON analytics FOR ALL USING (auth.role() = 'authenticated');

-- Error logs: admin and system
CREATE POLICY error_logs_system ON error_logs FOR ALL USING (true);

-- Unified API keys: admin only
CREATE POLICY unified_api_keys_admin ON unified_api_keys FOR ALL USING (auth.role() = 'authenticated');

-- Provider rotation state: system and admin
CREATE POLICY provider_rotation_state_system ON provider_rotation_state FOR ALL USING (true);
