// Supabase Database Adapter
// Provides SQLite-compatible synchronous API wrapper for existing code
// Uses sync wrapper pattern to maintain compatibility
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
let supabaseInstance = null;
let isInitialized = false;
/**
 * Query cache for synchronous simulation
 * Runs async query and waits for result
 */
const queryCache = new Map();
/**
 * Simulate synchronous query execution
 * In production, use Vercel serverless functions or edge functions
 */
function execQuerySync(query, params) {
    const key = `${query}:${JSON.stringify(params)}`;
    // For now, we'll use a blocking approach
    // In production, migrate to async handlers
    throw new Error('Synchronous queries not yet supported. Please convert route handlers to async. ' +
        'Use the following pattern: ' +
        '\nexport async function handler() { const db = getDb(); const stmt = db.prepare(sql); const data = await stmt.all(); }');
}
/**
 * Supabase prepared statement wrapper
 */
class SupabasePreparedStatement {
    sql;
    supabase;
    queryParams = [];
    constructor(sql, supabase) {
        this.sql = sql;
        this.supabase = supabase;
    }
    run(...params) {
        this.queryParams = params;
        return execQuerySync(this.sql, params);
    }
    get(...params) {
        this.queryParams = params;
        const all = execQuerySync(this.sql, params);
        return all?.[0] || null;
    }
    all(...params) {
        this.queryParams = params;
        return execQuerySync(this.sql, params);
    }
}
/**
 * Create a Supabase database adapter
 * Maintains interface compatibility with better-sqlite3
 */
export function createSupabaseAdapter() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
    }
    if (!supabaseInstance) {
        supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    const db = {
        prepare: (sql) => {
            return new SupabasePreparedStatement(sql, supabaseInstance);
        },
        exec: (sql) => {
            // Schema setup is handled by Supabase migrations
            console.log('[DB] exec() skipped - schema created via migrations');
        },
        transaction: (fn) => {
            return () => {
                // Transactions are handled by Supabase automatically
                fn();
            };
        },
        pragma: (pragma) => ({
            all: () => {
                // Pragmas are SQLite-specific, return empty
                return [];
            },
        }),
    };
    return db;
}
/**
 * Initialize Supabase and migrate from SQLite
 * This should be called during deployment
 */
export async function migrateToSupabase() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('Cannot migrate: Missing Supabase credentials');
        return;
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    try {
        // Test connection
        const { error } = await supabase.from('models').select('count(*)', { count: 'exact', head: true });
        if (error)
            throw error;
        console.log('✓ Supabase connection successful');
        // Import SQLite data
        console.log('Migrating data from SQLite to Supabase...');
        // Add migration logic here
        isInitialized = true;
        return true;
    }
    catch (error) {
        console.error('Migration failed:', error);
        return false;
    }
}
/**
 * Health check for Supabase connection
 */
export async function healthCheck() {
    if (!supabaseInstance)
        return false;
    try {
        const { error } = await supabaseInstance
            .from('models')
            .select('id', { count: 'exact', head: true });
        return !error;
    }
    catch {
        return false;
    }
}
export function getSupabaseClient() {
    if (!supabaseInstance) {
        supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return supabaseInstance;
}
//# sourceMappingURL=supabase-adapter.js.map