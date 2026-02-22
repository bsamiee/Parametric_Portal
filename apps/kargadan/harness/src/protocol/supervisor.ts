/**
 * Models Kargadan session lifecycle as a Ref-backed state machine with typed SessionTransition events.
 * Tracks phase (idle→connected→authenticated→active→terminal), sessionId, heartbeat timestamp, and rejection reason.
 */
import { Data, Effect, Match, Ref } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const SessionTransition = Data.taggedEnum<SessionTransition.Type>();
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const SessionState = {
    initial: {
        heartbeatAt: undefined,
        phase:       'idle',
        reason:      undefined,
        sessionId:   undefined,
    } satisfies SessionState.Type,
} as const;
const _terminalState = (
    phase: 'closed' | 'reaped' | 'rejected' | 'timed_out',
    reason: string | undefined,
) => ({
    heartbeatAt: undefined,
    phase,
    reason,
    sessionId: undefined,
} as const);

// --- [NAMESPACE] -------------------------------------------------------------

namespace SessionTransition {
    export type Type = Data.TaggedEnum<{
        Activate:     { readonly at: Date };
        Authenticate: { readonly at: Date };
        Beat:         { readonly at: Date };
        Close:        { readonly reason?: string };
        Connect:      { readonly sessionId: string };
        Reap:         { readonly reason: string };
        Reject:       { readonly reason: string };
        Timeout:      { readonly reason: string };
    }>;
}
namespace SessionState {
    export type Phase =
        | 'idle'
        | 'connected'
        | 'authenticated'
        | 'active'
        | 'closing'
        | 'closed'
        | 'timed_out'
        | 'reaped'
        | 'rejected';
    export type Type = {
        readonly heartbeatAt: Date | undefined;
        readonly phase:       Phase;
        readonly reason:      string | undefined;
        readonly sessionId:   string | undefined;
    };
}

// --- [SERVICES] --------------------------------------------------------------

class SessionSupervisor extends Effect.Service<SessionSupervisor>()('kargadan/SessionSupervisor', {
    effect: Effect.gen(function* () {
        const state = yield* Ref.make<SessionState.Type>(SessionState.initial);
        const transition = Effect.fn('kargadan.session.transition')((event: SessionTransition.Type) =>
            Ref.update(state, (current) => ({
                ...current,
                ...Match.valueTags(event, {
                    Activate:     ({ at }) => ({ heartbeatAt: at, phase: 'active' as const,        reason: undefined }),
                    Authenticate: ({ at }) => ({ heartbeatAt: at, phase: 'authenticated' as const, reason: undefined }),
                    Beat:         ({ at }) => ({ heartbeatAt: at }),
                    Close:        ({ reason }) => _terminalState('closed', reason),
                    Connect:      ({ sessionId }) => ({ phase: 'connected' as const, reason: undefined, sessionId }),
                    Reap:         ({ reason }) => _terminalState('reaped', reason),
                    Reject:       ({ reason }) => _terminalState('rejected', reason),
                    Timeout:      ({ reason }) => _terminalState('timed_out', reason),
                }),
            })),
        );
        const snapshot = Effect.fn('kargadan.session.snapshot')(() => Ref.get(state));
        return { read: { snapshot }, transition } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SessionSupervisor, SessionTransition };
