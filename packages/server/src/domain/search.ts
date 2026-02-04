/**
 * Search domain service with tenant-scoped queries, audit logging, and metrics.
 * Wraps SearchRepo with automatic scopeId extraction from Context.Request.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { Array as A, Cron, Effect, Option, pipe } from 'effect';
import { constant } from 'effect/Function';
import { createHash } from 'node:crypto';
import { Context } from '../context.ts';
import { ClusterService } from '../infra/cluster.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	embedding: { dimensions: 1536, scale: 255 },
	text: { joiner: ' ' },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _embedText = (text: string): ReadonlyArray<number> => {
	const bytes = createHash('sha256').update(text).digest();
	const max = bytes.length;
	return Array.from({ length: _CONFIG.embedding.dimensions }, (_, index) => (bytes[index % max] ?? 0) / _CONFIG.embedding.scale);
};
const _sourceText = (src: { readonly contentText: string | null; readonly displayText: string; readonly metadata: unknown }) =>
	A.filter([
		src.displayText,
		src.contentText ?? undefined,
		Option.fromNullable(src.metadata).pipe(Option.map((m) => JSON.stringify(m)), Option.getOrUndefined),
	], (value): value is string => value !== undefined && value !== '').join(_CONFIG.text.joiner);

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('server/Search', {
	effect: Effect.gen(function* () {
		const searchRepo = yield* SearchRepo;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const _userId = (ctx: Context.Request.Data, fallback: string) => pipe(ctx.session, Option.map((session) => session.userId), Option.getOrElse(constant(fallback)));
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
		const refreshEmbeddings = (options?: { readonly entityTypes?: readonly ('app' | 'asset' | 'auditLog' | 'user')[]; readonly includeGlobal?: boolean; readonly limit?: number }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
				const userId = _userId(ctx, 'system');
				const sources = yield* searchRepo.embeddingSources({
					entityTypes: options?.entityTypes ?? [],
					includeGlobal: options?.includeGlobal ?? false,
					limit: options?.limit,
					scopeId,
				});
				yield* Effect.forEach(
					sources,
					(src) => searchRepo.upsertEmbedding({
						embedding: _embedText(_sourceText(src)),
						entityId: src.entityId,
						entityType: src.entityType,
						hash: src.hash,
						scopeId: src.scopeId,
					}),
					{ discard: true },
				);
				yield* Effect.all([
					audit.log('Search.refreshEmbeddings', { details: { count: sources.length, includeGlobal: options?.includeGlobal ?? false, scopeId }, subjectId: userId }),
					MetricsService.inc(metrics.search.refreshes, MetricsService.label({ kind: 'embeddings', tenant: ctx.tenantId })),
				], { discard: true });
				return { count: sources.length };
			}).pipe(Telemetry.span('search.refreshEmbeddings', { 'search.includeGlobal': options?.includeGlobal ?? false }));
		const onRefresh = () => searchRepo.onRefresh();
		return { onRefresh, query, refresh, refreshEmbeddings, suggest };
	}),
}) {
	/** Daily embedding refresh across all tenants + global scope */
	static readonly EmbeddingCron = ClusterService.cron({
		cron: Cron.unsafeParse('0 3 * * *'),
		execute: Effect.gen(function* () {
			const [database, search] = yield* Effect.all([DatabaseService, SearchService]);
			const apps = yield* Context.Request.withinSync(
				Context.Request.Id.system,
				database.apps.find([{ field: 'id', op: 'notNull' }]),
				Context.Request.system(),
			);
			yield* Effect.forEach(
				apps,
				(app) => Context.Request.withinSync(app.id, search.refreshEmbeddings({ includeGlobal: false }), Context.Request.system()),
				{ concurrency: 5, discard: true },
			);
			yield* Context.Request.withinSync(Context.Request.Id.system, search.refreshEmbeddings({ includeGlobal: true }), Context.Request.system());
		}),
		name: 'refresh-embeddings',
	});
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchService };
