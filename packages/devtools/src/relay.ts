import * as DevtoolsDomain from '@effect/experimental/DevTools/Domain';
import * as DevtoolsServer from '@effect/experimental/DevTools/Server';
import * as EventJournal from '@effect/experimental/EventJournal';
import * as EventLog from '@effect/experimental/EventLog';
import * as EventLogEncryption from '@effect/experimental/EventLogEncryption';
import * as EventLogRemote from '@effect/experimental/EventLogRemote';
import * as EventLogServer from '@effect/experimental/EventLogServer';
import * as Socket from '@effect/platform/Socket';
import { Duration, Effect, Layer, Mailbox, Match, Predicate, Schedule, Stream } from 'effect';
import { Domain } from './domain.ts';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _invoke = (callback: unknown, payload: unknown) =>
    typeof callback === 'function'
        ? Effect.sync(() => {
              (callback as (value: unknown) => void)(payload);
          })
        : Effect.void;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _startEventLogRemote = (config: Effect.Effect.Success<ReturnType<typeof Domain.normalizeRelay>>) =>
    config.eventLog.enabled
        ? EventLogRemote.fromSocket({ disablePing: config.eventLog.disablePing }).pipe(
              Effect.provide(
                  Layer.mergeAll(
                      Socket.layerWebSocket(config.eventLog.remoteUrl),
                      Socket.layerWebSocketConstructorGlobal,
                      EventLogEncryption.layerSubtle,
                      EventLog.layerEventLog,
                      EventJournal.layerMemory,
                      Layer.succeed(EventLog.Identity, EventLog.Identity.makeRandom()),
                  ),
              ),
              Effect.catchAllCause((cause) =>
                  Effect.logDebug('EventLog remote unavailable', {
                      cause,
                      module: 'eventlog.remote',
                      remoteUrl: config.eventLog.remoteUrl,
                  }),
              ),
              Effect.forkScoped,
              Effect.asVoid,
          )
        : Effect.void;
const _run = (input: unknown = {}) =>
    Domain.normalizeRelay(input).pipe(
        Effect.mapError((error) => Domain.Error.from('config', error)),
        Effect.flatMap((config) => {
            const raw = Predicate.isRecord(input) ? input : {};
            const callbacks = {
                onEnvelope: raw['onEnvelope'],
                onMetrics: raw['onMetrics'],
                onSpan: raw['onSpan'],
                onSpanEvent: raw['onSpanEvent'],
            } as const;
            return DevtoolsServer.run((client) =>
                Effect.gen(function* () {
                    yield* _startEventLogRemote(config);
                    yield* Effect.repeat(
                        client.request({ _tag: 'MetricsRequest' }),
                        Schedule.spaced(Duration.millis(config.requestMetricsEveryMs)),
                    ).pipe(Effect.forkScoped);
                    return yield* Mailbox.toStream(client.queue).pipe(
                        Stream.mapEffect((request) => {
                            const envelope: typeof Domain.Schema.RelayEnvelope.Type = {
                                context: config.context,
                                payload: request,
                                receivedAt: new Date(),
                                tag: request._tag,
                            };
                            return Effect.all(
                                [
                                    Match.value(request).pipe(
                                        Match.tag('Span', (span) => _invoke(callbacks.onSpan, span)),
                                        Match.tag('SpanEvent', (event) => _invoke(callbacks.onSpanEvent, event)),
                                        Match.tag('MetricsSnapshot', (snapshot) =>
                                            _invoke(callbacks.onMetrics, snapshot),
                                        ),
                                        Match.exhaustive,
                                    ),
                                    _invoke(callbacks.onEnvelope, envelope),
                                ],
                                { discard: true },
                            );
                        }),
                        Stream.runDrain,
                    );
                }),
            );
        }),
        Effect.mapError((error) => Domain.Error.from('relay', error)),
    );
const _http = (input: unknown = {}) =>
    Domain.normalizeRelay(input).pipe(
        Effect.mapError((error) => Domain.Error.from('config', error)),
        Effect.flatMap((config) =>
            config.eventLog.enabled
                ? EventLogServer.makeHandlerHttp.pipe(
                      Effect.provide(EventLogServer.layerStorageMemory),
                      Effect.mapError((error) => Domain.Error.from('relay', error)),
                  )
                : Effect.fail(Domain.Error.from('relay', 'EventLog relay disabled')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const Relay = {
    Domain: DevtoolsDomain,
    http: _http,
    run: _run,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Relay };
