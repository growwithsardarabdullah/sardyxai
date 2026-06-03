import Database from 'better-sqlite3';
/**
 * Initialize encryption key from env or an explicit local-dev fallback.
 * Must be called after DB is initialized.
 *
 * Resolution order:
 *   1. ENCRYPTION_KEY env var (recommended for production)
 *   2. Vercel deployment metadata (stable per deployment on Vercel)
 *   3. DB-stored key (dev/single-process only; lost on Vercel cold start)
 *   4. Generate and persist to DB (dev only)
 */
export declare function initEncryptionKey(db: Database.Database): void;
export declare function encrypt(text: string): {
    encrypted: string;
    iv: string;
    authTag: string;
};
export declare function decrypt(encrypted: string, iv: string, authTag: string): string;
export declare function maskKey(key: string): string;
//# sourceMappingURL=crypto.d.ts.map