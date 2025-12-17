/**
 * Define async state machine via discriminated union: Idle, Loading, Success, Failure with fold, map, match utilities.
 */
import { Schema as S } from '@effect/schema';
import { Effect, Option, pipe } from 'effect';
import { match, P } from 'ts-pattern';

// --- [TYPES] -----------------------------------------------------------------

type Idle = S.Schema.Type<typeof IdleSchema>;
type Loading = S.Schema.Type<typeof LoadingSchema>;
type Success<A> = S.Schema.Type<ReturnType<typeof SuccessSchema<S.Schema<A>>>>;
type Failure<E> = S.Schema.Type<ReturnType<typeof FailureSchema<S.Schema<E>>>>;
type AsyncState<A, E = Error> = Idle | Loading | Success<A> | Failure<E>;
type AsyncConfig = {
    readonly timestampProvider?: () => number;
};
type AsyncApi<A, E = Error> = {
    readonly failure: (error: E) => Failure<E>;
    readonly fold: <R>(state: AsyncState<A, E>, handlers: FoldHandlers<A, E, R>) => R;
    readonly idle: Idle;
    readonly isFailure: (state: AsyncState<A, E>) => state is Failure<E>;
    readonly isIdle: (state: AsyncState<A, E>) => state is Idle;
    readonly isLoading: (state: AsyncState<A, E>) => state is Loading;
    readonly isSuccess: (state: AsyncState<A, E>) => state is Success<A>;
    readonly loading: () => Loading;
    readonly map: <B>(state: AsyncState<A, E>, f: (a: A) => B) => AsyncState<B, E>;
    readonly match: typeof match;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly schemas: typeof schemas;
    readonly success: (data: A) => Success<A>;
    readonly tags: typeof B.tags;
};
type FoldHandlers<A, E, R> = {
    readonly onFailure: (error: E, timestamp: number) => R;
    readonly onIdle: () => R;
    readonly onLoading: (startedAt: number) => R;
    readonly onSuccess: (data: A, timestamp: number) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    tags: {
        failure: 'Failure',
        idle: 'Idle',
        loading: 'Loading',
        success: 'Success',
    },
    timestamp: () => Date.now(),
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const IdleSchema = S.Struct({ _tag: S.Literal('Idle') });
const LoadingSchema = S.Struct({ _tag: S.Literal('Loading'), startedAt: S.Number });

const SuccessSchema = <A extends S.Schema.Any>(dataSchema: A) =>
    S.Struct({ _tag: S.Literal('Success'), data: dataSchema, timestamp: S.Number });

const FailureSchema = <E extends S.Schema.Any>(errorSchema: E) =>
    S.Struct({ _tag: S.Literal('Failure'), error: errorSchema, timestamp: S.Number });

const AsyncStateSchema = <A extends S.Schema.Any, E extends S.Schema.Any>(dataSchema: A, errorSchema: E) =>
    S.Union(IdleSchema, LoadingSchema, SuccessSchema(dataSchema), FailureSchema(errorSchema));

const schemas = Object.freeze({
    asyncState: AsyncStateSchema,
    failure: FailureSchema,
    idle: IdleSchema,
    loading: LoadingSchema,
    success: SuccessSchema,
} as const);

// --- [PURE_FUNCTIONS] ------------------------------------------------------

const mkIdle = (): Idle => ({ _tag: B.tags.idle });
const mkLoading = (ts: () => number): Loading => ({ _tag: B.tags.loading, startedAt: ts() });
const mkSuccess = <A>(data: A, ts: () => number): Success<A> => ({ _tag: B.tags.success, data, timestamp: ts() });
const mkFailure = <E>(error: E, ts: () => number): Failure<E> => ({ _tag: B.tags.failure, error, timestamp: ts() });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const foldHandlers = <A, E, R>(state: AsyncState<A, E>, h: FoldHandlers<A, E, R>): R =>
    match(state)
        .with({ _tag: B.tags.idle }, () => h.onIdle())
        .with({ _tag: B.tags.loading }, (s) => h.onLoading(s.startedAt))
        .with({ _tag: B.tags.success }, (s) => h.onSuccess(s.data, s.timestamp))
        .with({ _tag: B.tags.failure }, (s) => h.onFailure(s.error, s.timestamp))
        .exhaustive();

const mapHandlers = <A, E, B>(state: AsyncState<A, E>, f: (a: A) => B, ts: () => number): AsyncState<B, E> =>
    match(state)
        .with({ _tag: B.tags.success }, (s) => mkSuccess(f(s.data), ts))
        .otherwise(() => state as AsyncState<B, E>);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAsync = <A, E = Error>(config: AsyncConfig = {}): Effect.Effect<AsyncApi<A, E>, never, never> =>
    pipe(
        Effect.sync(() => config.timestampProvider ?? B.timestamp),
        Effect.map((ts) =>
            Object.freeze({
                failure: (error: E) => mkFailure(error, ts),
                fold: <R>(state: AsyncState<A, E>, handlers: FoldHandlers<A, E, R>) => foldHandlers(state, handlers),
                idle: mkIdle(),
                isFailure: (state: AsyncState<A, E>): state is Failure<E> => state._tag === B.tags.failure,
                isIdle: (state: AsyncState<A, E>): state is Idle => state._tag === B.tags.idle,
                isLoading: (state: AsyncState<A, E>): state is Loading => state._tag === B.tags.loading,
                isSuccess: (state: AsyncState<A, E>): state is Success<A> => state._tag === B.tags.success,
                loading: () => mkLoading(ts),
                map: <B>(state: AsyncState<A, E>, f: (a: A) => B) => mapHandlers(state, f, ts),
                match,
                Option,
                P,
                schemas,
                success: (data: A) => mkSuccess(data, ts),
                tags: B.tags,
            } as AsyncApi<A, E>),
        ),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B as ASYNC_TUNING, createAsync, mkFailure, mkIdle, mkLoading, mkSuccess };
export type { AsyncApi, AsyncConfig, AsyncState, Failure, FoldHandlers, Idle, Loading, Success };
