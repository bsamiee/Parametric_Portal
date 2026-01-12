/**
 * RequestContext: Unified request identity for app threading through requests.
 * Uses Effect.Tag pattern for simple context injection.
 * Enables telemetry/metrics to distinguish originating app.
 */
import type { AppId, SessionId, UserId } from '@parametric-portal/types/schema';
import { Effect } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type RequestContextShape = {
    readonly appId: AppId;
    readonly userId: UserId | null;
    readonly sessionId: SessionId | null;
    readonly requestId: string;
};

// --- [CLASSES] ---------------------------------------------------------------

class RequestContext extends Effect.Tag('server/RequestContext')<RequestContext, RequestContextShape>() {}

// --- [EXPORT] ----------------------------------------------------------------

export { RequestContext };
export type { RequestContextShape };
