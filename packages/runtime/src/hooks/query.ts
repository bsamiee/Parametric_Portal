/**
 * Bridge Effect operations with React Query for async data fetching with caching, retry, devtools, and Effect error modeling.
 */
import {
    type DefaultError,
    type QueryKey,
    type UseMutationOptions,
    type UseMutationResult,
    type UseQueryOptions,
    type UseQueryResult,
    useMutation as useReactMutation,
    useQuery as useReactQuery,
} from '@tanstack/react-query';
import type { Effect } from 'effect';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type EffectQueryOptions<A, E> = Omit<UseQueryOptions<A, E>, 'queryFn' | 'queryKey'>;
type EffectMutationOptions<A, E, I> = Omit<UseMutationOptions<A, E, I>, 'mutationFn'>;

// --- [HOOKS] -----------------------------------------------------------------

const useEffectQuery = <A, E = DefaultError, R = never>(
    queryKey: QueryKey,
    effect: Effect.Effect<A, E, R>,
    options?: EffectQueryOptions<A, E>,
): UseQueryResult<A, E> => {
    const runtime = useRuntime<R, never>();
    return useReactQuery<A, E>({
        queryFn: () => runtime.runPromise(effect),
        queryKey,
        ...options,
    });
};

const useEffectMutation = <A, E = DefaultError, I = void, R = never>(
    mutationFn: (input: I) => Effect.Effect<A, E, R>,
    options?: EffectMutationOptions<A, E, I>,
): UseMutationResult<A, E, I> => {
    const runtime = useRuntime<R, never>();
    return useReactMutation<A, E, I>({
        mutationFn: (input: I) => runtime.runPromise(mutationFn(input)),
        ...options,
    });
};

const useEffectQueryEnabled = <A, E = DefaultError, R = never>(
    queryKey: QueryKey,
    effect: Effect.Effect<A, E, R>,
    options: EffectQueryOptions<A, E> & { readonly enabled: boolean },
): UseQueryResult<A, E> => useEffectQuery(queryKey, effect, options);

// --- [EXPORT] ----------------------------------------------------------------

export type { EffectMutationOptions, EffectQueryOptions };
export { useEffectMutation, useEffectQuery, useEffectQueryEnabled };
