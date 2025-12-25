/**
 * Auto-imported trace utilities wrapping Effect logging.
 * Tree-shakes to zero runtime cost in production builds.
 */
import { Effect } from 'effect';
import { DEVTOOLS_TUNING } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type TraceContext = Readonly<Record<string, unknown>>;

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING.trace;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const trace = (msg: string, ctx?: TraceContext): void => {
    import.meta.env.DEV ? Effect.runSync(Effect.logDebug(msg).pipe(Effect.annotateLogs(ctx ?? {}))) : T.noop();
};
const span = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    import.meta.env.DEV ? Effect.withSpan(name)(effect) : T.noopEffect(effect);
const measure =
    (label: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        import.meta.env.DEV ? Effect.withLogSpan(label)(effect) : T.noopEffect(effect);

// --- [EXPORT] ----------------------------------------------------------------

export type { TraceContext };
export { measure, span, trace };
