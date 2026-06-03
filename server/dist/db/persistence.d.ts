export interface PersistenceHandle {
    isSupabase: boolean;
    hydrated: boolean;
    hydrateIfNeeded(): Promise<void>;
    enqueueWrite(job: () => Promise<void>, label?: string): void;
    flush(): Promise<void>;
    /** Await the next drain cycle. Returns true if all queued writes succeeded. */
    flushImmediate(): Promise<{
        ok: boolean;
        queueLength: number;
    }>;
    /** Diagnostics: current queue depth and worker state. */
    stats(): {
        queueLength: number;
        workerBusy: boolean;
        hydrated: boolean;
        isSupabase: boolean;
    };
}
export declare function createPersistence(): PersistenceHandle;
export declare function getPersistence(): PersistenceHandle;
//# sourceMappingURL=persistence.d.ts.map