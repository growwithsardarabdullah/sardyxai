// Supabase client for Node.js backend with admin and user modes
// This uses the Supabase REST/Auth API directly for server-side operations
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[supabase] Missing Supabase credentials in environment');
}
// Admin client - uses service role key, bypasses RLS
let adminClient = null;
export function getSupabaseAdmin() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return null;
    }
    if (!adminClient) {
        adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        console.log('[supabase] Admin client initialized');
    }
    return adminClient;
}
// Anon client - respects RLS, used for auth operations
let anonClient = null;
export function getSupabaseAnon() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return null;
    }
    if (!anonClient) {
        anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        console.log('[supabase] Anon client initialized');
    }
    return anonClient;
}
// Create a user-authenticated client using a session token
export function getSupabaseUser(accessToken) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase credentials not configured');
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}
// Check if Supabase is configured
export function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}
// Get configuration status for diagnostics
export function getSupabaseConfig() {
    return {
        configured: isSupabaseConfigured(),
        url: SUPABASE_URL ? new URL(SUPABASE_URL).host : 'not configured',
        hasAnonKey: Boolean(SUPABASE_ANON_KEY),
        hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    };
}
//# sourceMappingURL=supabase-client.js.map