export interface SessionUser {
    userId: number;
    email: string;
}
export declare const SESSION_COOKIE_NAME = "freellmapi_session";
/**
 * Mint a signed session token. The token is stateless (no DB row), but it
 * carries the user's `v` (session_version) field so we can invalidate all of a
 * user's tokens by bumping that version in the DB on logout.
 */
export declare function createSession(userId: number, email?: string): string;
/** Verify a signed session token. Returns the user on success, null on bad/expired/invalidated. */
export declare function validateSession(token: string | undefined | null): SessionUser | null;
/** Invalidate all of a user's currently-issued tokens by bumping their session_version. */
export declare function deleteSession(token: string | undefined | null): void;
export declare function userCount(): number;
/** Create a user. Throws { code: 'email_taken' } if the email already exists. */
export declare function createUser(email: string, password: string): SessionUser;
/** Verify credentials. Returns the user on success, null on failure. */
export declare function verifyCredentials(email: string, password: string): SessionUser | null;
//# sourceMappingURL=auth.d.ts.map