// Persistence layer — Supabase write-through cache.
//
// On startup, if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, hydrate the
// in-memory SQLite with persistent data from Supabase. On every write to a
// persistent table, mirror the write to Supabase asynchronously (fire-and-
// forget with a 5s timeout and a small bounded in-memory queue).
//
// The local SQLite remains the source of truth for routing (sync reads). The
// Supabase mirror is durable across Vercel cold starts, redeploys, and the
// /tmp filesystem reset.
//
// Transient tables (rate_limit_usage, rate_limit_cooldowns) are intentionally
// NOT mirrored — they're sliding-window state that resets on cold start by
// design.
//
// The handle is a no-op (with isSupabase = false) when env vars are missing.
// Tests use this no-op path because they never set SUPABASE_URL.
import { createClient } from '@supabase/supabase-js';
import { getDb } from './index.js';
const SUPABASE_URL = () => process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const WORKER_INTERVAL_MS = 1000;
const JOB_TIMEOUT_MS = 5000;
const MAX_QUEUE_SIZE = 1000;
function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return url;
    }
}
export function createPersistence() {
    const url = SUPABASE_URL();
    const key = SUPABASE_SERVICE_ROLE_KEY();
    const isSupabase = Boolean(url && key);
    if (!isSupabase) {
        console.log('[persistence] No SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set. Running in local-only mode.');
        return {
            isSupabase: false,
            hydrated: true, // no-op: nothing to hydrate
            async hydrateIfNeeded() { },
            enqueueWrite() { },
            async flush() { },
        };
    }
    console.log(`[persistence] Supabase configured: ${hostOf(url)}`);
    const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    let hydrated = false;
    const queue = [];
    let workerBusy = false;
    let workerInterval = null;
    const handle = {
        isSupabase: true,
        get hydrated() { return hydrated; },
        async hydrateIfNeeded() {
            if (hydrated)
                return;
            hydrated = true; // mark first so concurrent calls don't repeat
            try {
                await hydrateFromSupabase(supabase);
                // Start the worker after hydration so we don't race with hydrate jobs.
                if (!workerInterval) {
                    workerInterval = setInterval(() => { drain().catch(() => { }); }, WORKER_INTERVAL_MS);
                    // Don't keep the process alive just for the queue drainer.
                    if (typeof workerInterval === 'object' && workerInterval && 'unref' in workerInterval) {
                        workerInterval.unref();
                    }
                }
            }
            catch (err) {
                hydrated = false; // allow retry on next call
                console.error(`[persistence] Supabase unreachable: ${err.message}. Continuing in offline mode.`);
            }
        },
        enqueueWrite(job, label = 'job') {
            if (queue.length >= MAX_QUEUE_SIZE) {
                const dropped = queue.shift();
                console.warn(`[persistence] Queue full (${MAX_QUEUE_SIZE}); dropping oldest job: ${dropped?.label}`);
            }
            const wasEmpty = queue.length === 0;
            queue.push({ fn: job, label });
            if (wasEmpty) {
                console.log(`[persistence] Write queue: 0 → ${queue.length}`);
            }
            else {
                console.log(`[persistence] Write queue: ${queue.length - 1} → ${queue.length} (${label})`);
            }
        },
        async flush() {
            // Drain the queue synchronously (used by tests/shutdown).
            while (queue.length > 0) {
                await drain();
            }
        },
    };
    async function drain() {
        if (workerBusy)
            return;
        if (queue.length === 0)
            return;
        workerBusy = true;
        const startMs = Date.now();
        const total = queue.length;
        let ok = 0;
        let failed = 0;
        const failedLabels = [];
        try {
            while (queue.length > 0) {
                const job = queue.shift();
                try {
                    await Promise.race([
                        job.fn(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
                    ]);
                    ok++;
                }
                catch (err) {
                    failed++;
                    if (failedLabels.length < 5)
                        failedLabels.push(job.label);
                    console.error(`[persistence] Write FAILED (${job.label}): ${err.message}`);
                }
            }
            const elapsed = Date.now() - startMs;
            if (failed > 0) {
                console.error(`[persistence] BATCH: ${ok}/${total} succeeded, ${failed}/${total} FAILED in ${elapsed}ms — data NOT persisted to Supabase`);
                console.error(`[persistence] Failed jobs: ${failedLabels.join(', ')}${failed > 5 ? ` ... and ${failed - 5} more` : ''}`);
                console.error(`[persistence] CHECK: Is SUPABASE_SERVICE_ROLE_KEY set? RLS requires service_role for ALL writes.`);
            }
            else {
                console.log(`[persistence] Wrote ${ok}/${total} to Supabase in ${elapsed}ms`);
            }
        }
        finally {
            workerBusy = false;
        }
    }
    return handle;
}
async function hydrateFromSupabase(supabase) {
    console.log('[persistence] Hydrating from Supabase...');
    const db = getDb();
    // Read all persistent tables. We use the .range() pagination pattern only if
    // a single response exceeds 1000 rows; the catalog is <200 rows and the
    // per-user data is tiny, so a single select is fine.
    const [usersRes, keysRes, modelsRes, fallbackRes, settingsRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('api_keys').select('*'),
        supabase.from('models').select('*'),
        supabase.from('fallback_config').select('*, models(platform, model_id)'),
        supabase.from('settings').select('*'),
    ]);
    const users = (usersRes.data ?? []);
    const keys = (keysRes.data ?? []);
    const models = (modelsRes.data ?? []);
    const fallback = (fallbackRes.data ?? []);
    const settings = (settingsRes.data ?? []);
    if (usersRes.error) {
        console.error(`[persistence] users SELECT failed: ${usersRes.error.message} (code: ${usersRes.error.code})`);
        console.error(`[persistence] This usually means SUPABASE_SERVICE_ROLE_KEY is wrong or RLS is blocking the query`);
    }
    if (keysRes.error) {
        console.error(`[persistence] api_keys SELECT failed: ${keysRes.error.message} (code: ${keysRes.error.code})`);
    }
    if (modelsRes.error) {
        console.error(`[persistence] models SELECT failed: ${modelsRes.error.message} (code: ${modelsRes.error.code})`);
    }
    if (fallbackRes.error) {
        console.error(`[persistence] fallback_config SELECT failed: ${fallbackRes.error.message} (code: ${fallbackRes.error.code})`);
    }
    if (settingsRes.error) {
        console.error(`[persistence] settings SELECT failed: ${settingsRes.error.message} (code: ${settingsRes.error.code})`);
    }
    console.log(`[persistence] Supabase returned: ${users.length} users, ${keys.length} api_keys, ${models.length} models, ${fallback.length} fallback, ${settings.length} settings`);
    // 1) Models first (fallback_config references them).
    //    Use INSERT OR IGNORE — the local seed already populated the catalog,
    //    and UNIQUE(platform, model_id) makes this safe. Custom models added by
    //    the user (e.g. /api/keys/custom) get inserted here.
    const insertModel = db.prepare(`
    INSERT OR IGNORE INTO models
      (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
       rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
       enabled, supports_vision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const localModelIdByKey = new Map();
    for (const m of models) {
        insertModel.run(m.platform, m.model_id, m.display_name, m.intelligence_rank, m.speed_rank, m.size_label ?? '', m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit, m.monthly_token_budget ?? '', m.context_window, truthyToInt(m.enabled), truthyToInt(m.supports_vision));
        const local = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?').get(m.platform, m.model_id);
        if (local)
            localModelIdByKey.set(`${m.platform}::${m.model_id}`, local.id);
    }
    // 2) Users. Email is the stable key — re-hydrating doesn't blow away anyone.
    //    On cold start, local session_version is 0. We need to sync from Supabase
    //    so that logout invalidation works across cold starts. Use UPSERT to
    //    update session_version if the user already exists locally.
    const upsertUser = db.prepare(`
    INSERT INTO users (email, password_hash, session_version) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      session_version = MAX(COALESCE(users.session_version, 0), COALESCE(excluded.session_version, 0))
  `);
    for (const u of users) {
        upsertUser.run(u.email, u.password_hash, u.session_version ?? 0);
    }
    // 3) API keys. The local table has no UNIQUE on (platform, label) — SQLite
    //    uses rowid. Insert blindly; if a key with the same platform+label exists
    //    already, the user will see it twice until dedup is added. Acceptable for
    //    v1: in practice the local DB is empty on cold start, so this just adds
    //    the rows.
    const insertKey = db.prepare(`
    INSERT INTO api_keys
      (user_email, platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    for (const k of keys) {
        insertKey.run(k.user_email ?? '', k.platform, k.label ?? '', k.encrypted_key, k.iv, k.auth_tag, k.status ?? 'unknown', truthyToInt(k.enabled), k.base_url);
    }
    // 4) Fallback config. The Supabase model_db_id differs from the local one,
    //    so we resolve each row by (platform, model_id) join → local id.
    const insertFallback = db.prepare(`
    INSERT OR IGNORE INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, ?)
  `);
    let fallbackInserted = 0;
    for (const f of fallback) {
        const mm = f.models;
        if (!mm)
            continue;
        const localId = localModelIdByKey.get(`${mm.platform}::${mm.model_id}`);
        if (!localId) {
            console.warn(`[persistence] fallback row points to unknown model ${mm.platform}/${mm.model_id}; skipping`);
            continue;
        }
        insertFallback.run(localId, f.priority, truthyToInt(f.enabled));
        fallbackInserted++;
    }
    // 5) Settings — UPSERT so re-hydration overwrites with the durable value.
    const insertSetting = db.prepare(`
    INSERT INTO settings (key, user_email, value) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, user_email = excluded.user_email
  `);
    for (const s of settings) {
        insertSetting.run(s.key, s.user_email ?? '', s.value);
    }
    console.log(`[persistence] Hydrated ${users.length} users, ${keys.length} api_keys, ` +
        `${models.length} models, ${fallbackInserted} fallback_config, ${settings.length} settings`);
}
function truthyToInt(v) {
    if (v === true)
        return 1;
    if (v === false || v == null)
        return 0;
    return v ? 1 : 0;
}
// ============================================================================
// Module-level singleton
// ============================================================================
let _persistence = null;
export function getPersistence() {
    if (!_persistence) {
        _persistence = createPersistence();
    }
    return _persistence;
}
//# sourceMappingURL=persistence.js.map