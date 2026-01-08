/**
 * Model async operation lifecycle via tagged enum ADT.
 * Provides type-safe state transitions, functional transformations, and ROP bridges.
 *
 * Design decisions:
 * - Pure constructors (*At) require explicit timestamps for referential transparency
 * - Convenience constructors use Timestamp.nowSync() internally (pragmatic for React)
 * - Accessors return Option<T> instead of T | null (strict FP)
 * - ROP bridges (toOption, toEither, toEffect) enable railway composition
 * - Complete algebra: Functor (mapSuccess), Bifunctor (mapError), Monad (flatMap)
 */
import { Data, Effect, Either, Option, Schema as S } from 'effect';
import { type DurationMs, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type AsyncHookReturn<A, E, Actions extends object> = { readonly state: AsyncState<A, E> } & Actions;
type MutateActions<I> = { readonly mutate: (input: I) => void; readonly reset: () => void };
type AsyncState<A = unknown, E = unknown> = Data.TaggedEnum<{ /** Standardize on E = unknown (more honest since we don't constrain). */
	Idle: { readonly _brand?: never };
	Loading: { readonly startedAt: Timestamp };
	Success: { readonly data: A; readonly timestamp: Timestamp };
	Failure: { readonly error: E; readonly timestamp: Timestamp };
}>;
type AsyncStateTag = AsyncState<unknown, unknown>['_tag'];

interface AsyncStateDefinition extends Data.TaggedEnum.WithGenerics<2> { readonly taggedEnum: AsyncState<this['A'], this['B']>; }

// --- [SCHEMA] ----------------------------------------------------------------

const AsyncStateSchema = <A extends S.Schema.Any, E extends S.Schema.Any>(dataSchema: A, errorSchema: E) =>
	S.Union(
		S.Struct({ _tag: S.Literal('Idle') }),
		S.Struct({ _tag: S.Literal('Loading'), startedAt: Timestamp.schema }),
		S.Struct({ _tag: S.Literal('Success'), data: dataSchema, timestamp: Timestamp.schema }),
		S.Struct({ _tag: S.Literal('Failure'), error: errorSchema, timestamp: Timestamp.schema }),
	);

// --- [CLASSES] ---------------------------------------------------------------

class NotReady extends Data.TaggedError('NotReady')<{ /** NotReady error for ROP bridges when state is Idle or Loading. */
	readonly state: 'Idle' | 'Loading';
}> {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const { $is, $match, Failure, Idle, Loading, Success } = Data.taggedEnum<AsyncStateDefinition>();

const toDurationAt = <A, E>(s: AsyncState<A, E>, now: Timestamp): Option.Option<DurationMs> => s._tag === 'Loading' ? Option.some(Timestamp.diff(now, s.startedAt)) : Option.none();
const toDuration = <A, E>(s: AsyncState<A, E>): Effect.Effect<Option.Option<DurationMs>> => Effect.sync(() => toDurationAt(s, Timestamp.nowSync()));
const IdleAt = (): AsyncState<never, never> => Idle();
const LoadingAt = (startedAt: Timestamp): AsyncState<never, never> => Loading({ startedAt });
const SuccessAt = <A>(data: A, timestamp: Timestamp): AsyncState<A, never> => Success({ data, timestamp });
const FailureAt = <E>(error: E, timestamp: Timestamp): AsyncState<never, E> => Failure({ error, timestamp });

// --- [PREDICATES]
const isPending = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): boolean => s != null && $is('Loading')(s);
const isSuccess = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): boolean => s != null && $is('Success')(s);
const isFailure = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): boolean => s != null && $is('Failure')(s);
const isIdle = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): boolean => s != null && $is('Idle')(s);

// --- [ACCESSORS]

const toAttr = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): Lowercase<AsyncStateTag> => s == null ? 'idle' : (s._tag.toLowerCase() as Lowercase<AsyncStateTag>);
const getData = <A, E>(s: AsyncState<A, E>): Option.Option<A> => s._tag === 'Success' ? Option.some(s.data) : Option.none();
const getError = <A, E>(s: AsyncState<A, E>): Option.Option<E> => s._tag === 'Failure' ? Option.some(s.error) : Option.none();
const getOrElse = <A, E>(s: AsyncState<A, E>, fallback: A): A => s._tag === 'Success' ? s.data : fallback;

// --- [ALGEBRA]

/** Functor: Transform success data while preserving timestamp and other variants. */
const mapSuccess = <A, E, B>(s: AsyncState<A, E>, f: (a: A) => B): AsyncState<B, E> =>
	$match(s, {
		Failure: (x) => Failure(x),
		Idle: () => Idle(),
		Loading: (l) => Loading(l),
		Success: (x) => Success({ data: f(x.data), timestamp: x.timestamp }),
	});
/** Bifunctor: Transform error while preserving timestamp and other variants. */
const mapError = <A, E, E2>(s: AsyncState<A, E>, f: (e: E) => E2): AsyncState<A, E2> =>
	$match(s, {
		Failure: (x) => Failure({ error: f(x.error), timestamp: x.timestamp }),
		Idle: () => Idle(),
		Loading: (l) => Loading(l),
		Success: (x) => Success(x),
	});
/** Monad: Chain success state into another AsyncState computation. */
const flatMap = <A, E, B>(s: AsyncState<A, E>, f: (a: A) => AsyncState<B, E>): AsyncState<B, E> => s._tag === 'Success' ? f(s.data) : (s as AsyncState<never, E> as AsyncState<B, E>);
const match = <A, E, R>(
	s: AsyncState<A, E>,
	cases: {
		readonly onIdle: () => R;
		readonly onLoading: (startedAt: Timestamp) => R;
		readonly onSuccess: (data: A, timestamp: Timestamp) => R;
		readonly onFailure: (error: E, timestamp: Timestamp) => R;
	},
): R =>
	$match(s, {
		Failure: ({ error, timestamp }) => cases.onFailure(error, timestamp),
		Idle: cases.onIdle,
		Loading: ({ startedAt }) => cases.onLoading(startedAt),
		Success: ({ data, timestamp }) => cases.onSuccess(data, timestamp),
	}) as R;

// --- [ROP_BRIDGES]

const toOption = <A, E>(s: AsyncState<A, E>): Option.Option<A> => s._tag === 'Success' ? Option.some(s.data) : Option.none();
const toEither = <A, E>(s: AsyncState<A, E>): Either.Either<A, E | NotReady> =>
	$match(s, {
		Failure: ({ error }) => Either.left(error),
		Idle: () => Either.left(new NotReady({ state: 'Idle' })),
		Loading: () => Either.left(new NotReady({ state: 'Loading' })),
		Success: ({ data }) => Either.right(data),
	});
const toEffect = <A, E>(s: AsyncState<A, E>): Effect.Effect<A, E | NotReady> =>
	$match(s, {
		Failure: ({ error }) => Effect.fail(error),
		Idle: () => Effect.fail(new NotReady({ state: 'Idle' })),
		Loading: () => Effect.fail(new NotReady({ state: 'Loading' })),
		Success: ({ data }) => Effect.succeed(data),
	});
const fromEffect = <A, E>(
	effect: Effect.Effect<A, E>,
	setState: (s: AsyncState<A, E>) => void,
): Effect.Effect<void, never, never> =>
	Effect.sync(() => setState(Loading({ startedAt: Timestamp.nowSync() }))).pipe(
		Effect.flatMap(() => effect),
		Effect.matchEffect({
			onFailure: (error) => Effect.sync(() => setState(Failure({ error, timestamp: Timestamp.nowSync() }))),
			onSuccess: (data) => Effect.sync(() => setState(Success({ data, timestamp: Timestamp.nowSync() }))),
		}),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AsyncState = Object.freeze({
	// Type guards
	$is,
	$match,
	// Convenience constructors (implicit Timestamp.nowSync)
	Failure: <E>(error: E, timestamp: Timestamp = Timestamp.nowSync()) => Failure({ error, timestamp }),
	// Pure constructors (explicit timestamps)
	FailureAt,
	// Algebra
	flatMap,
	// ROP bridges
	fromEffect,
	// Accessors (Option-returning)
	getData,
	getError,
	getOrElse,
	Idle: () => Idle(),
	IdleAt,
	// Predicates
	isFailure,
	isIdle,
	isPending,
	isSuccess,
	Loading: (startedAt: Timestamp = Timestamp.nowSync()) => Loading({ startedAt }),
	LoadingAt,
	mapError,
	mapSuccess,
	match,
	// Error type for ROP bridges
	NotReady,
	Success: <A>(data: A, timestamp: Timestamp = Timestamp.nowSync()) => Success({ data, timestamp }),
	SuccessAt,
	toAttr,
	// Duration
	toDuration,
	toDurationAt,
	toEffect,
	toEither,
	toOption,
});

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncState, AsyncStateSchema };
export type { AsyncHookReturn, AsyncState as AsyncStateType, AsyncStateTag, MutateActions, NotReady };
