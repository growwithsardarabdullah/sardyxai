import type { Request, Response } from 'express';
export declare const authRouter: import("express-serve-static-core").Router;
export declare function verifyAuthMiddleware(req: Request, res: Response, next: Function): Promise<void>;
export declare function requireAuth(req: Request, res: Response, next: Function): Promise<void>;
//# sourceMappingURL=auth-supabase.d.ts.map