/**
 * Search domain service with tenant context, audit logging, and metrics.
 * Wraps raw SearchRepo with automatic scopeId extraction from Context.Request.
 *
 * ARCHITECTURE: Accesses SearchRepo directly (not via DatabaseService).
 * This decoupling enables clean layer composition - both services can be
 * in the same tier since neither depends on the other.
 *
 * AUDIT PATTERN: Domain layer owns audit for reusable services.
 * Routes delegate to domain methods and do NOT duplicate audit calls.
 * This ensures consistent audit regardless of entry point (API, jobs, etc.).
 */
import { SearchRepo } from '@parametric-portal/database/search';
import { Effect, Option } from 'effect';
import { Context } from '../context.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('server/Search', {
	effect: Effect.gen(function* () {
		const search = yield* SearchRepo;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const scopeFromContext = (ctx: Context.Request.Data) => ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
		const userIdFromContext = (ctx: Context.Request.Data) => Option.match(ctx.session, { onNone: () => 'anonymous', onSome: (s) => s.userId });
		const query = (options: {
			readonly embedding?: readonly number[];
			readonly entityTypes?: readonly ('app' | 'asset' | 'auditLog' | 'user')[];
			readonly includeFacets?: boolean;
			readonly includeGlobal?: boolean;
			readonly includeSnippets?: boolean;
			readonly term: string;
		}, pagination?: { cursor?: string; limit?: number }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* search.search({ ...options, scopeId: scopeFromContext(ctx) }, pagination);
				yield* audit.log('Search.query', {
					details: { entityTypes: options.entityTypes, resultCount: result.total, term: options.term },
					subjectId: userIdFromContext(ctx),
				});
				yield* MetricsService.inc(metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return result;
			}).pipe(Effect.withSpan('search.query', { attributes: { term: options.term } }));
		const suggest = (options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* search.suggest({ ...options, scopeId: scopeFromContext(ctx) });
				yield* audit.log('Search.suggest', {
					details: { prefix: options.prefix, resultCount: result.length },
					subjectId: userIdFromContext(ctx),
				});
				yield* MetricsService.inc(metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return result;
			}).pipe(Effect.withSpan('search.suggest'));
		const refresh = (includeGlobal = false) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = scopeFromContext(ctx);
				yield* search.refresh(scopeId, includeGlobal);
				yield* audit.log('Search.refresh', {
					details: { includeGlobal, scopeId },
					subjectId: Option.match(ctx.session, { onNone: () => 'system', onSome: (s) => s.userId }),
				});
				yield* MetricsService.inc(metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId }), 1);
			}).pipe(Effect.withSpan('search.refresh'));
		return { query, refresh, suggest };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchService };
