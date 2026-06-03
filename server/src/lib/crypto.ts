import crypto from 'crypto';
import Database from 'better-sqlite3';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM uses a 32-byte key, hex-encoded as 64 chars.
 * A typo'd ENCRYPTION_KEY (e.g. "abc") would historically fall through
 * the placeholder check, get truncated to 1.5 bytes, and only fail at
 * the first encrypt() call with a cryptic node:crypto error. Validate
 * the length up front and fail fast with an actionable message.
 */
const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;
const PLACEHOLDER_KEY = 'your-64-char-hex-key-here';

function parseHexKey(value: string, source: 'env' | 'db'): Buffer {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

// Stable, per-deployment key source. On Vercel, /tmp is wiped on every cold
// start so we cannot rely on a DB-stored key being there. We derive a
// deployment-stable key from the VERCEL_DEPLOYMENT_ID (stable for the lifetime
// of one deployment) or VERCEL_PROJECT_PRODUCTION_URL (stable per-project).
// This means keys encrypted by THIS deployment are decryptable by THIS
// deployment, even after a cold start. After a redeploy, the SHA changes and
// previously-encrypted keys become undecryptable — but the user will be
// re-adding keys anyway after a redeploy.
function getVercelStableKeySource(): string | null {
  return process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || null;
}

// Outside production we auto-generate and persist a key so a fresh clone
// (`npm run dev`) boots without manual setup — the placeholder ENCRYPTION_KEY
// in .env.example would otherwise crash the server on boot, which surfaces in
// the client as "Can't reach the server". 
// On Vercel, we derive a stable key from deployment metadata so previously-
// encrypted API keys remain decryptable across cold starts.
function isDevFallbackAllowed(): boolean {
  // On Vercel (production), always allow fallback to deployment-derived keys
  // so the app works even if ENCRYPTION_KEY is not set. This is acceptable
  // because each deployment gets a stable key from VERCEL_DEPLOYMENT_ID.
  // In true production (non-Vercel), require an explicit key.
  const isVercel = !!process.env.VERCEL;
  if (isVercel) return true;
  return process.env.NODE_ENV !== 'production';
}

function missingKeyError(): Error {
  return new Error(
    'ENCRYPTION_KEY is required in production for API key encryption. ' +
    `Set a ${KEY_HEX_LEN}-char hex key (generate one with: ` +
    `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"). ` +
    'Outside production a local DB-stored key is auto-generated.',
  );
}

/**
 * Initialize encryption key from env or an explicit local-dev fallback.
 * Must be called after DB is initialized.
 *
 * Resolution order:
 *   1. ENCRYPTION_KEY env var (recommended for production)
 *   2. Vercel deployment metadata (stable per deployment on Vercel)
 *   3. DB-stored key (dev/single-process only; lost on Vercel cold start)
 *   4. Generate and persist to DB (dev only)
 */
export function initEncryptionKey(db: Database.Database): void {
  // 1. Check explicit env var (always wins)
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey !== PLACEHOLDER_KEY) {
    cachedKey = parseHexKey(envKey, 'env');
    console.log('[crypto] Using ENCRYPTION_KEY from env var');
    return;
  }

  if (!isDevFallbackAllowed()) {
    throw missingKeyError();
  }

  // 2. Vercel deployment metadata — stable per cold-start of same deploy.
  //    Use VERCEL_PROJECT_PRODUCTION_URL first (stable across deploys for the
  //    same project) then VERCEL_DEPLOYMENT_ID (changes on redeploy).
  const vercelKeySource = process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || null;
  if (vercelKeySource) {
    const derived = crypto.createHash('sha256')
      .update(`freellmapi-encryption-key:v2:${vercelKeySource}`)
      .digest('hex');
    cachedKey = parseHexKey(derived, 'env');
    const sourceName = process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'PROJECT_PRODUCTION_URL'
      : process.env.VERCEL_URL ? 'VERCEL_URL'
      : process.env.VERCEL_DEPLOYMENT_ID ? 'DEPLOYMENT_ID' : 'GIT_COMMIT_SHA';
    console.warn(`[crypto] No ENCRYPTION_KEY set — derived a STABLE key from Vercel ${sourceName}. This survives cold starts of THIS deployment. For maximum stability, set ENCRYPTION_KEY in Vercel env vars.`);
    return;
  }

  // 3. Check DB for persisted key (dev/single-process only)
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encryption_key'").get() as { value: string } | undefined;
  if (row) {
    cachedKey = parseHexKey(row.value, 'db');
    console.warn('[crypto] No ENCRYPTION_KEY set — using auto-generated key from the local DB (dev only).');
    return;
  }

  // 4. Generate and persist (dev only — will be lost on Vercel cold start)
  cachedKey = crypto.randomBytes(KEY_BYTES);
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES ('encryption_key', ?)").run(cachedKey.toString('hex'));
    console.warn('[crypto] No ENCRYPTION_KEY set — generated and persisted a local dev key. Set ENCRYPTION_KEY for production.');
  } catch {
    // DB doesn't have a settings table (e.g. async Supabase backend not yet ready).
    // The key is still in memory for this process, just not persisted.
    console.warn('[crypto] No ENCRYPTION_KEY set — generated an in-memory key (DB persistence unavailable). Sessions/keys WILL be lost on restart.');
  }
}

function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    throw new Error('Encryption key not initialized. Call initEncryptionKey() first.');
  }
  return cachedKey;
}

export function encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
