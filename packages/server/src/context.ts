/**
 * RequestContext: Unified request identity threaded through requests.
 * Enables telemetry/metrics to distinguish originating app.
 * Includes client info (IP, User-Agent) for audit logging.
 */
import type { AppId, SessionId, UserId } from '@parametric-portal/types/schema';
import { Effect, Option } from 'effect';

// --- [CLASSES] ---------------------------------------------------------------

class RequestContext extends Effect.Tag('server/RequestContext')<RequestContext, {
    readonly appId: AppId;
    readonly ipAddress: string | null;
    readonly requestId: string;
    readonly sessionId: SessionId | null;
    readonly userAgent: string | null;
    readonly userId: UserId | null;
}>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getAppId: Effect.Effect<AppId, never, never> = Effect.serviceOption(RequestContext).pipe(
    Effect.map(Option.match({
        onNone: () => 'system' as AppId,
        onSome: (rc) => rc.appId,
    })),
);
const getClientInfo: Effect.Effect<{ readonly ipAddress: string | null; readonly userAgent: string | null }, never, never> =
    Effect.serviceOption(RequestContext).pipe(
        Effect.map(Option.match({
            onNone: () => ({ ipAddress: null, userAgent: null }),
            onSome: (rc) => ({ ipAddress: rc.ipAddress, userAgent: rc.userAgent }),
        })),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { getAppId, getClientInfo, RequestContext };
