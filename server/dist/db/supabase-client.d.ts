import { type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export declare function getSupabaseAdmin(): SupabaseClient<Database> | null;
export declare function getSupabaseAnon(): SupabaseClient<Database> | null;
export declare function getSupabaseUser(accessToken: string): SupabaseClient<Database>;
export declare function isSupabaseConfigured(): boolean;
export declare function getSupabaseConfig(): {
    configured: boolean;
    url: string;
    hasAnonKey: boolean;
    hasServiceRoleKey: boolean;
};
//# sourceMappingURL=supabase-client.d.ts.map