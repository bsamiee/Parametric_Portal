import * as DevtoolsDomain from '@effect/experimental/DevTools/Domain';
import * as DevtoolsServer from '@effect/experimental/DevTools/Server';
import { Duration, Effect, Mailbox, Match, Schedule, Stream } from 'effect';
import { Domain } from './domain.ts';

// --- [FUNCTIONS] -------------------------------------------------------------

const _run = (input: unknown = {}) =>
    Domain.normalizeRelay(input).pipe(
        Effect.mapError((error) => Domain.Error.from('config', error)),
        Effect.flatMap((config) => {
            const callbacks = Match.value(input).pipe(
                Match.when(
                    (raw: unknown): raw is Readonly<Record<string, unknown>> => typeof raw === 'object' && raw !== null,
                    (raw) => ({
                        onMetrics: raw['onMetrics'],
                        onSpan: raw['onSpan'],
                        onSpanEvent: raw['onSpanEvent'],
                    }),
                ),
                Match.orElse(() => ({ onMetrics: undefined, onSpan: undefined, onSpanEvent: undefined })),
            );
            const invoke = (callback: unknown, payload: unknown) =>
                Match.value(callback).pipe(
                    Match.when(
                        (next: unknown): next is (value: unknown) => unknown => typeof next === 'function',
                        (next) =>
                            Effect.sync(() => {
                                next(payload);
                            }),
                    ),
                    Match.orElse(() => Effect.void),
                );
            return DevtoolsServer.run((client) =>
                Effect.gen(function* () {
                    yield* Effect.repeat(
                        client.request({ _tag: 'MetricsRequest' }),
                        Schedule.spaced(Duration.millis(config.requestMetricsEveryMs)),
                    ).pipe(Effect.forkScoped);
                    return yield* Mailbox.toStream(client.queue).pipe(
                        Stream.mapEffect((request) =>
                            Match.value(request).pipe(
                                Match.tag('Span', (span) => invoke(callbacks.onSpan, span)),
                                Match.tag('SpanEvent', (event) => invoke(callbacks.onSpanEvent, event)),
                                Match.tag('MetricsSnapshot', (snapshot) => invoke(callbacks.onMetrics, snapshot)),
                                Match.exhaustive,
                            ),
                        ),
                        Stream.runDrain,
                    );
                }),
            );
        }),
        Effect.mapError((error) => Domain.Error.from('relay', error)),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const Relay: {
    readonly Domain: typeof DevtoolsDomain;
    readonly run: (input?: unknown) => Effect.Effect<unknown, unknown, unknown>;
} = {
    Domain: DevtoolsDomain,
    run: _run,
};

// --- [EXPORT] ----------------------------------------------------------------

export { Relay };
