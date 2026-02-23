/**
 * Reconnection supervisor with exponential backoff: wraps a connection-establishing effect in retry logic, re-reads the port file on each attempt,
 * and exposes connection state via Ref for callers to reject outbound sends during disconnection.
 */
import { Data, Duration, Effect, Ref, Schedule } from 'effect';
import { HarnessConfig } from '../config';
import { readPortFile } from './port-discovery';

// --- [ERRORS] ----------------------------------------------------------------

class DisconnectedError extends Data.TaggedError('DisconnectedError')<{
    readonly reason: string;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class ReconnectionSupervisor extends Effect.Service<ReconnectionSupervisor>()('kargadan/ReconnectionSupervisor', {
    effect: Effect.gen(function* () {
        const connectionState = yield* Ref.make<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
        const [reconnectBackoffBaseMs, reconnectBackoffMaxMs, reconnectMaxAttempts] = yield* Effect.all([
            HarnessConfig.reconnectBackoffBaseMs,
            HarnessConfig.reconnectBackoffMaxMs,
            HarnessConfig.reconnectMaxAttempts,
        ]);
        const _reconnectSchedule = Schedule.exponential(Duration.millis(reconnectBackoffBaseMs), 2).pipe(
            Schedule.jittered,
            Schedule.upTo(Duration.millis(reconnectBackoffMaxMs)),
        );
        const _retrySchedule = _reconnectSchedule.pipe(
            Schedule.intersect(Schedule.recurs(reconnectMaxAttempts)),
            Schedule.tapInput(() =>
                readPortFile().pipe(
                    Effect.tap((info) =>
                        Effect.zipRight(
                            Ref.set(connectionState, 'reconnecting'),
                            Effect.log('kargadan.reconnect: retrying', { pid: info.pid, port: info.port }),
                        ),
                    ),
                    Effect.catchAll((portError) =>
                        Effect.log('kargadan.reconnect: port file unavailable, continuing retry', { error: String(portError) }),
                    ),
                ),
            ),
            Schedule.tapOutput(() => Ref.set(connectionState, 'connected')),
        );
        const _isConnected = Ref.get(connectionState).pipe(Effect.map((state) => state === 'connected'),);
        const _requireConnected = Ref.get(connectionState).pipe(
            Effect.flatMap((state) =>
                state === 'connected'
                    ? Effect.void
                    : Effect.fail(new DisconnectedError({ reason: `Connection state: ${state}` })),
            ),
        );
        const _supervise = Effect.fn('kargadan.reconnect.supervise')(
            <A, E, R>(connectOnce: (port: number) => Effect.Effect<A, E, R>) =>
                Effect.gen(function* () {
                    const portInfo = yield* readPortFile();
                    yield* Ref.set(connectionState, 'connected');
                    yield* Effect.log('kargadan.reconnect: connected', { pid: portInfo.pid, port: portInfo.port });
                    return yield* connectOnce(portInfo.port).pipe(
                        Effect.onError(() =>
                            Effect.zipRight(
                                Ref.set(connectionState, 'reconnecting'),
                                Effect.log('kargadan.reconnect: disconnected, starting backoff'),
                            ),
                        ),
                        Effect.retry(_retrySchedule),
                    );
                }),
        );
        return {
            control: { requireConnected: _requireConnected, supervise: _supervise },
            read:    { connectionState, isConnected: _isConnected },
        } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { DisconnectedError, ReconnectionSupervisor };
