// Supabase Service Layer
// Async database operations replacing SQLite queries
// All database access should go through these functions
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
    if (error)
        throw new Error(`Failed to fetch models: ${error.message}`);
    return data || [];
}
export async function getModelById(id) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('id', id)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data || null;
}
export async function getModelByPlatformAndId(platform, modelId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('platform', platform)
        .eq('model_id', modelId)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data || null;
}
export async function updateModel(id, updates) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('models')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw new Error(`Failed to update model: ${error.message}`);
    return data;
}
// ============================================================================
// API Keys Service
// ============================================================================
export async function getApiKeyById(id) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('id', id)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data || null;
}
export async function getApiKeysByPlatform(platform) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('platform', platform)
        .eq('enabled', true);
    if (error)
        throw new Error(`Failed to fetch API keys: ${error.message}`);
    return data || [];
}
export async function createApiKey(apiKeyData) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('api_keys')
        .insert([apiKeyData])
        .select()
        .single();
    if (error)
        throw new Error(`Failed to create API key: ${error.message}`);
    return data;
}
export async function updateApiKey(id, updates) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('api_keys')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw new Error(`Failed to update API key: ${error.message}`);
    return data;
}
export async function deleteApiKey(id) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('api_keys')
        .delete()
        .eq('id', id);
    if (error)
        throw new Error(`Failed to delete API key: ${error.message}`);
}
// ============================================================================
// Requests/Analytics Service
// ============================================================================
export async function recordRequest(requestData) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('requests')
        .insert([requestData])
        .select()
        .single();
    if (error)
        throw new Error(`Failed to record request: ${error.message}`);
    return data;
}
export async function getRequestStats(platform, modelId, windowDays = 7) {
    const supabase = getSupabaseClient();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('requests')
        .select('*')
        .eq('platform', platform)
        .eq('model_id', modelId)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(`Failed to fetch request stats: ${error.message}`);
    return data || [];
}
export async function getMonthlyTokenUsage(platform, modelId) {
    const supabase = getSupabaseClient();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data, error } = await supabase
        .from('requests')
        .select('input_tokens, output_tokens')
        .eq('platform', platform)
        .eq('model_id', modelId)
        .gte('created_at', monthStart)
        .eq('status', 'success');
    if (error)
        throw new Error(`Failed to fetch token usage: ${error.message}`);
    return (data || []).reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
}
// ============================================================================
// Rate Limiting Service
// ============================================================================
export async function recordRateLimitUsage(platform, modelId, keyId, kind, tokens) {
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
    if (error)
        throw new Error(`Failed to record rate limit usage: ${error.message}`);
}
export async function countRateLimitRequests(platform, modelId, keyId, windowMs) {
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
    if (error)
        throw new Error(`Failed to count rate limit requests: ${error.message}`);
    return count || 0;
}
export async function sumRateLimitTokens(platform, modelId, keyId, windowMs) {
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
    if (error)
        throw new Error(`Failed to sum rate limit tokens: ${error.message}`);
    return (data || []).reduce((sum, row) => sum + row.tokens, 0);
}
export async function getRateLimitCooldown(platform, modelId, keyId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('rate_limit_cooldowns')
        .select('expires_at_ms')
        .eq('platform', platform)
        .eq('model_id', modelId)
        .eq('key_id', keyId)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data?.expires_at_ms || null;
}
export async function setRateLimitCooldown(platform, modelId, keyId, expiresAtMs) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('rate_limit_cooldowns')
        .upsert([{
            platform,
            model_id: modelId,
            key_id: keyId,
            expires_at_ms: expiresAtMs,
        }]);
    if (error)
        throw new Error(`Failed to set rate limit cooldown: ${error.message}`);
}
export async function cleanupExpiredRateLimitCooldowns() {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('rate_limit_cooldowns')
        .delete()
        .lt('expires_at_ms', Date.now());
    if (error)
        throw new Error(`Failed to cleanup rate limit cooldowns: ${error.message}`);
}
// ============================================================================
// Authentication Service
// ============================================================================
export async function getUserByEmail(email) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data || null;
}
export async function createUser(email, passwordHash) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('users')
        .insert([{
            email: email.toLowerCase(),
            password_hash: passwordHash,
        }])
        .select()
        .single();
    if (error)
        throw new Error(`Failed to create user: ${error.message}`);
    return data;
}
export async function createSession(userId, tokenHash, expiresAtMs) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('sessions')
        .insert([{
            token_hash: tokenHash,
            user_id: userId,
            expires_at_ms: expiresAtMs,
        }]);
    if (error)
        throw new Error(`Failed to create session: ${error.message}`);
}
export async function getSession(tokenHash) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('sessions')
        .select('user_id, expires_at_ms, users(email)')
        .eq('token_hash', tokenHash)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data || null;
}
export async function deleteSession(tokenHash) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('token_hash', tokenHash);
    if (error)
        throw new Error(`Failed to delete session: ${error.message}`);
}
export async function cleanupExpiredSessions() {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('sessions')
        .delete()
        .lt('expires_at_ms', Date.now());
    if (error)
        throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
}
// ============================================================================
// Settings Service
// ============================================================================
export async function getSetting(key, defaultValue) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', key)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data?.value || defaultValue || null;
}
export async function setSetting(key, value) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('settings')
        .upsert([{
            key,
            value,
            updated_at: new Date().toISOString(),
        }], { onConflict: 'key' });
    if (error)
        throw new Error(`Failed to set setting: ${error.message}`);
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
    if (error)
        throw new Error(`Failed to fetch fallback config: ${error.message}`);
    return data || [];
}
export async function updateFallbackPriority(modelDbId, priority) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('fallback_config')
        .update({ priority })
        .eq('model_db_id', modelDbId);
    if (error)
        throw new Error(`Failed to update fallback priority: ${error.message}`);
}
// ============================================================================
// Analytics Service
// ============================================================================
export async function recordAnalyticsEvent(eventType, platform, modelId, metadata) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('analytics')
        .insert([{
            event_type: eventType,
            platform,
            model_id: modelId,
            metadata,
        }]);
    if (error)
        throw new Error(`Failed to record analytics: ${error.message}`);
}
export async function recordErrorLog(errorType, message, stackTrace, platform, modelId, context) {
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
    if (error)
        throw new Error(`Failed to record error: ${error.message}`);
}
// ============================================================================
// Provider Health Service
// ============================================================================
export async function updateProviderHealth(platform, keyId, status, error) {
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
    if (err)
        throw new Error(`Failed to update provider health: ${err.message}`);
}
export async function getProviderHealth(platform) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('provider_health')
        .select('*')
        .eq('platform', platform)
        .order('last_check_at', { ascending: false })
        .limit(1)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
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
// ============================================================================
// PRODUCTION: PROVIDER KEYS (User-scoped)
// ============================================================================
export async function addProviderKey(userId, provider, key, label, baseUrl) {
    const { encrypt } = await import('../lib/crypto.js');
    const supabase = getSupabaseClient();
    const { encrypted, iv, authTag } = encrypt(key);
    const { data, error } = await supabase
        .from('provider_keys')
        .insert({
        user_id: userId,
        provider,
        label: label || provider,
        encrypted_key: encrypted,
        iv,
        auth_tag: authTag,
        base_url: baseUrl || null,
        enabled: true,
        status: 'unknown',
    })
        .select()
        .single();
    if (error)
        throw new Error(`Failed to add provider key: ${error.message}`);
    return data;
}
export async function getProviderKeysByUser(userId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('provider_keys')
        .select('id, user_id, provider, label, enabled, status, base_url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error)
        throw new Error(`Failed to fetch provider keys: ${error.message}`);
    return data || [];
}
export async function getProviderKeyDecrypted(userId, keyId) {
    const { decrypt } = await import('../lib/crypto.js');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('provider_keys')
        .select('encrypted_key, iv, auth_tag')
        .eq('user_id', userId)
        .eq('id', keyId)
        .single();
    if (error)
        throw new Error(`Failed to fetch provider key: ${error.message}`);
    if (!data)
        throw new Error('Provider key not found');
    return decrypt(data.encrypted_key, data.iv, data.auth_tag);
}
export async function deleteProviderKey(userId, keyId) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('provider_keys')
        .delete()
        .eq('user_id', userId)
        .eq('id', keyId);
    if (error)
        throw new Error(`Failed to delete provider key: ${error.message}`);
}
export async function updateProviderKeyStatus(keyId, status) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('provider_keys')
        .update({ status, last_tested_at: new Date().toISOString() })
        .eq('id', keyId);
    if (error)
        throw new Error(`Failed to update provider key status: ${error.message}`);
}
// ============================================================================
// PRODUCTION: UNIFIED KEYS (User-scoped)
// ============================================================================
export async function ensureUserUnifiedKey(userId) {
    const supabase = getSupabaseClient();
    // Check for existing enabled key
    const { data: existing, error: fetchErr } = await supabase
        .from('unified_keys')
        .select('key')
        .eq('user_id', userId)
        .eq('enabled', true)
        .single();
    if (existing?.key)
        return existing.key;
    // Generate new key
    const { data, error } = await supabase
        .rpc('regenerate_unified_key', { p_user_id: userId });
    if (error)
        throw new Error(`Failed to generate unified key: ${error.message}`);
    return data;
}
export async function regenerateUserUnifiedKey(userId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .rpc('regenerate_unified_key', { p_user_id: userId });
    if (error)
        throw new Error(`Failed to regenerate unified key: ${error.message}`);
    return data;
}
// ============================================================================
// PRODUCTION: USER SETTINGS (User-scoped)
// ============================================================================
export async function getUserSetting(userId, key) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('user_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', key)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data?.value || null;
}
export async function setUserSetting(userId, key, value) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('user_settings')
        .upsert({
        user_id: userId,
        key,
        value,
        updated_at: new Date().toISOString(),
    }, {
        onConflict: 'user_id,key',
    });
    if (error)
        throw new Error(`Failed to save setting: ${error.message}`);
}
// ============================================================================
// PRODUCTION: USAGE LOGGING (User-scoped)
// ============================================================================
export async function logUserUsage(userId, provider, model, inputTokens, outputTokens, latencyMs, status = 'success', errorMessage) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('usage_logs')
        .insert({
        user_id: userId,
        provider,
        model,
        request_count: 1,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        latency_ms: latencyMs || null,
        status,
        error_message: errorMessage || null,
    });
    if (error) {
        console.error('[db] Usage logging failed:', error.message);
        // Non-fatal - don't throw
        return;
    }
}
export async function getUserUsageSummary(userId, days = 30) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .rpc('get_usage_summary', { p_user_id: userId, p_days: days });
    if (error)
        throw new Error(`Failed to get usage summary: ${error.message}`);
    return data || {
        total_requests: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        provider_count: 0,
        model_count: 0,
    };
}
export async function getUserUsageByProvider(userId, days = 30) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('usage_logs')
        .select('provider, request_count, input_tokens, output_tokens')
        .eq('user_id', userId)
        .gte('created_at', `now()-${days} days`)
        .order('provider');
    if (error)
        throw new Error(`Failed to get usage by provider: ${error.message}`);
    // Aggregate by provider
    const byProvider = {};
    (data || []).forEach((row) => {
        if (!byProvider[row.provider]) {
            byProvider[row.provider] = {
                provider: row.provider,
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
            };
        }
        byProvider[row.provider].requests += row.request_count;
        byProvider[row.provider].inputTokens += row.input_tokens;
        byProvider[row.provider].outputTokens += row.output_tokens;
    });
    return Object.values(byProvider);
}
//# sourceMappingURL=supabase-service.js.map