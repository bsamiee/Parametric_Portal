import { Effect, pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type TagMatcher<T extends { readonly _tag: string }> = <R>(
    cases: {
        [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R;
    },
) => (value: T) => R;

type EffectTagMatcher<T extends { readonly _tag: string }, E = never> = <R>(
    cases: {
        [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => Effect.Effect<R, E, never>;
    },
) => (value: T) => Effect.Effect<R, E, never>;

// --- Core Tag Matcher --------------------------------------------------------

export const createTagMatcher =
    <T extends { readonly _tag: string }>(): TagMatcher<T> =>
    <R>(cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R }): ((value: T) => R) =>
    (value: T) => {
        const handler = cases[value._tag as T['_tag']];
        return handler(value as Extract<T, { _tag: typeof value._tag }>);
    };

// --- Effect Tag Matcher ------------------------------------------------------

export const createEffectTagMatcher =
    <T extends { readonly _tag: string }, E = never>(): EffectTagMatcher<T, E> =>
    <R>(cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => Effect.Effect<R, E, never> }) =>
    (value: T): Effect.Effect<R, E, never> => {
        const handler = cases[value._tag as T['_tag']];
        return pipe(Effect.succeed(value as Extract<T, { _tag: typeof value._tag }>), Effect.flatMap(handler));
    };
