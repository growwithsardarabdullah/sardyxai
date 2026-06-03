import { type RoutingStrategy, type RoutingWeights } from './scoring.js';
import type { BaseProvider } from '../providers/base.js';
import type { Database } from 'better-sqlite3';
export interface RouteResult {
    provider: BaseProvider;
    modelId: string;
    modelDbId: number;
    apiKey: string;
    keyId: number;
    platform: string;
    displayName: string;
    rpdLimit: number | null;
    tpdLimit: number | null;
}
/**
 * Record a 429 for a model — increases its penalty so it sinks in priority.
 */
export declare function recordRateLimitHit(modelDbId: number): void;
/**
 * Record a success for a model — reduces its penalty so it rises back up.
 */
export declare function recordSuccess(modelDbId: number): void;
/**
 * Get current penalties for all models (for the API/dashboard).
 */
export declare function getAllPenalties(): Array<{
    modelDbId: number;
    count: number;
    penalty: number;
}>;
export declare function getRoutingStrategy(): RoutingStrategy;
export declare function setRoutingStrategy(strategy: RoutingStrategy): void;
export declare function refreshStatsCache(db: Database, force?: boolean): void;
/**
 * Route a request to the best available model.
 *
 * Ordering depends on the configured strategy (see orderChain). Everything
 * downstream — key round-robin, cooldowns, token pre-checks, custom base_url
 * resolution, vision filtering, sticky sessions — is strategy-independent.
 *
 * If preferredModelDbId is set, that model gets tried FIRST (sticky sessions).
 * This prevents hallucination from model switching mid-conversation.
 *
 * @param estimatedTokens - estimated total tokens for rate limit check
 * @param skipKeys - set of "platform:modelId:keyId" to skip (failed on this request)
 * @param preferredModelDbId - try this model first (sticky session)
 * @param requireVision - only consider models that accept image input (#118)
 */
export declare function routeRequest(estimatedTokens?: number, skipKeys?: Set<string>, preferredModelDbId?: number, requireVision?: boolean, userEmail?: string): RouteResult;
/**
 * Per-model routing scores for the dashboard. Deterministic (expected
 * reliability, not sampled) so the table is stable between polls. Returns the
 * axis breakdown plus the final score under the active strategy's weights.
 */
export interface RoutingScore {
    modelDbId: number;
    platform: string;
    modelId: string;
    displayName: string;
    enabled: boolean;
    reliability: number;
    speed: number;
    intelligence: number;
    headroom: number;
    rateLimit: number;
    score: number;
    totalRequests: number;
}
export declare function getRoutingScores(): {
    strategy: RoutingStrategy;
    weights: RoutingWeights | null;
    scores: RoutingScore[];
};
export declare function hasEnabledVisionModel(): boolean;
//# sourceMappingURL=router.d.ts.map