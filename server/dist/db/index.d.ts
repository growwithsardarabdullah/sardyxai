import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
export declare function initDb(dbPath?: string): Database.Database;
/**
 * Async variant of initDb. Database initialization only - persistence via Supabase now.
 * Use this in production entry points (Vercel handler, local server boot).
 * Tests keep using initDb() (sync, no Supabase).
 */
export declare function initDbAsync(dbPath?: string): Promise<Database.Database>;
/** No-op stub for backward compatibility. Supabase writes are now synchronous. */
interface PersistenceHandle {
    enqueueWrite(job: () => Promise<void>, label?: string): void;
    flush(): Promise<void>;
    stats(): {
        queueLength: number;
        workerBusy: boolean;
        hydrated: boolean;
        isSupabase: boolean;
    };
}
export declare function getPersistence(): PersistenceHandle;
export declare function getUnifiedApiKey(userEmail?: string): string;
/** Look up which user_email owns a given unified API key value.
 *  Returns the user's email, '' for the legacy global key, or null if not found.
 */
export declare function getUserForUnifiedKey(apiKey: string): string | null;
export declare function ensureUserUnifiedKey(userEmail: string): string;
export declare function regenerateUnifiedKey(userEmail: string): string;
export declare function getSetting(key: string): string | undefined;
export declare function setSetting(key: string, value: string): void;
export {};
//# sourceMappingURL=index.d.ts.map