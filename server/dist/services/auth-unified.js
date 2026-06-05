/**
 * Unified auth service that uses Supabase in production and dev fallback locally
 */
import { isSupabaseConfigured } from './auth-dev.js';
import { signUp as supabaseSignUp, signIn as supabaseSignIn, loadUserData as supabaseLoadUserData } from './auth-supabase.js';
import { signUpDev, signInDev, loadUserDataDev, initDevMode } from './auth-dev.js';
// Initialize dev mode if needed
initDevMode();
const USE_SUPABASE = isSupabaseConfigured();
console.log(`[auth] Using ${USE_SUPABASE ? 'Supabase' : 'development fallback'} authentication`);
/**
 * Sign up with auto-detection of auth backend
 */
export async function signUp(email, password) {
    if (USE_SUPABASE) {
        return supabaseSignUp(email, password);
    }
    else {
        return signUpDev(email, password);
    }
}
/**
 * Sign in with auto-detection of auth backend
 */
export async function signIn(email, password) {
    if (USE_SUPABASE) {
        return supabaseSignIn(email, password);
    }
    else {
        return signInDev(email, password);
    }
}
/**
 * Load user data with auto-detection of auth backend
 */
export async function loadUserData(email) {
    if (USE_SUPABASE) {
        // For Supabase, we'd need the user ID, not email
        // This is a limitation of the dev mode - it uses email as identifier
        return supabaseLoadUserData(email);
    }
    else {
        return loadUserDataDev(email);
    }
}
/**
 * Export both for flexibility
 */
export { initDevMode };
//# sourceMappingURL=auth-unified.js.map