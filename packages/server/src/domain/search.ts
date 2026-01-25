/**
 * Search domain service with tenant context, audit logging, and metrics.
 * Wraps raw SearchService with automatic scopeId extraction from Context.Request.
 *
 * ARCHITECTURE: Accesses SearchService directly (not via DatabaseService).
 * This decoupling enables clean layer composition - both services can be
 * in the same tier since neither depends on the other.
 */
import { SearchService } from '@parametric-portal/database/search';
import { Effect, Option } from 'effect';
import { Context } from '../context.ts';
import { AuditService } from './audit.ts';
import { MetricsService } from '../infra/metrics.ts';

// --- [SERVICES] --------------------------------------------------------------

class SearchDomainService extends Effect.Service<SearchDomainService>()('server/SearchDomain', {
	effect: Effect.gen(function* () {
		const search = yield* SearchService;
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
				yield* audit.log('search', userIdFromContext(ctx), 'query', {
					after: { entityTypes: options.entityTypes, resultCount: result.total, term: options.term },
				});
				yield* MetricsService.inc(metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return result;
			}).pipe(Effect.withSpan('search.query', { attributes: { term: options.term } }));
		const suggest = (options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* search.suggest({ ...options, scopeId: scopeFromContext(ctx) });
				yield* audit.log('search', userIdFromContext(ctx), 'suggest', {
					after: { prefix: options.prefix, resultCount: result.length },
				});
				yield* MetricsService.inc(metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return result;
			}).pipe(Effect.withSpan('search.suggest'));
		const refresh = (includeGlobal = false) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = scopeFromContext(ctx);
				yield* search.refresh(scopeId, includeGlobal);
				yield* audit.log('search', Option.match(ctx.session, { onNone: () => 'system', onSome: (s) => s.userId }), 'refresh', {
					after: { includeGlobal, scopeId },
				});
				yield* MetricsService.inc(metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId }), 1);
			}).pipe(Effect.withSpan('search.refresh'));
		return { query, refresh, suggest };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchDomainService };
