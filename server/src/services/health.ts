import { getDb, getPersistence } from '../db/index.js';
import { resolveProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { getSupabaseAdmin } from '../db/supabase.js';
import type { Platform, KeyStatus } from '@freellmapi/shared/types.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

// Track consecutive failures per key
const failureCount = new Map<number, number>();

export async function checkKeyHealth(keyId: number): Promise<KeyStatus> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId) as any;
  if (!row) return 'error';

  const provider = resolveProvider(row.platform as Platform, row.base_url);
  if (!provider) return 'error';

  try {
    const apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
    const isValid = await provider.validateKey(apiKey);

    const status: KeyStatus = isValid ? 'healthy' : 'invalid';

    db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .run(status, keyId);
    mirrorKeyHealthUpdate(row.platform, row.label, status, false);

    if (isValid) {
      failureCount.delete(keyId);
    } else {
      const count = (failureCount.get(keyId) ?? 0) + 1;
      failureCount.set(keyId, count);

      if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
        db.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').run(keyId);
        mirrorKeyHealthUpdate(row.platform, row.label, status, true);
        console.log(`[Health] Auto-disabled key ${keyId} after ${count} consecutive failures`);
      }
    }

    return status;
  } catch (err: any) {
    // Transport errors (DNS/timeout/TLS) — provider unreachable, not necessarily
    // a bad key. Mark status='error' but do NOT increment failure counter — auto-
    // disable is reserved for confirmed 401/403 (returned by validateKey as false).
    console.error(`[Health] Key ${keyId} transport error:`, err.message);
    db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .run('error', keyId);
    mirrorKeyHealthUpdate(row.platform, row.label, 'error', false);
    return 'error';
  }
}

function mirrorKeyHealthUpdate(platform: string, label: string, status: string, disabled: boolean): void {
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const payload: Record<string, unknown> = {
      status,
      last_checked_at: new Date().toISOString(),
    };
    if (disabled) payload.enabled = false;
    const { error } = await sb.from('api_keys').update(payload)
      .eq('platform', platform).eq('label', label);
    if (error) throw new Error(`api_keys health update: ${error.message}`);
  }, `api_keys:health:${platform}`);
}

export async function checkAllKeys(): Promise<void> {
  const db = getDb();
  const keys = db.prepare('SELECT id, platform FROM api_keys WHERE enabled = 1').all() as { id: number; platform: string }[];

  console.log(`[Health] Checking ${keys.length} keys...`);

  for (const key of keys) {
    await checkKeyHealth(key.id);
  }

  console.log(`[Health] Check complete.`);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(): void {
  if (intervalId) return;
  console.log(`[Health] Starting health checker (every ${CHECK_INTERVAL_MS / 1000}s)`);
  intervalId = setInterval(() => {
    checkAllKeys().catch(err => console.error('[Health] Check failed:', err));
  }, CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
