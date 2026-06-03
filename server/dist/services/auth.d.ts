export interface SessionUser {
    userId: number;
    email: string;
}
export declare const SESSION_COOKIE_NAME = "freellmapi_session";
/** Mint a signed session token. No DB write. */
export declare function createSession(userId: number, email: string): string;
/** Verify a signed session token. Returns the user on success, null on bad/expired. */
export declare function validateSession(token: string | undefined | null): SessionUser | null;
/** Stateless — no DB write. Kept for API compatibility with /api/auth/logout. */
export declare function deleteSession(_token: string | undefined | null): void;
export declare function userCount(): number;
/** Create a user. Throws { code: 'email_taken' } if the email already exists. */
export declare function createUser(email: string, password: string): SessionUser;
/** Verify credentials. Returns the user on success, null on failure. */
export declare function verifyCredentials(email: string, password: string): SessionUser | null;
//# sourceMappingURL=auth.d.ts.map