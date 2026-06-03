export declare function getSupabaseClient(): any;
export declare function getSupabaseAdmin(): any;
/**
 * Verify the admin client can actually reach Supabase.
 * Called once at startup after env vars are loaded.
 */
export declare function verifySupabaseConnection(): Promise<boolean>;
/**
 * Initialize Supabase database connection
 * Currently not used — returns null as better-sqlite3 is the default
 */
export declare function initDb(): Promise<null>;
/**
 * Connection health check
 */
export declare function checkConnection(): Promise<boolean>;
/**
 * Run a raw SQL query (admin only)
 */
export declare function runQuery(sql: string, params?: unknown[]): Promise<unknown[]>;
//# sourceMappingURL=supabase.d.ts.map