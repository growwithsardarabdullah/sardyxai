/**
 * Development-only fallback authentication
 * Uses SQLite instead of Supabase for local testing
 * NOT FOR PRODUCTION - this is dev/test only
 */

import crypto from 'crypto';
import { getDb } from '../db/index.js';
import type { AuthSession, SessionUser } from './auth-supabase.js';

// Simple in-memory session store for dev
const sessionStore = new Map<string, { userId: string; email: string; expiresAt: number }>();

// Simple in-memory user store for dev
const devUsers = new Map<string, { email: string; password: string; userId: string }>();

/**
 * Hash password for dev (not cryptographically secure, dev only)
 */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Generate a random user ID
 */
function generateUserId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a random session token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface AuthSessionDev extends AuthSession {
  sessionId: string;
}

/**
 * Dev sign up - creates user in memory/SQLite
 */
export async function signUpDev(email: string, password: string): Promise<{ success: boolean; error?: string; userId?: string }> {
  try {
    // Check if user already exists
    if (devUsers.has(email)) {
      return { success: false, error: 'User already exists' };
    }

    const userId = generateUserId();
    const hashedPassword = hashPassword(password);

    // Store in memory
    devUsers.set(email, { email, password: hashedPassword, userId });

    // Also store in SQLite for persistence
    const db = getDb();
    
    // Create dev_users table if needed (stores hashed passwords for dev mode)
    db.exec(`
      CREATE TABLE IF NOT EXISTS dev_users (
        email TEXT PRIMARY KEY,
        password_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    db.prepare(`
      INSERT OR REPLACE INTO dev_users (email, password_hash)
      VALUES (?, ?)
    `).run(email, hashedPassword);

    db.prepare(`
      INSERT INTO profiles (email, user_id)
      VALUES (?, ?)
    `).run(email, userId);

    // Create unified key
    const unifiedKey = generateToken();
    db.prepare(`
      INSERT INTO unified_keys (email, key)
      VALUES (?, ?)
    `).run(email, unifiedKey);

    return { success: true, userId };
  } catch (error) {
    console.error('[auth-dev] Signup error:', error);
    return { success: false, error: 'Signup failed' };
  }
}

/**
 * Dev sign in - authenticates user from memory/SQLite
 */
export async function signInDev(email: string, password: string): Promise<{ success: boolean; error?: string; session?: AuthSessionDev }> {
  try {
    // Check in-memory store first
    let user = devUsers.get(email);
    
    // If not in memory, try to load from database
    if (!user) {
      console.log('[auth-dev] User not in memory, loading from DB...');
      const db = getDb();
      const devUserRow = db.prepare('SELECT du.email, du.password_hash, p.user_id FROM dev_users du JOIN profiles p ON du.email = p.email WHERE du.email = ?').get(email) as any;
      if (!devUserRow) {
        return { success: false, error: 'User not found' };
      }
      // Restore to memory
      user = {
        email: devUserRow.email,
        password: devUserRow.password_hash,
        userId: devUserRow.user_id,
      };
      devUsers.set(email, user);
    }

    const hashedPassword = hashPassword(password);
    if (user.password !== hashedPassword) {
      return { success: false, error: 'Invalid password' };
    }

    // Create session
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const sessionId = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const expiresAtMs = expiresAt.getTime();

    // Store session in memory
    sessionStore.set(accessToken, {
      userId: user.userId,
      email,
      expiresAt: expiresAtMs,
    });

    return {
      success: true,
      session: {
        sessionId,
        user: {
          id: user.userId,
          email,
        },
        accessToken,
        refreshToken,
        expiresIn: 30 * 24 * 60 * 60,
        expiresAt: expiresAtMs,
      },
    };
  } catch (error) {
    console.error('[auth-dev] Sign in error:', error);
    return { success: false, error: 'Sign in failed' };
  }
}

/**
 * Dev load user data - from SQLite
 */
export async function loadUserDataDev(identifier: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const db = getDb();
    
    // identifier can be either email (for dev mode) or userId (shouldn't happen in dev)
    const email = identifier; // In dev mode, we use email as identifier

    // Get profile
    const profile = db.prepare('SELECT * FROM profiles WHERE email = ?').get(email);

    // Get keys
    const keys = db.prepare('SELECT * FROM provider_keys WHERE email = ?').all(email);

    // Get unified key
    const unifiedKeyRow = db.prepare('SELECT key FROM unified_keys WHERE email = ?').get(email) as any;

    // Get settings
    const settings = db.prepare('SELECT key, value FROM user_settings WHERE email = ?').all(email) as any[];
    const settingsMap = Object.fromEntries(
      settings.map(s => [s.key, s.value])
    );

    // Get usage
    const usage = db.prepare('SELECT * FROM usage_logs WHERE email = ? ORDER BY timestamp DESC LIMIT 100').all(email);

    return {
      success: true,
      data: {
        profile: profile || { email },
        providerKeys: keys || [],
        unifiedKey: unifiedKeyRow?.key || null,
        settings: settingsMap,
        usage: usage || [],
      },
    };
  } catch (error) {
    console.error('[auth-dev] Load user data error:', error);
    return {
      success: false,
      data: {
        profile: {},
        providerKeys: [],
        unifiedKey: null,
        settings: {},
        usage: [],
      },
      error: 'Failed to load user data',
    };
  }
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Dev verify access token - simple validation
 */
export async function verifyAccessTokenDev(token: string): Promise<{ valid: boolean; user?: { id: string; email: string }; error?: string }> {
  try {
    // Check if token is in session store and not expired
    const session = sessionStore.get(token);
    if (!session) {
      return { valid: false, error: 'Invalid or expired token' };
    }

    if (session.expiresAt < Date.now()) {
      sessionStore.delete(token);
      return { valid: false, error: 'Token expired' };
    }

    return {
      valid: true,
      user: {
        id: session.userId,
        email: session.email,
      },
    };
  } catch (error) {
    return { valid: false, error: 'Token verification failed' };
  }
}

/**
 * Dev logout - no-op
 */
export async function logoutDev(): Promise<{ success: boolean }> {
  return { success: true };
}

/**
 * Dev request password reset - no-op
 */
export async function requestPasswordResetDev(_email: string): Promise<{ success: boolean }> {
  return { success: true };
}

/**
 * Initialize dev mode - create tables if needed and load users from DB
 */
export function initDevMode() {
  if (isSupabaseConfigured()) {
    console.log('[auth-dev] Supabase configured, using Supabase Auth');
    return;
  }

  console.log('[auth-dev] Using development fallback auth (SQLite)');
  
  const db = getDb();
  
  // Create dev_users table if needed (stores hashed passwords for dev mode)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_users (
      email TEXT PRIMARY KEY,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create profiles table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      email TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create unified_keys table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS unified_keys (
      email TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(email) REFERENCES profiles(email)
    )
  `);

  // Create provider_keys table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      email TEXT,
      provider TEXT,
      encrypted_key TEXT,
      label TEXT,
      base_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(email) REFERENCES profiles(email)
    )
  `);

  // Create user_settings table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      email TEXT,
      key TEXT,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(email, key),
      FOREIGN KEY(email) REFERENCES profiles(email)
    )
  `);

  // Create usage_logs table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      email TEXT,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(email) REFERENCES profiles(email)
    )
  `);

  // Load users from dev_users and profiles tables
  const devUserRows = db.prepare('SELECT du.email, du.password_hash, p.user_id FROM dev_users du JOIN profiles p ON du.email = p.email').all() as any[];
  for (const row of devUserRows) {
    devUsers.set(row.email, {
      email: row.email,
      password: row.password_hash,
      userId: row.user_id,
    });
  }
}
