import { AiError as AiSdkError } from '@effect/ai';
import { Data, Match } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class AiError extends Data.TaggedError('AiError')<{
    readonly cause: unknown;
    readonly operation: string;
    readonly reason: 'budget_exceeded' | 'rate_exceeded' | 'unknown';
}> {
    override get message() {return `AiError[${this.operation}/${this.reason}]: ${String(this.cause)}`;}
    // why: boundary collapse — SDK errors pass through untouched; domain errors pass through; unknown causes wrap with operation context
    static readonly from = (operation: string) => (cause: unknown): AiSdkError.AiError | AiError =>
        Match.value(cause).pipe(
            Match.when(AiSdkError.isAiError, (e) => e),
            Match.when(Match.instanceOf(AiError), (e) => e),
            Match.orElse((e) => new AiError({ cause: e, operation, reason: 'unknown' })),
        );
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiError };
