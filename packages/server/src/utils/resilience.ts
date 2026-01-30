/**
 * Resilience: bulkhead → timeout → hedge → retry → circuit → fallback → memo → span
 * Native Effect APIs: cachedWithTTL (memo), Semaphore (bulkhead), raceAll (hedge)
 */
import { Data, Duration, Effect, Match, Option, pipe, Schedule } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Circuit } from './circuit.ts';

// --- [ERRORS] ----------------------------------------------------------------

class TimeoutError extends Data.TaggedError('TimeoutError')<{ readonly operation: string; readonly durationMs: number }> {
	static readonly of = (op: string, d: Duration.Duration) => new TimeoutError({ durationMs: Duration.toMillis(d), operation: op });
	override get message() { return `TimeoutError: ${this.operation} exceeded ${this.durationMs}ms`; }
}
class BulkheadError extends Data.TaggedError('BulkheadError')<{ readonly operation: string; readonly permits: number }> {
	static readonly of = (op: string, permits: number) => new BulkheadError({ operation: op, permits });
	override get message() { return `BulkheadError: ${this.operation} rejected (${this.permits} permits)`; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _config = (() => {
	const mkSchedules = <const T extends Record<string, Schedule.Schedule<unknown, unknown, never>>>(t: T) => ({ ...t, true: t['default'] });
	return {
		defaults: { bulkhead: 10, hedgeDelay: Duration.millis(100), threshold: 5, timeout: Duration.seconds(30) },
		memos: new Map<string, Effect.Effect<unknown, unknown, unknown>>(),
		nonRetriable: new Set(['Auth', 'Conflict', 'Forbidden', 'Gone', 'NotFound', 'RateLimit', 'TimeoutError', 'Validation']) as ReadonlySet<string>,
		schedules: mkSchedules({
			default: Schedule.exponential(Duration.millis(100), 2).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)), Schedule.upTo(Duration.seconds(10))),
			fast: Schedule.exponential(Duration.millis(50), 1.5).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(2)), Schedule.upTo(Duration.seconds(2))),
			slow: Schedule.exponential(Duration.millis(500), 2).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(5)), Schedule.upTo(Duration.seconds(30))),
		}),
		sems: new Map<string, Effect.Effect<Effect.Semaphore>>(),
	} as const;
})();

// --- [FUNCTIONS] -------------------------------------------------------------

const _run = <A, E, R>(op: string, eff: Effect.Effect<A, E, R>, cfg: Resilience.Config<A, E, R> = {}): Effect.Effect<A, Resilience.Error<E>, R> => {
	const timeout = cfg.timeout === false ? undefined : (cfg.timeout ?? _config.defaults.timeout);
	const schedule = Match.value(cfg.retry).pipe(Match.when(false, () => undefined), Match.when(Match.string, (k) => _config.schedules[k]), Match.when(true, () => _config.schedules.default), Match.when(undefined, () => _config.schedules.default), Match.orElse((s) => s));
	const circuitName = cfg.circuit === false ? undefined : (cfg.circuit ?? op);
	const threshold = cfg.threshold ?? _config.defaults.threshold;
	const bulkhead = cfg.bulkhead === false ? undefined : cfg.bulkhead;
	const hedge = Match.value(cfg.hedge).pipe(Match.when(false, () => undefined), Match.when(Match.number, (n) => ({ attempts: Math.max(2, n), delay: _config.defaults.hedgeDelay })), Match.orElse((h) => h));
	const memoTtl = cfg.memoize === true ? Duration.minutes(5) : cfg.memoize;
	const inc = (k: keyof MetricsService['resilience']) => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (m) => MetricsService.inc(m.resilience[k], MetricsService.label({ operation: op })) }));
	const pipeline: Effect.Effect<A, Resilience.Error<E>, R> = Effect.gen(function* () {
		const t0: Effect.Effect<A, E | TimeoutError, R> = timeout === undefined ? eff : eff.pipe(Effect.timeoutFail({ duration: timeout, onTimeout: () => TimeoutError.of(op, timeout) }), Effect.tapErrorTag('TimeoutError', () => inc('timeouts')));
		const t1 = hedge === undefined ? t0 : Effect.raceAll(Array.from({ length: hedge.attempts }, (_, i) => Effect.tapBoth(i === 0 ? t0 : Effect.delay(t0, Duration.times(hedge.delay, i)), { onFailure: () => Effect.void, onSuccess: () => i > 0 ? inc('hedges') : Effect.void })));
		const t2 = schedule === undefined ? t1 : t1.pipe(Effect.tapError(() => inc('retries')), Effect.retry({ schedule, while: (e) => !_config.nonRetriable.has((e as { _tag?: string })?._tag ?? '') }));
		const t3: Effect.Effect<A, Resilience.Error<E>, R> = circuitName === undefined ? t2 : Circuit.make(circuitName, { breaker: { _tag: 'consecutive', threshold } }).execute(t2).pipe(Effect.catchIf((e) => Circuit.is(e, 'Cancelled'), Effect.die));
		const fb = cfg.fallback;
		return fb === undefined ? yield* t3 : yield* t3.pipe(Effect.catchIf((e): e is E | TimeoutError => !Circuit.is(e), (e) => Effect.zipRight(inc('fallbacks'), fb(e))));
	});
	const bulkheadTimeout = cfg.bulkheadTimeout;
	const withBulkhead: Effect.Effect<A, Resilience.Error<E>, R> = bulkhead === undefined ? pipeline : pipe(
		Option.fromNullable(_config.sems.get(op)),
		Option.match({ onNone: () => Effect.cached(Effect.makeSemaphore(bulkhead)).pipe(Effect.tap((c) => Effect.sync(() => { _config.sems.set(op, c); }))), onSome: Effect.succeed }),
		Effect.flatten,
		Effect.flatMap((sem) => sem.withPermits(1)(pipeline)),
		(e) => bulkheadTimeout === undefined ? e : e.pipe(Effect.timeoutFail({ duration: bulkheadTimeout, onTimeout: () => BulkheadError.of(op, bulkhead) }), Effect.tapErrorTag('BulkheadError', () => inc('bulkheadRejections'))),
	);
	const withMemo: Effect.Effect<A, Resilience.Error<E>, R> = memoTtl === undefined ? withBulkhead : pipe(
		Option.fromNullable(_config.memos.get(op)),
		Option.match({ onNone: () => Effect.cachedWithTTL(withBulkhead, memoTtl).pipe(Effect.tap((c) => Effect.sync(() => { _config.memos.set(op, c); }))), onSome: Effect.succeed }),
		Effect.flatten,
	) as Effect.Effect<A, Resilience.Error<E>, R>;
	return Telemetry.span(withMemo, `resilience.${op}`, { metrics: false, 'resilience.operation': op });
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Resilience: Resilience = Object.assign(
	<A, E, R>(cfg?: Resilience.Config<A, E, R>) => <This, Args extends unknown[]>(
		target: ((this: This, ...args: Args) => Effect.Effect<A, E, R>) | undefined,
		ctx: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>> | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>>,) => {
		const name = String(ctx.name);
		const wrap = (fn: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => function (this: This, ...args: Args) { return _run(`${(this as { constructor?: { name?: string } })?.constructor?.name ?? 'Anon'}.${name}`, fn.apply(this, args), cfg); };
		return ctx.kind === 'method' && target ? wrap(target) : (init: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => wrap(init);
	},
	{
		Bulkhead: BulkheadError,
		Circuit: Circuit.Error,
		current: Circuit.current,
		defaults: _config.defaults,
		is: ((err: unknown, tag?: 'BulkheadError' | 'CircuitError' | 'TimeoutError') => Match.value(tag).pipe(Match.when('BulkheadError', () => err instanceof BulkheadError), Match.when('CircuitError', () => Circuit.is(err)), Match.when('TimeoutError', () => err instanceof TimeoutError), Match.orElse(() => err instanceof BulkheadError || Circuit.is(err) || err instanceof TimeoutError))) as Resilience['is'],
		run: _run,
		schedules: _config.schedules,
		Timeout: TimeoutError,
	},
);

// --- [NAMESPACE] -------------------------------------------------------------

interface Resilience {
	<A, E, R>(cfg?: Resilience.Config<A, E, R>): <This, Args extends unknown[]>(target: ((this: This, ...args: Args) => Effect.Effect<A, E, R>) | undefined, ctx: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>> | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Effect.Effect<A, E, R>>) => ((this: This, ...args: Args) => Effect.Effect<A, Resilience.Error<E>, R>) | ((init: (this: This, ...args: Args) => Effect.Effect<A, E, R>) => (this: This, ...args: Args) => Effect.Effect<A, Resilience.Error<E>, R>);
	readonly Bulkhead: typeof BulkheadError;
	readonly Circuit: typeof Circuit.Error;
	readonly current: typeof Circuit.current;
	readonly defaults: typeof _config.defaults;
	readonly is: { (err: unknown): err is Resilience.Error<unknown>; (err: unknown, tag: 'BulkheadError'): err is BulkheadError; (err: unknown, tag: 'CircuitError'): err is Circuit.Error; (err: unknown, tag: 'TimeoutError'): err is TimeoutError };
	readonly run: typeof _run;
	readonly schedules: typeof _config.schedules;
	readonly Timeout: typeof TimeoutError;
}
namespace Resilience {
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type BulkheadError = InstanceType<typeof BulkheadError>;
	export type CircuitError = Circuit.Error;
	export type Error<E> = E | TimeoutError | BulkheadError | CircuitError;
	export type RetryMode = keyof typeof _config.schedules | boolean;
	export type Config<A = unknown, E = unknown, R = unknown> = {
		readonly bulkhead?: number | false;
		readonly bulkheadTimeout?: Duration.Duration;
		readonly circuit?: string | false;
		readonly fallback?: (err: E | TimeoutError | BulkheadError) => Effect.Effect<A, never, R>;
		readonly hedge?: number | { readonly attempts: number; readonly delay: Duration.Duration } | false;
		readonly memoize?: Duration.Duration | true;
		readonly retry?: RetryMode | Schedule.Schedule<unknown, unknown, never> | false;
		readonly threshold?: number;
		readonly timeout?: Duration.Duration | false;
	};
}

// --- [EXPORT] ----------------------------------------------------------------

export { Resilience };
