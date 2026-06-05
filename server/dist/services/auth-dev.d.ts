/**
 * Development-only fallback authentication
 * Uses SQLite instead of Supabase for local testing
 * NOT FOR PRODUCTION - this is dev/test only
 */
import type { AuthSession } from './auth-supabase.js';
export interface AuthSessionDev extends AuthSession {
    sessionId: string;
}
/**
 * Dev sign up - creates user in memory/SQLite
 */
export declare function signUpDev(email: string, password: string): Promise<{
    success: boolean;
    error?: string;
    userId?: string;
}>;
/**
 * Dev sign in - authenticates user from memory/SQLite
 */
export declare function signInDev(email: string, password: string): Promise<{
    success: boolean;
    error?: string;
    session?: AuthSessionDev;
}>;
/**
 * Dev load user data - from SQLite
 */
export declare function loadUserDataDev(identifier: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}>;
/**
 * Check if Supabase is configured
 */
export declare function isSupabaseConfigured(): boolean;
/**
 * Dev verify access token - simple validation
 */
export declare function verifyAccessTokenDev(token: string): Promise<{
    valid: boolean;
    user?: {
        id: string;
        email: string;
    };
    error?: string;
}>;
/**
 * Dev logout - no-op
 */
export declare function logoutDev(): Promise<{
    success: boolean;
}>;
/**
 * Dev request password reset - no-op
 */
export declare function requestPasswordResetDev(_email: string): Promise<{
    success: boolean;
}>;
/**
 * Initialize dev mode - create tables if needed and load users from DB
 */
export declare function initDevMode(): void;
//# sourceMappingURL=auth-dev.d.ts.map