import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb, getPersistence } from '../db/index.js';
import { getAllPenalties, getRoutingScores, getRoutingStrategy, setRoutingStrategy } from '../services/router.js';
import { BANDIT_PRESETS, type RoutingStrategy } from '../services/scoring.js';
import { parseBudget } from '../lib/budget.js';
import { getSupabaseAdmin } from '../db/supabase.js';

export const fallbackRouter = Router();

// ── Bandit routing strategy ─────────────────────────────────────────────────
// GET  /routing → active strategy, preset weights, and the per-model score
//                 breakdown (reliability / speed / intelligence + guardrails).
fallbackRouter.get('/routing', (_req: Request, res: Response) => {
  res.json(getRoutingScores());
});

const routingSchema = z.object({
  strategy: z.enum(['priority', 'balanced', 'smartest', 'fastest', 'reliable']),
});

// PUT /routing → switch strategy. Presets are just weight vectors over the three
// axes; 'priority' falls back to the legacy manual chain order.
fallbackRouter.put('/routing', (req: Request, res: Response) => {
  const parsed = routingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  setRoutingStrategy(parsed.data.strategy as RoutingStrategy);
  res.json({ strategy: getRoutingStrategy(), presets: BANDIT_PRESETS });
});

// Get fallback chain (with dynamic penalties)
fallbackRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.speed_rank, m.size_label, m.rpm_limit, m.rpd_limit,
           m.monthly_token_budget, m.supports_vision
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    ORDER BY fc.priority ASC
  `).all() as any[];

  // Count enabled keys per platform
  const keyCounts = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM api_keys WHERE enabled = 1
    GROUP BY platform
  `).all() as { platform: string; count: number }[];
  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  // Get current dynamic penalties
  const penalties = getAllPenalties();
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

  res.json(rows.map(r => {
    const penalty = penaltyMap.get(r.model_db_id);
    return {
      modelDbId: r.model_db_id,
      priority: r.priority,
      effectivePriority: r.priority + (penalty?.penalty ?? 0),
      penalty: penalty?.penalty ?? 0,
      rateLimitHits: penalty?.count ?? 0,
      enabled: r.enabled === 1,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      intelligenceRank: r.intelligence_rank,
      speedRank: r.speed_rank,
      sizeLabel: r.size_label,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      monthlyTokenBudget: r.monthly_token_budget,
      supportsVision: r.supports_vision === 1,
      keyCount: keyCountMap.get(r.platform) ?? 0,
    };
  }));
});

const updateSchema = z.array(z.object({
  modelDbId: z.number(),
  priority: z.number(),
  enabled: z.boolean(),
}));

// Update fallback chain (full replace)
fallbackRouter.put('/', (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const db = getDb();
  const update = db.prepare(`
    UPDATE fallback_config SET priority = ?, enabled = ? WHERE model_db_id = ?
  `);

  // Snapshot the affected (model_db_id → platform+model_id) map BEFORE the
  // update so we can resolve them on the Supabase side.
  const modelKeys = parsed.data.map(e => {
    const row = db.prepare('SELECT platform, model_id FROM models WHERE id = ?').get(e.modelDbId) as { platform: string; model_id: string } | undefined;
    return row ? { ...e, platform: row.platform, modelId: row.model_id } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const updateAll = db.transaction(() => {
    for (const entry of parsed.data) {
      update.run(entry.priority, entry.enabled ? 1 : 0, entry.modelDbId);
    }
  });
  updateAll();

  // Mirror to Supabase. Each (platform, model_id) gets its own row update.
  // Best-effort: if any individual update fails, the worker logs and moves on.
  for (const entry of modelKeys) {
    getPersistence().enqueueWrite(async () => {
      const sb = getSupabaseAdmin();
      if (!sb) return;
      const { data: m } = await sb.from('models')
        .select('id')
        .eq('platform', entry.platform)
        .eq('model_id', entry.modelId)
        .single();
      if (!m) return; // model not in mirror yet; cold-start will reconcile
      const { error } = await sb.from('fallback_config')
        .update({ priority: entry.priority, enabled: entry.enabled })
        .eq('model_db_id', m.id);
      if (error) throw new Error(`fallback_config update: ${error.message}`);
    }, `fallback_config:update:${entry.modelDbId}`);
  }

  res.json({ success: true });
});

// `intelligence_rank` is scoped to each provider's own catalog — a provider's
// #1 model is not globally #1 (see issue #135: MiniMax's top model outranking
// Gemini Pro because both read "Intel #1"). `size_label` IS a cross-provider
// capability tier, so normalize on it first and use intelligence_rank only as
// an in-tier tiebreaker. Unknown labels sort last.
const INTELLIGENCE_TIER =
  "CASE m.size_label WHEN 'Frontier' THEN 1 WHEN 'Large' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Small' THEN 4 ELSE 5 END";

// Sort presets — `orderBy` is selected from a fixed whitelist, never from
// user input directly, so the interpolation below is safe.
const SORT_PRESETS: Record<string, string> = {
  intelligence: `${INTELLIGENCE_TIER} ASC, m.intelligence_rank ASC`,
  speed: 'm.speed_rank ASC',
  budget: "CASE m.monthly_token_budget WHEN '~120M' THEN 1 WHEN '~50-100M' THEN 2 WHEN '~30M' THEN 3 WHEN '~18-45M' THEN 4 WHEN '~18M' THEN 5 WHEN '~15M' THEN 6 WHEN '~12M' THEN 7 WHEN '~6M' THEN 8 WHEN '~5-10M' THEN 9 WHEN '~4M' THEN 10 ELSE 11 END ASC",
};

fallbackRouter.post('/sort/:preset', (req: Request, res: Response) => {
  const preset = String(req.params.preset);
  const orderBy = SORT_PRESETS[preset];
  if (!orderBy) {
    res.status(400).json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } });
    return;
  }

  const db = getDb();
  const models = db.prepare(`SELECT m.id, m.platform, m.model_id FROM models m ORDER BY ${orderBy}`).all() as { id: number; platform: string; model_id: string }[];

  const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
  const reorder = db.transaction(() => {
    for (let i = 0; i < models.length; i++) {
      update.run(i + 1, models[i].id);
    }
  });
  reorder();

  // Mirror the full reorder. One job for the whole batch — the worker keeps
  // the queue tight on bulk operations like a sort preset.
  const sorted = models.map((m, i) => ({ platform: m.platform, modelId: m.model_id, priority: i + 1 }));
  getPersistence().enqueueWrite(async () => {
    const sb = getSupabaseAdmin();
    if (!sb) return;
    // Fetch all Supabase model ids in one query for the affected platforms.
    const platforms = [...new Set(sorted.map(s => s.platform))];
    const { data: sbModels, error: mErr } = await sb.from('models')
      .select('id, platform, model_id')
      .in('platform', platforms);
    if (mErr) throw new Error(`models list: ${mErr.message}`);
    const idMap = new Map<string, number>();
    for (const m of sbModels ?? []) {
      idMap.set(`${m.platform}::${m.model_id}`, m.id);
    }
    for (const entry of sorted) {
      const supabaseId = idMap.get(`${entry.platform}::${entry.modelId}`);
      if (!supabaseId) continue;
      const { error } = await sb.from('fallback_config')
        .update({ priority: entry.priority })
        .eq('model_db_id', supabaseId);
      if (error) throw new Error(`fallback_config reorder: ${error.message}`);
    }
  }, `fallback_config:reorder:${preset}`);

  res.json({ success: true, preset });
});

// Token usage per model for the stacked bar
fallbackRouter.get('/token-usage', (_req: Request, res: Response) => {
  const db = getDb();

  // Get platforms that have enabled keys
  const platforms = db.prepare(`
    SELECT DISTINCT ak.platform
    FROM api_keys ak
    WHERE ak.enabled = 1
  `).all() as { platform: string }[];
  const platformSet = new Set(platforms.map(p => p.platform));

  // Get monthly budget per model, ordered by fallback priority
  const models = db.prepare(`
    SELECT m.platform, m.model_id, m.display_name, m.monthly_token_budget,
           fc.priority
    FROM models m
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE m.enabled = 1
    ORDER BY fc.priority ASC
  `).all() as { platform: string; model_id: string; display_name: string; monthly_token_budget: string; priority: number }[];

  // Build per-model breakdown (only platforms with keys)
  const modelBudgets = models
    .filter(m => platformSet.has(m.platform))
    .map(m => ({
      displayName: m.display_name,
      platform: m.platform,
      budget: parseBudget(m.monthly_token_budget),
    }));

  const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

  // Tokens used this month
  const usage = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_used
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
  `).get() as { total_used: number };

  res.json({
    totalBudget,
    totalUsed: usage.total_used,
    models: modelBudgets,
  });
});
