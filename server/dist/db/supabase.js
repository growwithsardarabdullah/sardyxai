// Supabase Client Module
// Provides async Supabase client for future PostgreSQL migration
// Currently kept for reference - main code uses better-sqlite3
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Initialize Supabase clients if environment variables are provided
let supabaseAdmin = null;
let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
export function getSupabaseClient() {
    if (!supabaseClient) {
        console.warn('Supabase client not initialized - missing environment variables');
    }
    return supabaseClient;
}
export function getSupabaseAdmin() {
    if (!supabaseAdmin) {
        console.warn('Supabase admin client not initialized - missing environment variables');
    }
    return supabaseAdmin;
}
/**
 * Initialize Supabase database connection
 * Currently not used - returns null as better-sqlite3 is the default
 */
export async function initDb() {
    console.log('Supabase integration available but not currently in use');
    return null;
}
/**
 * Connection health check
 */
export async function checkConnection() {
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
    if (!supabaseAdmin) {
        throw new Error('Supabase admin client not initialized');
    }
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
        query: sql,
        params,
    });
    if (error) {
        throw new Error(`Database query error: ${error.message}`);
    }
    return data || [];
}
//# sourceMappingURL=supabase.js.map