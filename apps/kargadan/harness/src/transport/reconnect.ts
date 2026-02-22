/**
 * Reconnection supervisor with exponential backoff: wraps a connection-establishing effect in retry logic, re-reads the port file on each attempt,
 * and exposes connection state via Ref for callers to reject outbound sends during disconnection.
 */
import { Data, Duration, Effect, Ref, Schedule } from 'effect';
import { readPortFile } from './port-discovery';

// --- [ERRORS] ----------------------------------------------------------------

class DisconnectedError extends Data.TaggedError('DisconnectedError')<{
    readonly reason: string;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _reconnectSchedule = Schedule.exponential(Duration.millis(500), 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(50)),
    Schedule.upTo(Duration.seconds(30)),
);

// --- [SERVICES] --------------------------------------------------------------

class ReconnectionSupervisor extends Effect.Service<ReconnectionSupervisor>()('kargadan/ReconnectionSupervisor', {
    effect: Effect.gen(function* () {
        const connectionState = yield* Ref.make<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

        const isConnected = Ref.get(connectionState).pipe(
            Effect.map((state) => state === 'connected'),
        );

        const requireConnected = Ref.get(connectionState).pipe(
            Effect.flatMap((state) =>
                state === 'connected'
                    ? Effect.void
                    : Effect.fail(new DisconnectedError({ reason: `Connection state: ${state}` })),
            ),
        );

        const supervise = Effect.fn('kargadan.reconnect.supervise')(
            <A, E, R>(connectOnce: (port: number) => Effect.Effect<A, E, R>) =>
                Effect.gen(function* () {
                    const portInfo = yield* readPortFile();
                    yield* Ref.set(connectionState, 'connected');
                    yield* Effect.log('kargadan.reconnect: connected', { pid: portInfo.pid, port: portInfo.port });
                    return yield* connectOnce(portInfo.port).pipe(
                        Effect.onError(() =>
                            Ref.set(connectionState, 'reconnecting').pipe(
                                Effect.tap(() => Effect.log('kargadan.reconnect: disconnected, starting backoff')),
                            ),
                        ),
                        Effect.retry(
                            _reconnectSchedule.pipe(
                                Schedule.tapInput(() =>
                                    readPortFile().pipe(
                                        Effect.tap((info) =>
                                            Ref.set(connectionState, 'reconnecting').pipe(
                                                Effect.tap(() => Effect.log('kargadan.reconnect: retrying', { pid: info.pid, port: info.port })),
                                            ),
                                        ),
                                        Effect.catchAll((portError) =>
                                            Effect.log('kargadan.reconnect: port file unavailable, continuing retry', { error: String(portError) }),
                                        ),
                                    ),
                                ),
                                Schedule.tapOutput(() => Ref.set(connectionState, 'connected')),
                            ),
                        ),
                    );
                }),
        );

        return {
            control: { requireConnected, supervise },
            read:    { connectionState, isConnected },
        } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { DisconnectedError, ReconnectionSupervisor };
