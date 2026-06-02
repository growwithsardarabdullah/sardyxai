export declare function getSupabaseClient(): any;
export declare function getSupabaseAdmin(): any;
/**
 * Initialize Supabase database connection
 * Currently not used - returns null as better-sqlite3 is the default
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