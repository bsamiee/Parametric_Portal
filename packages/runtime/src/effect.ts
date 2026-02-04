import { AsyncState } from '@parametric-portal/types/async';
import { Cache, Duration, Effect, Fiber, type ManagedRuntime, Option, Schedule, identity } from 'effect';
import { type DependencyList, use, useCallback, useMemo, useEffect as useReactEffect, useRef, useState } from 'react';
import { Runtime } from './runtime';

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	cache: { capacity: 1, key: 'resource', ttl: Duration.infinity },
	span:  { mutate: 'runtime.effect.mutate', run: 'runtime.effect.run', suspense: 'runtime.effect.suspense' },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _deriveStatus = <A, E>(state: AsyncState.Of<A, E>) => ({
	isError: AsyncState.$is('Failure')(state),
	isIdle: AsyncState.$is('Idle')(state),
	isPending: AsyncState.$is('Loading')(state),
	isSuccess: AsyncState.$is('Success')(state),
}) as const;
const _buildResult = <A, E>(state: AsyncState.Of<A, E>) => ({
	..._deriveStatus(state),
	data: Option.getOrNull(AsyncState.getData(state)),
	error: Option.getOrNull(AsyncState.getError(state)),
	state,
}) as const;
const _withMiddleware = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	config: { readonly retry?: RuntimeEffect.RetryConfig<E>; readonly timeout?: Duration.DurationInput },): Effect.Effect<A, E, R> =>
	effect.pipe(
		config.timeout ? Effect.timeoutFail({ duration: config.timeout, onTimeout: () => new Error('Timeout') as E }) : identity,
		config.retry ? Effect.retry({ schedule: config.retry.schedule, while: config.retry.while }) : identity,
	);

// --- [HOOKS] -----------------------------------------------------------------

const _useFiber = <R>(runtime: ManagedRuntime.ManagedRuntime<R, never>) => {
	const fiberRef = useRef<Option.Option<Fiber.RuntimeFiber<unknown, unknown>>>(Option.none());
	const interrupt = useCallback(
		(): void => void Option.map(fiberRef.current, (fiber) => {
			runtime.runFork(Fiber.interrupt(fiber));
			fiberRef.current = Option.none();
		}),
		[runtime],
	);
	const fork = useCallback(
		<A, E>(program: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> => {
			const fiber = runtime.runFork(program);
			fiberRef.current = Option.some(fiber as Fiber.RuntimeFiber<unknown, unknown>);
			return fiber;
		},
		[runtime],
	);
	return { fork, interrupt } as const;
};
const _useRun = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	deps: DependencyList,
	options?: RuntimeEffect.RunOptions<A, E>,): RuntimeEffect.RunResult<A, E> => {
	const runtime = Runtime.use<R, never>();
	const [state, setState] = useState<AsyncState.Of<A, E>>(AsyncState.idle());
	const { fork, interrupt } = _useFiber(runtime);
	const executionRef = useRef(0);
	const execute = useCallback(() => {
		interrupt();
		executionRef.current += 1;
		const id = executionRef.current;
		const isCurrent = () => executionRef.current === id;
		const enabled = options?.enabled ?? true;
		setState(enabled ? AsyncState.loading() : AsyncState.idle());
		enabled && fork(
			_withMiddleware(effect, { retry: options?.retry, timeout: options?.timeout }).pipe(
				Effect.tap((value) => Effect.sync(() => { isCurrent() && options?.onSuccess?.(value); isCurrent() && setState(AsyncState.success(value)); })),
				Effect.tapError((error) => Effect.sync(() => { isCurrent() && options?.onError?.(error); isCurrent() && setState(AsyncState.failure(error)); })),
				Effect.ensuring(Effect.sync(() => { isCurrent() && options?.onSettled?.(); })),
				Effect.withSpan(options?.span ?? _B.span.run),
			),
		);
	}, [fork, interrupt, effect, options]);
	useReactEffect(() => { execute(); return interrupt; }, [execute, ...deps]);
	return { ..._buildResult(state), refetch: execute };
};
const _useMutate = <A, I, E, R>(
	effectFn: (input: I) => Effect.Effect<A, E, R>,
	options?: RuntimeEffect.MutateOptions<A, I, E>,): RuntimeEffect.MutateResult<A, I, E> => {
	const runtime = Runtime.use<R, never>();
	const [state, setState] = useState<AsyncState.Of<A, E>>(AsyncState.idle());
	const { fork, interrupt } = _useFiber(runtime);
	const reset = useCallback(() => { interrupt(); setState(AsyncState.idle()); }, [interrupt]);
	const mutateAsync = useCallback((input: I): Promise<A> => {
		interrupt();
		options?.onMutate?.(input);
		const optimistic = options?.optimistic?.(input);
		setState(optimistic === undefined ? AsyncState.loading() : AsyncState.success(optimistic));
		const fiber = fork(
			_withMiddleware(effectFn(input), { retry: options?.retry, timeout: options?.timeout }).pipe(
				Effect.tap((value) => Effect.sync(() => { options?.onSuccess?.(value, input); setState(AsyncState.success(value)); })),
				Effect.tapError((error) => Effect.sync(() => { options?.onError?.(error, input); setState(AsyncState.failure(error)); })),
				Effect.ensuring(Effect.sync(() => { options?.onSettled?.(input); })),
				Effect.withSpan(options?.span ?? _B.span.mutate),
			),
		);
		return runtime.runPromise(Fiber.join(fiber));
	}, [fork, interrupt, runtime, effectFn, options]);
	const mutate = useCallback((input: I) => { void mutateAsync(input); }, [mutateAsync]);
	return { ..._buildResult(state), mutate, mutateAsync, reset };
};
const _useSuspense = <A, E, R>(effect: Effect.Effect<A, E, R>, options?: RuntimeEffect.SuspenseOptions): A => {
	const runtime = Runtime.use<R, never>();
	const cache = useMemo(
		() => runtime.runSync(Cache.make({
			capacity: options?.cache?.capacity ?? _B.cache.capacity,
			lookup: (_key: string) => effect,
			timeToLive: options?.cache?.ttl ?? _B.cache.ttl,
		})),
		[runtime, effect, options?.cache?.capacity, options?.cache?.ttl],
	);
	const key = options?.cache?.key ?? _B.cache.key;
	const cached = runtime.runSync(cache.getOptionComplete(key));
	return Option.isSome(cached)
		? cached.value
		: use(runtime.runPromise(cache.get(key).pipe(Effect.withSpan(options?.span ?? _B.span.suspense))));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const RuntimeEffect = {
	exponential: (base: Duration.DurationInput = Duration.millis(100), maxRetries = 3) => Schedule.exponential(base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(maxRetries))),
	fixed: (interval: Duration.DurationInput, times = 3) => Schedule.fixed(interval).pipe(Schedule.intersect(Schedule.recurs(times))),
	mutate: _useMutate,
	run: _useRun,
	suspense: _useSuspense,
	timeouts: { long: Duration.seconds(30), medium: Duration.seconds(15), short: Duration.seconds(5) },
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace RuntimeEffect {
	export type RetryConfig<E> = { readonly schedule: Schedule.Schedule<unknown, E, never>; readonly while?: (error: E) => boolean };
	export type RunOptions<A, E> = {
		readonly enabled?: boolean;
		readonly onError?: (error: E) => void;
		readonly onSettled?: () => void;
		readonly onSuccess?: (value: A) => void;
		readonly retry?: RetryConfig<E>;
		readonly span?: string;
		readonly timeout?: Duration.DurationInput;
	};
	export type RunResult<A, E> = {
		readonly data: A | null;
		readonly error: E | null;
		readonly isError: boolean;
		readonly isIdle: boolean;
		readonly isPending: boolean;
		readonly isSuccess: boolean;
		readonly refetch: () => void;
		readonly state: AsyncState.Of<A, E>;
	};
	export type MutateOptions<A, I, E> = {
		readonly onError?: (error: E, input: I) => void;
		readonly onMutate?: (input: I) => void;
		readonly onSettled?: (input: I) => void;
		readonly onSuccess?: (value: A, input: I) => void;
		readonly optimistic?: (input: I) => A;
		readonly retry?: RetryConfig<E>;
		readonly span?: string;
		readonly timeout?: Duration.DurationInput;
	};
	export type MutateResult<A, I, E> = {
		readonly data: A | null;
		readonly error: E | null;
		readonly isError: boolean;
		readonly isIdle: boolean;
		readonly isPending: boolean;
		readonly isSuccess: boolean;
		readonly mutate: (input: I) => void;
		readonly mutateAsync: (input: I) => Promise<A>;
		readonly reset: () => void;
		readonly state: AsyncState.Of<A, E>;
	};
	export type SuspenseOptions = { readonly cache?: CacheConfig; readonly span?: string };
	export type CacheConfig = { readonly capacity?: number; readonly key?: string; readonly ttl?: Duration.DurationInput };
}

// --- [EXPORT] ----------------------------------------------------------------

export { RuntimeEffect };
