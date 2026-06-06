import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth } from './auth-supabase.js';
import { encrypt } from '../lib/crypto.js';
export const keysRouter = Router();
// All routes require dashboard authentication
keysRouter.use(requireAuth);
const PLATFORMS = [
    'openai', 'anthropic', 'google', 'groq', 'mistral', 'cohere',
    'openrouter', 'cerebras', 'sambanova', 'github', 'nvidia',
    'cloudflare', 'huggingface', 'zhipu', 'moonshot', 'minimax', 'custom',
];
function encryptKey(key) {
    return encrypt(key);
}
function maskKey(platform, id) {
    return `${platform.toUpperCase().slice(0, 3)}...${id}`;
}
// ─── GET /api/keys ────────────────────────────────────────────────────────────
keysRouter.get('/', (_req, res) => {
    const db = getDb();
    const keys = db.prepare(`
    SELECT id, platform, label, status, enabled, created_at, last_checked_at, base_url
    FROM api_keys
    ORDER BY created_at DESC
  `).all();
    res.json(keys.map(k => ({
        id: k.id,
        platform: k.platform,
        label: k.label ?? '',
        status: k.status,
        enabled: k.enabled === 1,
        createdAt: k.created_at,
        lastCheckedAt: k.last_checked_at,
        maskedKey: maskKey(k.platform, k.id),
        baseUrl: k.base_url ?? undefined,
    })));
});
// ─── POST /api/keys ───────────────────────────────────────────────────────────
const createKeySchema = z.object({
    platform: z.string().min(1),
    key: z.string().min(1),
    label: z.string().optional().default(''),
    baseUrl: z.string().url().optional(),
});
keysRouter.post('/', (req, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: { message: parsed.error.errors.map(e => e.message).join(', ') },
        });
    }
    const { platform, key, label, baseUrl } = parsed.data;
    if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: { message: `Invalid platform: ${platform}` } });
    }
    const db = getDb();
    let enc;
    try {
        enc = encryptKey(key);
    }
    catch {
        return res.status(500).json({ error: { message: 'Failed to encrypt key' } });
    }
    const result = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, base_url, status)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown')
  `).run(platform, label, enc.encrypted, enc.iv, enc.authTag, baseUrl ?? null);
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
        id: row.id,
        platform: row.platform,
        label: row.label ?? '',
        status: row.status,
        enabled: row.enabled === 1,
        maskedKey: maskKey(row.platform, row.id),
        createdAt: row.created_at,
    });
});
// ─── POST /api/keys/custom ────────────────────────────────────────────────────
const customKeySchema = z.object({
    baseUrl: z.string().url({ message: 'baseUrl must be a valid URL' }),
    model: z.string().min(1, { message: 'model is required' }),
    displayName: z.string().optional(),
    key: z.string().optional().default('custom'), // local endpoints don't need a real key
});
keysRouter.post('/custom', (req, res) => {
    const parsed = customKeySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: { message: parsed.error.errors.map(e => e.message).join(', ') },
        });
    }
    const { baseUrl: rawUrl, model, displayName, key } = parsed.data;
    // Normalise: strip trailing slash
    const baseUrl = rawUrl.replace(/\/+$/, '');
    const db = getDb();
    // Upsert the custom api_keys row (one row per baseUrl)
    let keyRow = db.prepare("SELECT * FROM api_keys WHERE platform = 'custom' AND base_url = ?").get(baseUrl);
    if (!keyRow) {
        let enc;
        try {
            enc = encryptKey(key);
        }
        catch {
            return res.status(500).json({ error: { message: 'Failed to encrypt key' } });
        }
        const result = db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, base_url, status)
      VALUES ('custom', ?, ?, ?, ?, ?, 'unknown')
    `).run(baseUrl, enc.encrypted, enc.iv, enc.authTag, baseUrl);
        keyRow = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(result.lastInsertRowid);
    }
    // Upsert the custom model row
    db.prepare(`
    INSERT OR IGNORE INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget)
    VALUES ('custom', ?, ?, 5, 5, 'Custom', 'N/A')
  `).run(model, displayName ?? model);
    const modelRow = db.prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = ?").get(model);
    // Ensure fallback_config entry
    const existing = db.prepare('SELECT id FROM fallback_config WHERE model_db_id = ?').get(modelRow.id);
    if (!existing) {
        const maxPriority = db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get().mx;
        db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(modelRow.id, maxPriority + 1);
    }
    return res.status(201).json({
        platform: 'custom',
        baseUrl,
        model,
        keyId: keyRow.id,
        maskedKey: maskKey('custom', keyRow.id),
    });
});
// ─── PATCH /api/keys/:id ──────────────────────────────────────────────────────
const patchKeySchema = z.object({
    label: z.string().optional(),
    enabled: z.boolean().optional(),
}).refine(d => d.label !== undefined || d.enabled !== undefined, {
    message: 'At least one of label or enabled must be provided',
});
keysRouter.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const parsed = patchKeySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: { message: parsed.error.errors.map(e => e.message).join(', ') },
        });
    }
    const db = getDb();
    const existing = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: { message: 'Key not found' } });
    }
    const { label, enabled } = parsed.data;
    const newLabel = label !== undefined ? label : existing.label;
    const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
    db.prepare('UPDATE api_keys SET label = ?, enabled = ? WHERE id = ?').run(newLabel, newEnabled, id);
    return res.json({
        success: true,
        id,
        label: newLabel,
        enabled: newEnabled === 1,
    });
});
// ─── DELETE /api/keys/:id ─────────────────────────────────────────────────────
keysRouter.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: { message: 'Key not found' } });
    }
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return res.json({ success: true });
});
//# sourceMappingURL=keys.js.map