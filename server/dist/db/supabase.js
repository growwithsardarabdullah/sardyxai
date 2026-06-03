// Supabase Client Module
// Provides a single admin client (service_role) for all server-side writes.
// RLS policies require service_role — the anon key CANNOT bypass RLS, so all
// writes must use the service_role key.
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdmin = null;
let supabaseClient = null;
let initialized = false;
function init() {
    if (initialized)
        return;
    initialized = true;
    if (!SUPABASE_URL) {
        console.warn('[supabase] SUPABASE_URL not set — Supabase integration disabled');
        return;
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        console.error('[supabase] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is not set! ' +
            'All Supabase writes will be blocked by RLS. ' +
            'Set SUPABASE_SERVICE_ROLE_KEY in your environment variables.');
        // Still create the client so code doesn't crash, but it won't work for writes.
        // We use ANON_KEY as a fallback so at least SELECT queries (which some RLS
        // policies allow, e.g. models_public_read) will work.
        if (SUPABASE_ANON_KEY) {
            supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.warn('[supabase] Falling back to ANON_KEY — writes will fail, reads may work for public tables');
        }
        return;
    }
    // Admin client: service_role key (bypasses RLS)
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    // Public client: anon key (respects RLS)
    if (SUPABASE_ANON_KEY) {
        supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
    console.log(`[supabase] Initialized: ${new URL(SUPABASE_URL).host} (service_role: yes, anon: ${!!SUPABASE_ANON_KEY})`);
}
export function getSupabaseClient() {
    init();
    if (!supabaseClient) {
        console.warn('[supabase] Public client not initialized — missing SUPABASE_ANON_KEY');
    }
    return supabaseClient;
}
export function getSupabaseAdmin() {
    init();
    if (!supabaseAdmin) {
        console.warn('[supabase] Admin client not initialized — missing SUPABASE_URL');
        return null;
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        // One-time prominent warning in production logs
        console.error('[supabase] Admin client is using ANON key (writes blocked by RLS). Set SUPABASE_SERVICE_ROLE_KEY.');
    }
    return supabaseAdmin;
}
/**
 * Verify the admin client can actually reach Supabase.
 * Called once at startup after env vars are loaded.
 */
export async function verifySupabaseConnection() {
    init();
    if (!supabaseAdmin) {
        console.warn('[supabase] Connection verify skipped — no admin client');
        return false;
    }
    try {
        const { error, count } = await supabaseAdmin
            .from('users')
            .select('id', { count: 'exact', head: true });
        if (error) {
            console.error(`[supabase] Connection verify FAILED: ${error.message} (code: ${error.code})`);
            return false;
        }
        console.log(`[supabase] Connection verified — users table has ${count ?? '?'} rows`);
        return true;
    }
    catch (err) {
        console.error(`[supabase] Connection verify error: ${err.message}`);
        return false;
    }
}
/**
 * Initialize Supabase database connection
 * Currently not used — returns null as better-sqlite3 is the default
 */
export async function initDb() {
    console.log('Supabase integration available but not currently in use');
    return null;
}
/**
 * Connection health check
 */
export async function checkConnection() {
    init();
    if (!supabaseClient) {
        return false;
    }
    try {
        const { error } = await supabaseClient.from('models').select('id', { count: 'exact', head: true });
        return !error;
    }
    catch {
        return false;
    }
}
/**
 * Run a raw SQL query (admin only)
 */
export async function runQuery(sql, params = []) {
    const admin = getSupabaseAdmin();
    if (!admin) {
        throw new Error('Supabase admin client not initialized');
    }
    const { data, error } = await admin.rpc('exec_sql', {
        query: sql,
        params,
    });
    if (error) {
        throw new Error(`Database query error: ${error.message}`);
    }
    return data || [];
}
//# sourceMappingURL=supabase.js.map