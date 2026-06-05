/**
 * Unified auth service that uses Supabase in production and dev fallback locally
 */
import { initDevMode } from './auth-dev.js';
import type { AuthSession } from './auth-supabase.js';
/**
 * Sign up with auto-detection of auth backend
 */
export declare function signUp(email: string, password: string): Promise<{
    success: boolean;
    session?: AuthSession;
    error?: string;
} | {
    success: boolean;
    error?: string;
    userId?: string;
}>;
/**
 * Sign in with auto-detection of auth backend
 */
export declare function signIn(email: string, password: string): Promise<{
    success: boolean;
    error?: string;
    session?: AuthSession;
}>;
/**
 * Load user data with auto-detection of auth backend
 */
export declare function loadUserData(email: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}>;
/**
 * Export both for flexibility
 */
export { initDevMode };
//# sourceMappingURL=auth-unified.d.ts.map