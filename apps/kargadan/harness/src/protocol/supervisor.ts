/**
 * Models Kargadan session lifecycle as a Ref-backed state machine with typed SessionTransition events.
 * Tracks phase (idle→connected→authenticated→active→terminal), sessionId, heartbeat timestamp, and rejection reason.
 */
import { Data, Effect, Match, Ref } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _SessionTransition = Data.TaggedEnum<{
    Activate:     { readonly at:        Date   };
    Authenticate: { readonly at:        Date   };
    Beat:         { readonly at:        Date   };
    Close:        { readonly reason?:   string };
    Connect:      { readonly sessionId: string };
    Reap:         { readonly reason:    string };
    Reject:       { readonly reason:    string };
    Timeout:      { readonly reason:    string };
}>;
type _SessionState = {
    readonly heartbeatAt: Date | undefined;
    readonly phase: 'idle' | 'connected' | 'authenticated' | 'active' | 'closed' | 'timed_out' | 'reaped' | 'rejected';
    readonly reason:      string | undefined;
    readonly sessionId:   string | undefined;
};

// --- [CONSTANTS] -------------------------------------------------------------

const SessionTransition = Data.taggedEnum<_SessionTransition>();
const _initialState = {
    heartbeatAt: undefined,
    phase:       'idle',
    reason:      undefined,
    sessionId:   undefined,
} satisfies _SessionState;

// --- [SERVICES] --------------------------------------------------------------

class SessionSupervisor extends Effect.Service<SessionSupervisor>()('kargadan/SessionSupervisor', {
    effect: Effect.gen(function* () {
        const state = yield* Ref.make<_SessionState>(_initialState);
        const _transition = Effect.fn('kargadan.session.transition')((event: _SessionTransition) =>
            Ref.update(state, (current) => ({
                ...current,
                ...Match.valueTags(event, {
                    Activate:     ({ at }) => ({ heartbeatAt: at, phase: 'active' as const,        reason: undefined }),
                    Authenticate: ({ at }) => ({ heartbeatAt: at, phase: 'authenticated' as const, reason: undefined }),
                    Beat:         ({ at }) => ({ heartbeatAt: at }),
                    Close:        ({ reason }) => ({ heartbeatAt: undefined, phase: 'closed' as const, reason, sessionId: undefined }),
                    Connect:      ({ sessionId }) => ({ heartbeatAt: undefined, phase: 'connected' as const, reason: undefined, sessionId }),
                    Reap:         ({ reason }) => ({ heartbeatAt: undefined, phase: 'reaped' as const, reason, sessionId: undefined }),
                    Reject:       ({ reason }) => ({ heartbeatAt: undefined, phase: 'rejected' as const, reason, sessionId: undefined }),
                    Timeout:      ({ reason }) => ({ heartbeatAt: undefined, phase: 'timed_out' as const, reason, sessionId: undefined }),
                }),
            })),
        );
        const _snapshot = Effect.fn('kargadan.session.snapshot')(() => Ref.get(state));
        return { read: { snapshot: _snapshot }, transition: _transition } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SessionSupervisor, SessionTransition };
