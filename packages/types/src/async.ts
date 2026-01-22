/**
 * Model async operation lifecycle as tagged enum ADT.
 * Data.taggedEnum + const/namespace merge for unified export.
 */
import { Data, Option } from 'effect';
import { Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type AsyncState<A = unknown, E = unknown> = Data.TaggedEnum<{
	// biome-ignore lint/complexity/noBannedTypes: <necessary>
	Idle: {};
	Loading: { readonly startedAt: Timestamp };
	Success: { readonly data: A; readonly timestamp: Timestamp };
	Failure: { readonly error: E; readonly timestamp: Timestamp };
}>;
interface Definition extends Data.TaggedEnum.WithGenerics<2> {readonly taggedEnum: AsyncState<this['A'], this['B']>;}

// --- [INTERNAL] --------------------------------------------------------------

const { $is, $match, Failure, Idle, Loading, Success } = Data.taggedEnum<Definition>();

// --- [OBJECT] ----------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const AsyncState = {
	$is,
	$match,
	failure: <E>(error: E, timestamp: Timestamp = Timestamp.nowSync()): AsyncState<never, E> => Failure({ error, timestamp }),
	getData: <A, E>(state: AsyncState<A, E>): Option.Option<A> => state._tag === 'Success' ? Option.some(state.data) : Option.none(),
	getError: <A, E>(state: AsyncState<A, E>): Option.Option<E> => state._tag === 'Failure' ? Option.some(state.error) : Option.none(),
	idle: (): AsyncState<never, never> => Idle(),
	loading: (startedAt: Timestamp = Timestamp.nowSync()): AsyncState<never, never> => Loading({ startedAt }),
	success: <A>(data: A, timestamp: Timestamp = Timestamp.nowSync()): AsyncState<A, never> => Success({ data, timestamp }),
	toAttr: <A, E>(state: AsyncState<A, E> | undefined): 'failure' | 'idle' | 'loading' | 'success' => state == null ? 'idle' : state._tag.toLowerCase() as 'failure' | 'idle' | 'loading' | 'success',
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AsyncState {export type Of<A = unknown, E = unknown> = AsyncState<A, E>;}

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncState };
