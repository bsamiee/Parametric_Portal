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
import { Effect, Option, pipe } from 'effect';
import { constant } from 'effect/Function';
import { Context } from '../context.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('server/Search', {
	effect: Effect.gen(function* () {
		const searchRepo = yield* SearchRepo;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const _userId = (ctx: Context.Request.Data, fallback: string) => pipe(ctx.session, Option.map((s) => s.userId), Option.getOrElse(constant(fallback)));
		const query = (
			options: {
				readonly embedding?: readonly number[];
				readonly entityTypes?: readonly ('app' | 'asset' | 'auditLog' | 'user')[];
				readonly includeFacets?: boolean;
				readonly includeGlobal?: boolean;
				readonly includeSnippets?: boolean;
				readonly term: string;
			},
			pagination?: { cursor?: string; limit?: number },) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
				const userId = _userId(ctx, 'anonymous');
				const result = yield* searchRepo.search({ ...options, scopeId }, pagination);
				yield* Effect.all([
					audit.log('Search.query', {
						details: { entityTypes: options.entityTypes, resultCount: result.total, term: options.term },
						subjectId: userId,
					}),
					MetricsService.inc(metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId })),
				], { discard: true });
				return result;
			}).pipe(Telemetry.span('search.query', { 'search.term': options.term }));
		const suggest = (options: { readonly includeGlobal?: boolean; readonly limit?: number; readonly prefix: string }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
				const userId = _userId(ctx, 'anonymous');
				const result = yield* searchRepo.suggest({ ...options, scopeId });
				yield* Effect.all([
					audit.log('Search.suggest', {
						details: { prefix: options.prefix, resultCount: result.length },
						subjectId: userId,
					}),
					MetricsService.inc(metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId })),
				], { discard: true });
				return result;
			}).pipe(Telemetry.span('search.suggest', { 'search.prefix': options.prefix }));
		const refresh = (includeGlobal = false) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
				const userId = _userId(ctx, 'system');
				yield* searchRepo.refresh(scopeId, includeGlobal);
				yield* Effect.all([
					audit.log('Search.refresh', { details: { includeGlobal, scopeId }, subjectId: userId }),
					MetricsService.inc(metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId })),
				], { discard: true });
			}).pipe(Telemetry.span('search.refresh', { 'search.includeGlobal': includeGlobal }));
		return { query, refresh, suggest };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchService };
