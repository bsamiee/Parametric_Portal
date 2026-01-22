/**
 * Thread request identity through Effect fiber context.
 * Enables telemetry segmentation by app; provides IP/User-Agent for audit.
 */
import { Client } from '@parametric-portal/database/client';
import { Effect, Option } from 'effect';

// --- [TAGS] ------------------------------------------------------------------

class RequestContext extends Effect.Tag('server/RequestContext')<RequestContext, {
	readonly appId: string;
	readonly ipAddress: Option.Option<string>;
	readonly requestId: string;
	readonly sessionId: Option.Option<string>;
	readonly userAgent: Option.Option<string>;
	readonly userId: Option.Option<string>;
}>() {
	static readonly Id = Object.assign(() => Client.tenant.id.default, { system: Client.tenant.id.system });
	static readonly app = Effect.serviceOption(RequestContext).pipe(Effect.map(Option.match({ onNone: () => Client.tenant.id.system, onSome: (ctx) => ctx.appId })));
	static readonly client = Effect.serviceOption(RequestContext).pipe(Effect.map(Option.match({ onNone: () => ({ ipAddress: null, userAgent: null }), onSome: (ctx) => ({ ipAddress: Option.getOrNull(ctx.ipAddress), userAgent: Option.getOrNull(ctx.userAgent) }) })));
}

// --- [EXPORT] ----------------------------------------------------------------

export { RequestContext };
