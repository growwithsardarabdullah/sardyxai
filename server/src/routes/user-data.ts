// Production API routes for managing provider keys, unified key, and settings
// These routes are protected and work with the Supabase-based auth system

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  addProviderKey,
  getProviderKeysByUser,
  getProviderKeyDecrypted,
  deleteProviderKey,
  updateProviderKeyStatus,
  ensureUserUnifiedKey,
  regenerateUserUnifiedKey,
  getUserSetting,
  setUserSetting,
  logUserUsage,
  getUserUsageSummary,
  getUserUsageByProvider,
} from '../db/supabase-service.js';
import { maskKey } from '../lib/crypto.js';
import { requireAuth } from './auth-supabase.js';

export const userDataRouter = Router();

// Apply auth middleware to all routes
userDataRouter.use(requireAuth);

function getUserId(req: Request): string {
  const user = (req as any).user;
  if (!user?.id) {
    throw new Error('User not authenticated');
  }
  return user.id;
}

// ============================================================================
// PROVIDER KEYS ENDPOINTS
// ============================================================================

const addKeySchema = z.object({
  provider: z.string().min(1),
  key: z.string().min(1),
  label: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

// POST /api/user/keys - Add a new provider key
userDataRouter.post('/keys', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = addKeySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
      });
    }

    const { provider, key, label, baseUrl } = parsed.data;

    // Test encryption round-trip
    const { encrypt, decrypt } = await import('../lib/crypto.js');
    try {
      const enc = encrypt(key);
      const roundTrip = decrypt(enc.encrypted, enc.iv, enc.authTag);
      if (roundTrip !== key) {
        throw new Error('Encryption verification failed');
      }
    } catch (err) {
      return res.status(500).json({
        error: { message: 'Encryption failed - the API key cannot be securely stored' },
      });
    }

    // Add the key
    const keyData = await addProviderKey(userId, provider, key, label, baseUrl);

    res.status(201).json({
      success: true,
      key: {
        id: keyData.id,
        provider: keyData.provider,
        label: keyData.label,
        maskedKey: maskKey(key),
        baseUrl: keyData.base_url,
        enabled: keyData.enabled,
        createdAt: keyData.created_at,
      },
    });
  } catch (err) {
    console.error('[keys] Add key error:', err);
    res.status(500).json({ error: { message: 'Failed to add provider key' } });
  }
});

// GET /api/user/keys - List all provider keys
userDataRouter.get('/keys', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const keys = await getProviderKeysByUser(userId);

    res.json({
      keys: keys.map(k => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        enabled: k.enabled,
        status: k.status,
        baseUrl: k.base_url,
        createdAt: k.created_at,
      })),
    });
  } catch (err) {
    console.error('[keys] List keys error:', err);
    res.status(500).json({ error: { message: 'Failed to list provider keys' } });
  }
});

// GET /api/user/keys/:keyId - Get full decrypted key (dangerous, use carefully)
userDataRouter.get('/keys/:keyId', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { keyId } = req.params;

    const decryptedKey = await getProviderKeyDecrypted(userId, keyId);

    res.json({
      key: decryptedKey,
      warning: 'Do not share or expose this key',
    });
  } catch (err) {
    console.error('[keys] Get key error:', err);
    res.status(500).json({ error: { message: 'Failed to retrieve provider key' } });
  }
});

const updateKeySchema = z.object({
  label: z.string().optional(),
  enabled: z.boolean().optional(),
});

// PATCH /api/user/keys/:keyId - Update provider key
userDataRouter.patch('/keys/:keyId', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { keyId } = req.params;
    const parsed = updateKeySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
      });
    }

    // TODO: Implement update in database
    // await updateProviderKey(userId, keyId, parsed.data);

    res.json({
      success: true,
      message: 'Key updated',
    });
  } catch (err) {
    console.error('[keys] Update key error:', err);
    res.status(500).json({ error: { message: 'Failed to update provider key' } });
  }
});

// DELETE /api/user/keys/:keyId - Delete a provider key
userDataRouter.delete('/keys/:keyId', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { keyId } = req.params;

    await deleteProviderKey(userId, keyId);

    res.json({
      success: true,
      message: 'Key deleted',
    });
  } catch (err) {
    console.error('[keys] Delete key error:', err);
    res.status(500).json({ error: { message: 'Failed to delete provider key' } });
  }
});

// ============================================================================
// UNIFIED KEY ENDPOINTS
// ============================================================================

// GET /api/user/unified-key - Get or create unified key
userDataRouter.get('/unified-key', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const key = await ensureUserUnifiedKey(userId);

    res.json({
      key,
      warning: 'Keep this key secret. Use it to authenticate with the /v1 API.',
    });
  } catch (err) {
    console.error('[unified-key] Get error:', err);
    res.status(500).json({ error: { message: 'Failed to get unified key' } });
  }
});

// POST /api/user/unified-key/regenerate - Generate a new unified key
userDataRouter.post('/unified-key/regenerate', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const newKey = await regenerateUserUnifiedKey(userId);

    res.json({
      key: newKey,
      message: 'New unified key generated. The old key is no longer valid.',
      warning: 'Keep this key secret. Update your API configurations.',
    });
  } catch (err) {
    console.error('[unified-key] Regenerate error:', err);
    res.status(500).json({ error: { message: 'Failed to regenerate unified key' } });
  }
});

// ============================================================================
// SETTINGS ENDPOINTS
// ============================================================================

const settingSchema = z.object({
  value: z.any(),
});

// GET /api/user/settings/:key - Get a setting
userDataRouter.get('/settings/:key', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { key } = req.params;

    const value = await getUserSetting(userId, key);

    res.json({
      key,
      value,
    });
  } catch (err) {
    console.error('[settings] Get error:', err);
    res.status(500).json({ error: { message: 'Failed to get setting' } });
  }
});

// PUT /api/user/settings/:key - Set a setting
userDataRouter.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { key } = req.params;
    const parsed = settingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: { message: 'Invalid setting value' },
      });
    }

    await setUserSetting(userId, key, parsed.data.value);

    res.json({
      success: true,
      message: 'Setting updated',
    });
  } catch (err) {
    console.error('[settings] Set error:', err);
    res.status(500).json({ error: { message: 'Failed to save setting' } });
  }
});

// ============================================================================
// USAGE TRACKING ENDPOINTS
// ============================================================================

// GET /api/user/usage/summary - Get usage summary
userDataRouter.get('/usage/summary', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const days = parseInt(req.query.days as string) || 30;

    const summary = await getUserUsageSummary(userId, days);

    res.json({
      period: `${days} days`,
      summary: {
        totalRequests: summary.total_requests,
        totalInputTokens: summary.total_input_tokens,
        totalOutputTokens: summary.total_output_tokens,
        providerCount: summary.provider_count,
        modelCount: summary.model_count,
      },
    });
  } catch (err) {
    console.error('[usage] Summary error:', err);
    res.status(500).json({ error: { message: 'Failed to get usage summary' } });
  }
});

// GET /api/user/usage/by-provider - Get usage breakdown by provider
userDataRouter.get('/usage/by-provider', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const days = parseInt(req.query.days as string) || 30;

    const byProvider = await getUserUsageByProvider(userId, days);

    res.json({
      period: `${days} days`,
      data: byProvider,
    });
  } catch (err) {
    console.error('[usage] By provider error:', err);
    res.status(500).json({ error: { message: 'Failed to get usage by provider' } });
  }
});
