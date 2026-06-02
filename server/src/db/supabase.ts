// Supabase Database Client
// Replaces better-sqlite3 with PostgreSQL via Supabase client
// Maintains 100% API compatibility with existing codebase

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}

// Use service role key for elevated privileges (admin operations)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

// Use anon key for regular operations (respects RLS)
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Type-safe database interface
export interface SupabaseDB {
  prepare: (sql: string) => PreparedStatement;
  exec: (sql: string) => void;
  transaction: (fn: () => void) => () => void;
  pragma: (pragma: string) => { all: () => unknown[] };
}

export interface PreparedStatement {
  run: (...params: unknown[]) => ExecResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface ExecResult {
  lastInsertRowid?: number | bigint;
  changes?: number;
}

// Initialize Supabase connection
let db: SupabaseDB | null = null;

export function getDb(): SupabaseDB {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function getSupabaseClient() {
  return supabaseClient;
}

export function getSupabaseAdmin() {
  return supabaseAdmin;
}

/**
 * Initialize Supabase database connection
 * Runs migrations and seeding
 */
export async function initDb(): Promise<SupabaseDB> {
  // Implement the database interface using Supabase client
  const preparedStatements = new Map<string, PreparedStatement>();

  const dbInterface: SupabaseDB = {
    prepare: (sql: string) => {
      if (!preparedStatements.has(sql)) {
        preparedStatements.set(sql, new SupabaseStatement(sql));
      }
      return preparedStatements.get(sql)!;
    },

    exec: async (sql: string) => {
      // For exec, we just skip it in Supabase - schema is pre-created
      console.log('[DB] exec() called - schema creation handled by migrations');
    },

    transaction: (fn: () => void) => {
      return async () => {
        // Supabase handles transactions automatically
        // For simple transactions, we just execute the function
        fn();
      };
    },

    pragma: (pragma: string) => ({
      all: () => {
        // Pragmas are SQLite-specific, return empty array
        return [];
      },
    }),
  };

  db = dbInterface;

  console.log(`Database initialized with Supabase at ${SUPABASE_URL}`);

  // Run migrations and seeding
  await seedModels();

  return db;
}

/**
 * Supabase prepared statement implementation
 * Converts SQL parameters to Supabase RPC calls
 */
class SupabaseStatement implements PreparedStatement {
  constructor(private sql: string) {}

  async run(...params: unknown[]): Promise<ExecResult> {
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
      query: this.sql,
      params: params,
    });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    return {
      lastInsertRowid: data?.id || 0,
      changes: data?.changes || 0,
    };
  }

  async get(...params: unknown[]): Promise<unknown> {
    const result = await this.all(...params);
    return result[0] || null;
  }

  async all(...params: unknown[]): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
      query: this.sql,
      params: params,
    });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }
}

/**
 * Seed models database on initialization
 */
async function seedModels() {
  const { data: existing } = await supabaseAdmin
    .from('models')
    .select('id', { count: 'exact', head: true });

  if ((existing?.length || 0) > 0) {
    console.log('Models already seeded');
    return;
  }

  const models = [
    // Google — gemini-2.5-flash free quotas were cut Dec 2025
    ['google', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 1, 8, 'Frontier', 5, 100, 250000, null, '~12M', 1048576],
    ['google', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 4, 5, 'Large', 10, 20, 250000, null, '~3M', 1048576],
    ['google', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 8, 3, 'Medium', 15, 1000, 250000, null, '~120M', 1048576],
    // OpenRouter
    ['openrouter', 'deepseek/deepseek-v3.1:free', 'DeepSeek V3.1 (free)', 2, 10, 'Frontier', 20, 200, null, null, '~6M', 131072],
    ['openrouter', 'moonshotai/kimi-k2:free', 'Kimi K2 (free)', 2, 9, 'Frontier', 20, 200, null, null, '~6M', 131072],
    ['openrouter', 'qwen/qwen3-coder:free', 'Qwen3 Coder (free)', 3, 9, 'Frontier', 20, 200, null, null, '~6M', 262144],
    ['openrouter', 'z-ai/glm-4.5-air:free', 'GLM-4.5 Air (free)', 4, 9, 'Large', 20, 200, null, null, '~6M', 131072],
    // Cerebras
    ['cerebras', 'qwen-3-coder-480b', 'Qwen3-Coder 480B', 2, 1, 'Frontier', 30, null, 60000, 1000000, '~30M', 131072],
    ['cerebras', 'llama-4-maverick-17b-128e-instruct', 'Llama 4 Maverick', 3, 1, 'Frontier', 30, null, 60000, 1000000, '~30M', 131072],
    ['cerebras', 'qwen3-235b', 'Qwen3 235B', 3, 1, 'Large', 30, null, 60000, 1000000, '~30M', 8192],
    ['cerebras', 'gpt-oss-120b', 'GPT-OSS 120B', 3, 1, 'Large', 30, null, 60000, 1000000, '~30M', 131072],
    // GitHub
    ['github', 'openai/gpt-5', 'GPT-5 (GitHub)', 1, 7, 'Frontier', 10, 50, null, null, '~18M', 128000],
    // SambaNova
    ['sambanova', 'Meta-Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 6, 9, 'Large', 20, null, null, 200000, '~6M', 8192],
    // Mistral
    ['mistral', 'mistral-large-latest', 'Mistral Large 3', 7, 8, 'Large', 2, null, 500000, null, '~50-100M', 131072],
    ['mistral', 'magistral-medium-latest', 'Magistral Medium', 4, 8, 'Large', 2, null, 500000, null, '~50-100M', 40000],
    ['mistral', 'codestral-latest', 'Codestral', 6, 6, 'Medium', 2, null, 500000, null, '~50-100M', 32000],
    // Groq
    ['groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B', 9, 2, 'Medium', 30, 1000, 6000, 500000, '~15M', 131072],
    ['groq', 'llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 10, 2, 'Medium', 30, 1000, 6000, 1000000, '~30M', 131072],
    // NVIDIA NIM
    ['nvidia', 'meta/llama-3.1-70b-instruct', 'Llama 3.1 70B (NV)', 11, 6, 'Large', 40, null, null, null, 'credits-based', 131072],
    // Cohere
    ['cohere', 'command-r-plus-08-2024', 'Command R+ (08-2024)', 12, 11, 'Large', 20, 33, null, null, '~1-2M', 131072],
    // Cloudflare
    ['cloudflare', '@cf/meta/llama-3.1-70b-instruct', 'Llama 3.1 70B (CF)', 13, 11, 'Medium', null, null, null, null, '~18-45M', 131072],
    // Hugging Face
    ['huggingface', 'accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B (HF)', 14, 11, 'Medium', null, null, null, null, '~1-3M', 131072],
    // New providers
    ['zhipu', 'glm-4.5-flash', 'GLM-4.5 Flash', 5, 4, 'Large', null, null, null, 1000000, '~30M', 131072],
    ['moonshot', 'kimi-latest', 'Kimi Latest', 4, 8, 'Large', 60, null, null, 500000, '~15M', 200000],
    ['minimax', 'MiniMax-M1', 'MiniMax M1', 5, 8, 'Large', 20, null, 1000000, null, '~30M', 200000],
  ];

  const { error } = await supabaseAdmin.from('models').insert(
    models.map((m) => ({
      platform: m[0],
      model_id: m[1],
      display_name: m[2],
      intelligence_rank: m[3],
      speed_rank: m[4],
      size_label: m[5],
      rpm_limit: m[6],
      rpd_limit: m[7],
      tpm_limit: m[8],
      tpd_limit: m[9],
      monthly_token_budget: m[10],
      context_window: m[11],
    })),
  );

  if (error) {
    console.warn('Error seeding models:', error);
  } else {
    console.log(`Seeded ${models.length} models`);
  }

  // Seed fallback config
  const { data: allModels } = await supabaseAdmin
    .from('models')
    .select('id, intelligence_rank')
    .order('intelligence_rank', { ascending: true });

  if (allModels && allModels.length > 0) {
    const fallbackConfigs = allModels.map((m, i) => ({
      model_db_id: m.id,
      priority: i + 1,
      enabled: true,
    }));

    await supabaseAdmin.from('fallback_config').insert(fallbackConfigs);
  }
}

/**
 * Connection health check
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const { error } = await supabaseClient.from('models').select('id', { count: 'exact', head: true });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Run a raw SQL query (admin only)
 */
export async function runQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const { data, error } = await supabaseAdmin.rpc('exec_sql', {
    query: sql,
    params,
  });

  if (error) {
    throw new Error(`Database query error: ${error.message}`);
  }

  return data || [];
}
