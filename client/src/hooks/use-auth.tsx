// Production-ready auth hook using Supabase Auth
// Handles session management, state restoration, and auth state changes

import { useEffect, useState, useCallback, useContext, createContext, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthUser {
  id: string; // UUID from Supabase
  email: string;
}

export interface UserData {
  profile: any;
  providerKeys: any[];
  unifiedKey: string | null;
  settings: Record<string, any>;
  usage: any;
}

export interface AuthContextType {
  // Auth state
  user: AuthUser | null;
  userData: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Auth actions
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  refreshUserData: () => Promise<void>;
}

// ============================================================================
// CONTEXT
// ============================================================================

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// ============================================================================
// PROVIDER
// ============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();

  // Auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    restoreSession();
  }, []);

  // Listen for auth changes
  useEffect(() => {
    // Listen for unauthorized events (e.g., from 401 responses)
    const handleUnauthorized = () => {
      console.log('[auth] Unauthorized event received');
      logout();
    };

    window.addEventListener('freellmapi:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('freellmapi:unauthorized', handleUnauthorized);
    };
  }, []);

  // ============================================================================
  // SESSION RESTORATION
  // ============================================================================

  const restoreSession = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Check auth status from backend
      const response = await fetch('/api/auth/status', {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to check auth status');
      }

      const { authenticated, user: authUser, userData: userDat } = await response.json();

      if (authenticated && authUser) {
        setUser(authUser);
        setUserData(userDat || null);

        // Mark React Query data as fresh
        queryClient.invalidateQueries({ queryKey: ['auth'] });
      } else {
        setUser(null);
        setUserData(null);
      }
    } catch (err) {
      console.error('[auth] Session restore error:', err);
      // Non-fatal - continue with logged-out state
      setUser(null);
      setUserData(null);
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  // ============================================================================
  // SIGNUP
  // ============================================================================

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Signup failed');
      }

      const { user: authUser } = await response.json();
      setUser(authUser);
      setUserData(null); // Will be loaded on next navigation

      // Invalidate auth queries
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  // ============================================================================
  // LOGIN
  // ============================================================================

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Login failed');
      }

      const { user: authUser, userData: userDat } = await response.json();
      setUser(authUser);
      setUserData(userDat || null);

      // Invalidate auth queries
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  // ============================================================================
  // LOGOUT
  // ============================================================================

  const logout = useCallback(async () => {
    try {
      setError(null);

      // Call logout endpoint
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      }).catch(() => {
        // Ignore errors on logout
      });

      setUser(null);
      setUserData(null);

      // Clear all queries
      queryClient.clear();
    } catch (err) {
      console.error('[auth] Logout error:', err);
      // Always clear state even if logout request fails
      setUser(null);
      setUserData(null);
      queryClient.clear();
    }
  }, [queryClient]);

  // ============================================================================
  // REFRESH USER DATA
  // ============================================================================

  const refreshUserData = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      setError(null);

      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired
          logout();
          return;
        }
        throw new Error('Failed to load user data');
      }

      const { userData: userDat } = await response.json();
      setUserData(userDat || null);

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['user-data'] });
    } catch (err) {
      console.error('[auth] Refresh user data error:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, [user, logout, queryClient]);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const value: AuthContextType = {
    user,
    userData,
    isAuthenticated: !!user,
    isLoading,
    error,
    signUp,
    signIn,
    logout,
    restoreSession,
    refreshUserData,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

/**
 * Hook to require authentication
 * Optionally redirect to login if not authenticated
 */
export function useRequireAuth(redirectTo?: string) {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user && redirectTo) {
      window.location.href = redirectTo;
    }
  }, [user, isLoading, redirectTo]);

  return { isAuthenticated: !!user, isLoading };
}

/**
 * Hook to fetch user provider keys with caching
 */
export function useProviderKeys() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!user) {
      setKeys([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/user/keys', {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to load keys');
      }

      const { keys: fetchedKeys } = await response.json();
      setKeys(fetchedKeys);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  return { keys, isLoading, error, refetch: fetchKeys };
}

/**
 * Hook to fetch unified API key
 */
export function useUnifiedKey() {
  const { user } = useAuth();
  const [key, setKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKey = useCallback(async () => {
    if (!user) {
      setKey(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/user/unified-key', {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to load unified key');
      }

      const { key: fetchedKey } = await response.json();
      setKey(fetchedKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const regenerate = useCallback(async () => {
    try {
      setError(null);

      const response = await fetch('/api/user/unified-key/regenerate', {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to regenerate key');
      }

      const { key: newKey } = await response.json();
      setKey(newKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, []);

  useEffect(() => {
    fetchKey();
  }, [fetchKey]);

  return { key, isLoading, error, regenerate, refetch: fetchKey };
}

/**
 * Hook to fetch usage summary
 */
export function useUsageSummary(days: number = 30) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!user) {
      setSummary(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/user/usage/summary?days=${days}`, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to load usage summary');
      }

      const data = await response.json();
      setSummary(data.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user, days]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, isLoading, error, refetch: fetchSummary };
}
