/**
 * Auto-imported trace utilities wrapping Effect logging.
 * Tree-shakes to zero runtime cost in production builds.
 */
import { Effect } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TraceContext = Readonly<Record<string, unknown>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    noop: () => {},
    noopEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const trace = (msg: string, ctx?: TraceContext): void => {
    import.meta.env.DEV ? Effect.runSync(Effect.logDebug(msg).pipe(Effect.annotateLogs(ctx ?? {}))) : B.noop();
};
const span = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    import.meta.env.DEV ? Effect.withSpan(name)(effect) : B.noopEffect(effect);
const measure =
    (label: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        import.meta.env.DEV ? Effect.withLogSpan(label)(effect) : B.noopEffect(effect);

// --- [EXPORT] ----------------------------------------------------------------

export type { TraceContext };
export { B as TRACE_TUNING, measure, span, trace };
