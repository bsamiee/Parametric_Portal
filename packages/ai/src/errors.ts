import { AiError as AiSdkError } from '@effect/ai';
import { Data } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class AiError extends Data.TaggedError('AiError')<{
    readonly cause:     unknown;
    readonly operation: string;
    readonly reason:    'budget_exceeded' | 'policy_denied' | 'rate_exceeded' | 'request_tokens_exceeded' | 'unknown';
}> {
    override get message() {return `AiError[${this.operation}/${this.reason}]: ${String(this.cause)}`;}
    static readonly from = (operation: string) => (cause: unknown): AiSdkError.AiError | AiError =>
        AiSdkError.isAiError(cause) ? cause
            : cause instanceof AiError ? cause
            : new AiError({ cause, operation, reason: 'unknown' });
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiError };
