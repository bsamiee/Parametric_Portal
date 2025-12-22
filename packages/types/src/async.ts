/**
 * Async state machine types.
 * Grounding: Idle → Loading → Success/Failure lifecycle.
 */
import { Match, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AsyncConfig = { readonly timestampProvider?: () => number };
type AsyncState<A, E = Error> =
    | { readonly _tag: 'Idle' }
    | { readonly _tag: 'Loading'; readonly startedAt: number }
    | { readonly _tag: 'Success'; readonly data: A; readonly timestamp: number }
    | { readonly _tag: 'Failure'; readonly error: E; readonly timestamp: number };
type AsyncStateFold<A, E, R> = {
    readonly Failure: (error: E, timestamp: number) => R;
    readonly Idle: () => R;
    readonly Loading: (startedAt: number) => R;
    readonly Success: (data: A, timestamp: number) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    tags: { failure: 'Failure', idle: 'Idle', loading: 'Loading', success: 'Success' },
    timestamp: () => Date.now(),
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const AsyncStateSchema = <A extends S.Schema.Any, E extends S.Schema.Any>(dataSchema: A, errorSchema: E) =>
    S.Union(
        S.Struct({ _tag: S.Literal(B.tags.idle) }),
        S.Struct({ _tag: S.Literal(B.tags.loading), startedAt: S.Number }),
        S.Struct({ _tag: S.Literal(B.tags.success), data: dataSchema, timestamp: S.Number }),
        S.Struct({ _tag: S.Literal(B.tags.failure), error: errorSchema, timestamp: S.Number }),
    );

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkIdle = <A, E = Error>(): AsyncState<A, E> => ({ _tag: B.tags.idle });
const mkLoading = <A, E = Error>(ts: () => number = B.timestamp): AsyncState<A, E> => ({
    _tag: B.tags.loading,
    startedAt: ts(),
});
const mkSuccess = <A, E = Error>(data: A, ts: () => number = B.timestamp): AsyncState<A, E> => ({
    _tag: B.tags.success,
    data,
    timestamp: ts(),
});
const mkFailure = <A, E>(error: E, ts: () => number = B.timestamp): AsyncState<A, E> => ({
    _tag: B.tags.failure,
    error,
    timestamp: ts(),
});
const elapsed = <A, E>(state: AsyncState<A, E>, now: number = Date.now()): number =>
    Match.value(state).pipe(
        Match.tag(B.tags.loading, (s) => now - s.startedAt),
        Match.orElse(() => 0),
    );
const age = <A, E>(state: AsyncState<A, E>, now: number = Date.now()): number =>
    Match.value(state).pipe(
        Match.tags({ [B.tags.success]: (s) => now - s.timestamp, [B.tags.failure]: (s) => now - s.timestamp }),
        Match.orElse(() => 0),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const fold = <A, E, R>(state: AsyncState<A, E>, handlers: AsyncStateFold<A, E, R>): R =>
    Match.value(state).pipe(
        Match.tag(B.tags.idle, () => handlers.Idle()),
        Match.tag(B.tags.loading, (s) => handlers.Loading(s.startedAt)),
        Match.tag(B.tags.success, (s) => handlers.Success(s.data, s.timestamp)),
        Match.tag(B.tags.failure, (s) => handlers.Failure(s.error, s.timestamp)),
        Match.exhaustive,
    ) as R;

const map = <A, E, R>(state: AsyncState<A, E>, f: (a: A) => R, ts: () => number = B.timestamp): AsyncState<R, E> =>
    Match.value(state).pipe(
        Match.tag(B.tags.success, (s) => mkSuccess<R, E>(f(s.data), ts)),
        Match.orElse((s) => s as AsyncState<R, E>),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAsync = (config: AsyncConfig = {}) => {
    const ts = config.timestampProvider ?? B.timestamp;
    return Object.freeze({
        age,
        elapsed,
        failure: <A, E>(error: E) => mkFailure<A, E>(error, ts),
        fold,
        idle: <A, E = Error>() => mkIdle<A, E>(),
        loading: <A, E = Error>() => mkLoading<A, E>(ts),
        map: <A, E, R>(state: AsyncState<A, E>, f: (a: A) => R) => map(state, f, ts),
        schema: AsyncStateSchema,
        success: <A, E = Error>(data: A) => mkSuccess<A, E>(data, ts),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    age,
    AsyncStateSchema,
    B as ASYNC_TUNING,
    createAsync,
    elapsed,
    fold,
    map,
    mkFailure,
    mkIdle,
    mkLoading,
    mkSuccess,
};
export type { AsyncConfig, AsyncState, AsyncStateFold };
