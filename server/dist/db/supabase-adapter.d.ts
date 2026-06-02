import { SupabaseClient } from '@supabase/supabase-js';
interface Database {
    prepare: (sql: string) => PreparedStatement;
    exec: (sql: string) => void;
    transaction: (fn: () => void) => () => void;
    pragma: (pragma: string) => {
        all: () => any[];
    };
}
interface PreparedStatement {
    run: (...params: any[]) => {
        lastInsertRowid: number;
        changes: number;
    };
    get: (...params: any[]) => any;
    all: (...params: any[]) => any[];
}
/**
 * Create a Supabase database adapter
 * Maintains interface compatibility with better-sqlite3
 */
export declare function createSupabaseAdapter(): Database;
/**
 * Initialize Supabase and migrate from SQLite
 * This should be called during deployment
 */
export declare function migrateToSupabase(): Promise<boolean | undefined>;
/**
 * Health check for Supabase connection
 */
export declare function healthCheck(): Promise<boolean>;
export declare function getSupabaseClient(): SupabaseClient<any, "public", "public", any, any>;
export {};
//# sourceMappingURL=supabase-adapter.d.ts.map