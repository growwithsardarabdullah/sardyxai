export interface PersistenceHandle {
    isSupabase: boolean;
    hydrated: boolean;
    hydrateIfNeeded(): Promise<void>;
    enqueueWrite(job: () => Promise<void>, label?: string): void;
    flush(): Promise<void>;
}
export declare function createPersistence(): PersistenceHandle;
export declare function getPersistence(): PersistenceHandle;
//# sourceMappingURL=persistence.d.ts.map