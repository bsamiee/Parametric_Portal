/** Unified AsyncState namespace: type + constructors + guards + timing utilities. */
import { Match, Schema as S } from 'effect';
import { DurationMs, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type AsyncHookReturn<A, E, Actions extends object> = { readonly state: AsyncState<A, E> } & Actions;
type MutateActions<I> = { readonly mutate: (input: I) => void; readonly reset: () => void };
type BoundaryActions<E> = { readonly error: import('effect').Cause.Cause<E> | null; readonly reset: () => void };
type AsyncState<A = unknown, E = Error> =
	| IdleClass
	| LoadingClass
	| (SuccessClass & { readonly data: A })
	| (FailureClass & { readonly error: E });

// --- [SCHEMA] ----------------------------------------------------------------

const AsyncStateSchema = <A extends S.Schema.Any, E extends S.Schema.Any>(dataSchema: A, errorSchema: E) =>
	S.Union(
		IdleClass,
		LoadingClass,
		S.Struct({ _tag: S.Literal('Success'), data: dataSchema, timestamp: Timestamp.schema }),
		S.Struct({ _tag: S.Literal('Failure'), error: errorSchema, timestamp: Timestamp.schema }),
	);

// --- [CLASSES] ---------------------------------------------------------------

class IdleClass extends S.TaggedClass<IdleClass>()('Idle', {}) {}
class LoadingClass extends S.TaggedClass<LoadingClass>()('Loading', { startedAt: Timestamp.schema }) {}
class SuccessClass extends S.TaggedClass<SuccessClass>()('Success', { data: S.Unknown, timestamp: Timestamp.schema }) {}
class FailureClass extends S.TaggedClass<FailureClass>()('Failure', { error: S.Unknown, timestamp: Timestamp.schema }) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const tagIs =
	<Tag extends AsyncState['_tag']>(tag: Tag) =>
	<A, E>(state: AsyncState<A, E>): state is Extract<AsyncState<A, E>, { readonly _tag: Tag }> =>
		state._tag === tag;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const timingExtractors = Object.freeze({
	age: {
		Failure: (s: FailureClass, now: Timestamp): DurationMs => (now - s.timestamp) as DurationMs,
		Idle: (): DurationMs => DurationMs.zero,
		Loading: (): DurationMs => DurationMs.zero,
		Success: (s: SuccessClass, now: Timestamp): DurationMs => (now - s.timestamp) as DurationMs,
	},
	elapsed: {
		Failure: (): DurationMs => DurationMs.zero,
		Idle: (): DurationMs => DurationMs.zero,
		Loading: (s: LoadingClass, now: Timestamp): DurationMs => (now - s.startedAt) as DurationMs,
		Success: (): DurationMs => DurationMs.zero,
	},
});

const timing =
	(mode: keyof typeof timingExtractors) =>
	<A, E>(state: AsyncState<A, E>, now: Timestamp = Timestamp.nowSync()): DurationMs =>
		timingExtractors[mode][state._tag](state as never, now);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AsyncState = Object.freeze({
	$is: Object.freeze({
		Failure: tagIs('Failure'),
		Idle: tagIs('Idle'),
		Loading: tagIs('Loading'),
		Success: tagIs('Success'),
	}),
	$match: <A, E, R>(
		state: AsyncState<A, E>,
		handlers: {
			Failure: (s: FailureClass & { readonly error: E }) => R;
			Idle: (s: IdleClass) => R;
			Loading: (s: LoadingClass) => R;
			Success: (s: SuccessClass & { readonly data: A }) => R;
		},
	): R => Match.valueTags(state, handlers) as R,
	age: timing('age'),
	elapsed: timing('elapsed'),
	Failure: <A = unknown, E = Error>(error: E, timestamp: Timestamp = Timestamp.nowSync()): AsyncState<A, E> =>
		new FailureClass({ error, timestamp }) as AsyncState<A, E>,
	Idle: <A = unknown, E = Error>(): AsyncState<A, E> => new IdleClass() as AsyncState<A, E>,
	Loading: <A = unknown, E = Error>(startedAt: Timestamp = Timestamp.nowSync()): AsyncState<A, E> =>
		new LoadingClass({ startedAt }) as AsyncState<A, E>,
	map: <A, E, R>(
		state: AsyncState<A, E>,
		f: (a: A) => R,
		ts: () => Timestamp = Timestamp.nowSync,
	): AsyncState<R, E> =>
		Match.valueTags(state, {
			Failure: (s) => new FailureClass({ error: s.error, timestamp: s.timestamp }) as AsyncState<R, E>,
			Idle: () => new IdleClass() as AsyncState<R, E>,
			Loading: (s) => new LoadingClass({ startedAt: s.startedAt }) as AsyncState<R, E>,
			Success: (s) => new SuccessClass({ data: f(s.data), timestamp: ts() }) as AsyncState<R, E>,
		}),
	Success: <A, E = Error>(data: A, timestamp: Timestamp = Timestamp.nowSync()): AsyncState<A, E> =>
		new SuccessClass({ data, timestamp }) as AsyncState<A, E>,
	schema: AsyncStateSchema,
});

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncState, AsyncStateSchema };
export type { AsyncHookReturn, BoundaryActions, MutateActions };
