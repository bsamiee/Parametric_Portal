/**
 * Defines LoopCommand, LoopState, and Verification tagged enums and namespace types driving the agent loop state machine.
 * Single source of truth for all loop variant shapes; AgentLoop and loop-stages derive all control flow from these types.
 */
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Data } from 'effect';

// --- [ALGEBRAS] --------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Verification = Data.taggedEnum<Verification.Type>();
namespace Verification {
    export type Type = Data.TaggedEnum<{
        // biome-ignore lint/complexity/noBannedTypes: Data.TaggedEnum empty variant requires {} — Record<string, never> breaks the _tag constraint
        Verified: {};
        Failed:   { readonly error: Kargadan.FailureReason & { readonly details?: unknown }; };
    }>;
}

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const LoopState = {} as const;
namespace LoopState {
    export type Type = {
        readonly attempt:          number;
        readonly command:          Kargadan.CommandEnvelope | undefined;
        readonly correctionCycles: number;
        readonly identityBase: {
            readonly appId:           string;
            readonly protocolVersion: Kargadan.ProtocolVersion;
            readonly runId:           string;
            readonly sessionId:       string;
        };
        readonly operations: ReadonlyArray<Kargadan.CommandOperation>;
        readonly sequence:   number;
        readonly status:     typeof Kargadan.RunStatusSchema.Type;
    };
    export type IdentityBase = Type['identityBase'];
}

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const LoopCommand = Data.taggedEnum<LoopCommand.Type>();
namespace LoopCommand {
    export type Type = Data.TaggedEnum<{
        PLAN: {
            readonly state:   LoopState.Type;
        };
        EXECUTE: {
            readonly state:   LoopState.Type;
            readonly command: Kargadan.CommandEnvelope;
        };
        VERIFY: {
            readonly state:   LoopState.Type;
            readonly command: Kargadan.CommandEnvelope;
            readonly result:  Kargadan.ResultEnvelope;
        };
        PERSIST: {
            readonly state:        LoopState.Type;
            readonly command:      Kargadan.CommandEnvelope;
            readonly result:       Kargadan.ResultEnvelope;
            readonly verification: Verification.Type;
        };
        DECIDE: {
            readonly state:        LoopState.Type;
            readonly command:      Kargadan.CommandEnvelope;
            readonly result:       Kargadan.ResultEnvelope;
            readonly verification: Verification.Type;
        };
    }>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { LoopCommand, LoopState, Verification };
