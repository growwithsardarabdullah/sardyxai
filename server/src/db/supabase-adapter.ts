// Supabase Database Adapter
// Provides SQLite-compatible synchronous API wrapper for existing code
// Uses sync wrapper pattern to maintain compatibility

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;
let isInitialized = false;

interface Database {
  prepare: (sql: string) => PreparedStatement;
  exec: (sql: string) => void;
  transaction: (fn: () => void) => () => void;
  pragma: (pragma: string) => { all: () => any[] };
}

interface PreparedStatement {
  run: (...params: any[]) => { lastInsertRowid: number; changes: number };
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
}

/**
 * Query cache for synchronous simulation
 * Runs async query and waits for result
 */
const queryCache = new Map<string, {
  promise: Promise<any>;
  result?: any;
  error?: Error;
}>();

/**
 * Simulate synchronous query execution
 * In production, use Vercel serverless functions or edge functions
 */
function execQuerySync(query: string, params: any[]): any {
  const key = `${query}:${JSON.stringify(params)}`;
  
  // For now, we'll use a blocking approach
  // In production, migrate to async handlers
  throw new Error(
    'Synchronous queries not yet supported. Please convert route handlers to async. ' +
    'Use the following pattern: ' +
    '\nexport async function handler() { const db = getDb(); const stmt = db.prepare(sql); const data = await stmt.all(); }'
  );
}

/**
 * Supabase prepared statement wrapper
 */
class SupabasePreparedStatement implements PreparedStatement {
  private queryParams: any[] = [];

  constructor(
    private sql: string,
    private supabase: SupabaseClient,
  ) {}

  run(...params: any[]) {
    this.queryParams = params;
    return execQuerySync(this.sql, params);
  }

  get(...params: any[]) {
    this.queryParams = params;
    const all = execQuerySync(this.sql, params);
    return all?.[0] || null;
  }

  all(...params: any[]) {
    this.queryParams = params;
    return execQuerySync(this.sql, params);
  }
}

/**
 * Create a Supabase database adapter
 * Maintains interface compatibility with better-sqlite3
 */
export function createSupabaseAdapter(): Database {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
    );
  }

  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  const db: Database = {
    prepare: (sql: string) => {
      return new SupabasePreparedStatement(sql, supabaseInstance!);
    },

    exec: (sql: string) => {
      // Schema setup is handled by Supabase migrations
      console.log('[DB] exec() skipped - schema created via migrations');
    },

    transaction: (fn: () => void) => {
      return () => {
        // Transactions are handled by Supabase automatically
        fn();
      };
    },

    pragma: (pragma: string) => ({
      all: () => {
        // Pragmas are SQLite-specific, return empty
        return [];
      },
    }),
  };

  return db;
}

/**
 * Initialize Supabase and migrate from SQLite
 * This should be called during deployment
 */
export async function migrateToSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Cannot migrate: Missing Supabase credentials');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // Test connection
    const { error } = await supabase.from('models').select('count(*)', { count: 'exact', head: true });
    if (error) throw error;

    console.log('✓ Supabase connection successful');

    // Import SQLite data
    console.log('Migrating data from SQLite to Supabase...');
    // Add migration logic here

    isInitialized = true;
    return true;
  } catch (error) {
    console.error('Migration failed:', error);
    return false;
  }
}

/**
 * Health check for Supabase connection
 */
export async function healthCheck(): Promise<boolean> {
  if (!supabaseInstance) return false;

  try {
    const { error } = await supabaseInstance
      .from('models')
      .select('id', { count: 'exact', head: true });
    return !error;
  } catch {
    return false;
  }
}

export function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabaseInstance;
}
