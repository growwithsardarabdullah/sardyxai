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
export declare function signUp(email: string, password: string): Promise<{
    success: boolean;
    session?: AuthSession;
    error?: string;
}>;
export declare function signIn(email: string, password: string): Promise<{
    success: boolean;
    session?: AuthSession;
    error?: string;
}>;
export declare function verifyAccessToken(token: string): Promise<{
    valid: boolean;
    user?: SessionUser;
    error?: string;
}>;
export declare function logout(_sessionId: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function requestPasswordReset(email: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function loadUserData(userId: string): Promise<{
    success: boolean;
    data?: {
        profile: any;
        providerKeys: any[];
        settings: Record<string, unknown>;
    };
    error?: string;
}>;
//# sourceMappingURL=auth-supabase.d.ts.map