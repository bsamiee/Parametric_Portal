/**
 * Tenant context propagation for multi-tenant request isolation.
 */
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { Effect, FiberRef, Layer, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _Id = { default: '00000000-0000-7000-8000-000000000001', system: '00000000-0000-7000-8000-000000000000' } as const;
const _ref = FiberRef.unsafeMake<string>(_Id.default);

// --- [CONTEXT] ---------------------------------------------------------------

class Context extends Effect.Tag('server/RequestContext')<Context, {
	readonly ipAddress: Option.Option<string>;
	readonly requestId: string;
	readonly sessionId: Option.Option<string>;
	readonly tenantId: string;
	readonly userAgent: Option.Option<string>;
	readonly userId: Option.Option<string>;
}>() {
	static readonly Id = _Id;
	static readonly current = FiberRef.get(_ref);
	static readonly system = (requestId = crypto.randomUUID()): typeof Context.Service => ({
		ipAddress: Option.none(),
		requestId,
		sessionId: Option.none(),
		tenantId: _Id.system,
		userAgent: Option.none(),
		userId: Option.none(),
	});
	static readonly SystemLayer = Layer.succeed(Context, Context.system());
}

// --- [EXECUTION] -------------------------------------------------------------

/** Execute effect within tenant context (no DB sync - for middleware/handlers) */
const within = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, context?: typeof Context.Service): Effect.Effect<A, E, R> => {
	const id = tenantId === _Id.system ? _Id.system : tenantId;
	const withContext = context ? Effect.provideService(effect, Context, context) : effect;
	return Effect.locally(withContext, _ref, id);
};

/** Execute effect within tenant context with DB session sync (for transactions) */
const withinSync = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, context?: typeof Context.Service): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> =>
	Effect.gen(function* () {
		const id = tenantId === _Id.system ? _Id.system : tenantId;
		const sql = yield* SqlClient.SqlClient;
		yield* sql`SELECT set_config('app.current_tenant', ${id}, true)`;
		const withContext = context ? Effect.provideService(effect, Context, context) : effect;
		return yield* Effect.locally(withContext, _ref, id);
	});

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Tenant = {
	Context,
	within,
	withinSync,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Tenant {
	export type Context = typeof Tenant.Context.Service;
	export type Id = typeof Tenant.Context.Id[keyof typeof Tenant.Context.Id];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Tenant };
