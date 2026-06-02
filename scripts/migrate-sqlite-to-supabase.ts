#!/usr/bin/env node
/**
 * Migration script: SQLite -> Supabase PostgreSQL
 * Exports data from local SQLite and imports to Supabase
 * 
 * Usage: NODE_ENV=production node scripts/migrate-sqlite-to-supabase.ts
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'server/data/freeapi.db');

interface MigrationStats {
  tables: Record<string, number>;
  errors: string[];
  warnings: string[];
}

const stats: MigrationStats = {
  tables: {},
  errors: [],
  warnings: [],
};

async function migrate() {
  console.log('🚀 Starting SQLite -> Supabase migration...\n');

  // Validate environment
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`SQLite database not found at ${DB_PATH}`);
  }

  // Initialize clients
  const sqlite = new Database(DB_PATH);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  console.log('📦 Opening SQLite database...');
  console.log(`📍 Path: ${DB_PATH}\n`);

  try {
    // Test Supabase connection
    console.log('🔗 Testing Supabase connection...');
    const { error: connError } = await supabase
      .from('models')
      .select('id', { count: 'exact', head: true });

    if (connError) {
      throw new Error(`Supabase connection failed: ${connError.message}`);
    }
    console.log('✅ Supabase connection successful\n');

    // Migrate each table
    await migrateModels(sqlite, supabase);
    await migrateApiKeys(sqlite, supabase);
    await migrateRequests(sqlite, supabase);
    await migrateRateLimitData(sqlite, supabase);
    await migrateUsers(sqlite, supabase);
    await migrateSessions(sqlite, supabase);
    await migrateSettings(sqlite, supabase);
    await migrateFallbackConfig(sqlite, supabase);

    // Print summary
    printMigrationSummary();

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
  }
}

async function migrateModels(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating models...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM models ORDER BY id')
      .all() as any[];

    if (rows.length === 0) {
      stats.warnings.push('No models found in SQLite');
      return;
    }

    // Batch insert
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('models').upsert(batch);

      if (error) {
        stats.errors.push(`Models batch ${i / batchSize}: ${error.message}`);
      }
    }

    stats.tables.models = rows.length;
    console.log(`  ✓ Migrated ${rows.length} models`);
  } catch (error) {
    stats.errors.push(`Models: ${error.message}`);
    console.log(`  ✗ Failed to migrate models: ${error}`);
  }
}

async function migrateApiKeys(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating API keys...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM api_keys ORDER BY id')
      .all() as any[];

    if (rows.length === 0) {
      console.log('  ℹ No API keys to migrate');
      return;
    }

    // Upsert to handle duplicates
    const { error } = await supabase.from('api_keys').upsert(rows);

    if (error) {
      stats.errors.push(`API Keys: ${error.message}`);
    } else {
      stats.tables.api_keys = rows.length;
      console.log(`  ✓ Migrated ${rows.length} API keys`);
    }
  } catch (error) {
    stats.errors.push(`API Keys: ${error.message}`);
    console.log(`  ✗ Failed to migrate API keys: ${error}`);
  }
}

async function migrateRequests(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating requests...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 10000')
      .all() as any[];

    if (rows.length === 0) {
      console.log('  ℹ No requests to migrate');
      return;
    }

    // Batch insert in reverse order (oldest first)
    const batchSize = 500;
    for (let i = rows.length - 1; i >= 0; i -= batchSize) {
      const start = Math.max(0, i - batchSize + 1);
      const batch = rows.slice(start, i + 1);
      const { error } = await supabase.from('requests').insert(batch);

      if (error) {
        stats.errors.push(`Requests batch: ${error.message}`);
      }
    }

    stats.tables.requests = rows.length;
    console.log(`  ✓ Migrated ${rows.length} requests (last 10k)`);
  } catch (error) {
    stats.errors.push(`Requests: ${error.message}`);
    console.log(`  ✗ Failed to migrate requests: ${error}`);
  }
}

async function migrateRateLimitData(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating rate limit data...');

  try {
    // Rate limit usage
    const usage = sqlite
      .prepare('SELECT * FROM rate_limit_usage WHERE created_at_ms > ? ORDER BY id DESC LIMIT 5000')
      .all(Date.now() - 7 * 24 * 60 * 60 * 1000) as any[];

    if (usage.length > 0) {
      const { error } = await supabase.from('rate_limit_usage').insert(usage);
      if (error) {
        stats.errors.push(`Rate limit usage: ${error.message}`);
      } else {
        stats.tables.rate_limit_usage = usage.length;
        console.log(`  ✓ Migrated ${usage.length} rate limit usage records`);
      }
    }

    // Rate limit cooldowns
    const cooldowns = sqlite
      .prepare('SELECT * FROM rate_limit_cooldowns')
      .all() as any[];

    if (cooldowns.length > 0) {
      const { error } = await supabase.from('rate_limit_cooldowns').insert(cooldowns);
      if (error) {
        stats.errors.push(`Rate limit cooldowns: ${error.message}`);
      } else {
        stats.tables.rate_limit_cooldowns = cooldowns.length;
        console.log(`  ✓ Migrated ${cooldowns.length} cooldowns`);
      }
    }
  } catch (error) {
    stats.errors.push(`Rate limit data: ${error.message}`);
    console.log(`  ✗ Failed to migrate rate limit data: ${error}`);
  }
}

async function migrateUsers(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating users...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM users ORDER BY id')
      .all() as any[];

    if (rows.length === 0) {
      console.log('  ℹ No users to migrate');
      return;
    }

    const { error } = await supabase.from('users').upsert(rows);

    if (error) {
      stats.errors.push(`Users: ${error.message}`);
    } else {
      stats.tables.users = rows.length;
      console.log(`  ✓ Migrated ${rows.length} users`);
    }
  } catch (error) {
    stats.errors.push(`Users: ${error.message}`);
    console.log(`  ✗ Failed to migrate users: ${error}`);
  }
}

async function migrateSessions(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating sessions...');

  try {
    // Only migrate active sessions
    const rows = sqlite
      .prepare('SELECT * FROM sessions WHERE expires_at_ms > ? ORDER BY expires_at_ms DESC')
      .all(Date.now()) as any[];

    if (rows.length === 0) {
      console.log('  ℹ No active sessions to migrate');
      return;
    }

    const { error } = await supabase.from('sessions').insert(rows);

    if (error) {
      stats.errors.push(`Sessions: ${error.message}`);
    } else {
      stats.tables.sessions = rows.length;
      console.log(`  ✓ Migrated ${rows.length} active sessions`);
    }
  } catch (error) {
    stats.errors.push(`Sessions: ${error.message}`);
    console.log(`  ✗ Failed to migrate sessions: ${error}`);
  }
}

async function migrateSettings(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating settings...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM settings ORDER BY key')
      .all() as any[];

    if (rows.length === 0) {
      console.log('  ℹ No settings to migrate');
      return;
    }

    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });

    if (error) {
      stats.errors.push(`Settings: ${error.message}`);
    } else {
      stats.tables.settings = rows.length;
      console.log(`  ✓ Migrated ${rows.length} settings`);
    }
  } catch (error) {
    stats.errors.push(`Settings: ${error.message}`);
    console.log(`  ✗ Failed to migrate settings: ${error}`);
  }
}

async function migrateFallbackConfig(sqlite: Database.Database, supabase: any) {
  console.log('📋 Migrating fallback config...');

  try {
    const rows = sqlite
      .prepare('SELECT * FROM fallback_config ORDER BY priority')
      .all() as any[];

    if (rows.length === 0) {
      console.log('  ℹ No fallback config to migrate');
      return;
    }

    const { error } = await supabase.from('fallback_config').upsert(rows);

    if (error) {
      stats.errors.push(`Fallback config: ${error.message}`);
    } else {
      stats.tables.fallback_config = rows.length;
      console.log(`  ✓ Migrated ${rows.length} fallback configs`);
    }
  } catch (error) {
    stats.errors.push(`Fallback config: ${error.message}`);
    console.log(`  ✗ Failed to migrate fallback config: ${error}`);
  }
}

function printMigrationSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('📊 Migration Summary');
  console.log('='.repeat(50));

  console.log('\n✅ Tables Migrated:');
  for (const [table, count] of Object.entries(stats.tables)) {
    console.log(`  ${table}: ${count} rows`);
  }

  const totalRows = Object.values(stats.tables).reduce((sum, count) => sum + count, 0);
  console.log(`\n  Total: ${totalRows} rows`);

  if (stats.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    stats.warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:');
    stats.errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log('\n' + '='.repeat(50));
  console.log('✨ Migration complete!\n');
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
