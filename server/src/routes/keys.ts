import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb, getPersistence } from '../db/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import { getSupabaseAdmin } from '../db/supabase.js';
import type { SessionUser } from '../services/auth.js';

export const keysRouter = Router();

function getUserEmail(req: Request): string {
  return (req as Request & { user?: SessionUser }).user?.email ?? '';
}

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
// Moonshot and MiniMax direct integrations were dropped in V4. HuggingFace
// was dropped in V4 and re-added in V13 via the router.huggingface.co route.
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'huggingface', 'custom',
] as const;

const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().min(1),
  label: z.string().optional(),
});

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
}).refine(data => data.enabled !== undefined || data.label !== undefined, {
  message: 'At least one of enabled or label must be provided',
});

// List all keys (masked) — scoped to the authenticated user
keysRouter.get('/', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys WHERE user_email = ? ORDER BY created_at DESC').all(email) as any[];
  console.log(`[keys] GET / user=${email} → ${rows.length} key(s) in storage`);

  const keys = rows.map(row => {
    let maskedKey = '****';
    let decryptOk = false;
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
      decryptOk = true;
    } catch (err) {
      maskedKey = '[decrypt failed]';
      console.error(`[keys] DECRYPT FAILED for id=${row.id} platform=${row.platform}: ${(err as Error).message}`);
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      baseUrl: row.base_url ?? null,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
      _decryptOk: decryptOk,
    };
  });

  const failedCount = keys.filter(k => !k._decryptOk).length;
  if (failedCount > 0) {
    console.warn(`[keys] ${failedCount}/${keys.length} key(s) FAILED to decrypt — likely an ENCRYPTION_KEY drift. Re-add these keys.`);
  }
  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, key, label } = parsed.data;

  // Sanity check: try encrypt → decrypt round-trip so we fail fast on a broken
  // encryption key (e.g. ENCRYPTION_KEY changed mid-deployment) rather than
  // letting the user discover it via "API key not valid" from the provider.
  let encrypted: string, iv: string, authTag: string;
  try {
    const enc = encrypt(key);
    encrypted = enc.encrypted; iv = enc.iv; authTag = enc.authTag;
    const roundTrip = decrypt(encrypted, iv, authTag);
    if (roundTrip !== key) {
      throw new Error('Round-trip decrypt produced a different value than the input');
    }
  } catch (err) {
    console.error(`[keys] ENCRYPT round-trip FAILED for platform=${platform}: ${(err as Error).message}`);
    res.status(500).json({ error: { message: 'Failed to encrypt key. Check server ENCRYPTION_KEY configuration.', type: 'encryption_error' } });
    return;
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO api_keys (user_email, platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 1)
  `).run(email, platform, label ?? '', encrypted, iv, authTag);

  const newId = Number(result.lastInsertRowid);
  console.log(`[keys] POST / user=${email} platform=${platform} label='${label ?? ''}' keyLen=${key.length} → id=${newId} (encrypt round-trip OK)`);

  // Mirror to Supabase so the key survives a Vercel cold start.
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) {
      console.error(`[keys] Supabase admin client unavailable — key ${newId} will NOT persist across cold starts`);
      return;
    }
    const { error } = await sb.from('api_keys').insert({
      user_email: email, platform, label: label ?? '', encrypted_key: encrypted, iv, auth_tag: authTag,
      status: 'unknown', enabled: true,
    });
    if (error) {
      console.error(`[keys] Supabase INSERT FAILED for id=${newId} platform=${platform}: ${error.message} (code: ${error.code})`);
      throw new Error(`api_keys insert: ${error.message}`);
    }
    console.log(`[keys] Supabase INSERT OK for id=${newId} platform=${platform} user=${email}`);
  }, `api_keys:insert:${newId}`);

  res.status(201).json({
    id: newId,
    platform,
    label: label ?? '',
    maskedKey: maskKey(key),
    status: 'unknown',
    enabled: true,
  });
});

// ── Custom OpenAI-compatible provider (#117) ──────────────────────────────
// A single user-configured endpoint (llama.cpp / LM Studio / vLLM / Ollama /
// any OpenAI-compatible base_url). The endpoint lives on one 'custom' api_keys
// row; each call registers another model that routes through it.
const customProviderSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  model: z.string().min(1, 'model is required'),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  label: z.string().optional(),
});

keysRouter.post('/custom', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const parsed = customProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const modelId = parsed.data.model.trim();
  const displayName = (parsed.data.displayName ?? modelId).trim();
  // Local servers often need no key; keep a sentinel so there's always a bearer.
  const rawKey = parsed.data.apiKey?.trim() || 'no-key';
  const label = parsed.data.label ?? 'Custom';

  const db = getDb();
  const upsert = db.transaction(() => {
    // One shared 'custom' key holds the endpoint URL per user. Reuse it across
    // models; update its base_url/key when re-submitted.
    const existing = db.prepare("SELECT id FROM api_keys WHERE platform = 'custom' AND user_email = ? LIMIT 1").get(email) as { id: number } | undefined;
    let keyId: number;
    let upsertMode: 'insert' | 'update' = 'insert';
    let encrypted = '';
    let iv = '';
    let authTag = '';
    if (existing) {
      const enc = encrypt(rawKey);
      encrypted = enc.encrypted; iv = enc.iv; authTag = enc.authTag;
      db.prepare("UPDATE api_keys SET base_url = ?, encrypted_key = ?, iv = ?, auth_tag = ?, status = 'unknown', enabled = 1 WHERE id = ?")
        .run(baseUrl, encrypted, iv, authTag, existing.id);
      keyId = existing.id;
      upsertMode = 'update';
    } else {
      const enc = encrypt(rawKey);
      encrypted = enc.encrypted; iv = enc.iv; authTag = enc.authTag;
      const r = db.prepare(`
        INSERT INTO api_keys (user_email, platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
        VALUES (?, 'custom', ?, ?, ?, ?, 'unknown', 1, ?)
      `).run(email, label, encrypted, iv, authTag, baseUrl);
      keyId = Number(r.lastInsertRowid);
    }

    // Register the model (idempotent on platform+model_id). Custom models carry
    // no rate limits and sort last in the intelligence preset (size_label tier).
    db.prepare(`
      INSERT OR IGNORE INTO models
        (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
         rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
      VALUES ('custom', ?, ?, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1)
    `).run(modelId, displayName);

    const modelRow = db.prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = ?").get(modelId) as { id: number };

    // Append to the fallback chain if not already present.
    const inChain = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(modelRow.id);
    let fallbackInserted = false;
    if (!inChain) {
      const max = db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config').get() as { m: number };
      db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(modelRow.id, max.m + 1);
      fallbackInserted = true;
    }

    return { keyId, modelDbId: modelRow.id, upsertMode, encrypted, iv, authTag, fallbackInserted };
  });

  const { keyId, modelDbId, upsertMode, encrypted, iv, authTag, fallbackInserted } = upsert();

  // Mirror custom provider state to Supabase.
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    if (upsertMode === 'insert') {
      const { error } = await sb.from('api_keys').insert({
        user_email: email, platform: 'custom', label, encrypted_key: encrypted, iv, auth_tag: authTag,
        status: 'unknown', enabled: true, base_url: baseUrl,
      });
      if (error) throw new Error(`api_keys insert: ${error.message}`);
    } else {
      const { error } = await sb.from('api_keys')
        .update({
          encrypted_key: encrypted, iv, auth_tag: authTag,
          status: 'unknown', enabled: true, base_url: baseUrl,
        })
        .eq('platform', 'custom')
        .eq('user_email', email)
        .eq('base_url', baseUrl);
      if (error) throw new Error(`api_keys update: ${error.message}`);
    }
  }, `api_keys:custom:${upsertMode}`);

  if (fallbackInserted) {
    // Custom model appended to the chain — mirror to Supabase. The Supabase
    // fallback_config.model_db_id differs from the local one, so we look it
    // up by (platform, model_id) and let the resolver handle the ID remap.
    getPersistence().enqueueWrite(async () => {
      const sb = getSupabaseAdmin();
      if (!sb) return;
      const { data: m } = await sb.from('models')
        .select('id')
        .eq('platform', 'custom')
        .eq('model_id', modelId)
        .single();
      if (!m) return; // mirror wasn't run yet (race); next cold start will reconcile
      const localPriority = (db.prepare('SELECT priority FROM fallback_config WHERE model_db_id = ?').get(modelDbId) as { priority: number }).priority;
      const { error } = await sb.from('fallback_config').upsert(
        { model_db_id: m.id, priority: localPriority, enabled: true },
        { onConflict: 'model_db_id' },
      );
      if (error) throw new Error(`fallback_config upsert: ${error.message}`);
    }, `fallback_config:insert:${modelDbId}`);
  }

  res.status(201).json({
    success: true,
    keyId,
    modelDbId,
    platform: 'custom',
    baseUrl,
    model: modelId,
    displayName,
    maskedKey: maskKey(rawKey),
  });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT platform, label FROM api_keys WHERE id = ? AND user_email = ?').get(id, email) as { platform: string; label: string } | undefined;
  const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_email = ?').run(id, email);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  if (row) {
    getPersistence().enqueueWrite(async () => {
      const sb = getSupabaseAdmin();
      if (!sb) return;
      const { error } = await sb.from('api_keys')
        .delete()
        .eq('platform', row.platform)
        .eq('label', row.label)
        .eq('user_email', email);
      if (error) throw new Error(`api_keys delete: ${error.message}`);
    }, `api_keys:delete:${id}`);
  }

  res.json({ success: true });
});

// Toggle all keys for a platform (scoped to user)
keysRouter.patch('/platform/:platform', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const platform = req.params.platform as string;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({ error: { message: `Invalid platform '${platform}'` } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE platform = ? AND user_email = ?').run(enabled ? 1 : 0, platform, email);

  // Mirror platform-wide enable/disable.
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { error } = await sb.from('api_keys')
      .update({ enabled })
      .eq('platform', platform)
      .eq('user_email', email);
    if (error) throw new Error(`api_keys platform-update: ${error.message}`);
  }, `api_keys:platform:${platform}`);

  res.json({ success: true, enabled, updatedKeys: result.changes });
});

// Update key (toggle enable/disable or edit label) — scoped to user
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const email = getUserEmail(req);
  if (!email) { res.status(401).json({ error: { message: 'Authentication required' } }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const parsed = updateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { enabled, label } = parsed.data;
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }
  if (label !== undefined) {
    updates.push('label = ?');
    values.push(label);
  }

  values.push(id);

  const db = getDb();
  const result = db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ? AND user_email = ?`).run(...values, email);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  // Mirror individual update. Capture (platform, oldLabel) before the update.
  const oldRow = db.prepare('SELECT platform, label FROM api_keys WHERE id = ? AND user_email = ?').get(id, email) as { platform: string; label: string } | undefined;
  if (oldRow) {
    const updatePayload: Record<string, unknown> = {};
    if (enabled !== undefined) updatePayload.enabled = enabled;
    if (label !== undefined) updatePayload.label = label;
    getPersistence().enqueueWrite(async () => {
      const sb = getSupabaseAdmin();
      if (!sb) return;
      const { error } = await sb.from('api_keys')
        .update(updatePayload)
        .eq('platform', oldRow.platform)
        .eq('label', oldRow.label)
        .eq('user_email', email);
      if (error) throw new Error(`api_keys update: ${error.message}`);
    }, `api_keys:update:${id}`);
  }

  const response: Record<string, unknown> = { success: true };
  if (enabled !== undefined) response.enabled = enabled;
  if (label !== undefined) response.label = label;
  res.json(response);
});
