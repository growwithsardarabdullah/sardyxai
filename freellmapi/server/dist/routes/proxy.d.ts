import type { Request } from 'express';
import type { ChatMessage } from '@freellmapi/shared/types.js';
export declare const proxyRouter: any;
export declare function timingSafeStringEqual(provided: string, expected: string): boolean;
export declare function extractApiToken(req: Request): string | undefined;
export declare function getStickyModel(messages: ChatMessage[]): number | undefined;
export declare function setStickyModel(messages: ChatMessage[], modelDbId: number): void;
export declare function isRetryableError(err: any): boolean;
export declare function streamChunkText(chunk: any): string;
export declare function logRequest(platform: string, modelId: string, keyId: number, status: string, inputTokens: number, outputTokens: number, latencyMs: number, error: string | null, ttfbMs?: number | null): void;
//# sourceMappingURL=proxy.d.ts.map