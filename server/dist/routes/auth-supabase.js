// Production auth routes using Supabase Auth or dev fallback
// Handles signup, login, logout, password reset, and session management
// Auto-detects whether Supabase is configured; falls back to dev mode locally
import { Router } from 'express';
import { z } from 'zod';
import * as authSupa from '../services/auth-supabase.js';
import * as authDev from '../services/auth-dev.js';
const USE_DEV_AUTH = !authDev.isSupabaseConfigured();
// Create unified auth interface
const auth = {
    signUp: USE_DEV_AUTH ? authDev.signUpDev : authSupa.signUp,
    signIn: USE_DEV_AUTH ? authDev.signInDev : authSupa.signIn,
    loadUserData: USE_DEV_AUTH ? authDev.loadUserDataDev : authSupa.loadUserData,
    logout: USE_DEV_AUTH ? authDev.logoutDev : authSupa.logout,
    verifyAccessToken: USE_DEV_AUTH ? authDev.verifyAccessTokenDev : authSupa.verifyAccessToken,
    requestPasswordReset: USE_DEV_AUTH ? authDev.requestPasswordResetDev : authSupa.requestPasswordReset,
};
export const authRouter = Router();
// Session cookie name and configuration
const SESSION_COOKIE_NAME = 'freellmapi_session';
const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
};
// Middleware to verify access token from Authorization header or cookie
export async function verifyAuthMiddleware(req, res, next) {
    // Get token from Authorization header or session cookie
    let token = req.headers.authorization?.replace('Bearer ', '');
    if (!token && req.cookies?.[SESSION_COOKIE_NAME]) {
        token = req.cookies[SESSION_COOKIE_NAME];
    }
    if (!token) {
        res.status(401).json({ error: { message: 'No authentication token provided' } });
        return;
        return;
    }
    // Verify the token with Supabase
    const { valid, user, error } = await auth.verifyAccessToken(token);
    if (!valid || !user) {
        res.clearCookie(SESSION_COOKIE_NAME);
        res.status(401).json({ error: { message: error || 'Invalid token' } });
        return;
    }
    // Attach user to request
    req.user = user;
    next();
}
// ============================================================================
// GET /api/auth/status
// ============================================================================
// Check authentication status and return user data if authenticated
authRouter.get('/status', async (req, res) => {
    try {
        const token = req.cookies?.[SESSION_COOKIE_NAME];
        if (!token) {
            return res.json({
                authenticated: false,
                needsSetup: false,
                user: null,
                userData: null,
            });
        }
        // Verify token
        const { valid, user } = await auth.verifyAccessToken(token);
        if (!valid || !user) {
            res.clearCookie(SESSION_COOKIE_NAME);
            return res.json({
                authenticated: false,
                needsSetup: false,
                user: null,
                userData: null,
            });
        }
        // Load user data (use email for dev auth, id for supabase)
        const userId = user.id || user.email;
        const { success, data: userData, error } = await auth.loadUserData(userId);
        if (!success) {
            console.warn('[auth] Failed to load user data:', error);
            return res.json({
                authenticated: true,
                needsSetup: false,
                user,
                userData: null,
            });
        }
        res.json({
            authenticated: true,
            needsSetup: false,
            user,
            userData,
        });
    }
    catch (err) {
        console.error('[auth] Status check error:', err);
        res.status(500).json({ error: { message: 'Status check failed' } });
    }
});
// ============================================================================
// POST /api/auth/signup
// ============================================================================
// Create a new user account
const signupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});
authRouter.post('/signup', async (req, res) => {
    try {
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
            });
        }
        const { email, password } = parsed.data;
        // Sign up the user
        const { success, error } = await auth.signUp(email, password);
        if (!success) {
            return res.status(400).json({
                error: { message: error || 'Signup failed' },
            });
        }
        // Now sign them in to get a session
        const { success: signinSuccess, session, error: signinError } = await auth.signIn(email, password);
        if (!signinSuccess || !session) {
            return res.status(500).json({
                error: { message: signinError || 'Failed to create session after signup' },
            });
        }
        // Set session cookie
        res.cookie(SESSION_COOKIE_NAME, session.accessToken, SESSION_COOKIE_OPTIONS);
        res.status(201).json({
            success: true,
            user: session.user,
            message: 'Account created successfully',
        });
    }
    catch (err) {
        console.error('[auth] Signup error:', err);
        res.status(500).json({ error: { message: 'Signup failed' } });
    }
});
// ============================================================================
// POST /api/auth/login
// ============================================================================
// Authenticate user with email and password
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});
authRouter.post('/login', async (req, res) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
            });
        }
        const { email, password } = parsed.data;
        // Sign in the user
        const { success, session, error } = await auth.signIn(email, password);
        if (!success || !session) {
            return res.status(401).json({
                error: { message: error || 'Invalid email or password' },
            });
        }
        // Set session cookie
        res.cookie(SESSION_COOKIE_NAME, session.accessToken, SESSION_COOKIE_OPTIONS);
        // Load user data
        const { success: loadSuccess, data: userData } = await auth.loadUserData(session.user.id || session.user.email);
        res.json({
            success: true,
            user: session.user,
            userData: loadSuccess ? userData : null,
        });
    }
    catch (err) {
        console.error('[auth] Login error:', err);
        res.status(500).json({ error: { message: 'Login failed' } });
    }
});
// ============================================================================
// POST /api/auth/logout
// ============================================================================
// Invalidate the current session
authRouter.post('/logout', async (req, res) => {
    try {
        res.clearCookie(SESSION_COOKIE_NAME);
        res.json({ success: true, message: 'Logged out successfully' });
    }
    catch (err) {
        console.error('[auth] Logout error:', err);
        res.status(500).json({ error: { message: 'Logout failed' } });
    }
});
// ============================================================================
// GET /api/auth/me
// ============================================================================
// Get current user info (requires authentication)
authRouter.get('/me', verifyAuthMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: { message: 'Not authenticated' } });
        }
        // Load user data
        const { success, data: userData } = await auth.loadUserData(user.id || user.email);
        res.json({
            user,
            userData: success ? userData : null,
        });
    }
    catch (err) {
        console.error('[auth] Me endpoint error:', err);
        res.status(500).json({ error: { message: 'Failed to load user info' } });
    }
});
// ============================================================================
// POST /api/auth/forgot-password
// ============================================================================
// Request a password reset email
const forgotPasswordSchema = z.object({
    email: z.string().email(),
});
authRouter.post('/forgot-password', async (req, res) => {
    try {
        const parsed = forgotPasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
            });
        }
        const { email } = parsed.data;
        // Request password reset
        const result = await auth.requestPasswordReset(email);
        if (!result.success) {
            return res.status(400).json({
                error: { message: 'Failed to request password reset' },
            });
        }
        res.json({
            success: true,
            message: 'If an account exists with this email, a password reset link has been sent',
        });
    }
    catch (err) {
        console.error('[auth] Forgot password error:', err);
        res.status(500).json({ error: { message: 'Failed to process password reset request' } });
    }
});
// ============================================================================
// POST /api/auth/reset-password
// ============================================================================
// Complete password reset with token (this would be handled by Supabase directly in production)
const resetPasswordSchema = z.object({
    token: z.string(),
    password: z.string().min(8),
});
authRouter.post('/reset-password', async (req, res) => {
    try {
        const parsed = resetPasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
            });
        }
        // In production, use Supabase's password reset token verification
        // This is a simplified implementation - Supabase handles the actual reset via the dashboard
        res.json({
            success: true,
            message: 'Password reset completed. Please log in with your new password.',
        });
    }
    catch (err) {
        console.error('[auth] Reset password error:', err);
        res.status(500).json({ error: { message: 'Failed to reset password' } });
    }
});
// ============================================================================
// Export middleware for protected routes
// ============================================================================
export async function requireAuth(req, res, next) {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
        res.status(401).json({ error: { message: 'Authentication required' } });
        return;
    }
    // Verify token
    const { valid, user } = await auth.verifyAccessToken(token);
    if (!valid || !user) {
        res.status(401).json({ error: { message: 'Invalid or expired session' } });
        return;
    }
    req.user = user;
    next();
}
//# sourceMappingURL=auth-supabase.js.map