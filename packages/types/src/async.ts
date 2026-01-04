/**
 * Model async operation lifecycle via tagged enum ADT.
 * Provides type-safe state transitions and functional transformations.
 */
import { Data, Schema as S } from 'effect';
import { type DurationMs, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type AsyncHookReturn<A, E, Actions extends object> = { readonly state: AsyncState<A, E> } & Actions;
type MutateActions<I> = { readonly mutate: (input: I) => void; readonly reset: () => void };
type AsyncState<A = unknown, E = Error> = Data.TaggedEnum<{
	// biome-ignore lint/complexity/noBannedTypes: Data.TaggedEnum requires {} for empty variant
	Idle: {};
	Loading: { readonly startedAt: Timestamp };
	Success: { readonly data: A; readonly timestamp: Timestamp };
	Failure: { readonly error: E; readonly timestamp: Timestamp };
}>;
type AsyncStateTag = AsyncState<unknown, unknown>['_tag'];
interface AsyncStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
	readonly taggedEnum: AsyncState<this['A'], this['B']>;
}

// --- [SCHEMA] ----------------------------------------------------------------

const AsyncStateSchema = <A extends S.Schema.Any, E extends S.Schema.Any>(dataSchema: A, errorSchema: E) =>
	S.Union(
		S.Struct({ _tag: S.Literal('Idle') }),
		S.Struct({ _tag: S.Literal('Loading'), startedAt: Timestamp.schema }),
		S.Struct({ _tag: S.Literal('Success'), data: dataSchema, timestamp: Timestamp.schema }),
		S.Struct({ _tag: S.Literal('Failure'), error: errorSchema, timestamp: Timestamp.schema }),
	);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const { $is, $match, Failure, Idle, Loading, Success } = Data.taggedEnum<AsyncStateDefinition>();
/** Check if state represents active loading operation (null-safe). */
const isPending = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): boolean => s != null && $is('Loading')(s);
/** Convert state tag to lowercase HTML attribute value. */
const toAttr = <A = unknown, E = unknown>(s: AsyncState<A, E> | undefined): Lowercase<AsyncStateTag> =>
	s == null ? 'idle' : s._tag.toLowerCase() as Lowercase<AsyncStateTag>;
/** Transform success data while preserving timestamp and other variants. */
const mapSuccess = <A, E, B>(s: AsyncState<A, E>, f: (a: A) => B): AsyncState<B, E> =>
	$match(s, { Failure: (x) => Failure(x), Idle: () => Idle(), Loading: (l) => Loading(l), Success: (x) => Success({ data: f(x.data), timestamp: x.timestamp }) });
/** Extract success data or fallback value for failed/incomplete states. */
const getOrElse = <A, E>(s: AsyncState<A, E>, fallback: A): A =>
	s._tag === 'Success' ? s.data : fallback;
/** Calculate elapsed time for loading operations, null otherwise. */
const toDuration = <A, E>(s: AsyncState<A, E>): DurationMs | null =>
	$match(s, { Failure: () => null, Idle: () => null, Loading: (l) => Timestamp.diff(Timestamp.nowSync(), l.startedAt), Success: () => null });

// --- [ENTRY_POINT] -----------------------------------------------------------

/** Frozen ADT factory with enhanced constructors accepting default timestamps. */
const AsyncState = Object.freeze({
	$is,
	$match,
	Failure: <E>(error: E, timestamp: Timestamp = Timestamp.nowSync()) => Failure({ error, timestamp }),
	getOrElse,
	Idle: () => Idle(),
	isPending,
	Loading: (startedAt: Timestamp = Timestamp.nowSync()) => Loading({ startedAt }),
	mapSuccess,
	Success: <A>(data: A, timestamp: Timestamp = Timestamp.nowSync()) => Success({ data, timestamp }),
	toAttr,
	toDuration,
});

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncState, AsyncStateSchema };
export type { AsyncHookReturn, AsyncState as AsyncStateType, AsyncStateTag, MutateActions };
