import Database from 'better-sqlite3';
import { type PersistenceHandle } from './persistence.js';
export declare function getDb(): Database.Database;
export declare function initDb(dbPath?: string): Database.Database;
/**
 * Async variant of initDb. After opening the in-memory SQLite and running all
 * seed/migration code, awaits Supabase hydration if credentials are configured.
 * Use this in production entry points (Vercel handler, local server boot).
 * Tests keep using initDb() (sync, no Supabase) so the test env stays offline.
 */
export declare function initDbAsync(dbPath?: string): Promise<Database.Database>;
/** Accessor for the write-through persistence handle. Lazy-inits on first call. */
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
//# sourceMappingURL=index.d.ts.map