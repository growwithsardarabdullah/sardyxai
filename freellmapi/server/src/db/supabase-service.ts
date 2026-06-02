// Supabase Service Layer
// Async database operations replacing SQLite queries
// All database access should go through these functions

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase.js';

// ============================================================================
// Models Service
// ============================================================================

export async function getAllModels() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('enabled', true)
    .order('intelligence_rank', { ascending: true });
  
  if (error) throw new Error(`Failed to fetch models: ${error.message}`);
  return data || [];
}

export async function getModelById(id: number) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function getModelByPlatformAndId(platform: string, modelId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('platform', platform)
    .eq('model_id', modelId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function updateModel(id: number, updates: Record<string, any>) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('models')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw new Error(`Failed to update model: ${error.message}`);
  return data;
}

// ============================================================================
// API Keys Service
// ============================================================================

export async function getApiKeyById(id: number) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function getApiKeysByPlatform(platform: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('platform', platform)
    .eq('enabled', true);
  
  if (error) throw new Error(`Failed to fetch API keys: ${error.message}`);
  return data || [];
}

export async function createApiKey(apiKeyData: {
  platform: string;
  label: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  base_url?: string;
  status?: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('api_keys')
    .insert([apiKeyData])
    .select()
    .single();
  
  if (error) throw new Error(`Failed to create API key: ${error.message}`);
  return data;
}

export async function updateApiKey(id: number, updates: Record<string, any>) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('api_keys')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw new Error(`Failed to update API key: ${error.message}`);
  return data;
}

export async function deleteApiKey(id: number) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', id);
  
  if (error) throw new Error(`Failed to delete API key: ${error.message}`);
}

// ============================================================================
// Requests/Analytics Service
// ============================================================================

export async function recordRequest(requestData: {
  platform: string;
  model_id: string;
  key_id?: number;
  status: string;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  ttfb_ms?: number;
  error?: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('requests')
    .insert([requestData])
    .select()
    .single();
  
  if (error) throw new Error(`Failed to record request: ${error.message}`);
  return data;
}

export async function getRequestStats(platform: string, modelId: string, windowDays = 7) {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('platform', platform)
    .eq('model_id', modelId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  
  if (error) throw new Error(`Failed to fetch request stats: ${error.message}`);
  return data || [];
}

export async function getMonthlyTokenUsage(platform: string, modelId: string) {
  const supabase = getSupabaseClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  
  const { data, error } = await supabase
    .from('requests')
    .select('input_tokens, output_tokens')
    .eq('platform', platform)
    .eq('model_id', modelId)
    .gte('created_at', monthStart)
    .eq('status', 'success');
  
  if (error) throw new Error(`Failed to fetch token usage: ${error.message}`);
  
  return (data || []).reduce((sum: number, r: any) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
}

// ============================================================================
// Rate Limiting Service
// ============================================================================

export async function recordRateLimitUsage(
  platform: string,
  modelId: string,
  keyId: number,
  kind: 'request' | 'tokens',
  tokens: number,
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rate_limit_usage')
    .insert([{
      platform,
      model_id: modelId,
      key_id: keyId,
      kind,
      tokens,
      created_at_ms: Date.now(),
    }]);
  
  if (error) throw new Error(`Failed to record rate limit usage: ${error.message}`);
}

export async function countRateLimitRequests(
  platform: string,
  modelId: string,
  keyId: number,
  windowMs: number,
) {
  const supabase = getSupabaseClient();
  const since = Date.now() - windowMs;
  
  const { count, error } = await supabase
    .from('rate_limit_usage')
    .select('*', { count: 'exact', head: true })
    .eq('platform', platform)
    .eq('model_id', modelId)
    .eq('key_id', keyId)
    .eq('kind', 'request')
    .gte('created_at_ms', since);
  
  if (error) throw new Error(`Failed to count rate limit requests: ${error.message}`);
  return count || 0;
}

export async function sumRateLimitTokens(
  platform: string,
  modelId: string,
  keyId: number,
  windowMs: number,
) {
  const supabase = getSupabaseClient();
  const since = Date.now() - windowMs;
  
  const { data, error } = await supabase
    .from('rate_limit_usage')
    .select('tokens')
    .eq('platform', platform)
    .eq('model_id', modelId)
    .eq('key_id', keyId)
    .eq('kind', 'tokens')
    .gte('created_at_ms', since);
  
  if (error) throw new Error(`Failed to sum rate limit tokens: ${error.message}`);
  
  return (data || []).reduce((sum: number, row: any) => sum + row.tokens, 0);
}

export async function getRateLimitCooldown(platform: string, modelId: string, keyId: number) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rate_limit_cooldowns')
    .select('expires_at_ms')
    .eq('platform', platform)
    .eq('model_id', modelId)
    .eq('key_id', keyId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data?.expires_at_ms || null;
}

export async function setRateLimitCooldown(
  platform: string,
  modelId: string,
  keyId: number,
  expiresAtMs: number,
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rate_limit_cooldowns')
    .upsert([{
      platform,
      model_id: modelId,
      key_id: keyId,
      expires_at_ms: expiresAtMs,
    }]);
  
  if (error) throw new Error(`Failed to set rate limit cooldown: ${error.message}`);
}

export async function cleanupExpiredRateLimitCooldowns() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rate_limit_cooldowns')
    .delete()
    .lt('expires_at_ms', Date.now());
  
  if (error) throw new Error(`Failed to cleanup rate limit cooldowns: ${error.message}`);
}

// ============================================================================
// Authentication Service
// ============================================================================

export async function getUserByEmail(email: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function createUser(email: string, passwordHash: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .insert([{
      email: email.toLowerCase(),
      password_hash: passwordHash,
    }])
    .select()
    .single();
  
  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return data;
}

export async function createSession(userId: number, tokenHash: string, expiresAtMs: number) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('sessions')
    .insert([{
      token_hash: tokenHash,
      user_id: userId,
      expires_at_ms: expiresAtMs,
    }]);
  
  if (error) throw new Error(`Failed to create session: ${error.message}`);
}

export async function getSession(tokenHash: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('user_id, expires_at_ms, users(email)')
    .eq('token_hash', tokenHash)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function deleteSession(tokenHash: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('token_hash', tokenHash);
  
  if (error) throw new Error(`Failed to delete session: ${error.message}`);
}

export async function cleanupExpiredSessions() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .lt('expires_at_ms', Date.now());
  
  if (error) throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
}

// ============================================================================
// Settings Service
// ============================================================================

export async function getSetting(key: string, defaultValue?: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data?.value || defaultValue || null;
}

export async function setSetting(key: string, value: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('settings')
    .upsert([{
      key,
      value,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'key' });
  
  if (error) throw new Error(`Failed to set setting: ${error.message}`);
}

// ============================================================================
// Fallback Configuration Service
// ============================================================================

export async function getFallbackConfig() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fallback_config')
    .select('*, models(*)')
    .eq('enabled', true)
    .order('priority', { ascending: true });
  
  if (error) throw new Error(`Failed to fetch fallback config: ${error.message}`);
  return data || [];
}

export async function updateFallbackPriority(modelDbId: number, priority: number) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fallback_config')
    .update({ priority })
    .eq('model_db_id', modelDbId);
  
  if (error) throw new Error(`Failed to update fallback priority: ${error.message}`);
}

// ============================================================================
// Analytics Service
// ============================================================================

export async function recordAnalyticsEvent(
  eventType: string,
  platform?: string,
  modelId?: string,
  metadata?: Record<string, any>,
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('analytics')
    .insert([{
      event_type: eventType,
      platform,
      model_id: modelId,
      metadata,
    }]);
  
  if (error) throw new Error(`Failed to record analytics: ${error.message}`);
}

export async function recordErrorLog(
  errorType: string,
  message: string,
  stackTrace?: string,
  platform?: string,
  modelId?: string,
  context?: Record<string, any>,
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('error_logs')
    .insert([{
      error_type: errorType,
      message,
      stack_trace: stackTrace,
      platform,
      model_id: modelId,
      context,
    }]);
  
  if (error) throw new Error(`Failed to record error: ${error.message}`);
}

// ============================================================================
// Provider Health Service
// ============================================================================

export async function updateProviderHealth(
  platform: string,
  keyId: number | null,
  status: 'healthy' | 'degraded' | 'unhealthy',
  error?: string,
) {
  const supabase = getSupabaseClient();
  
  let query = supabase
    .from('provider_health')
    .upsert([{
      platform,
      key_id: keyId,
      status,
      last_error: error,
      last_check_at: new Date().toISOString(),
    }]);
  
  const { error: err } = await query;
  if (err) throw new Error(`Failed to update provider health: ${err.message}`);
}

export async function getProviderHealth(platform: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('provider_health')
    .select('*')
    .eq('platform', platform)
    .order('last_check_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ============================================================================
// Cleanup Jobs
// ============================================================================

export async function cleanupOldData(retentionDays = 90) {
  const supabase = getSupabaseClient();
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  
  // Clean up old requests
  await supabase
    .from('requests')
    .delete()
    .lt('created_at', cutoffDate);
  
  // Clean up old rate limit usage
  await supabase
    .from('rate_limit_usage')
    .delete()
    .lt('created_at', cutoffDate);
  
  // Clean up old sessions
  await supabase
    .from('sessions')
    .delete()
    .lt('created_at', cutoffDate);
  
  console.log(`Cleaned up data older than ${retentionDays} days`);
}
