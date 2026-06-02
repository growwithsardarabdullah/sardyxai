import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
export declare function initDb(dbPath?: string): Database.Database;
export declare function getUnifiedApiKey(): string;
export declare function regenerateUnifiedKey(): string;
export declare function getSetting(key: string): string | undefined;
export declare function setSetting(key: string, value: string): void;
//# sourceMappingURL=index.d.ts.map