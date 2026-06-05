// Production-ready Supabase Auth service

import { getSupabaseAdmin, getSupabaseAnon } from '../db/supabase-client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionUser {
  id: string;
  email: string;
}

export interface AuthSession {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export type AuthUser = SessionUser;

// ============================================================================
// SIGNUP
// ============================================================================

export async function signUp(
  email: string,
  password: string
): Promise<{
  success: boolean;
  session?: AuthSession;
  error?: string;
}> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      throw new Error('Supabase not configured');
    }

    // Sign up with Supabase Auth
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user) {
      return {
        success: false,
        error: error?.message || 'Failed to create user',
      };
    }

    const userId = data.user.id;

    // Create user profile
    const { error: profileError } = await sb.from('profiles').insert({
      user_id: userId,
      email,
    });

    if (profileError) {
      console.error('[auth] Profile creation failed:', profileError);
      await sb.auth.admin.deleteUser(userId);
      return {
        success: false,
        error: 'Failed to create user profile',
      };
    }

    return {
      success: true,
      error: undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// SIGN IN
// ============================================================================

export async function signIn(
  email: string,
  password: string
): Promise<{
  success: boolean;
  session?: AuthSession;
  error?: string;
}> {
  try {
    const sb = getSupabaseAnon();
    if (!sb) {
      throw new Error('Supabase not configured');
    }

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      return {
        success: false,
        error: error?.message || 'Invalid email or password',
      };
    }

    const session: AuthSession = {
      user: {
        id: data.user.id,
        email: data.user.email || email,
      },
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token || '',
      expiresIn: data.session.expires_in || 3600,
      expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600000,
    };

    return {
      success: true,
      session,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// VERIFY ACCESS TOKEN
// ============================================================================

export async function verifyAccessToken(
  token: string
): Promise<{
  valid: boolean;
  user?: SessionUser;
  error?: string;
}> {
  try {
    const sb = getSupabaseAnon();
    if (!sb) {
      throw new Error('Supabase not configured');
    }

    const { data, error } = await sb.auth.getUser(token);

    if (error || !data?.user) {
      return {
        valid: false,
        error: error?.message || 'Invalid token',
      };
    }

    return {
      valid: true,
      user: {
        id: data.user.id,
        email: data.user.email || '',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: message,
    };
  }
}

// ============================================================================
// LOGOUT
// ============================================================================

export async function logout(_sessionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      throw new Error('Supabase not configured');
    }

    const { error } = await sb.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// LOAD USER DATA
// ============================================================================

export async function loadUserData(userId: string): Promise<{
  success: boolean;
  data?: {
    profile: any;
    providerKeys: any[];
    settings: Record<string, unknown>;
  };
  error?: string;
}> {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      throw new Error('Supabase not configured');
    }

    const [
      { data: profile },
      { data: keys },
      { data: settings },
    ] = await Promise.all([
      sb.from('profiles').select('*').eq('user_id', userId).single(),
      sb.from('provider_keys').select('*').eq('user_id', userId),
      sb.from('user_settings').select('*').eq('user_id', userId),
    ]);

    return {
      success: true,
      data: {
        profile: profile || {},
        providerKeys: keys || [],
        settings: (settings || []).reduce((acc: Record<string, unknown>, s: any) => {
          acc[s.key] = s.value;
          return acc;
        }, {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
