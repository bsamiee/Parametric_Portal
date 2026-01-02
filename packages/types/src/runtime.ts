/** Runtime and messaging error types via TaggedEnum. */
import { Data } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type RuntimeErrorCode = 'FIBER_INTERRUPTED' | 'RUNTIME_MISSING' | 'STORE_INVALID';
type MessagingErrorCode = 'VALIDATION_FAILED' | 'SEND_FAILED' | 'TIMEOUT';
type AppError = Data.TaggedEnum<{
	Messaging: { readonly code: MessagingErrorCode; readonly message: string };
	Runtime: { readonly code: RuntimeErrorCode; readonly message: string; readonly operation: string };
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	errors: {
		fiberInterrupted: { code: 'FIBER_INTERRUPTED' as const, message: 'Fiber was interrupted' },
		runtimeMissing: { code: 'RUNTIME_MISSING' as const, message: 'Runtime context not found' },
		sendFailed: { code: 'SEND_FAILED' as const, message: 'Failed to send message' },
		storeInvalid: { code: 'STORE_INVALID' as const, message: 'Invalid store configuration' },
		timeout: { code: 'TIMEOUT' as const, message: 'Operation timed out' },
		validationFailed: { code: 'VALIDATION_FAILED' as const, message: 'Schema validation failed' },
	},
} as const);

// --- [CLASSES] ---------------------------------------------------------------

const AppError = (() => {
	const taggedEnum = Data.taggedEnum<AppError>();
	return {
		...taggedEnum,
		format: (e: AppError): string =>
			taggedEnum.$match(e, {
				Messaging: (m) => `[Messaging:${m.code}] ${m.message}`,
				Runtime: (r) => `[Runtime:${r.code}] ${r.operation}: ${r.message}`,
			}),
	};
})();

// --- [EXPORT] ----------------------------------------------------------------

export type { MessagingErrorCode, RuntimeErrorCode };
export { AppError, B as RUNTIME_TYPES_TUNING };
